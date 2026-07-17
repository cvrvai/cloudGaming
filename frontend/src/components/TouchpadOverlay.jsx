import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keys & Mouse input mode: the whole screen is a trackpad, with a quick-key
 * bar and the phone's soft keyboard for typing.
 *
 * Gestures: 1 finger drag = move pointer · tap = left click ·
 *           2-finger tap = right click · 2-finger drag = scroll ·
 *           hold the L/R corner buttons to drag.
 */

const TAP_MAX_MS = 260;
const SCROLL_STEP_PX = 30;

// Named keys sent from the soft keyboard (printable chars go as text)
const KEYDOWN_MAP = {
    Backspace: 'BACKSPACE',
    Enter: 'ENTER',
    Escape: 'ESC',
    Tab: 'TAB',
    Delete: 'DELETE',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
};

const MOMENTARY_KEYS = [
    { label: 'Esc', key: 'ESC' },
    { label: 'Tab', key: 'TAB' },
    { label: '⊞', key: 'WIN' },
    { label: 'Space', key: 'SPACE', wide: true },
    { label: '⏎', key: 'ENTER' },
];

const LATCH_KEYS = [
    { label: 'Shift', key: 'SHIFT' },
    { label: 'Ctrl', key: 'CTRL' },
    { label: 'Alt', key: 'ALT' },
];

export default function TouchpadOverlay({ sendMessage, sensitivity = 20 }) {
    const gestureRef = useRef(null);
    const pendingMoveRef = useRef({ x: 0, y: 0 });
    const flushScheduledRef = useRef(false);
    const latchedRef = useRef({});
    const [latched, setLatched] = useState({});
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const inputRef = useRef(null);

    const speed = Math.max(0.3, sensitivity / 20);

    const queueMove = useCallback((dx, dy) => {
        const pending = pendingMoveRef.current;
        pending.x += dx * speed;
        pending.y += dy * speed;
        if (flushScheduledRef.current) return;
        flushScheduledRef.current = true;
        requestAnimationFrame(() => {
            flushScheduledRef.current = false;
            const sendX = Math.trunc(pending.x);
            const sendY = Math.trunc(pending.y);
            if (sendX || sendY) {
                pending.x -= sendX;
                pending.y -= sendY;
                sendMessage({ type: 'mouse_move', dx: sendX, dy: sendY });
            }
        });
    }, [sendMessage, speed]);

    const click = useCallback((button) => {
        sendMessage({ type: 'mouse_button', button, pressed: true });
        setTimeout(() => sendMessage({ type: 'mouse_button', button, pressed: false }), 40);
    }, [sendMessage]);

    // ------------------------------------------------------------------
    // Trackpad surface gestures
    // ------------------------------------------------------------------
    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (!gestureRef.current) {
            gestureRef.current = {
                pointers: new Map(),
                startTime: performance.now(),
                maxCount: 0,
                totalMove: 0,
                scrollAccum: 0,
            };
        }
        const gesture = gestureRef.current;
        gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture.maxCount = Math.max(gesture.maxCount, gesture.pointers.size);
    };

    const onPointerMove = (e) => {
        const gesture = gestureRef.current;
        const point = gesture?.pointers.get(e.pointerId);
        if (!point) return;
        const dx = e.clientX - point.x;
        const dy = e.clientY - point.y;
        point.x = e.clientX;
        point.y = e.clientY;
        gesture.totalMove += Math.abs(dx) + Math.abs(dy);

        if (gesture.pointers.size === 1) {
            queueMove(dx, dy);
        } else if (gesture.pointers.size === 2) {
            const [firstId] = gesture.pointers.keys();
            if (e.pointerId !== firstId) return;
            gesture.scrollAccum += dy;
            while (Math.abs(gesture.scrollAccum) >= SCROLL_STEP_PX) {
                const dir = gesture.scrollAccum > 0 ? 1 : -1;
                sendMessage({ type: 'mouse_scroll', dx: 0, dy: dir });
                gesture.scrollAccum -= dir * SCROLL_STEP_PX;
            }
        }
    };

    const onPointerEnd = (e) => {
        const gesture = gestureRef.current;
        if (!gesture?.pointers.has(e.pointerId)) return;
        gesture.pointers.delete(e.pointerId);
        if (gesture.pointers.size > 0) return;

        const duration = performance.now() - gesture.startTime;
        const moveLimit = gesture.maxCount >= 2 ? 30 : 12;
        const isTap = duration < TAP_MAX_MS && gesture.totalMove < moveLimit;
        if (e.type !== 'pointercancel' && isTap) {
            click(gesture.maxCount >= 2 ? 'right' : 'left');
        }
        gestureRef.current = null;
    };

    // ------------------------------------------------------------------
    // Quick keys
    // ------------------------------------------------------------------
    const pressKey = useCallback((key, pressed) => {
        sendMessage({ type: 'key', key, pressed });
    }, [sendMessage]);

    const toggleLatch = useCallback((key) => {
        setLatched(prev => {
            const next = { ...prev, [key]: !prev[key] };
            latchedRef.current = next;
            pressKey(key, next[key]);
            return next;
        });
    }, [pressKey]);

    // Release held modifiers when leaving trackpad mode
    useEffect(() => () => {
        Object.entries(latchedRef.current).forEach(([key, isDown]) => {
            if (isDown) sendMessage({ type: 'key', key, pressed: false });
        });
    }, [sendMessage]);

    // ------------------------------------------------------------------
    // Soft keyboard capture
    // ------------------------------------------------------------------
    useEffect(() => {
        if (keyboardOpen) inputRef.current?.focus();
    }, [keyboardOpen]);

    const handleBeforeInput = (e) => {
        if (e.data) sendMessage({ type: 'text', text: e.data });
        e.preventDefault();
    };

    const handleKeyDown = (e) => {
        const mapped = KEYDOWN_MAP[e.key];
        if (!mapped) return;
        e.preventDefault();
        pressKey(mapped, true);
        pressKey(mapped, false);
    };

    const holdHandlers = (down, up) => ({
        onPointerDown: (e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            down();
        },
        onPointerUp: (e) => { e.stopPropagation(); up(); },
        onPointerCancel: (e) => { e.stopPropagation(); up(); },
    });

    return (
        <div className="touchpad-mode">
            <div
                className="touchpad-surface"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
            />

            <div className="touchpad-hint">
                1 finger move · tap click · 2 fingers scroll / right-click · hold L to drag
            </div>

            <button
                type="button"
                className="touch-click-btn touch-click-left"
                {...holdHandlers(
                    () => sendMessage({ type: 'mouse_button', button: 'left', pressed: true }),
                    () => sendMessage({ type: 'mouse_button', button: 'left', pressed: false }),
                )}
            >
                L
            </button>
            <button
                type="button"
                className="touch-click-btn touch-click-right"
                {...holdHandlers(
                    () => sendMessage({ type: 'mouse_button', button: 'right', pressed: true }),
                    () => sendMessage({ type: 'mouse_button', button: 'right', pressed: false }),
                )}
            >
                R
            </button>

            <div className="touchpad-bar">
                {LATCH_KEYS.map(({ label, key }) => (
                    <button
                        key={key}
                        type="button"
                        className={`touchpad-key ${latched[key] ? 'latched' : ''}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => toggleLatch(key)}
                    >
                        {label}
                    </button>
                ))}
                {MOMENTARY_KEYS.map(({ label, key, wide }) => (
                    <button
                        key={key}
                        type="button"
                        className={`touchpad-key ${wide ? 'wide' : ''}`}
                        {...holdHandlers(() => pressKey(key, true), () => pressKey(key, false))}
                    >
                        {label}
                    </button>
                ))}
                <button
                    type="button"
                    className={`touchpad-key ${keyboardOpen ? 'latched' : ''}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setKeyboardOpen(open => !open)}
                >
                    ⌨
                </button>
            </div>

            {keyboardOpen && (
                <input
                    ref={inputRef}
                    className="kbd-capture"
                    aria-label="Type on your PC"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck="false"
                    value=""
                    onChange={() => { }}
                    onBeforeInput={handleBeforeInput}
                    onKeyDown={handleKeyDown}
                    onBlur={() => setKeyboardOpen(false)}
                />
            )}
        </div>
    );
}

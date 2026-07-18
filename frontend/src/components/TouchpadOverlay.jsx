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
    Shift: 'SHIFT',
    Control: 'CTRL',
    Alt: 'ALT',
    Meta: 'WIN',
    Home: 'HOME',
    End: 'END',
    PageUp: 'PGUP',
    PageDown: 'PGDN',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
};

const buttonName = (button) => ({ 0: 'left', 1: 'middle', 2: 'right' }[button]);

const browserKey = (event) => {
    const named = KEYDOWN_MAP[event.key];
    if (named) return named;
    // The backend normalizes printable key names to lower case. Keep a
    // single-character physical key as a held key rather than typed text so
    // shortcuts and games receive both keydown and keyup events.
    return event.key.length === 1 ? event.key.toUpperCase() : null;
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
    const desktopPointerRef = useRef(null);
    const desktopButtonsRef = useRef(new Set());
    const desktopKeysRef = useRef(new Set());
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
        if (e.pointerType === 'mouse') {
            const button = buttonName(e.button);
            desktopPointerRef.current = { x: e.clientX, y: e.clientY };
            if (button) {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                desktopButtonsRef.current.add(button);
                sendMessage({ type: 'mouse_button', button, pressed: true });
            }
            return;
        }

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
        // Desktop browsers do not need a touch-style drag. Forward ordinary
        // local mouse movement while the pointer is over the streamed screen.
        if (e.pointerType === 'mouse') {
            const previous = desktopPointerRef.current;
            desktopPointerRef.current = { x: e.clientX, y: e.clientY };
            if (previous) queueMove(e.clientX - previous.x, e.clientY - previous.y);
            return;
        }

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
        if (e.pointerType === 'mouse') {
            const button = buttonName(e.button);
            if (button && desktopButtonsRef.current.delete(button)) {
                sendMessage({ type: 'mouse_button', button, pressed: false });
            }
            return;
        }

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
        desktopKeysRef.current.forEach((key) => sendMessage({ type: 'key', key, pressed: false }));
        desktopButtonsRef.current.forEach((button) => sendMessage({ type: 'mouse_button', button, pressed: false }));
    }, [sendMessage]);

    // In desktop mode, use the laptop's real keyboard. The old overlay only
    // captured characters from the optional phone soft keyboard, so a remote
    // laptop session could never type or use shortcuts.
    useEffect(() => {
        const releaseAll = () => {
            desktopKeysRef.current.forEach((key) => sendMessage({ type: 'key', key, pressed: false }));
            desktopKeysRef.current.clear();
            desktopButtonsRef.current.forEach((button) => sendMessage({ type: 'mouse_button', button, pressed: false }));
            desktopButtonsRef.current.clear();
        };

        const onKeyDown = (event) => {
            if (event.isComposing) return;
            const key = browserKey(event);
            if (!key) return;
            event.preventDefault();
            if (desktopKeysRef.current.has(key)) return;
            desktopKeysRef.current.add(key);
            sendMessage({ type: 'key', key, pressed: true });
        };

        const onKeyUp = (event) => {
            const key = browserKey(event);
            if (!key) return;
            event.preventDefault();
            if (!desktopKeysRef.current.delete(key)) return;
            sendMessage({ type: 'key', key, pressed: false });
        };

        const onVisibilityChange = () => {
            if (document.hidden) releaseAll();
        };

        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', releaseAll);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', releaseAll);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            releaseAll();
        };
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

    const handleWheel = (e) => {
        e.preventDefault();
        const dx = Math.sign(e.deltaX);
        const dy = Math.sign(e.deltaY);
        if (dx || dy) sendMessage({ type: 'mouse_scroll', dx, dy });
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
        <div className="touchpad-mode rustdesk-touch-mode">
            <div
                className="touchpad-surface"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
            />

            <div className="touchpad-hint">
                Direct control · drag to move · tap to click · two fingers to scroll
            </div>

            <button
                type="button"
                className="touch-click-btn touch-click-left"
                {...holdHandlers(
                    () => sendMessage({ type: 'mouse_button', button: 'left', pressed: true }),
                    () => sendMessage({ type: 'mouse_button', button: 'left', pressed: false }),
                )}
            >
                <span>⌁</span><small>Left</small>
            </button>
            <button
                type="button"
                className="touch-click-btn touch-click-right"
                {...holdHandlers(
                    () => sendMessage({ type: 'mouse_button', button: 'right', pressed: true }),
                    () => sendMessage({ type: 'mouse_button', button: 'right', pressed: false }),
                )}
            >
                <span>⌁</span><small>Right</small>
            </button>

            <div className="touchpad-bar" aria-label="Remote keyboard controls">
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

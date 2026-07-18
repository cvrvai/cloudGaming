import { useCallback, useEffect, useRef } from 'react';

/**
 * Desktop input mode: the whole screen is the remote input surface.
 *
 * Gestures: 1 finger drag = move pointer · tap = left click ·
 *           2-finger tap = right click · 2-finger drag = scroll ·
 *           physical keyboard = remote keyboard.
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

export default function TouchpadOverlay({ sendMessage, sensitivity = 20, mouseMode = 'absolute', onOpenSettings }) {
    const gestureRef = useRef(null);
    const pendingMoveRef = useRef({ x: 0, y: 0 });
    const flushScheduledRef = useRef(false);
    const pendingAbsoluteRef = useRef(null);
    const absoluteFlushScheduledRef = useRef(false);
    const desktopPointerRef = useRef(null);
    const desktopButtonsRef = useRef(new Set());
    const desktopKeysRef = useRef(new Set());
    const surfaceRef = useRef(null);
    const pointerLockWasActiveRef = useRef(false);

    const speed = Math.max(0.3, sensitivity / 20);

    const remotePixelScale = useCallback(() => {
        const surface = surfaceRef.current;
        const video = document.querySelector('.video-background video');
        if (!surface || !video?.videoWidth || !video?.videoHeight) return 1;

        const bounds = surface.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return 1;

        // The video uses object-fit: contain. Convert browser movement into
        // pixels on the real host monitor so a 1080p stream feels equally
        // responsive on a smaller laptop viewport and in fullscreen.
        const streamAspect = video.videoWidth / video.videoHeight;
        const surfaceAspect = bounds.width / bounds.height;
        const displayedWidth = surfaceAspect > streamAspect
            ? bounds.height * streamAspect
            : bounds.width;
        return Math.max(0.5, Math.min(3, video.videoWidth / displayedWidth));
    }, []);

    const queueMove = useCallback((dx, dy) => {
        const pending = pendingMoveRef.current;
        pending.x += dx * speed;
        pending.y += dy * speed;
        if (flushScheduledRef.current) return;
        flushScheduledRef.current = true;
        requestAnimationFrame(() => {
            flushScheduledRef.current = false;
            // Measure the displayed-video scale once per rendered frame,
            // rather than forcing layout work for every raw mouse event.
            const scale = remotePixelScale();
            const sendX = Math.trunc(pending.x * scale);
            const sendY = Math.trunc(pending.y * scale);
            if (sendX || sendY) {
                pending.x -= sendX / scale;
                pending.y -= sendY / scale;
                sendMessage({ type: 'mouse_move', dx: sendX, dy: sendY });
            }
        });
    }, [sendMessage, speed, remotePixelScale]);

    const normalizedPointer = useCallback((clientX, clientY) => {
        const surface = surfaceRef.current;
        const video = document.querySelector('.video-background video');
        if (!surface || !video?.videoWidth || !video?.videoHeight) return null;

        const bounds = surface.getBoundingClientRect();
        const streamAspect = video.videoWidth / video.videoHeight;
        const surfaceAspect = bounds.width / bounds.height;
        const displayedWidth = surfaceAspect > streamAspect
            ? bounds.height * streamAspect
            : bounds.width;
        const displayedHeight = surfaceAspect > streamAspect
            ? bounds.height
            : bounds.width / streamAspect;
        const offsetX = bounds.left + (bounds.width - displayedWidth) / 2;
        const offsetY = bounds.top + (bounds.height - displayedHeight) / 2;

        return {
            x: Math.max(0, Math.min(1, (clientX - offsetX) / displayedWidth)),
            y: Math.max(0, Math.min(1, (clientY - offsetY) / displayedHeight)),
        };
    }, []);

    const sendAbsolutePointer = useCallback((clientX, clientY) => {
        const point = normalizedPointer(clientX, clientY);
        if (point) sendMessage({ type: 'mouse_abs', ...point });
    }, [normalizedPointer, sendMessage]);

    const queueAbsolutePointer = useCallback((clientX, clientY) => {
        pendingAbsoluteRef.current = { clientX, clientY };
        if (absoluteFlushScheduledRef.current) return;
        absoluteFlushScheduledRef.current = true;
        requestAnimationFrame(() => {
            absoluteFlushScheduledRef.current = false;
            const pending = pendingAbsoluteRef.current;
            pendingAbsoluteRef.current = null;
            if (pending) sendAbsolutePointer(pending.clientX, pending.clientY);
        });
    }, [sendAbsolutePointer]);

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
            // Position is sent before button-down, so a click always targets
            // the exact image location—even in fullscreen or at screen edges.
            if (mouseMode === 'absolute') {
                sendAbsolutePointer(e.clientX, e.clientY);
            } else {
                desktopPointerRef.current = { x: e.clientX, y: e.clientY };
            }
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
        // local mouse movement as absolute host coordinates. This is the same
        // model native remote-desktop clients use for reliable point-and-click.
        if (e.pointerType === 'mouse') {
            if (mouseMode === 'relative') {
                if (document.pointerLockElement === surfaceRef.current) {
                    if (e.movementX || e.movementY) queueMove(e.movementX, e.movementY);
                    return;
                }
                const previous = desktopPointerRef.current;
                desktopPointerRef.current = { x: e.clientX, y: e.clientY };
                if (previous) queueMove(e.clientX - previous.x, e.clientY - previous.y);
                return;
            }
            queueAbsolutePointer(e.clientX, e.clientY);
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

    // Release remote input when leaving Desktop mode.
    useEffect(() => () => {
        desktopKeysRef.current.forEach((key) => sendMessage({ type: 'key', key, pressed: false }));
        desktopButtonsRef.current.forEach((button) => sendMessage({ type: 'mouse_button', button, pressed: false }));
    }, [sendMessage]);

    useEffect(() => {
        const onPointerLockChange = () => {
            const active = document.pointerLockElement === surfaceRef.current;
            if (pointerLockWasActiveRef.current && !active && !document.hidden && mouseMode === 'relative') {
                onOpenSettings?.();
            }
            pointerLockWasActiveRef.current = active;
            if (!active) desktopPointerRef.current = null;
        };
        document.addEventListener('pointerlockchange', onPointerLockChange);
        return () => document.removeEventListener('pointerlockchange', onPointerLockChange);
    }, [mouseMode, onOpenSettings]);

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
            if (event.key === 'Escape') {
                event.preventDefault();
                if (document.pointerLockElement === surfaceRef.current) document.exitPointerLock?.();
                onOpenSettings?.();
                return;
            }
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
    }, [sendMessage, onOpenSettings]);

    const handleWheel = (e) => {
        e.preventDefault();
        const dx = Math.sign(e.deltaX);
        const dy = Math.sign(e.deltaY);
        if (dx || dy) sendMessage({ type: 'mouse_scroll', dx, dy });
    };

    const enableGameMouse = (e) => {
        // Lock only after the completed click. This preserves the click that
        // starts game mouse mode while providing unlimited relative movement.
        if (mouseMode === 'relative' && document.pointerLockElement !== e.currentTarget) {
            e.currentTarget.requestPointerLock?.();
        }
    };

    return (
        <div className="touchpad-mode rustdesk-touch-mode">
            <div
                ref={surfaceRef}
                className="touchpad-surface"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onClick={enableGameMouse}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
            />

        </div>
    );
}

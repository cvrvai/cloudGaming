import { useCallback, useRef } from 'react';
import AnalogStick from './AnalogStick';
import ActionButton from './ActionButton';
import DPad from './DPad';
import WebRTCPlayer from './WebRTCPlayer';
import TouchpadOverlay from './TouchpadOverlay';

export default function GamepadController({
    wsRef,
    serverStatus = 'connected',
    controllerMode = 'xinput',
    inputMode = 'controller',
    mouseMode = 'relative',
    controllerScale,
    controllerOpacity,
    visibleControls,
    visible,
    scale,
    opacity,
    showVideo,
    quality,
    showStatusBar,
    menuDockVisible,
    onShowMenuDock,
    apiBase,
    inputStats,
    onInputPacketSent,
    sensitivity = 20,
    onOpenSettings,
    nodeId,
}) {
    const inputSequenceRef = useRef(0);
    const activeControls = visibleControls || visible || {
        lt: true, rt: true,
        lb: true, rb: true,
        dpad: true,
        faceButtons: true,
        leftStick: true,
        rightStick: true,
    };
    const activeScale = controllerScale ?? scale ?? 1;
    const activeOpacity = controllerOpacity ?? opacity ?? 1;

    const inputModeLabel = controllerMode === 'xinput'
        ? 'XInput'
        : controllerMode === 'keyboard'
            ? 'Keys'
            : 'Offline';
    const videoStatusLabel = showVideo ? 'WebRTC' : 'Off';
    const controllerStatusLabel = serverStatus === 'connected'
        ? inputModeLabel
        : serverStatus === 'error'
            ? 'Reconnect'
            : 'Disconnected';

    // Send WebSocket message helper
    const sendMessage = useCallback((data) => {
        const socket = wsRef?.current;
        const sequence = ++inputSequenceRef.current;
        const sentAt = performance.now();
        const bufferedAmount = socket?.bufferedAmount ?? 0;

        if (socket?.readyState !== WebSocket.OPEN) {
            onInputPacketSent?.(sequence, sentAt, bufferedAmount, false);
            return;
        }

        if (socket.bufferedAmount > 4096) {
            onInputPacketSent?.(sequence, sentAt, socket.bufferedAmount, false);
            return;
        }

        socket.send(JSON.stringify({
            ...data,
            node_id: nodeId,
            sequence,
            clientTimestamp: sentAt
        }));
        onInputPacketSent?.(sequence, sentAt, socket.bufferedAmount, true);
        if (data.type === 'button' && data.pressed && typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(12); } catch {}
        }
    }, [wsRef, onInputPacketSent, nodeId]);

    // Left stick - Movement
    const handleLeftStickMove = useCallback(({ x, y }) => {
        sendMessage({ type: 'left_stick', x, y });
    }, [sendMessage]);

    const handleLeftStickEnd = useCallback(() => {
        sendMessage({ type: 'left_stick', x: 0, y: 0 });
    }, [sendMessage]);

    // Right stick - Camera
    const handleRightStickMove = useCallback(({ x, y }) => {
        sendMessage({ type: 'right_stick', x, y });
    }, [sendMessage]);

    const handleRightStickEnd = useCallback(() => {
        sendMessage({ type: 'right_stick', x: 0, y: 0 });
    }, [sendMessage]);

    // Button handlers
    const createButtonHandler = useCallback((button) => ({
        onPress: () => sendMessage({ type: 'button', button, pressed: true }),
        onRelease: () => sendMessage({ type: 'button', button, pressed: false }),
    }), [sendMessage]);

    // D-Pad handlers
    const handleDPadPress = useCallback((direction) => {
        sendMessage({ type: 'dpad', direction, pressed: true });
    }, [sendMessage]);

    const handleDPadRelease = useCallback((direction) => {
        sendMessage({ type: 'dpad', direction, pressed: false });
    }, [sendMessage]);

    return (
        <div className="gamepad-controller">
            {(showStatusBar || (onShowMenuDock && !menuDockVisible)) && (
                <div className="connection-pill" aria-label={`Video ${videoStatusLabel}, controller ${controllerStatusLabel}`}>
                    {showStatusBar && (
                        <>
                            <span className="connection-item">
                                <span className={`status-dot ${showVideo ? 'connected' : 'disconnected'}`} />
                                <span>Stream</span>
                            </span>
                            <span className="connection-divider" />
                            <span className="connection-item">
                                <span className={`status-dot ${serverStatus}`} />
                                <span>{controllerStatusLabel}</span>
                            </span>
                            {serverStatus === 'connected' && inputStats && (
                                <>
                                    <span className="connection-divider" />
                                    <span className="connection-item">
                                        <span>{inputStats.rttMs ? `${inputStats.rttMs.toFixed(0)} ms` : '— ms'}</span>
                                    </span>
                                </>
                            )}
                        </>
                    )}
                    {onShowMenuDock && !menuDockVisible && (
                        <button
                            type="button"
                            onClick={() => onShowMenuDock?.()}
                            style={{
                                marginLeft: showStatusBar ? '8px' : 0,
                                padding: '4px 10px',
                                borderRadius: '999px',
                                border: '1px solid var(--glass-border)',
                                background: 'var(--glass-bg)',
                                color: 'white',
                                fontSize: '11px',
                                fontWeight: '600',
                                cursor: 'pointer'
                            }}
                        >
                            Menu
                        </button>
                    )}
                </div>
            )}

            {/* Video stream background */}
            {showVideo && (
                <div className="video-background">
                    <WebRTCPlayer apiBase={apiBase} quality={quality} showStats={showStatusBar} />
                </div>
            )}

            <div className="portrait-message">Rotate your phone for the best experience.</div>

            {serverStatus !== 'connected' && (
                <button
                    type="button"
                    className="controller-warning"
                    onClick={() => window.location.reload()}
                >
                    Controller disconnected — tap to retry
                </button>
            )}

            {inputMode === 'touchpad' ? (
                <TouchpadOverlay
                    sendMessage={sendMessage}
                    sensitivity={sensitivity}
                    mouseMode={mouseMode}
                    onOpenSettings={onOpenSettings}
                />
            ) : (
                /* Main controller layout */
                <div className="controller-layout" style={{ opacity: activeOpacity, transform: `scale(${activeScale})` }}>
                {/* Left side - Movement */}
                <div className="controller-left">
                    <div className="shoulder-group">
                        {activeControls.lt && (
                            <ActionButton label="LT" color="#ffffff" size={50} {...createButtonHandler('LT')} className="trigger-btn left-trigger" />
                        )}
                        {activeControls.lb && (
                            <ActionButton label="LB" color="#ffffff" size={50} {...createButtonHandler('LB')} className="shoulder-btn left-shoulder" />
                        )}
                    </div>
                    {activeControls.leftStick && (
                        <AnalogStick
                            position="left"
                            onMove={handleLeftStickMove}
                            onEnd={handleLeftStickEnd}
                            size={120}
                            color="#ffffff"
                        />
                    )}
                    {activeControls.dpad && (
                        <DPad
                            onPress={handleDPadPress}
                            onRelease={handleDPadRelease}
                        />
                    )}
                </div>

                {/* Center - Start/Select pill */}
                <div className="controller-center">
                    <div className="center-controls">
                        <ActionButton label="☰" color="#ffffff" size={36} {...createButtonHandler('SELECT')} className="menu-btn" />
                        <ActionButton label="▶" color="#ffffff" size={36} {...createButtonHandler('START')} className="menu-btn" />
                    </div>
                </div>

                {/* Right side - Actions */}
                <div className="controller-right">
                    <div className="shoulder-group">
                        {activeControls.rb && (
                            <ActionButton label="RB" color="#ffffff" size={50} {...createButtonHandler('RB')} className="shoulder-btn right-shoulder" />
                        )}
                        {activeControls.rt && (
                            <ActionButton label="RT" color="#ffffff" size={50} {...createButtonHandler('RT')} className="trigger-btn right-trigger" />
                        )}
                    </div>
                    {activeControls.faceButtons && (
                        <div className="action-buttons-grid">
                            <ActionButton label="Y" color="#ffffff" size={60} {...createButtonHandler('Y')} className="btn-y" />
                            <ActionButton label="X" color="#ffffff" size={60} {...createButtonHandler('X')} className="btn-x" />
                            <ActionButton label="B" color="#ffffff" size={60} {...createButtonHandler('B')} className="btn-b" />
                            <ActionButton label="A" color="#ffffff" size={60} {...createButtonHandler('A')} className="btn-a" />
                        </div>
                    )}
                    {activeControls.rightStick && (
                        <AnalogStick
                            position="right"
                            onMove={handleRightStickMove}
                            onEnd={handleRightStickEnd}
                            size={110}
                            color="#ffffff"
                        />
                    )}
                </div>
                </div>
            )}
        </div>
    );
}

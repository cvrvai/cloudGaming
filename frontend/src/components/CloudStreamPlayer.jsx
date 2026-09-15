import { useEffect, useState, useRef, useCallback } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';
import { AlertTriangleIcon, RefreshIcon, GamepadIcon, CheckIcon } from './Icons';
import { INPUT_WS_URL } from '../config';

const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
};

const GAMEPAD_BUTTON_MAP = [
  'A',       // 0
  'B',       // 1
  'X',       // 2
  'Y',       // 3
  'LB',      // 4
  'RB',      // 5
  'LT',      // 6
  'RT',      // 7
  'SELECT',  // 8
  'START',   // 9
  'THUMBL',  // 10
  'THUMBR',  // 11
  'D_UP',    // 12
  'D_DOWN',  // 13
  'D_LEFT',  // 14
  'D_RIGHT', // 15
  'GUIDE',   // 16
];

export default function CloudStreamPlayer({ sessionData, onSessionEnd, apiBase, serverIP }) {
  const [gstreamerAvailable, setGstreamerAvailable] = useState(null); // null: checking, true: ok, false: offline
  const [hasGamepad, setHasGamepad] = useState(false);
  const [gamepadName, setGamepadName] = useState('');
  const [gamepadToast, setGamepadToast] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [gameExitedData, setGameExitedData] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const [isExiting, setIsExiting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const keySequenceRef = useRef(0);
  const hudTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const prevButtonsRef = useRef({});
  const prevAxesRef = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const animFrameRef = useRef(null);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const showGamepadToast = useCallback((name) => {
    let cleanName = name || 'Gamepad Controller';
    if (/xbox/i.test(cleanName)) cleanName = 'Xbox Controller';
    else if (/dualshock|dualsense|playstation/i.test(cleanName)) cleanName = 'PlayStation Controller';
    else if (/nintendo|switch/i.test(cleanName)) cleanName = 'Switch Controller';

    setGamepadToast(cleanName);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setGamepadToast(null);
    }, 2800);
  }, []);

  // Auto-close remote game if user navigates away, closes tab, or leaves browser
  useEffect(() => {
    const handleBrowserLeave = () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const beaconData = new Blob([JSON.stringify({ booking_id: sessionData?.booking_id })], {
          type: 'application/json',
        });
        navigator.sendBeacon(`${apiBase}/api/session/stop`, beaconData);
      } catch {
        try {
          fetch(`${apiBase}/api/session/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            keepalive: true,
          });
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleBrowserLeave);
    window.addEventListener('pagehide', handleBrowserLeave);
    return () => {
      window.removeEventListener('beforeunload', handleBrowserLeave);
      window.removeEventListener('pagehide', handleBrowserLeave);
    };
  }, [apiBase, sessionData?.booking_id]);

  // Auto-hide HUD after 3.5 seconds of inactivity
  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, 3500);
  }, []);

  useEffect(() => {
    resetHudTimer();
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, [resetHudTimer]);

  const handleExitSession = useCallback(() => {
    setIsExiting(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'stop_session',
          node_id: sessionData?.machine_id,
        }));
      } catch (e) {
        console.warn('Failed to send stop_session over input WS:', e);
      }
    }
    onSessionEnd?.();
  }, [onSessionEnd, sessionData?.machine_id]);

  // Fullscreen state listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const isIOSDevice = () => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };

  const toggleFullscreen = () => {
    resetHudTimer();
    if (isIOSDevice()) {
      setIsFullscreen((prev) => !prev);
      return;
    }
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {
          setIsFullscreen(true);
        });
      } else {
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  // Proactively ensure game process is launched on the host machine
  useEffect(() => {
    let triggered = false;
    const ensureGameLaunched = async () => {
      if (triggered || !sessionData?.booking_id) return;
      triggered = true;
      try {
        const token = localStorage.getItem('token');
        if (token) {
          await fetch(`${apiBase}/api/session/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ booking_id: sessionData.booking_id }),
          });
        }
      } catch (e) {
        console.debug('Session verify auto-launch check:', e);
      }
    };
    ensureGameLaunched();
  }, [apiBase, sessionData?.booking_id]);

  // Maintain persistent WebSocket connection to input service
  useEffect(() => {
    let ws = null;
    let timer = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(INPUT_WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!cancelled) setWsConnected(true);
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'game_exited') {
              setGameExitedData(data);
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          if (!cancelled) {
            setWsConnected(false);
            timer = setTimeout(connect, 3000);
          }
        };
        ws.onerror = () => {
          if (!cancelled) setWsConnected(false);
        };
      } catch {
        if (!cancelled) timer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      wsRef.current = null;
    };
  }, []);

  // Auto-return countdown when game exits
  useEffect(() => {
    if (!gameExitedData) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onSessionEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameExitedData, onSessionEnd]);

  // Native HTML5 Gamepad API Auto-Detection & Real-Time Polling
  useEffect(() => {
    const handleConnected = (e) => {
      setHasGamepad(true);
      setGamepadName(e.gamepad?.id || 'Controller');
      showGamepadToast(e.gamepad?.id);
    };

    const handleDisconnected = () => {
      const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const anyActive = Array.from(gamepads).some((g) => g && g.connected);
      setHasGamepad(anyActive);
      if (!anyActive) {
        setGamepadName('');
        prevButtonsRef.current = {};
        prevAxesRef.current = { lx: 0, ly: 0, rx: 0, ry: 0 };
      }
    };

    window.addEventListener('gamepadconnected', handleConnected);
    window.addEventListener('gamepaddisconnected', handleDisconnected);

    // Initial check on mount
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      const active = Array.from(gamepads).find((g) => g && g.connected);
      if (active) {
        setHasGamepad(true);
        setGamepadName(active.id || 'Controller');
      }
    }

    const applyDeadzone = (val, threshold = 0.12) => {
      if (Math.abs(val) < threshold) return 0;
      return Math.max(-1, Math.min(1, val));
    };

    const pollLoop = () => {
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        const gamepads = navigator.getGamepads();
        const gp = Array.from(gamepads).find((g) => g && g.connected);

        if (gp) {
          if (!hasGamepad) {
            setHasGamepad(true);
            setGamepadName(gp.id || 'Controller');
          }

          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            // Buttons
            for (let i = 0; i < GAMEPAD_BUTTON_MAP.length; i++) {
              const btnName = GAMEPAD_BUTTON_MAP[i];
              if (!btnName) continue;
              const btn = gp.buttons[i];
              const isPressed = !!(btn && (btn.pressed || btn.value > 0.25));
              const prev = !!prevButtonsRef.current[i];

              if (isPressed !== prev) {
                prevButtonsRef.current[i] = isPressed;
                ws.send(JSON.stringify({
                  type: 'button',
                  button: btnName,
                  pressed: isPressed,
                  node_id: sessionData?.machine_id,
                  sequence: ++keySequenceRef.current,
                  clientTimestamp: performance.now(),
                }));
              }
            }

            // Left Stick (Axes 0, 1)
            const lx = applyDeadzone(gp.axes[0] || 0);
            const ly = applyDeadzone(gp.axes[1] || 0);
            const prev = prevAxesRef.current;

            if (
              Math.abs(lx - prev.lx) > 0.02 ||
              Math.abs(ly - prev.ly) > 0.02 ||
              (lx === 0 && prev.lx !== 0) ||
              (ly === 0 && prev.ly !== 0)
            ) {
              prev.lx = lx;
              prev.ly = ly;
              ws.send(JSON.stringify({
                type: 'left_stick',
                x: lx,
                y: ly,
                node_id: sessionData?.machine_id,
                sequence: ++keySequenceRef.current,
                clientTimestamp: performance.now(),
              }));
            }

            // Right Stick (Axes 2, 3)
            const rx = applyDeadzone(gp.axes[2] || 0);
            const ry = applyDeadzone(gp.axes[3] || 0);

            if (
              Math.abs(rx - prev.rx) > 0.02 ||
              Math.abs(ry - prev.ry) > 0.02 ||
              (rx === 0 && prev.rx !== 0) ||
              (ry === 0 && prev.ry !== 0)
            ) {
              prev.rx = rx;
              prev.ry = ry;
              ws.send(JSON.stringify({
                type: 'right_stick',
                x: rx,
                y: ry,
                node_id: sessionData?.machine_id,
                sequence: ++keySequenceRef.current,
                clientTimestamp: performance.now(),
              }));
            }
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(pollLoop);
    };

    animFrameRef.current = requestAnimationFrame(pollLoop);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnected);
      window.removeEventListener('gamepaddisconnected', handleDisconnected);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [hasGamepad, sessionData?.machine_id, showGamepadToast]);

  // Universal keyboard event capture (simultaneous input alongside gamepad)
  useEffect(() => {
    const sendKeyEvent = (e, pressed) => {
      // Ignore functional browser shortcuts and Windows system keys to protect kiosk mode
      if (
        ['F5', 'F11', 'F12', 'Meta', 'OS'].includes(e.key) ||
        ['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'].includes(e.code)
      ) {
        return;
      }

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      e.preventDefault();
      ws.send(JSON.stringify({
        type: 'key',
        key: e.code || e.key,
        pressed,
        node_id: sessionData?.machine_id,
        sequence: ++keySequenceRef.current,
        clientTimestamp: performance.now(),
      }));
    };

    const onKeyDown = (e) => sendKeyEvent(e, true);
    const onKeyUp = (e) => sendKeyEvent(e, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sessionData?.machine_id]);

  const checkGst = async () => {
    try {
      const q = sessionData?.machine_id ? `?machine_id=${sessionData.machine_id}` : '';
      const res = await fetch(`${apiBase}/api/system/info${q}`);
      if (res.ok) {
        const data = await res.json();
        setGstreamerAvailable(!!data.gstreamer_available);
      } else {
        setGstreamerAvailable(false);
      }
    } catch {
      setGstreamerAvailable(false);
    }
  };

  useEffect(() => {
    checkGst();
    const interval = setInterval(checkGst, 4000);
    return () => clearInterval(interval);
  }, [apiBase, sessionData]);

  return (
    <div
      className={`cloud-stream-player-container ${isFullscreen ? 'ios-pseudo-fullscreen' : ''}`}
      ref={containerRef}
      onMouseMove={resetHudTimer}
      onTouchStart={resetHudTimer}
    >
      <StreamHUD
        sessionData={sessionData}
        onSessionEnd={handleExitSession}
        hudVisible={hudVisible}
        onShowHud={resetHudTimer}
        hasGamepad={hasGamepad}
        gamepadName={gamepadName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        isMuted={isMuted}
        onToggleMute={toggleMute}
      />

      {gamepadToast && (
        <div className="controller-toast">
          <GamepadIcon size={16} />
          <span>Controller Connected: {gamepadToast}</span>
        </div>
      )}

      <div className="stream-canvas-wrapper">
        {isExiting ? null : !gameExitedData && gstreamerAvailable ? (
          <WebRTCPlayer
            serverIP={serverIP}
            apiBase={apiBase}
            machineId={sessionData?.machine_id}
            quality="auto"
            showStats={false}
            isMuted={isMuted}
            onToggleMute={toggleMute}
          />
        ) : gameExitedData ? (
          <div className="stream-connecting-box glass-panel" style={{ maxWidth: '460px', padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
              <div style={{
                width: 54, height: 54, borderRadius: '50%', background: 'rgba(74, 222, 128, 0.15)',
                border: '1px solid rgba(74, 222, 128, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80'
              }}>
                <CheckIcon size={28} />
              </div>
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Game Process Ended</h3>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 12px 0' }}>
              The video stream was disconnected because the game closed.
            </p>
          </div>
        ) : gstreamerAvailable === null ? (
          <div className="stream-connecting-box glass-panel">
            <div className="stream-status-spinner" />
            <h3>Connecting to Gaming PC</h3>
            <p>Initializing WebRTC screen capture pipeline on {sessionData?.machine_name || 'Host PC'}...</p>
          </div>
        ) : (
          <div className="stream-connecting-box glass-panel" style={{ maxWidth: '520px', padding: '32px' }}>
            <div className="stream-offline-icon" style={{ marginBottom: '16px' }}>
              <AlertTriangleIcon size={36} />
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Host Screen Capture Offline</h3>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 12px 0' }}>
              The WebRTC streaming pipeline on <strong>{sessionData?.machine_name || 'Host PC'}</strong> is waiting for the GStreamer screen capture service.
            </p>
            <p className="stream-offline-hint" style={{ fontSize: '0.82rem', background: 'rgba(255,255,255,0.05)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
              Run <code>python stream_node.py</code> on your Gaming PC to connect the streaming service.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={checkGst} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                <RefreshIcon size={14} />
                <span>Retry Connection</span>
              </button>
              <button className="btn-secondary" onClick={handleExitSession} style={{ padding: '10px 20px' }}>
                Exit Stream
              </button>
            </div>
          </div>
        )}
      </div>

      {isTouchDevice() && !hasGamepad && (
        <GamepadController
          wsRef={wsRef}
          nodeId={sessionData?.machine_id}
          serverStatus={wsConnected ? 'connected' : 'connecting'}
          controllerMode="xinput"
          inputMode="controller"
          apiBase={apiBase}
          serverIP={serverIP}
          controllerScale={0.88}
          controllerOpacity={0.78}
          showStatusBar={false}
          visibleControls={{
            lt: true, rt: true,
            lb: true, rb: true,
            dpad: true,
            faceButtons: true,
            leftStick: true,
            rightStick: true,
          }}
        />
      )}

      {/* Game Exited / Process Termination Kiosk Modal */}
      {gameExitedData && (
        <div className="cutoff-modal-backdrop">
          <div className="cutoff-modal-dialog glass-panel" style={{ textAlign: 'center', maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%', background: 'rgba(74, 222, 128, 0.15)',
                border: '1px solid rgba(74, 222, 128, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80'
              }}>
                <CheckIcon size={32} />
              </div>
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '8px' }}>Game Session Ended</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', lineHeight: '1.5', margin: '0 0 16px 0' }}>
              <strong>{gameExitedData.title || sessionData?.game_title || 'The game'}</strong> has closed.
              The video stream was terminated immediately to prevent streaming the Windows desktop interface.
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 18px',
              border: '1px solid rgba(255,255,255,0.1)', marginBottom: '20px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Save Game Status:</span>
                <span style={{ color: '#4ade80', fontWeight: 600 }}>Secured & Archived</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Desktop Capture:</span>
                <span style={{ color: '#94a3b8' }}>Blocked & Terminated</span>
              </div>
            </div>
            <button className="btn-primary" onClick={onSessionEnd} style={{ width: '100%', padding: '12px', fontSize: '0.95rem' }}>
              Return to Dashboard ({countdown}s)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

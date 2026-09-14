import { useEffect, useState, useRef, useCallback } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';
import { AlertTriangleIcon, RefreshIcon, MouseIcon, GamepadIcon, CheckIcon, MaximizeIcon, MinimizeIcon } from './Icons';
import { INPUT_WS_URL } from '../config';

export default function CloudStreamPlayer({ sessionData, onSessionEnd, apiBase, serverIP }) {
  const [gstreamerAvailable, setGstreamerAvailable] = useState(null); // null: checking, true: ok, false: offline
  const [inputMode, setInputMode] = useState('desktop'); // desktop | controller
  const [wsConnected, setWsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gameExitedData, setGameExitedData] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const keySequenceRef = useRef(0);

  // Fullscreen state listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

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

  // Desktop mode keyboard event capture
  useEffect(() => {
    if (inputMode !== 'desktop') return;

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
  }, [inputMode, sessionData]);

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
    <div className="cloud-stream-player-container" ref={containerRef}>
      <StreamHUD sessionData={sessionData} onSessionEnd={onSessionEnd} />

      <div className="stream-canvas-wrapper">
        {!gameExitedData && gstreamerAvailable ? (
          <WebRTCPlayer
            serverIP={serverIP}
            apiBase={apiBase}
            machineId={sessionData?.machine_id}
            quality="auto"
            showStats={true}
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
              <button className="btn-secondary" onClick={onSessionEnd} style={{ padding: '10px 20px' }}>
                Exit Stream
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stream-bottom-controls">
        <button
          className={`stream-control-btn ${inputMode === 'desktop' ? 'active' : ''}`}
          onClick={() => setInputMode('desktop')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <MouseIcon size={16} />
          <span>Keyboard & Mouse</span>
        </button>
        <button
          className={`stream-control-btn ${inputMode === 'controller' ? 'active' : ''}`}
          onClick={() => setInputMode('controller')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <GamepadIcon size={16} />
          <span>Virtual Gamepad</span>
        </button>
        <button
          className="stream-control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          {isFullscreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
          <span>{isFullscreen ? 'Exit Full' : 'Fullscreen'}</span>
        </button>
      </div>

      {inputMode === 'controller' && (
        <GamepadController
          wsRef={wsRef}
          nodeId={sessionData?.machine_id}
          serverStatus={wsConnected ? 'connected' : 'connecting'}
          controllerMode="xinput"
          inputMode="controller"
          apiBase={apiBase}
          serverIP={serverIP}
          controllerScale={0.85}
          controllerOpacity={0.8}
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

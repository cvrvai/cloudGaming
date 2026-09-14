import { useEffect, useState, useRef, useCallback } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';
import { AlertTriangleIcon, RefreshIcon, MouseIcon, GamepadIcon, CheckIcon } from './Icons';
import { INPUT_WS_URL } from '../config';

export default function CloudStreamPlayer({ sessionData, onSessionEnd, apiBase, serverIP }) {
  const [gstreamerAvailable, setGstreamerAvailable] = useState(null); // null: checking, true: ok, false: offline
  const [inputMode, setInputMode] = useState('desktop'); // desktop | controller
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const keySequenceRef = useRef(0);

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
      clearTimeout(timer);
      if (ws) ws.close();
    };
  }, []);

  // Desktop mode keyboard event capture
  useEffect(() => {
    if (inputMode !== 'desktop') return;

    const sendKeyEvent = (e, pressed) => {
      // Ignore functional browser shortcuts
      if (['F5', 'F11', 'F12'].includes(e.key)) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      e.preventDefault();
      ws.send(JSON.stringify({
        type: 'key',
        key: e.code || e.key,
        pressed,
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
  }, [inputMode]);

  const checkGst = async () => {
    try {
      const res = await fetch(`${apiBase}/api/system/info`);
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
    const interval = setInterval(checkGst, 6000);
    return () => clearInterval(interval);
  }, [apiBase]);

  return (
    <div className="cloud-stream-player-container">
      <StreamHUD sessionData={sessionData} onSessionEnd={onSessionEnd} />

      <div className="stream-canvas-wrapper">
        {gstreamerAvailable ? (
          <WebRTCPlayer
            serverIP={serverIP}
            apiBase={apiBase}
            quality="auto"
            showStats={true}
          />
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
              Ensure GStreamer runtime is installed and the streaming service is active on the gaming rig.
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
      </div>

      {inputMode === 'controller' && (
        <GamepadController
          wsRef={wsRef}
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
    </div>
  );
}

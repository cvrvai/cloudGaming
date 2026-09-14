import { useEffect, useState } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';
import { AlertTriangleIcon, RefreshIcon, MouseIcon, GamepadIcon } from './Icons';

export default function CloudStreamPlayer({ sessionData, onSessionEnd, apiBase, serverIP }) {
  const [gstreamerAvailable, setGstreamerAvailable] = useState(null); // null: checking, true: ok, false: offline
  const [inputMode, setInputMode] = useState('desktop'); // desktop | controller

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
            <h3>Connecting to Host Gaming PC</h3>
            <p>Initializing WebRTC screen capture pipeline on {sessionData?.machine_name || 'Host Workstation'}...</p>
          </div>
        ) : (
          <div className="stream-connecting-box glass-panel">
            <div className="stream-offline-icon">
              <AlertTriangleIcon size={32} />
            </div>
            <h3>Host Screen Capture Offline</h3>
            <p>
              The WebRTC streaming pipeline on <strong>{sessionData?.machine_name || 'Host PC'}</strong> is not currently running.
            </p>
            <p className="stream-offline-hint">
              Ensure GStreamer and the host streamer service are started on the host PC.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button className="btn-primary" onClick={checkGst} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <RefreshIcon size={14} />
                <span>Retry Connection</span>
              </button>
              <button className="btn-secondary" onClick={onSessionEnd}>
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
          apiBase={apiBase}
          serverIP={serverIP}
          scale={0.85}
          opacity={0.8}
          visible={{
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

import { useEffect, useRef, useState } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';

export default function CloudStreamPlayer({ sessionData, onSessionEnd, apiBase, serverIP }) {
  const [gstreamerAvailable, setGstreamerAvailable] = useState(false);
  const [inputMode, setInputMode] = useState('desktop'); // desktop | controller
  const canvasRef = useRef(null);

  // Check backend GStreamer liveness
  useEffect(() => {
    const checkGst = async () => {
      try {
        const res = await fetch(`${apiBase}/api/system/info`);
        if (res.ok) {
          const data = await res.json();
          setGstreamerAvailable(!!data.gstreamer_available);
        }
      } catch {
        setGstreamerAvailable(false);
      }
    };
    checkGst();
  }, [apiBase]);

  // Interactive 60 FPS canvas game simulation (for rigs or environments without physical GStreamer)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let x = 400;
    let y = 250;
    let vx = 3;
    let vy = 2;
    let angle = 0;
    let frame = 0;

    const render = () => {
      frame++;
      ctx.fillStyle = '#080a0f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Perspective cyber grid
      ctx.strokeStyle = 'rgba(94, 162, 255, 0.15)';
      ctx.lineWidth = 1;
      const horizon = canvas.height * 0.45;
      
      // Vertical converging lines
      for (let i = -10; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, horizon);
        ctx.lineTo(i * 70, canvas.height);
        ctx.stroke();
      }
      // Horizontal receding lines
      for (let h = 0; h < 10; h++) {
        const lineY = horizon + Math.pow(h / 10, 2) * (canvas.height - horizon);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(canvas.width, lineY);
        ctx.stroke();
      }

      // Sun/Horizon glow
      const sunGrad = ctx.createRadialGradient(
        canvas.width / 2, horizon, 10,
        canvas.width / 2, horizon, 160
      );
      sunGrad.addColorStop(0, 'rgba(255, 110, 199, 0.6)');
      sunGrad.addColorStop(0.5, 'rgba(121, 40, 202, 0.3)');
      sunGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, horizon, 160, 0, Math.PI, true);
      ctx.fill();

      // Moving spaceship / drone
      x += vx;
      y += vy;
      if (x < 60 || x > canvas.width - 60) vx *= -1;
      if (y < horizon + 40 || y > canvas.height - 60) vy *= -1;
      angle = Math.sin(frame * 0.05) * 0.15;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      // Ship glow
      ctx.shadowColor = '#5ea2ff';
      ctx.shadowBlur = 20;

      // Ship body
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -25);
      ctx.lineTo(25, 20);
      ctx.lineTo(0, 10);
      ctx.lineTo(-25, 20);
      ctx.closePath();
      ctx.fill();

      // Thruster flame
      ctx.fillStyle = frame % 2 === 0 ? '#ff3b30' : '#ff9500';
      ctx.beginPath();
      ctx.moveTo(-10, 12);
      ctx.lineTo(0, 28 + Math.random() * 8);
      ctx.lineTo(10, 12);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Stream performance overlay
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(20, canvas.height - 75, 420, 55);
      ctx.strokeStyle = 'rgba(94, 162, 255, 0.3)';
      ctx.strokeRect(20, canvas.height - 75, 420, 55);

      ctx.fillStyle = '#30d158';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`STREAM: 60.0 FPS  |  BITRATE: 4.2 Mbps  |  CODEC: H.264`, 35, canvas.height - 52);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`GPU: ${sessionData?.gpu || 'Cloud GPU'} (Load: 48%, 56°C)`, 35, canvas.height - 32);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [sessionData]);

  return (
    <div className="cloud-stream-player-container">
      <StreamHUD sessionData={sessionData} onSessionEnd={onSessionEnd} />

      <div className="stream-canvas-wrapper">
        {gstreamerAvailable && sessionData?.is_host ? (
          <WebRTCPlayer
            serverIP={serverIP}
            apiBase={apiBase}
            active={true}
          />
        ) : (
          <div className="simulation-canvas-box">
            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              className="stream-game-canvas"
            />
            <div className="stream-watermark-overlay">
              <span>{sessionData?.machine_name}</span>
              <span className="live-stream-badge">LIVE CLOUD RIG</span>
            </div>
          </div>
        )}
      </div>

      <div className="stream-bottom-controls">
        <button
          className={`stream-control-btn ${inputMode === 'desktop' ? 'active' : ''}`}
          onClick={() => setInputMode('desktop')}
        >
          🖱️ Keyboard & Mouse
        </button>
        <button
          className={`stream-control-btn ${inputMode === 'controller' ? 'active' : ''}`}
          onClick={() => setInputMode('controller')}
        >
          🎮 Virtual Gamepad
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

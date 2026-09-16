import { useEffect, useState, useRef, useCallback } from 'react';
import StreamHUD from './StreamHUD';
import WebRTCPlayer from './WebRTCPlayer';
import GamepadController from './GamepadController';
import SessionFeedbackModal from './SessionFeedbackModal';
import { AlertTriangleIcon, RefreshIcon, GamepadIcon, CheckIcon, XIcon } from './Icons';
import { INPUT_WS_URL, formatRigName } from '../config';

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
  const [gstreamerAvailable, setGstreamerAvailable] = useState(true); // Optimistic: start WebRTC immediately
  const [iceServers, setIceServers] = useState(undefined);
  const [hasGamepad, setHasGamepad] = useState(false);
  const [gamepadName, setGamepadName] = useState('');
  const [gamepadToast, setGamepadToast] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const keyboardInputRef = useRef(null);
  const [gameExitedData, setGameExitedData] = useState(null);
  const [isExiting, setIsExiting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [audioState, setAudioState] = useState('waiting');
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const keySequenceRef = useRef(0);
  const hudTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const prevButtonsRef = useRef({});
  const prevAxesRef = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const animFrameRef = useRef(null);

  // DMAIC Live Telemetry Tracking Refs
  const sessionStartTimeRef = useRef(Date.now());
  const telemetrySamplesRef = useRef([]);
  const disconnectCountRef = useRef(0);
  const hasSubmittedTelemetryRef = useRef(false);

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

  // Collect real-time WebRTC telemetry sample from player
  const handleStatsSample = useCallback((sample) => {
    telemetrySamplesRef.current.push(sample);
    if (telemetrySamplesRef.current.length > 300) {
      telemetrySamplesRef.current.shift();
    }
  }, []);

  // Transmit the telemetry row and optional Verbatim VOC together so the
  // qualitative feedback stays tied to the same CTQ measurements.
  const sendSessionTelemetry = useCallback(async (reason = 'normal_exit', completed = true, feedback = {}) => {
    if (hasSubmittedTelemetryRef.current) return null;
    hasSubmittedTelemetryRef.current = true;

    const durationSec = Math.max(1, (Date.now() - sessionStartTimeRef.current) / 1000);
    const samples = telemetrySamplesRef.current;

    let avgLatency = 45;
    let maxLatency = 55;
    let avgFps = 60;
    let avgPacketLoss = 0.0;

    if (samples.length > 0) {
      const totalLatency = samples.reduce((acc, s) => acc + (s.latencyMs || 0), 0);
      avgLatency = Math.round((totalLatency / samples.length) * 10) / 10;
      maxLatency = Math.max(...samples.map((s) => s.latencyMs || 0));
      const totalFps = samples.reduce((acc, s) => acc + (s.fps || 0), 0);
      avgFps = Math.round((totalFps / samples.length) * 10) / 10;
      const totalLoss = samples.reduce((acc, s) => acc + (s.packetLossPct || 0), 0);
      avgPacketLoss = Math.round((totalLoss / samples.length) * 100) / 100;
    }

    const token = localStorage.getItem('token');
    if (!token) return null;

    const payload = {
      booking_id: sessionData?.booking_id,
      avg_latency_ms: avgLatency,
      max_latency_ms: maxLatency,
      avg_fps: avgFps,
      packet_loss_pct: avgPacketLoss,
      disconnects_count: disconnectCountRef.current,
      completed: completed,
      failure_reason: completed ? null : reason,
      duration_seconds: durationSec,
      phase: 'V2_Improved',
      user_rating: feedback.user_rating || null,
      experience_tag: feedback.experience_tag || null,
      user_comment: feedback.user_comment || null,
    };

    try {
      const response = await fetch(`${apiBase}/api/session/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!response.ok) {
        throw new Error(`Telemetry upload failed (${response.status})`);
      }
      return response.json();
    } catch (e) {
      console.debug('Telemetry error:', e);
      return null;
    }
  }, [apiBase, sessionData?.booking_id]);

  // Auto-close remote game if user navigates away, closes tab, or leaves browser
  useEffect(() => {
    const handleBrowserLeave = () => {
      void sendSessionTelemetry('browser_leave', true);
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
  }, [apiBase, sessionData?.booking_id, sendSessionTelemetry]);

  // Auto-hide HUD after 3.5 seconds of inactivity
  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, 3500);
  }, []);

  const hideHud = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setHudVisible(false);
  }, []);

  useEffect(() => {
    resetHudTimer();
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, [resetHudTimer]);

  const handleExitSession = useCallback(() => {
    setIsExiting(true);

    // 1. Send stop_session over WebSocket input relay immediately
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

    // 2. Direct REST API stop calls to immediately free the rig and release remaining time slot
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`${apiBase}/api/session/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          booking_id: sessionData?.booking_id,
          machine_id: sessionData?.machine_id,
        }),
      }).catch((e) => console.warn('Failed to stop session via API:', e));

      if (sessionData?.booking_id) {
        fetch(`${apiBase}/api/bookings/${sessionData.booking_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch((e) => console.warn('Failed to release booking:', e));
      }
    }

    // 3. Send telemetry in the background
    void sendSessionTelemetry('user_exit', true);

    // 4. Return to bookings immediately (0ms delay)
    onSessionEnd?.();
  }, [apiBase, onSessionEnd, sendSessionTelemetry, sessionData?.booking_id, sessionData?.machine_id]);

  const finishSessionWithFeedback = useCallback(async (feedback = {}) => {
    setFeedbackSubmitting(true);
    await sendSessionTelemetry(gameExitedData ? 'game_closed' : 'user_exit', true, feedback);
    onSessionEnd?.();
  }, [gameExitedData, onSessionEnd, sendSessionTelemetry]);

  const skipSessionFeedback = useCallback(() => {
    void finishSessionWithFeedback();
  }, [finishSessionWithFeedback]);

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

  // Virtual keyboard text & key senders for games (character names, save names, chat)
  const handleSendKeyboardText = useCallback(() => {
    if (!keyboardText) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'text',
        text: keyboardText,
        node_id: sessionData?.machine_id,
        sequence: ++keySequenceRef.current,
        clientTimestamp: performance.now(),
      }));
    }
    setKeyboardText('');
  }, [keyboardText, sessionData?.machine_id]);

  const sendVirtualKey = useCallback((key) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'key',
        key: key,
        pressed: true,
        node_id: sessionData?.machine_id,
        sequence: ++keySequenceRef.current,
        clientTimestamp: performance.now(),
      }));
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'key',
            key: key,
            pressed: false,
            node_id: sessionData?.machine_id,
            sequence: ++keySequenceRef.current,
            clientTimestamp: performance.now(),
          }));
        }
      }, 50);
    }
  }, [sessionData?.machine_id]);

  // Proactively ensure game process is launched on the host machine only if not already authorized
  useEffect(() => {
    let triggered = false;
    const ensureGameLaunched = async () => {
      // If session was already authorized by handleLaunchSession, skip duplicate verification
      if (triggered || !sessionData?.booking_id || sessionData?.session_token) return;
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
  }, [apiBase, sessionData?.booking_id, sessionData?.session_token]);

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
              setIsExiting(true);
              setFeedbackOpen(true);
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
      // Never intercept keystrokes when feedback modal is open or when typing in inputs/textareas
      if (feedbackOpen || isExiting) return;
      const target = e.target;
      if (
        target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          Boolean(target.closest?.('input, textarea, [contenteditable="true"], .session-feedback-dialog, .modal-dialog, [role="dialog"]'))
        )
      ) {
        return;
      }

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
  }, [feedbackOpen, isExiting, sessionData?.machine_id]);

  const checkGst = async () => {
    try {
      const q = sessionData?.machine_id ? `?machine_id=${sessionData.machine_id}` : '';
      const res = await fetch(`${apiBase}/api/system/info${q}`);
      if (res.ok) {
        const data = await res.json();
        setGstreamerAvailable(true);
        if (Array.isArray(data.ice_servers) && data.ice_servers.length > 0) {
          setIceServers((current) => {
            const next = JSON.stringify(data.ice_servers);
            return JSON.stringify(current) === next ? current : data.ice_servers;
          });
        }
      }
    } catch {
      // Ignore background network jitter; WebRTCPlayer manages its own connection lifecycle
    }
  };

  useEffect(() => {
    checkGst();
    const interval = setInterval(checkGst, 6000);
    return () => clearInterval(interval);
  }, [apiBase, sessionData]);

  return (
    <div
      className={`fixed inset-0 bg-black z-50 flex flex-col items-center justify-center overflow-hidden ${
        isFullscreen ? '!fixed !inset-0 !w-screen !h-screen !h-[100dvh] !z-[999999] !m-0 !p-0' : ''
      }`}
      ref={containerRef}
      onMouseMove={resetHudTimer}
    >
      <StreamHUD
        sessionData={sessionData}
        onSessionEnd={handleExitSession}
        hudVisible={hudVisible}
        onShowHud={resetHudTimer}
        onHideHud={hideHud}
        hasGamepad={hasGamepad}
        gamepadName={gamepadName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        audioState={audioState}
        isKeyboardOpen={isKeyboardOpen}
        onToggleKeyboard={() => setIsKeyboardOpen((prev) => !prev)}
      />

      {gamepadToast && (
        <div className="fixed top-[70px] left-1/2 -translate-x-1/2 z-[10002] bg-slate-950/90 backdrop-blur-xl border border-cyan-400/40 shadow-[0_8px_32px_rgba(0,0,0,0.7),0_0_20px_rgba(0,240,255,0.2)] px-4.5 py-2 rounded-full inline-flex items-center gap-2 text-white text-xs font-bold pointer-events-none animate-bounce">
          <GamepadIcon size={16} />
          <span>Controller Connected: {gamepadToast}</span>
        </div>
      )}

      {/* Floating Virtual Keyboard Bar for Mobile & Touch Text Entry */}
      {isKeyboardOpen && (
        <div className="absolute top-[60px] left-1/2 -translate-x-1/2 flex flex-wrap items-center gap-2 bg-slate-950/95 backdrop-blur-xl p-2.5 sm:p-3 rounded-xl border border-cyan-400/35 shadow-[0_8px_32px_rgba(0,0,0,0.7),0_0_20px_rgba(0,210,255,0.15)] z-[10002] max-w-[95vw] w-[520px]">
          <input
            ref={keyboardInputRef}
            type="text"
            className="flex-1 min-w-[140px] bg-white/10 border border-white/20 rounded-lg text-white px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
            placeholder="Type character name or text for game..."
            value={keyboardText}
            onChange={(e) => setKeyboardText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSendKeyboardText();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:opacity-90 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer transition-opacity"
            onClick={handleSendKeyboardText}
          >
            Send
          </button>
          <div className="flex gap-1.5">
            <button type="button" className="bg-white/10 hover:bg-white/15 active:bg-cyan-500/25 border border-white/15 active:border-cyan-400 text-slate-200 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all select-none" onClick={() => sendVirtualKey('Backspace')}>⌫</button>
            <button type="button" className="bg-white/10 hover:bg-white/15 active:bg-cyan-500/25 border border-white/15 active:border-cyan-400 text-slate-200 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all select-none" onClick={() => sendVirtualKey('Enter')}>↵</button>
            <button type="button" className="bg-white/10 hover:bg-white/15 active:bg-cyan-500/25 border border-white/15 active:border-cyan-400 text-slate-200 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all select-none" onClick={() => sendVirtualKey('Space')}>Space</button>
            <button type="button" className="bg-white/10 hover:bg-white/15 active:bg-cyan-500/25 border border-white/15 active:border-cyan-400 text-slate-200 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all select-none" onClick={() => sendVirtualKey('Escape')}>Esc</button>
          </div>
          <button
            type="button"
            className="bg-transparent hover:bg-white/10 text-slate-400 hover:text-white p-1.5 rounded-md cursor-pointer flex items-center justify-center transition-colors"
            onClick={() => setIsKeyboardOpen(false)}
            title="Close keyboard"
          >
            <XIcon size={16} />
          </button>
        </div>
      )}

      <div className="absolute inset-0 w-full h-full flex items-center justify-center z-[1]">
        {isExiting ? null : gameExitedData ? (
          <div className="bg-slate-900/90 border border-slate-700/60 backdrop-blur-xl rounded-2xl shadow-2xl text-center max-w-[460px] p-7 mx-4">
            <div className="flex justify-center mb-3.5">
              <div className="w-[54px] h-[54px] rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckIcon size={28} />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Game Process Ended</h3>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              The video stream was disconnected because the game closed on the remote PC.
            </p>
            <button
              className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:brightness-110 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-lg cursor-pointer transition-all"
              onClick={handleExitSession}
            >
              Return to Dashboard
            </button>
          </div>
        ) : (
          <WebRTCPlayer
            serverIP={serverIP}
            apiBase={apiBase}
            machineId={sessionData?.machine_id}
            gameId={sessionData?.game_id}
            gameTitle={sessionData?.game_title}
            bookingId={sessionData?.booking_id}
            iceServers={iceServers}
            quality="auto"
            showStats={false}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            onAudioState={setAudioState}
            onStatsSample={handleStatsSample}
            isExiting={isExiting}
          />
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

      {feedbackOpen && (
        <SessionFeedbackModal
          sessionData={sessionData}
          onSubmit={finishSessionWithFeedback}
          onSkip={skipSessionFeedback}
          submitting={feedbackSubmitting}
        />
      )}
    </div>
  );
}

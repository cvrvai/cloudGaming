import { useEffect, useState } from 'react';
import {
  ClockIcon,
  HourglassIcon,
  GamepadIcon,
  MaximizeIcon,
  MinimizeIcon,
  Volume2Icon,
  VolumeXIcon,
  KeyboardIcon,
} from './Icons';
import { formatRigName } from '../config';

export default function StreamHUD({
  sessionData,
  onSessionEnd,
  hudVisible = true,
  onShowHud,
  onHideHud,
  hasGamepad = false,
  gamepadName = '',
  isFullscreen = false,
  onToggleFullscreen,
  isMuted = true,
  onToggleMute,
  audioState = 'waiting',
  isKeyboardOpen = false,
  onToggleKeyboard,
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(
    sessionData?.remaining_seconds || 60
  );
  const [cutoffModalVisible, setCutoffModalVisible] = useState(false);

  useEffect(() => {
    if (!sessionData) return;

    // Use server-provided remaining_seconds as the authoritative base, or fallback to end_time
    const initialRemaining = typeof sessionData.remaining_seconds === 'number'
      ? sessionData.remaining_seconds
      : sessionData.end_time
        ? Math.max(0, Math.floor((new Date(sessionData.end_time).getTime() - Date.now()) / 1000))
        : 60;

    const startTimestamp = Date.now();
    setRemainingSeconds(initialRemaining);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
      const secs = Math.max(0, initialRemaining - elapsed);
      setRemainingSeconds(secs);

      if (secs <= 0) {
        clearInterval(interval);
        setCutoffModalVisible(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionData?.booking_id, sessionData?.remaining_seconds, sessionData?.end_time]);

  // Format time properly with hours if >= 1 hour (e.g. 1:55:23 instead of 115:23)
  const formatTime = (totalSecs) => {
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const timeFormatted = formatTime(remainingSeconds);
  const isWarning = remainingSeconds <= 120 && remainingSeconds > 0;

  return (
    <>
      {/* Subtle top-center notch/tab to summon HUD when faded out */}
      {!hudVisible && (
        <button
          type="button"
          className="fixed top-1.5 left-1/2 -translate-x-1/2 z-[9999] bg-slate-950/70 hover:bg-slate-900/90 backdrop-blur-md border border-white/15 hover:border-white/30 rounded-full px-2.5 py-1 flex items-center gap-1.5 cursor-pointer opacity-70 hover:opacity-100 hover:scale-105 transition-all shadow-md select-none"
          onClick={onShowHud}
          title="Tap to reveal controls"
          aria-label="Reveal stream controls"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
          <span className="text-[11px] font-bold text-white/80 tabular-nums">{timeFormatted}</span>
          <span className="text-[9px] text-white/50 -ml-0.5">▾</span>
        </button>
      )}

      {/* Main consolidated floating HUD */}
      <div
        className={`fixed top-2.5 left-1/2 -translate-x-1/2 z-[10000] bg-slate-950/85 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.7)] px-3 py-1.5 rounded-full flex items-center gap-2 md:gap-2.5 transition-all duration-300 select-none ${
          hudVisible
            ? 'opacity-100 pointer-events-auto translate-y-0'
            : 'opacity-0 pointer-events-none -translate-y-3.5'
        } ${isWarning ? 'border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-pulse' : ''}`}
        role="region"
        aria-label="Stream controls"
      >
        <div className="flex items-center gap-1.5 bg-black/45 px-2.5 py-1 rounded-full" title="Remaining session time">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
          <span className="text-xs md:text-sm font-extrabold tabular-nums text-emerald-400">{timeFormatted}</span>
          {isWarning && <span className="text-[9px] font-extrabold bg-amber-400 text-slate-950 px-1 py-0.5 rounded leading-none">Ending Soon</span>}
        </div>

        {hasGamepad && (
          <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 px-2 py-0.5 rounded-full text-[11px] font-bold select-none" title={gamepadName || 'Physical Gamepad Active'}>
            <GamepadIcon size={13} />
            <span className="hidden sm:inline">Gamepad</span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {onToggleMute && (
            <button
              type="button"
              className={`bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-all ${
                !isMuted ? '!text-cyan-300 !bg-cyan-500/20 !border-cyan-400/40 shadow-[0_0_12px_rgba(0,210,255,0.3)]' : ''
              }`}
              onClick={onToggleMute}
              title={audioState === 'unavailable'
                ? 'Game audio track was not received from the host'
                : isMuted ? 'Tap to hear game sound' : 'Mute game sound'}
              aria-label="Toggle game audio"
            >
              {isMuted ? <VolumeXIcon size={15} /> : <Volume2Icon size={15} />}
              <span className="hidden sm:inline">
                {audioState === 'unavailable' ? 'No audio' : isMuted ? 'Muted' : 'Sound'}
              </span>
            </button>
          )}

          {onToggleKeyboard && (
            <button
              type="button"
              className={`bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-all ${
                isKeyboardOpen ? '!text-cyan-300 !bg-cyan-500/20 !border-cyan-400/40 shadow-[0_0_12px_rgba(0,210,255,0.3)]' : ''
              }`}
              onClick={onToggleKeyboard}
              title="Open keyboard to type name or chat in game"
              aria-label="Toggle keyboard"
            >
              <KeyboardIcon size={15} />
              <span className="hidden sm:inline">Keyboard</span>
            </button>
          )}

          {onToggleFullscreen && (
            <button
              type="button"
              className="bg-white/10 hover:bg-white/20 border border-white/15 text-white/85 hover:text-white inline-flex items-center justify-center p-1.5 rounded-full text-[11px] font-semibold cursor-pointer transition-all"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label="Toggle fullscreen"
            >
              {isFullscreen ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
            </button>
          )}

          <button
            type="button"
            className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/45 hover:border-red-500/60 text-red-400 hover:text-white text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer transition-all shadow-sm hover:shadow-[0_0_10px_rgba(239,68,68,0.4)]"
            onClick={onSessionEnd}
            title="Exit game & terminate remote session"
          >
            Exit
          </button>

          {onHideHud && (
            <button
              type="button"
              className="bg-white/10 hover:bg-white/20 border border-white/15 text-white/60 hover:text-white rounded-full w-5 h-5 flex items-center justify-center text-[9px] cursor-pointer transition-all ml-0.5"
              onClick={onHideHud}
              title="Hide controls"
              aria-label="Hide stream controls"
            >
              ▲
            </button>
          )}
        </div>
      </div>

      {/* Session Cutoff Modal (FR-05 & MoSCoW MVP Success Criteria) */}
      {cutoffModalVisible && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[20000] grid place-items-center p-4">
          <div className="max-w-[440px] w-full p-8 text-center rounded-3xl bg-slate-900 border border-amber-400/30 shadow-2xl text-white">
            <div className="flex justify-center mb-3.5 text-amber-400">
              <HourglassIcon size={38} />
            </div>
            <h2 className="text-2xl font-extrabold text-amber-400 mb-3">Session Time Concluded</h2>
            <p className="text-sm text-slate-300 leading-relaxed mb-5">
              Your reserved time slot on <strong>{formatRigName(sessionData?.machine_name)}</strong> has reached its scheduled
              conclusion. The game process was terminated immediately to release the rig for the next student.
            </p>
            <div className="bg-black/40 p-3 rounded-xl flex flex-col gap-1 text-xs text-slate-400 mb-6 text-left">
              <span>Rig: {formatRigName(sessionData?.machine_name)}</span>
              <span>Player: {sessionData?.user_name}</span>
              <span>Status: Slot Completed & Game Exited</span>
            </div>
            <button
              type="button"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:brightness-110 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 cursor-pointer transition-all"
              onClick={onSessionEnd}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </>
  );
}

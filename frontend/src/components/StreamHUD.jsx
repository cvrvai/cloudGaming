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
    if (!sessionData?.end_time) return;

    const interval = setInterval(() => {
      const remainingMs = new Date(sessionData.end_time).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(remainingMs / 1000));
      setRemainingSeconds(secs);

      if (secs <= 0) {
        clearInterval(interval);
        setCutoffModalVisible(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionData]);

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isWarning = remainingSeconds <= 120 && remainingSeconds > 0;

  return (
    <>
      {/* Subtle top-center notch/tab to summon HUD when faded out */}
      {!hudVisible && (
        <button
          type="button"
          className="hud-summon-tab"
          onClick={onShowHud}
          title="Tap to reveal controls"
          aria-label="Reveal stream controls"
        >
          <span className="hud-summon-dot" />
          <span className="hud-summon-time">{timeFormatted}</span>
          <span className="hud-summon-chevron">▾</span>
        </button>
      )}

      {/* Main consolidated floating HUD */}
      <div
        className={`stream-top-hud ${hudVisible ? 'hud-visible' : 'hud-hidden'} ${isWarning ? 'timer-warning-pulse' : ''}`}
        role="region"
        aria-label="Stream controls"
      >
        <div className="hud-timer-pill" title="Remaining session time">
          <span className="hud-live-dot" />
          <span className="hud-time-val">{timeFormatted}</span>
          {isWarning && <span className="hud-warn-badge">Ending Soon</span>}
        </div>

        {hasGamepad && (
          <div className="hud-controller-badge" title={gamepadName || 'Physical Gamepad Active'}>
            <GamepadIcon size={13} />
            <span className="hud-btn-text">Gamepad</span>
          </div>
        )}

        <div className="hud-actions-group">
          {onToggleMute && (
            <button
              type="button"
              className={`hud-icon-btn ${!isMuted ? 'active-glow' : ''}`}
              onClick={onToggleMute}
              title={audioState === 'unavailable'
                ? 'Game audio track was not received from the host'
                : isMuted ? 'Tap to hear game sound' : 'Mute game sound'}
              aria-label="Toggle game audio"
            >
              {isMuted ? <VolumeXIcon size={15} /> : <Volume2Icon size={15} />}
              <span className="hud-btn-text">
                {audioState === 'unavailable' ? 'No audio' : isMuted ? 'Muted' : 'Sound'}
              </span>
            </button>
          )}

          {onToggleKeyboard && (
            <button
              type="button"
              className={`hud-icon-btn ${isKeyboardOpen ? 'active-glow' : ''}`}
              onClick={onToggleKeyboard}
              title="Open keyboard to type name or chat in game"
              aria-label="Toggle keyboard"
            >
              <KeyboardIcon size={15} />
              <span className="hud-btn-text">Keyboard</span>
            </button>
          )}

          {onToggleFullscreen && (
            <button
              type="button"
              className="hud-icon-btn"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label="Toggle fullscreen"
            >
              {isFullscreen ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
            </button>
          )}

          <button
            type="button"
            className="hud-exit-btn"
            onClick={onSessionEnd}
            title="Exit game & terminate remote session"
          >
            Exit
          </button>

          {onHideHud && (
            <button
              type="button"
              className="hud-collapse-btn"
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
        <div className="cutoff-modal-backdrop">
          <div className="cutoff-modal-dialog glass-panel">
            <div className="cutoff-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
              <HourglassIcon size={38} />
            </div>
            <h2>Session Time Concluded</h2>
            <p className="cutoff-message">
              Your reserved time slot on <strong>{formatRigName(sessionData?.machine_name)}</strong> has reached its scheduled
              conclusion. The game process was terminated immediately to release the rig for the next student.
            </p>
            <div className="cutoff-meta-summary">
              <span>Rig: {formatRigName(sessionData?.machine_name)}</span>
              <span>Player: {sessionData?.user_name}</span>
              <span>Status: Slot Completed & Game Exited</span>
            </div>
            <button type="button" className="btn-primary cutoff-return-btn" onClick={onSessionEnd}>
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { ClockIcon, HourglassIcon } from './Icons';

export default function StreamHUD({ sessionData, onSessionEnd }) {
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
      <div className={`stream-top-hud ${isWarning ? 'timer-warning-pulse' : ''}`}>
        <div className="hud-machine-meta">
          <span className="hud-live-dot" />
          <span className="hud-rig-name">{sessionData?.machine_name || 'Gaming Rig'}</span>
          <span className="hud-user-tag">{sessionData?.user_name}</span>
        </div>

        <div className="hud-timer-pill">
          <span className="hud-timer-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <ClockIcon size={14} />
          </span>
          <span className="hud-time-val">{timeFormatted}</span>
          {isWarning && <span className="hud-warn-badge">Ending Soon</span>}
        </div>

        <button className="hud-exit-btn" onClick={onSessionEnd} title="Exit Game Stream">
          Exit Session
        </button>
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
              Your reserved time slot on <strong>{sessionData?.machine_name}</strong> has reached its scheduled
              conclusion. The stream has been cleanly ended to release the rig for the next student.
            </p>
            <div className="cutoff-meta-summary">
              <span>Machine: {sessionData?.machine_name}</span>
              <span>Student: {sessionData?.user_name}</span>
              <span>Status: Slot Completed</span>
            </div>
            <button className="btn-primary cutoff-return-btn" onClick={onSessionEnd}>
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE, formatRigName } from '../config';
import { GamepadIcon, RocketIcon, CalendarIcon, LockIcon, HistoryIcon, PlayIcon, ClockIcon, XIcon } from './Icons';

let cachedBookingsData = null;
let cachedDailyQuota = null;

export default function MyBookingsView({ onLaunchSession, onBrowseGames }) {
  const { token, user, openAuth } = useAuth();
  const [bookingsData, setBookingsData] = useState(() => cachedBookingsData || { active: [], upcoming: [], past: [] });
  const [dailyQuota, setDailyQuota] = useState(() => cachedDailyQuota || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  // Live timer tick for active sessions
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchQuota = async () => {
    if (!token || !user || user.role === 'admin') return;
    try {
      const res = await fetch(`${API_BASE}/api/bookings/quota`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        cachedDailyQuota = data;
        setDailyQuota(data);
      }
    } catch (e) {
      // ignore
    }
  };

  const fetchBookings = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/bookings/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        cachedBookingsData = data;
        setBookingsData(data);
      } else {
        setError('Failed to fetch bookings');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
    fetchQuota();
    const interval = setInterval(() => {
      fetchBookings();
      fetchQuota();
    }, 8000);
    return () => clearInterval(interval);
  }, [token, user]);

  const handleCancelBooking = async (bookingId, isActive = false) => {
    const confirmMsg = isActive
      ? 'Cancel this active session early? This will end the stream immediately, free up the gaming rig, and save remaining time.'
      : 'Are you sure you want to cancel this reservation?';
    if (!window.confirm(confirmMsg)) return;
    setCancellingId(bookingId);
    try {
      const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchBookings();
        fetchQuota();
      } else {
        const errData = await res.json();
        alert(errData.detail || 'Could not cancel booking');
      }
    } catch (err) {
      alert('Error cancelling booking: ' + err.message);
    } finally {
      setCancellingId(null);
    }
  };

  if (!user) {
    return (
      <div className="bookings-unauth-container glass-panel">
        <div className="unauth-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <LockIcon size={44} />
        </div>
        <h2>Sign In to View Bookings</h2>
        <button className="btn-primary" onClick={() => openAuth('login')}>
          Sign In
        </button>
      </div>
    );
  }

  const formatCountdown = (endIso) => {
    const remainingMs = new Date(endIso).getTime() - currentTime;
    if (remainingMs <= 0) return '00:00 (Ending)';
    const totalSecs = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatTimeUntil = (startIso) => {
    const diffMs = new Date(startIso).getTime() - currentTime;
    if (diffMs <= 0) return 'Starting now';
    const totalSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hours > 0) return `in ${hours}h ${mins}m`;
    return `in ${mins} mins`;
  };

  return (
    <div className="my-bookings-container">
      <div className="bookings-header">
        <h1>My Bookings</h1>
        <button className="btn-browse-games-cta" onClick={onBrowseGames}>
          <GamepadIcon size={16} /> Browse Games
        </button>
      </div>

      {error && <div className="auth-error-banner">{error}</div>}

      {/* Compact Minimal Quota Strip */}
      {user.role !== 'admin' && (
        <div className="bookings-quota-banner glass-panel compact-strip">
          <div className="quota-banner-left">
            <span className="quota-pill-glow">Daily Quota</span>
            <span className="quota-reset-pill">Resets 00:00 UTC+7</span>
          </div>
          <div className="quota-banner-right">
            <div className="quota-metric-box">
              <span className={`quota-metric-val ${(dailyQuota?.remaining_minutes ?? 120) === 0 ? 'empty' : (dailyQuota?.remaining_minutes ?? 120) <= 30 ? 'low' : ''}`}>
                {dailyQuota ? dailyQuota.remaining_minutes : 120}
              </span>
              <span className="quota-metric-unit">/ 120 mins left</span>
            </div>
          </div>
        </div>
      )}

      {/* 1. ACTIVE SESSIONS */}
      <div className="bookings-section">
        <h2 className="section-title active-section-title">
          <span className="live-pulsing-badge">
            <span className="live-pulsing-dot" /> LIVE NOW
          </span>
          Active Sessions ({bookingsData.active.length})
        </h2>

        {bookingsData.active.length > 0 ? (
          <div className="active-sessions-list">
            {bookingsData.active.map((b) => (
              <div key={b.id} className="active-booking-card glass-panel">
                <div
                  className="booking-game-poster"
                  style={{ backgroundImage: b.game_cover_url ? `url(${b.game_cover_url})` : undefined }}
                >
                  {!b.game_cover_url && <GamepadIcon size={26} />}
                </div>

                <div className="active-card-body">
                  <div className="active-card-top">
                    <div className="active-card-title-group">
                      <h3 className="active-game-name">{b.game_title || 'Cloud Game'}</h3>
                      <span className="active-rig-sub">{formatRigName(b.machine_name)}</span>
                    </div>
                    <span className="live-status-badge">
                      <span className="live-dot" /> Ready to Play
                    </span>
                  </div>

                  <div className="countdown-timer-box">
                    <div className="timer-label-wrap">
                      <ClockIcon size={13} />
                      <span className="timer-label">Time Remaining</span>
                    </div>
                    <span className="timer-digits">{formatCountdown(b.end_time)}</span>
                  </div>

                  <div className="active-actions-row">
                    <button
                      className="btn-launch-stream"
                      onClick={() => onLaunchSession(b)}
                    >
                      <PlayIcon size={16} /> Play Now
                    </button>
                    <button
                      className="btn-cancel-active-session"
                      onClick={() => handleCancelBooking(b.id, true)}
                      disabled={cancellingId === b.id}
                      title="End session early and release remaining time"
                    >
                      <XIcon size={14} /> {cancellingId === b.id ? 'Ending...' : 'End Session'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-bookings-box glass-panel">
            <p>No active sessions.</p>
            <button className="btn-secondary" onClick={onBrowseGames} style={{ marginTop: '10px' }}>
              Browse Games
            </button>
          </div>
        )}
      </div>

      {/* 2. UPCOMING RESERVATIONS */}
      <div className="bookings-section">
        <h2 className="section-title">
          <CalendarIcon size={17} /> Upcoming Reservations ({bookingsData.upcoming.length})
        </h2>

        {bookingsData.upcoming.length > 0 ? (
          <div className="upcoming-bookings-grid">
            {bookingsData.upcoming.map((b) => (
              <div key={b.id} className="upcoming-card glass-panel">
                {b.game_cover_url && (
                  <div
                    className="upcoming-game-banner"
                    style={{ backgroundImage: `url(${b.game_cover_url})` }}
                  />
                )}

                <div className="upcoming-card-header">
                  <div>
                    <h4 className="upcoming-game-title">{b.game_title || 'Cloud Game'}</h4>
                  </div>
                  <span className="time-until-pill">{formatTimeUntil(b.start_time)}</span>
                </div>

                <div className="upcoming-times-row">
                  <div className="upcoming-time-col">
                    <span className="upcoming-time-label">Date</span>
                    <span className="upcoming-time-val">{new Date(b.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="upcoming-time-col" style={{ textAlign: 'right' }}>
                    <span className="upcoming-time-label">Time Slot</span>
                    <span className="upcoming-time-val">
                      {new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(b.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="upcoming-card-footer">
                  <button
                    className="btn-cancel-booking"
                    onClick={() => handleCancelBooking(b.id)}
                    disabled={cancellingId === b.id}
                  >
                    {cancellingId === b.id ? 'Cancelling...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-bookings-box glass-panel">
            <p>No upcoming reservations scheduled.</p>
          </div>
        )}
      </div>

      {/* 3. PAST SESSIONS */}
      {bookingsData.past.length > 0 && (
        <div className="bookings-section">
          <h2 className="section-title past-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <HistoryIcon size={18} />
            <span>Past Sessions History</span>
          </h2>
          <div className="past-bookings-table glass-panel">
            <div className="past-table-header">
              <span>Game</span>
              <span>Date</span>
              <span>Time</span>
              <span>Status</span>
            </div>
            {bookingsData.past.slice(0, 8).map((b) => {
              const isCancelled = b.status === 'cancelled';
              const isCompleted = b.status === 'completed' || b.status === 'confirmed';
              return (
                <div key={b.id} className="past-table-row">
                  <span className="past-cell-game"><strong>{b.game_title || 'Cloud Game'}</strong></span>
                  <span className="past-cell-date">{new Date(b.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  <span className="past-cell-time">
                    {new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="past-cell-status">
                    <span className={`past-status-pill ${b.status}`}>
                      <span className="past-status-dot" />
                      {isCancelled ? 'Cancelled' : isCompleted ? 'Completed' : b.status}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

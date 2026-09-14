import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { GamepadIcon, RocketIcon, CalendarIcon } from './Icons';

export default function MyBookingsView({ onLaunchSession, onBrowseGames }) {
  const { token, user, openAuth } = useAuth();
  const [bookingsData, setBookingsData] = useState({ active: [], upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  // Live timer tick for active sessions
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    const interval = setInterval(fetchBookings, 8000);
    return () => clearInterval(interval);
  }, [token]);

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to cancel this reservation?')) return;
    setCancellingId(bookingId);
    try {
      const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchBookings();
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
        <div className="unauth-icon">🔒</div>
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
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
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

      {/* 1. ACTIVE SESSIONS */}
      <div className="bookings-section">
        <h2 className="section-title active-section-title">
          <span className="live-pulsing-badge">● LIVE NOW</span> Active Sessions ({bookingsData.active.length})
        </h2>

        {bookingsData.active.length > 0 ? (
          <div className="active-sessions-list">
            {bookingsData.active.map((b) => (
              <div key={b.id} className="active-booking-card glass-panel">
                <div className="active-card-glow" />

                {b.game_cover_url && (
                  <div
                    className="booking-game-poster"
                    style={{ backgroundImage: `url(${b.game_cover_url})` }}
                  />
                )}

                <div className="active-card-body">
                  <div className="active-card-top">
                    <span className="live-status-badge">READY TO STREAM</span>
                    <h3 className="active-game-name">{b.game_title || 'Cloud Game'}</h3>
                  </div>

                  <div className="countdown-timer-box">
                    <span className="timer-label">Time Remaining</span>
                    <span className="timer-digits">{formatCountdown(b.end_time)}</span>
                  </div>

                  <div className="active-actions-row">
                    <button
                      className="btn-launch-stream"
                      onClick={() => onLaunchSession(b)}
                    >
                      <RocketIcon size={16} /> Launch Stream
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
                  <div>
                    <label>Date</label>
                    <span>{new Date(b.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div>
                    <label>Time Slot</label>
                    <span>
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
                    {cancellingId === b.id ? 'Cancelling...' : 'Cancel Reservation'}
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
          <h2 className="section-title past-title">📜 Past Sessions History</h2>
          <div className="past-bookings-table glass-panel">
            <div className="past-table-header">
              <span>Game</span>
              <span>Date</span>
              <span>Time</span>
              <span>Status</span>
            </div>
            {bookingsData.past.slice(0, 5).map((b) => (
              <div key={b.id} className="past-table-row">
                <span><strong>{b.game_title || 'Cloud Game'}</strong></span>
                <span>{new Date(b.start_time).toLocaleDateString()}</span>
                <span>
                  {new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`status-tag ${b.status}`}>{b.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

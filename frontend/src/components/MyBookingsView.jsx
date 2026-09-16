import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE, formatRigName } from '../config';
import { GamepadIcon, RocketIcon, CalendarIcon, LockIcon, HistoryIcon, PlayIcon, ClockIcon, XIcon } from './Icons';

let cachedBookingsData = null;
let cachedDailyQuota = null;

export default function MyBookingsView({ onLaunchSession, onBrowseGames, onRateSession }) {
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
      ? 'End this active session now? This frees up the gaming PC immediately.'
      : 'Cancel this reservation?';
    if (!window.confirm(confirmMsg)) return;
    setCancellingId(bookingId);
    try {
      const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      let errDetail = '';
      let isAlreadyFinished = false;
      try {
        const text = await res.text();
        if (text) {
          const parsed = JSON.parse(text);
          errDetail = parsed.detail || parsed.message || '';
          if (errDetail.toLowerCase().includes('already')) {
            isAlreadyFinished = true;
          }
        }
      } catch {
        // Non-JSON or empty response
      }

      if (res.ok || isAlreadyFinished) {
        setBookingsData((prev) => ({
          ...prev,
          active: prev.active.filter((b) => b.id !== bookingId),
          upcoming: prev.upcoming.filter((b) => b.id !== bookingId),
        }));
        fetchBookings();
        fetchQuota();
      } else {
        alert(errDetail || 'Could not cancel booking. Please try again.');
      }
    } catch (err) {
      console.warn('[Bookings] Cancel error:', err);
      fetchBookings();
      alert('Could not cancel booking: Please check your connection and try again.');
    } finally {
      setCancellingId(null);
    }
  };

  if (!user) {
    return (
      <div className="text-center p-10 max-w-md mx-auto my-12 rounded-2xl bg-[#12132b]/95 border border-cyan-400/25 shadow-2xl text-white animate-[fadeIn_0.2s_ease-out]">
        <div className="flex justify-center mb-4 text-cyan-400">
          <LockIcon size={44} />
        </div>
        <h2 className="text-xl font-extrabold mb-4">Sign In to View Bookings</h2>
        <button
          className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white px-6 py-2.5 rounded-full text-xs font-extrabold cursor-pointer shadow-[0_4px_14px_rgba(0,82,255,0.4)] hover:shadow-[0_6px_18px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all border-0"
          onClick={() => openAuth('login')}
        >
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
    <div className="flex flex-col gap-7 max-w-6xl mx-auto px-4 py-6 pb-20 animate-[fadeIn_0.2s_ease-out]">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl md:text-3xl font-black text-white m-0 tracking-tight">My Bookings</h1>
        <button
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/35 text-cyan-300 hover:shadow-[0_0_12px_rgba(0,210,255,0.3)] transition-all cursor-pointer"
          onClick={onBrowseGames}
        >
          <GamepadIcon size={16} /> Browse Games
        </button>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-xs font-medium">
          {error}
        </div>
      )}

      {/* Compact Minimal Quota Strip */}
      {user.role !== 'admin' && (
        <div className="flex items-center justify-between p-3 px-4 rounded-xl bg-[#12132b]/90 border border-cyan-400/20 text-white shadow-md flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-cyan-400 uppercase tracking-wide">Daily Quota</span>
            <span className="text-[10px] text-white/40 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08]">Resets 00:00 UTC+7</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className={`font-black font-mono text-sm ${(dailyQuota?.remaining_minutes ?? 120) === 0 ? 'text-red-400' : (dailyQuota?.remaining_minutes ?? 120) <= 30 ? 'text-amber-400' : 'text-cyan-400'}`}>
              {dailyQuota ? dailyQuota.remaining_minutes : 120}
            </span>
            <span className="text-white/50">/ 120 mins left</span>
          </div>
        </div>
      )}

      {/* 1. ACTIVE SESSIONS */}
      <div className="flex flex-col gap-3.5">
        <h2 className="text-base md:text-lg font-bold text-emerald-400 flex items-center gap-2 m-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wide px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#30d158] animate-pulse" /> LIVE NOW
          </span>
          Active Sessions ({bookingsData.active.length})
        </h2>

        {bookingsData.active.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {bookingsData.active.map((b) => (
              <div key={b.id} className="relative overflow-hidden flex flex-col sm:flex-row gap-4.5 p-4.5 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-[#12132b] to-blue-600/10 border border-emerald-500/35 shadow-[0_10px_32px_rgba(0,0,0,0.45),0_0_24px_rgba(48,209,88,0.12)] text-white">
                <div
                  className="w-full sm:w-[105px] h-32 sm:min-h-[120px] rounded-xl bg-cover bg-center bg-white/5 flex items-center justify-center text-white/35 shrink-0 border border-white/10 shadow-md"
                  style={{ backgroundImage: b.game_cover_url ? `url(${b.game_cover_url})` : undefined }}
                >
                  {!b.game_cover_url && <GamepadIcon size={26} />}
                </div>

                <div className="flex-1 flex flex-col justify-between min-w-0 gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <h3 className="text-lg font-black text-white truncate m-0">{b.game_title || 'Cloud Game'}</h3>
                      <span className="text-xs font-semibold text-slate-400">{formatRigName(b.machine_name)}</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#30d158] animate-pulse" /> Ready to Play
                    </span>
                  </div>

                  <div className="bg-black/35 px-3.5 py-2 rounded-xl flex items-center justify-between border border-white/[0.08]">
                    <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold">
                      <ClockIcon size={13} />
                      <span>Time Remaining</span>
                    </div>
                    <span className="text-lg font-black font-mono text-emerald-400 drop-shadow-[0_0_10px_rgba(48,209,88,0.3)]">
                      {formatCountdown(b.end_time)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 w-full">
                    <button
                      className="flex-1 py-2 px-4 bg-gradient-to-r from-emerald-400 to-emerald-600 hover:from-emerald-300 hover:to-emerald-500 text-slate-950 font-black text-xs rounded-lg cursor-pointer inline-flex items-center justify-center gap-1.5 transition-all shadow-[0_4px_16px_rgba(48,209,88,0.3)] hover:-translate-y-0.5 border-0"
                      onClick={() => onLaunchSession(b)}
                    >
                      <PlayIcon size={16} /> Play Now
                    </button>
                    <button
                      className="py-2 px-3.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 text-xs font-bold rounded-lg cursor-pointer inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap disabled:opacity-50"
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
          <div className="p-6 text-center rounded-xl bg-[#12132b]/80 border border-white/10 text-white/60 text-xs">
            <p className="m-0">No active sessions.</p>
            <button
              className="mt-2.5 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-xs cursor-pointer transition-colors border-0"
              onClick={onBrowseGames}
            >
              Browse Games
            </button>
          </div>
        )}
      </div>

      {/* 2. UPCOMING RESERVATIONS */}
      <div className="flex flex-col gap-3.5">
        <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2 m-0">
          <CalendarIcon size={17} /> Upcoming Reservations ({bookingsData.upcoming.length})
        </h2>

        {bookingsData.upcoming.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bookingsData.upcoming.map((b) => (
              <div key={b.id} className="p-4.5 rounded-2xl bg-[#12161e]/80 border border-white/10 text-white flex flex-col justify-between overflow-hidden relative shadow-lg">
                {b.game_cover_url && (
                  <div
                    className="h-24 -mx-4.5 -mt-4.5 mb-3 bg-cover bg-center border-b border-white/10 opacity-75"
                    style={{ backgroundImage: `url(${b.game_cover_url})` }}
                  />
                )}

                <div className="flex items-center justify-between gap-2 mb-3">
                  <h4 className="text-sm font-extrabold text-white truncate m-0">{b.game_title || 'Cloud Game'}</h4>
                  <span className="text-[11px] font-bold bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-md whitespace-nowrap">
                    {formatTimeUntil(b.start_time)}
                  </span>
                </div>

                <div className="flex justify-between items-center bg-black/30 p-2.5 px-3 rounded-lg mb-3 border border-white/[0.05] text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Date</span>
                    <span className="font-semibold text-white">{new Date(b.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-right">
                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Time Slot</span>
                    <span className="font-semibold text-white">
                      {new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(b.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer inline-flex items-center justify-center transition-colors disabled:opacity-50"
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
          <div className="p-6 text-center rounded-xl bg-[#12132b]/80 border border-white/10 text-white/60 text-xs">
            <p className="m-0">No upcoming reservations scheduled.</p>
          </div>
        )}
      </div>

      {/* 3. PAST SESSIONS */}
      {bookingsData.past.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2 m-0">
            <HistoryIcon size={18} />
            <span>Past Sessions History</span>
          </h2>
          <div className="rounded-xl overflow-x-auto border border-white/10 bg-[#12132b]/80 shadow-lg text-white">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-5 p-2.5 px-4 bg-black/40 text-white/50 font-extrabold uppercase text-[10.5px] tracking-wider">
                <span>Game</span>
                <span>Date</span>
                <span>Time</span>
                <span>Status</span>
                <span className="text-right">Voice of Customer</span>
              </div>
              {bookingsData.past.slice(0, 8).map((b) => {
                const isCancelled = b.status === 'cancelled';
                const isCompleted = b.status === 'completed' || b.status === 'confirmed';
                return (
                  <div key={b.id} className="grid grid-cols-5 p-3 px-4 border-t border-white/[0.06] text-xs items-center hover:bg-white/[0.02] transition-colors">
                    <span className="text-white font-bold truncate pr-3">{b.game_title || 'Cloud Game'}</span>
                    <span className="text-slate-400 font-mono text-[11px]">{new Date(b.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${
                        isCancelled ? 'bg-red-500/15 text-red-400 border border-red-500/30' : isCompleted ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}>
                        {isCancelled ? 'Cancelled' : isCompleted ? 'Completed' : b.status}
                      </span>
                    </div>
                    <div className="text-right">
                      {b.user_rating ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-yellow-400 text-xs">{'★'.repeat(b.user_rating)}</span>
                          {b.experience_tag && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize font-semibold ${
                              b.experience_tag === 'smooth'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : b.experience_tag === 'laggy'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-yellow-500/15 text-yellow-300'
                            }`}>
                              {b.experience_tag}
                            </span>
                          )}
                        </span>
                      ) : isCompleted ? (
                        <button
                          type="button"
                          onClick={() => onRateSession?.(b)}
                          className="bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-300 border border-yellow-500/35 rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1 transition-colors"
                        >
                          ★ Rate Session
                        </button>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

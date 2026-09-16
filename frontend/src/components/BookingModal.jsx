import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE, formatRigName } from '../config';
import { CalendarIcon, ClockIcon, BoltIcon, RocketIcon, CheckCircleIcon, PlayIcon, XIcon, AlertTriangleIcon, UserIcon } from './Icons';

export default function BookingModal({ game, machine, onClose, onBookingSuccess, onLaunchNow }) {
  const { token, user, openAuth } = useAuth();

  // Mode: 'instant' or 'schedule'
  const [mode, setMode] = useState('instant');
  const [durationMinutes, setDurationMinutes] = useState(60);

  // Local date formatting helper (prevents UTC timezone shifting)
  const formatLocalDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const now = new Date();
  const todayStr = formatLocalDate(now);
  const currentHour = now.getHours();
  const hasSlotsToday = currentHour < 23;

  // If late at night, default to tomorrow morning, otherwise next hour today
  const initialDateObj = hasSlotsToday ? now : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const initialDateStr = formatLocalDate(initialDateObj);
  const initialHour = hasSlotsToday ? Math.min(23, Math.max(8, currentHour + 1)) : 9;
  const defaultStartTime = `${String(initialHour).padStart(2, '0')}:00`;

  const [scheduleDate, setScheduleDate] = useState(initialDateStr);
  const [scheduleTime, setScheduleTime] = useState(defaultStartTime);
  const [showCustomTime, setShowCustomTime] = useState(false);

  // 3 Quick Date Choices: Today, Tomorrow, Calendar / Custom
  const quickDates = [0, 1].map((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = formatLocalDate(d);
    const label = offset === 0 ? 'Today' : 'Tomorrow';
    const sub = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { dateStr, label, sub };
  });

  const isOtherDate = !quickDates.some((q) => q.dateStr === scheduleDate);

  const formatCustomDateLabel = (dStr) => {
    if (!dStr) return 'Other';
    try {
      const [y, m, d] = dStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dStr;
    }
  };

  const [showCalendarDrawer, setShowCalendarDrawer] = useState(false);
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());

  const getCustomWeekday = (dStr) => {
    if (!dStr) return 'Calendar';
    try {
      const [y, m, d] = dStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      return dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    } catch {
      return 'Calendar';
    }
  };

  const handleToggleCalendar = () => {
    if (scheduleDate) {
      try {
        const [y, m] = scheduleDate.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      } catch (e) {
        console.debug('Failed to parse schedule date:', e);
      }
    }
    setShowCalendarDrawer((prev) => !prev);
  };

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    if (viewYear === now.getFullYear() && viewMonth <= now.getMonth()) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const getCalendarDays = () => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days = [];

    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ day: null, isCurrentMonth: false });
    }

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === scheduleDate;
      days.push({ day: d, dateStr, isCurrentMonth: true, isPast, isToday, isSelected });
    }

    return days;
  };

  const handleDaySelect = (dateStr) => {
    handleSelectDate(dateStr);
    setShowCalendarDrawer(false);
  };

  // Time Periods for cleaner grouped slots (Morning: 8-11, Afternoon: 12-16, Evening: 17-23)
  const timePeriods = [
    { id: 'morning', label: 'Morning', hours: [8, 9, 10, 11] },
    { id: 'afternoon', label: 'Afternoon', hours: [12, 13, 14, 15, 16] },
    { id: 'evening', label: 'Evening', hours: [17, 18, 19, 20, 21, 22, 23] },
  ];

  const getPeriodForHour = (hour) => {
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  };

  const [activePeriod, setActivePeriod] = useState(() => getPeriodForHour(initialHour));

  const handleSelectDate = (dStr) => {
    setScheduleDate(dStr);
    if (dStr === todayStr) {
      const selectedHour = parseInt(scheduleTime.split(':')[0], 10);
      if (selectedHour <= currentHour) {
        const nextAvail = Math.min(23, currentHour + 1);
        const nextTimeStr = `${String(nextAvail).padStart(2, '0')}:00`;
        setScheduleTime(nextTimeStr);
        setActivePeriod(getPeriodForHour(nextAvail));
      }
    }
  };

  const handleSelectPeriod = (periodId) => {
    setActivePeriod(periodId);
    const p = timePeriods.find((tp) => tp.id === periodId);
    if (p) {
      const currentH = parseInt(scheduleTime.split(':')[0], 10);
      if (!p.hours.includes(currentH)) {
        const firstAvail = p.hours.find((h) => !(scheduleDate === todayStr && h <= currentHour));
        if (firstAvail !== undefined) {
          setScheduleTime(`${String(firstAvail).padStart(2, '0')}:00`);
        }
      }
    }
  };

  const handleSelectSlot = (timeStr, hour) => {
    setScheduleTime(timeStr);
    setActivePeriod(getPeriodForHour(hour));
  };

  const formatTimeDisplay = (time24) => {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    const h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${mStr || '00'} ${ampm}`;
  };

  const durationOptions = [
    { label: '30 Mins', value: 30 },
    { label: '1 Hour', value: 60 },
    { label: '2 Hours (Max)', value: 120 },
  ];

  const [dailyQuota, setDailyQuota] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);

  // Fetch real-time slot availability for selected game/machine and date
  useEffect(() => {
    let active = true;
    const fetchAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const targetDate = mode === 'instant' ? todayStr : scheduleDate;
        const query = new URLSearchParams({
          date: targetDate,
          ...(game?.id ? { game_id: game.id } : {}),
          ...(machine?.id ? { machine_id: machine.id } : {}),
        });
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_BASE}/api/bookings/availability?${query.toString()}`, { headers });
        if (res.ok && active) {
          const data = await res.json();
          setAvailability(data);

          // If rig is currently in use by another user right now, switch to schedule mode
          if (data.is_currently_in_use && data.current_session && !data.current_session.is_mine) {
            setMode('schedule');
          }
        }
      } catch (err) {
        console.debug('Failed to fetch slot availability:', err);
      } finally {
        if (active) setLoadingAvailability(false);
      }
    };
    fetchAvailability();
    return () => { active = false; };
  }, [token, scheduleDate, mode, game?.id, machine?.id, todayStr]);

  // Hourly slots from 08:00 AM to 11:00 PM with real-time availability
  const timeSlots = useMemo(() => {
    const slots = [];
    const bookings = availability?.bookings || [];
    const capableCount = availability?.capable_machines_count || 1;

    for (let h = 8; h <= 23; h++) {
      const timeStr = `${String(h).padStart(2, '0')}:00`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const label = `${displayH}:00 ${ampm}`;
      const isPast = scheduleDate === todayStr && h <= currentHour;

      let isBooked = false;
      let isMyBooking = false;

      if (!isPast && bookings.length > 0) {
        const slotStartMs = new Date(`${scheduleDate}T${String(h).padStart(2, '0')}:00:00`).getTime();
        const durationMs = durationMinutes * 60 * 1000;
        const slotEndMs = slotStartMs + durationMs;

        const overlaps = bookings.filter((b) => {
          const bStart = new Date(b.start_time).getTime();
          const bEnd = new Date(b.end_time).getTime();
          return bStart < slotEndMs && bEnd > slotStartMs;
        });

        if (overlaps.length >= capableCount) {
          isBooked = true;
        }
        if (overlaps.some((b) => b.is_mine)) {
          isMyBooking = true;
        }
      }

      const isAvailable = !isPast && !isBooked;

      slots.push({
        timeStr,
        label,
        isPast,
        isBooked,
        isMyBooking,
        isAvailable,
        hour: h,
      });
    }
    return slots;
  }, [scheduleDate, todayStr, currentHour, durationMinutes, availability]);

  // Automatically select the next open available slot if current scheduleTime is booked or past
  useEffect(() => {
    if (!availability) return;
    const currentSlot = timeSlots.find((s) => s.timeStr === scheduleTime);
    if (currentSlot && (currentSlot.isPast || currentSlot.isBooked)) {
      const firstFree = timeSlots.find((s) => s.isAvailable);
      if (firstFree) {
        setScheduleTime(firstFree.timeStr);
        setActivePeriod(getPeriodForHour(firstFree.hour));
      }
    }
  }, [availability, timeSlots, scheduleTime]);

  // Fetch remaining 2-hour daily free quota for current date
  useEffect(() => {
    if (!token) return;
    const fetchQuota = async () => {
      try {
        const targetDate = mode === 'instant' ? todayStr : scheduleDate;
        const res = await fetch(`${API_BASE}/api/bookings/quota?date=${targetDate}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setDailyQuota(data);
          // If selected duration exceeds remaining quota and user is not admin, adjust duration
          if (!data.is_admin && data.remaining_minutes < durationMinutes) {
            if (data.remaining_minutes >= 60) setDurationMinutes(60);
            else if (data.remaining_minutes >= 30) setDurationMinutes(30);
          }
        }
      } catch (err) {
        console.debug('Failed to fetch daily quota:', err);
      }
    };
    fetchQuota();
  }, [token, scheduleDate, mode, todayStr]);

  if (!game && !machine) return null;

  const title = game?.title || formatRigName(machine?.name) || 'Cloud Session';
  const coverUrl = game?.cover_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80';
  const genre = game?.genre || 'Cloud Rig Session';

  const handleBookSession = async (e) => {
    if (e) e.preventDefault();
    if (!user) {
      if (onClose) onClose();
      openAuth('login');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      let startIso;
      let endIso;

      if (mode === 'instant') {
        const now = new Date();
        const end = new Date(now.getTime() + durationMinutes * 60 * 1000);
        startIso = now.toISOString();
        endIso = end.toISOString();
      } else {
        const [hours, mins] = scheduleTime.split(':').map(Number);
        const startDateTime = new Date(`${scheduleDate}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`);
        if (isNaN(startDateTime.getTime())) {
          throw new Error('Invalid reservation date or start time.');
        }
        const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);
        startIso = startDateTime.toISOString();
        endIso = endDateTime.toISOString();
      }

      const payload = {
        start_time: startIso,
        end_time: endIso,
        game_id: game?.id || null,
        game_title: game?.title || null,
        machine_id: machine?.id || null,
      };

      const res = await fetch(`${API_BASE}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setMode('schedule');
          setError(data.detail || 'Gaming rig is currently reserved or occupied. Please select an available time slot below.');
          return;
        }
        throw new Error(data.detail || 'Failed to complete game reservation.');
      }

      // If user selected instant "Play Now", launch the game immediately without extra screens
      if (mode === 'instant' && onLaunchNow) {
        if (onBookingSuccess) onBookingSuccess(data, 'instant');
        if (onClose) onClose();
        onLaunchNow(data);
        return;
      }

      setConfirmedBooking(data);
      if (onBookingSuccess) onBookingSuccess(data, mode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full max-w-[460px] rounded-2xl overflow-hidden bg-[#12132b]/95 border border-cyan-400/35 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_30px_rgba(0,82,255,0.25)] text-white"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3.5 right-3.5 z-20 w-7 h-7 rounded-full bg-black/50 hover:bg-black/75 text-white/80 hover:text-white flex items-center justify-center transition-colors border-0 cursor-pointer backdrop-blur-sm"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>

        {/* Cinematic Game Header */}
        <div className="h-[120px] bg-cover bg-center relative flex items-end" style={{ backgroundImage: `url(${coverUrl})` }}>
          <div className="absolute inset-0 bg-gradient-to-t from-[#12132b] via-[#12132b]/70 to-black/30 p-3.5 md:p-4.5 flex flex-col justify-end">
            <div className="flex gap-1.5 mb-1.5">
              <span className="text-[9px] font-extrabold px-2 py-0.5 rounded bg-white/20 text-white uppercase tracking-wider">{genre}</span>
            </div>
            <h2 className="text-lg md:text-xl font-black text-white m-0 truncate drop-shadow-md">{title}</h2>
          </div>
        </div>

        {/* Confirmation Screen */}
        {confirmedBooking ? (
          <div className="p-8 md:p-10 text-center flex flex-col items-center animate-[fadeIn_0.2s_ease-out]">
            <div className="text-cyan-400 mb-4 flex items-center justify-center">
              {mode === 'instant' ? <PlayIcon size={38} /> : <CheckCircleIcon size={38} />}
            </div>
            <h3 className="text-2xl font-extrabold text-white mb-2 tracking-tight">
              {mode === 'instant' ? 'Ready to Play!' : 'Reservation Confirmed'}
            </h3>
            <p className="text-sm text-indigo-200/80 mb-1.5">
              {mode === 'instant' ? (
                <>Rig ready for <strong className="text-white">{title}</strong></>
              ) : (
                <>Reserved <strong className="text-white">{title}</strong></>
              )}
            </p>
            <p className="text-xs font-bold text-cyan-400 mb-6">
              {mode === 'instant' ? (
                `Session Duration: ${durationMinutes} mins`
              ) : (
                `${new Date(confirmedBooking.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${new Date(confirmedBooking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(confirmedBooking.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              )}
            </p>

            <div className="flex flex-col gap-2.5 w-full max-w-xs mx-auto">
              {mode === 'instant' && onLaunchNow ? (
                <button
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white font-extrabold text-xs tracking-wide py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-[0_8px_24px_rgba(0,82,255,0.45)] hover:-translate-y-0.5 transition-all border-0"
                  onClick={() => {
                    onClose();
                    onLaunchNow(confirmedBooking);
                  }}
                >
                  <PlayIcon size={16} /> Play Now
                </button>
              ) : (
                <button
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white font-extrabold text-xs tracking-wide py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-[0_8px_24px_rgba(0,82,255,0.45)] hover:-translate-y-0.5 transition-all border-0"
                  onClick={onClose}
                >
                  View Bookings
                </button>
              )}
              <button
                className="w-full bg-white/10 hover:bg-white/15 text-white font-semibold text-xs py-2 px-4 rounded-xl cursor-pointer transition-colors border-0"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 md:p-4.5 max-h-[calc(88vh-120px)] overflow-y-auto">
            {/* Centered Mode Selector Tabs */}
            <div className="flex justify-center w-full mb-3">
              <div className="grid grid-cols-2 gap-1 w-full max-w-[250px] bg-white/[0.04] p-1 rounded-full border border-white/[0.08]">
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-3 text-[11px] font-bold rounded-full transition-all cursor-pointer border-0 ${
                    mode === 'instant'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_3px_12px_rgba(0,82,255,0.4)]'
                      : 'bg-transparent text-indigo-200/70 hover:text-white'
                  }`}
                  onClick={() => setMode('instant')}
                >
                  <BoltIcon size={14} /> Play Now
                </button>
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-3 text-[11px] font-bold rounded-full transition-all cursor-pointer border-0 ${
                    mode === 'schedule'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_3px_12px_rgba(0,82,255,0.4)]'
                      : 'bg-transparent text-indigo-200/70 hover:text-white'
                  }`}
                  onClick={() => setMode('schedule')}
                >
                  <CalendarIcon size={14} /> Schedule
                </button>
              </div>
            </div>

            {/* Rig Busy / In-Use Alert Banner */}
            {availability?.is_currently_in_use && availability.current_session && !availability.current_session.is_mine && (
              <div className="flex items-start gap-3 bg-gradient-to-br from-amber-500/15 to-red-500/10 border border-amber-500/40 rounded-xl p-3 mb-3.5 shadow-[0_4px_20px_rgba(255,159,10,0.12)]">
                <div className="text-amber-400 shrink-0 mt-0.5">
                  <ClockIcon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1 text-xs font-extrabold text-amber-400">
                    <span>⚡ Gaming Rig Currently in Use</span>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/20 border border-amber-500/45 text-amber-300 px-2 py-0.5 rounded-full">Occupied</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-white/85 m-0">
                    Another player is actively streaming right now (~{availability.current_session.remaining_minutes} min{availability.current_session.remaining_minutes > 1 ? 's' : ''} left until {formatTimeDisplay(availability.current_session.end_time.substring(11, 16))}). Please choose an available time slot below to reserve your turn.
                  </p>
                </div>
              </div>
            )}

            {error && <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-xs font-medium mb-3">{error}</div>}

            {/* 2-Hour Daily Free Beta Quota Banner */}
            <div className="bg-cyan-400/[0.08] border border-cyan-400/20 rounded-xl px-3 py-2 flex items-center justify-between text-[11px] mb-3 text-white">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                <ClockIcon size={13} />
                <span>Beta Free Quota: 2 Hours / Day</span>
              </div>
              {dailyQuota ? (
                <span className={`font-extrabold ${dailyQuota.remaining_minutes > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {dailyQuota.remaining_minutes} mins left
                </span>
              ) : !user ? (
                <span className="text-slate-400 text-[10.5px]">
                  Sign in required
                </span>
              ) : null}
            </div>

            <form onSubmit={handleBookSession} className="flex flex-col gap-3">
              {mode === 'instant' ? (
                <div>
                  <div className="flex flex-col gap-1">
                    <label className="block text-[10px] font-extrabold tracking-wider text-indigo-200/70 uppercase mb-1.5">Session Duration</label>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {durationOptions.map((item) => {
                        const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={`p-2 rounded-lg text-center cursor-pointer transition-all flex flex-col items-center border ${
                              durationMinutes === item.value
                                ? 'bg-blue-600/25 border-cyan-400 shadow-[0_0_14px_rgba(0,210,255,0.3)] text-cyan-300 font-bold'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-cyan-400/30 text-white'
                            } ${isExceeded ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                            onClick={() => !isExceeded && setDurationMinutes(item.value)}
                            disabled={submitting || isExceeded}
                            title={isExceeded ? `Exceeds 2-hour daily quota (${dailyQuota.remaining_minutes} mins left)` : ''}
                          >
                            <span className="text-[11px] font-extrabold">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {/* Quick Date Selector (3 clean columns) */}
                  <div className="flex flex-col gap-1">
                    <label className="block text-[10px] font-extrabold tracking-wider text-indigo-200/70 uppercase mb-1.5">Date</label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {quickDates.map((q) => (
                        <button
                          key={q.dateStr}
                          type="button"
                          className={`min-h-[48px] p-1.5 rounded-lg text-center cursor-pointer transition-all flex flex-col items-center justify-center border ${
                            scheduleDate === q.dateStr && !showCalendarDrawer
                              ? 'bg-blue-600/25 border-cyan-400 shadow-[0_0_12px_rgba(0,210,255,0.3)] text-cyan-300'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-cyan-400/35 text-white'
                          }`}
                          onClick={() => {
                            handleSelectDate(q.dateStr);
                            setShowCalendarDrawer(false);
                          }}
                          disabled={submitting}
                        >
                          <span className="text-[11px] font-extrabold">{q.label}</span>
                          <span className="text-[9px] text-indigo-200/60 mt-0.5">{q.sub}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`min-h-[48px] p-1.5 rounded-lg text-center cursor-pointer transition-all flex flex-col items-center justify-center border ${
                          isOtherDate || showCalendarDrawer
                            ? 'bg-blue-600/25 border-cyan-400 shadow-[0_0_12px_rgba(0,210,255,0.3)] text-cyan-300'
                            : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-cyan-400/35 text-white'
                        }`}
                        title="Pick custom date"
                        onClick={handleToggleCalendar}
                        disabled={submitting}
                      >
                        <span className="text-[11px] font-extrabold">
                          {isOtherDate ? formatCustomDateLabel(scheduleDate) : 'Pick Date'}
                        </span>
                        <span className="text-[9px] text-indigo-200/60 mt-0.5 flex items-center gap-1">
                          <CalendarIcon size={11} /> {isOtherDate ? getCustomWeekday(scheduleDate) : showCalendarDrawer ? 'Close' : 'Calendar'}
                        </span>
                      </button>
                    </div>

                    {/* Inline Twilight Mini-Calendar Drawer */}
                    {showCalendarDrawer && (
                      <div className="bg-[#10132b] border border-cyan-400/30 rounded-xl p-2.5 mb-3 shadow-[0_8px_24px_rgba(0,0,0,0.6),0_0_16px_rgba(0,82,255,0.2)] animate-[fadeIn_0.15s_ease-out]">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <button
                            type="button"
                            className="w-6 h-6 rounded bg-white/5 hover:bg-cyan-400/20 border border-white/10 hover:border-cyan-400 text-white hover:text-cyan-300 flex items-center justify-center cursor-pointer transition-colors text-sm disabled:opacity-25 disabled:cursor-not-allowed"
                            onClick={handlePrevMonth}
                            disabled={viewYear === now.getFullYear() && viewMonth <= now.getMonth()}
                            title="Previous Month"
                          >
                            ‹
                          </button>
                          <span className="text-xs font-extrabold text-white tracking-wide">
                            {new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            className="w-6 h-6 rounded bg-white/5 hover:bg-cyan-400/20 border border-white/10 hover:border-cyan-400 text-white hover:text-cyan-300 flex items-center justify-center cursor-pointer transition-colors text-sm disabled:opacity-25 disabled:cursor-not-allowed"
                            onClick={handleNextMonth}
                            title="Next Month"
                          >
                            ›
                          </button>
                        </div>

                        <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
                            <span key={w} className="text-[9px] font-extrabold text-indigo-200/60 uppercase">{w}</span>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {getCalendarDays().map((cell, idx) => {
                            if (!cell.isCurrentMonth) {
                              return <span key={`pad-${idx}`} className="aspect-square" />;
                            }
                            return (
                              <button
                                key={cell.dateStr}
                                type="button"
                                className={`aspect-square flex items-center justify-center rounded text-[11px] font-bold cursor-pointer transition-colors p-0 border border-transparent ${
                                  cell.isSelected
                                    ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white font-extrabold shadow-[0_2px_10px_rgba(0,82,255,0.45)]'
                                    : cell.isToday
                                    ? 'border-cyan-400/50 text-cyan-300 bg-white/5'
                                    : 'bg-white/[0.04] hover:bg-cyan-400/20 hover:text-cyan-300 text-white'
                                } ${cell.isPast ? 'opacity-20 cursor-not-allowed line-through hover:bg-transparent hover:text-white' : ''}`}
                                onClick={() => handleDaySelect(cell.dateStr)}
                                disabled={cell.isPast || submitting}
                              >
                                {cell.day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Time Slots Selector with Periods */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] font-extrabold tracking-wider text-indigo-200/70 uppercase mb-0">Start Time</label>
                      <div className="flex items-center gap-2">
                        <span className="bg-cyan-400/10 border border-cyan-400/35 text-cyan-300 text-[11px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ClockIcon size={12} /> {formatTimeDisplay(scheduleTime)}
                        </span>
                        <button
                          type="button"
                          className="bg-transparent border-0 text-indigo-200/70 hover:text-cyan-300 text-[10px] font-bold underline cursor-pointer p-0 transition-colors"
                          onClick={() => setShowCustomTime(!showCustomTime)}
                        >
                          {showCustomTime ? 'Quick Slots' : 'Custom'}
                        </button>
                      </div>
                    </div>

                    {showCustomTime ? (
                      <div className="mb-3">
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => {
                            setScheduleTime(e.target.value);
                            const h = parseInt(e.target.value.split(':')[0], 10);
                            if (!isNaN(h)) setActivePeriod(getPeriodForHour(h));
                          }}
                          required
                          disabled={submitting}
                          className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2 px-3 rounded-lg text-white text-xs outline-none transition-all"
                        />
                      </div>
                    ) : (
                      <div>
                        {/* Period Filter Tabs (Morning / Afternoon / Evening) */}
                        <div className="grid grid-cols-3 gap-1.5 bg-white/[0.03] p-1 rounded-lg mb-2 border border-white/[0.06]">
                          {timePeriods.map((p) => {
                            const isAllPast = scheduleDate === todayStr && p.hours[p.hours.length - 1] <= currentHour;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`py-1 px-1 rounded-md text-[10px] font-bold text-center cursor-pointer transition-colors border ${
                                  activePeriod === p.id
                                    ? 'bg-blue-600/25 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(0,210,255,0.2)]'
                                    : 'bg-transparent border-transparent text-indigo-200/70 hover:text-white hover:bg-white/[0.06]'
                                } ${isAllPast ? 'opacity-30 cursor-not-allowed' : ''}`}
                                onClick={() => handleSelectPeriod(p.id)}
                                disabled={isAllPast || submitting}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Filtered Slots for the selected period */}
                        <div className="grid grid-cols-4 gap-1.5 mb-3 max-h-[140px] overflow-y-auto pr-0.5">
                          {timeSlots
                            .filter((slot) => {
                              const p = timePeriods.find((tp) => tp.id === activePeriod);
                              return p ? p.hours.includes(slot.hour) : true;
                            })
                            .map((slot) => {
                              const isSelected = scheduleTime === slot.timeStr;
                              const isDisabled = slot.isPast || (slot.isBooked && !slot.isMyBooking);

                              return (
                                <button
                                  key={slot.timeStr}
                                  type="button"
                                  className={`min-h-[46px] p-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all border ${
                                    isSelected
                                      ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_rgba(0,82,255,0.45)] border-cyan-400'
                                      : isDisabled
                                      ? 'bg-white/[0.02] border-white/[0.04] opacity-35 cursor-not-allowed'
                                      : 'bg-white/[0.04] hover:bg-emerald-500/10 border-emerald-500/25 hover:border-emerald-400 text-white'
                                  }`}
                                  onClick={() => !isDisabled && handleSelectSlot(slot.timeStr, slot.hour)}
                                  disabled={isDisabled || submitting}
                                  title={
                                    slot.isPast
                                      ? 'Past time slot'
                                      : slot.isMyBooking
                                      ? 'You already booked this slot'
                                      : slot.isBooked
                                      ? 'Slot occupied by another player'
                                      : 'Available slot'
                                  }
                                >
                                  <span className="text-[11px] font-bold whitespace-nowrap">{slot.label}</span>
                                  <span className={`text-[8.5px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider ${
                                    slot.isPast
                                      ? 'bg-white/[0.06] text-slate-400 border border-white/[0.08]'
                                      : slot.isMyBooking
                                      ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                                      : slot.isBooked
                                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  }`}>
                                    {slot.isPast ? 'Past' : slot.isMyBooking ? 'Yours' : slot.isBooked ? 'Booked' : 'Open'}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="block text-[10px] font-extrabold tracking-wider text-indigo-200/70 uppercase mb-1.5">Session Duration</label>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {durationOptions.map((item) => {
                        const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={`p-2 rounded-lg text-center cursor-pointer transition-all flex flex-col items-center border ${
                              durationMinutes === item.value
                                ? 'bg-blue-600/25 border-cyan-400 shadow-[0_0_14px_rgba(0,210,255,0.3)] text-cyan-300 font-bold'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-cyan-400/30 text-white'
                            } ${isExceeded ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                            onClick={() => !isExceeded && setDurationMinutes(item.value)}
                            disabled={submitting || isExceeded}
                            title={isExceeded ? `Exceeds 2-hour daily quota (${dailyQuota.remaining_minutes} mins left)` : ''}
                          >
                            <span className="text-[11px] font-extrabold">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Centered Compact Action Button */}
              <div className="flex justify-center w-full mt-3.5">
                <button
                  type="submit"
                  className="w-auto min-w-[170px] max-w-[230px] bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-xs font-extrabold tracking-wide py-2.5 px-5 rounded-full border-0 cursor-pointer shadow-[0_4px_16px_rgba(0,82,255,0.35)] hover:shadow-[0_8px_22px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all inline-flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
                  disabled={submitting}
                >
                  {submitting ? (
                    mode === 'instant' ? 'Connecting to Rig...' : 'Reserving Slot...'
                  ) : !user ? (
                    <>
                      <UserIcon size={14} /> {mode === 'instant' ? 'Sign In to Play' : 'Sign In to Reserve'}
                    </>
                  ) : mode === 'instant' ? (
                    <>
                      <PlayIcon size={14} /> Play Now
                    </>
                  ) : (
                    <>
                      <CalendarIcon size={14} /> Confirm Reservation
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

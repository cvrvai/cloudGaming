import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE, formatRigName } from '../config';
import { XIcon } from './Icons';

export default function BookingModal({ game, machine, onClose, onBookingSuccess, onLaunchNow }) {
  const { token, user, openAuth } = useAuth();

  // Compute upfront if this rig/game is definitely not free to play right now
  const initiallyOccupied = useMemo(() => {
    if (machine && (machine.status !== 'available' || machine.live_status === 'streaming')) return true;
    if (game && (game.is_online === false || (game.ready_nodes_count !== undefined && game.ready_nodes_count === 0))) return true;
    return false;
  }, [machine, game]);

  // Mode: 'instant' or 'schedule'
  const [mode, setMode] = useState(() => (initiallyOccupied ? 'schedule' : 'instant'));
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
    { label: '30m', value: 30 },
    { label: '1h', value: 60 },
    { label: '2h (Max)', value: 120 },
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

          // If rig is currently in use by another user right now or no free computer, switch to schedule mode
          const hasOtherPlayer = !!(data.current_session && !data.current_session.is_mine);
          const hasExplicitFreeRig = data.can_play_now === true && data.free_machines_count && data.free_machines_count > 0;
          const noFreeRig =
            data.can_play_now === false ||
            data.free_machines_count === 0 ||
            data.capable_machines_count === 0 ||
            (data.is_currently_in_use && (!data.current_session || !data.current_session.is_mine)) ||
            (hasOtherPlayer && !hasExplicitFreeRig);

          if (noFreeRig) {
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

  const isNoFreeComputer = useMemo(() => {
    // 1. Machine prop check
    if (machine && (machine.status !== 'available' || machine.live_status === 'streaming')) {
      return true;
    }
    // 2. Offline game check
    if (game && (game.is_online === false || (game.ready_nodes_count !== undefined && game.ready_nodes_count === 0))) {
      return true;
    }
    if (!availability) return initiallyOccupied;

    // 3. Explicit backend indicators
    if (availability.can_play_now === false) return true;
    if (availability.free_machines_count === 0) return true;
    if (availability.capable_machines_count === 0) return true;
    if (availability.is_currently_in_use && (!availability.current_session || !availability.current_session.is_mine)) return true;

    // 4. Another player is currently streaming / playing right now
    if (availability.current_session && !availability.current_session.is_mine) {
      if (availability.can_play_now === true && availability.free_machines_count && availability.free_machines_count > 0) {
        return false;
      }
      return true;
    }

    return false;
  }, [availability, machine, game, initiallyOccupied]);

  // Ensure modal auto-switches to schedule if availability indicates no free rig
  useEffect(() => {
    if (isNoFreeComputer && mode === 'instant') {
      setMode('schedule');
    }
  }, [isNoFreeComputer, mode]);

  // Hourly slots from 08:00 AM to 11:00 PM with real-time availability
  const timeSlots = useMemo(() => {
    const slots = [];
    const bookings = availability?.bookings || [];
    const effectiveCapacity = Math.max(
      1,
      game?.ready_nodes_count != null
        ? game.ready_nodes_count
        : availability?.free_machines_count != null
        ? Math.max(1, (availability.free_machines_count || 0) + (availability.current_session ? 1 : 0))
        : (availability?.capable_machines_count || 1)
    );

    for (let h = 8; h <= 23; h++) {
      const timeStr = `${String(h).padStart(2, '0')}:00`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const label = `${displayH}:00 ${ampm}`;
      const isPast = scheduleDate === todayStr && h <= currentHour;

      let isBooked = false;
      let isMyBooking = false;

      if (!isPast) {
        const slotStartMs = new Date(`${scheduleDate}T${String(h).padStart(2, '0')}:00:00`).getTime();
        const durationMs = durationMinutes * 60 * 1000;
        const slotEndMs = slotStartMs + durationMs;

        // If today, check against active streaming session
        if (scheduleDate === todayStr && availability?.current_session) {
          const s = availability.current_session;
          if (s.start_time && s.end_time) {
            const sStart = new Date(s.start_time).getTime();
            const sEnd = new Date(s.end_time).getTime();
            if (sStart < slotEndMs && sEnd > slotStartMs) {
              if (s.is_mine) {
                isMyBooking = true;
              } else if (effectiveCapacity <= 1) {
                isBooked = true;
              }
            }
          }
        }

        if (bookings.length > 0) {
          const overlaps = bookings.filter((b) => {
            const bStart = new Date(b.start_time).getTime();
            const bEnd = new Date(b.end_time).getTime();
            return bStart < slotEndMs && bEnd > slotStartMs;
          });

          if (overlaps.length >= effectiveCapacity) {
            isBooked = true;
          }
          if (overlaps.some((b) => b.is_mine)) {
            isMyBooking = true;
          }
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
  }, [scheduleDate, todayStr, currentHour, durationMinutes, availability, game?.ready_nodes_count]);

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
      if (mode === 'instant' && isNoFreeComputer) {
        setMode('schedule');
        setError('All gaming computers for this game are currently in use. Please select a reservation time slot below to schedule your turn.');
        setSubmitting(false);
        return;
      }

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
      className="fixed inset-0 z-[2000] flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full max-w-[390px] rounded-xl overflow-hidden bg-[#0d1020] border border-white/10 shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-2.5 right-2.5 z-20 w-6 h-6 rounded-full bg-black/40 hover:bg-black/70 text-slate-300 hover:text-white flex items-center justify-center transition-colors border-0 cursor-pointer"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon size={14} />
        </button>

        {/* Compact Game Header */}
        <div className="relative h-20 bg-cover bg-center flex items-end" style={{ backgroundImage: `url(${coverUrl})` }}>
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d1020] via-[#0d1020]/75 to-black/40 p-3 flex items-end">
            <div className="min-w-0 pr-6">
              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider block mb-0.5">{genre}</span>
              <h2 className="text-base font-bold text-white m-0 truncate leading-tight">{title}</h2>
            </div>
          </div>
        </div>

        {/* Confirmation Screen */}
        {confirmedBooking ? (
          <div className="p-6 text-center flex flex-col items-center">
            <h3 className="text-base font-bold text-white mb-1">
              {mode === 'instant' ? 'Ready to Play' : 'Reservation Confirmed'}
            </h3>
            <p className="text-xs text-slate-400 mb-1">
              {mode === 'instant' ? (
                <>Rig ready for <span className="text-white font-medium">{title}</span></>
              ) : (
                <>Reserved <span className="text-white font-medium">{title}</span></>
              )}
            </p>
            <p className="text-xs font-semibold text-blue-400 mb-4">
              {mode === 'instant' ? (
                `${durationMinutes} mins session`
              ) : (
                `${new Date(confirmedBooking.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${new Date(confirmedBooking.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(confirmedBooking.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              )}
            </p>

            <div className="flex flex-col gap-2 w-full max-w-[200px] mx-auto">
              {mode === 'instant' && onLaunchNow ? (
                <button
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs py-2 px-4 rounded-lg cursor-pointer transition-all border-0"
                  onClick={() => {
                    onClose();
                    onLaunchNow(confirmedBooking);
                  }}
                >
                  Play Now
                </button>
              ) : (
                <button
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs py-2 px-4 rounded-lg cursor-pointer transition-all border-0"
                  onClick={onClose}
                >
                  View Bookings
                </button>
              )}
              <button
                className="w-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs py-1.5 px-3 rounded-lg cursor-pointer transition-colors border-0"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 max-h-[calc(90vh-90px)] overflow-y-auto">
            {/* Mode Selector */}
            <div className="flex justify-center mb-2.5">
              <div className="grid grid-cols-2 gap-1 w-full max-w-[240px] bg-white/[0.05] p-0.5 rounded-lg border border-white/10 text-xs">
                <button
                  type="button"
                  disabled={isNoFreeComputer}
                  className={`py-1 px-2.5 text-[11px] font-medium rounded-md transition-all border-0 ${
                    isNoFreeComputer
                      ? 'text-slate-500 cursor-not-allowed opacity-50'
                      : mode === 'instant'
                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.04] cursor-pointer'
                  }`}
                  onClick={() => {
                    if (isNoFreeComputer) return;
                    setMode('instant');
                  }}
                >
                  Play Now {isNoFreeComputer && <span className="text-[9px] opacity-75">(Busy)</span>}
                </button>
                <button
                  type="button"
                  className={`py-1 px-2.5 text-[11px] font-medium rounded-md transition-all border-0 cursor-pointer ${
                    mode === 'schedule'
                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
                  }`}
                  onClick={() => setMode('schedule')}
                >
                  Schedule
                </button>
              </div>
            </div>

            {/* In-Use Alert Banner (Compact, icon-free) */}
            {isNoFreeComputer && (
              <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5 mb-2 text-[11px] text-amber-200/90 flex items-center justify-between">
                <span className="truncate">
                  Rig in use{availability?.current_session?.remaining_minutes ? ` (~${availability.current_session.remaining_minutes}m left)` : ''} &bull; Switched to schedule
                </span>
                {availability?.current_session?.end_time && (
                  <span className="text-[10px] text-amber-300/80 font-medium shrink-0 ml-2">
                    until {new Date(availability.current_session.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}

            {error && <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-2.5 py-1.5 rounded-lg text-xs font-medium mb-2">{error}</div>}

            {/* Daily Quota Indicator (Clean, subtle metadata line) */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2 px-0.5">
              <span>Daily Quota (2h limit)</span>
              <span className={dailyQuota && dailyQuota.remaining_minutes > 0 ? 'text-slate-300 font-medium' : 'text-red-400'}>
                {dailyQuota ? `${dailyQuota.remaining_minutes}m left` : !user ? 'Sign in to reserve' : '2h / day'}
              </span>
            </div>

            <form onSubmit={handleBookSession} className="flex flex-col gap-2">
              {mode === 'instant' ? (
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Duration</div>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {durationOptions.map((item) => {
                      const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          className={`h-7 px-2 rounded-md text-xs font-medium text-center transition-all border cursor-pointer ${
                            durationMinutes === item.value
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-semibold'
                              : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
                          } ${isExceeded ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          onClick={() => !isExceeded && setDurationMinutes(item.value)}
                          disabled={submitting || isExceeded}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  {/* Date Selector */}
                  <div className="mb-2">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Date</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {quickDates.map((q) => (
                        <button
                          key={q.dateStr}
                          type="button"
                          className={`py-1.5 px-2 rounded-md text-center transition-all border text-xs cursor-pointer ${
                            scheduleDate === q.dateStr && !showCalendarDrawer
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-semibold'
                              : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
                          }`}
                          onClick={() => {
                            handleSelectDate(q.dateStr);
                            setShowCalendarDrawer(false);
                          }}
                          disabled={submitting}
                        >
                          <div className="font-semibold text-[11px]">{q.label}</div>
                          <div className="text-[9px] text-slate-400">{q.sub}</div>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`py-1.5 px-2 rounded-md text-center transition-all border text-xs cursor-pointer ${
                          isOtherDate || showCalendarDrawer
                            ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-semibold'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
                        }`}
                        onClick={handleToggleCalendar}
                        disabled={submitting}
                      >
                        <div className="font-semibold text-[11px]">
                          {isOtherDate ? formatCustomDateLabel(scheduleDate) : 'Calendar'}
                        </div>
                        <div className="text-[9px] text-slate-400">
                          {isOtherDate ? getCustomWeekday(scheduleDate) : showCalendarDrawer ? 'Close' : 'Pick Date'}
                        </div>
                      </button>
                    </div>

                    {/* Inline Calendar Drawer */}
                    {showCalendarDrawer && (
                      <div className="bg-[#0e1222] border border-white/10 rounded-lg p-2 mt-1.5 mb-1.5">
                        <div className="flex items-center justify-between mb-1.5 px-1">
                          <button
                            type="button"
                            className="w-5 h-5 rounded bg-white/5 hover:bg-white/15 text-white flex items-center justify-center cursor-pointer text-xs border-0 disabled:opacity-25"
                            onClick={handlePrevMonth}
                            disabled={viewYear === now.getFullYear() && viewMonth <= now.getMonth()}
                          >
                            ‹
                          </button>
                          <span className="text-[11px] font-semibold text-white">
                            {new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            className="w-5 h-5 rounded bg-white/5 hover:bg-white/15 text-white flex items-center justify-center cursor-pointer text-xs border-0 disabled:opacity-25"
                            onClick={handleNextMonth}
                          >
                            ›
                          </button>
                        </div>

                        <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
                            <span key={w} className="text-[8.5px] font-semibold text-slate-400">{w}</span>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-0.5">
                          {getCalendarDays().map((cell, idx) => {
                            if (!cell.isCurrentMonth) {
                              return <span key={`pad-${idx}`} className="aspect-square" />;
                            }
                            return (
                              <button
                                key={cell.dateStr}
                                type="button"
                                className={`aspect-square flex items-center justify-center rounded text-[10px] font-medium cursor-pointer p-0 border-0 ${
                                  cell.isSelected
                                    ? 'bg-blue-600 text-white font-bold'
                                    : cell.isToday
                                    ? 'bg-white/10 text-white font-semibold'
                                    : 'hover:bg-white/10 text-slate-300'
                                } ${cell.isPast ? 'opacity-20 cursor-not-allowed line-through hover:bg-transparent' : ''}`}
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

                  {/* Start Time Section */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Start Time</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">
                          {formatTimeDisplay(scheduleTime)}
                        </span>
                        <button
                          type="button"
                          className="bg-transparent border-0 text-slate-400 hover:text-white text-[10px] cursor-pointer p-0 underline"
                          onClick={() => setShowCustomTime(!showCustomTime)}
                        >
                          {showCustomTime ? 'Presets' : 'Custom'}
                        </button>
                      </div>
                    </div>

                    {showCustomTime ? (
                      <div className="mb-2">
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
                          className="w-full bg-white/5 border border-white/10 py-1.5 px-2.5 rounded-md text-white text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                    ) : (
                      <div>
                        {/* Period Filter Tabs */}
                        <div className="grid grid-cols-3 gap-1 bg-white/[0.03] p-0.5 rounded-md mb-1.5 border border-white/[0.06]">
                          {timePeriods.map((p) => {
                            const isAllPast = scheduleDate === todayStr && p.hours[p.hours.length - 1] <= currentHour;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`py-0.5 text-[10px] font-medium rounded transition-colors border-0 cursor-pointer ${
                                  activePeriod === p.id
                                    ? 'bg-white/15 text-white font-semibold'
                                    : 'text-slate-400 hover:text-white bg-transparent'
                                } ${isAllPast ? 'opacity-30 cursor-not-allowed' : ''}`}
                                onClick={() => handleSelectPeriod(p.id)}
                                disabled={isAllPast || submitting}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Slots */}
                        <div className="grid grid-cols-4 gap-1 mb-2 max-h-[110px] overflow-y-auto pr-0.5">
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
                                  className={`h-7 px-1.5 rounded text-[11px] font-medium transition-all border flex items-center justify-center ${
                                    isSelected
                                      ? 'bg-blue-600 text-white border-blue-500 font-semibold shadow-sm'
                                      : isDisabled
                                      ? 'bg-white/[0.02] border-white/[0.04] text-slate-500 opacity-40 cursor-not-allowed line-through'
                                      : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-200 hover:text-white cursor-pointer'
                                  }`}
                                  onClick={() => !isDisabled && handleSelectSlot(slot.timeStr, slot.hour)}
                                  disabled={isDisabled || submitting}
                                  title={
                                    slot.isPast
                                      ? 'Past'
                                      : slot.isMyBooking
                                      ? 'Your reservation'
                                      : slot.isBooked
                                      ? 'Booked'
                                      : 'Available'
                                  }
                                >
                                  {slot.label}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="mb-2">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Duration</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {durationOptions.map((item) => {
                        const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={`h-7 px-2 rounded-md text-xs font-medium text-center transition-all border cursor-pointer ${
                              durationMinutes === item.value
                                ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-semibold'
                                : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
                            } ${isExceeded ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                            onClick={() => !isExceeded && setDurationMinutes(item.value)}
                            disabled={submitting || isExceeded}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="mt-2">
                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 px-4 rounded-lg border-0 cursor-pointer shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={submitting}
                >
                  {submitting
                    ? mode === 'instant'
                      ? 'Connecting...'
                      : 'Reserving...'
                    : !user
                    ? mode === 'instant'
                      ? 'Sign In to Play'
                      : 'Sign In to Reserve'
                    : mode === 'instant'
                    ? 'Play Now'
                    : 'Confirm Reservation'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

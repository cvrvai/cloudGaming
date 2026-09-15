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
        const slotStartIso = `${scheduleDate}T${String(h).padStart(2, '0')}:00:00`;
        const slotEndHour = h + Math.max(1, Math.ceil(durationMinutes / 60));
        const slotEndIso = `${scheduleDate}T${String(Math.min(23, slotEndHour)).padStart(2, '0')}:59:59`;

        const overlaps = bookings.filter((b) => {
          return b.start_time < slotEndIso && b.end_time > slotStartIso;
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog glass-panel geforce-booking-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          <XIcon size={16} />
        </button>

        {/* Cinematic Game Header */}
        <div className="modal-game-hero" style={{ backgroundImage: `url(${coverUrl})` }}>
          <div className="modal-game-hero-overlay">
            <div className="modal-hero-tags">
              <span className="hero-tag-pill genre-pill">{genre}</span>
            </div>
            <h2 className="modal-game-title">{title}</h2>
          </div>
        </div>

        {/* Confirmation Screen */}
        {confirmedBooking ? (
          <div className="modal-success-screen">
            <div className="success-icon-badge">
              {mode === 'instant' ? <PlayIcon size={38} /> : <CheckCircleIcon size={38} />}
            </div>
            <h3>{mode === 'instant' ? 'Ready to Play!' : 'Reservation Confirmed'}</h3>
            <p className="success-slot-text">
              {mode === 'instant' ? (
                <>Rig ready for <strong>{title}</strong></>
              ) : (
                <>Reserved <strong>{title}</strong></>
              )}
            </p>
            <p className="success-time-text">
              {mode === 'instant' ? (
                `Session Duration: ${durationMinutes} mins`
              ) : (
                `${new Date(confirmedBooking.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${new Date(confirmedBooking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(confirmedBooking.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              )}
            </p>

            <div className="success-modal-actions">
              {mode === 'instant' && onLaunchNow ? (
                <button
                  className="btn-primary btn-launch-now"
                  onClick={() => {
                    onClose();
                    onLaunchNow(confirmedBooking);
                  }}
                >
                  <PlayIcon size={16} /> Play Now
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={onClose}
                >
                  View Bookings
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="booking-modal-body">
            {/* Centered Mode Selector Tabs */}
            <div className="booking-mode-tabs-wrapper">
              <div className="booking-mode-tabs">
                <button
                  type="button"
                  className={`booking-tab ${mode === 'instant' ? 'active' : ''}`}
                  onClick={() => setMode('instant')}
                >
                  <BoltIcon size={14} /> Play Now
                </button>
                <button
                  type="button"
                  className={`booking-tab ${mode === 'schedule' ? 'active' : ''}`}
                  onClick={() => setMode('schedule')}
                >
                  <CalendarIcon size={14} /> Schedule
                </button>
              </div>
            </div>

            {/* Rig Busy / In-Use Alert Banner */}
            {availability?.is_currently_in_use && availability.current_session && !availability.current_session.is_mine && (
              <div className="rig-busy-banner">
                <div className="rig-busy-icon">
                  <ClockIcon size={18} />
                </div>
                <div className="rig-busy-info">
                  <div className="rig-busy-title">
                    <span>⚡ Gaming Rig Currently in Use</span>
                    <span className="rig-busy-badge">Occupied</span>
                  </div>
                  <p className="rig-busy-desc">
                    Another player is actively streaming right now (~{availability.current_session.remaining_minutes} min{availability.current_session.remaining_minutes > 1 ? 's' : ''} left until {formatTimeDisplay(availability.current_session.end_time.substring(11, 16))}). Please choose an available time slot below to reserve your turn.
                  </p>
                </div>
              </div>
            )}

            {error && <div className="booking-error-banner">{error}</div>}

            {/* 2-Hour Daily Free Beta Quota Banner */}
            <div
              style={{
                background: 'rgba(0, 210, 255, 0.08)',
                border: '1px solid rgba(0, 210, 255, 0.22)',
                borderRadius: '10px',
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#00d2ff', fontWeight: 700 }}>
                <ClockIcon size={13} />
                <span>Beta Free Quota: 2 Hours / Day</span>
              </div>
              {dailyQuota ? (
                <span style={{ color: dailyQuota.remaining_minutes > 0 ? '#4ade80' : '#ff5b52', fontWeight: 800 }}>
                  {dailyQuota.remaining_minutes} mins left
                </span>
              ) : !user ? (
                <span style={{ color: '#94a3b8', fontSize: '10.5px' }}>
                  Sign in required
                </span>
              ) : null}
            </div>

            <form onSubmit={handleBookSession} className="booking-modal-form">
              {mode === 'instant' ? (
                <div className="instant-mode-panel">
                  <div className="form-group">
                    <label className="form-label-caps">Session Duration</label>
                    <div className="duration-grid">
                      {durationOptions.map((item) => {
                        const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={`duration-card ${durationMinutes === item.value ? 'selected' : ''} ${isExceeded ? 'disabled' : ''}`}
                            onClick={() => !isExceeded && setDurationMinutes(item.value)}
                            disabled={submitting || isExceeded}
                            title={isExceeded ? `Exceeds 2-hour daily quota (${dailyQuota.remaining_minutes} mins left)` : ''}
                          >
                            <span className="duration-label">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="schedule-mode-panel">
                  {/* Quick Date Selector (3 clean columns) */}
                  <div className="form-group">
                    <label className="form-label-caps">Date</label>
                    <div className="date-quick-chips">
                      {quickDates.map((q) => (
                        <button
                          key={q.dateStr}
                          type="button"
                          className={`date-chip ${scheduleDate === q.dateStr && !showCalendarDrawer ? 'selected' : ''}`}
                          onClick={() => {
                            handleSelectDate(q.dateStr);
                            setShowCalendarDrawer(false);
                          }}
                          disabled={submitting}
                        >
                          <span className="date-chip-label">{q.label}</span>
                          <span className="date-chip-sub">{q.sub}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`date-chip custom-date-chip ${isOtherDate || showCalendarDrawer ? 'selected' : ''}`}
                        title="Pick custom date"
                        onClick={handleToggleCalendar}
                        disabled={submitting}
                      >
                        <span className="date-chip-label">
                          {isOtherDate ? formatCustomDateLabel(scheduleDate) : 'Pick Date'}
                        </span>
                        <span className="date-chip-sub">
                          <CalendarIcon size={11} /> {isOtherDate ? getCustomWeekday(scheduleDate) : showCalendarDrawer ? 'Close' : 'Calendar'}
                        </span>
                      </button>
                    </div>

                    {/* Inline Twilight Mini-Calendar Drawer */}
                    {showCalendarDrawer && (
                      <div className="inline-calendar-drawer">
                        <div className="cal-header">
                          <button
                            type="button"
                            className="cal-nav-btn"
                            onClick={handlePrevMonth}
                            disabled={viewYear === now.getFullYear() && viewMonth <= now.getMonth()}
                            title="Previous Month"
                          >
                            ‹
                          </button>
                          <span className="cal-month-title">
                            {new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            className="cal-nav-btn"
                            onClick={handleNextMonth}
                            title="Next Month"
                          >
                            ›
                          </button>
                        </div>

                        <div className="cal-weekdays-row">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
                            <span key={w} className="cal-weekday-cell">{w}</span>
                          ))}
                        </div>

                        <div className="cal-days-grid">
                          {getCalendarDays().map((cell, idx) => {
                            if (!cell.isCurrentMonth) {
                              return <span key={`pad-${idx}`} className="cal-day-cell cal-empty" />;
                            }
                            return (
                              <button
                                key={cell.dateStr}
                                type="button"
                                className={`cal-day-cell ${cell.isSelected ? 'selected' : ''} ${cell.isToday ? 'today' : ''} ${cell.isPast ? 'disabled' : ''}`}
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
                  <div className="form-group">
                    <div className="time-picker-header">
                      <label className="form-label-caps">Start Time</label>
                      <div className="time-picker-meta">
                        <span className="time-selected-pill">
                          <ClockIcon size={12} /> {formatTimeDisplay(scheduleTime)}
                        </span>
                        <button
                          type="button"
                          className="btn-toggle-custom-time"
                          onClick={() => setShowCustomTime(!showCustomTime)}
                        >
                          {showCustomTime ? 'Quick Slots' : 'Custom'}
                        </button>
                      </div>
                    </div>

                    {showCustomTime ? (
                      <div className="custom-time-wrapper">
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
                          className="geforce-input"
                        />
                      </div>
                    ) : (
                      <div className="time-slots-wrapper">
                        {/* Period Filter Tabs (Morning / Afternoon / Evening) */}
                        <div className="time-period-tabs">
                          {timePeriods.map((p) => {
                            const isAllPast = scheduleDate === todayStr && p.hours[p.hours.length - 1] <= currentHour;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`time-period-tab ${activePeriod === p.id ? 'active' : ''} ${isAllPast ? 'disabled' : ''}`}
                                onClick={() => handleSelectPeriod(p.id)}
                                disabled={isAllPast || submitting}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Filtered Slots for the selected period */}
                        <div className="time-slots-grid period-slots-grid">
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
                                  className={`time-slot-btn ${isSelected ? 'selected' : ''} ${slot.isPast ? 'disabled' : ''} ${slot.isBooked ? 'is-booked' : slot.isAvailable ? 'is-available' : ''} ${slot.isMyBooking ? 'is-mine' : ''}`}
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
                                  <span className="slot-time-text">{slot.label}</span>
                                  <span className={`slot-status-pill ${slot.isPast ? 'past' : slot.isMyBooking ? 'mine' : slot.isBooked ? 'booked' : 'open'}`}>
                                    {slot.isPast ? 'Past' : slot.isMyBooking ? 'Yours' : slot.isBooked ? 'Booked' : 'Open'}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label-caps">Session Duration</label>
                    <div className="duration-grid">
                      {durationOptions.map((item) => {
                        const isExceeded = dailyQuota && !dailyQuota.is_admin && item.value > dailyQuota.remaining_minutes;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className={`duration-card ${durationMinutes === item.value ? 'selected' : ''} ${isExceeded ? 'disabled' : ''}`}
                            onClick={() => !isExceeded && setDurationMinutes(item.value)}
                            disabled={submitting || isExceeded}
                            title={isExceeded ? `Exceeds 2-hour daily quota (${dailyQuota.remaining_minutes} mins left)` : ''}
                          >
                            <span className="duration-label">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Centered Compact Action Button */}
              <div className="booking-confirm-wrapper">
                <button
                  type="submit"
                  className="btn-geforce-confirm"
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

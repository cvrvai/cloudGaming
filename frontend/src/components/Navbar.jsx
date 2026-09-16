import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { GamepadIcon, CalendarIcon, SettingsIcon, SearchIcon, UserIcon, XIcon } from './Icons';

export default function Navbar({
  activeTab,
  onTabChange,
  activeBookingsCount = 0,
  searchQuery = '',
  onSearchChange,
}) {
  const { user, token, logout, openAuth } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dailyQuota, setDailyQuota] = useState(null);
  const userMenuRef = useRef(null);

  // Poll remaining 2-hour daily quota for non-admin players
  useEffect(() => {
    if (!token || !user || user.role === 'admin') return;

    const fetchQuota = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/bookings/quota`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setDailyQuota(await res.json());
      } catch (err) {
        // silent
      }
    };

    fetchQuota();
    const interval = setInterval(fetchQuota, 15000);
    return () => clearInterval(interval);
  }, [token, user]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      {/* Top Navbar */}
      <header className="sticky top-0 z-[1000] flex items-center justify-between px-3.5 py-2 md:px-6 md:py-2.5 bg-[#101b31]/95 backdrop-blur-xl border-b border-cyan-400/20 gap-2 w-full select-none">
        <div className="flex items-center gap-4 md:gap-6">
          <div className="flex items-center gap-2 cursor-pointer shrink-0" onClick={() => onTabChange('games')}>
            <div className="w-8 h-8 md:w-[38px] md:h-[38px] rounded-[9px] md:rounded-[11px] bg-blue-600/15 border-[1.5px] border-cyan-400/40 shadow-[0_0_12px_rgba(0,210,255,0.3)] flex items-center justify-center p-1 shrink-0">
              <img src="/logo_transparent.png" alt="CloudKH" className="w-full h-full object-contain drop-shadow-[0_0_6px_rgba(0,210,255,0.7)]" />
            </div>
            <span className="text-base md:text-[19px] font-black tracking-tight bg-gradient-to-r from-white via-white/95 to-cyan-400 bg-clip-text text-transparent leading-none">CloudKH</span>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] p-1 rounded-full border border-white/[0.07]">
            <button
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer border-0 ${
                activeTab === 'games'
                  ? 'text-white bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_2px_12px_rgba(0,180,216,0.4)]'
                  : 'text-indigo-200/70 hover:text-white hover:bg-white/[0.06] bg-transparent'
              }`}
              onClick={() => onTabChange('games')}
            >
              <span className={`inline-flex items-center justify-center ${activeTab === 'games' ? 'text-cyan-200 drop-shadow-[0_0_6px_rgba(0,210,255,0.6)]' : 'text-current'}`}>
                <GamepadIcon size={16} />
              </span>
              <span>Games</span>
            </button>

            <button
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer border-0 ${
                activeTab === 'bookings'
                  ? 'text-white bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_2px_12px_rgba(0,180,216,0.4)]'
                  : 'text-indigo-200/70 hover:text-white hover:bg-white/[0.06] bg-transparent'
              }`}
              onClick={() => onTabChange('bookings')}
            >
              <span className={`inline-flex items-center justify-center ${activeTab === 'bookings' ? 'text-cyan-200 drop-shadow-[0_0_6px_rgba(0,210,255,0.6)]' : 'text-current'}`}>
                <CalendarIcon size={16} />
              </span>
              <span>Bookings</span>
              {activeBookingsCount > 0 && (
                <span className="bg-gradient-to-r from-blue-600 to-cyan-400 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse ml-1">
                  {activeBookingsCount}
                </span>
              )}
            </button>

            {user?.role === 'admin' && (
              <button
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer border-0 ${
                  activeTab === 'admin'
                    ? 'text-white bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_2px_12px_rgba(0,180,216,0.4)]'
                    : 'text-indigo-200/70 hover:text-white hover:bg-white/[0.06] bg-transparent'
                }`}
                onClick={() => onTabChange('admin')}
              >
                <span className={`inline-flex items-center justify-center ${activeTab === 'admin' ? 'text-cyan-200 drop-shadow-[0_0_6px_rgba(0,210,255,0.6)]' : 'text-current'}`}>
                  <SettingsIcon size={16} />
                </span>
                <span>Admin</span>
              </button>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0 ml-auto">
          {/* Integrated Top Search Input */}
          <div className={`relative flex items-center transition-all duration-200 ${activeTab !== 'games' ? 'hidden md:flex' : 'flex'} w-[140px] focus-within:w-[170px] sm:w-[180px] sm:focus-within:w-[210px] md:w-[240px] md:focus-within:w-[280px]`}>
            <span className="absolute left-3 text-indigo-300/60 pointer-events-none flex items-center justify-center">
              <SearchIcon size={14} />
            </span>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => {
                if (onSearchChange) onSearchChange(e.target.value);
                if (activeTab !== 'games') onTabChange('games');
              }}
              className="w-full bg-white/5 focus:bg-[#0a101e]/95 border border-cyan-400/20 focus:border-cyan-400 rounded-full py-1.5 pl-8 pr-7 text-white text-xs md:text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.35)] placeholder:text-white/40"
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-2.5 w-4 h-4 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center border-0 cursor-pointer transition-colors p-0"
                onClick={() => onSearchChange && onSearchChange('')}
                title="Clear search"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {user ? (
            <div className="relative flex items-center gap-2" ref={userMenuRef}>
              {user.role !== 'admin' && (
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-full bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 text-xs font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                  onClick={() => onTabChange('bookings')}
                  title="Daily Free Beta Quota: 2 Hours maximum per day. Resets every midnight at 12:00 AM (UTC+7)."
                >
                  <span>{dailyQuota ? `${dailyQuota.remaining_minutes}m` : '120m'}</span>
                </button>
              )}

              <button
                type="button"
                className={`flex items-center gap-2 rounded-full cursor-pointer transition-all outline-none border p-1 md:py-1 md:px-3 md:pl-1.5 ${
                  userMenuOpen
                    ? 'bg-cyan-400/15 border-cyan-400/50 shadow-[0_0_16px_rgba(0,210,255,0.25)]'
                    : 'bg-white/5 hover:bg-cyan-400/10 border-white/10 hover:border-cyan-400/35'
                }`}
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="User menu"
              >
                <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,210,255,0.3)]">
                  <span>{user.name.charAt(0).toUpperCase()}</span>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-[#0d1126] shadow-[0_0_4px_#00ff88]" />
                </div>
                <span className="hidden md:inline text-xs font-bold text-white leading-none">{user.name}</span>
                <span className={`hidden md:inline text-[9px] text-indigo-300/70 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {userMenuOpen && (
                <div className="absolute top-[calc(100%+8px)] right-0 w-60 bg-[#0e1226]/95 backdrop-blur-xl border border-cyan-400/25 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.8),0_0_25px_rgba(0,82,255,0.2)] p-2 z-[1100] animate-[fadeIn_0.15s_ease-out] text-white flex flex-col gap-1">
                  <div className="flex items-center gap-2.5 p-2 pb-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-white font-extrabold text-sm flex items-center justify-center shrink-0">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden text-left">
                      <span className="text-xs font-bold text-white truncate">{user.name}</span>
                      <span className="text-[10.5px] text-white/50 truncate">{user.email}</span>
                      <span className={`text-[9px] font-black tracking-wider px-1.5 py-0.5 rounded w-fit mt-0.5 uppercase ${user.role === 'admin' ? 'bg-fuchsia-500/20 text-pink-300 border border-fuchsia-500/40' : 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30'}`}>
                        {user.role === 'admin' ? 'ADMIN' : 'PLAYER'}
                      </span>
                    </div>
                  </div>

                  {user.role !== 'admin' && (
                    <div className="bg-cyan-400/[0.04] border border-cyan-400/20 rounded-xl p-2 my-1">
                      <div className="flex items-center justify-between text-[10px] mb-1.5">
                        <span className="font-bold text-cyan-400 uppercase tracking-wider">Beta Daily Free Quota</span>
                        <span className="text-white/40 text-[9px]">Resets 00:00 UTC+7</span>
                      </div>
                      <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden mb-1.5">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, Math.max(0, ((dailyQuota?.remaining_minutes ?? 120) / 120) * 100))}%`,
                            background: (dailyQuota?.remaining_minutes ?? 120) > 30 ? 'linear-gradient(90deg, #0052ff, #00d2ff)' : '#ff5b52',
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-white/70">
                        <span><strong>{dailyQuota?.remaining_minutes ?? 120} mins</strong> left today</span>
                        <span className="text-white/40">/ 120m max</span>
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-white/[0.08] my-1" />

                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-indigo-200/80 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer border-0 bg-transparent text-left"
                    onClick={() => {
                      onTabChange('profile');
                      setUserMenuOpen(false);
                    }}
                  >
                    <UserIcon size={15} />
                    <span>Profile & Settings</span>
                  </button>

                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-indigo-200/80 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer border-0 bg-transparent text-left"
                    onClick={() => {
                      onTabChange('bookings');
                      setUserMenuOpen(false);
                    }}
                  >
                    <CalendarIcon size={15} />
                    <span>My Bookings</span>
                    {activeBookingsCount > 0 && (
                      <span className="ml-auto bg-gradient-to-r from-blue-600 to-cyan-400 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{activeBookingsCount}</span>
                    )}
                  </button>

                  {user.role === 'admin' && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-indigo-200/80 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer border-0 bg-transparent text-left"
                      onClick={() => {
                        onTabChange('admin');
                        setUserMenuOpen(false);
                      }}
                    >
                      <SettingsIcon size={15} />
                      <span>Admin Dashboard</span>
                    </button>
                  )}

                  <div className="h-px bg-white/[0.08] my-1" />

                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer border-0 bg-transparent text-left"
                    onClick={() => {
                      logout();
                      setUserMenuOpen(false);
                    }}
                  >
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white px-4 py-1.5 rounded-full text-xs font-extrabold cursor-pointer shadow-[0_4px_14px_rgba(0,82,255,0.4)] hover:shadow-[0_6px_18px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all border-0 whitespace-nowrap"
                onClick={() => openAuth('login')}
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Bottom Navigation Dock - Instant Thumb Reach */}
      <nav className="cloudkh-bottom-nav">
        <button
          className={`bottom-nav-item ${activeTab === 'games' ? 'active' : ''}`}
          onClick={() => onTabChange('games')}
        >
          <span className="bottom-nav-icon">
            <GamepadIcon size={19} />
          </span>
          <span className="bottom-nav-label">Games</span>
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'bookings' ? 'active' : ''}`}
          onClick={() => onTabChange('bookings')}
        >
          <span className="bottom-nav-icon">
            <CalendarIcon size={19} />
            {activeBookingsCount > 0 && (
              <span className="bottom-badge-pill">{activeBookingsCount}</span>
            )}
          </span>
          <span className="bottom-nav-label">Bookings</span>
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => (user ? onTabChange('profile') : openAuth('login'))}
        >
          <span className="bottom-nav-icon">
            <UserIcon size={19} />
          </span>
          <span className="bottom-nav-label">Profile</span>
        </button>

        {user?.role === 'admin' && (
          <button
            className={`bottom-nav-item ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => onTabChange('admin')}
          >
            <span className="bottom-nav-icon">
              <SettingsIcon size={19} />
            </span>
            <span className="bottom-nav-label">Admin</span>
          </button>
        )}
      </nav>
    </>
  );
}


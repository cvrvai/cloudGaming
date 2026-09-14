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
      <header className="cloudkh-navbar">
        <div className="navbar-left">
          <div className="navbar-brand" onClick={() => onTabChange('games')}>
            <div className="brand-logo-badge">
              <img src="/logo_transparent.png" alt="CloudKH" className="brand-logo-img" />
            </div>
            <span className="brand-title">CloudKH</span>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="navbar-links desktop-nav">
            <button
              className={`nav-tab-btn ${activeTab === 'games' ? 'active' : ''}`}
              onClick={() => onTabChange('games')}
            >
              <span className="nav-btn-icon">
                <GamepadIcon size={16} />
              </span>
              <span>Games</span>
            </button>

            <button
              className={`nav-tab-btn ${activeTab === 'bookings' ? 'active' : ''}`}
              onClick={() => onTabChange('bookings')}
            >
              <span className="nav-btn-icon">
                <CalendarIcon size={16} />
              </span>
              <span>Bookings</span>
              {activeBookingsCount > 0 && (
                <span className="active-badge-pill">{activeBookingsCount}</span>
              )}
            </button>

            {user?.role === 'admin' && (
              <button
                className={`nav-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => onTabChange('admin')}
              >
                <span className="nav-btn-icon">
                  <SettingsIcon size={16} />
                </span>
                <span>Admin</span>
              </button>
            )}
          </nav>
        </div>

        <div className="navbar-actions">
          {/* Integrated Top Search Input */}
          <div className="navbar-search-box">
            <span className="navbar-search-icon">
              <SearchIcon size={14} />
            </span>
            <input
              type="text"
              placeholder="Search games..."
              value={searchQuery}
              onChange={(e) => {
                if (onSearchChange) onSearchChange(e.target.value);
                if (activeTab !== 'games') onTabChange('games');
              }}
              className="navbar-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="navbar-clear-search"
                onClick={() => onSearchChange && onSearchChange('')}
                title="Clear search"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {user ? (
            <div className="navbar-user-wrapper" ref={userMenuRef} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {user.role !== 'admin' && (
                <button
                  type="button"
                  className="nav-quota-chip"
                  onClick={() => onTabChange('bookings')}
                  title="Daily Free Beta Quota: 2 Hours maximum per day. Resets every midnight at 12:00 AM (UTC+7)."
                >
                  <span className="nav-quota-text">
                    {dailyQuota ? `${dailyQuota.remaining_minutes}m left today` : '2h left today'}
                  </span>
                </button>
              )}

              <button
                type="button"
                className={`navbar-user-chip ${userMenuOpen ? 'active' : ''}`}
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="User menu"
              >
                <div className="user-avatar-circle">
                  <span>{user.name.charAt(0).toUpperCase()}</span>
                  <span className="nav-avatar-status" />
                </div>
                <span className="user-name desktop-only">{user.name}</span>
                <span className="user-chevron desktop-only">▾</span>
              </button>

              {userMenuOpen && (
                <div className="navbar-user-dropdown glass-panel">
                  <div className="dropdown-user-header">
                    <div className="dropdown-user-avatar">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="dropdown-user-meta">
                      <span className="dropdown-user-name">{user.name}</span>
                      <span className="dropdown-user-email">{user.email}</span>
                      <span className={`dropdown-user-role role-${user.role || 'user'}`}>
                        {user.role === 'admin' ? 'ADMIN' : 'PLAYER'}
                      </span>
                    </div>
                  </div>

                  {user.role !== 'admin' && (
                    <div className="dropdown-quota-card">
                      <div className="dropdown-quota-header">
                        <span className="dropdown-quota-badge">Beta Daily Free Quota</span>
                        <span className="dropdown-quota-reset">Resets 00:00 UTC+7</span>
                      </div>
                      <div className="dropdown-quota-progress">
                        <div
                          className="dropdown-quota-bar"
                          style={{
                            width: `${Math.min(100, Math.max(0, ((dailyQuota?.remaining_minutes ?? 120) / 120) * 100))}%`,
                            background: (dailyQuota?.remaining_minutes ?? 120) > 30 ? 'linear-gradient(90deg, #0052ff, #00d2ff)' : '#ff5b52',
                          }}
                        />
                      </div>
                      <div className="dropdown-quota-footer">
                        <span><strong>{dailyQuota?.remaining_minutes ?? 120} mins</strong> left today</span>
                        <span className="quota-limit">/ 120m max</span>
                      </div>
                    </div>
                  )}

                  <div className="dropdown-divider" />

                  <button
                    type="button"
                    className="dropdown-item"
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
                    className="dropdown-item"
                    onClick={() => {
                      onTabChange('bookings');
                      setUserMenuOpen(false);
                    }}
                  >
                    <CalendarIcon size={15} />
                    <span>My Bookings</span>
                    {activeBookingsCount > 0 && (
                      <span className="dropdown-badge">{activeBookingsCount}</span>
                    )}
                  </button>

                  {user.role === 'admin' && (
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        onTabChange('admin');
                        setUserMenuOpen(false);
                      }}
                    >
                      <SettingsIcon size={15} />
                      <span>Admin Dashboard</span>
                    </button>
                  )}

                  <div className="dropdown-divider" />

                  <button
                    type="button"
                    className="dropdown-item item-danger"
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
            <div className="auth-buttons-group">
              <button className="btn-nav-signin" onClick={() => openAuth('login')}>
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


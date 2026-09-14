import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { GamepadIcon, CalendarIcon, SettingsIcon, SearchIcon, UserIcon } from './Icons';

export default function Navbar({
  activeTab,
  onTabChange,
  activeBookingsCount = 0,
  searchQuery = '',
  onSearchChange,
}) {
  const { user, logout, openAuth } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

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
              >
                ✕
              </button>
            )}
          </div>

          {user ? (
            <div className="navbar-user-wrapper" ref={userMenuRef}>
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
                      <span className={`dropdown-user-role role-${user.role || 'student'}`}>
                        {user.role === 'admin' ? 'ADMIN' : 'STUDENT'}
                      </span>
                    </div>
                  </div>

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


import { useAuth } from '../context/AuthContext';
import { GamepadIcon, CalendarIcon, SettingsIcon, SearchIcon } from './Icons';

export default function Navbar({
  activeTab,
  onTabChange,
  activeBookingsCount = 0,
  searchQuery = '',
  onSearchChange,
}) {
  const { user, logout, openAuth } = useAuth();

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

          {/* Desktop Navigation Links - Grouped with brand on left */}
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
            <div className="user-profile-badge">
              <div className="user-avatar-circle">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="user-name">{user.name}</span>
              <button className="nav-btn-logout" onClick={logout} title="Sign Out">
                Sign Out
              </button>
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

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  UserIcon,
  LockIcon,
  MailIcon,
  SettingsIcon,
  BoltIcon,
  GamepadIcon,
  CalendarIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  EyeIcon,
  EyeOffIcon,
  AlertTriangleIcon,
  CheckIcon,
} from './Icons';

export default function ProfileSettingsView({ onNavigateToBookings, onNavigateToGames }) {
  const { user, updateProfile, changePassword, fetchStats, logout, openAuth } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState('profile'); // 'profile' | 'security' | 'preferences'
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Profile edit state
  const [name, setName] = useState(user?.name || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(null);
  const [profileError, setProfileError] = useState(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(null);
  const [pwError, setPwError] = useState(null);

  // Streaming & gaming preferences state (persisted in localStorage)
  const [streamSettings, setStreamSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('cloudkh_stream_settings');
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return {
      resolution: '720p',
      framerate: '60',
      inputMode: 'auto',
      lowLatency: true,
      volume: 85,
    };
  });
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      fetchStats()
        .then((data) => setStats(data))
        .catch((err) => console.error('Error loading stats:', err))
        .finally(() => setLoadingStats(false));
    }
  }, [user]);

  const handleUpdateSetting = (key, value) => {
    const updated = { ...streamSettings, [key]: value };
    setStreamSettings(updated);
    try {
      localStorage.setItem('cloudkh_stream_settings', JSON.stringify(updated));
      setSettingsSavedToast(true);
      setTimeout(() => setSettingsSavedToast(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setProfileError('Full name cannot be blank');
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      await updateProfile(name.trim());
      setProfileSuccess('Profile updated successfully!');
      setTimeout(() => setProfileSuccess(null), 3000);
    } catch (err) {
      setProfileError(err.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }

    setSavingPw(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPwSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPwSuccess(null), 3500);
    } catch (err) {
      setPwError(err.message || 'Failed to update password');
    } finally {
      setSavingPw(false);
    }
  };

  if (!user) {
    return (
      <div className="profile-view-container not-logged-in">
        <div className="glass-panel profile-empty-card">
          <div className="profile-avatar-placeholder">
            <UserIcon size={44} />
          </div>
          <h2>Account Required</h2>
          <p>Please sign in to access your profile, booking statistics, and streaming preferences.</p>
          <button className="btn-primary auth-btn-cta" onClick={() => openAuth('login')}>
            Sign In to CloudKH
          </button>
        </div>
      </div>
    );
  }

  const memberDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '2026';

  return (
    <div className="profile-view-container">
      {/* Hero Header Card */}
      <div className="profile-hero-card glass-panel">
        <div className="profile-hero-left">
          <div className="profile-avatar-large">
            <span>{user.name.charAt(0).toUpperCase()}</span>
            <span className="avatar-status-dot" title="Online & Authenticated" />
          </div>
          <div className="profile-hero-info">
            <div className="profile-name-row">
              <h1 className="profile-display-name">{user.name}</h1>
              <span className={`profile-role-badge role-${user.role || 'user'}`}>
                {user.role === 'admin' ? 'ADMINISTRATOR' : 'PLAYER'}
              </span>
            </div>
            <p className="profile-email-text">{user.email}</p>
            <div className="profile-meta-tags">
              <span className="profile-meta-tag">
                <CalendarIcon size={12} /> Member since {memberDate}
              </span>
              <span className="profile-meta-tag tag-verified">
                <CheckCircleIcon size={12} /> Email Verified
              </span>
              {user.role === 'admin' && (
                <span className="profile-meta-tag tag-mfa">
                  <ShieldCheckIcon size={12} /> 2-Step TOTP Active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="profile-hero-stats">
          {user.role !== 'admin' && (
            <div className="profile-stat-box">
              <span className="stat-label">DAILY ALLOWANCE</span>
              <span className="stat-value" style={{ color: '#00d2ff' }}>2h / Day</span>
            </div>
          )}
          <div className="profile-stat-box">
            <span className="stat-label">TOTAL BOOKINGS</span>
            <span className="stat-value">{loadingStats ? '...' : stats?.total_bookings ?? 0}</span>
          </div>
          <div className="profile-stat-box">
            <span className="stat-label">ACTIVE SLOTS</span>
            <span className="stat-value active-pulse">
              {loadingStats ? '...' : stats?.active_bookings ?? 0}
            </span>
          </div>
          <div className="profile-stat-box">
            <span className="stat-label">STATUS</span>
            <span className="stat-value status-active">Online</span>
          </div>
        </div>
      </div>

      {/* Segmented Sub-Tab Switcher */}
      <div className="profile-tab-bar-wrap">
        <div className="profile-tab-bar">
          <button
            type="button"
            className={`profile-tab-btn ${activeSubTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('profile')}
          >
            <UserIcon size={15} />
            <span>Profile Details</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeSubTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('security')}
          >
            <LockIcon size={15} />
            <span>Security & Password</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeSubTab === 'preferences' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('preferences')}
          >
            <SettingsIcon size={15} />
            <span>Stream & Controls</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="profile-tab-content">
        {/* SUBTAB 1: PROFILE DETAILS */}
        {activeSubTab === 'profile' && (
          <div className="profile-card glass-panel">
            <div className="card-section-header">
              <h3>Personal Information</h3>
              <p>Manage your account display name and account identification.</p>
            </div>

            {profileSuccess && (
              <div className="profile-alert success">
                <CheckCircleIcon size={16} /> {profileSuccess}
              </div>
            )}
            {profileError && (
              <div className="profile-alert error" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangleIcon size={16} />
                <span>{profileError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="profile-form">
              <div className="profile-form-grid">
                <div className="form-group">
                  <label>Full Display Name</label>
                  <div className="auth-input-wrap">
                    <UserIcon className="input-field-icon" size={16} />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      required
                      disabled={savingProfile}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Email Address (Account ID)</label>
                  <div className="auth-input-wrap">
                    <MailIcon className="input-field-icon" size={16} />
                    <input type="email" value={user.email} disabled readOnly className="input-readonly" />
                  </div>
                  <span className="field-hint">Email address is permanently linked to your student credentials.</span>
                </div>
              </div>

              <div className="profile-form-actions">
                <button
                  type="submit"
                  className="btn-primary profile-save-btn"
                  disabled={savingProfile || name.trim() === user.name}
                >
                  {savingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>

            <div className="profile-signout-box">
              <button type="button" className="btn-secondary-danger" onClick={logout}>
                Sign Out of CloudKH
              </button>
            </div>
          </div>
        )}

        {/* SUBTAB 2: SECURITY & PASSWORD */}
        {activeSubTab === 'security' && (
          <div className="profile-card glass-panel">
            <div className="card-section-header">
              <h3>Security & Password</h3>
              <p>Update your password and review your account authentication protections.</p>
            </div>

            {pwSuccess && (
              <div className="profile-alert success">
                <CheckCircleIcon size={16} /> {pwSuccess}
              </div>
            )}
            {pwError && (
              <div className="profile-alert error" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangleIcon size={16} />
                <span>{pwError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="profile-form">
              <div className="profile-form-grid">
                <div className="form-group full-width">
                  <label>Current Password</label>
                  <div className="auth-input-wrap">
                    <LockIcon className="input-field-icon" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      disabled={savingPw}
                    />
                    <button
                      type="button"
                      className="btn-toggle-pw"
                      onClick={() => setShowPw(!showPw)}
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>New Password</label>
                  <div className="auth-input-wrap">
                    <LockIcon className="input-field-icon" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      required
                      minLength={6}
                      disabled={savingPw}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Confirm New Password</label>
                  <div className="auth-input-wrap">
                    <LockIcon className="input-field-icon" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      required
                      minLength={6}
                      disabled={savingPw}
                    />
                  </div>
                </div>
              </div>

              <div className="profile-form-actions">
                <button
                  type="submit"
                  className="btn-primary profile-save-btn"
                  disabled={savingPw || !currentPassword || !newPassword || !confirmPassword}
                >
                  {savingPw ? 'Updating Password...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SUBTAB 3: STREAM & CONTROLS */}
        {activeSubTab === 'preferences' && (
          <div className="profile-card glass-panel">
            <div className="card-section-header">
              <div className="card-header-with-toast">
                <div>
                  <h3>Stream & Gaming Preferences</h3>
                  <p>Customize video resolution, latency, and input controller behavior for cloud play.</p>
                </div>
                {settingsSavedToast && (
                  <span className="settings-saved-badge">
                    <CheckIcon size={12} />
                    <span>Saved</span>
                  </span>
                )}
              </div>
            </div>

            <div className="preferences-grid">
              {/* Resolution Setting */}
              <div className="preference-item">
                <div className="pref-label-group">
                  <span className="pref-title">Streaming Resolution</span>
                  <span className="pref-desc">Select resolution for video stream rendering.</span>
                </div>
                <div className="pref-options-pills">
                  {[
                    { id: '1080p', label: '1080p (FHD)' },
                    { id: '720p', label: '720p (Recommended)' },
                    { id: '480p', label: '480p (Data Saver)' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pref-pill ${streamSettings.resolution === opt.id ? 'active' : ''}`}
                      onClick={() => handleUpdateSetting('resolution', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Framerate Setting */}
              <div className="preference-item">
                <div className="pref-label-group">
                  <span className="pref-title">Target Framerate</span>
                  <span className="pref-desc">60 FPS provides ultra-smooth competitive latency.</span>
                </div>
                <div className="pref-options-pills">
                  {[
                    { id: '60', label: '60 FPS (Smooth)' },
                    { id: '30', label: '30 FPS (Saver)' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pref-pill ${streamSettings.framerate === opt.id ? 'active' : ''}`}
                      onClick={() => handleUpdateSetting('framerate', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Controller Setting */}
              <div className="preference-item">
                <div className="pref-label-group">
                  <span className="pref-title">Preferred Controller Mode</span>
                  <span className="pref-desc">Select how input is routed to the cloud PC.</span>
                </div>
                <div className="pref-options-pills">
                  {[
                    { id: 'auto', label: 'Auto-Detect' },
                    { id: 'touch', label: 'Virtual Touchpad' },
                    { id: 'gamepad', label: 'Physical Gamepad' },
                    { id: 'keyboard', label: 'Keyboard & Mouse' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pref-pill ${streamSettings.inputMode === opt.id ? 'active' : ''}`}
                      onClick={() => handleUpdateSetting('inputMode', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Low-Latency Mode Toggle */}
              <div className="preference-item row-toggle">
                <div className="pref-label-group">
                  <span className="pref-title">Zero-Buffer Low Latency Mode</span>
                  <span className="pref-desc">
                    Minimizes frame jitter buffer for instant competitive response times.
                  </span>
                </div>
                <label className="switch-toggle">
                  <input
                    type="checkbox"
                    checked={streamSettings.lowLatency}
                    onChange={(e) => handleUpdateSetting('lowLatency', e.target.checked)}
                  />
                  <span className="slider-round" />
                </label>
              </div>

              {/* Audio Volume */}
              <div className="preference-item">
                <div className="pref-label-group">
                  <span className="pref-title">Default Stream Volume: {streamSettings.volume}%</span>
                  <span className="pref-desc">Adjust default player audio level.</span>
                </div>
                <div className="volume-slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={streamSettings.volume}
                    onChange={(e) => handleUpdateSetting('volume', Number(e.target.value))}
                    className="volume-range-slider"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

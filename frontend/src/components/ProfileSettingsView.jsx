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
      <div className="max-w-4xl mx-auto px-4 py-6 pb-20 animate-[fadeIn_0.2s_ease-out]">
        <div className="text-center p-8 md:p-12 max-w-md mx-auto my-10 rounded-2xl bg-[#12132b]/95 border border-cyan-400/25 shadow-2xl text-white">
          <div className="w-16 h-16 rounded-full bg-blue-600/15 border-[1.5px] border-dashed border-cyan-400/40 text-cyan-400 flex items-center justify-center mx-auto mb-4">
            <UserIcon size={40} />
          </div>
          <h2 className="text-xl font-extrabold mb-2">Account Required</h2>
          <p className="text-xs text-indigo-200/70 mb-5 leading-relaxed">
            Please sign in to access your profile, booking statistics, and streaming preferences.
          </p>
          <button
            className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white px-6 py-2.5 rounded-full text-xs font-extrabold cursor-pointer shadow-[0_4px_14px_rgba(0,82,255,0.4)] hover:shadow-[0_6px_18px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all border-0"
            onClick={() => openAuth('login')}
          >
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
    <div className="max-w-4xl mx-auto px-4 py-6 pb-20 animate-[fadeIn_0.2s_ease-out]">
      {/* Hero Header Card */}
      <div className="flex flex-wrap items-center justify-between gap-6 p-6 md:p-7 rounded-2xl bg-gradient-to-br from-[#12132b]/95 to-[#0c0e21]/90 border border-cyan-400/25 shadow-[0_16px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(0,82,255,0.15)] mb-6 text-white">
        <div className="flex items-center gap-5">
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 border-2 border-white/20 shadow-[0_0_24px_rgba(0,210,255,0.45)] text-white text-2xl font-extrabold flex items-center justify-center shrink-0">
            <span>{user.name.charAt(0).toUpperCase()}</span>
            <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-emerald-400 border-2 border-[#0f1026] rounded-full shadow-[0_0_8px_#00ff88]" title="Online & Authenticated" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl md:text-2xl font-black text-white m-0 tracking-tight">{user.name}</h1>
              <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                user.role === 'admin'
                  ? 'bg-gradient-to-r from-purple-500/25 to-pink-500/25 border border-fuchsia-400/50 text-pink-300 shadow-[0_0_12px_rgba(217,70,239,0.25)]'
                  : 'bg-gradient-to-r from-blue-600/20 to-cyan-400/20 border border-cyan-400/40 text-cyan-300 shadow-[0_0_10px_rgba(0,210,255,0.2)]'
              }`}>
                {user.role === 'admin' ? 'ADMINISTRATOR' : 'PLAYER'}
              </span>
            </div>
            <p className="text-xs text-indigo-200/70 m-0">{user.email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08]">
                <CalendarIcon size={12} /> Member since {memberDate}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/30">
                <CheckCircleIcon size={12} /> Email Verified
              </span>
              {user.role === 'admin' && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-purple-300 bg-purple-400/10 px-2 py-0.5 rounded border border-purple-400/30">
                  <ShieldCheckIcon size={12} /> 2-Step TOTP Active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="flex items-center gap-3.5 flex-wrap">
          {user.role !== 'admin' && (
            <div className="bg-black/40 border border-white/[0.08] rounded-xl py-2.5 px-4 text-center min-w-[85px]">
              <span className="block text-[9px] font-extrabold tracking-wider text-white/40 mb-0.5">DAILY ALLOWANCE</span>
              <span className="text-base font-extrabold text-cyan-400 font-mono">2h / Day</span>
            </div>
          )}
          <div className="bg-black/40 border border-white/[0.08] rounded-xl py-2.5 px-4 text-center min-w-[85px]">
            <span className="block text-[9px] font-extrabold tracking-wider text-white/40 mb-0.5">TOTAL BOOKINGS</span>
            <span className="text-base font-extrabold text-white font-mono">{loadingStats ? '...' : stats?.total_bookings ?? 0}</span>
          </div>
          <div className="bg-black/40 border border-white/[0.08] rounded-xl py-2.5 px-4 text-center min-w-[85px]">
            <span className="block text-[9px] font-extrabold tracking-wider text-white/40 mb-0.5">ACTIVE SLOTS</span>
            <span className="text-base font-extrabold text-cyan-400 font-mono drop-shadow-[0_0_8px_rgba(0,210,255,0.6)]">
              {loadingStats ? '...' : stats?.active_bookings ?? 0}
            </span>
          </div>
          <div className="bg-black/40 border border-white/[0.08] rounded-xl py-2.5 px-4 text-center min-w-[85px]">
            <span className="block text-[9px] font-extrabold tracking-wider text-white/40 mb-0.5">STATUS</span>
            <span className="text-sm font-extrabold text-emerald-400 font-mono">Online</span>
          </div>
        </div>
      </div>

      {/* Segmented Sub-Tab Switcher */}
      <div className="flex justify-center mb-5">
        <div className="inline-flex gap-1.5 bg-[#12132b]/90 p-1 rounded-full border border-white/[0.08] shadow-lg">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 py-2 px-4.5 text-xs font-bold rounded-full transition-all cursor-pointer border-0 ${
              activeSubTab === 'profile'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_rgba(0,82,255,0.4)]'
                : 'bg-transparent text-indigo-200/70 hover:text-white'
            }`}
            onClick={() => setActiveSubTab('profile')}
          >
            <UserIcon size={15} />
            <span>Profile Details</span>
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 py-2 px-4.5 text-xs font-bold rounded-full transition-all cursor-pointer border-0 ${
              activeSubTab === 'security'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_rgba(0,82,255,0.4)]'
                : 'bg-transparent text-indigo-200/70 hover:text-white'
            }`}
            onClick={() => setActiveSubTab('security')}
          >
            <LockIcon size={15} />
            <span>Security & Password</span>
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 py-2 px-4.5 text-xs font-bold rounded-full transition-all cursor-pointer border-0 ${
              activeSubTab === 'preferences'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_rgba(0,82,255,0.4)]'
                : 'bg-transparent text-indigo-200/70 hover:text-white'
            }`}
            onClick={() => setActiveSubTab('preferences')}
          >
            <SettingsIcon size={15} />
            <span>Stream & Controls</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div>
        {/* SUBTAB 1: PROFILE DETAILS */}
        {activeSubTab === 'profile' && (
          <div className="bg-[#12132b]/95 rounded-2xl border border-cyan-400/20 p-6 md:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.7)] text-white">
            <div className="mb-5 pb-3.5 border-b border-white/[0.07]">
              <h3 className="text-base font-extrabold text-white m-0 mb-1">Personal Information</h3>
              <p className="text-xs text-white/50 m-0">Manage your account display name and account identification.</p>
            </div>

            {profileSuccess && (
              <div className="p-2.5 px-3.5 rounded-lg text-xs font-semibold mb-4 flex items-center gap-2 bg-emerald-400/15 border border-emerald-400/30 text-emerald-300">
                <CheckCircleIcon size={16} /> {profileSuccess}
              </div>
            )}
            {profileError && (
              <div className="p-2.5 px-3.5 rounded-lg text-xs font-semibold mb-4 flex items-center gap-2 bg-red-500/15 border border-red-500/35 text-red-400">
                <AlertTriangleIcon size={16} />
                <span>{profileError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Full Display Name</label>
                  <div className="relative flex items-center w-full group">
                    <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      required
                      disabled={savingProfile}
                      className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Email Address (Account ID)</label>
                  <div className="relative flex items-center w-full">
                    <MailIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none z-10" size={16} />
                    <input
                      type="email"
                      value={user.email}
                      disabled
                      readOnly
                      className="w-full bg-white/[0.02] border border-white/10 py-2.5 px-10 rounded-lg text-white/50 text-sm outline-none cursor-not-allowed"
                    />
                  </div>
                  <span className="text-[10.5px] text-white/40 mt-1">Email address is permanently linked to your student credentials.</span>
                </div>
              </div>

              <div className="flex justify-end mb-4">
                <button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-xs font-extrabold py-2.5 px-6 rounded-full border-0 cursor-pointer shadow-[0_4px_16px_rgba(0,82,255,0.35)] hover:shadow-[0_8px_22px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={savingProfile || name.trim() === user.name}
                >
                  {savingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>

            <div className="border-t border-white/[0.08] pt-4 flex justify-start">
              <button
                type="button"
                className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/35 text-red-400 text-xs font-bold py-2 px-4 rounded-xl cursor-pointer transition-colors"
                onClick={logout}
              >
                Sign Out of CloudKH
              </button>
            </div>
          </div>
        )}

        {/* SUBTAB 2: SECURITY & PASSWORD */}
        {activeSubTab === 'security' && (
          <div className="bg-[#12132b]/95 rounded-2xl border border-cyan-400/20 p-6 md:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.7)] text-white">
            <div className="mb-5 pb-3.5 border-b border-white/[0.07]">
              <h3 className="text-base font-extrabold text-white m-0 mb-1">Security & Password</h3>
              <p className="text-xs text-white/50 m-0">Update your password and review your account authentication protections.</p>
            </div>

            {pwSuccess && (
              <div className="p-2.5 px-3.5 rounded-lg text-xs font-semibold mb-4 flex items-center gap-2 bg-emerald-400/15 border border-emerald-400/30 text-emerald-300">
                <CheckCircleIcon size={16} /> {pwSuccess}
              </div>
            )}
            {pwError && (
              <div className="p-2.5 px-3.5 rounded-lg text-xs font-semibold mb-4 flex items-center gap-2 bg-red-500/15 border border-red-500/35 text-red-400">
                <AlertTriangleIcon size={16} />
                <span>{pwError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Current Password</label>
                  <div className="relative flex items-center w-full group">
                    <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      disabled={savingPw}
                      className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 text-white/40 hover:text-cyan-400 p-1 flex items-center justify-center transition-colors z-10 cursor-pointer"
                      onClick={() => setShowPw(!showPw)}
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">New Password</label>
                  <div className="relative flex items-center w-full group">
                    <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      required
                      minLength={6}
                      disabled={savingPw}
                      className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Confirm New Password</label>
                  <div className="relative flex items-center w-full group">
                    <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      required
                      minLength={6}
                      disabled={savingPw}
                      className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end mb-2">
                <button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-xs font-extrabold py-2.5 px-6 rounded-full border-0 cursor-pointer shadow-[0_4px_16px_rgba(0,82,255,0.35)] hover:shadow-[0_8px_22px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-[#12132b]/95 rounded-2xl border border-cyan-400/20 p-6 md:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.7)] text-white">
            <div className="mb-5 pb-3.5 border-b border-white/[0.07]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-white m-0 mb-1">Stream & Gaming Preferences</h3>
                  <p className="text-xs text-white/50 m-0">Customize video resolution, latency, and input controller behavior for cloud play.</p>
                </div>
                {settingsSavedToast && (
                  <span className="text-[10.5px] font-bold text-emerald-400 bg-emerald-400/15 border border-emerald-400/35 px-2 py-0.5 rounded flex items-center gap-1 shrink-0 animate-[fadeIn_0.2s_ease-out]">
                    <CheckIcon size={12} />
                    <span>Saved</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* Resolution Setting */}
              <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.06] p-3.5 rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-extrabold text-white">Streaming Resolution</span>
                  <span className="text-[11px] text-white/50">Select resolution for video stream rendering.</span>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {[
                    { id: '1080p', label: '1080p (FHD)' },
                    { id: '720p', label: '720p (Recommended)' },
                    { id: '480p', label: '480p (Data Saver)' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        streamSettings.resolution === opt.id
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white border-transparent shadow-[0_2px_10px_rgba(0,82,255,0.4)]'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/12 hover:border-cyan-400/50 text-indigo-200/70 hover:text-white'
                      }`}
                      onClick={() => handleUpdateSetting('resolution', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Framerate Setting */}
              <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.06] p-3.5 rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-extrabold text-white">Target Framerate</span>
                  <span className="text-[11px] text-white/50">60 FPS provides ultra-smooth competitive latency.</span>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {[
                    { id: '60', label: '60 FPS (Smooth)' },
                    { id: '30', label: '30 FPS (Saver)' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        streamSettings.framerate === opt.id
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white border-transparent shadow-[0_2px_10px_rgba(0,82,255,0.4)]'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/12 hover:border-cyan-400/50 text-indigo-200/70 hover:text-white'
                      }`}
                      onClick={() => handleUpdateSetting('framerate', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Controller Setting */}
              <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.06] p-3.5 rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-extrabold text-white">Preferred Controller Mode</span>
                  <span className="text-[11px] text-white/50">Select how input is routed to the cloud PC.</span>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {[
                    { id: 'auto', label: 'Auto-Detect' },
                    { id: 'touch', label: 'Virtual Touchpad' },
                    { id: 'gamepad', label: 'Physical Gamepad' },
                    { id: 'keyboard', label: 'Keyboard & Mouse' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        streamSettings.inputMode === opt.id
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white border-transparent shadow-[0_2px_10px_rgba(0,82,255,0.4)]'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/12 hover:border-cyan-400/50 text-indigo-200/70 hover:text-white'
                      }`}
                      onClick={() => handleUpdateSetting('inputMode', opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Low-Latency Mode Toggle */}
              <div className="flex flex-row items-center justify-between bg-black/25 border border-white/[0.06] p-3.5 rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-extrabold text-white">Zero-Buffer Low Latency Mode</span>
                  <span className="text-[11px] text-white/50">
                    Minimizes frame jitter buffer for instant competitive response times.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={streamSettings.lowLatency}
                    onChange={(e) => handleUpdateSetting('lowLatency', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-white/15 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-blue-600 peer-checked:to-cyan-400 peer-checked:shadow-[0_0_10px_rgba(0,210,255,0.5)]" />
                </label>
              </div>

              {/* Audio Volume */}
              <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.06] p-3.5 rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-extrabold text-white">Default Stream Volume: {streamSettings.volume}%</span>
                  <span className="text-[11px] text-white/50">Adjust default player audio level.</span>
                </div>
                <div className="mt-1.5">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={streamSettings.volume}
                    onChange={(e) => handleUpdateSetting('volume', Number(e.target.value))}
                    className="w-full h-1.5 rounded-full bg-white/15 accent-cyan-400 cursor-pointer"
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

import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MailIcon, LockIcon, UserIcon, EyeIcon, EyeOffIcon, ShieldCheckIcon, KeyIcon, XIcon, CheckIcon, AlertTriangleIcon } from './Icons';

export default function AuthModal() {
  const { authModalOpen, setAuthModalOpen, authMode, setAuthMode, login, register, verifyMfa } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 2-step MFA state
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaError, setMfaError] = useState(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  if (!authModalOpen) return null;

  const handleClose = () => {
    setAuthModalOpen(false);
    setMfaChallenge(null);
    setMfaCode('');
    setMfaError(null);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (authMode === 'login') {
        const result = await login(email, password);
        if (result && result.status === 'mfa_required') {
          setMfaChallenge(result);
          setMfaCode('');
          setMfaError(null);
        }
      } else {
        if (!name.trim()) throw new Error('Please enter your name');
        await register(name, email, password);
      }
    } catch (err) {
      setError(err.message || 'Authentication error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    const cleanCode = mfaCode.replace(/\s+/g, '');
    if (!cleanCode || cleanCode.length !== 6) {
      setMfaError('Please enter a valid 6-digit code');
      return;
    }
    setMfaSubmitting(true);
    setMfaError(null);
    try {
      await verifyMfa(mfaChallenge.challenge_id, cleanCode);
      setMfaChallenge(null);
      setMfaCode('');
    } catch (err) {
      setMfaError(err.message || 'Invalid or expired verification code');
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={handleClose}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div
        className={`relative w-full ${mfaChallenge ? 'max-w-[340px] p-5' : 'max-w-[380px] p-6'} rounded-2xl bg-[#12132b]/95 border border-cyan-400/25 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_30px_rgba(0,82,255,0.2)] text-white`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer border-0"
          onClick={handleClose}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>

        {mfaChallenge ? (
          <div className="flex flex-col animate-[fadeIn_0.2s_ease-out]">
            <div className="text-center mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600/20 to-cyan-400/20 border-[1.5px] border-cyan-400/50 shadow-[0_0_14px_rgba(0,210,255,0.35)] flex items-center justify-center mx-auto mb-2 p-0.5 text-cyan-400">
                <ShieldCheckIcon size={18} />
              </div>
              <h2 className="text-base font-extrabold text-white tracking-tight m-0 mb-1">Two-Step Verification</h2>
              <p className="text-[11.5px] text-indigo-200/70 m-0 leading-relaxed">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>

            {mfaChallenge.mfa_setup_required && (
              <div className="bg-cyan-400/[0.04] border border-cyan-400/20 rounded-xl p-2.5 mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-cyan-400 uppercase tracking-wide">
                    <KeyIcon size={12} /> First-Time Setup Key
                  </span>
                  <button
                    type="button"
                    className="bg-cyan-400/15 hover:bg-cyan-400 border border-cyan-400/35 hover:text-slate-900 text-cyan-400 px-2 py-0.5 rounded text-[10.5px] font-bold cursor-pointer transition-all inline-flex items-center gap-1"
                    onClick={() => {
                      if (mfaChallenge.secret) {
                        navigator.clipboard.writeText(mfaChallenge.secret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 2000);
                      }
                    }}
                  >
                    {copiedSecret ? (
                      <>
                        <CheckIcon size={12} />
                        <span>Copied</span>
                      </>
                    ) : (
                      'Copy Key'
                    )}
                  </button>
                </div>
                <div className="bg-black/45 border border-white/[0.08] rounded-md p-1.5 flex items-center justify-center">
                  <code className="font-mono text-[11.5px] font-bold text-[#00ffcc] tracking-widest break-all select-all text-center">
                    {mfaChallenge.secret}
                  </code>
                </div>
              </div>
            )}

            {mfaError && (
              <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-2.5 py-1.5 rounded-lg text-xs font-medium mb-3 flex items-center gap-1.5 leading-snug">
                <AlertTriangleIcon size={14} />
                <span>{mfaError}</span>
              </div>
            )}

            <form onSubmit={handleMfaSubmit} className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-center my-0.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="000 000"
                    value={mfaCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setMfaCode(val);
                    }}
                    className="w-full max-w-[210px] h-10 font-mono text-xl font-extrabold text-center tracking-[6px] py-1 px-2.5 rounded-lg bg-black/55 border-[1.5px] border-cyan-400/40 focus:border-cyan-400 text-cyan-300 shadow-[inset_0_0_12px_rgba(0,210,255,0.12),0_2px_8px_rgba(0,0,0,0.4)] focus:shadow-[inset_0_0_16px_rgba(0,210,255,0.3),0_0_12px_rgba(0,210,255,0.35)] outline-none transition-all placeholder:text-white/20"
                    disabled={mfaSubmitting}
                  />
                </div>
                <div className="text-[10.5px] text-white/50 text-center mt-1">
                  Codes refresh every 30 seconds
                </div>
              </div>

              <div className="flex justify-center w-full mt-1.5">
                <button
                  type="submit"
                  className="w-full max-w-[220px] h-9 bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-xs font-extrabold tracking-wide rounded-full border-0 cursor-pointer shadow-[0_4px_16px_rgba(0,82,255,0.35)] hover:shadow-[0_8px_22px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  disabled={mfaSubmitting || mfaCode.length !== 6}
                >
                  {mfaSubmitting ? 'Verifying...' : 'Verify Code'}
                </button>
              </div>
            </form>

            <div className="text-center mt-2.5">
              <button
                type="button"
                className="bg-transparent border-0 text-cyan-400 hover:text-white font-bold cursor-pointer p-0 underline transition-colors text-xs"
                onClick={() => {
                  setMfaChallenge(null);
                  setMfaCode('');
                  setMfaError(null);
                }}
              >
                ← Back to Sign In
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center mb-4">
              <div className="w-11 h-11 rounded-xl bg-blue-600/15 border-[1.5px] border-cyan-400/40 shadow-[0_0_16px_rgba(0,210,255,0.35)] flex items-center justify-center mx-auto mb-2.5 p-1">
                <img src="/logo_transparent.png" alt="CloudKH" className="w-full h-full object-contain drop-shadow-[0_0_8px_rgba(0,210,255,0.7)]" />
              </div>
              <h2 className="text-lg font-extrabold text-white tracking-tight m-0">
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h2>
            </div>

            {/* Centered Segmented Pill Tabs */}
            <div className="flex justify-center w-full mb-3.5">
              <div className="grid grid-cols-2 gap-1 w-full max-w-[230px] bg-white/[0.04] p-1 rounded-full border border-white/[0.08]">
                <button
                  type="button"
                  className={`py-1.5 px-3.5 text-[11px] font-bold rounded-full transition-all text-center cursor-pointer border-0 ${
                    authMode === 'login'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_3px_12px_rgba(0,82,255,0.4)]'
                      : 'bg-transparent text-indigo-200/70 hover:text-white'
                  }`}
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`py-1.5 px-3.5 text-[11px] font-bold rounded-full transition-all text-center cursor-pointer border-0 ${
                    authMode === 'register'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-400 text-white shadow-[0_3px_12px_rgba(0,82,255,0.4)]'
                      : 'bg-transparent text-indigo-200/70 hover:text-white'
                  }`}
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                  }}
                >
                  Sign Up
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-xs font-medium mb-3 flex items-center gap-2 leading-snug">
                <AlertTriangleIcon size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {authMode === 'register' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Full Name</label>
                  <div className="relative flex items-center w-full group">
                    <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                    <input
                      type="text"
                      placeholder="Your Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={submitting}
                      className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Email Address</label>
                <div className="relative flex items-center w-full group">
                  <MailIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={submitting}
                    className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-extrabold text-indigo-200/70 uppercase tracking-wider">Password</label>
                <div className="relative flex items-center w-full group">
                  <LockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-cyan-400 pointer-events-none transition-colors z-10" size={16} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={submitting}
                    className="w-full bg-white/5 focus:bg-white/[0.08] border border-white/12 focus:border-cyan-400 py-2.5 px-10 rounded-lg text-white text-sm outline-none transition-all focus:shadow-[0_0_14px_rgba(0,210,255,0.25)] placeholder:text-white/30"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 text-white/40 hover:text-cyan-400 p-1 flex items-center justify-center transition-colors z-10 cursor-pointer"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </div>

              {/* Centered Compact Submit Button */}
              <div className="flex justify-center w-full mt-1.5">
                <button
                  type="submit"
                  className="w-auto min-w-[170px] max-w-[220px] bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-xs font-extrabold tracking-wide py-2.5 px-6 rounded-full border-0 cursor-pointer shadow-[0_4px_16px_rgba(0,82,255,0.35)] hover:shadow-[0_8px_22px_rgba(0,210,255,0.5)] hover:-translate-y-0.5 transition-all inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  disabled={submitting}
                >
                  {submitting
                    ? 'Please wait...'
                    : authMode === 'login'
                    ? 'Sign In'
                    : 'Create Account'}
                </button>
              </div>
            </form>

            <div className="text-center mt-3 text-xs text-indigo-200/70">
              {authMode === 'login' ? (
                <p className="m-0">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    className="bg-transparent border-0 text-cyan-400 hover:text-white font-bold cursor-pointer p-0 underline transition-colors"
                    onClick={() => {
                      setAuthMode('register');
                      setError(null);
                    }}
                  >
                    Sign Up
                  </button>
                </p>
              ) : (
                <p className="m-0">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="bg-transparent border-0 text-cyan-400 hover:text-white font-bold cursor-pointer p-0 underline transition-colors"
                    onClick={() => {
                      setAuthMode('login');
                      setError(null);
                    }}
                  >
                    Sign In
                  </button>
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


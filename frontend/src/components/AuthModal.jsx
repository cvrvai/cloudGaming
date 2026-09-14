import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MailIcon, LockIcon, UserIcon, EyeIcon, EyeOffIcon, ShieldCheckIcon, KeyIcon } from './Icons';

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
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal-dialog glass-panel auth-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={handleClose}>
          ✕
        </button>

        {mfaChallenge ? (
          <div className="mfa-container">
            <div className="auth-header">
              <div className="auth-logo-badge mfa-logo-badge">
                <ShieldCheckIcon className="mfa-badge-icon" size={24} />
              </div>
              <h2>Security Verification</h2>
              <p className="auth-subtitle" style={{ marginTop: '4px' }}>
                Two-step authentication is active for administrator access
              </p>
            </div>

            {mfaChallenge.mfa_setup_required && (
              <div className="mfa-setup-box">
                <div className="mfa-setup-badge-row">
                  <KeyIcon size={14} className="mfa-setup-icon" />
                  <span className="mfa-setup-title">First-Time Setup Required</span>
                </div>
                <p className="mfa-setup-desc">
                  Enter this secret key in Google Authenticator or 1Password:
                </p>
                <div className="mfa-secret-box">
                  <code className="mfa-secret-code">{mfaChallenge.secret}</code>
                  <button
                    type="button"
                    className="mfa-copy-btn"
                    onClick={() => {
                      if (mfaChallenge.secret) {
                        navigator.clipboard.writeText(mfaChallenge.secret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 2000);
                      }
                    }}
                  >
                    {copiedSecret ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {mfaError && <div className="auth-error-banner">⚠️ {mfaError}</div>}

            <form onSubmit={handleMfaSubmit} className="auth-form">
              <div className="form-group">
                <label style={{ textAlign: 'center', width: '100%', display: 'block' }}>
                  Enter 6-Digit Security Code
                </label>
                <div className="mfa-input-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="000000"
                    value={mfaCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setMfaCode(val);
                    }}
                    className="mfa-code-input"
                    disabled={mfaSubmitting}
                  />
                </div>
                <div className="mfa-helper-text">
                  Codes refresh every 30 seconds. 5 attempts remaining before lockout.
                </div>
              </div>

              <div className="auth-submit-wrapper">
                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={mfaSubmitting || mfaCode.length !== 6}
                >
                  {mfaSubmitting ? 'Verifying...' : 'Verify & Enter Dashboard'}
                </button>
              </div>
            </form>

            <div className="auth-footer-prompt">
              <button
                type="button"
                className="auth-text-link"
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
            <div className="auth-header">
              <div className="auth-logo-badge">
                <img src="/logo_transparent.png" alt="CloudKH" className="auth-logo-img" />
              </div>
              <h2>{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
            </div>

            {/* Centered Segmented Pill Tabs */}
            <div className="auth-tab-switch-wrapper">
              <div className="auth-tab-switch">
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                  }}
                >
                  Sign Up
                </button>
              </div>
            </div>

            {error && <div className="auth-error-banner">⚠️ {error}</div>}

            <form onSubmit={handleSubmit} className="auth-form">
              {authMode === 'register' && (
                <div className="form-group">
                  <label>Full Name</label>
                  <div className="auth-input-wrap">
                    <UserIcon className="input-field-icon" size={16} />
                    <input
                      type="text"
                      placeholder="Your Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Email Address</label>
                <div className="auth-input-wrap">
                  <MailIcon className="input-field-icon" size={16} />
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Password</label>
                <div className="auth-input-wrap">
                  <LockIcon className="input-field-icon" size={16} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="btn-toggle-pw"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </div>

              {/* Centered Compact Submit Button */}
              <div className="auth-submit-wrapper">
                <button type="submit" className="auth-submit-btn" disabled={submitting}>
                  {submitting
                    ? 'Please wait...'
                    : authMode === 'login'
                    ? 'Sign In'
                    : 'Create Account'}
                </button>
              </div>
            </form>

            <div className="auth-footer-prompt">
              {authMode === 'login' ? (
                <p>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    className="auth-text-link"
                    onClick={() => {
                      setAuthMode('register');
                      setError(null);
                    }}
                  >
                    Sign Up
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="auth-text-link"
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


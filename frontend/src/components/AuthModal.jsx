import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MailIcon, LockIcon, UserIcon, EyeIcon, EyeOffIcon } from './Icons';

export default function AuthModal() {
  const { authModalOpen, setAuthModalOpen, authMode, setAuthMode, login, register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!authModalOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (authMode === 'login') {
        await login(email, password);
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

  return (
    <div className="modal-backdrop" onClick={() => setAuthModalOpen(false)}>
      <div className="modal-dialog glass-panel auth-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={() => setAuthModalOpen(false)}>
          ✕
        </button>

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
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE } from '../config';

const AuthContext = createContext(null);
const AUTH_TOKEN_KEY = 'cloudkh_token';
const AUTH_USER_KEY = 'cloudkh_user';
const AUTH_VERIFY_TIMEOUT_MS = 5000;

function readStoredUser() {
  try {
    const storedUser = localStorage.getItem(AUTH_USER_KEY);
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    return null;
  }
}

function readTokenUser(token) {
  // This is only an optimistic display fallback. API authorization always
  // uses the signed bearer token and server-side verification.
  try {
    const payloadPart = token?.split('.')[1];
    if (!payloadPart) return null;

    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const claims = JSON.parse(atob(padded));
    if (!claims.sub || !claims.email) return null;

    return {
      id: claims.sub,
      name: claims.email.split('@')[0],
      email: claims.email,
      role: claims.role || 'user',
      mfa_verified: claims.mfa_verified === true,
    };
  } catch {
    return null;
  }
}

function persistStoredUser(nextUser) {
  try {
    if (nextUser) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser));
    } else {
      localStorage.removeItem(AUTH_USER_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing or restrictive environments.
  }
}

function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // The in-memory state is still cleared below.
  }
  persistStoredUser(null);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_VERIFY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }) {
  const [initialAuth] = useState(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUser = token ? readStoredUser() : null;
    return {
      token,
      user: storedUser || readTokenUser(token),
    };
  });
  const [user, setUser] = useState(initialAuth.user);
  const [token, setToken] = useState(initialAuth.token);
  const [loading, setLoading] = useState(Boolean(initialAuth.token && !initialAuth.user));
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'

  // Show the cached identity immediately, then verify it in the background.
  useEffect(() => {
    let cancelled = false;

    const fetchMe = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      const cachedUser = readStoredUser();
      setLoading(!cachedUser);

      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setUser(data);
            persistStoredUser(data);
          }
        } else if (res.status === 401 || res.status === 403) {
          // Only clear auth for an explicit authorization failure. Keep the
          // cached identity during temporary backend/network failures.
          if (!cancelled) {
            clearStoredAuth();
            setToken(null);
            setUser(null);
          }
        } else if (!cachedUser && !cancelled) {
          setUser(null);
        }
      } catch (err) {
        if (!cancelled && !cachedUser) setUser(null);
        if (err.name !== 'AbortError') {
          console.warn('Background session verification failed:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchMe();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Login failed');
    }
    // If backend requires 2-step MFA, return challenge payload without closing modal
    if (data.status === 'mfa_required') {
      return data;
    }
    localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
    persistStoredUser(data.user);
    setToken(data.access_token);
    setUser(data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  const verifyMfa = async (challengeId, code) => {
    const res = await fetch(`${API_BASE}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'MFA verification failed');
    }
    localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
    persistStoredUser(data.user);
    setToken(data.access_token);
    setUser(data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  const register = async (name, email, password, role = 'student') => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Registration failed');
    }
    localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
    persistStoredUser(data.user);
    setToken(data.access_token);
    setUser(data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  const updateProfile = async (name) => {
    const res = await fetch(`${API_BASE}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to update profile');
    }
    setUser((prev) => {
      const nextUser = { ...prev, ...data.user };
      persistStoredUser(nextUser);
      return nextUser;
    });
    return data.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const res = await fetch(`${API_BASE}/api/auth/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to change password');
    }
    return data;
  };

  const fetchStats = async () => {
    const res = await fetch(`${API_BASE}/api/auth/stats`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error('Failed to fetch stats');
    }
    return await res.json();
  };

  const logout = () => {
    clearStoredAuth();
    setToken(null);
    setUser(null);
  };

  const openAuth = (mode = 'login') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        verifyMfa,
        register,
        updateProfile,
        changePassword,
        fetchStats,
        logout,
        authModalOpen,
        setAuthModalOpen,
        authMode,
        setAuthMode,
        openAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

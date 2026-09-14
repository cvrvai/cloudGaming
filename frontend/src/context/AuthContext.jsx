import { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE } from '../config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('cloudkh_token'));
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'

  // Fetch current user whenever token changes
  useEffect(() => {
    let cancelled = false;

    const fetchMe = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setUser(data);
        } else {
          // Token invalid or expired
          if (!cancelled) {
            localStorage.removeItem('cloudkh_token');
            setToken(null);
            setUser(null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch authenticated user:', err);
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
    localStorage.setItem('cloudkh_token', data.access_token);
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
    localStorage.setItem('cloudkh_token', data.access_token);
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
    localStorage.setItem('cloudkh_token', data.access_token);
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
    setUser((prev) => ({ ...prev, ...data.user }));
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
    localStorage.removeItem('cloudkh_token');
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

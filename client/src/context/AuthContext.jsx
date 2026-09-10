import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * Who is signed in.
 *
 * The token is kept in localStorage so a refresh does not sign you out, and
 * attached to every request by an axios interceptor. Being signed out is a
 * normal state, not an error — the patient flow works without an account.
 */

const AuthContext = createContext(null);
const TOKEN_KEY = 'healai.token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  // Keep axios and storage in step with whatever the token currently is.
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      localStorage.removeItem(TOKEN_KEY);
      delete api.defaults.headers.common.Authorization;
    }
  }, [token]);

  // Revalidate on load: a stored token may have expired while the tab was shut.
  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return;
    }
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    api
      .get('/auth/me')
      .then((r) => alive && setUser(r.data.user))
      .catch(() => alive && setToken(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = ({ token: t, user: u }) => {
    setToken(t);
    setUser(u);
    return u;
  };

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    return adopt(data);
  }, []);

  const register = useCallback(async (body) => {
    const { data } = await api.post('/auth/register', body);
    return adopt(data);
  }, []);

  const demoLogin = useCallback(async (role) => {
    const { data } = await api.post('/auth/demo', { role });
    return adopt(data);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthed: Boolean(user),
      is: (role) => user?.role === role,
      login,
      register,
      demoLogin,
      logout,
    }),
    [user, loading, login, register, demoLogin, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

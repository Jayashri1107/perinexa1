// Who is logged in. The session itself is the server's httpOnly cookie; this only mirrors it for the screens.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SESSION_EXPIRED_EVENT } from '../api/http.js';
import { authApi } from '../api/index.js';
import { useIdleLogout } from '../hooks/useIdleLogout.js';
import { useAppConfig } from './AppConfigContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { sessionTimeoutMinutes } = useAppConfig();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [endReason, setEndReason] = useState('');

  useEffect(() => {
    authApi
      .me()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setEndReason('');
    setSession(data);
    return data;
  }, []);

  const logout = useCallback(async (reason = '') => {
    await authApi.logout().catch(() => {});
    setEndReason(reason);
    setSession(null);
  }, []);

  const changePassword = useCallback(async (data) => {
    setSession(await authApi.changePassword(data));
  }, []);

  // The server ended the session (expired, deactivated, password reset elsewhere).
  useEffect(() => {
    const onExpired = () => {
      setEndReason('Your session has ended. Please log in again.');
      setSession(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useIdleLogout(Boolean(session), sessionTimeoutMinutes, () =>
    logout(`You were logged out after ${sessionTimeoutMinutes} minutes without activity.`),
  );

  const value = useMemo(
    () => ({ user: session?.user ?? null, memberships: session?.memberships ?? [], loading, endReason, login, logout, changePassword }),
    [session, loading, endReason, login, logout, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

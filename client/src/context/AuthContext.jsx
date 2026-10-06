// Who is logged in, and which hospital they work in. The session itself is the server's httpOnly cookie;
// this only mirrors it for the screens.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { HOSPITAL_CHANGED_EVENT, SESSION_EXPIRED_EVENT, setActiveHospital } from '../api/http.js';
import { authApi } from '../api/index.js';
import { useIdleLogout } from '../hooks/useIdleLogout.js';
import { useAppConfig } from './AppConfigContext.jsx';

const AuthContext = createContext(null);

// Each person's appearance choices, applied to the whole page (styles/app.css reads these attributes).
function applyAppearance(user) {
  const root = document.documentElement;
  const prefs = user?.preferences ?? {};
  for (const key of ['textSize', 'density']) {
    if (prefs[key]) root.dataset[key] = prefs[key];
    else delete root.dataset[key];
  }
}

export function AuthProvider({ children }) {
  const { sessionTimeoutMinutes, adminRole, access } = useAppConfig();
  const [session, setSessionState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [endReason, setEndReason] = useState('');

  const setSession = useCallback((data) => {
    setActiveHospital(data?.activeHospitalId ?? null);
    applyAppearance(data?.user);
    setSessionState(data);
  }, []);

  const refresh = useCallback(
    () =>
      authApi
        .me()
        .then(setSession)
        .catch(() => setSession(null)),
    [setSession],
  );

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (credentials) => {
      const data = await authApi.login(credentials);
      setEndReason('');
      setSession(data);
      return data;
    },
    [setSession],
  );

  const logout = useCallback(
    async (reason = '') => {
      await authApi.logout().catch(() => {});
      setEndReason(reason);
      setSession(null);
    },
    [setSession],
  );

  const changePassword = useCallback(async (data) => setSession(await authApi.changePassword(data)), [setSession]);
  const switchHospital = useCallback(async (hospitalId) => setSession(await authApi.switchHospital(hospitalId)), [setSession]);
  const leaveHospital = useCallback(async () => setSession(await authApi.leaveHospital()), [setSession]);
  // After saving My settings (appearance, professional details).
  const updateUser = useCallback((user) => setSession({ ...session, user }), [session, setSession]);

  // The server ended the session (expired, deactivated, password reset elsewhere), or another tab switched hospital.
  useEffect(() => {
    const onExpired = () => {
      setEndReason('Your session has ended. Please log in again.');
      setSession(null);
    };
    const onHospitalChanged = () => refresh();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener(HOSPITAL_CHANGED_EVENT, onHospitalChanged);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener(HOSPITAL_CHANGED_EVENT, onHospitalChanged);
    };
  }, [refresh, setSession]);

  useIdleLogout(Boolean(session), sessionTimeoutMinutes, () =>
    logout(`You were logged out after ${sessionTimeoutMinutes} minutes without activity.`),
  );

  const value = useMemo(() => {
    const memberships = session?.memberships ?? [];
    const activeHospitalId = session?.activeHospitalId ?? null;
    const activeMembership = memberships.find((m) => m.hospital.id === activeHospitalId) ?? null;
    const roles = activeMembership?.roles ?? [];
    const hasRole = (...wanted) => roles.some((r) => wanted.includes(r));
    return {
      user: session?.user ?? null,
      memberships,
      activeHospitalId,
      activeMembership,
      roles,
      hasRole,
      // access key from config.access (patients, billing, pharmacy …), or 'admin' for the hospital admin role
      canAccess: (key) => (key === 'admin' ? roles.includes(adminRole) : hasRole(...(access[key] ?? []))),
      isHospitalAdmin: roles.includes(adminRole),
      isSuperAdminInHospital: Boolean(session?.user?.isSuperAdmin && activeHospitalId),
      loading,
      endReason,
      login,
      logout,
      changePassword,
      switchHospital,
      leaveHospital,
      updateUser,
      refresh,
    };
  }, [session, loading, endReason, login, logout, changePassword, switchHospital, leaveHospital, updateUser, refresh, adminRole, access]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

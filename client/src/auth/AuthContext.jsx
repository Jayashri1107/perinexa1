import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setActiveTenant, setSessionEndedHandler, setTenantMismatchHandler } from '../api.js';
import { STANDARD_APPEARANCE, applyAppearance, forgetAppearance, normalizeAppearance, rememberAppearance } from '../appearance.js';

// The email the sign-in fills in once, after "Switch to your doctor account" (read and removed by LoginPage).
export const LOGIN_EMAIL_KEY = 'perinexa:loginEmail';

// A super admin or platform admin who opens a hospital works there with every role (owner, 12 Oct 2026)
const ALL_ROLES = ['admin', 'doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'];

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const ACTIVITY_KEY = 'perinexa:lastActivity'; // shared between tabs; contains only a timestamp
const WARNING_MS = 60 * 1000; // show a warning 1 minute before automatic logout
const KEEPALIVE_MS = 5 * 60 * 1000; // tell the server we're still active at most every 5 minutes
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel', 'perinexa:activity']; // the last: words heard in voice entry

const readLastActivity = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || Date.now();
  } catch {
    return Date.now();
  }
};
const writeLastActivity = (t) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t));
  } catch {
    /* storage unavailable: this tab still tracks its own activity */
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  // Super admins and platform admins: role, rights, the hospital whose setup is open, the linked hospital account
  const [platform, setPlatform] = useState(null);
  // A super admin working in their own doctor account: "Switch back to super admin" is offered (21 Oct 2026)
  const [switchBack, setSwitchBack] = useState(false);
  const [activeTenantId, setActiveTenantId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [logoutReason, setLogoutReason] = useState(null);
  const [tenantNotice, setTenantNotice] = useState(null); // e.g. "Switched to X in another tab"
  const [secondsLeft, setSecondsLeft] = useState(null); // countdown shown in the idle warning
  const channel = useRef(null);

  const applySession = useCallback((data) => {
    setActiveTenant(data.activeTenantId);
    setUser(data.user);
    setMemberships(data.memberships ?? []);
    setPlatform(data.platform ?? null);
    setSwitchBack(Boolean(data.switchBack));
    setActiveTenantId(data.activeTenantId ?? null);
    if (data.sessionTimeoutMinutes) setTimeoutMinutes(data.sessionTimeoutMinutes);
  }, []);

  const endSession = useCallback((reason) => {
    setActiveTenant(null);
    setUser(null);
    setMemberships([]);
    setPlatform(null);
    setSwitchBack(false);
    setActiveTenantId(null);
    setSecondsLeft(null);
    setTenantNotice(null);
    setLogoutReason(reason);
  }, []);

  // Re-read the session from the server (who am I, which hospital is selected).
  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/me');
      applySession(data);
      return data;
    } catch {
      return null;
    }
  }, [applySession]);

  // Other tabs: logging out or switching hospital in one tab updates all tabs.
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return undefined;
    channel.current = new BroadcastChannel('perinexa-auth');
    channel.current.onmessage = async (e) => {
      if (e.data?.type === 'logout') endSession(e.data.reason);
      if (e.data?.type === 'appearance') refresh(); // changed on My settings → Appearance in another tab
      if (e.data?.type === 'account') refresh(); // switched between super admin and their doctor account in another tab
      if (e.data?.type === 'tenant') {
        const data = await refresh();
        const name = data?.memberships.find((m) => m.tenantId === data.activeTenantId)?.tenantName;
        if (name) setTenantNotice(`You switched to ${name} in another tab, so this tab switched too.`);
      }
    };
    return () => channel.current?.close();
  }, [endSession, refresh]);

  const logout = useCallback(
    async (reason = 'manual') => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch {
        /* even if the server can't be reached, forget the user locally */
      }
      endSession(reason);
      channel.current?.postMessage({ type: 'logout', reason });
    },
    [endSession],
  );

  // On startup: ask the server whether we already have a valid session.
  useEffect(() => {
    setSessionEndedHandler(() => endSession('expired'));
    setTenantMismatchHandler(async () => {
      await refresh();
      setTenantNotice('The selected hospital changed, so this page was reloaded. Check it before saving again.');
    });
    api('/auth/me')
      .then((data) => {
        applySession(data);
        writeLastActivity(Date.now());
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [endSession, refresh, applySession]);

  // The person's own look while logged in (My settings → Appearance); the standard look otherwise, e.g. on the
  // login page of a shared computer.
  useEffect(() => {
    if (loading) return;
    if (user) {
      const look = normalizeAppearance(user.preferences?.appearance);
      applyAppearance(look);
      rememberAppearance(look);
    } else {
      applyAppearance(STANDARD_APPEARANCE);
      forgetAppearance();
    }
  }, [user, loading]);

  // My settings → Appearance: shown at once, saved to the account in the order chosen, and passed on to the
  // person's other tabs. If a save fails, the look saved on the account comes back.
  const appearanceSaves = useRef(Promise.resolve());
  const saveAppearance = useCallback(
    (next) => {
      setUser((u) => (u ? { ...u, preferences: { ...u.preferences, appearance: next } } : u));
      const save = appearanceSaves.current.then(() => api('/auth/me/appearance', { method: 'PUT', body: next }));
      appearanceSaves.current = save.catch(() => {});
      return save.then(
        () => channel.current?.postMessage({ type: 'appearance' }),
        async (err) => {
          await refresh();
          throw err;
        },
      );
    },
    [refresh],
  );

  // Automatic logout after inactivity (common requirement in medical software).
  useEffect(() => {
    if (!user) return undefined;
    const idleMs = timeoutMinutes * 60 * 1000;
    let lastWrite = 0;
    let lastKeepAlive = Date.now();

    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 2000) {
        lastWrite = now;
        writeLastActivity(now);
      }
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    writeLastActivity(Date.now());

    const timer = setInterval(() => {
      const now = Date.now();
      const last = readLastActivity();
      const idle = now - last;
      if (idle >= idleMs) {
        clearInterval(timer);
        logout('idle');
        return;
      }
      setSecondsLeft(idle >= idleMs - WARNING_MS ? Math.ceil((idleMs - idle) / 1000) : null);
      // Keep the server-side session alive while the person is actively using the app.
      if (last > lastKeepAlive && now - lastKeepAlive >= KEEPALIVE_MS) {
        lastKeepAlive = now;
        api('/auth/me').catch(() => {});
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(timer);
    };
  }, [user, timeoutMinutes, logout]);

  const login = async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    writeLastActivity(Date.now());
    setLogoutReason(null);
    applySession(data);
    return data.user;
  };

  const switchTenant = async (tenantId) => {
    const data = await api('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
    applySession(data);
    setTenantNotice(null);
    channel.current?.postMessage({ type: 'tenant', tenantId });
  };

  const stayLoggedIn = () => {
    writeLastActivity(Date.now());
    setSecondsLeft(null);
    api('/auth/me').catch(() => {});
  };

  // A super admin or platform admin who opened a hospital's setup works there as its admin (setup pages only)
  const platformHospital = platform?.hospital ?? null;
  const activeMembership =
    memberships.find((m) => m.tenantId === activeTenantId) ??
    (platformHospital && platformHospital.tenantId === activeTenantId
      ? { tenantId: platformHospital.tenantId, tenantName: platformHospital.tenantName, roles: ALL_ROLES, platform: true, readOnly: platformHospital.readOnly }
      : null);

  /** Super admins and platform admins: open a hospital's setup (tenantId), or go back to the platform (null). */
  const openHospital = async (tenantId) => {
    const data = await api('/auth/open-hospital', { method: 'POST', body: { tenantId } });
    applySession(data);
    setTenantNotice(null);
    channel.current?.postMessage({ type: 'tenant', tenantId });
  };

  /** "Switch to your doctor account": sign out here, then the sign-in opens with that account's email filled in. */
  // Switch to the linked doctor account with its own password (owner, 13 Oct 2026): signed in at once, this browser
  // then works as the doctor. Without a password: logged out with the doctor's email filled in on the login page.
  // A super admin with no linked account yet gives the doctor account's email the first time (owner, 13 Oct 2026): it
  // is linked, then signed in with its own password; a wrong password removes the link again (they are still signed in
  // here, so the link can be undone).
  const switchToLinkedAccount = async (password, firstEmail = null) => {
    const linkedEmail = platform?.linkedAccount?.email;
    const email = linkedEmail ?? firstEmail;
    if (!email) return;
    if (!linkedEmail) {
      await api(`/platform/users/${user.id}/linked-account`, { method: 'PATCH', body: { email } });
      try {
        await login(email, password);
      } catch (err) {
        await api(`/platform/users/${user.id}/linked-account`, { method: 'PATCH', body: { email: null } }).catch(() => {});
        throw err;
      }
      return;
    }
    if (password) {
      await login(email, password);
      return;
    }
    try {
      sessionStorage.setItem(LOGIN_EMAIL_KEY, email);
    } catch {
      /* the email is simply not filled in */
    }
    await logout('switch');
  };

  // A super admin who is also a doctor – one login (21 Oct 2026). Their own doctor account: made for a hospital here,
  // entered without a password; going back up asks for the super admin password. Every tab follows.
  const makeDoctorAccount = async (tenantId) => {
    const data = await api('/auth/me/doctor-account', { method: 'POST', body: { tenantId } });
    setPlatform(data.platform ?? null);
    return data;
  };
  const switchToDoctor = async () => {
    const data = await api('/auth/switch-to-doctor', { method: 'POST', body: {} });
    applySession(data);
    setTenantNotice(null);
    channel.current?.postMessage({ type: 'account' });
  };
  const switchToSuperAdmin = async (password) => {
    const data = await api('/auth/switch-to-super-admin', { method: 'POST', body: { password } });
    applySession(data);
    setTenantNotice(null);
    channel.current?.postMessage({ type: 'account' });
  };

  const value = {
    user,
    setUser,
    loading,
    login,
    logout,
    logoutReason,
    timeoutMinutes,
    secondsLeft,
    stayLoggedIn,
    memberships,
    activeTenantId,
    activeMembership,
    switchTenant,
    platform,
    isPlatform: Boolean(user?.isSuperAdmin || user?.isPlatformAdmin),
    openHospital,
    switchToLinkedAccount,
    switchBack,
    makeDoctorAccount,
    switchToDoctor,
    switchToSuperAdmin,
    saveAppearance,
    tenantNotice,
    clearTenantNotice: () => setTenantNotice(null),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

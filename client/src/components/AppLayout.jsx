import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Building2, CircleAlert, CircleHelp, Eye, KeyRound, LogOut, Mail, Menu, ShieldCheck, Stethoscope, UserCog } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import appIcon from '../assets/brand/perinexa-app-icon.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAuth } from '../auth/AuthContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { CARE_TYPES } from '../pages/patients/patientFormat.js';
import { ACCOUNT_MODULE, PLATFORM_AREA_LABELS, hospitalModules, platformModules, seesPatientList } from '../platform/modules.js';
import { ChangePasswordDialog } from './ChangePasswordDialog.jsx';
import { useTextShortcuts } from '../shortcuts/useTextShortcuts.js';
import { CommandBox } from './CommandBox.jsx';
import { PatientSearch } from './PatientSearch.jsx';
import { IdleWarning } from './Layout.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { PasswordInput } from './PasswordInput.jsx';
import { Alert, Avatar, Field, rolesLabel, useDialogFocus } from './ui.jsx';

// The new-patient form (before anything is saved): /patients/new or /patients/new/<type of care>
const REGISTERING = new RegExp(`^/patients/new(?:/(?:${CARE_TYPES.join('|')}))?/?$`);

const COLLAPSE_KEY = 'perinexa:sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

// Under 1024 px the sidebar is always the 88 px icon rail (brand guide page 7).
const RAIL_QUERY = '(max-width: 1023px)';
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Closes a pop-up on a click outside it or on Escape. */
function useDismiss(open, setOpen, box) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, box]);
}

/** "Super admin" or "Platform admin" (null for hospital staff). */
const platformRoleLabel = (platform) => (platform?.role === 'superadmin' ? 'Super admin' : platform?.role === 'platformadmin' ? 'Platform admin' : null);

// A menu item: an icon tile and the label (only the tile in the icon rail).
function SideLink({ module, rail, onNavigate }) {
  const Icon = module.icon;
  const { pathname } = useLocation();
  // activeFor: the item also stays highlighted on its other pages (e.g. Care plans → Red-flag rules)
  const inSection = [module.activeFor ?? []].flat().some((prefix) => pathname.startsWith(prefix));
  return (
    <NavLink
      to={module.to}
      end={module.end}
      className={({ isActive }) => `sb-link ${isActive || inSection ? 'active' : ''}`}
      title={rail ? module.label : undefined}
      aria-label={rail ? module.label : undefined}
      onClick={onNavigate}
    >
      <span className="sb-tile" aria-hidden="true">
        <Icon />
      </span>
      <span className="sb-label">{module.label}</span>
    </NavLink>
  );
}

// Top bar, left: the hospital being worked in ("Working in"), with a switch for people who work at more than one.
const todayWords = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');

function Workspace() {
  const { user, memberships, activeTenantId, activeMembership, switchTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!activeMembership) return null;

  const choose = async (tenantId) => {
    if (!tenantId || tenantId === activeTenantId) return;
    setBusy(true);
    setError(null);
    try {
      await switchTenant(tenantId);
      // A patient page from the previous hospital doesn't exist in the new one (a new-patient form stays).
      if (/^\/patients\/.+/.test(location.pathname) && !REGISTERING.test(location.pathname)) navigate('/patients');
      // Nor does a list of the previous hospital's patients from Analytics.
      if (/^\/analytics\/list\/?$/.test(location.pathname)) navigate('/analytics');
    } catch (err) {
      setError(`Couldn't switch hospital – ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws" aria-label="The hospital you are working in">
      <span className="ws-icon" aria-hidden="true">
        <Building2 />
      </span>
      <div className="ws-text">
        <strong className="ws-name" title={activeMembership.platform ? 'Every role – records you open are audited' : rolesLabel(activeMembership.roles)}>
          {activeMembership.tenantName}
        </strong>
        <span className="ws-who">{[user?.name, todayWords()].filter(Boolean).join(' · ')}</span>
      </div>
      {memberships.length > 1 && (
        <label className="ws-switch">
          <span className="sr-only">Switch hospital</span>
          <select value={activeTenantId ?? ''} onChange={(e) => choose(e.target.value)} disabled={busy}>
            {memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.tenantName}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <span className="ws-error" role="alert">
          <CircleAlert aria-hidden="true" /> {error}
        </span>
      )}
    </div>
  );
}

/** "Help": opens the Help page (how to use Perinexa; the explanations on every screen are switched on there). */
function HelpLink() {
  return (
    <NavLink to="/help" className={({ isActive }) => `icon-btn pf-icon-btn pf-help${isActive ? ' is-on' : ''}`} title="Help – how to use Perinexa" aria-label="Help">
      <CircleHelp aria-hidden="true" />
    </NavLink>
  );
}

// The profile circle beside "Log out": click it for the name, email and role, Change password and My settings.
function ProfileMenu({ locked, onSwitch, onDoctorSetup, onRoleSwitch }) {
  const { user, activeMembership, platform, switchBack, roleMode } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false); // Change password, in a pop-up
  const box = useRef(null);
  useDismiss(open, setOpen, box);
  const role = platformRoleLabel(platform) ?? (activeMembership ? rolesLabel(activeMembership.roles) : null);

  return (
    <div className="pm" ref={box}>
      <button type="button" className="pm-btn" aria-haspopup="true" aria-expanded={open} aria-label={`Your profile: ${user.name}`} title={user.name} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.name} seed={user.email} photo={user.photo} />
      </button>
      {open && (
        <div className="pm-card" role="dialog" aria-label="Your profile">
          <div className="pm-head">
            <Avatar name={user.name} seed={user.email} photo={user.photo} large />
            <div className="pm-who">
              <strong className="pm-name">{user.name}</strong>
              {role && <span className="pill pm-role">{role}</span>}
            </div>
          </div>
          <dl className="pm-details">
            <div>
              <dt>
                <Mail aria-hidden="true" /> Email
              </dt>
              <dd>{user.email}</dd>
            </div>
            {activeMembership && (
              <div>
                <dt>
                  <Building2 aria-hidden="true" /> {activeMembership.platform ? 'Setting up' : 'Hospital'}
                </dt>
                <dd>{activeMembership.tenantName}</dd>
              </div>
            )}
          </dl>
          <div className="pm-links">
            {locked ? (
              <Link to="/change-password" className="pm-link" onClick={() => setOpen(false)}>
                <KeyRound aria-hidden="true" /> Change password
              </Link>
            ) : (
              <button
                type="button"
                className="pm-link"
                onClick={() => {
                  setOpen(false);
                  setChanging(true);
                }}
              >
                <KeyRound aria-hidden="true" /> Change password
              </button>
            )}
            {!locked && (
              <Link to={ACCOUNT_MODULE.to} className="pm-link" onClick={() => setOpen(false)}>
                <UserCog aria-hidden="true" /> My settings
              </Link>
            )}
            {(canSwitch(user, platform) || switchBack) && (
              <button
                type="button"
                className="pm-link"
                onClick={() => {
                  setOpen(false);
                  onSwitch();
                }}
              >
                <ArrowLeftRight aria-hidden="true" /> {switchLabel(switchBack)}
              </button>
            )}
            {activeMembership?.adminSwitch && !locked && (
              <button
                type="button"
                className="pm-link"
                onClick={() => {
                  setOpen(false);
                  onRoleSwitch();
                }}
              >
                <ShieldCheck aria-hidden="true" /> {roleSwitchLabel(roleMode, activeMembership)}
              </button>
            )}
            {user?.isSuperAdmin && !locked && (!platform?.linkedAccount || platform.linkedAccount.own) && (
              <button
                type="button"
                className="pm-link"
                onClick={() => {
                  setOpen(false);
                  onDoctorSetup();
                }}
              >
                <Stethoscope aria-hidden="true" /> Work as a doctor…
              </button>
            )}
          </div>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}

/**
 * The layout for every login, in the Perinexa1 style: the sidebar with a ☰ button beside the logo that folds it into an
 * icon rail (remembered in this browser), the hospital's name under the logo and the person's roles at its foot; a
 * white top bar with the hospital being worked in on the left and Help, the profile circle and Log out on the right.
 */
export function AppLayout() {
  const { user, logout, activeMembership, activeTenantId, tenantNotice, clearTenantNotice, isPlatform, platform, openHospital, switchBack, switchToDoctor, roleMode, switchToClinical } = useAuth();
  // Which switch dialog is open: 'down' (a doctor login linked by email – its password), 'up' (back to super admin – their
  // password), 'setup' (a super admin's own doctor account: choose the hospital); null: none
  const [switching, setSwitching] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [roleError, setRoleError] = useState(null);
  // Admin or clinical work (22 Oct 2026): to admin asks the password (a dialog), back to clinical work does not.
  const startRoleSwitch = async () => {
    setRoleError(null);
    if (roleMode !== 'admin') return setSwitching('admin');
    try {
      await switchToClinical();
      navigate('/', { replace: true });
    } catch (err) {
      setRoleError(err.message);
    }
    return undefined;
  };
  // "Switch to your doctor account" / "Switch back to super admin" (21 Oct 2026): a super admin's OWN doctor account
  // is entered at once, without a password; going back up asks for the super admin password.
  const startSwitch = async () => {
    setSetupError(null);
    if (switchBack) return setSwitching('up');
    if (platform?.linkedAccount?.own) {
      try {
        await switchToDoctor();
        navigate('/', { replace: true });
      } catch (err) {
        setSetupError(err.message);
        setSwitching('setup');
      }
      return undefined;
    }
    return setSwitching(user?.isSuperAdmin && !platform?.linkedAccount ? 'setup' : 'down');
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const railForced = useMediaQuery(RAIL_QUERY);
  const toggleRef = useRef(null);
  const openedFrom = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* not important if it can't be remembered */
    }
  }, [collapsed]);

  // Close the menu that opens over the page after navigating, or when the screen becomes wide again.
  useEffect(() => setMobileOpen(false), [location.pathname, railForced]);

  // Keyboard: when the menu opens over the page, focus moves into it and Escape closes it; when it closes,
  // focus goes back to the button that opened it.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    openedFrom.current = document.activeElement;
    toggleRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = openedFrom.current;
      if (back instanceof HTMLElement && back.isConnected && back.offsetParent !== null) back.focus();
    };
  }, [mobileOpen]);

  const locked = user.mustChangePassword; // only the password screen until they choose their own
  // "Find a patient" in the top bar: hospital staff who work with patient records.
  const searchable = !locked && seesPatientList(activeMembership?.roles ?? []);
  // Super admins and platform admins: the platform menu, or – with a hospital's setup open – its Hospital admin pages only
  const inSetup = Boolean(activeMembership?.platform);
  const modules = locked ? [] : isPlatform && !inSetup ? platformModules(platform) : hospitalModules(activeMembership?.roles);
  // Typing shortcuts in every text box (doctor ideas #3) – hospital staff
  useTextShortcuts(!isPlatform && !locked && Boolean(activeMembership));
  const closeMobile = () => setMobileOpen(false);
  // Icon rail: folded by the person, or automatically on narrower screens (unless the full menu is open).
  const rail = !mobileOpen && (collapsed || railForced);
  const toggleMenu = () => (railForced ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));
  const menuLabel = rail ? 'Expand menu' : 'Collapse menu';
  const hospitalName = activeMembership?.tenantName ?? null;
  const foot = platformRoleLabel(platform) ?? (activeMembership ? rolesLabel(activeMembership.roles) : null);
  // A platform admin changes only the areas a super admin gave them
  const viewOnly = platform?.role === 'platformadmin';
  const allowed = (platform?.permissions ?? []).map((a) => PLATFORM_AREA_LABELS[a]).join(', ');
  const backToPlatform = async () => {
    await openHospital(null);
    navigate('/platform/hospitals');
  };

  return (
    <div className={`pf ${collapsed ? 'pf-collapsed' : ''} ${mobileOpen ? 'pf-mobile-open' : ''}`}>
      <aside className="sb" id="main-menu" aria-label="Main navigation">
        <div className="sb-brand">
          <button type="button" className="sb-toggle" onClick={toggleMenu} aria-label={menuLabel} title={menuLabel} aria-expanded={!rail} aria-controls="main-menu" ref={toggleRef}>
            <Menu aria-hidden="true" />
          </button>
          <Link to="/" onClick={closeMobile} aria-label="Perinexa – start page">
            <img className="sb-logo" src={logoReversed} alt="Perinexa by Docvritta" width="150" height="37" />
            <img className="sb-appicon" src={appIcon} alt="Perinexa" width="40" height="40" />
          </Link>
        </div>
        {hospitalName && (
          <p className="sb-subtitle" title={hospitalName}>
            <Building2 aria-hidden="true" /> <span>{hospitalName}</span>
          </p>
        )}

        <nav className="sb-nav">
          {modules.map((m) => (
            <SideLink key={m.key} module={m} rail={rail} onNavigate={closeMobile} />
          ))}
          {!locked && <SideLink module={ACCOUNT_MODULE} rail={rail} onNavigate={closeMobile} />}
        </nav>
        {foot && (
          <div className="sb-foot" title={`${user.name} · ${foot}`}>
            <Avatar name={user.name} seed={user.email} photo={user.photo} />
            <span className="sb-foot-text">
              <strong>{user.name}</strong>
              <span>{foot}</span>
            </span>
          </div>
        )}
      </aside>
      <div className="sb-overlay" onClick={closeMobile} aria-hidden="true" />

      <div className="pf-body">
        <header className="pf-topbar">
          <div className="pf-topbar-start">
            <button type="button" className="icon-btn pf-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="main-menu">
              <Menu size={24} />
            </button>
            {(!isPlatform || inSetup) && !locked && <Workspace />}
          </div>
          {searchable && <PatientSearch key={activeTenantId} />}
          <div className="pf-topbar-actions">
            {/* One box for everything (Ctrl+K) – hospital staff (doctor ideas #1) */}
            {!isPlatform && !locked && <CommandBox key={activeTenantId} modules={modules} roles={activeMembership?.roles ?? []} />}
            {activeMembership?.adminSwitch && !locked && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={startRoleSwitch} title={roleMode === 'admin' ? 'Back to your patients – no password needed' : 'Admin pages (staff, settings, money) – asks for your password; no patient records there'}>
                <ShieldCheck aria-hidden="true" /> {roleSwitchLabel(roleMode, activeMembership)}
              </button>
            )}
            {(canSwitch(user, platform) || switchBack) && !locked && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={startSwitch} title={switchTitle(platform, switchBack)}>
                <ArrowLeftRight aria-hidden="true" /> {switchLabel(switchBack)}
              </button>
            )}
            {viewOnly && (
              <span className="pill pf-viewonly" title={allowed ? `You may change: ${allowed}. Everything else is view only.` : 'You can look at everything but change nothing.'}>
                <Eye aria-hidden="true" /> View only{allowed ? ' (mostly)' : ''}
              </span>
            )}
            {!isPlatform && !locked && activeMembership && <NotificationBell key={`bell-${activeTenantId}`} />}
            {!locked && <HelpLink />}
            <ProfileMenu locked={locked} onSwitch={startSwitch} onDoctorSetup={() => setSwitching('setup')} onRoleSwitch={startRoleSwitch} />
            <button type="button" className="icon-btn pf-icon-btn pf-logout" onClick={() => logout('manual')} title="Log out" aria-label="Log out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="pf-main" id="main">
          {inSetup && (
            <div className="pf-notice">
              <Alert type="info" icon={Building2}>
                You are working in <strong>{activeMembership.tenantName}</strong> as the {platformRoleLabel(platform)?.toLowerCase()}
                {platform?.role === 'platformadmin' ? ' – view only, apart from the setup you may change' : ''}. Every patient record you open is
                recorded in its audit log.{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={backToPlatform}>
                  <ArrowLeft aria-hidden="true" /> Back to the platform
                </button>
              </Alert>
            </div>
          )}
          {roleError && (
            <div className="pf-notice">
              <Alert type="error" onClose={() => setRoleError(null)}>
                {roleError}
              </Alert>
            </div>
          )}
          {tenantNotice && (
            <div className="pf-notice">
              <Alert type="warning" onClose={clearTenantNotice}>
                {tenantNotice}
              </Alert>
            </div>
          )}
          {/* Re-create the page when the hospital changes, so no data from the previous hospital stays on screen. */}
          <Outlet key={activeTenantId ?? 'platform'} />
        </main>
      </div>
      <IdleWarning />
      {switching === 'down' && canSwitch(user, platform) && <SwitchAccountDialog email={platform?.linkedAccount?.email ?? null} onClose={() => setSwitching(null)} />}
      {switching === 'up' && switchBack && <SwitchBackDialog onClose={() => setSwitching(null)} />}
      {switching === 'admin' && activeMembership?.adminSwitch && <AdminSwitchDialog superAdminPassword={switchBack} onClose={() => setSwitching(null)} />}
      {switching === 'setup' && user?.isSuperAdmin && (
        <DoctorAccountDialog error={setupError} onOtherLogin={platform?.linkedAccount ? null : () => setSwitching('down')} onClose={() => setSwitching(null)} />
      )}
    </div>
  );
}

/**
 * Switch to the linked doctor account (super admins and platform admins who are also doctors): its password is asked
 * here and it is signed in at once – this browser then works as the doctor. Logging in is audited as for any login.
 */
// Who sees "Switch to your doctor account": anyone with a linked doctor account, and every super admin – who gives the
// doctor account's email the first time (owner, 13 Oct 2026).
const canSwitch = (user, platform) => Boolean(platform?.linkedAccount || user?.isSuperAdmin);
/** The admin / clinical switch's words: to admin, or back to the clinical roles (e.g. "Switch to Doctor"). */
export const roleSwitchLabel = (roleMode, membership) => (roleMode === 'admin' ? `Switch to ${rolesLabel(membership?.clinicalRoles ?? []) || 'clinical work'}` : 'Switch to admin');
export const switchLabel = (switchBack) => (switchBack ? 'Switch back to super admin' : 'Switch to your doctor account');
export const switchTitle = (platform, switchBack) => {
  if (switchBack) return 'Back to the super admin pages – asks for your super admin password';
  if (platform?.linkedAccount?.own) return 'Work as a doctor – no password needed (your own doctor account)';
  return platform?.linkedAccount ? `Switch to ${platform.linkedAccount.email} – asks for its password` : 'Set up your doctor account';
};

function SwitchAccountDialog({ email, onClose }) {
  const { switchToLinkedAccount } = useAuth();
  const navigate = useNavigate();
  const ref = useDialogFocus(onClose);
  const [password, setPassword] = useState('');
  const [firstEmail, setFirstEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await switchToLinkedAccount(password, email ? null : firstEmail.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.code === 'INVALID_LOGIN' ? 'That email and password do not match your doctor account.' : err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-title" onSubmit={submit} noValidate>
        <h2 id="switch-title">Switch to your doctor account</h2>
        {email ? (
          <p>
            You will work as <strong>{email}</strong>. Type that account's password.
          </p>
        ) : (
          <p>Type the email and password of your doctor account. It is remembered for the next switch; the password is asked every time.</p>
        )}
        <Alert type="error">{error}</Alert>
        {!email && (
          <Field label="Email of your doctor account" id="switch-email">
            <input id="switch-email" type="email" autoComplete="username" value={firstEmail} onChange={(e) => setFirstEmail(e.target.value)} maxLength={254} autoFocus />
          </Field>
        )}
        <Field label="Password of your doctor account" id="switch-password">
          <PasswordInput id="switch-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={Boolean(email)} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!password || (!email && !firstEmail.trim()) || busy}>
            <ArrowLeftRight aria-hidden="true" /> {busy ? 'Switching…' : 'Switch'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * "Work as a doctor" (21 Oct 2026): a super admin who is also a doctor gets their own doctor account – one login, no
 * second email or password (it is their email with "+doctor") – tagged as a doctor in the hospital chosen here, and
 * this browser switches to it. Again later for another hospital.
 */
export function DoctorAccountDialog({ error: startError, onOtherLogin, onClose }) {
  const { platform, makeDoctorAccount, switchToDoctor } = useAuth();
  const navigate = useNavigate();
  const ref = useDialogFocus(onClose);
  const hospitals = useFetch('/platform/tenants', { limit: 100, sort: 'name' });
  const active = (hospitals.data?.tenants ?? []).filter((t) => t.isActive);
  const [tenantId, setTenantId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(startError);
  const own = platform?.linkedAccount?.own ? platform.linkedAccount : null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await makeDoctorAccount(tenantId);
      await switchToDoctor();
      onClose();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="doctor-setup-title" onSubmit={submit} noValidate>
        <h2 id="doctor-setup-title">Work as a doctor</h2>
        <p>
          {own ? (
            <>
              Your doctor account is <strong>{own.email}</strong>. Choose a hospital to work in as a doctor – it is added to that hospital's staff.
            </>
          ) : (
            <>Uses your own login: no second email or password. Your doctor account is made once and added to the chosen hospital's staff as a doctor.</>
          )}{' '}
          Switching back to super admin asks for your password.
        </p>
        <Alert type="error">{error}</Alert>
        <Field label="Hospital" id="doctor-setup-hospital">
          <select id="doctor-setup-hospital" value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={hospitals.loading}>
            <option value="">{hospitals.loading ? 'Loading hospitals…' : 'Choose a hospital'}</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!tenantId || busy}>
            <Stethoscope aria-hidden="true" /> {busy ? 'Switching…' : 'Work as a doctor here'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
        {onOtherLogin && (
          <p className="muted">
            Already have a separate doctor login with its own email?{' '}
            <button type="button" className="btn btn-link" onClick={onOtherLogin}>
              Use that login
            </button>
          </p>
        )}
      </form>
    </div>
  );
}

/** "Switch back to super admin": a super admin working in their own doctor account types their super admin password. */
export function SwitchBackDialog({ onClose }) {
  const { switchToSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const ref = useDialogFocus(onClose);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await switchToSuperAdmin(password);
      onClose();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.fields?.password ?? err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-back-title" onSubmit={submit} noValidate>
        <h2 id="switch-back-title">Switch back to super admin</h2>
        <p>Type your super admin password. It is asked because the super admin pages reach every hospital.</p>
        <Alert type="error">{error}</Alert>
        <Field label="Super admin password" id="switch-back-password">
          <PasswordInput id="switch-back-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!password || busy}>
            <ArrowLeftRight aria-hidden="true" /> {busy ? 'Switching…' : 'Switch back'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * "Switch to admin" (22 Oct 2026): a doctor whom the super admin also made the hospital's admin types their password;
 * this browser then works as the admin – admin pages only, no patient records. A super admin in their own doctor
 * account types the super admin password.
 */
export function AdminSwitchDialog({ superAdminPassword = false, onClose }) {
  const { switchToAdmin } = useAuth();
  const navigate = useNavigate();
  const ref = useDialogFocus(onClose);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await switchToAdmin(password);
      onClose(); // the switch button stays (now "Switch to Doctor"), so the box closes itself
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.fields?.password ?? err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="admin-switch-title" onSubmit={submit} noValidate>
        <h2 id="admin-switch-title">Switch to admin</h2>
        <p>The admin pages: staff, settings, price list and reports. As the admin you see no patient records; switching back to your patients needs no password.</p>
        <Alert type="error">{error}</Alert>
        <Field label={superAdminPassword ? 'Super admin password' : 'Your password'} id="admin-switch-password">
          <PasswordInput id="admin-switch-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!password || busy}>
            <ShieldCheck aria-hidden="true" /> {busy ? 'Switching…' : 'Switch to admin'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

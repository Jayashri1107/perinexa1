import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Building2, CircleAlert, CircleHelp, Eye, KeyRound, LogOut, Menu, UserCog } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import appIcon from '../assets/brand/perinexa-app-icon.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { normalizeAppearance } from '../appearance.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CARE_TYPES } from '../pages/patients/patientFormat.js';
import { ACCOUNT_MODULE, PLATFORM_AREA_LABELS, canSeePatients, hospitalModules, platformModules } from '../platform/modules.js';
import { ChangePasswordDialog } from './ChangePasswordDialog.jsx';
import { PatientSearch } from './PatientSearch.jsx';
import { IdleWarning } from './Layout.jsx';
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
function Workspace() {
  const { memberships, activeTenantId, activeMembership, switchTenant } = useAuth();
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
        <span className="ws-label">Working in</span>
        <strong className="ws-name">{activeMembership.tenantName}</strong>
        <span className="ws-meta">{activeMembership.platform ? 'Every role – records you open are audited' : rolesLabel(activeMembership.roles)}</span>
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

/** "Help": shows or hides the explanations on every screen (saved with the person's appearance). */
function HelpToggle() {
  const { user, saveAppearance } = useAuth();
  const look = normalizeAppearance(user.preferences?.appearance);
  const shown = look.help === 'shown';
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm pf-help${shown ? ' is-on' : ''}`}
      aria-pressed={shown}
      title={shown ? 'Hide the explanations on the screens' : 'Show explanations on the screens'}
      onClick={() => saveAppearance({ ...look, help: shown ? 'hidden' : 'shown' }).catch(() => {})}
    >
      <CircleHelp aria-hidden="true" /> Help
    </button>
  );
}

// The profile circle beside "Log out": click it for the name, email and role, Change password and My settings.
function ProfileMenu({ locked, onSwitch }) {
  const { user, activeMembership, platform } = useAuth();
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
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              {role && <span className="pill pm-role">{role}</span>}
              {activeMembership && <span>{activeMembership.platform ? `Setup of ${activeMembership.tenantName}` : activeMembership.tenantName}</span>}
            </div>
          </div>
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
          {platform?.linkedAccount && (
            <button
              type="button"
              className="pm-link"
              onClick={() => {
                setOpen(false);
                onSwitch();
              }}
            >
              <ArrowLeftRight aria-hidden="true" /> Switch to your doctor account
            </button>
          )}
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
  const { user, logout, activeMembership, activeTenantId, tenantNotice, clearTenantNotice, isPlatform, platform, openHospital } = useAuth();
  const [switching, setSwitching] = useState(false); // Switch to your doctor account (asks for its password)
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
  const searchable = !locked && canSeePatients(activeMembership?.roles ?? []);
  // Super admins and platform admins: the platform menu, or – with a hospital's setup open – its Hospital admin pages only
  const inSetup = Boolean(activeMembership?.platform);
  const modules = locked ? [] : isPlatform && !inSetup ? platformModules(platform) : hospitalModules(activeMembership?.roles);
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
        {hospitalName && <p className="sb-subtitle">{hospitalName}</p>}

        <nav className="sb-nav">
          {modules.map((m) => (
            <SideLink key={m.key} module={m} rail={rail} onNavigate={closeMobile} />
          ))}
          {!locked && <SideLink module={ACCOUNT_MODULE} rail={rail} onNavigate={closeMobile} />}
        </nav>
        {foot && <p className="sb-foot">{foot}</p>}
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
            {platform?.linkedAccount && !locked && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSwitching(true)} title={`Switch to ${platform.linkedAccount.email} – asks for its password`}>
                <ArrowLeftRight aria-hidden="true" /> Switch to your doctor account
              </button>
            )}
            {viewOnly && (
              <span className="pill pf-viewonly" title={allowed ? `You may change: ${allowed}. Everything else is view only.` : 'You can look at everything but change nothing.'}>
                <Eye aria-hidden="true" /> View only{allowed ? ' (mostly)' : ''}
              </span>
            )}
            {!locked && <HelpToggle />}
            <ProfileMenu locked={locked} onSwitch={() => setSwitching(true)} />
            <button type="button" className="btn btn-sm pf-logout" onClick={() => logout('manual')}>
              <LogOut aria-hidden="true" /> Log out
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
      {switching && platform?.linkedAccount && <SwitchAccountDialog email={platform.linkedAccount.email} onClose={() => setSwitching(false)} />}
    </div>
  );
}

/**
 * Switch to the linked doctor account (super admins and platform admins who are also doctors): its password is asked
 * here and it is signed in at once – this browser then works as the doctor. Logging in is audited as for any login.
 */
function SwitchAccountDialog({ email, onClose }) {
  const { switchToLinkedAccount } = useAuth();
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
      await switchToLinkedAccount(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.status === 401 || err.status === 400 ? 'That password is not right for your doctor account.' : err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-title" onSubmit={submit} noValidate>
        <h2 id="switch-title">Switch to your doctor account</h2>
        <p>
          You will work as <strong>{email}</strong>. Type that account's password.
        </p>
        <Alert type="error">{error}</Alert>
        <Field label="Password of your doctor account" id="switch-password">
          <input id="switch-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!password || busy}>
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

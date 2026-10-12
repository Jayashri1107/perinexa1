import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronsUpDown, CircleAlert, CircleHelp, LogOut, Menu, TriangleAlert, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import appIcon from '../assets/brand/perinexa-app-icon.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { normalizeAppearance } from '../appearance.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CARE_TYPES } from '../pages/patients/patientFormat.js';
import { ACCOUNT_MODULE, PLATFORM_MODULES, canSeePatients, hospitalModules } from '../platform/modules.js';
import { PatientSearch } from './PatientSearch.jsx';
import { IdleWarning } from './Layout.jsx';
import { TitleSlotContext } from './PageHeader.jsx';
import { Alert, Avatar, rolesLabel } from './ui.jsx';

// The new-patient form (before anything is saved): /patients/new or /patients/new/<type of care>
const REGISTERING = new RegExp(`^/patients/new(?:/(?:${CARE_TYPES.join('|')}))?/?$`);

// Wide screens: the menu button in the title bar hides the whole sidebar and shows it again (remembered).
const HIDDEN_KEY = 'perinexa:sidebarHidden';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
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

// A menu item: a 48 px icon tile and the label (only the tile in the icon rail).
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

// The hospital the person is working in, at the top of the menu. People who work at more than one
// hospital get a "Switch hospital" button that lists their other hospitals.
function HospitalSwitcher({ rail, onExpand }) {
  const { memberships, activeTenantId, activeMembership, switchTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (rail) setOpen(false);
  }, [rail]);

  if (!activeMembership) return null;
  const others = memberships.filter((m) => m.tenantId !== activeTenantId);

  const choose = async (tenantId) => {
    setBusy(true);
    setError(null);
    try {
      await switchTenant(tenantId);
      setOpen(false);
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

  const canExpand = rail && others.length > 0;
  // The hospital being worked in (who is logged in is shown once, in the title bar).
  return (
    <div className="sb-workspace-wrap">
      <div className="sb-workspace" title={rail ? activeMembership.tenantName : undefined}>
        <button
          type="button"
          className="sb-workspace-icon"
          onClick={canExpand ? onExpand : undefined}
          tabIndex={canExpand ? 0 : -1}
          aria-label={canExpand ? 'Open the menu to switch hospital' : undefined}
          aria-hidden={canExpand ? undefined : 'true'}
        >
          <Building2 />
        </button>
        <span className="sb-label sb-workspace-text">
          <small>Hospital</small>
          <strong className="sb-person">{activeMembership.tenantName}</strong>
          {others.length > 0 && (
            <button type="button" className="sb-switch-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={busy}>
              <ChevronsUpDown size={16} aria-hidden="true" /> {busy ? 'Switching…' : 'Switch hospital'}
            </button>
          )}
          {error && (
            <span className="sb-workspace-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </span>
          )}
        </span>
      </div>
      {open && (
        <ul className="sb-switch-list" aria-label="Your other hospitals">
          {others.map((m) => (
            <li key={m.tenantId}>
              <button type="button" onClick={() => choose(m.tenantId)} disabled={busy}>
                <strong>{m.tenantName}</strong>
                <span>{rolesLabel(m.roles)}</span>
              </button>
            </li>
          ))}
        </ul>
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

/** Right of the title bar: who is logged in (photo, name, role – opens My settings) and Log out. */
function UserMenu({ locked }) {
  const { user, logout, activeMembership } = useAuth();
  const role = user.isSuperAdmin ? 'Super admin' : activeMembership ? rolesLabel(activeMembership.roles) : null;
  const chip = (
    <>
      <Avatar name={user.name} seed={user.email} />
      <span className="pf-user-text">
        <strong>{user.name}</strong>
        {role && <span>{role}</span>}
      </span>
    </>
  );
  return (
    <div className="pf-user">
      {locked ? (
        <span className="pf-user-chip" title={user.name}>{chip}</span>
      ) : (
        <Link to={ACCOUNT_MODULE.to} className="pf-user-chip" title={`${user.name} – My settings`}>
          {chip}
        </Link>
      )}
      <button type="button" className="btn btn-secondary btn-sm pf-logout" onClick={() => logout('manual')}>
        <LogOut aria-hidden="true" /> Log out
      </button>
    </div>
  );
}

/**
 * The layout for every login (brand guide page 7): main modules in the Night Indigo sidebar, with who is logged in
 * (and the hospital) below the logo; the screen title in the title bar; the page on the Mist canvas. Super admins see the platform modules;
 * hospital staff see their hospital's modules (based on their roles in the hospital selected in the menu).
 */
export function AppLayout() {
  const { user, activeMembership, activeTenantId, tenantNotice, clearTenantNotice } = useAuth();
  const location = useLocation();
  const [hidden, setHidden] = useState(readHidden);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [titleSlot, setTitleSlot] = useState(null);
  const railForced = useMediaQuery(RAIL_QUERY);
  const closeBtnRef = useRef(null);
  const openedFrom = useRef(null);
  const sbMenuBtnRef = useRef(null);
  const barMenuBtnRef = useRef(null);
  const toggledByButton = useRef(false);

  // The menu button moves between the sidebar (shown) and the title bar (hidden): keep the keyboard focus on it.
  useEffect(() => {
    if (!toggledByButton.current) return;
    toggledByButton.current = false;
    (hidden ? barMenuBtnRef : sbMenuBtnRef).current?.focus();
  }, [hidden]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
      /* not important if it can't be remembered */
    }
  }, [hidden]);

  // Close the menu that opens over the page after navigating, or when the screen becomes wide again.
  useEffect(() => setMobileOpen(false), [location.pathname, railForced]);

  // Keyboard: when the menu opens over the page, focus moves into it and Escape closes it; when it closes,
  // focus goes back to the button that opened it.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    openedFrom.current = document.activeElement;
    closeBtnRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = openedFrom.current;
      if (back instanceof HTMLElement && back.isConnected && back.offsetParent !== null) back.focus();
    };
  }, [mobileOpen]);

  const locked = user.mustChangePassword; // only the password screen until they choose their own
  // "Find a patient" in the title bar: hospital staff who work with patient records.
  const searchable = !locked && !user.isSuperAdmin && canSeePatients(activeMembership?.roles ?? []);
  const modules = locked ? [] : user.isSuperAdmin ? PLATFORM_MODULES : hospitalModules(activeMembership?.roles);
  const closeMobile = () => setMobileOpen(false);
  // Icon rail on narrower screens (unless the full menu is open); on wide screens the sidebar is shown or hidden.
  const rail = !mobileOpen && railForced;
  const sidebarHidden = hidden && !railForced;
  const expand = () => setMobileOpen(true);
  const toggleMenu = () => {
    if (railForced) return setMobileOpen((o) => !o);
    toggledByButton.current = true;
    return setHidden((h) => !h);
  };
  const menuOpen = railForced ? mobileOpen : !hidden;

  return (
    <div className={`pf ${sidebarHidden ? 'pf-sb-hidden' : ''} ${mobileOpen ? 'pf-mobile-open' : ''}`}>
      <aside className="sb" id="main-menu" aria-label="Main navigation">
        <div className="sb-brand">
          <Link to="/" onClick={closeMobile} aria-label="Perinexa – start page">
            <img className="sb-logo" src={logoReversed} alt="Perinexa by Docvritta" width="184" height="45" />
            <img className="sb-appicon" src={appIcon} alt="Perinexa" width="48" height="48" />
          </Link>
          <button type="button" className="sb-menu-btn" onClick={toggleMenu} aria-label="Hide menu" title="Hide menu" aria-expanded="true" aria-controls="main-menu" ref={sbMenuBtnRef}>
            <Menu size={24} />
          </button>
          <button type="button" className="sb-close" onClick={closeMobile} aria-label="Close menu" ref={closeBtnRef}>
            <X size={24} />
          </button>
        </div>

        {!locked && !user.isSuperAdmin && activeMembership && <HospitalSwitcher rail={rail} onExpand={expand} />}

        <nav className="sb-nav">
          {modules.length > 0 && <p className="sb-section">{user.isSuperAdmin ? 'Platform' : 'Modules'}</p>}
          {modules.map((m) => (
            <SideLink key={m.key} module={m} rail={rail} onNavigate={closeMobile} />
          ))}
          {!locked && (
            <>
              <p className="sb-section">Account</p>
              <SideLink module={ACCOUNT_MODULE} rail={rail} onNavigate={closeMobile} />
            </>
          )}
        </nav>
      </aside>
      <div className="sb-overlay" onClick={closeMobile} aria-hidden="true" />

      <div className="pf-body">
        <div className="pf-titlebar">
          <button
            type="button"
            className="icon-btn pf-menu-btn"
            onClick={toggleMenu}
            aria-label={menuOpen ? 'Hide menu' : 'Show menu'}
            title={menuOpen ? 'Hide menu' : 'Show menu'}
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            ref={barMenuBtnRef}
          >
            <Menu size={24} />
          </button>
          <div className="pf-title-slot" ref={setTitleSlot} />
          {searchable && <PatientSearch key={activeTenantId} />}
          <div className="pf-tools">
            {!locked && <HelpToggle />}
            <span className="pf-env" role="note" title="Development version: use fake sample data only. Do not enter real patient information.">
              <TriangleAlert aria-hidden="true" /> Fake sample data only
            </span>
            <UserMenu locked={locked} />
          </div>
        </div>
        <main className="pf-main" id="main">
          {tenantNotice && (
            <div className="pf-notice">
              <Alert type="warning" onClose={clearTenantNotice}>
                {tenantNotice}
              </Alert>
            </div>
          )}
          {/* Re-create the page when the hospital changes, so no data from the previous hospital stays on screen. */}
          <TitleSlotContext.Provider value={titleSlot}>
            <Outlet key={activeTenantId ?? 'platform'} />
          </TitleSlotContext.Provider>
        </main>
      </div>
      <IdleWarning />
    </div>
  );
}

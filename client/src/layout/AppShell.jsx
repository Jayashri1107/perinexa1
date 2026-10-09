// The frame of every signed-in page (styled like Perinexa): the sidebar with the logo, a ☰ button that collapses it to
// an icon rail (the choice is remembered in this browser), each menu item as an icon tile; the person at the top; the
// page in the middle.
import { LogOut, Menu } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Loader } from '../components/Loader.jsx';
import { ProfileMenu } from '../components/ProfileMenu.jsx';
import { ThemeMenu } from '../components/ThemeMenu.jsx';
import appIcon from '../assets/brand/perinexa-app-icon.png';
import logo from '../assets/brand/perinexa-logo.png';
import logoReversed from '../assets/brand/perinexa-logo-reversed.png';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const COLLAPSE_KEY = 'perinexa1:sidebarCollapsed';

// Browser storage may be blocked (private windows): the sidebar then simply starts open.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}
function saveCollapsed(value) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    /* not remembered – fine */
  }
}

// The logo on light pages (login, password): the full-colour Perinexa logo.
export function BrandMark({ size = 'md', subtitle }) {
  const { app } = useAppConfig();
  return (
    <div className={`brand brand-${size}`}>
      <img className="brand-logo" src={logo} alt={app.name} width={size === 'lg' ? 196 : 160} height={size === 'lg' ? 48 : 39} />
      {subtitle && <span className="brand-tagline">{subtitle}</span>}
    </div>
  );
}

// contentKey: when it changes (another hospital chosen), the page starts fresh and loads its data again.
export function AppShell({ navigation, brandSubtitle, sidebarFoot, topbarStart, topbarActions, contentKey, banner }) {
  const { logout } = useAuth();
  const { app } = useAppConfig();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => saveCollapsed(collapsed), [collapsed]);

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sb-brand">
          <button
            type="button"
            className="sb-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
            aria-controls="main-menu"
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <Menu size={22} aria-hidden />
          </button>
          {collapsed ? (
            <img className="sb-appicon" src={appIcon} alt={app.name} width="40" height="40" />
          ) : (
            <img className="sb-logo" src={logoReversed} alt={app.name} width="150" height="37" />
          )}
        </div>
        {!collapsed && brandSubtitle && <div className="sb-subtitle">{brandSubtitle}</div>}

        <nav id="main-menu" aria-label="Main">
          {navigation.map(({ to, label, icon: Icon, end, activeFor = [] }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              className={({ isActive }) => `nav-link${isActive || activeFor.some((p) => pathname.startsWith(p)) ? ' active' : ''}`}
            >
              <span className="sb-tile" aria-hidden>
                <Icon size={20} />
              </span>
              <span className="sb-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        {!collapsed && sidebarFoot && <div className="sidebar-foot">{sidebarFoot}</div>}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-start">{topbarStart}</div>
          <div className="topbar-actions">
            <ThemeMenu />
            {topbarActions}
            <ProfileMenu />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
              <LogOut size={16} aria-hidden /> Log out
            </button>
          </div>
        </header>
        {banner}
        <main className="content" key={contentKey}>
          <Suspense fallback={<Loader />}>
            <div className="page-enter" key={pathname}>
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

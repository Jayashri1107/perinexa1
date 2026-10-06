// The frame of every signed-in page: menu on the left, the person (and anything extra) at the top, the page in the middle.
import { KeyRound, LogOut, Plus } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function BrandMark({ size = 'md', subtitle }) {
  const { app } = useAppConfig();
  return (
    <div className={`brand brand-${size}`}>
      <span className="brand-icon" aria-hidden>
        <Plus size={size === 'lg' ? 26 : 18} strokeWidth={3} />
      </span>
      <span>
        <span className="brand-name">{app.name}</span>
        <span className="brand-tagline">{subtitle ?? app.tagline}</span>
      </span>
    </div>
  );
}

// contentKey: when it changes (another hospital chosen), the page starts fresh and loads its data again.
export function AppShell({ navigation, brandSubtitle, sidebarFoot, topbarStart, contentKey, banner }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandMark subtitle={brandSubtitle} />
        <nav aria-label="Main">
          {navigation.map(({ to, label, icon: Icon, end, activeFor = [] }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              className={({ isActive }) => `nav-link${isActive || activeFor.some((p) => pathname.startsWith(p)) ? ' active' : ''}`}
            >
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {sidebarFoot && <div className="sidebar-foot">{sidebarFoot}</div>}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-start">
            {topbarStart}
            <div className="user-chip">
              <span className="avatar" aria-hidden>{initials}</span>
              <span>
                <strong>{user.name}</strong>
                <span className="muted">{user.email}</span>
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/change-password')}>
              <KeyRound size={16} aria-hidden /> Change password
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
              <LogOut size={16} aria-hidden /> Log out
            </button>
          </div>
        </header>
        {banner}
        <main className="content" key={contentKey}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

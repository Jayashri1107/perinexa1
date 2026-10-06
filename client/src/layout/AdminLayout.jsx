// The main admin's frame: menu on the left, the signed-in person at the top, the page in the middle.
import { KeyRound, LogOut, Plus } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ADMIN_NAVIGATION } from '../config/navigation.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function BrandMark({ size = 'md' }) {
  const { app } = useAppConfig();
  return (
    <div className={`brand brand-${size}`}>
      <span className="brand-icon" aria-hidden>
        <Plus size={size === 'lg' ? 26 : 18} strokeWidth={3} />
      </span>
      <span>
        <span className="brand-name">{app.name}</span>
        <span className="brand-tagline">{app.tagline}</span>
      </span>
    </div>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandMark />
        <nav aria-label="Main">
          {ADMIN_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-link">
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot muted">Super admin · no patient data</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="user-chip">
            <span className="avatar" aria-hidden>{initials}</span>
            <span>
              <strong>{user.name}</strong>
              <span className="muted">{user.email}</span>
            </span>
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
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

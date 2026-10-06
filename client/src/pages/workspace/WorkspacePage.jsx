// Hospital staff land here. Their own hospital screens are the next module; for now this shows where they work.
import { Building2, LogOut } from 'lucide-react';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { BrandMark } from '../../layout/AdminLayout.jsx';

export function WorkspacePage() {
  const { user, memberships, logout } = useAuth();
  const { roleLabel } = useAppConfig();

  return (
    <div className="auth-page">
      <div className="auth-card card wide">
        <BrandMark size="lg" />
        <h1>Welcome, {user.name}</h1>
        <p className="muted">The hospital workspace is the next module to be built. Your access:</p>
        <ul className="plain-list">
          {memberships.length === 0 && <li className="muted">You have no active hospital access. Ask your administrator.</li>}
          {memberships.map((m) => (
            <li key={m.id}>
              <Building2 size={16} aria-hidden /> <strong>{m.hospital?.name}</strong> — {m.roles.map(roleLabel).join(', ')}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={() => logout()}>
          <LogOut size={16} aria-hidden /> Log out
        </button>
      </div>
    </div>
  );
}

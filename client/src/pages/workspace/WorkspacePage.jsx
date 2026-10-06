// For someone who is signed in but has no active access to any hospital (for example after being deactivated).
import { LogOut } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { BrandMark } from '../../layout/AppShell.jsx';

export function WorkspacePage() {
  const { user, activeHospitalId, logout } = useAuth();
  if (user.isSuperAdmin) return <Navigate to="/" replace />;
  if (activeHospitalId) return <Navigate to="/hospital" replace />;

  return (
    <div className="auth-page">
      <div className="auth-card card wide">
        <BrandMark size="lg" />
        <h1>Welcome, {user.name}</h1>
        <p className="muted">You have no active access to any hospital. Ask your hospital admin to give you access.</p>
        <button type="button" className="btn btn-ghost" onClick={() => logout()}>
          <LogOut size={16} aria-hidden /> Log out
        </button>
      </div>
    </div>
  );
}

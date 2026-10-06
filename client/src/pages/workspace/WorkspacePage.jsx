// For someone who is signed in but has no active access to any hospital (for example after being deactivated).
import { LogOut } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export function WorkspacePage() {
  const { user, activeHospitalId, logout } = useAuth();
  if (user.isSuperAdmin) return <Navigate to="/" replace />;
  if (activeHospitalId) return <Navigate to="/hospital" replace />;

  return (
    <AuthLayout title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="You have no active access to any hospital yet. Ask your hospital administrator to give you access.">
      <button type="button" className="btn btn-ghost btn-block" onClick={() => logout()}>
        <LogOut size={16} aria-hidden /> Log out
      </button>
    </AuthLayout>
  );
}

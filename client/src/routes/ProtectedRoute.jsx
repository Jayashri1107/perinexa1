// Page guards: logged in, temporary password replaced, and the right kind of account.
//  area="admin":    super admins only (others go to their hospital)
//  area="hospital": people working in a hospital (super admins go to the dashboard; no hospital → /workspace)
//  adminOnly:       inside the hospital area, only the hospital admin role
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader } from '../components/Loader.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function ProtectedRoute({ area, adminOnly = false, allowPasswordChange = false }) {
  const { user, loading, activeHospitalId, isHospitalAdmin } = useAuth();
  const location = useLocation();

  if (loading) return <Loader full />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;

  if (area === 'admin' && !user.isSuperAdmin) return <Navigate to="/hospital" replace />;
  if (area === 'hospital') {
    if (user.isSuperAdmin) return <Navigate to="/" replace />;
    if (!activeHospitalId) return <Navigate to="/workspace" replace />;
    if (adminOnly && !isHospitalAdmin) return <Navigate to="/hospital" replace />;
  }
  return <Outlet />;
}

// The page frame that fits the person: the main admin's or the hospital's.
export function homeFor(user) {
  return user?.isSuperAdmin ? '/' : '/hospital';
}

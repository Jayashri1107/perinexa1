// Page guards: logged in, temporary password replaced, and the right kind of account.
//  area="admin":    super admins only (others go to their hospital)
//  area="hospital": working in a hospital – staff, or a super admin who opened one (no hospital → /workspace or /)
//  access:          inside the hospital area, a key of config.access (patients, billing …) or 'admin'
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader } from '../components/Loader.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function ProtectedRoute({ area, access, allowPasswordChange = false }) {
  const { user, loading, activeHospitalId, canAccess } = useAuth();
  const location = useLocation();

  if (loading) return <Loader full />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;

  if (area === 'admin' && !user.isSuperAdmin) return <Navigate to="/hospital" replace />;
  if (area === 'hospital') {
    if (!activeHospitalId) return <Navigate to={user.isSuperAdmin ? '/' : '/workspace'} replace />;
    if (access && !canAccess(access)) return <Navigate to="/hospital" replace />;
  }
  return <Outlet />;
}

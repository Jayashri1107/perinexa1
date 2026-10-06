// Page guard: logged in, temporary password replaced, and (for admin pages) a super admin.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader } from '../components/Loader.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function ProtectedRoute({ superAdminOnly = false, allowPasswordChange = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loader full />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;
  if (superAdminOnly && !user.isSuperAdmin) return <Navigate to="/workspace" replace />;
  return <Outlet />;
}

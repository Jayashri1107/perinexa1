import { Building2, Lock } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.jsx';
import { canSeeCalendar } from '../platform/modules.js';
import { useAuth } from './AuthContext.jsx';

export function FullPageSpinner() {
  return (
    <div className="center-page acc-loading" role="status">
      <div className="spinner" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// A screen that can't show its content: the title in the title bar, then a short message on a narrow white card.
function MessageScreen({ title, icon: Icon, children }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="pf-content">
        <section className="card narrow acc-message">
          <span className="acc-message-icon" aria-hidden="true">
            <Icon />
          </span>
          <p>{children}</p>
        </section>
      </div>
    </>
  );
}

function NotAllowed({ children }) {
  return (
    <MessageScreen title="Not allowed" icon={Lock}>
      {children ?? "You don't have access to this page. If you need it, ask your hospital admin to change your role."}
    </MessageScreen>
  );
}

// Logged-out people are sent to the login page.
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

// People who must change their password can only see the change-password screen.
export function RequirePasswordChanged() {
  const { user } = useAuth();
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

// Platform pages: super admins and platform admins (platform admins view only, apart from the areas given to them).
export function RequireSuperAdmin() {
  const { isPlatform } = useAuth();
  if (!isPlatform) return <NotAllowed>This page is only for super admin and platform admin accounts. If you think this is a mistake, contact your administrator.</NotAllowed>;
  return <Outlet />;
}

// Hospital pages: the person must be working in a hospital.
export function RequireTenant({ children }) {
  const { isPlatform, activeTenantId, activeMembership } = useAuth();
  const { pathname } = useLocation();
  if (isPlatform) {
    // A super admin or platform admin sees a hospital's setup only (Hospital admin), never its patients.
    if (activeMembership?.platform) return pathname.startsWith('/admin') ? (children ?? <Outlet />) : <Navigate to="/admin/staff" replace />;
    return (
      <NotAllowed>
        Super admin and platform admin accounts manage hospitals and users, but can't open patient data. To change a
        hospital's setup, open it from Hospitals. To work with patients, use your hospital account.
      </NotAllowed>
    );
  }
  if (!activeTenantId) {
    return (
      <MessageScreen title="No hospital yet" icon={Building2}>
        Your account isn't linked to any active hospital yet. Please ask your administrator to add you to a hospital.
      </MessageScreen>
    );
  }
  return children ?? <Outlet />;
}

// Hospital admin pages: admin role in the selected hospital.
export function RequireTenantAdmin() {
  const { activeMembership } = useAuth();
  if (!activeMembership?.roles?.includes('admin')) return <NotAllowed />;
  return <Outlet />;
}

// Hospital pages for some roles only (e.g. Analytics): one of these roles in the selected hospital.
export function RequireTenantRole({ roles, message }) {
  const { activeMembership } = useAuth();
  if (!activeMembership?.roles?.some((r) => roles.includes(r))) return <NotAllowed>{message}</NotAllowed>;
  return <Outlet />;
}

// The calendar: doctors, RMOs and reception (not nurses, lab staff or admin-only people).
export function RequireCalendarRole() {
  const { activeMembership } = useAuth();
  if (!canSeeCalendar(activeMembership?.roles)) return <NotAllowed />;
  return <Outlet />;
}

// "/" sends super admins to the platform area and everyone else to their hospital dashboard.
export function HomeRedirect({ children }) {
  const { isPlatform, activeMembership } = useAuth();
  if (isPlatform) return <Navigate to={activeMembership?.platform ? '/admin/staff' : '/platform/overview'} replace />;
  return children;
}

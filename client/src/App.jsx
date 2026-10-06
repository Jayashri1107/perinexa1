import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppConfigProvider } from './context/AppConfigContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { AdminLayout } from './layout/AdminLayout.jsx';
import { HospitalLayout } from './layout/HospitalLayout.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { AccountPage } from './pages/account/AccountPage.jsx';
import { AuditPage } from './pages/audit/AuditPage.jsx';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { DashboardPage } from './pages/dashboard/DashboardPage.jsx';
import { HospitalAuditPage } from './pages/hospital/HospitalAuditPage.jsx';
import { HospitalHomePage } from './pages/hospital/HospitalHomePage.jsx';
import { HospitalSettingsPage } from './pages/hospital/HospitalSettingsPage.jsx';
import { OpdScheduleEditorPage } from './pages/hospital/OpdScheduleEditorPage.jsx';
import { OpdTimingsPage } from './pages/hospital/OpdTimingsPage.jsx';
import { StaffPage } from './pages/hospital/StaffPage.jsx';
import { HospitalDetailPage } from './pages/hospitals/HospitalDetailPage.jsx';
import { HospitalsPage } from './pages/hospitals/HospitalsPage.jsx';
import { MasterDataPage } from './pages/masterData/MasterDataPage.jsx';
import { UsersPage } from './pages/users/UsersPage.jsx';
import { WorkspacePage } from './pages/workspace/WorkspacePage.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';

// Pages for everyone (My settings) sit in the frame that fits the person.
function PersonalLayout() {
  const { user, activeHospitalId } = useAuth();
  if (user.isSuperAdmin) return <AdminLayout />;
  if (activeHospitalId) return <HospitalLayout />;
  return <Navigate to="/workspace" replace />;
}

export function App() {
  return (
    <AppConfigProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute allowPasswordChange />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
            </Route>

            {/* Signed in, but no active hospital access */}
            <Route element={<ProtectedRoute />}>
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route element={<PersonalLayout />}>
                <Route path="/account" element={<AccountPage />} />
              </Route>
            </Route>

            {/* Module 2 – people working in a hospital */}
            <Route element={<ProtectedRoute area="hospital" />}>
              <Route path="/hospital" element={<HospitalLayout />}>
                <Route index element={<HospitalHomePage />} />
                <Route element={<ProtectedRoute area="hospital" adminOnly />}>
                  <Route path="staff" element={<StaffPage />} />
                  <Route path="opd-timings" element={<OpdTimingsPage />} />
                  <Route path="opd-timings/:doctorId" element={<OpdScheduleEditorPage />} />
                  <Route path="settings" element={<Navigate to="/hospital/settings/_" replace />} />
                  <Route path="settings/:section" element={<HospitalSettingsPage />} />
                  <Route path="audit" element={<HospitalAuditPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage home="/hospital" />} />
              </Route>
            </Route>

            {/* Module 1 – main admin (super admin) */}
            <Route element={<ProtectedRoute area="admin" />}>
              <Route element={<AdminLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="hospitals" element={<HospitalsPage />} />
                <Route path="hospitals/:id" element={<HospitalDetailPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="master-data" element={<Navigate to="/master-data/_" replace />} />
                <Route path="master-data/:type" element={<MasterDataPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AppConfigProvider>
  );
}

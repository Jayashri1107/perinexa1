import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppConfigProvider } from './context/AppConfigContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { AdminLayout } from './layout/AdminLayout.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { AuditPage } from './pages/audit/AuditPage.jsx';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { DashboardPage } from './pages/dashboard/DashboardPage.jsx';
import { HospitalDetailPage } from './pages/hospitals/HospitalDetailPage.jsx';
import { HospitalsPage } from './pages/hospitals/HospitalsPage.jsx';
import { MasterDataPage } from './pages/masterData/MasterDataPage.jsx';
import { UsersPage } from './pages/users/UsersPage.jsx';
import { WorkspacePage } from './pages/workspace/WorkspacePage.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';

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

            {/* Hospital staff – their module comes next */}
            <Route element={<ProtectedRoute />}>
              <Route path="/workspace" element={<WorkspacePage />} />
            </Route>

            {/* Main admin (super admin) */}
            <Route element={<ProtectedRoute superAdminOnly />}>
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

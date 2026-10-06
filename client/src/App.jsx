import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppConfigProvider } from './context/AppConfigContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { AdminLayout } from './layout/AdminLayout.jsx';
import { HospitalLayout } from './layout/HospitalLayout.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { AccountPage } from './pages/account/AccountPage.jsx';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage.jsx';
import { PlatformAnalyticsPage } from './pages/analytics/PlatformAnalyticsPage.jsx';
import { AuditPage } from './pages/audit/AuditPage.jsx';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { BillDetailPage } from './pages/billing/BillDetailPage.jsx';
import { BillingSettingsPage } from './pages/billing/BillingSettingsPage.jsx';
import { BillsPage } from './pages/billing/BillsPage.jsx';
import { DailySummaryPage } from './pages/billing/DailySummaryPage.jsx';
import { MonthlyPage } from './pages/billing/MonthlyPage.jsx';
import { NewBillPage } from './pages/billing/NewBillPage.jsx';
import { PriceListPage } from './pages/billing/PriceListPage.jsx';
import { UnpaidPage } from './pages/billing/UnpaidPage.jsx';
import { DashboardPage } from './pages/dashboard/DashboardPage.jsx';
import { AdminOverviewPage } from './pages/hospital/AdminOverviewPage.jsx';
import { HospitalAuditPage } from './pages/hospital/HospitalAuditPage.jsx';
import { HospitalSettingsPage } from './pages/hospital/HospitalSettingsPage.jsx';
import { OpdScheduleEditorPage } from './pages/hospital/OpdScheduleEditorPage.jsx';
import { OpdTimingsPage } from './pages/hospital/OpdTimingsPage.jsx';
import { StaffPage } from './pages/hospital/StaffPage.jsx';
import { TodayPage } from './pages/hospital/TodayPage.jsx';
import { HospitalDetailPage } from './pages/hospitals/HospitalDetailPage.jsx';
import { HospitalsPage } from './pages/hospitals/HospitalsPage.jsx';
import { MasterDataPage } from './pages/masterData/MasterDataPage.jsx';
import { PatientDetailPage } from './pages/patients/PatientDetailPage.jsx';
import { PatientRegisterPage } from './pages/patients/PatientRegisterPage.jsx';
import { PatientsPage } from './pages/patients/PatientsPage.jsx';
import { MedicinesPage } from './pages/pharmacy/MedicinesPage.jsx';
import { NewPurchasePage } from './pages/pharmacy/NewPurchasePage.jsx';
import { PharmacyReportsPage } from './pages/pharmacy/PharmacyReportsPage.jsx';
import { PharmacySettingsPage } from './pages/pharmacy/PharmacySettingsPage.jsx';
import { PurchasesPage } from './pages/pharmacy/PurchasesPage.jsx';
import { SaleDetailPage } from './pages/pharmacy/SaleDetailPage.jsx';
import { SalesPage } from './pages/pharmacy/SalesPage.jsx';
import { SellPage } from './pages/pharmacy/SellPage.jsx';
import { StockPage } from './pages/pharmacy/StockPage.jsx';
import { SuppliersPage } from './pages/pharmacy/SuppliersPage.jsx';
import { BillPrintPage } from './pages/print/BillPrintPage.jsx';
import { SaleInvoicePrintPage } from './pages/print/SaleInvoicePrintPage.jsx';
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

// The pharmacy's first page: the counter for the pharmacist, the sales for the others.
function PharmacyHome() {
  const { canAccess } = useAuth();
  return canAccess('pharmacyCounter') ? <SellPage /> : <Navigate to="/hospital/pharmacy/stock" replace />;
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

            {/* Printouts (no menu) */}
            <Route element={<ProtectedRoute area="hospital" access="billing" />}>
              <Route path="/hospital/print/bill/:id" element={<BillPrintPage />} />
            </Route>
            <Route element={<ProtectedRoute area="hospital" access="pharmacy" />}>
              <Route path="/hospital/print/sale/:id" element={<SaleInvoicePrintPage />} />
            </Route>

            {/* Working in a hospital */}
            <Route element={<ProtectedRoute area="hospital" />}>
              <Route path="/hospital" element={<HospitalLayout />}>
                <Route index element={<TodayPage />} />

                {/* Module 3 – patients */}
                <Route element={<ProtectedRoute area="hospital" access="patients" />}>
                  <Route path="patients" element={<PatientsPage />} />
                  <Route path="patients/:id" element={<PatientDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="registerPatients" />}>
                  <Route path="patients/new" element={<PatientRegisterPage />} />
                </Route>

                {/* Module 4 – billing */}
                <Route element={<ProtectedRoute area="hospital" access="billing" />}>
                  <Route path="billing" element={<BillsPage />} />
                  <Route path="billing/new" element={<NewBillPage />} />
                  <Route path="billing/bills/:id" element={<BillDetailPage />} />
                  <Route path="billing/unpaid" element={<UnpaidPage />} />
                  <Route path="billing/daily" element={<DailySummaryPage />} />
                  <Route path="billing/price-list" element={<PriceListPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="billingAdmin" />}>
                  <Route path="billing/monthly" element={<MonthlyPage />} />
                  <Route path="billing/settings" element={<BillingSettingsPage />} />
                </Route>

                {/* Module 5 – pharmacy */}
                <Route element={<ProtectedRoute area="hospital" access="pharmacy" />}>
                  <Route path="pharmacy" element={<PharmacyHome />} />
                  <Route path="pharmacy/sales" element={<SalesPage />} />
                  <Route path="pharmacy/sales/:id" element={<SaleDetailPage />} />
                  <Route path="pharmacy/stock" element={<StockPage />} />
                  <Route path="pharmacy/medicines" element={<MedicinesPage />} />
                  <Route path="pharmacy/purchases" element={<PurchasesPage />} />
                  <Route path="pharmacy/suppliers" element={<SuppliersPage />} />
                  <Route path="pharmacy/reports" element={<PharmacyReportsPage />} />
                  <Route path="pharmacy/settings" element={<PharmacySettingsPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="pharmacyCounter" />}>
                  <Route path="pharmacy/purchases/new" element={<NewPurchasePage />} />
                </Route>

                {/* Module 6 – analytics */}
                <Route element={<ProtectedRoute area="hospital" access="analytics" />}>
                  <Route path="analytics" element={<AnalyticsPage />} />
                </Route>

                {/* Module 2 – hospital admin */}
                <Route element={<ProtectedRoute area="hospital" access="admin" />}>
                  <Route path="admin" element={<AdminOverviewPage />} />
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
                <Route path="hospitals" element={<HospitalsPage key="all" />} />
                <Route path="hospitals/new" element={<HospitalsPage key="new" startAdding />} />
                <Route path="hospitals/:id" element={<HospitalDetailPage />} />
                {/* Users & access tabs (as in Perinexa); key: each tab starts with its own filter */}
                <Route path="users" element={<UsersPage key="all" />} />
                <Route path="users/super-admins" element={<UsersPage key="super" preset={{ kind: 'superAdmin' }} />} />
                <Route path="users/staff" element={<UsersPage key="staff" preset={{ kind: 'staff' }} />} />
                <Route path="users/pending" element={<UsersPage key="pending" preset={{ status: 'pending' }} />} />
                <Route path="users/new" element={<UsersPage key="new" startAdding />} />
                <Route path="master-data" element={<Navigate to="/master-data/_" replace />} />
                <Route path="master-data/:type" element={<MasterDataPage />} />
                <Route path="analytics" element={<PlatformAnalyticsPage />} />
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

import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppConfigProvider } from './context/AppConfigContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { AdminLayout } from './layout/AdminLayout.jsx';
import { HospitalLayout } from './layout/HospitalLayout.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { Loader } from './components/Loader.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';
import { Toaster } from './components/Toast.jsx';
import { PageErrorBoundary } from './components/PageErrorBoundary.jsx';

// Each page is downloaded the first time it is opened, not all at once with the sign-in page – a much smaller first
// download, which matters on phones and slow hospital connections.
// A download that fails (the server restarting, a new version of the website, a network blip) is tried once more; if
// it fails again the whole page is reloaded once – at most every 30 seconds, so it never loops – and only then is the
// error shown (PageErrorBoundary).
const RELOADED_AT = 'p1:page-reloaded-at';
async function loadPage(load) {
  try {
    return await load();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await load();
    } catch {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOADED_AT)) || 0;
      } catch {
        last = Date.now(); // no session storage: never reload by ourselves
      }
      if (Date.now() - last > 30_000) {
        try {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()));
        } catch {
          /* reloading once is still right */
        }
        window.location.reload();
        return new Promise(() => {}); // the page is going away
      }
      throw err;
    }
  }
}
const page = (load, name) => lazy(() => loadPage(load).then((m) => ({ default: m[name] })));
const AccountPage = page(() => import('./pages/account/AccountPage.jsx'), 'AccountPage');
const AnalyticsPage = page(() => import('./pages/analytics/AnalyticsPage.jsx'), 'AnalyticsPage');
const DayPage = page(() => import('./pages/appointments/DayPage.jsx'), 'DayPage');
const NeedsTimePage = page(() => import('./pages/appointments/NeedsTimePage.jsx'), 'NeedsTimePage');
const DoctorTimingsPage = page(() => import('./pages/appointments/TimingsPage.jsx'), 'DoctorTimingsPage');
const TimingsPage = page(() => import('./pages/appointments/TimingsPage.jsx'), 'TimingsPage');
const PlatformAnalyticsPage = page(() => import('./pages/analytics/PlatformAnalyticsPage.jsx'), 'PlatformAnalyticsPage');
const AuditPage = page(() => import('./pages/audit/AuditPage.jsx'), 'AuditPage');
const ChangePasswordPage = page(() => import('./pages/auth/ChangePasswordPage.jsx'), 'ChangePasswordPage');
const CalendarPage = page(() => import('./pages/calendar/CalendarPage.jsx'), 'CalendarPage');
const RemindersPage = page(() => import('./pages/calendar/RemindersPage.jsx'), 'RemindersPage');
const CheckupsPage = page(() => import('./pages/calendar/CheckupsPage.jsx'), 'CheckupsPage');
const BillDetailPage = page(() => import('./pages/billing/BillDetailPage.jsx'), 'BillDetailPage');
const BillingSettingsPage = page(() => import('./pages/billing/BillingSettingsPage.jsx'), 'BillingSettingsPage');
const BillsPage = page(() => import('./pages/billing/BillsPage.jsx'), 'BillsPage');
const DailySummaryPage = page(() => import('./pages/billing/DailySummaryPage.jsx'), 'DailySummaryPage');
const MonthlyPage = page(() => import('./pages/billing/MonthlyPage.jsx'), 'MonthlyPage');
const NewBillPage = page(() => import('./pages/billing/NewBillPage.jsx'), 'NewBillPage');
const PriceListPage = page(() => import('./pages/billing/PriceListPage.jsx'), 'PriceListPage');
const UnpaidPage = page(() => import('./pages/billing/UnpaidPage.jsx'), 'UnpaidPage');
const DashboardPage = page(() => import('./pages/dashboard/DashboardPage.jsx'), 'DashboardPage');
const AdminOverviewPage = page(() => import('./pages/hospital/AdminOverviewPage.jsx'), 'AdminOverviewPage');
const HospitalAuditPage = page(() => import('./pages/hospital/HospitalAuditPage.jsx'), 'HospitalAuditPage');
const HospitalSettingsPage = page(() => import('./pages/hospital/HospitalSettingsPage.jsx'), 'HospitalSettingsPage');
const OpdScheduleEditorPage = page(() => import('./pages/hospital/OpdScheduleEditorPage.jsx'), 'OpdScheduleEditorPage');
const OpdTimingsPage = page(() => import('./pages/hospital/OpdTimingsPage.jsx'), 'OpdTimingsPage');
const ServicesToBillPage = page(() => import('./pages/billing/ServicesToBillPage.jsx'), 'ServicesToBillPage');
const NursingStationPage = page(() => import('./pages/nursing/NursingStationPage.jsx'), 'NursingStationPage');
const WardsPage = page(() => import('./pages/hospital/WardsPage.jsx'), 'WardsPage');
const StaffPage = page(() => import('./pages/hospital/StaffPage.jsx'), 'StaffPage');
const TodayPage = page(() => import('./pages/hospital/TodayPage.jsx'), 'TodayPage');
const HospitalDetailPage = page(() => import('./pages/hospitals/HospitalDetailPage.jsx'), 'HospitalDetailPage');
const HospitalsPage = page(() => import('./pages/hospitals/HospitalsPage.jsx'), 'HospitalsPage');
const LabOrderPage = page(() => import('./pages/lab/LabOrderPage.jsx'), 'LabOrderPage');
const LabPage = page(() => import('./pages/lab/LabPage.jsx'), 'LabPage');
const LibraryEntryPage = page(() => import('./pages/library/LibraryEntryPage.jsx'), 'LibraryEntryPage');
const LibraryListPage = page(() => import('./pages/library/LibraryListPage.jsx'), 'LibraryListPage');
const MasterDataPage = page(() => import('./pages/masterData/MasterDataPage.jsx'), 'MasterDataPage');
const PatientDetailPage = page(() => import('./pages/patients/PatientDetailPage.jsx'), 'PatientDetailPage');
const PatientRegisterPage = page(() => import('./pages/patients/PatientRegisterPage.jsx'), 'PatientRegisterPage');
const PatientsPage = page(() => import('./pages/patients/PatientsPage.jsx'), 'PatientsPage');
const MedicinesPage = page(() => import('./pages/pharmacy/MedicinesPage.jsx'), 'MedicinesPage');
const NewPurchasePage = page(() => import('./pages/pharmacy/NewPurchasePage.jsx'), 'NewPurchasePage');
const NewSupplierReturnPage = page(() => import('./pages/pharmacy/NewSupplierReturnPage.jsx'), 'NewSupplierReturnPage');
const OrderPage = page(() => import('./pages/pharmacy/OrderPage.jsx'), 'OrderPage');
const OrdersPage = page(() => import('./pages/pharmacy/OrdersPage.jsx'), 'OrdersPage');
const PharmacyReportsPage = page(() => import('./pages/pharmacy/PharmacyReportsPage.jsx'), 'PharmacyReportsPage');
const PharmacySettingsPage = page(() => import('./pages/pharmacy/PharmacySettingsPage.jsx'), 'PharmacySettingsPage');
const PrescriptionsQueuePage = page(() => import('./pages/pharmacy/PrescriptionsQueuePage.jsx'), 'PrescriptionsQueuePage');
const PurchasesPage = page(() => import('./pages/pharmacy/PurchasesPage.jsx'), 'PurchasesPage');
const SaleDetailPage = page(() => import('./pages/pharmacy/SaleDetailPage.jsx'), 'SaleDetailPage');
const SalesPage = page(() => import('./pages/pharmacy/SalesPage.jsx'), 'SalesPage');
const SellPage = page(() => import('./pages/pharmacy/SellPage.jsx'), 'SellPage');
const StockPage = page(() => import('./pages/pharmacy/StockPage.jsx'), 'StockPage');
const ExpiringPage = page(() => import('./pages/pharmacy/ExpiringPage.jsx'), 'ExpiringPage');
const SupplierReturnsPage = page(() => import('./pages/pharmacy/SupplierReturnsPage.jsx'), 'SupplierReturnsPage');
const SuppliersPage = page(() => import('./pages/pharmacy/SuppliersPage.jsx'), 'SuppliersPage');
const PlatformBillingPage = page(() => import('./pages/platform/PlatformBillingPage.jsx'), 'PlatformBillingPage');
const PlatformPharmacyPage = page(() => import('./pages/platform/PlatformPharmacyPage.jsx'), 'PlatformPharmacyPage');
const BillPrintPage = page(() => import('./pages/print/BillPrintPage.jsx'), 'BillPrintPage');
const ReceiptPrintPage = page(() => import('./pages/print/ReceiptPrintPage.jsx'), 'ReceiptPrintPage');
const DebitNotePrintPage = page(() => import('./pages/print/DebitNotePrintPage.jsx'), 'DebitNotePrintPage');
const PrescriptionPrintPage = page(() => import('./pages/print/PrescriptionPrintPage.jsx'), 'PrescriptionPrintPage');
const PrescriptionBillPrintPage = page(() => import('./pages/print/PrescriptionBillPrintPage.jsx'), 'PrescriptionBillPrintPage');
const GivePrescriptionPage = page(() => import('./pages/dispensing/GivePrescriptionPage.jsx'), 'GivePrescriptionPage');
const VisitPage = page(() => import('./pages/visits/VisitPage.jsx'), 'VisitPage');
const AdmissionPage = page(() => import('./pages/inpatient/AdmissionPage.jsx'), 'AdmissionPage');
const IssueToWardPage = page(() => import('./pages/pharmacy/IssueToWardPage.jsx'), 'IssueToWardPage');
const WardDocumentPrintPage = page(() => import('./pages/print/WardDocumentPrintPage.jsx'), 'WardDocumentPrintPage');
const LabReportPrintPage = page(() => import('./pages/print/LabReportPrintPage.jsx'), 'LabReportPrintPage');
const PregnancyCardPrintPage = page(() => import('./pages/print/PregnancyCardPrintPage.jsx'), 'PregnancyCardPrintPage');
const DischargeCardPrintPage = page(() => import('./pages/print/DischargeCardPrintPage.jsx'), 'DischargeCardPrintPage');
const DischargesPage = page(() => import('./pages/documents/DischargesPage.jsx'), 'DischargesPage');
const AdmissionsDeskPage = page(() => import('./pages/inpatient/AdmissionsDeskPage.jsx'), 'AdmissionsDeskPage');
const MedicalHistoryPage = page(() => import('./pages/patients/MedicalHistoryPage.jsx'), 'MedicalHistoryPage');
const SaleInvoicePrintPage = page(() => import('./pages/print/SaleInvoicePrintPage.jsx'), 'SaleInvoicePrintPage');
const UsersPage = page(() => import('./pages/users/UsersPage.jsx'), 'UsersPage');
const WorkspacePage = page(() => import('./pages/workspace/WorkspacePage.jsx'), 'WorkspacePage');

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
          <PageErrorBoundary>
            <Suspense fallback={<Loader />}>
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
                <Route element={<ProtectedRoute area="hospital" access="patientsClinical" />}>
                  <Route path="/hospital/print/prescription/:patientId/:visitId" element={<PrescriptionPrintPage />} />
                  <Route path="/hospital/print/ward-document/:stayId/:docId" element={<WardDocumentPrintPage />} />
                  <Route path="/hospital/print/pregnancy-card/:patientId" element={<PregnancyCardPrintPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="labPrint" />}>
                  <Route path="/hospital/print/lab-report/:id" element={<LabReportPrintPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="dischargeCards" />}>
                  <Route path="/hospital/print/discharge-card/:cardId" element={<DischargeCardPrintPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="billing" />}>
                  <Route path="/hospital/print/bill/:id" element={<BillPrintPage />} />
                  <Route path="/hospital/print/receipt/:billId/:paymentId" element={<ReceiptPrintPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="dispense" />}>
                  <Route path="/hospital/print/prescription-bill/:billId" element={<PrescriptionBillPrintPage />} />
                </Route>
                <Route element={<ProtectedRoute area="hospital" access="pharmacy" />}>
                  <Route path="/hospital/print/sale/:id" element={<SaleInvoicePrintPage />} />
                  <Route path="/hospital/print/debit-note/:id" element={<DebitNotePrintPage />} />
                </Route>

                {/* Working in a hospital */}
                <Route element={<ProtectedRoute area="hospital" />}>
                  <Route path="/hospital" element={<HospitalLayout />}>
                    <Route index element={<TodayPage />} />
                    {/* Give a prescription: medicines, other charges, payment, the bill (the pharmacy and the front desk) */}
                    <Route element={<ProtectedRoute area="hospital" access="dispense" />}>
                      <Route path="dispensing/:visitId" element={<GivePrescriptionPage />} />
                    </Route>

                    {/* Module 3 – patients */}
                    <Route element={<ProtectedRoute area="hospital" access="patients" />}>
                      <Route path="patients" element={<PatientsPage />} />
                      <Route path="patients/:id" element={<PatientDetailPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="patientsClinical" />}>
                      <Route path="patients/:id/visits/:visitId" element={<VisitPage />} />
                      <Route path="inpatients/:id" element={<AdmissionPage />} />
                    <Route path="nursing" element={<NursingStationPage />} />
                      <Route path="patients/:id/history" element={<MedicalHistoryPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="dischargeCards" />}>
                      <Route path="discharges" element={<DischargesPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="registrationMenu" />}>
                      <Route path="admissions" element={<AdmissionsDeskPage />} />
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
                    <Route path="billing/services" element={<ServicesToBillPage />} />
                      <Route path="billing/daily" element={<DailySummaryPage />} />
                      <Route path="billing/price-list" element={<PriceListPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="billingReports" />}>
                      <Route path="billing/monthly" element={<MonthlyPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="billingAdmin" />}>
                      <Route path="billing/settings" element={<BillingSettingsPage />} />
                    </Route>

                    {/* Module 5 – pharmacy */}
                    <Route element={<ProtectedRoute area="hospital" access="pharmacy" />}>
                      <Route path="pharmacy" element={<PharmacyHome />} />
                      <Route path="pharmacy/sales" element={<SalesPage />} />
                      <Route path="pharmacy/sales/:id" element={<SaleDetailPage />} />
                      <Route path="pharmacy/stock" element={<StockPage />} />
                      <Route path="pharmacy/expiring" element={<ExpiringPage />} />
                      <Route path="pharmacy/medicines" element={<MedicinesPage />} />
                      <Route path="pharmacy/purchases" element={<PurchasesPage />} />
                      <Route path="pharmacy/suppliers" element={<SuppliersPage />} />
                      <Route path="pharmacy/orders" element={<OrdersPage />} />
                      <Route path="pharmacy/orders/:id" element={<OrderPage />} />
                      <Route path="pharmacy/supplier-returns" element={<SupplierReturnsPage />} />
                      <Route path="pharmacy/reports" element={<PharmacyReportsPage />} />
                      <Route path="pharmacy/settings" element={<PharmacySettingsPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="pharmacyCounter" />}>
                      <Route path="pharmacy/purchases/new" element={<NewPurchasePage />} />
                      <Route path="pharmacy/supplier-returns/new" element={<NewSupplierReturnPage />} />
                      <Route path="pharmacy/ward" element={<IssueToWardPage />} />
                      <Route path="pharmacy/prescriptions" element={<PrescriptionsQueuePage />} />
                    </Route>

                    {/* Module 6 – analytics */}
                    <Route element={<ProtectedRoute area="hospital" access="analytics" />}>
                      <Route path="analytics" element={<AnalyticsPage />} />
                    </Route>

                    {/* Module 7 – the doctor's work: appointments, calendar, lab, clinic library */}
                    <Route element={<ProtectedRoute area="hospital" access="appointments" />}>
                      <Route path="appointments" element={<DayPage />} />
                      <Route path="appointments/needs-time" element={<NeedsTimePage />} />
                      <Route path="appointments/timings" element={<TimingsPage />} />
                      <Route path="appointments/timings/:doctorId" element={<DoctorTimingsPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="calendar" />}>
                      <Route path="calendar" element={<CalendarPage />} />
                      <Route path="calendar/reminders" element={<RemindersPage />} />
                      <Route path="calendar/checkups" element={<CheckupsPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="lab" />}>
                      <Route path="lab" element={<LabPage />} />
                      <Route path="lab/orders/:id" element={<LabOrderPage />} />
                    </Route>
                    <Route element={<ProtectedRoute area="hospital" access="library" />}>
                      <Route path="library" element={<LibraryListPage />} />
                      <Route path="library/:kind" element={<LibraryListPage />} />
                      <Route path="library/:kind/:id" element={<LibraryEntryPage />} />
                    </Route>

                    {/* Module 2 – hospital admin */}
                    <Route element={<ProtectedRoute area="hospital" access="admin" />}>
                      <Route path="admin" element={<AdminOverviewPage />} />
                      <Route path="staff" element={<StaffPage />} />
                      <Route path="opd-timings" element={<OpdTimingsPage />} />
                      <Route path="wards" element={<WardsPage />} />
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
                    <Route path="billing" element={<PlatformBillingPage />} />
                    <Route path="pharmacy" element={<PlatformPharmacyPage />} />
                    <Route path="audit" element={<AuditPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </PageErrorBoundary>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </AppConfigProvider>
  );
}

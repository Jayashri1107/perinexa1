import { SearchX } from 'lucide-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  HomeRedirect,
  RequireAuth,
  RequireCalendarRole,
  RequirePasswordChanged,
  RequireSuperAdmin,
  RequireTenant,
  RequireTenantAdmin,
  RequireTenantRole,
} from './auth/guards.jsx';
import { AppLayout } from './components/AppLayout.jsx';
import { PageHeader } from './components/PageHeader.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { HelpPage } from './pages/HelpPage.jsx';
import { LetterheadSettingsPage } from './pages/settings/LetterheadSettingsPage.jsx';
import { PatientMessagesSettingsPage } from './pages/settings/PatientMessagesSettingsPage.jsx';
import { RemindersPage } from './pages/reminders/RemindersPage.jsx';
import { PortalPage } from './pages/portal/PortalPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { ChangePasswordPage } from './pages/ChangePasswordPage.jsx';
import { TodayPage } from './pages/TodayPage.jsx';
import { CalendarPage } from './pages/calendar/CalendarPage.jsx';
import { AppointmentsPage, NeedsTimePage } from './pages/appointments/AppointmentsPage.jsx';
import { OpdTimingsPage } from './pages/appointments/OpdTimingsPage.jsx';
import { AppointmentsMonthPage } from './pages/appointments/AppointmentsMonthPage.jsx';
import { BedBoardPage } from './pages/beds/BedBoardPage.jsx';
import { BedSetupPage } from './pages/beds/BedSetupPage.jsx';
import { DisplayPage } from './pages/appointments/DisplayPage.jsx';
import { PatientAppointmentsTab } from './pages/appointments/PatientAppointmentsTab.jsx';
import { BillPage } from './pages/billing/BillPage.jsx';
import { PatientAbhaTab } from './pages/abdm/PatientAbhaTab.jsx';
import { AbdmSettingsPage } from './pages/abdm/ScanShare.jsx';
import { InvoicePage, InvoicesPage } from './pages/pharmacy/InvoicesPage.jsx';
import { OrderFormPage, OrderPage, OrdersPage } from './pages/pharmacy/OrdersPage.jsx';
import { MedicinesPage, NewPurchasePage, PurchasesPage, SuppliersPage } from './pages/pharmacy/PurchasesPage.jsx';
import { PharmacySettingsPage, ReportsPage } from './pages/pharmacy/ReportsPage.jsx';
import { SellPage } from './pages/pharmacy/SellPage.jsx';
import { MedicineStockPage, StockPage } from './pages/pharmacy/StockPage.jsx';
import { NewSupplierReturnPage, SupplierReturnPage, SupplierReturnsPage } from './pages/pharmacy/SupplierReturnsPage.jsx';
import { BillsPage } from './pages/billing/BillsPage.jsx';
import { BillingSettingsPage } from './pages/billing/BillingExtras.jsx';
import { DailySummaryPage, MonthlyPage, PatientBillsTab, PriceListPage, UnpaidPage } from './pages/billing/BillingReports.jsx';
import { PatientsPage } from './pages/patients/PatientsPage.jsx';
import { VoiceWordsPage } from './pages/VoiceWordsPage.jsx';
import { NewPatientClinicalPage, PatientNewPage } from './pages/patients/PatientNewPage.jsx';
import { PatientDetailPage, PatientEditTab, PatientOverviewTab } from './pages/patients/PatientDetailPage.jsx';
import { PatientCarePlanTab } from './pages/patients/CarePlanTab.jsx';
import { AuditCategoryRedirect, HospitalAuditLogPage, StaffPage } from './pages/admin/StaffPage.jsx';
import { OverviewPage } from './pages/platform/OverviewPage.jsx';
import { HospitalNewPage, HospitalsListPage } from './pages/platform/HospitalsListPage.jsx';
import { HospitalActivityTab, HospitalOverviewTab, HospitalStaffTab, HospitalWorkspace } from './pages/platform/HospitalWorkspace.jsx';
import { UserNewPage, UsersListPage } from './pages/platform/UsersListPage.jsx';
import { StaffByRolePage } from './pages/platform/StaffByRolePage.jsx';
import { UserPermissionsPage } from './pages/platform/UserPermissionsPage.jsx';
import { UserActivityTab, UserHospitalsTab, UserProfileTab, UserWorkspace } from './pages/platform/UserWorkspace.jsx';
import { AuditPage } from './pages/platform/AuditPage.jsx';
import { TemplatesPage } from './pages/careplans/TemplatesPage.jsx';
import { TemplateDetailPage } from './pages/careplans/TemplateDetailPage.jsx';
import { TemplateEditPage } from './pages/careplans/TemplateEditPage.jsx';
import { RedFlagRulesEditPage } from './pages/redflags/RedFlagRulesEditPage.jsx';
import { RedFlagRulesPage } from './pages/redflags/RedFlagRulesPage.jsx';
import { AskRecordsPage } from './pages/worklist/AskRecordsPage.jsx';
import { MedicineSafetyEditPage } from './pages/medsafety/MedicineSafetyEditPage.jsx';
import { MedicineSafetyPage } from './pages/medsafety/MedicineSafetyPage.jsx';
import { ConsentFormsPage } from './pages/consents/ConsentFormsPage.jsx';
import { ApprovalsPage } from './pages/library/ApprovalsPage.jsx';
import { RiskRulesPage } from './pages/library/RiskRulesPage.jsx';
import { ConsentFormDetailPage } from './pages/consents/ConsentFormDetailPage.jsx';
import { ConsentFormEditPage } from './pages/consents/ConsentFormEditPage.jsx';
import { PatientConsentsTab } from './pages/consents/PatientConsentsTab.jsx';
import { PatientVisitsTab } from './pages/visits/PatientVisitsTab.jsx';
import { PatientStaysTab } from './pages/inpatient/PatientStaysTab.jsx';
import { AdmissionPage } from './pages/inpatient/AdmissionPage.jsx';
import { LabOrderPage } from './pages/lab/LabOrderPage.jsx';
import { LabWorklistPage } from './pages/lab/LabWorklistPage.jsx';
import { PatientLabTab } from './pages/lab/PatientLabTab.jsx';
import { DocumentPage } from './pages/inpatient/DocumentPage.jsx';
import { PrescriptionDesignPage } from './pages/visits/PrescriptionDesignPage.jsx';
import { PrescriptionSetsPage } from './pages/visits/PrescriptionSetsPage.jsx';
import { TestPackagesPage } from './pages/lab/TestPackagesPage.jsx';
import { TestPackagePage } from './pages/lab/TestPackagePage.jsx';
import { TestPackageEditPage } from './pages/lab/TestPackageEditPage.jsx';
import { PrescriptionSetPage } from './pages/visits/PrescriptionSetPage.jsx';
import { PrescriptionSetEditPage } from './pages/visits/PrescriptionSetEditPage.jsx';
import { VisitPage } from './pages/visits/VisitPage.jsx';
import { AnalyticsListPage } from './pages/analytics/AnalyticsListPage.jsx';
import { MonthlyReportPage } from './pages/analytics/MonthlyReportPage.jsx';
import { ByDoctorPage } from './pages/analytics/ByDoctorPage.jsx';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage.jsx';
import { AnalyticsSectionRoute } from './pages/analytics/AnalyticsSectionRoute.jsx';
import { ANALYTICS_ROLES, DRILLDOWN_ROLES } from './pages/analytics/analyticsRoles.js';
import { APPOINTMENT_ROLES, BED_ROLES, BILLING_MODULE_ROLES, LAB_ROLES, PHARMACY_MODULE_ROLES, STAFF_ROLE_PAGES } from './platform/modules.js';

// Unknown address: the title in the title bar, then a short message and the way back.
// Old Registers links (removed 2 Oct 2026) go to the monthly report in Analytics, keeping ?month=… so a bookmarked month still opens.
function RegistersRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/analytics/report', search }} replace />;
}

function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <div className="pf-content">
        <section className="card narrow acc-message">
          <span className="acc-message-icon" aria-hidden="true">
            <SearchX />
          </span>
          <p>There is no page at this address. Check the address, or go back to the start page.</p>
          <Link to="/" className="btn btn-primary">
            Go to the start page
          </Link>
        </section>
      </div>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* The patient portal (Version 2): its own sign-in with a code, no staff login */}
      <Route path="/portal" element={<PortalPage />} />
      {/* A hospital's own portal address: sign-in and sign-up with ABHA (docs/PATIENT_SIGNUP_PLAN.md) */}
      <Route path="/portal/h/:key" element={<PortalPage />} />
      {/* The waiting-room screen: no login, a secret in the address, tokens and times only */}
      <Route path="/display/:key" element={<DisplayPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequirePasswordChanged />}>
            <Route path="account" element={<AccountPage />} />
            <Route path="help" element={<HelpPage />} />
            {/* Professional details and Appearance are sections of My settings now */}
            <Route path="account/professional" element={<Navigate to="/account" replace />} />
            <Route path="account/voice-words" element={<VoiceWordsPage />} />
            <Route path="account/prescription-design" element={<PrescriptionDesignPage />} />
            <Route path="account/appearance" element={<Navigate to="/account" replace />} />
            {/* Platform area: super admins only */}
            <Route path="platform" element={<RequireSuperAdmin />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<OverviewPage />} />

              <Route path="hospitals" element={<HospitalsListPage />} />
              <Route path="hospitals/new" element={<HospitalNewPage />} />
              <Route path="hospitals/:id" element={<HospitalWorkspace />}>
                <Route index element={<HospitalOverviewTab />} />
                <Route path="staff" element={<HospitalStaffTab />} />
                <Route path="activity" element={<HospitalActivityTab />} />
              </Route>

              <Route path="users" element={<UsersListPage key="all" variant="all" />} />
              <Route path="users/by-role" element={<Navigate to="/platform/staff" replace />} />
              <Route path="staff" element={<StaffByRolePage />} />
              {STAFF_ROLE_PAGES.map((r) => (
                <Route key={r.role} path={`staff/${r.role}`} element={<UsersListPage key={`role-${r.role}`} variant="role" role={r.role} />} />
              ))}
              <Route path="users/permissions" element={<UserPermissionsPage />} />
              <Route path="users/super-admins" element={<UsersListPage key="superadmins" variant="superadmins" />} />
              <Route path="users/platform-admins" element={<UsersListPage key="platformadmins" variant="platformadmins" />} />
              <Route path="users/staff" element={<UsersListPage key="staff" variant="staff" />} />
              <Route path="users/pending" element={<UsersListPage key="pending" variant="pending" />} />
              <Route path="users/new" element={<UserNewPage />} />
              <Route path="users/:id" element={<UserWorkspace />}>
                <Route index element={<UserProfileTab />} />
                <Route path="hospitals" element={<UserHospitalsTab />} />
                <Route path="activity" element={<UserActivityTab />} />
              </Route>

              <Route path="analytics" element={<AnalyticsPage key="overview" section="overview" platform />} />
              <Route path="analytics/:section" element={<AnalyticsSectionRoute platform />} />

              {/* One page; the old addresses of its event groups open it with that Type chosen */}
              <Route path="audit" element={<AuditPage />} />
              {['security', 'access', 'sessions', 'patients'].map((c) => (
                <Route key={c} path={`audit/${c}`} element={<AuditCategoryRedirect to="/platform/audit" category={c} />} />
              ))}

              <Route path="account" element={<Navigate to="/account" replace />} />
            </Route>

            {/* Hospital area: everything here uses the hospital selected at the top of the left menu */}
            <Route
              index
              element={
                <HomeRedirect>
                  <RequireTenant>
                    <TodayPage />
                  </RequireTenant>
                </HomeRedirect>
              }
            />
            <Route element={<RequireTenant />}>
              <Route path="patients" element={<PatientsPage />} />
              <Route path="patients/new" element={<PatientNewPage />} />
              <Route path="patients/new/:careType" element={<PatientNewPage />} />
              <Route path="patients/new/:id/clinical" element={<NewPatientClinicalPage />} />
              <Route path="patients/:id" element={<PatientDetailPage />}>
                <Route index element={<PatientOverviewTab />} />
                <Route path="care-plan" element={<PatientCarePlanTab />} />
                <Route path="visits" element={<PatientVisitsTab />} />
                <Route path="visits/:visitId" element={<VisitPage />} />
                <Route path="appointments" element={<PatientAppointmentsTab />} />
                <Route path="bills" element={<PatientBillsTab />} />
                <Route path="abha" element={<PatientAbhaTab />} />
                <Route path="consents" element={<PatientConsentsTab />} />
                <Route path="information" element={<PatientConsentsTab kind="information" key="information" />} />
                <Route path="stays" element={<PatientStaysTab />} />
                <Route path="stays/:admissionId" element={<AdmissionPage />} />
                <Route path="stays/:admissionId/docs/:docId" element={<DocumentPage />} />
                <Route path="lab" element={<PatientLabTab />} />
                <Route path="lab/:orderId" element={<LabOrderPage />} />
                <Route path="edit" element={<PatientEditTab />} />
              </Route>
              <Route path="lab" element={<RequireTenantRole roles={LAB_ROLES} message="The lab module is for the lab, doctors, RMOs and nurses." />}>
                <Route index element={<LabWorklistPage />} />
                <Route path="orders/:orderId" element={<LabOrderPage />} />
              </Route>
              {/* The registers were removed on 2 Oct 2026; old links go to the monthly report in Analytics. */}
              <Route path="registers/*" element={<RegistersRedirect />} />
              <Route path="beds" element={<RequireTenantRole roles={BED_ROLES} message="The bed board is for reception, doctors, RMOs and nurses." />}>
                <Route index element={<BedBoardPage />} />
              </Route>
              <Route path="appointments" element={<RequireTenantRole roles={APPOINTMENT_ROLES} message="Appointments are for reception, doctors, RMOs and nurses." />}>
                <Route index element={<AppointmentsPage />} />
                <Route path="month" element={<AppointmentsMonthPage />} />
                <Route path="needs-time" element={<NeedsTimePage />} />
                <Route path="timings" element={<OpdTimingsPage />} />
              </Route>
              <Route path="pharmacy" element={<RequireTenantRole roles={PHARMACY_MODULE_ROLES} message="The pharmacy is for pharmacists and the hospital admin." />}>
                <Route element={<RequireTenantRole roles={['pharmacist']} message="Selling and issuing medicines is for the pharmacist." />}>
                  <Route index element={<SellPage key="sale" kind="sale" />} />
                  <Route path="issue" element={<SellPage key="issue" kind="issue" />} />
                  <Route path="purchases/new" element={<NewPurchasePage />} />
                  <Route path="supplier-returns/new" element={<NewSupplierReturnPage />} />
                </Route>
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="invoices/:id" element={<InvoicePage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="stock/:id" element={<MedicineStockPage />} />
                <Route path="purchases" element={<PurchasesPage />} />
                {/* Purchase orders (the pharmacist or the hospital admin) and returns to a supplier */}
                <Route path="orders" element={<OrdersPage />} />
                <Route path="orders/new" element={<OrderFormPage key="new" />} />
                <Route path="orders/:id" element={<OrderPage />} />
                <Route path="orders/:id/edit" element={<OrderFormPage key="edit" />} />
                <Route path="supplier-returns" element={<SupplierReturnsPage />} />
                <Route path="supplier-returns/:id" element={<SupplierReturnPage />} />
                <Route path="medicines" element={<MedicinesPage />} />
                <Route path="suppliers" element={<SuppliersPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<PharmacySettingsPage />} />
              </Route>
              <Route path="billing" element={<RequireTenantRole roles={BILLING_MODULE_ROLES} message="Billing is for reception, the billing department and the hospital admin." />}>
                <Route index element={<BillsPage />} />
                <Route path="bills/:id" element={<BillPage />} />
                <Route path="unpaid" element={<UnpaidPage />} />
                <Route path="daily" element={<DailySummaryPage />} />
                <Route path="prices" element={<PriceListPage />} />
                <Route path="monthly" element={<RequireTenantRole roles={['admin', 'billing']} message="The monthly report is for the hospital admin and the billing department." />}>
                  <Route index element={<MonthlyPage />} />
                </Route>
                {/* The hospital's UPI ID and payee name, for the UPI payment link of a bill */}
                <Route path="settings" element={<RequireTenantRole roles={['admin']} message="The billing settings are kept by the hospital admin." />}>
                  <Route index element={<BillingSettingsPage />} />
                </Route>
              </Route>
              <Route path="calendar" element={<RequireCalendarRole />}>
                <Route index element={<CalendarPage />} />
                <Route path="reminders" element={<RemindersPage />} />
              </Route>
              <Route
                path="analytics"
                element={<RequireTenantRole roles={ANALYTICS_ROLES} message="Analytics is for doctors and hospital admins. Ask your hospital admin if you need it." />}
              >
                <Route index element={<AnalyticsPage key="overview" section="overview" />} />
                <Route path="list" element={<RequireTenantRole roles={DRILLDOWN_ROLES} message="Patient lists are only for doctors." />}>
                  <Route index element={<AnalyticsListPage />} />
                </Route>
                {/* The monthly report (HMIS order), doctors only – moved here from Registers on 2 Oct 2026 */}
                <Route path="report" element={<RequireTenantRole roles={['doctor']} message="The monthly report is for doctors." />}>
                  <Route index element={<MonthlyReportPage />} />
                </Route>
                {/* Numbers per doctor, doctors only (4 Oct 2026) */}
                <Route path="doctors" element={<RequireTenantRole roles={['doctor']} message="The numbers per doctor are for doctors." />}>
                  <Route index element={<ByDoctorPage />} />
                </Route>
                <Route path=":section" element={<AnalyticsSectionRoute />} />
              </Route>
              <Route path="care-plans" element={<Navigate to="/care-plans/templates" replace />} />
              <Route path="care-plans/templates" element={<TemplatesPage />} />
              <Route path="care-plans/templates/:id" element={<TemplateDetailPage />} />
              <Route path="care-plans/templates/:id/edit" element={<TemplateEditPage />} />
              <Route path="care-plans/red-flags" element={<RedFlagRulesPage />} />
              <Route path="care-plans/red-flags/edit" element={<RedFlagRulesEditPage />} />
              {/* The worklist is on the Today page now; "Ask your records" is a Patients tab */}
              <Route path="worklist" element={<Navigate to="/" replace />} />
              <Route path="worklist/ask" element={<Navigate to="/analytics/ask" replace />} />
              <Route path="patients/ask" element={<Navigate to="/analytics/ask" replace />} />
              {/* Ask your records: under Analytics, for doctors, RMOs and nurses (RMOs and nurses have only this tab there) */}
              <Route path="analytics/ask" element={<RequireTenantRole roles={['doctor', 'rmo', 'nurse']} message="Asking the records is for doctors, RMOs and nurses." />}>
                <Route index element={<AskRecordsPage />} />
              </Route>
              <Route path="medicine-safety" element={<MedicineSafetyPage />} />
              <Route path="medicine-safety/edit" element={<MedicineSafetyEditPage />} />
              <Route path="library/approvals" element={<ApprovalsPage />} />
              <Route path="clinical-rules/risk" element={<RiskRulesPage />} />
              <Route path="consent-forms" element={<ConsentFormsPage />} />
              <Route path="consent-forms/:id" element={<ConsentFormDetailPage />} />
              <Route path="consent-forms/:id/edit" element={<ConsentFormEditPage />} />
              <Route path="information-forms" element={<ConsentFormsPage kind="information" key="information" />} />
              <Route path="information-forms/:id" element={<ConsentFormDetailPage kind="information" />} />
              <Route path="information-forms/:id/edit" element={<ConsentFormEditPage kind="information" />} />
              <Route path="test-packages" element={<TestPackagesPage />} />
              <Route path="test-packages/new" element={<TestPackageEditPage key="new" />} />
              <Route path="test-packages/:id" element={<TestPackagePage />} />
              <Route path="test-packages/:id/edit" element={<TestPackageEditPage key="edit" />} />
              <Route path="prescription-sets" element={<PrescriptionSetsPage />} />
              <Route path="prescription-sets/new" element={<PrescriptionSetEditPage key="new" />} />
              <Route path="prescription-sets/:id" element={<PrescriptionSetPage />} />
              <Route path="prescription-sets/:id/edit" element={<PrescriptionSetEditPage key="edit" />} />
              <Route path="admin" element={<RequireTenantAdmin />}>
                <Route index element={<Navigate to="staff" replace />} />
                <Route path="staff" element={<StaffPage />} />
                <Route path="settings" element={<LetterheadSettingsPage />} />
                <Route path="messages" element={<PatientMessagesSettingsPage />} />
                <Route path="opd-timings" element={<OpdTimingsPage admin />} />
                <Route path="beds" element={<BedSetupPage />} />
                <Route path="abdm" element={<AbdmSettingsPage />} />
                <Route path="audit-log" element={<HospitalAuditLogPage />} />
                {['security', 'access', 'sessions', 'patients'].map((c) => (
                  <Route key={c} path={`audit-log/${c}`} element={<AuditCategoryRedirect to="/admin/audit-log" category={c} />} />
                ))}
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

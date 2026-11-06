import { Suspense, lazy } from 'react';
import { SearchX } from 'lucide-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  FullPageSpinner,
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
import { LoginPage } from './pages/LoginPage.jsx';
import { ANALYTICS_ROLES, DRILLDOWN_ROLES } from './pages/analytics/analyticsRoles.js';
import { APPOINTMENT_ROLES, BED_ROLES, CLINICAL_AUDIT_ROLES, FORMULARY_ROLES, NEWBORN_FOLLOW_UP_ROLES, SPECIMEN_ROLES, BILLING_MODULE_ROLES, FOLLOW_UP_ROLES, LAB_ROLES, PHARMACY_MODULE_ROLES, REFERRAL_ROLES, SCAN_PAGE_ROLES, STAFF_ROLE_PAGES } from './platform/modules.js';

// Each screen is loaded the first time it is opened, not all at once when the app starts (31 Oct 2026: the one file
// with all 106 screens was 2.9 MB, slow to start on a phone). Screens of one file share one download.
const screen = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const load1 = () => import('./pages/AccountPage.jsx');
const AccountPage = screen(load1, 'AccountPage');
const load2 = () => import('./pages/HelpPage.jsx');
const HelpPage = screen(load2, 'HelpPage');
const load3 = () => import('./pages/settings/LetterheadSettingsPage.jsx');
const LetterheadSettingsPage = screen(load3, 'LetterheadSettingsPage');
const load4 = () => import('./pages/settings/PatientMessagesSettingsPage.jsx');
const PatientMessagesSettingsPage = screen(load4, 'PatientMessagesSettingsPage');
const load5 = () => import('./pages/reminders/RemindersPage.jsx');
const RemindersPage = screen(load5, 'RemindersPage');
const load6 = () => import('./pages/portal/PortalPage.jsx');
const PortalPage = screen(load6, 'PortalPage');
const load7 = () => import('./pages/patients/SignupsPage.jsx');
const SignupsPage = screen(load7, 'SignupsPage');
const load8 = () => import('./pages/ChangePasswordPage.jsx');
const ChangePasswordPage = screen(load8, 'ChangePasswordPage');
const load9 = () => import('./pages/TodayPage.jsx');
const TodayPage = screen(load9, 'TodayPage');
const load10 = () => import('./pages/calendar/CalendarPage.jsx');
const CalendarPage = screen(load10, 'CalendarPage');
const load11 = () => import('./pages/appointments/AppointmentsPage.jsx');
const AppointmentsPage = screen(load11, 'AppointmentsPage');
const NeedsTimePage = screen(load11, 'NeedsTimePage');
const load12 = () => import('./pages/appointments/OpdTimingsPage.jsx');
const OpdTimingsPage = screen(load12, 'OpdTimingsPage');
const load13 = () => import('./pages/appointments/AppointmentsMonthPage.jsx');
const AppointmentsMonthPage = screen(load13, 'AppointmentsMonthPage');
const load14 = () => import('./pages/beds/BedBoardPage.jsx');
const BedBoardPage = screen(load14, 'BedBoardPage');
const load15 = () => import('./pages/followups/FollowUpsPage.jsx');
const FollowUpsPage = screen(load15, 'FollowUpsPage');
const VaccinationFollowUpsPage = screen(load15, 'VaccinationFollowUpsPage');
const load16 = () => import('./pages/beds/BedSetupPage.jsx');
const BedSetupPage = screen(load16, 'BedSetupPage');
const load17 = () => import('./pages/appointments/DisplayPage.jsx');
const DisplayPage = screen(load17, 'DisplayPage');
const load18 = () => import('./pages/appointments/PatientAppointmentsTab.jsx');
const PatientAppointmentsTab = screen(load18, 'PatientAppointmentsTab');
const load19 = () => import('./pages/billing/BillPage.jsx');
const BillPage = screen(load19, 'BillPage');
const load20 = () => import('./pages/abdm/PatientAbhaTab.jsx');
const PatientAbhaTab = screen(load20, 'PatientAbhaTab');
const load21 = () => import('./pages/abdm/ScanShare.jsx');
const AbdmSettingsPage = screen(load21, 'AbdmSettingsPage');
const load22 = () => import('./pages/pharmacy/InvoicesPage.jsx');
const InvoicePage = screen(load22, 'InvoicePage');
const InvoicesPage = screen(load22, 'InvoicesPage');
const load23 = () => import('./pages/pharmacy/OrdersPage.jsx');
const OrderFormPage = screen(load23, 'OrderFormPage');
const OrderPage = screen(load23, 'OrderPage');
const OrdersPage = screen(load23, 'OrdersPage');
const load24 = () => import('./pages/pharmacy/PurchasesPage.jsx');
const MedicinesPage = screen(load24, 'MedicinesPage');
const NewPurchasePage = screen(load24, 'NewPurchasePage');
const PurchasesPage = screen(load24, 'PurchasesPage');
const SupplierPage = screen(load24, 'SupplierPage');
const SuppliersPage = screen(load24, 'SuppliersPage');
const load25 = () => import('./pages/pharmacy/ReportsPage.jsx');
const PharmacySettingsPage = screen(load25, 'PharmacySettingsPage');
const ReportsPage = screen(load25, 'ReportsPage');
const load26 = () => import('./pages/pharmacy/RegisterPage.jsx');
const RegisterRedirect = screen(load26, 'RegisterRedirect');
const load27 = () => import('./pages/pharmacy/SellPage.jsx');
const SellPage = screen(load27, 'SellPage');
const load28 = () => import('./pages/pharmacy/StockPage.jsx');
const MedicineStockPage = screen(load28, 'MedicineStockPage');
const StockPage = screen(load28, 'StockPage');
const load29 = () => import('./pages/pharmacy/OpeningStockPage.jsx');
const OpeningStockPage = screen(load29, 'OpeningStockPage');
const load30 = () => import('./pages/pharmacy/SupplierReturnsPage.jsx');
const NewSupplierReturnPage = screen(load30, 'NewSupplierReturnPage');
const SupplierReturnPage = screen(load30, 'SupplierReturnPage');
const SupplierReturnsPage = screen(load30, 'SupplierReturnsPage');
const load31 = () => import('./pages/billing/BillsPage.jsx');
const BillsPage = screen(load31, 'BillsPage');
const load32 = () => import('./pages/billing/MisReportsPage.jsx');
const MisReportsPage = screen(load32, 'MisReportsPage');
const load33 = () => import('./pages/billing/BillingExtras.jsx');
const BillingSettingsPage = screen(load33, 'BillingSettingsPage');
const load34 = () => import('./pages/billing/TallyPage.jsx');
const TallyBatchPage = screen(load34, 'TallyBatchPage');
const TallyBatchesPage = screen(load34, 'TallyBatchesPage');
const TallyControlPage = screen(load34, 'TallyControlPage');
const TallyExceptionsPage = screen(load34, 'TallyExceptionsPage');
const TallySettingsPage = screen(load34, 'TallySettingsPage');
const load35 = () => import('./pages/billing/BillingReports.jsx');
const MonthlyPage = screen(load35, 'MonthlyPage');
const PatientBillsTab = screen(load35, 'PatientBillsTab');
const PriceListPage = screen(load35, 'PriceListPage');
const UnpaidPage = screen(load35, 'UnpaidPage');
const load36 = () => import('./pages/billing/DailyCollectionPage.jsx');
const DailySummaryPage = screen(load36, 'DailySummaryPage');
const load37 = () => import('./pages/billing/DailyExpensesPage.jsx');
const DailyExpensesPage = screen(load37, 'DailyExpensesPage');
const load38 = () => import('./pages/billing/RefundSettlementPages.jsx');
const RefundPage = screen(load38, 'RefundPage');
const SettlementPage = screen(load38, 'SettlementPage');
const load39 = () => import('./pages/patients/PatientsPage.jsx');
const PatientsPage = screen(load39, 'PatientsPage');
const load40 = () => import('./pages/patients/OpdRegistrationPage.jsx');
const OpdRegistrationPage = screen(load40, 'OpdRegistrationPage');
const load41 = () => import('./pages/VoiceWordsPage.jsx');
const VoiceWordsPage = screen(load41, 'VoiceWordsPage');
const load42 = () => import('./pages/TypingShortcutsPage.jsx');
const TypingShortcutsPage = screen(load42, 'TypingShortcutsPage');
const load43 = () => import('./pages/PregnancyWheelPage.jsx');
const PregnancyWheelPage = screen(load43, 'PregnancyWheelPage');
const load44 = () => import('./pages/patients/PatientNewPage.jsx');
const NewPatientClinicalPage = screen(load44, 'NewPatientClinicalPage');
const PatientNewPage = screen(load44, 'PatientNewPage');
const load45 = () => import('./pages/patients/PatientDetailPage.jsx');
const PatientDetailPage = screen(load45, 'PatientDetailPage');
const PatientEditTab = screen(load45, 'PatientEditTab');
const PatientOverviewTab = screen(load45, 'PatientOverviewTab');
const load46 = () => import('./pages/patients/CarePlanTab.jsx');
const PatientCarePlanTab = screen(load46, 'PatientCarePlanTab');
const load47 = () => import('./pages/patients/FertilityPlanTab.jsx');
const PatientFertilityPlanTab = screen(load47, 'PatientFertilityPlanTab');
const load48 = () => import('./pages/patients/FertilityCyclePage.jsx');
const FertilityCyclePage = screen(load48, 'FertilityCyclePage');
const load49 = () => import('./pages/admin/StaffPage.jsx');
const AuditCategoryRedirect = screen(load49, 'AuditCategoryRedirect');
const HospitalAuditLogPage = screen(load49, 'HospitalAuditLogPage');
const StaffPage = screen(load49, 'StaffPage');
const AdminHomePage = screen(load49, 'AdminHomePage');
const load50 = () => import('./pages/platform/OverviewPage.jsx');
const OverviewPage = screen(load50, 'OverviewPage');
const load51 = () => import('./pages/platform/HospitalsListPage.jsx');
const HospitalNewPage = screen(load51, 'HospitalNewPage');
const HospitalsListPage = screen(load51, 'HospitalsListPage');
const load52 = () => import('./pages/platform/HospitalWorkspace.jsx');
const HospitalActivityTab = screen(load52, 'HospitalActivityTab');
const HospitalOverviewTab = screen(load52, 'HospitalOverviewTab');
const HospitalStaffTab = screen(load52, 'HospitalStaffTab');
const HospitalWorkspace = screen(load52, 'HospitalWorkspace');
const load53 = () => import('./pages/platform/UsersListPage.jsx');
const UserNewPage = screen(load53, 'UserNewPage');
const UsersListPage = screen(load53, 'UsersListPage');
const load54 = () => import('./pages/platform/StaffByRolePage.jsx');
const StaffByRolePage = screen(load54, 'StaffByRolePage');
const load55 = () => import('./pages/platform/UserPermissionsPage.jsx');
const AdminPermissionsPage = screen(load55, 'AdminPermissionsPage');
const UserPermissionsPage = screen(load55, 'UserPermissionsPage');
const load56 = () => import('./pages/platform/UserWorkspace.jsx');
const UserActivityTab = screen(load56, 'UserActivityTab');
const UserHospitalsTab = screen(load56, 'UserHospitalsTab');
const UserProfileTab = screen(load56, 'UserProfileTab');
const UserWorkspace = screen(load56, 'UserWorkspace');
const load57 = () => import('./pages/platform/AuditPage.jsx');
const AuditPage = screen(load57, 'AuditPage');
const load58 = () => import('./pages/platform/PlatformPatientsPage.jsx');
const PlatformPatientsPage = screen(load58, 'PlatformPatientsPage');
const load59 = () => import('./pages/careplans/TemplatesPage.jsx');
const TemplatesPage = screen(load59, 'TemplatesPage');
const load60 = () => import('./pages/careplans/TemplateDetailPage.jsx');
const TemplateDetailPage = screen(load60, 'TemplateDetailPage');
const load61 = () => import('./pages/careplans/TemplateEditPage.jsx');
const TemplateEditPage = screen(load61, 'TemplateEditPage');
const load62 = () => import('./pages/redflags/RedFlagRulesEditPage.jsx');
const RedFlagRulesEditPage = screen(load62, 'RedFlagRulesEditPage');
const load63 = () => import('./pages/redflags/RedFlagRulesPage.jsx');
const RedFlagRulesPage = screen(load63, 'RedFlagRulesPage');
const load64 = () => import('./pages/worklist/AskRecordsPage.jsx');
const AskRecordsPage = screen(load64, 'AskRecordsPage');
const load65 = () => import('./pages/medsafety/MedicineSafetyEditPage.jsx');
const MedicineSafetyEditPage = screen(load65, 'MedicineSafetyEditPage');
const load66 = () => import('./pages/medsafety/MedicineSafetyPage.jsx');
const MedicineSafetyPage = screen(load66, 'MedicineSafetyPage');
const load67 = () => import('./pages/consents/ConsentFormsPage.jsx');
const ConsentFormsPage = screen(load67, 'ConsentFormsPage');
const load68 = () => import('./pages/library/ApprovalsPage.jsx');
const ApprovalsPage = screen(load68, 'ApprovalsPage');
const load69 = () => import('./pages/library/RiskRulesPage.jsx');
const RiskRulesPage = screen(load69, 'RiskRulesPage');
const load70 = () => import('./pages/consents/ConsentFormDetailPage.jsx');
const ConsentFormDetailPage = screen(load70, 'ConsentFormDetailPage');
const load71 = () => import('./pages/consents/ConsentFormEditPage.jsx');
const ConsentFormEditPage = screen(load71, 'ConsentFormEditPage');
const load72 = () => import('./pages/consents/PatientConsentsTab.jsx');
const PatientConsentsTab = screen(load72, 'PatientConsentsTab');
const load73 = () => import('./pages/visits/PatientVisitsTab.jsx');
const PatientVisitsTab = screen(load73, 'PatientVisitsTab');
const load74 = () => import('./pages/inpatient/PatientStaysTab.jsx');
const PatientStaysTab = screen(load74, 'PatientStaysTab');
const load75 = () => import('./pages/inpatient/AdmissionPage.jsx');
const AdmissionPage = screen(load75, 'AdmissionPage');
const load76 = () => import('./pages/lab/LabOrderPage.jsx');
const LabOrderPage = screen(load76, 'LabOrderPage');
const load77 = () => import('./pages/lab/LabWorklistPage.jsx');
const LabWorklistPage = screen(load77, 'LabWorklistPage');
const load78 = () => import('./pages/lab/LabDashboardPage.jsx');
const LabDashboardPage = screen(load78, 'LabDashboardPage');
const load79 = () => import('./pages/lab/LabRegistrationPage.jsx');
const LabRegistrationPage = screen(load79, 'LabRegistrationPage');
const load80 = () => import('./pages/lab/LabResultsPage.jsx');
const LabResultsPage = screen(load80, 'LabResultsPage');
const load81 = () => import('./pages/billing/CashHandoverPage.jsx');
const CashHandoverPage = screen(load81, 'CashHandoverPage');
const load82 = () => import('./pages/lab/LabFindPage.jsx');
const LabFindPage = screen(load82, 'LabFindPage');
const load83 = () => import('./pages/lab/LabRegisterPage.jsx');
const LabRegisterPage = screen(load83, 'LabRegisterPage');
const load84 = () => import('./pages/lab/LabSettingsPage.jsx');
const LabSettingsPage = screen(load84, 'LabSettingsPage');
const load85 = () => import('./pages/lab/LabTestEditPage.jsx');
const LabTestEditPage = screen(load85, 'LabTestEditPage');
const load86 = () => import('./pages/lab/LabTestsPage.jsx');
const LabTestsPage = screen(load86, 'LabTestsPage');
const load87 = () => import('./pages/lab/LabQcPage.jsx');
const LabQcPage = screen(load87, 'LabQcPage');
const load88 = () => import('./pages/lab/LabReferrersPage.jsx');
const LabReferrersPage = screen(load88, 'LabReferrersPage');
const load89 = () => import('./pages/lab/LabStockPage.jsx');
const LabStockPage = screen(load89, 'LabStockPage');
const load90 = () => import('./pages/lab/VerifyReportPage.jsx');
const VerifyReportPage = screen(load90, 'VerifyReportPage');
const load91 = () => import('./pages/imaging/ImagingPages.jsx');
const ImagingStudyPage = screen(load91, 'ImagingStudyPage');
const ImagingWorklistPage = screen(load91, 'ImagingWorklistPage');
const load92 = () => import('./pages/lab/PatientLabTab.jsx');
const PatientLabTab = screen(load92, 'PatientLabTab');
const load93 = () => import('./pages/inpatient/DocumentPage.jsx');
const DocumentPage = screen(load93, 'DocumentPage');
const load94 = () => import('./pages/visits/PrescriptionDesignPage.jsx');
const PrescriptionDesignPage = screen(load94, 'PrescriptionDesignPage');
const load95 = () => import('./pages/visits/PrescriptionSetsPage.jsx');
const PrescriptionSetsPage = screen(load95, 'PrescriptionSetsPage');
const load96 = () => import('./pages/lab/TestPackagesPage.jsx');
const TestPackagesPage = screen(load96, 'TestPackagesPage');
const load97 = () => import('./pages/lab/TestPackagePage.jsx');
const TestPackagePage = screen(load97, 'TestPackagePage');
const load98 = () => import('./pages/lab/TestPackageEditPage.jsx');
const TestPackageEditPage = screen(load98, 'TestPackageEditPage');
const load99 = () => import('./pages/visits/PrescriptionSetPage.jsx');
const PrescriptionSetPage = screen(load99, 'PrescriptionSetPage');
const load100 = () => import('./pages/visits/PrescriptionSetEditPage.jsx');
const PrescriptionSetEditPage = screen(load100, 'PrescriptionSetEditPage');
const load101 = () => import('./pages/visits/VisitPage.jsx');
const VisitPage = screen(load101, 'VisitPage');
const load102 = () => import('./pages/analytics/AnalyticsListPage.jsx');
const AnalyticsListPage = screen(load102, 'AnalyticsListPage');
const load103 = () => import('./pages/analytics/MonthlyReportPage.jsx');
const MonthlyReportPage = screen(load103, 'MonthlyReportPage');
// Clinical Requirements Group A (PX-REQ-00)
const loadCrs1 = () => import('./pages/quality/ClinicalAuditPage.jsx');
const ClinicalAuditPage = screen(loadCrs1, 'ClinicalAuditPage');
const loadCrs3 = () => import('./pages/specimens/SpecimensPage.jsx');
const SpecimensPage = screen(loadCrs3, 'SpecimensPage');
const loadCrs3b = () => import('./pages/specimens/PatientSpecimensTab.jsx');
const PatientSpecimensTab = screen(loadCrs3b, 'PatientSpecimensTab');
const loadCrs4 = () => import('./pages/newborn/NewbornFollowUpPage.jsx');
const NewbornFollowUpPage = screen(loadCrs4, 'NewbornFollowUpPage');
const NewbornLogPage = screen(loadCrs4, 'NewbornLogPage');
const PatientScreeningTab = screen(loadCrs4, 'PatientScreeningTab');
const loadCrs5 = () => import('./pages/scores/PatientScoresTab.jsx');
const PatientScoresTab = screen(loadCrs5, 'PatientScoresTab');
const loadCrs6 = () => import('./pages/incidents/IncidentsPage.jsx');
const IncidentsPage = screen(loadCrs6, 'IncidentsPage');
const IncidentPage = screen(loadCrs6, 'IncidentPage');
const loadCrs7 = () => import('./pages/formulary/FormularyPage.jsx');
const FormularyPage = screen(loadCrs7, 'FormularyPage');
const load104 = () => import('./pages/analytics/ByDoctorPage.jsx');
const ByDoctorPage = screen(load104, 'ByDoctorPage');
const load105 = () => import('./pages/analytics/AnalyticsPage.jsx');
const AnalyticsPage = screen(load105, 'AnalyticsPage');
const load106 = () => import('./pages/analytics/AnalyticsSectionRoute.jsx');
const AnalyticsSectionRoute = screen(load106, 'AnalyticsSectionRoute');
const load107 = () => import('./pages/settings/ReferralSettingsPage.jsx');
const ReferralSettingsPage = screen(load107, 'ReferralSettingsPage');
const load108 = () => import('./pages/settings/ScanBridgeSettingsPage.jsx');
const ScanBridgeSettingsPage = screen(load108, 'ScanBridgeSettingsPage');
const load109 = () => import('./pages/referrals/ReferralsDeskPage.jsx');
const ReferralsDeskPage = screen(load109, 'ReferralsDeskPage');
const load110 = () => import('./pages/referrals/NewReferralPage.jsx');
const NewReferralPage = screen(load110, 'NewReferralPage');
const load111 = () => import('./pages/referrals/ReferralPage.jsx');
const ReferralPage = screen(load111, 'ReferralPage');
const load112 = () => import('./pages/referrals/ReferringDoctorsPage.jsx');
const ReferringDoctorsPage = screen(load112, 'ReferringDoctorsPage');
const load113 = () => import('./pages/referrals/ReferringDoctorSummaryPage.jsx');
const ReferringDoctorSummaryPage = screen(load113, 'ReferringDoctorSummaryPage');
const load114 = () => import('./pages/referrals/ReferralReviewPage.jsx');
const ReferralReviewPage = screen(load114, 'ReferralReviewPage');
const load115 = () => import('./pages/referrals/ReferralSlipPage.jsx');
const ReferralSlipPage = screen(load115, 'ReferralSlipPage');
const load116 = () => import('./pages/referrals/PatientReferralsTab.jsx');
const PatientReferralsTab = screen(load116, 'PatientReferralsTab');

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
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* The patient portal (Version 2): its own sign-in with a code, no staff login */}
        <Route path="/portal" element={<PortalPage />} />
        {/* A hospital's own portal address: sign-in and sign-up with ABHA (docs/PATIENT_SIGNUP_PLAN.md) */}
        <Route path="/portal/h/:key" element={<PortalPage />} />
        {/* The waiting-room screen: no login, a secret in the address, tokens and times only */}
        <Route path="/display/:key" element={<DisplayPage />} />
        {/* Is this lab report genuine? The QR code on a printed report opens it – no login (Lab version 2) */}
        <Route path="/verify/:code" element={<VerifyReportPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route element={<RequirePasswordChanged />}>
              <Route path="account" element={<AccountPage />} />
              <Route path="help" element={<HelpPage />} />
              {/* Professional details and Appearance are sections of My settings now */}
              <Route path="account/professional" element={<Navigate to="/account" replace />} />
              <Route path="account/voice-words" element={<VoiceWordsPage />} />
              <Route path="account/shortcuts" element={<TypingShortcutsPage />} />
              <Route path="tools/pregnancy-wheel" element={<PregnancyWheelPage />} />
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

                <Route path="patients" element={<PlatformPatientsPage />} />
                <Route path="users" element={<UsersListPage key="all" variant="all" />} />
                <Route path="users/by-role" element={<Navigate to="/platform/staff" replace />} />
                <Route path="staff" element={<StaffByRolePage />} />
                {STAFF_ROLE_PAGES.map((r) => (
                  <Route key={r.role} path={`staff/${r.role}`} element={<UsersListPage key={`role-${r.role}`} variant="role" role={r.role} />} />
                ))}
                <Route path="users/permissions" element={<UserPermissionsPage />} />
                <Route path="users/admin-permissions" element={<AdminPermissionsPage />} />
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
                <Route path="patients/opd" element={<OpdRegistrationPage />} />
                <Route path="patients/sign-ups" element={<SignupsPage />} />
                <Route path="patients/new/:careType" element={<PatientNewPage />} />
                <Route path="patients/new/:id/clinical" element={<NewPatientClinicalPage />} />
                <Route path="patients/:id" element={<PatientDetailPage />}>
                  <Route index element={<PatientOverviewTab />} />
                  <Route path="care-plan" element={<PatientCarePlanTab />} />
                  {/* Her fertility treatment plan (infertility patients; docs/FERTILITY_PLAN.md) */}
                  <Route path="fertility-plan" element={<PatientFertilityPlanTab />} />
                  <Route path="fertility-plan/cycles/:cycleId" element={<FertilityCyclePage />} />
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
                  {/* Her referrals from other doctors (doctors and RMOs; the server lists only those this person may open) */}
                  <Route path="referrals" element={<PatientReferralsTab />} />
                  <Route path="specimens" element={<PatientSpecimensTab />} />
                  <Route path="screening" element={<PatientScreeningTab />} />
                  <Route path="scores" element={<PatientScoresTab />} />
                  <Route path="lab/:orderId" element={<LabOrderPage />} />
                  <Route path="edit" element={<PatientEditTab />} />
                </Route>
                <Route path="lab" element={<RequireTenantRole roles={LAB_ROLES} message="The lab module is for the lab, doctors, RMOs and nurses." />}>
                  <Route index element={<LabWorklistPage />} />
                  {/* The eLabAssist-style dashboard, registration on one screen and result entry by department (19 Oct 2026) */}
                  <Route path="dashboard" element={<LabDashboardPage />} />
                  <Route path="new" element={<RequireTenantRole roles={['lab']} message="The lab registers walk-in and referred patients." />}>
                    <Route index element={<LabRegistrationPage />} />
                  </Route>
                  <Route path="results" element={<LabResultsPage />} />
                  <Route path="orders/:orderId" element={<LabOrderPage />} />
                  <Route path="find" element={<LabFindPage />} />
                  <Route path="register" element={<LabRegisterPage />} />
                  <Route path="tests" element={<LabTestsPage />} />
                  <Route path="tests/:key" element={<LabTestEditPage key="edit" />} />
                  <Route path="settings" element={<LabSettingsPage />} />
                  <Route path="qc" element={<LabQcPage />} />
                  <Route path="stock" element={<LabStockPage />} />
                  <Route path="referrers" element={<LabReferrersPage />} />
                </Route>
                {/* The registers were removed on 2 Oct 2026; old links go to the monthly report in Analytics. */}
                <Route path="registers/*" element={<RegistersRedirect />} />
                {/* USG and radiology (Lab version 2) */}
                <Route path="scans" element={<RequireTenantRole roles={SCAN_PAGE_ROLES} message="Sonography is for doctors, RMOs and sonography staff." />}>
                  <Route index element={<ImagingWorklistPage />} />
                  <Route path=":id" element={<ImagingStudyPage />} />
                </Route>
                <Route path="formulary" element={<RequireTenantRole roles={FORMULARY_ROLES} message="The formulary is for doctors, RMOs, nurses and the pharmacist." />}>
                  <Route index element={<FormularyPage />} />
                </Route>
                <Route path="incidents">
                  <Route index element={<IncidentsPage />} />
                  <Route path=":id" element={<IncidentPage />} />
                </Route>
                <Route path="newborn-follow-up" element={<RequireTenantRole roles={NEWBORN_FOLLOW_UP_ROLES} message="Newborn follow-up is for doctors, RMOs, nurses and the follow-up coordinator." />}>
                  <Route index element={<NewbornFollowUpPage />} />
                  <Route path=":patientId" element={<NewbornLogPage />} />
                </Route>
                <Route path="specimens" element={<RequireTenantRole roles={SPECIMEN_ROLES} message="Specimens are for doctors, RMOs and nurses." />}>
                  <Route index element={<SpecimensPage />} />
                </Route>
                <Route path="clinical-audit" element={<RequireTenantRole roles={CLINICAL_AUDIT_ROLES} message="The clinical audit is for doctors, RMOs, the quality lead and the hospital admin." />}>
                  <Route index element={<ClinicalAuditPage />} />
                </Route>
                <Route path="beds" element={<RequireTenantRole roles={BED_ROLES} message="The bed board is for reception, doctors, RMOs and nurses." />}>
                  <Route index element={<BedBoardPage />} />
                </Route>
                {/* Reception's follow-ups: who to call and who is coming, babies due (routes/followUps.js) */}
                <Route path="follow-ups" element={<RequireTenantRole roles={FOLLOW_UP_ROLES} message="The follow-ups list is for reception." />}>
                  <Route index element={<FollowUpsPage />} />
                  <Route path="vaccinations" element={<VaccinationFollowUpsPage />} />
                </Route>
                {/* Referrals from other doctors (docs/REFERRALS_PLAN.md): the referral desk, doctors and RMOs */}
                <Route path="referrals" element={<RequireTenantRole roles={REFERRAL_ROLES} message="Referrals are for the referral desk, doctors and RMOs." />}>
                  <Route index element={<ReferralsDeskPage />} />
                  <Route path="new" element={<NewReferralPage />} />
                  <Route path="doctors" element={<ReferringDoctorsPage />} />
                  <Route path="doctors/:doctorId/summary" element={<ReferringDoctorSummaryPage />} />
                  <Route path="review" element={<ReferralReviewPage />} />
                  <Route path="slip" element={<ReferralSlipPage />} />
                  <Route path=":referralId" element={<ReferralPage />} />
                </Route>
                <Route path="appointments" element={<RequireTenantRole roles={APPOINTMENT_ROLES} message="Appointments are for reception, the referral desk, doctors, RMOs and nurses." />}>
                  <Route index element={<AppointmentsPage />} />
                  <Route path="month" element={<AppointmentsMonthPage />} />
                  <Route path="needs-time" element={<NeedsTimePage />} />
                  <Route path="timings" element={<OpdTimingsPage />} />
                </Route>
                <Route path="pharmacy" element={<RequireTenantRole roles={PHARMACY_MODULE_ROLES} message="The pharmacy is for pharmacists and the hospital admin." />}>
                  <Route element={<RequireTenantRole roles={['pharmacist']} message="Selling and issuing medicines is for the pharmacist." />}>
                    <Route index element={<SellPage key="sale" kind="sale" />} />
                    <Route path="issue" element={<SellPage key="issue" kind="issue" />} />
                    {/* The day's OPD, IPD and External patients are on Today (owner, 26 Oct 2026) */}
                    <Route path="register" element={<RegisterRedirect />} />
                    <Route path="purchases/new" element={<NewPurchasePage />} />
                    <Route path="supplier-returns/new" element={<NewSupplierReturnPage />} />
                  </Route>
                  <Route path="invoices" element={<InvoicesPage />} />
                  <Route path="invoices/:id" element={<InvoicePage />} />
                  <Route path="stock" element={<StockPage />} />
                  <Route path="stock/import" element={<OpeningStockPage />} />
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
                  <Route path="suppliers/:id" element={<SupplierPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="settings" element={<PharmacySettingsPage />} />
                </Route>
                {/* The daily cash handover: those who take payments hand over; a doctor or the admin confirms */}
                <Route path="cash-handover" element={<RequireTenantRole roles={[...BILLING_MODULE_ROLES, 'doctor', 'lab']} message="The cash handover is for reception, the billing department, the lab, doctors and the hospital admin." />}>
                  <Route index element={<CashHandoverPage />} />
                </Route>
                {/* Daily expenses (owner, 28 Oct 2026): money paid out from the counter, its own place in the menu */}
                <Route path="expenses" element={<RequireTenantRole roles={BILLING_MODULE_ROLES} message="Daily expenses are for reception, the billing department and the hospital admin." />}>
                  <Route index element={<DailyExpensesPage />} />
                </Route>
                <Route path="billing" element={<RequireTenantRole roles={BILLING_MODULE_ROLES} message="Billing is for reception, the billing department and the hospital admin." />}>
                  <Route index element={<BillsPage />} />
                  <Route path="bills/:id" element={<BillPage />} />
                  <Route path="unpaid" element={<UnpaidPage />} />
                  <Route path="refund" element={<RefundPage />} />
                  <Route path="settlement" element={<SettlementPage />} />
                  <Route path="daily" element={<DailySummaryPage />} />
                  <Route path="reports" element={<MisReportsPage />} />
                  <Route path="prices" element={<PriceListPage />} />
                  <Route path="monthly" element={<RequireTenantRole roles={['admin', 'billing']} message="The monthly report is for the hospital admin and the billing department." />}>
                    <Route index element={<MonthlyPage />} />
                  </Route>
                  {/* The hospital's UPI ID and payee name, for the UPI payment link of a bill */}
                  <Route path="settings" element={<RequireTenantRole roles={['admin']} message="The billing settings are kept by the hospital admin." />}>
                    <Route index element={<BillingSettingsPage />} />
                  </Route>
                  {/* The Tally link (docs/TALLY_PLAN.md): files for the accountant's Tally – the hospital admin and the accounts staff */}
                  <Route path="accounts" element={<RequireTenantRole roles={['admin', 'billing']} message="The Tally link is for the hospital admin and the accounts staff." />}>
                    <Route index element={<TallyBatchesPage />} />
                    <Route path="settings" element={<TallySettingsPage />} />
                    <Route path="exceptions" element={<TallyExceptionsPage />} />
                    <Route path="control" element={<TallyControlPage />} />
                    <Route path="batches/:id" element={<TallyBatchPage />} />
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
                  <Route index element={<AdminHomePage />} />
                  <Route path="staff" element={<StaffPage />} />
                  <Route path="settings" element={<LetterheadSettingsPage />} />
                  <Route path="messages" element={<PatientMessagesSettingsPage />} />
                  <Route path="opd-timings" element={<OpdTimingsPage admin />} />
                  <Route path="beds" element={<BedSetupPage />} />
                  <Route path="abdm" element={<AbdmSettingsPage />} />
                  {/* The referral settings: centres, desk number, consultants' direct lines, working hours, holidays */}
                  <Route path="referrals" element={<ReferralSettingsPage />} />
                  {/* The ultrasound machine's scan bridge key (docs/USG_MACHINE_PLAN.md) */}
                  <Route path="ultrasound-machine" element={<ScanBridgeSettingsPage />} />
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
    </Suspense>
  );
}

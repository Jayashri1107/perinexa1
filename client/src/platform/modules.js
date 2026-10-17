import { BedDouble, Building2, CalendarCheck, CalendarClock, CalendarDays, ChartColumn, FileSignature, FlaskConical, HeartPulse, Info, LayoutDashboard, Library, ListChecks, Pill, Receipt, ScanLine, Settings, ShieldCheck, Siren, Stethoscope, UserCog, Users } from 'lucide-react';
import { ANALYTICS_ROLES } from '../pages/analytics/analyticsRoles.js';
import { NEW_PATIENT_LINKS } from '../pages/patients/patientFormat.js';

// Who gets Analytics, and who may open patient lists from it (one copy, checked against the server's).
export { ANALYTICS_ROLES, DRILLDOWN_ROLES, EXACT_ROLES } from '../pages/analytics/analyticsRoles.js';

// Navigation for every kind of login. Everyone gets the same layout: main modules in the left menu,
// sub-modules as tabs at the top of the page. Only WHICH modules appear depends on the person's role.
// Add a module or tab here and it appears in the navigation automatically.

// The Analytics tabs (the page adds the chosen filters to each).
function analyticsModuleTabs(base) {
  return [
    { label: 'Overview', to: base, end: true },
    { label: 'Pregnancy', to: `${base}/pregnancy`, end: true },
    { label: 'Risk & conditions', to: `${base}/risk`, end: true },
    { label: 'Care plans & visits', to: `${base}/care`, end: true },
    { label: 'Deliveries', to: `${base}/deliveries`, end: true },
    { label: 'Newborn', to: `${base}/newborn`, end: true },
  ];
}

// The super admin's Staff pages: one per role, across every hospital (Pharmacy = pharmacists, Accounts = billing).
export const STAFF_ROLE_PAGES = [
  { role: 'doctor', label: 'Doctors' },
  { role: 'rmo', label: 'RMOs' },
  { role: 'nurse', label: 'Nurses' },
  { role: 'receptionist', label: 'Receptionists' },
  { role: 'lab', label: 'Lab' },
  { role: 'pharmacist', label: 'Pharmacy' },
  { role: 'billing', label: 'Accounts' },
  { role: 'admin', label: 'Hospital admins' },
];

// Platform super admins.
export const PLATFORM_MODULES = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    to: '/platform/overview',
    tabs: [{ label: 'Summary', to: '/platform/overview', end: true }],
  },
  {
    key: 'platform-analytics',
    label: 'Analytics',
    icon: ChartColumn,
    to: '/platform/analytics',
    tabs: analyticsModuleTabs('/platform/analytics'),
  },
  {
    key: 'hospitals',
    label: 'Hospitals',
    icon: Building2,
    to: '/platform/hospitals',
    tabs: [
      { label: 'All hospitals', to: '/platform/hospitals', end: true },
      { label: 'New hospital', to: '/platform/hospitals/new', end: true },
    ],
  },
  {
    key: 'users',
    label: 'Users & access',
    icon: Users,
    to: '/platform/users',
    tabs: [
      { label: 'All users', to: '/platform/users', end: true },
      { label: 'Super admins', to: '/platform/users/super-admins', end: true },
      { label: 'Platform admins', to: '/platform/users/platform-admins', end: true },
      { label: 'User permissions', to: '/platform/users/permissions', end: true },
      { label: 'Hospital staff', to: '/platform/users/staff', end: true },
      { label: 'Pending first login', to: '/platform/users/pending', end: true },
      { label: 'New account', to: '/platform/users/new', end: true },
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    icon: Stethoscope,
    to: '/platform/staff',
    tabs: [
      { label: 'By role', to: '/platform/staff', end: true },
      ...STAFF_ROLE_PAGES.map((r) => ({ label: r.label, to: `/platform/staff/${r.role}`, end: true })),
    ],
  },
  {
    key: 'audit',
    label: 'Audit & compliance',
    icon: ShieldCheck,
    to: '/platform/audit',
    // One page; the event groups are its "Type" filter
    tabs: [{ label: 'Audit & compliance', to: '/platform/audit', end: true }],
  },
];

// Hospital staff (doctors, nurses, receptionists, hospital admins). Everything here works on the
// hospital selected in the menu.
// The start page: the day's lists (TodayPage – what was the Dashboard, the Worklist and today's Calendar).
const HOSPITAL_TODAY = {
  key: 'today',
  label: 'Today',
  icon: CalendarCheck,
  to: '/',
  end: true,
  tabs: [{ label: 'Today', to: '/', end: true }],
};

const HOSPITAL_PATIENTS = {
  key: 'patients',
  label: 'Patients',
  icon: HeartPulse,
  to: '/patients',
  tabs: [
    { label: 'All patients', to: '/patients', end: true },
    { label: 'New patient', to: '/patients/new', menu: NEW_PATIENT_LINKS },
    // Patients' own portal accounts waiting for approval (owner, 16 Oct 2026)
    { label: 'Online sign-ups', to: '/patients/sign-ups' },
  ],
};

// The lab (Version 2): samples to take, results to enter, recent reports. Same list as server/src/routes/lab.js.
export const LAB_ROLES = ['lab', 'doctor', 'rmo', 'nurse'];
const HOSPITAL_LAB = {
  key: 'lab',
  label: 'Lab',
  icon: FlaskConical,
  to: '/lab',
  // The full lab system (docs/LAB_LIMS_PLAN.md): Find, the register, the hospital's test list and the lab's settings
  tabs: [
    { label: 'Worklist', to: '/lab', end: true },
    { label: 'Find', to: '/lab/find', end: true },
    { label: 'Register', to: '/lab/register', end: true },
    // Lab version 2 (docs/LAB_V2_PLAN.md): quality control, the lab's stock and cost per test, referrers
    { label: 'QC', to: '/lab/qc', end: true },
    { label: 'Stock', to: '/lab/stock', end: true },
    { label: 'Tests', to: '/lab/tests', end: false },
    { label: 'Referrers', to: '/lab/referrers', end: true },
    { label: 'Settings', to: '/lab/settings', end: true },
  ],
};

// USG and radiology (Lab version 2 part 8): the scan worklist and reports. Same list as server/src/routes/imaging.js.
export const SCAN_ROLES = ['doctor', 'rmo', 'nurse', 'receptionist'];
const HOSPITAL_SCANS = {
  key: 'scans',
  label: 'Scans',
  icon: ScanLine,
  to: '/scans',
  tabs: [{ label: 'Scans', to: '/scans', end: false }],
};

// The calendar (LMP, EDD, care-plan and booked visits). Same list as server/src/calendar/calendarRules.js.
export const CALENDAR_ROLES = ['doctor', 'rmo', 'receptionist'];
const HOSPITAL_CALENDAR = {
  key: 'calendar',
  label: 'Calendar',
  icon: CalendarDays,
  to: '/calendar',
  tabs: [
    { label: 'Calendar', to: '/calendar', end: true },
    { label: 'Reminders', to: '/calendar/reminders', end: true },
  ],
};

// Appointment booking: one doctor's day of 10-minute slots, next visits that need a time, and OPD timings. Reception
// and doctors book; RMOs and nurses can look. Same lists as server/src/appointments/appointmentRules.js.
export const APPOINTMENT_ROLES = ['receptionist', 'doctor', 'rmo', 'nurse'];
export const BOOKING_ROLES = ['receptionist', 'doctor'];
const HOSPITAL_APPOINTMENTS = {
  key: 'appointments',
  label: 'Appointments',
  icon: CalendarClock,
  to: '/appointments',
  tabs: [
    { label: 'Schedule', to: '/appointments', end: true },
    { label: 'Month', to: '/appointments/month', end: true },
    { label: 'Needs a time', to: '/appointments/needs-time', end: true },
    { label: 'OPD settings', to: '/appointments/timings', end: true },
  ],
};

// Billing: bills, payments, the daily summary and the price list – reception, the billing department and the hospital
// admin (Monthly: the admin and billing; Settings: admin).
// Same list as server/src/billing/billingRules.js; the pages' own tabs come from pages/billing/billingFormat.js.
export const BILLING_MODULE_ROLES = ['receptionist', 'billing', 'admin'];
const HOSPITAL_BILLING = {
  key: 'billing',
  label: 'Billing',
  icon: Receipt,
  to: '/billing',
  tabs: [
    { label: 'Bills', to: '/billing', end: false },
    { label: 'Unpaid', to: '/billing/unpaid', end: true },
    { label: 'Daily summary', to: '/billing/daily', end: true },
    { label: 'Cash handover', to: '/cash-handover', end: true },
    { label: 'Monthly', to: '/billing/monthly', end: true },
    { label: 'Price list', to: '/billing/prices', end: true },
    { label: 'Settings', to: '/billing/settings', end: true },
  ],
};

// The pharmacy: the pharmacist's counter, stock and registers; the hospital admin sees stock and reports. Same lists as
// server/src/pharmacy/pharmacyRules.js; the pages' own tabs come from pages/pharmacy/pharmacyFormat.js.
export const PHARMACY_MODULE_ROLES = ['pharmacist', 'admin'];
const HOSPITAL_PHARMACY = {
  key: 'pharmacy',
  label: 'Pharmacy',
  icon: Pill,
  to: '/pharmacy',
  tabs: [{ label: 'Pharmacy', to: '/pharmacy', end: false }],
};

// Analytics (Feature 11): doctors and hospital admins (ANALYTICS_ROLES).
const HOSPITAL_ANALYTICS = {
  key: 'analytics',
  label: 'Analytics',
  icon: ChartColumn,
  to: '/analytics',
  tabs: analyticsModuleTabs('/analytics'),
};
// "Ask your records" (searching the records with AI) is part of Analytics: doctors get it as a tab beside the
// numbers; RMOs and nurses, who have no Analytics, get Analytics with only this tab.
export const ASK_TAB = { label: 'Ask your records', to: '/analytics/ask', end: true };
const HOSPITAL_ASK_ONLY = { key: 'analytics', label: 'Analytics', icon: ChartColumn, to: '/analytics/ask', activeFor: '/analytics', tabs: [ASK_TAB] };

// The knowledge base (at the owner's request): the hospital's libraries under one item in the left menu, each a tab
// at the top of its pages – care plans (with the red-flag rules), consent forms and ready-made prescription sets (with
// the medicine safety list). A tab's `sections` are the second row of tabs on its own pages.
const KNOWLEDGE_CARE_PLANS = {
  key: 'care-plans',
  label: 'Care plans',
  icon: ListChecks,
  to: '/care-plans/templates',
  activeFor: '/care-plans/templates',
};
// The rules the app checks with (red flags, medicine safety, the risk level), together – the doctor approves each.
const KNOWLEDGE_RULES = {
  key: 'clinical-rules',
  label: 'Clinical rules',
  icon: Siren,
  to: '/care-plans/red-flags',
  activeFor: ['/care-plans/red-flags', '/medicine-safety', '/clinical-rules'],
  sections: [
    { label: 'Red-flag rules', to: '/care-plans/red-flags', end: false },
    { label: 'Medicine safety', to: '/medicine-safety', end: false },
    { label: 'Risk rules', to: '/clinical-rules/risk', end: true },
  ],
};

// Care plans, the worklist (on the Today page) and asking the records with AI.
export const CARE_PLAN_ROLES = ['doctor', 'rmo', 'nurse'];

// The hospital's consent-form library (bilingual forms printed for patients). Same roles as care plans.
const KNOWLEDGE_CONSENTS = {
  key: 'consent-forms',
  label: 'Consent forms',
  icon: FileSignature,
  to: '/consent-forms',
  activeFor: '/consent-forms',
};

// Information forms: a condition or complication (PIH, GDM …) explained to the patient and her relatives, who sign
// that they were informed. Kept apart from the consent forms (at the owner's request). Same roles.
const KNOWLEDGE_INFORMATION = {
  key: 'information-forms',
  label: 'Information forms',
  icon: Info,
  to: '/information-forms',
  activeFor: '/information-forms',
};

// The hospital's test packages: ready-made sets of lab tests (baby packages by day of life). Same roles as care plans.
const KNOWLEDGE_TEST_PACKAGES = {
  key: 'test-packages',
  label: 'Test packages',
  icon: FlaskConical,
  to: '/test-packages',
  activeFor: '/test-packages',
};

// The hospital's ready-made prescription sets (Feature 8b): for those who write prescriptions.
const KNOWLEDGE_RX_SETS = {
  key: 'prescription-sets',
  label: 'Prescription sets',
  icon: Pill,
  to: '/prescription-sets',
  activeFor: '/prescription-sets',
};
export const PRESCRIBER_ROLES = ['doctor', 'rmo'];

// Everything in the library still waiting for a doctor's approval (doctors approve).
const KNOWLEDGE_APPROVALS = {
  key: 'approvals',
  label: 'To approve',
  icon: ListChecks,
  to: '/library/approvals',
  activeFor: '/library/approvals',
};

const HOSPITAL_KNOWLEDGE = {
  key: 'knowledge',
  label: 'Clinic library',
  icon: Library,
  to: '/care-plans/templates',
  activeFor: ['/care-plans', '/consent-forms', '/information-forms', '/test-packages', '/prescription-sets', '/medicine-safety', '/library', '/clinical-rules', '/tools'],
  // The pregnancy wheel (doctor ideas #8): a calculator, for everyone who opens the library
  tabs: [KNOWLEDGE_APPROVALS, KNOWLEDGE_CARE_PLANS, KNOWLEDGE_RULES, KNOWLEDGE_CONSENTS, KNOWLEDGE_INFORMATION, KNOWLEDGE_TEST_PACKAGES, KNOWLEDGE_RX_SETS, { key: 'wheel', label: 'Pregnancy wheel', to: '/tools/pregnancy-wheel', end: true }],
};
/** The clinic library's tabs this person may open: To approve for doctors, prescription sets for those who prescribe. */
export const knowledgeTabs = (roles = []) =>
  HOSPITAL_KNOWLEDGE.tabs.filter((t) => (t.key === 'approvals' ? roles.includes('doctor') : t.key !== 'prescription-sets' || roles.some((r) => PRESCRIBER_ROLES.includes(r))));
/** The second row of tabs on a knowledge-base tab's pages ('care-plans' or 'prescription-sets'). */
export const knowledgeSections = (key) => HOSPITAL_KNOWLEDGE.tabs.find((t) => t.key === key)?.sections ?? [];
/** "Knowledge base › …" at the start of a knowledge-base page's path. */
export const KNOWLEDGE_CRUMB = { label: 'Clinic library', to: HOSPITAL_KNOWLEDGE.to };

// Hospital admins: staff, the audit log and the print letterhead, under one item in the left menu.
export const HOSPITAL_ADMIN = {
  key: 'hospital-admin',
  label: 'Hospital admin',
  icon: Settings,
  to: '/admin/staff',
  activeFor: '/admin',
  tabs: [
    { label: 'Staff', to: '/admin/staff', end: true },
    { label: 'Audit log', to: '/admin/audit-log', end: false },
    { label: 'Print letterhead', to: '/admin/settings', end: true },
    { label: 'Patient messages', to: '/admin/messages', end: true },
    { label: 'OPD timings', to: '/admin/opd-timings', end: true },
    { label: 'Beds', to: '/admin/beds', end: true },
    { label: 'ABDM', to: '/admin/abdm', end: true },
  ],
};

// Beds (owner, 13 Oct 2026): the bed board and admitting at the desk. Same list as server/src/inpatient/beds.js.
export const BED_ROLES = ['receptionist', 'doctor', 'rmo', 'nurse'];
// Not in a doctor's menu (owner, 14 Oct 2026): doctors still see the free beds when admitting from a patient's page.
export const BED_MENU_ROLES = ['receptionist', 'rmo', 'nurse'];
const HOSPITAL_BEDS = {
  key: 'beds',
  label: 'Beds',
  icon: BedDouble,
  to: '/beds',
  tabs: [{ label: 'Bed board', to: '/beds', end: true }],
};

// Roles that work with patient records, and those that may register new patients.
export const PATIENT_ROLES = ['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'];
export const REGISTER_ROLES = ['doctor', 'rmo', 'receptionist'];
const any = (roles, list) => roles.some((r) => list.includes(r));
export const canSeePatients = (roles = []) => any(roles, PATIENT_ROLES);
export const canRegisterPatients = (roles = []) => any(roles, REGISTER_ROLES);
export const canSeeCalendar = (roles = []) => any(roles, CALENDAR_ROLES);
export const canSeeAppointments = (roles = []) => any(roles, APPOINTMENT_ROLES);
export const canBookAppointments = (roles = []) => any(roles, BOOKING_ROLES);

// The Patients tabs; "New patient" only for those who may register patients, "Ask your records" for doctors, RMOs
// and nurses.
export const patientTabs = (roles = []) => HOSPITAL_PATIENTS.tabs.filter((t) => (['/patients/new', '/patients/sign-ups'].includes(t.to) ? canRegisterPatients(roles) : true));
/** Ask your records: doctors, RMOs and nurses. */
export const canAskRecords = (roles = []) => any(roles, CARE_PLAN_ROLES);

// Menu for someone working in a hospital, based on ALL their roles there.
export function hospitalModules(roles = []) {
  if (!roles.length) return [];
  const modules = [HOSPITAL_TODAY];
  if (canSeePatients(roles)) modules.push(HOSPITAL_PATIENTS);
  if (canSeeAppointments(roles)) modules.push(HOSPITAL_APPOINTMENTS);
  // An RMO alone does not get the calendar in the menu (follow-up reminders and booking are front-desk work – owner,
  // 13 Oct 2026); their Today still lists today's patients and who is waiting.
  if (canSeeCalendar(roles) && !(roles.includes('rmo') && !any(roles, ['doctor', 'receptionist']))) modules.push(HOSPITAL_CALENDAR);
  if (any(roles, BED_MENU_ROLES)) modules.push(HOSPITAL_BEDS);
  if (any(roles, LAB_ROLES)) modules.push(HOSPITAL_LAB);
  if (any(roles, SCAN_ROLES)) modules.push(HOSPITAL_SCANS);
  if (any(roles, BILLING_MODULE_ROLES)) modules.push(HOSPITAL_BILLING);
  if (any(roles, PHARMACY_MODULE_ROLES)) modules.push({ ...HOSPITAL_PHARMACY, to: roles.includes('pharmacist') ? '/pharmacy' : '/pharmacy/stock' });
  if (any(roles, ANALYTICS_ROLES)) modules.push(HOSPITAL_ANALYTICS); // after Patients and Calendar, or after Today for an admin
  else if (any(roles, CARE_PLAN_ROLES)) modules.push(HOSPITAL_ASK_ONLY);
  if (any(roles, CARE_PLAN_ROLES)) modules.push(HOSPITAL_KNOWLEDGE);
  if (roles.includes('admin')) modules.push(HOSPITAL_ADMIN);
  return modules;
}

// Everyone.
export const ACCOUNT_MODULE = {
  key: 'account',
  label: 'My settings',
  icon: UserCog,
  to: '/account',
  tabs: [
    // Password, professional details (doctors and RMOs) and appearance, on one page
    { label: 'Profile', to: '/account', end: true },
    { label: 'Prescription design', to: '/account/prescription-design', end: true, roles: PRESCRIBER_ROLES },
    { label: 'Voice words', to: '/account/voice-words', end: true, roles: ['doctor', 'rmo', 'nurse', 'receptionist'] },
    // Typing shortcuts (doctor ideas #3): everyone who types in patient records
    { label: 'Typing shortcuts', to: '/account/shortcuts', end: true, roles: ['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'] },
  ],
};
/** All the person's roles, in every hospital (personal settings follow the person, not the hospital). */
export const allRoles = (memberships = []) => [...new Set(memberships.flatMap((m) => m.roles ?? []))];
/** My settings' tabs this person needs: Prescription design for prescribers, Voice words for those who dictate. */
export const accountTabs = (memberships = []) => {
  const roles = allRoles(memberships);
  return ACCOUNT_MODULE.tabs.filter((t) => !t.roles || any(roles, t.roles));
};
/** Doctors and RMOs (anywhere): their professional details print on prescriptions. */
export const isPrescriber = (memberships = []) => any(allRoles(memberships), PRESCRIBER_ROLES);

const ALL = [...PLATFORM_MODULES, HOSPITAL_TODAY, HOSPITAL_PATIENTS, HOSPITAL_APPOINTMENTS, HOSPITAL_CALENDAR, HOSPITAL_BEDS, HOSPITAL_LAB, HOSPITAL_BILLING, HOSPITAL_PHARMACY, HOSPITAL_ANALYTICS, HOSPITAL_KNOWLEDGE, HOSPITAL_ADMIN, ACCOUNT_MODULE];
export const moduleByKey = (key) => ALL.find((m) => m.key === key);

// Platform admins see every platform page; a tab that only makes something new shows when they may change that area.
const PLATFORM_TAB_AREAS = { '/platform/hospitals/new': 'hospitals', '/platform/users/new': 'users' };
export const PLATFORM_AREA_LABELS = { hospitals: 'Hospitals', users: 'User accounts', hospitalSetup: "Hospitals' setup", hospitalAdmins: "Hospital admins' access" };
/** May this super admin or platform admin change this area? (session.platform from the server) */
export const canEditArea = (platform, area) => platform?.role === 'superadmin' || Boolean(area && platform?.permissions?.includes(area));
export const platformModules = (platform) =>
  PLATFORM_MODULES.map((m) => ({ ...m, tabs: m.tabs.filter((t) => !PLATFORM_TAB_AREAS[t.to] || canEditArea(platform, PLATFORM_TAB_AREAS[t.to])) }));
export const platformTabs = (key, platform) => platformModules(platform).find((m) => m.key === key)?.tabs ?? [];

// The menus and page tabs. A new screen = one line here + its route in App.jsx.
// access: who sees it – a key of the server's config.access (patients, billing …), or 'admin' (hospital admin role).
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  Database,
  FlaskConical,
  HeartPulse,
  Library,
  LayoutDashboard,
  Pill,
  Receipt,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';

const MY_SETTINGS = { to: '/account', label: 'My settings', icon: UserCog };

// Module 1 – main admin (super admin): the same menu as Perinexa's platform admin, plus Master data.
export const HOSPITALS_TABS = [
  { to: '/hospitals', label: 'All hospitals', end: true },
  { to: '/hospitals/new', label: 'New hospital', end: true },
];

export const USERS_TABS = [
  { to: '/users', label: 'All users', end: true },
  { to: '/users/super-admins', label: 'Super admins', end: true },
  { to: '/users/staff', label: 'Hospital staff', end: true },
  { to: '/users/pending', label: 'Pending first login', end: true },
  { to: '/users/new', label: 'New account', end: true },
];

export const ADMIN_NAVIGATION = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/hospitals', label: 'Hospitals', icon: Building2 },
  { to: '/users', label: 'Users & access', icon: Users },
  { to: '/billing', label: 'Billing', icon: Receipt },
  { to: '/pharmacy', label: 'Pharmacy', icon: Pill },
  { to: '/audit', label: 'Audit & compliance', icon: ShieldCheck },
  { to: '/master-data', label: 'Master data', icon: Database },
  MY_SETTINGS,
];

// Billing tabs (Billing in the menu).
export const BILLING_TABS = [
  { to: '/hospital/billing', label: 'Bills', end: true, access: 'billing' },
  { to: '/hospital/billing/unpaid', label: 'Unpaid', access: 'billing' },
  { to: '/hospital/billing/daily', label: 'Daily summary', access: 'billing' },
  { to: '/hospital/billing/monthly', label: 'Monthly', access: 'billingAdmin' },
  { to: '/hospital/billing/price-list', label: 'Price list', access: 'billing' },
  { to: '/hospital/billing/settings', label: 'Settings', access: 'billingAdmin' },
];

// Pharmacy tabs.
// The admin has no counter, so their Pharmacy opens on Stock (as in Perinexa).
export const PHARMACY_TABS = [
  { to: '/hospital/pharmacy', label: 'Sell', end: true, access: 'pharmacyCounter' },
  { to: '/hospital/pharmacy/stock', label: 'Stock', access: 'pharmacy' },
  { to: '/hospital/pharmacy/sales', label: 'Sales', access: 'pharmacy' },
  { to: '/hospital/pharmacy/medicines', label: 'Medicines', access: 'pharmacy' },
  { to: '/hospital/pharmacy/purchases', label: 'Purchases', access: 'pharmacy' },
  { to: '/hospital/pharmacy/suppliers', label: 'Suppliers', access: 'pharmacy' },
  { to: '/hospital/pharmacy/reports', label: 'Reports', access: 'pharmacy' },
  { to: '/hospital/pharmacy/settings', label: 'Settings', access: 'pharmacy' },
];

// Hospital admin tabs – the same six as Perinexa's "Hospital admin" item.
export const HOSPITAL_ADMIN_TABS = [
  { to: '/hospital/staff', label: 'Staff', access: 'admin' },
  { to: '/hospital/audit', label: 'Audit log', access: 'admin' },
  { to: '/hospital/settings/letterhead', label: 'Print letterhead', access: 'admin' },
  { to: '/hospital/settings/messaging', label: 'Patient messages', access: 'admin' },
  { to: '/hospital/opd-timings', label: 'OPD timings', access: 'admin' },
  { to: '/hospital/settings/abdm', label: 'ABDM', access: 'admin' },
];

// Appointments (as in Perinexa): one doctor's day, bookings that still need a time, and the doctors' OPD timings.
export const APPOINTMENT_TABS = [
  { to: '/hospital/appointments', label: 'Day', end: true, access: 'appointments' },
  { to: '/hospital/appointments/needs-time', label: 'Needs a time', access: 'appointments' },
  { to: '/hospital/appointments/timings', label: 'OPD timings', access: 'appointments' },
];

// The calendar: booked visits, due dates and last periods; the reminders to send.
export const CALENDAR_TABS = [
  { to: '/hospital/calendar', label: 'Calendar', end: true, access: 'calendar' },
  { to: '/hospital/calendar/reminders', label: 'Reminders', access: 'calendar' },
];

// The clinic library (as in Perinexa): one item in the menu, a tab per kind. Prescription sets only for prescribers
// (the server's summary says which tabs a person has). Clinical rules hold three kinds, as a second row of tabs.
export const LIBRARY_TABS = [
  { to: '/hospital/library', label: 'To approve', end: true },
  { to: '/hospital/library/care_plan', label: 'Care plans', kinds: ['care_plan'] },
  { to: '/hospital/library/red_flag_rules', label: 'Clinical rules', kinds: ['red_flag_rules', 'medicine_safety', 'risk_rules'] },
  { to: '/hospital/library/consent_form', label: 'Consent forms', kinds: ['consent_form'] },
  { to: '/hospital/library/information_form', label: 'Information forms', kinds: ['information_form'] },
  { to: '/hospital/library/test_package', label: 'Test packages', kinds: ['test_package'] },
  { to: '/hospital/library/prescription_set', label: 'Prescription sets', kinds: ['prescription_set'] },
];
export const RULE_TABS = [
  { to: '/hospital/library/red_flag_rules', label: 'Red-flag rules' },
  { to: '/hospital/library/medicine_safety', label: 'Medicine safety' },
  { to: '/hospital/library/risk_rules', label: 'Risk rules' },
];

// The first tab of a section this person may open (pharmacy: the admin has no "Sell").
export const firstTab = (tabs, canAccess) => tabs.find((t) => canAccess(t.access))?.to;

// Module 2+ – people working in a hospital. `to` of a section is chosen per person from its tabs.
export const HOSPITAL_NAVIGATION = [
  { to: '/hospital', label: 'Today', icon: CalendarCheck, end: true },
  { to: '/hospital/patients', label: 'Patients', icon: HeartPulse, access: 'patients' },
  { to: '/hospital/appointments', label: 'Appointments', icon: CalendarClock, access: 'appointments', tabs: APPOINTMENT_TABS },
  { to: '/hospital/calendar', label: 'Calendar', icon: CalendarDays, access: 'calendar', tabs: CALENDAR_TABS },
  { to: '/hospital/lab', label: 'Lab', icon: FlaskConical, access: 'lab' },
  { to: '/hospital/billing', label: 'Billing', icon: Receipt, access: 'billing', tabs: BILLING_TABS },
  { to: '/hospital/pharmacy', label: 'Pharmacy', icon: Pill, access: 'pharmacy', tabs: PHARMACY_TABS },
  { to: '/hospital/analytics', label: 'Analytics', icon: ChartColumn, access: 'analytics' },
  { to: '/hospital/library', label: 'Clinic library', icon: Library, access: 'library' },
  { to: '/hospital/admin', label: 'Hospital admin', icon: Settings, access: 'admin', tabs: HOSPITAL_ADMIN_TABS, activeFor: ['/hospital/staff', '/hospital/opd-timings', '/hospital/settings', '/hospital/audit'] },
  // (the hospital overview at /hospital/admin is opened from Today)
  MY_SETTINGS,
];

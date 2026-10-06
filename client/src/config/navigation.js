// The menus and page tabs. A new screen = one line here + its route in App.jsx.
// access: who sees it – a key of the server's config.access (patients, billing …), or 'admin' (hospital admin role).
import {
  Building2,
  CalendarCheck,
  ChartColumn,
  Database,
  HeartPulse,
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

// The first tab of a section this person may open (pharmacy: the admin has no "Sell").
export const firstTab = (tabs, canAccess) => tabs.find((t) => canAccess(t.access))?.to;

// Module 2+ – people working in a hospital. `to` of a section is chosen per person from its tabs.
export const HOSPITAL_NAVIGATION = [
  { to: '/hospital', label: 'Today', icon: CalendarCheck, end: true },
  { to: '/hospital/patients', label: 'Patients', icon: HeartPulse, access: 'patients' },
  { to: '/hospital/billing', label: 'Billing', icon: Receipt, access: 'billing', tabs: BILLING_TABS },
  { to: '/hospital/pharmacy', label: 'Pharmacy', icon: Pill, access: 'pharmacy', tabs: PHARMACY_TABS },
  { to: '/hospital/analytics', label: 'Analytics', icon: ChartColumn, access: 'analytics' },
  { to: '/hospital/admin', label: 'Hospital admin', icon: Settings, access: 'admin', tabs: HOSPITAL_ADMIN_TABS, activeFor: ['/hospital/staff', '/hospital/opd-timings', '/hospital/settings', '/hospital/audit'] },
  // (the hospital overview at /hospital/admin is opened from Today)
  MY_SETTINGS,
];

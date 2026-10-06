// The menus. A new screen = one line here + its route in App.jsx.
import { Building2, CalendarClock, Database, LayoutDashboard, Settings, ShieldCheck, UserCog, Users } from 'lucide-react';

const MY_SETTINGS = { to: '/account', label: 'My settings', icon: UserCog };

// Module 1 – main admin (super admin).
export const ADMIN_NAVIGATION = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/hospitals', label: 'Hospitals', icon: Building2 },
  { to: '/users', label: 'Users & access', icon: Users },
  { to: '/master-data', label: 'Master data', icon: Database },
  { to: '/audit', label: 'Audit log', icon: ShieldCheck },
  MY_SETTINGS,
];

// Module 2 – people working in a hospital. adminOnly: only for the hospital admin role (config adminRole).
// The pages of the other roles (patients, appointments, lab …) are added here by the next modules.
export const HOSPITAL_NAVIGATION = [
  { to: '/hospital', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/hospital/staff', label: 'Staff', icon: Users, adminOnly: true },
  { to: '/hospital/opd-timings', label: 'OPD timings', icon: CalendarClock, adminOnly: true },
  { to: '/hospital/settings', label: 'Hospital settings', icon: Settings, adminOnly: true },
  { to: '/hospital/audit', label: 'Audit log', icon: ShieldCheck, adminOnly: true },
  MY_SETTINGS,
];

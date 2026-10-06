// The main admin's menu. A new screen = one line here + its route in App.jsx.
import { Building2, Database, LayoutDashboard, ShieldCheck, Users } from 'lucide-react';

export const ADMIN_NAVIGATION = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/hospitals', label: 'Hospitals', icon: Building2 },
  { to: '/users', label: 'Users & access', icon: Users },
  { to: '/master-data', label: 'Master data', icon: Database },
  { to: '/audit', label: 'Audit log', icon: ShieldCheck },
];

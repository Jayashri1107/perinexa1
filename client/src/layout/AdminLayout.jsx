// Module 1 – the main admin's frame.
import { ADMIN_NAVIGATION } from '../config/navigation.js';
import { AppShell } from './AppShell.jsx';

export { BrandMark } from './AppShell.jsx';

export function AdminLayout() {
  return <AppShell navigation={ADMIN_NAVIGATION} sidebarFoot="Super admin · no patient data" />;
}

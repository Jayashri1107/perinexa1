// Module 1 – the main admin's frame. With config.access.superAdminInHospitals on, the super admin can open any
// hospital from the top bar (or from a hospital's page) and work there.
import { ADMIN_NAVIGATION } from '../config/navigation.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { AppShell } from './AppShell.jsx';
import { HospitalSwitcher } from './HospitalLayout.jsx';

export { BrandMark } from './AppShell.jsx';

export function AdminLayout() {
  const { superAdmin } = useAppConfig();
  return (
    <AppShell
      navigation={ADMIN_NAVIGATION}
      sidebarFoot={superAdmin.patientAccess ? 'Super admin · all hospitals' : 'Super admin · no patient data'}
      topbarStart={superAdmin.inHospitals ? <HospitalSwitcher placeholder="Open a hospital…" /> : null}
    />
  );
}

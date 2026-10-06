// The frame for working in a hospital: the hospital's name, a switcher for those who work in several hospitals, and a
// menu with only the pages their roles allow. A super admin working here sees a notice and a way back to the platform.
import { ArrowLeft, Building2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOSPITAL_NAVIGATION, firstTab } from '../config/navigation.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AppShell } from './AppShell.jsx';

export function HospitalSwitcher({ placeholder }) {
  const { memberships, activeHospitalId, switchHospital } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (memberships.length < (placeholder ? 1 : 2)) return null;
  const onChange = async (e) => {
    if (!e.target.value) return;
    setBusy(true);
    try {
      await switchHospital(e.target.value);
      navigate('/hospital');
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="hospital-switcher">
      <Building2 size={16} aria-hidden />
      <span className="visually-hidden">Hospital</span>
      <select value={activeHospitalId ?? ''} onChange={onChange} disabled={busy}>
        {placeholder && <option value="">{placeholder}</option>}
        {memberships.map((m) => (
          <option key={m.hospital.id} value={m.hospital.id}>{m.hospital.name}</option>
        ))}
      </select>
    </label>
  );
}

function SuperAdminBanner() {
  const { activeMembership, leaveHospital } = useAuth();
  const { superAdmin } = useAppConfig();
  const navigate = useNavigate();
  const back = async () => {
    await leaveHospital();
    navigate('/');
  };
  return (
    <div className="super-banner" role="status">
      <ShieldAlert size={18} aria-hidden />
      <span>
        You are working in <strong>{activeMembership?.hospital.name}</strong> as the super admin
        {superAdmin.patientAccess ? '. Every patient record you open is recorded in its audit log.' : '.'}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
        <ArrowLeft size={14} aria-hidden /> Back to the platform
      </button>
    </div>
  );
}

export function HospitalLayout() {
  const { activeMembership, activeHospitalId, roles, canAccess, isSuperAdminInHospital } = useAuth();
  const { roleLabel } = useAppConfig();
  const navigation = HOSPITAL_NAVIGATION.filter((item) => !item.access || canAccess(item.access)).map((item) =>
    item.tabs ? { ...item, to: firstTab(item.tabs, canAccess) ?? item.to, activeFor: [item.to, ...(item.activeFor ?? [])] } : item,
  );

  return (
    <AppShell
      navigation={navigation}
      brandSubtitle={activeMembership?.hospital.name}
      sidebarFoot={isSuperAdminInHospital ? 'Super admin · every role' : roles.map(roleLabel).join(' · ')}
      topbarStart={<HospitalSwitcher />}
      contentKey={activeHospitalId}
      banner={isSuperAdminInHospital ? <SuperAdminBanner /> : null}
    />
  );
}

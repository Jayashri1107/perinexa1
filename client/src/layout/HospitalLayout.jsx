// Module 2 – the frame for people working in a hospital: the hospital's name, a switcher for those who work in
// several hospitals, and a menu with only the pages their roles allow.
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOSPITAL_NAVIGATION } from '../config/navigation.js';
import { useAppConfig } from '../context/AppConfigContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AppShell } from './AppShell.jsx';

function HospitalSwitcher() {
  const { memberships, activeHospitalId, switchHospital } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (memberships.length < 2) return null;
  const onChange = async (e) => {
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
        {memberships.map((m) => (
          <option key={m.hospital.id} value={m.hospital.id}>{m.hospital.name}</option>
        ))}
      </select>
    </label>
  );
}

export function HospitalLayout() {
  const { activeMembership, activeHospitalId, isHospitalAdmin, roles } = useAuth();
  const { roleLabel } = useAppConfig();
  const navigation = HOSPITAL_NAVIGATION.filter((item) => !item.adminOnly || isHospitalAdmin);

  return (
    <AppShell
      navigation={navigation}
      brandSubtitle={activeMembership?.hospital.name}
      sidebarFoot={roles.map(roleLabel).join(' · ')}
      topbarStart={<HospitalSwitcher />}
      contentKey={activeHospitalId}
    />
  );
}

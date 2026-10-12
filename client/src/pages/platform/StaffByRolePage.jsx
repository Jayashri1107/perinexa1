import { Activity, ConciergeBell, FlaskConical, HeartPulse, Pill, Receipt, Settings, Stethoscope } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { platformTabs } from '../../platform/modules.js';

// Staff by role (owner's request, 12 Oct 2026): how many doctors, RMOs, nurses, receptionists, pharmacists, billing
// staff (accountants), lab staff and hospital admins work on the platform – in every hospital or one – each card
// opening the list of those people. Staff only: never a patient.
const ROLE_CARDS = [
  { role: 'doctor', label: 'Doctors', icon: Stethoscope },
  { role: 'rmo', label: 'RMOs', icon: Activity },
  { role: 'nurse', label: 'Nurses', icon: HeartPulse },
  { role: 'receptionist', label: 'Receptionists', icon: ConciergeBell },
  { role: 'pharmacist', label: 'Pharmacy', icon: Pill },
  { role: 'billing', label: 'Accounts (billing)', icon: Receipt },
  { role: 'lab', label: 'Lab staff', icon: FlaskConical },
  { role: 'admin', label: 'Hospital admins', icon: Settings },
];

export function StaffByRolePage() {
  const { platform } = useAuth();
  const [params, setParams] = useListParams({ tenantId: '' });
  const hospitals = useFetch('/platform/tenants', { status: 'active', limit: 100, sort: 'name' });
  const { data, error } = useFetch('/platform/users/role-counts', params.tenantId ? { tenantId: params.tenantId } : {});
  const hospitalName = hospitals.data?.tenants?.find((t) => t.id === params.tenantId)?.name;
  const listLink = (role) => `/platform/staff/${role}${params.tenantId ? `?tenantId=${params.tenantId}` : ''}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Staff' }]}
        title="Staff"
        subtitle={`${hospitalName ?? 'All hospitals'} · ${data ? `${formatNumber(data.people)} people working` : '…'}. A person with two roles counts in both.`}
        tabs={platformTabs('staff', platform)}
        actions={
          <FilterSelect
            label="Hospital"
            value={params.tenantId}
            onChange={(tenantId) => setParams({ tenantId })}
            allLabel="All hospitals"
            options={(hospitals.data?.tenants ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />
        }
      />
      <div className="pf-content">
        <Alert type="error">{error ?? hospitals.error}</Alert>
        <div className="kpi-grid">
          {ROLE_CARDS.map((c) => (
            <KpiCard
              key={c.role}
              to={listLink(c.role)}
              icon={c.icon}
              label={c.label}
              value={data ? formatNumber(data.counts[c.role] ?? 0) : '—'}
              sub={data?.counts[c.role] ? 'Open the list' : 'Nobody yet'}
            />
          ))}
        </div>
      </div>
    </>
  );
}

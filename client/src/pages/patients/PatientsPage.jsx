// Patients of this hospital – only those (and only the details) this person may see; the server decides.
import { Lock, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { patientsApi } from '../../api/index.js';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { ageText, formatDate, labelOf, toOptions } from '../../utils/format.js';

export function PatientsPage() {
  const { patients: settings, opd } = useAppConfig();
  const { canAccess, hasRole } = useAuth();
  const navigate = useNavigate();
  const list = usePagedList(patientsApi.list, { status: 'active' });
  const doctors = useOptions(patientsApi.doctors);
  const isDoctor = hasRole(opd.doctorRole);

  const filters = useMemo(
    () => [
      ...(isDoctor ? [{ name: 'mine', label: 'Whose', options: [{ value: 'true', label: 'My patients' }] }] : []),
      { name: 'careType', label: 'Care', options: toOptions(settings.careTypes) },
      { name: 'doctorId', label: 'Doctor', options: doctors },
      { name: 'status', label: 'Record', options: [{ value: 'active', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
    ],
    [isDoctor, settings.careTypes, doctors],
  );

  const columns = [
    { key: 'patientNumber', label: 'Number', className: 'nowrap' },
    {
      key: 'name',
      label: 'Name',
      render: (p) => (
        <>
          <strong>{p.name}</strong> {p.isSensitive && <Lock size={13} aria-label="Sensitive record" />}
          {p.phone && <span className="muted block small">{p.phone}</span>}
        </>
      ),
    },
    { key: 'age', label: 'Age / sex', render: (p) => `${ageText(p.birthDate, p.birthDateApprox)} · ${labelOf(settings.sexes, p.sex)}` },
    { key: 'careType', label: 'Care', render: (p) => (p.careType ? labelOf(settings.careTypes, p.careType) : '—') },
    { key: 'edd', label: 'EDD', className: 'nowrap', render: (p) => (p.edd ? formatDate(p.edd) : '—') },
    { key: 'doctor', label: 'Doctor', render: (p) => p.doctor?.name ?? '—' },
    { key: 'status', label: 'Record', render: (p) => <StatusBadge status={p.status === 'active' ? 'active' : 'inactive'} /> },
  ];

  const open = useCallback((p) => navigate(`/hospital/patients/${p.id}`), [navigate]);

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Each person sees only the patients and details their work needs."
        actions={
          canAccess('registerPatients') && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/hospital/patients/new')}>
              <Plus size={16} aria-hidden /> New patient
            </button>
          )
        }
      />
      <ListPanel list={list} columns={columns} filters={filters} searchPlaceholder="Name, number or phone" emptyText="No patients found." onRowClick={open} />
    </>
  );
}

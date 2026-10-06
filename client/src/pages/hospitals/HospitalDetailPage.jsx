// One hospital, consolidated: details, departments, staff per role, and its staff list (super admin).
import { ArrowLeft, Pencil, Power } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hospitalsApi, masterDataApi, membersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StaffPanel } from '../../components/staff/StaffPanel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { hospitalFields, hospitalPayload, hospitalToForm } from '../../forms/hospitalForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { activeStatus, formatDateTime } from '../../utils/format.js';

export function HospitalDetailPage() {
  const { id } = useParams();
  const { hospitalDepartmentType } = useAppConfig();
  const [hospital, setHospital] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const members = useMemo(() => membersApi(id), [id]);
  const departments = useOptions(useCallback(() => masterDataApi(hospitalDepartmentType).options(), [hospitalDepartmentType]));
  const form = useForm({});

  const load = useCallback(() => {
    hospitalsApi.get(id).then((r) => setHospital(r.hospital)).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (!hospital) return error ? <Alert type="error">{error}</Alert> : <Loader />;

  const toggleHospital = async () => {
    const verb = hospital.isActive ? 'Deactivate' : 'Activate';
    if (!window.confirm(`${verb} ${hospital.name}?`)) return;
    setError('');
    try {
      await hospitalsApi.setStatus(id, !hospital.isActive);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openEdit = () => {
    form.reset(hospitalToForm(hospital));
    setEditing(true);
  };

  const saveHospital = async (values) => {
    await hospitalsApi.update(id, hospitalPayload(values, false));
    setEditing(false);
    load();
  };

  const address = [hospital.address?.line, hospital.address?.city, hospital.address?.state, hospital.address?.pincode].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        back={<Link to="/hospitals" className="back-link"><ArrowLeft size={16} aria-hidden /> Hospitals</Link>}
        title={hospital.name}
        subtitle={`Code ${hospital.code} · added ${formatDateTime(hospital.createdAt)}`}
        actions={
          <>
            <StatusBadge status={activeStatus(hospital)} />
            <button type="button" className="btn btn-ghost" onClick={toggleHospital}>
              <Power size={16} aria-hidden /> {hospital.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={openEdit}>
              <Pencil size={16} aria-hidden /> Edit
            </button>
          </>
        }
      />
      <Alert type="error">{error}</Alert>

      <div className="grid-3">
        <section className="card">
          <h2>Contact</h2>
          <dl className="details">
            <dt>Email</dt><dd>{hospital.email || '—'}</dd>
            <dt>Phone</dt><dd>{hospital.phone || '—'}</dd>
            <dt>Address</dt><dd>{address || '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Departments</h2>
          <div className="chips">
            {hospital.departments.length === 0 && <span className="muted">None chosen yet.</span>}
            {hospital.departments.map((d) => (
              <span key={d.id} className={`chip${d.isActive ? '' : ' chip-off'}`}>{d.name}</span>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Staff by role</h2>
          <ul className="plain-list rows compact">
            {hospital.staffByRole.map((r) => (
              <li key={r.role}><span>{r.label}</span><strong>{r.count}</strong></li>
            ))}
          </ul>
        </section>
      </div>

      <div className="section-head">
        <h2>Staff</h2>
      </div>
      <StaffPanel api={members} hospitalName={hospital.name} canAdd={hospital.isActive} onChanged={load} />

      {editing && (
        <FormModal title="Edit hospital" size="lg" fields={hospitalFields({ departments, isNew: false })} form={form} onSubmit={saveHospital} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

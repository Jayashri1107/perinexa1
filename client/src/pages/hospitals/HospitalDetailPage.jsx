// One hospital, consolidated: details, departments, staff per role, and its staff list.
import { ArrowLeft, Pencil, Power, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hospitalsApi, masterDataApi, membersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../../components/TemporaryPasswordNotice.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { hospitalFields, hospitalPayload, hospitalToForm } from '../../forms/hospitalForm.js';
import { addMemberFields, emptyMember, memberRolesFields } from '../../forms/memberForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { activeStatus, formatDateTime, toOptions, userStatus } from '../../utils/format.js';

export function HospitalDetailPage() {
  const { id } = useParams();
  const { roles, roleLabel, hospitalDepartmentType } = useAppConfig();
  const roleOptions = toOptions(roles);
  const [hospital, setHospital] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // 'edit' | 'add' | { member }
  const [notice, setNotice] = useState(null);

  const members = useMemo(() => membersApi(id), [id]);
  const list = usePagedList(members.list);
  const departments = useOptions(useCallback(() => masterDataApi(hospitalDepartmentType).options(), [hospitalDepartmentType]));
  const form = useForm({});

  const load = useCallback(() => {
    hospitalsApi.get(id).then((r) => setHospital(r.hospital)).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  const refresh = () => {
    load();
    list.reload();
  };

  const run = async (action) => {
    setError('');
    try {
      await action();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!hospital) return error ? <Alert type="error">{error}</Alert> : <Loader />;

  const openDialog = (next, values) => {
    form.reset(values);
    setDialog(next);
  };

  const toggleHospital = () => {
    const verb = hospital.isActive ? 'Deactivate' : 'Activate';
    if (window.confirm(`${verb} ${hospital.name}?`)) run(() => hospitalsApi.setStatus(id, !hospital.isActive));
  };

  const toggleMember = (m) => {
    const verb = m.isActive ? 'Remove access for' : 'Give access back to';
    if (window.confirm(`${verb} ${m.user.name} at ${hospital.name}?`)) run(() => members.setStatus(m.id, !m.isActive));
  };

  const saveHospital = async (values) => {
    await hospitalsApi.update(id, hospitalPayload(values, false));
    setDialog(null);
    refresh();
  };

  const addMember = async (values) => {
    const result = await members.create(values);
    setDialog(null);
    refresh();
    if (result.temporaryPassword) setNotice({ email: result.member.user.email, password: result.temporaryPassword });
  };

  const saveRoles = async ({ roles: next }) => {
    await members.updateRoles(dialog.member.id, next);
    setDialog(null);
    refresh();
  };

  const columns = [
    { key: 'name', label: 'Name', render: (m) => (<><strong>{m.user.name}</strong><span className="muted block">{m.user.email}</span></>) },
    { key: 'roles', label: 'Roles', render: (m) => m.roles.map(roleLabel).join(', ') },
    { key: 'login', label: 'Account', render: (m) => <StatusBadge status={userStatus(m.user)} /> },
    { key: 'access', label: 'Access here', render: (m) => <StatusBadge status={activeStatus(m)} /> },
    { key: 'lastLoginAt', label: 'Last login', render: (m) => formatDateTime(m.user.lastLoginAt) },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (m) => (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ member: m }, { roles: m.roles })}>Roles</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleMember(m)}>{m.isActive ? 'Deactivate' : 'Activate'}</button>
        </>
      ),
    },
  ];

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
            <button type="button" className="btn btn-ghost" onClick={() => openDialog('edit', hospitalToForm(hospital))}>
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
        <button type="button" className="btn btn-primary" onClick={() => openDialog('add', emptyMember)} disabled={!hospital.isActive}>
          <UserPlus size={16} aria-hidden /> Add staff
        </button>
      </div>
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by name or email"
        filters={[{ name: 'role', label: 'Role', options: roleOptions }, STATUS_FILTER]}
        emptyText="No staff yet."
      />

      {dialog === 'edit' && (
        <FormModal title="Edit hospital" size="lg" fields={hospitalFields({ departments, isNew: false })} form={form} onSubmit={saveHospital} onClose={() => setDialog(null)} />
      )}
      {dialog === 'add' && (
        <FormModal title={`Add staff to ${hospital.name}`} fields={addMemberFields({ roles: roleOptions })} form={form} onSubmit={addMember} onClose={() => setDialog(null)} submitLabel="Add staff" />
      )}
      {dialog?.member && (
        <FormModal title={`Roles of ${dialog.member.user.name}`} fields={memberRolesFields({ roles: roleOptions })} form={form} onSubmit={saveRoles} onClose={() => setDialog(null)} />
      )}
      {notice && <TemporaryPasswordNotice email={notice.email} password={notice.password} onClose={() => setNotice(null)} />}
    </>
  );
}

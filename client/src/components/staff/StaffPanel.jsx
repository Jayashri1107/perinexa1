// A hospital's staff: list, add, roles, activate / deactivate and (when the api has it) reset password.
// Used by the super admin (Hospitals → a hospital) and by the hospital admin (Staff). `api` must be stable.
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { addMemberFields, emptyMember, memberRolesFields } from '../../forms/memberForm.js';
import { useForm } from '../../hooks/useForm.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { activeStatus, formatDateTime, toOptions, userStatus } from '../../utils/format.js';
import { Alert } from '../Alert.jsx';
import { FormModal } from '../form/FormModal.jsx';
import { ListPanel } from '../list/ListPanel.jsx';
import { StatusBadge } from '../StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../TemporaryPasswordNotice.jsx';

export function StaffPanel({ api, hospitalName, canAdd = true, onChanged }) {
  const { roles, roleLabel } = useAppConfig();
  const { user: me } = useAuth();
  const roleOptions = toOptions(roles);
  const list = usePagedList(api.list);
  const form = useForm(emptyMember);
  const [dialog, setDialog] = useState(null); // 'add' | { member }
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  const changed = () => {
    list.reload();
    onChanged?.();
  };

  const open = (next, values) => {
    form.reset(values);
    setDialog(next);
  };

  const run = async (action) => {
    setError('');
    try {
      const result = await action();
      changed();
      return result;
    } catch (err) {
      setError(err.message);
      return undefined;
    }
  };

  const toggle = (m) => {
    const verb = m.isActive ? 'Remove access for' : 'Give access back to';
    if (window.confirm(`${verb} ${m.user.name} at ${hospitalName}?`)) run(() => api.setStatus(m.id, !m.isActive));
  };

  const resetPassword = async (m) => {
    if (!window.confirm(`Reset the password of ${m.user.name}? They are logged out everywhere and get a temporary password.`)) return;
    const result = await run(() => api.resetPassword(m.id));
    if (result) setNotice({ email: result.email, password: result.temporaryPassword });
  };

  const add = async (values) => {
    const result = await api.create(values);
    setDialog(null);
    changed();
    if (result.temporaryPassword) setNotice({ email: result.member.user.email, password: result.temporaryPassword });
  };

  const saveRoles = async ({ roles: next }) => {
    await api.updateRoles(dialog.member.id, next);
    setDialog(null);
    changed();
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (m) => (
        <>
          <strong>{m.user.name}</strong>
          <span className="muted block">{m.user.email}</span>
        </>
      ),
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (m) => (
        <>
          {m.roles.map(roleLabel).join(', ')}
          {m.user.professional?.registrationNumber && <span className="muted block small">Reg. {m.user.professional.registrationNumber}</span>}
        </>
      ),
    },
    { key: 'login', label: 'Account', render: (m) => <StatusBadge status={userStatus(m.user)} /> },
    { key: 'access', label: 'Access here', render: (m) => <StatusBadge status={activeStatus(m)} /> },
    { key: 'lastLoginAt', label: 'Last login', render: (m) => formatDateTime(m.user.lastLoginAt) },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (m) =>
        m.user.id === me.id ? (
          <span className="muted small">You</span>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ member: m }, { roles: m.roles })}>Roles</button>
            {api.resetPassword && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetPassword(m)}>Reset password</button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(m)}>{m.isActive ? 'Deactivate' : 'Activate'}</button>
          </>
        ),
    },
  ];

  return (
    <>
      <Alert type="error">{error}</Alert>
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by name or email"
        filters={[{ name: 'role', label: 'Role', options: roleOptions }, STATUS_FILTER]}
        emptyText="No staff yet."
        toolbarExtra={
          <button type="button" className="btn btn-primary" onClick={() => open('add', emptyMember)} disabled={!canAdd}>
            <UserPlus size={16} aria-hidden /> Add staff
          </button>
        }
      />
      {dialog === 'add' && (
        <FormModal title={`Add staff to ${hospitalName}`} fields={addMemberFields({ roles: roleOptions })} form={form} onSubmit={add} onClose={() => setDialog(null)} submitLabel="Add staff" />
      )}
      {dialog?.member && (
        <FormModal title={`Roles of ${dialog.member.user.name}`} fields={memberRolesFields({ roles: roleOptions })} form={form} onSubmit={saveRoles} onClose={() => setDialog(null)} />
      )}
      {notice && <TemporaryPasswordNotice email={notice.email} password={notice.password} onClose={() => setNotice(null)} />}
    </>
  );
}

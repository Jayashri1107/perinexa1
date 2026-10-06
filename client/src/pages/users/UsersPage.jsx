// Every account on the platform, with the hospitals and roles each person holds (one consolidated list).
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hospitalsApi, usersApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../../components/TemporaryPasswordNotice.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { editUserFields, emptyUser, newUserFields } from '../../forms/userForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { USER_STATUS_FILTER } from '../../utils/filters.js';
import { formatDateTime, toOptions, userStatus } from '../../utils/format.js';

const KIND_FILTER = {
  name: 'kind',
  label: 'Type',
  options: [
    { value: 'superAdmin', label: 'Super admins' },
    { value: 'staff', label: 'Hospital staff' },
  ],
};

export function UsersPage() {
  const { roles, roleLabel } = useAppConfig();
  const { user: me } = useAuth();
  const list = usePagedList(usersApi.list);
  const hospitals = useOptions(hospitalsApi.options);
  const form = useForm(emptyUser);
  const [dialog, setDialog] = useState(null); // 'add' | { user }
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  const open = (next, values) => {
    form.reset(values);
    setDialog(next);
  };

  const run = async (action) => {
    setError('');
    try {
      const result = await action();
      list.reload();
      return result;
    } catch (err) {
      setError(err.message);
      return undefined;
    }
  };

  const toggle = (u) => {
    const verb = u.isActive ? 'Deactivate' : 'Activate';
    if (window.confirm(`${verb} the account of ${u.name}?`)) run(() => usersApi.setStatus(u.id, !u.isActive));
  };

  const reset = async (u) => {
    if (!window.confirm(`Reset the password of ${u.name}? They are logged out everywhere and get a temporary password.`)) return;
    const result = await run(() => usersApi.resetPassword(u.id));
    if (result) setNotice({ email: u.email, password: result.temporaryPassword });
  };

  const create = async (values) => {
    const result = await usersApi.create(values);
    setDialog(null);
    list.reload();
    setNotice({ email: result.user.email, password: result.temporaryPassword });
  };

  const rename = async (values) => {
    await usersApi.update(dialog.user.id, values);
    setDialog(null);
    list.reload();
  };

  const columns = [
    { key: 'name', label: 'Name', render: (u) => (<><strong>{u.name}</strong><span className="muted block">{u.email}</span></>) },
    {
      key: 'access',
      label: 'Access',
      render: (u) =>
        u.isSuperAdmin ? (
          <span className="chip chip-strong">Super admin</span>
        ) : (
          <ul className="plain-list tight">
            {u.memberships.length === 0 && <li className="muted">No hospital</li>}
            {u.memberships.map((m) => (
              <li key={m.id} className={m.isActive ? undefined : 'struck'}>
                <Link to={`/hospitals/${m.hospital?.id}`}>{m.hospital?.name}</Link>: {m.roles.map(roleLabel).join(', ')}
              </li>
            ))}
          </ul>
        ),
    },
    { key: 'status', label: 'Status', render: (u) => <StatusBadge status={userStatus(u)} /> },
    { key: 'lastLoginAt', label: 'Last login', render: (u) => formatDateTime(u.lastLoginAt) },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (u) =>
        u.id === me.id ? (
          <span className="muted small">You</span>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ user: u }, { name: u.name })}>Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(u)}>Reset password</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
          </>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users & access"
        subtitle="All accounts, their hospitals and roles. Accounts are deactivated, never deleted."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open('add', emptyUser)}>
            <Plus size={16} aria-hidden /> New account
          </button>
        }
      />
      <Alert type="error">{error}</Alert>
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by name or email"
        filters={[KIND_FILTER, USER_STATUS_FILTER, { name: 'hospitalId', label: 'Hospital', options: hospitals }]}
        emptyText="No accounts found."
      />
      {dialog === 'add' && (
        <FormModal title="New account" fields={newUserFields({ roles: toOptions(roles), hospitals })} form={form} onSubmit={create} onClose={() => setDialog(null)} submitLabel="Create account" />
      )}
      {dialog?.user && (
        <FormModal title={`Edit ${dialog.user.name}`} size="sm" fields={editUserFields} form={form} onSubmit={rename} onClose={() => setDialog(null)} />
      )}
      {notice && <TemporaryPasswordNotice email={notice.email} password={notice.password} onClose={() => setNotice(null)} />}
    </>
  );
}

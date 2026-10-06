// Every account on the platform: who they are, what kind of account, where they work and as what, and their status.
import { KeyRound, Lock, Pencil, Plus, Power } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hospitalsApi, membersApi, usersApi } from '../../api/index.js';
import { ApiError } from '../../api/http.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../../components/TemporaryPasswordNotice.jsx';
import { USERS_TABS } from '../../config/navigation.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { editUserFields, editUserValues, emptyUser, newUserFields } from '../../forms/userForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { USER_STATUS_FILTER } from '../../utils/filters.js';
import { initialsOf, timeAgo, toOptions, userStatus } from '../../utils/format.js';

const KIND_FILTER = {
  name: 'kind',
  label: 'Type',
  options: [
    { value: 'superAdmin', label: 'Super admins' },
    { value: 'staff', label: 'Hospital staff' },
  ],
};

const sameRoles = (a = [], b = []) => a.length === b.length && a.every((r) => b.includes(r));

// The tabs of Users & access (as in Perinexa) are this page with a filter set:
// preset – e.g. { kind: 'superAdmin' } or { status: 'pending' }; startAdding – the "New account" tab.
export function UsersPage({ preset = {}, startAdding = false }) {
  const { roles, roleLabel } = useAppConfig();
  const roleOptions = toOptions(roles);
  const { user: me, refresh } = useAuth();
  const navigate = useNavigate();
  const list = usePagedList(usersApi.list, preset);
  const hospitals = useOptions(hospitalsApi.options);
  const form = useForm(emptyUser);
  const [dialog, setDialogState] = useState(startAdding ? 'add' : null); // 'add' | { user }
  const setDialog = (next) => {
    setDialogState(next);
    if (!next && startAdding) navigate('/users');
  };
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  // The same rule as the server: the main super admin's account is protected, and only the main super admin
  // changes other super admin accounts. Everyone may edit their own name and email.
  const isMe = (u) => u.id === me.id;
  const canManage = (u) => !u.isPrimary && (!u.isSuperAdmin || me.isPrimary);

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

  // Name and email, then the roles of each hospital that changed.
  const saveEdit = async (values) => {
    const u = dialog.user;
    const empty = u.memberships.find((m) => !(values.roles?.[m.id] ?? []).length);
    if (empty) throw new ApiError(400, { message: 'Choose at least one role.', fields: { [`roles.${empty.id}`]: 'Choose at least one role' } });
    await usersApi.update(u.id, { name: values.name, email: values.email });
    for (const m of u.memberships) {
      const next = values.roles[m.id];
      if (!sameRoles(next, m.roles)) await membersApi(m.hospital.id).updateRoles(m.id, next);
    }
    setDialog(null);
    list.reload();
    if (isMe(u)) refresh();
  };

  const columns = [
    {
      key: 'name',
      label: 'Person',
      render: (u) => (
        <div className="person">
          <span className="avatar" aria-hidden>{initialsOf(u.name)}</span>
          <span>
            <strong className="block">{u.name}{isMe(u) && <span className="muted small"> (you)</span>}</strong>
            <span className="muted small">{u.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Account',
      render: (u) => (u.isSuperAdmin ? <span className="pill pill-strong">{u.isPrimary ? 'Main super admin' : 'Super admin'}</span> : <span className="pill">Hospital staff</span>),
    },
    {
      key: 'access',
      label: 'Works at',
      render: (u) =>
        u.isSuperAdmin ? (
          <span className="muted small">All hospitals</span>
        ) : u.memberships.length === 0 ? (
          <span className="muted small">No hospital yet</span>
        ) : (
          <div className="workplaces">
            {u.memberships.map((m) => (
              <div key={m.id} className={m.isActive ? 'workplace' : 'workplace struck'}>
                <Link to={`/hospitals/${m.hospital?.id}`}>{m.hospital?.name}</Link>
                <span className="muted small"> · {m.roles.map(roleLabel).join(', ')}</span>
              </div>
            ))}
          </div>
        ),
    },
    { key: 'status', label: 'Status', render: (u) => <StatusBadge status={userStatus(u)} /> },
    { key: 'lastLoginAt', label: 'Last login', className: 'nowrap', render: (u) => <span title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : ''}>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</span> },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (u) =>
        isMe(u) ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ user: u }, editUserValues(u))}><Pencil size={14} aria-hidden /> Edit</button>
        ) : !canManage(u) ? (
          <span className="muted small locked"><Lock size={14} aria-hidden /> Protected</span>
        ) : (
          <div className="row-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ user: u }, editUserValues(u))}><Pencil size={14} aria-hidden /> Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(u)}><KeyRound size={14} aria-hidden /> Reset password</button>
            <button type="button" className={`btn btn-ghost btn-sm${u.isActive ? ' btn-danger-text' : ''}`} onClick={() => toggle(u)}>
              <Power size={14} aria-hidden /> {u.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users & access"
        subtitle="Everyone who can log in, where they work and as what. Accounts are deactivated, never deleted."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open('add', emptyUser)}>
            <Plus size={16} aria-hidden /> New account
          </button>
        }
      />
      <SectionTabs tabs={USERS_TABS} label="Users & access" />
      <Alert type="error">{error}</Alert>
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by name or email"
        filters={[KIND_FILTER, USER_STATUS_FILTER, { name: 'hospitalId', label: 'Hospital', options: hospitals }]}
        emptyText="No accounts found."
      />
      {dialog === 'add' && (
        <FormModal title="New account" fields={newUserFields({ roles: roleOptions, hospitals, canCreateSuperAdmin: me.isPrimary })} form={form} onSubmit={create} onClose={() => setDialog(null)} submitLabel="Create account" />
      )}
      {dialog?.user && (
        <FormModal
          title={`Edit ${dialog.user.name}`}
          fields={editUserFields({ memberships: dialog.user.memberships ?? [], roles: roleOptions })}
          form={form}
          onSubmit={saveEdit}
          onClose={() => setDialog(null)}
          submitLabel="Save changes"
        />
      )}
      {notice && <TemporaryPasswordNotice email={notice.email} password={notice.password} onClose={() => setNotice(null)} />}
    </>
  );
}

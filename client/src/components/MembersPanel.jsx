import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { useListParams } from '../hooks/useListParams.js';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination } from './DataTable.jsx';
import { RolesDialog } from './RolesDialog.jsx';
import { Alert, Avatar, Field, FieldError, ROLE_LABELS, RoleBadges, RolePicker, StatusPill, TemporaryPassword, formatDateTime, rolesLabel, useConfirm } from './ui.jsx';

const ROLES = Object.keys(ROLE_LABELS);
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const DEFAULTS = { search: '', role: '', status: '', page: 1, limit: 25 };
const ACCESS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Removed' },
];

function AddMemberForm({ basePath, defaultRoles, onAdded, onCancel }) {
  const [form, setForm] = useState({ email: '', name: '', roles: defaultRoles });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api(basePath, { method: 'POST', body: { ...form, name: form.name || undefined } });
      onAdded(res);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card add-form" onSubmit={onSubmit} noValidate>
      <div className="row-between">
        <h2>Add a person to this hospital</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="hint help">
        If the email already has an account (for example at another hospital), the person is simply linked here and keeps
        their existing password. Otherwise a new account is created with a temporary password.
      </p>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Email" id="member-email" error={fieldErrors.email}>
          <input id="member-email" type="email" value={form.email} onChange={update('email')} placeholder="name@example.com" required autoFocus />
        </Field>
        <Field label="Full name (for new accounts)" id="member-name" error={fieldErrors.name}>
          <input id="member-name" value={form.name} onChange={update('name')} maxLength={100} />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>Roles in this hospital</legend>
        <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} idPrefix="member-role" />
        <FieldError>{fieldErrors.roles}</FieldError>
      </fieldset>
      <div className="row add-form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add to hospital'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The people tagged to one hospital.
 * - basePath: API path, e.g. "/tenant/members" (hospital admin) or "/platform/tenants/<id>/members" (super admin)
 * - allowAccountChanges: show "Reset password" (hospital admins; only for people who work nowhere else)
 * - linkToUser: super admins get a link to the person's full account page
 */
export function MembersPanel({ basePath, allowAccountChanges = false, linkToUser = false, defaultRoles = ['doctor'], onChanged, title = 'Staff' }) {
  const { user: me } = useAuth();
  const [params, setParams, reset] = useListParams(DEFAULTS);
  const { data, error: loadError, loading, reload } = useFetch(basePath, params);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null); // member whose roles are being changed
  const [confirm, confirmDialog] = useConfirm();

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
    setTempPassword(null);
  };

  const run = async (m, fn) => {
    clearMessages();
    setBusyId(m.id);
    try {
      await fn();
      reload();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveRoles = async (m, roles) => {
    await api(`${basePath}/${m.id}/roles`, { method: 'PATCH', body: { roles } });
    setEditing(null);
    clearMessages();
    setSuccess(`${m.user.name}'s roles here are now: ${rolesLabel(roles)}.`);
    reload();
    onChanged?.();
  };

  const toggleActive = async (m) => {
    const ok = await confirm(
      m.isActive
        ? {
            title: `Remove ${m.user.name}'s access to this hospital?`,
            text: 'They will no longer be able to work here. Their access to other hospitals is not affected, and nothing is deleted.',
            confirmLabel: 'Remove access',
            danger: true,
          }
        : { title: `Give ${m.user.name} access to this hospital again?`, confirmLabel: 'Restore access' },
    );
    if (!ok) return;
    run(m, async () => {
      await api(`${basePath}/${m.id}/status`, { method: 'PATCH', body: { isActive: !m.isActive } });
      setSuccess(`${m.user.name} ${m.isActive ? 'no longer has' : 'has regained'} access to this hospital.`);
    });
  };

  const resetPassword = async (m) => {
    const ok = await confirm({
      title: `Reset the password for ${m.user.name}?`,
      text: 'Their current password will stop working and they will be logged out.',
      confirmLabel: 'Reset password',
      danger: true,
    });
    if (!ok) return;
    run(m, async () => {
      const res = await api(`${basePath}/${m.id}/reset-password`, { method: 'POST' });
      setTempPassword({ email: m.user.email, password: res.temporaryPassword });
    });
  };

  const onAdded = (res) => {
    clearMessages();
    if (res.temporaryPassword) setTempPassword({ email: res.member.user.email, password: res.temporaryPassword });
    else setSuccess(`${res.member.user.name} already had an account and has been linked to this hospital. They keep their existing password.`);
    setShowAdd(false);
    reload();
    onChanged?.();
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <span className="name-cell">
          <Avatar name={m.user.name} seed={m.user.id} />
          <span className="name-cell-text">
            <span>
              <strong>{linkToUser ? <Link to={`/platform/users/${m.user.id}`}>{m.user.name}</Link> : m.user.name}</strong>
              {m.user.id === me.id && <span className="muted"> (you)</span>}
            </span>
            <span className="cell-sub member-notes">
              <span>{m.user.email}</span>
              {m.user.mustChangePassword && <span>Must change password</span>}
              {m.sharedAccount && <span>Also at another hospital</span>}
              {!m.user.isActive && <StatusPill tone="inactive">Account disabled by platform</StatusPill>}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Roles here',
      render: (m) => (
        <span className="roles-cell">
          <RoleBadges roles={m.roles} />
          <button
            type="button"
            className="btn btn-link btn-sm"
            disabled={m.user.id === me.id || busyId === m.id}
            onClick={() => setEditing(m)}
            title={m.user.id === me.id ? "You can't change your own roles" : undefined}
          >
            Edit<span className="sr-only"> roles for {m.user.name}</span>
          </button>
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      width: 128,
      render: (m) => <StatusPill tone={m.isActive ? 'stable' : 'inactive'}>{m.isActive ? 'Active' : 'Removed'}</StatusPill>,
    },
    { key: 'last', header: 'Last login', width: 180, render: (m) => <span className="nowrap tabular">{formatDateTime(m.user.lastLoginAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: allowAccountChanges ? 300 : 170,
      className: 'actions',
      render: (m) => {
        const self = m.user.id === me.id;
        const busy = busyId === m.id;
        return (
          <div className="row-actions">
            {allowAccountChanges && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={self || busy || m.sharedAccount}
                onClick={() => resetPassword(m)}
                title={m.sharedAccount ? 'This person also works at another hospital; ask the platform super admin.' : undefined}
              >
                Reset password<span className="sr-only"> for {m.user.name}</span>
              </button>
            )}
            {/* Secondary here; the red destructive button is in the confirmation dialog, so the list isn't a column of red buttons */}
            <button type="button" className="btn btn-secondary btn-sm" disabled={self || busy} onClick={() => toggleActive(m)}>
              {m.isActive ? 'Remove access' : 'Restore access'}
              <span className="sr-only"> for {m.user.name}</span>
            </button>
          </div>
        );
      },
    },
  ];

  const filtered = params.search || params.role || params.status;

  return (
    <div className="members-panel">
      {confirmDialog}
      <div className="row-between section-header">
        <h2>{title}</h2>
        {!showAdd && (
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <UserPlus aria-hidden="true" /> Add person
          </button>
        )}
      </div>

      <Alert type="error" onClose={() => setError(null)}>
        {error ?? loadError}
      </Alert>
      <Alert type="success" onClose={() => setSuccess(null)}>
        {success}
      </Alert>
      {tempPassword && <TemporaryPassword {...tempPassword} onClose={() => setTempPassword(null)} />}
      {showAdd && <AddMemberForm basePath={basePath} defaultRoles={defaultRoles} onAdded={onAdded} onCancel={() => setShowAdd(false)} />}
      {editing && (
        <RolesDialog
          title={`Roles for ${editing.user.name}`}
          initialRoles={editing.roles}
          onSave={(roles) => saveRoles(editing, roles)}
          onCancel={() => setEditing(null)}
        />
      )}

      <DataTable
        caption={title}
        columns={columns}
        rows={data?.members}
        loading={loading}
        rowClassName={(m) => (m.isActive && m.user.isActive ? '' : 'row-inactive')}
        emptyText={filtered ? 'No staff match these filters.' : 'No staff yet. Use "Add person" to add the first one.'}
        toolbar={
          <>
            <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Search by name or email…" label="Search staff" />
            <FilterSelect label="Role" value={params.role} onChange={(role) => setParams({ role })} allLabel="All roles" options={ROLE_OPTIONS} />
            <div className="dt-filter">
              <span className="dt-filter-label" id="members-access-label">
                Access
              </span>
              <div className="segmented" role="group" aria-labelledby="members-access-label">
                {ACCESS_OPTIONS.map((o) => (
                  <button key={o.value} type="button" aria-pressed={params.status === o.value} onClick={() => {
                      // Like the old drop-down: only a real change updates the list (and goes back to page 1).
                      if (params.status !== o.value) setParams({ status: o.value });
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <ClearFilters show={Boolean(filtered)} onClick={reset} />
          </>
        }
        footer={
          data && (
            <TablePagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              limit={data.limit}
              onPage={(page) => setParams({ page })}
              onLimit={(limit) => setParams({ limit })}
              label="people"
            />
          )
        }
      />
    </div>
  );
}

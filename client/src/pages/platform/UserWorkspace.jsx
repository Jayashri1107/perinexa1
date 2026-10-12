import { useState } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { RolesDialog } from '../../components/RolesDialog.jsx';
import { Alert, Avatar, Field, RoleBadges, RolePicker, StatusPill, TemporaryPassword, formatDateTime, rolesLabel, useConfirm } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// An account's status: colour + icon + word.
const AccountStatus = ({ active }) =>
  active ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>;

// One person's account, with tabs: Profile, Hospital access, Activity.
export function UserWorkspace() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const isSelf = id === me.id;
  const { data, error, reload } = useFetch(`/platform/users/${id}`);
  const [flash, setFlash] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const user = data?.user;

  if (error && !user) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: 'Not found' }]} title="User not found" />
        <div className="pf-content">
          <div className="card narrow">
            <p>{error}</p>
            <Link to="/platform/users" className="plat-back">
              <ArrowLeft aria-hidden="true" /> Back to users
            </Link>
          </div>
        </div>
      </>
    );
  }
  if (!user) return <FullPageSpinner />;

  // question: what the confirm dialog asks ({ title, text, confirmLabel, danger }).
  const run = async (question, fn) => {
    if (question && !(await confirm(question))) return;
    setActionError(null);
    setFlash(null);
    setTempPassword(null);
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = () =>
    run({ title: `Reset the password for ${user.name}?`, text: 'Their current password will stop working and they will be logged out.', confirmLabel: 'Reset password', danger: true }, async () => {
      const res = await api(`/platform/users/${id}/reset-password`, { method: 'POST' });
      setTempPassword({ email: user.email, password: res.temporaryPassword });
    });

  const toggleSuperAdmin = () =>
    run(
      user.isSuperAdmin
        ? { title: `Remove super admin rights from ${user.name}?`, confirmLabel: 'Remove super admin rights', danger: true }
        : { title: `Make ${user.name} a super admin?`, text: 'They will be able to manage all hospitals and users.', confirmLabel: 'Make super admin' },
      async () => {
        await api(`/platform/users/${id}/super-admin`, { method: 'PATCH', body: { isSuperAdmin: !user.isSuperAdmin } });
        setFlash(user.isSuperAdmin ? 'Super admin rights removed.' : `${user.name} is now a super admin.`);
      },
    );

  const toggleActive = () =>
    run(
      user.isActive
        ? {
            title: `Deactivate ${user.name}'s account?`,
            text: "They will be logged out immediately and can't log in to any hospital. Nothing is deleted.",
            confirmLabel: 'Deactivate account',
            danger: true,
          }
        : { title: `Reactivate ${user.name}'s account?`, confirmLabel: 'Reactivate account' },
      async () => {
        await api(`/platform/users/${id}/status`, { method: 'PATCH', body: { isActive: !user.isActive } });
        setFlash(user.isActive ? 'Account deactivated.' : 'Account reactivated.');
      },
    );

  const base = `/platform/users/${id}`;
  return (
    <>
      {confirmDialog}
      <PageHeader
        documentTitle={user.name}
        breadcrumbs={[{ label: 'Users & access', to: '/platform/users' }, { label: user.name }]}
        title={
          <>
            <Avatar name={user.name} seed={user.id} large />
            {user.name}
          </>
        }
        badges={
          <>
            {isSelf && <span className="muted t-label">(you)</span>}
            {user.isSuperAdmin && <StatusPill tone="brand">Super admin</StatusPill>}
            <AccountStatus active={user.isActive} />
          </>
        }
        subtitle={`${user.email} · last login ${formatDateTime(user.lastLoginAt)}`}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={resetPassword} disabled={busy || isSelf}>
              Reset password
            </button>
            <button type="button" className="btn btn-secondary" onClick={toggleSuperAdmin} disabled={busy || isSelf}>
              {user.isSuperAdmin ? 'Remove super admin' : 'Make super admin'}
            </button>
            <button type="button" className={`btn ${user.isActive ? 'btn-danger' : 'btn-secondary'}`} onClick={toggleActive} disabled={busy || isSelf}>
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </>
        }
        tabs={[
          { label: 'Profile', to: base, end: true },
          { label: `Hospital access (${user.hospitals.length})`, to: `${base}/hospitals`, end: true },
          { label: 'Activity', to: `${base}/activity`, end: true },
        ]}
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {tempPassword && <TemporaryPassword {...tempPassword} onClose={() => setTempPassword(null)} />}
        <Outlet context={{ user, reload }} />
      </div>
    </>
  );
}

export function UserProfileTab() {
  const { user, reload } = useOutletContext();
  const emptyPro = { qualification: '', registrationNumber: '', council: '' };
  const [form, setForm] = useState({ name: user.name, email: user.email, professional: { ...emptyPro, ...(user.professional ?? {}) } });
  const pro = { ...emptyPro, ...(user.professional ?? {}) };
  const proChanged = Object.keys(emptyPro).some((k) => form.professional[k] !== pro[k]);
  const setPro = (key) => (e) => setForm({ ...form, professional: { ...form.professional, [key]: e.target.value } });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const changes = {};
    if (form.name !== user.name) changes.name = form.name;
    if (form.email !== user.email) changes.email = form.email;
    if (proChanged) changes.professional = form.professional;
    if (!Object.keys(changes).length) return;
    setError(null);
    setFieldErrors({});
    setSaved(false);
    setBusy(true);
    try {
      await api(`/platform/users/${user.id}`, { method: 'PATCH', body: changes });
      setSaved(true);
      reload();
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="two-col">
      <form className="card" onSubmit={save} noValidate>
        <h2>Account details</h2>
        <Alert type="success">{saved && 'Changes saved.'}</Alert>
        <Alert type="error">{error}</Alert>
        <Field label="Full name" id="name" error={fieldErrors.name}>
          <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Email" id="email" error={fieldErrors.email}>
          <input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
        </Field>
        {!user.isSuperAdmin && (
          <fieldset className="fieldset">
            <legend>Professional details</legend>
            <Field label="Qualification" id="pro-qualification">
              <input id="pro-qualification" value={form.professional.qualification} onChange={setPro('qualification')} maxLength={150} />
            </Field>
            <div className="form-grid">
              <Field label="Medical registration number" id="pro-reg">
                <input id="pro-reg" value={form.professional.registrationNumber} onChange={setPro('registrationNumber')} maxLength={60} />
              </Field>
              <Field label="Medical council" id="pro-council">
                <input id="pro-council" value={form.professional.council} onChange={setPro('council')} maxLength={120} />
              </Field>
            </div>
          </fieldset>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || (form.name === user.name && form.email === user.email && !proChanged)}>
          Save changes
        </button>
      </form>
      <section className="card">
        <h2>Key facts</h2>
        <dl className="details">
          <div>
            <dt>Type</dt>
            <dd>{user.isSuperAdmin ? 'Super admin' : 'Hospital staff'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <AccountStatus active={user.isActive} />
            </dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd>{user.mustChangePassword ? 'Temporary — must be changed at next login' : 'Chosen by the person'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd className="tabular">{formatDateTime(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Last login</dt>
            <dd className="tabular">{formatDateTime(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt>User ID</dt>
            <dd className="mono muted">{user.id}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function UserHospitalsTab() {
  const { user, reload } = useOutletContext();
  const hospitals = useFetch(user.isSuperAdmin ? null : '/platform/tenants', { status: 'active', limit: 100, sort: 'name' });
  const [tag, setTag] = useState({ tenantId: '', roles: ['doctor'] });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  if (user.isSuperAdmin) {
    return (
      <div className="card plat-note">
        <Info aria-hidden="true" />
        <p>Super admins are not tagged to hospitals, so they can't see patient data.</p>
      </div>
    );
  }

  const run = async (fn) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveRoles = async (h, roles) => {
    await api(`/platform/tenants/${h.tenantId}/members/${h.memberId}/roles`, { method: 'PATCH', body: { roles } });
    setEditing(null);
    setError(null);
    setSuccess(`Roles at ${h.tenantName}: ${rolesLabel(roles)}.`);
    reload();
  };

  const toggleMembership = async (h) => {
    if (h.isActive && !(await confirm({ title: `Remove ${user.name}'s access to ${h.tenantName}?`, confirmLabel: 'Remove access', danger: true }))) return;
    run(async () => {
      await api(`/platform/tenants/${h.tenantId}/members/${h.memberId}/status`, { method: 'PATCH', body: { isActive: !h.isActive } });
      setSuccess(h.isActive ? `Access to ${h.tenantName} removed.` : `Access to ${h.tenantName} restored.`);
    });
  };

  const addToHospital = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/platform/tenants/${tag.tenantId}/members`, { method: 'POST', body: { email: user.email, roles: tag.roles } });
      const h = hospitals.data?.tenants.find((x) => x.id === tag.tenantId);
      setSuccess(`${user.name} was added to ${h?.name ?? 'the hospital'} as ${rolesLabel(tag.roles)}.`);
      setTag({ tenantId: '', roles: ['doctor'] });
    });
  };

  const taggedIds = new Set(user.hospitals.map((h) => h.tenantId));
  const available = (hospitals.data?.tenants ?? []).filter((h) => !taggedIds.has(h.id));

  const columns = [
    {
      key: 'hospital',
      header: 'Hospital',
      render: (h) => (
        <>
          <Link to={`/platform/hospitals/${h.tenantId}`} className="plat-name-link">
            {h.tenantName}
          </Link>
          {!h.tenantActive && (
            <div className="cell-sub">
              <StatusPill tone="inactive">Hospital deactivated</StatusPill>
            </div>
          )}
        </>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (h) => (
        <span className="roles-cell">
          <RoleBadges roles={h.roles} />
          <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => setEditing(h)}>
            Edit<span className="sr-only"> roles at {h.tenantName}</span>
          </button>
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      width: 130,
      render: (h) => (h.isActive ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Removed</StatusPill>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 150,
      className: 'actions',
      render: (h) => (
        <button type="button" className={`btn btn-sm ${h.isActive ? 'btn-danger' : 'btn-secondary'}`} disabled={busy} onClick={() => toggleMembership(h)}>
          {h.isActive ? 'Remove access' : 'Restore access'}
          <span className="sr-only"> to {h.tenantName}</span>
        </button>
      ),
    },
  ];

  return (
    <>
      {confirmDialog}
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <Alert type="success" onClose={() => setSuccess(null)}>
        {success}
      </Alert>
      <form className="card add-form" onSubmit={addToHospital}>
        <h2>Tag to a hospital</h2>
        <div className="row align-end">
          <div className="grow">
            <Field label="Hospital" id="tag-hospital">
              <select id="tag-hospital" value={tag.tenantId} onChange={(e) => setTag({ ...tag, tenantId: e.target.value })}>
                <option value="">{available.length ? 'Choose a hospital…' : 'Already tagged to every active hospital'}</option>
                {available.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <fieldset className="fieldset">
          <legend>Roles in this hospital</legend>
          <RolePicker value={tag.roles} onChange={(roles) => setTag({ ...tag, roles })} idPrefix="tag-role" />
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={busy || !tag.tenantId || tag.roles.length === 0}>
          Add to hospital
        </button>
      </form>
      {editing && (
        <RolesDialog
          title={`Roles for ${user.name} at ${editing.tenantName}`}
          initialRoles={editing.roles}
          onSave={(roles) => saveRoles(editing, roles)}
          onCancel={() => setEditing(null)}
        />
      )}
      <DataTable
        caption="Hospital access"
        columns={columns}
        rows={user.hospitals}
        rowKey="memberId"
        rowClassName={(h) => (h.isActive && h.tenantActive ? '' : 'row-inactive')}
        emptyText="Not tagged to any hospital yet. Use the form above."
      />
    </>
  );
}

export function UserActivityTab() {
  const { user } = useOutletContext();
  return <AuditLogView endpoint="/platform/audit-logs" userId={user.id} showHospital />;
}

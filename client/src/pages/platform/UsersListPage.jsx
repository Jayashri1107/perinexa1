import { useState } from 'react';
import { ArrowRight, KeyRound, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, Field, ROLE_LABELS, RolePicker, StatusPill, TemporaryPassword, formatDateTime, rolesLabel } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { STAFF_ROLE_PAGES, canEditArea, platformTabs } from '../../platform/modules.js';

const crumbs = [{ label: 'Users & access', to: '/platform/users' }];

// Each tab is the same list with a fixed filter.
const VARIANTS = {
  all: { title: 'All users', fixed: {}, empty: 'No users match these filters.' },
  superadmins: { title: 'Super admins', fixed: { type: 'superadmin' }, empty: 'No super admins match these filters.' },
  platformadmins: {
    title: 'Platform admins',
    fixed: { type: 'platformadmin' },
    empty: 'No platform admins yet.',
    note: 'Platform admins see everything a super admin sees (never patient records), view only – apart from the areas a super admin ticked on their account.',
  },
  staff: { title: 'Hospital staff', fixed: { type: 'member' }, empty: 'No hospital staff match these filters.' },
  pending: {
    title: 'Pending first login',
    fixed: { status: 'pending' },
    empty: 'Everyone has chosen their own password.',
    note: 'These people still have a temporary password and have not logged in to choose their own yet.',
  },
};

function HospitalsCell({ user }) {
  if (user.isSuperAdmin) return <StatusPill tone="brand">Super admin</StatusPill>;
  if (user.isPlatformAdmin) return <StatusPill tone="brand">Platform admin</StatusPill>;
  const active = user.hospitals.filter((h) => h.isActive && h.tenantActive);
  if (user.hospitals.length === 0) return <span className="muted">Not tagged yet</span>;
  const shown = active.slice(0, 2);
  return (
    <span className="hospital-chips">
      {shown.map((h) => (
        <span key={h.memberId} className="chip" title={`${h.tenantName} · ${rolesLabel(h.roles)}`}>
          {h.tenantName} <span className="muted">· {rolesLabel(h.roles)}</span>
        </span>
      ))}
      {active.length > 2 && <span className="chip">+{active.length - 2} more</span>}
      {active.length === 0 && <span className="muted">No active hospital</span>}
    </span>
  );
}

// "28 Sep 2026" with the time underneath, so the table fits a 1366 px screen.
function DayAndTime({ value }) {
  const [day, time] = formatDateTime(value).split(', ');
  return (
    <>
      {day}
      {time && <div className="cell-sub">{time}</div>}
    </>
  );
}

export function UsersListPage({ variant = 'all', role = null }) {
  // A Staff page: the people with one role, in every hospital or the one chosen
  const rolePage = role ? STAFF_ROLE_PAGES.find((r) => r.role === role) : null;
  const v = rolePage
    ? { title: rolePage.label, fixed: { role, type: 'member' }, empty: `No ${rolePage.label.toLowerCase()} match these filters.`, note: `${rolePage.label} working at the hospitals – each person once, with every hospital they work at.` }
    : VARIANTS[variant];
  const navigate = useNavigate();
  const { user: me, platform } = useAuth();
  const defaults = { search: '', status: '', type: '', role: '', tenantId: '', sort: '-createdAt', page: 1, limit: 25 };
  // Role and hospital filters (Staff by role opens this list with them): hospital staff only
  const staffFilters = variant === 'all' || variant === 'staff' || Boolean(rolePage);
  const hospitals = useFetch(staffFilters ? '/platform/tenants' : null, { status: 'active', limit: 100, sort: 'name' });
  const [params, setParams, reset] = useListParams(defaults);
  const { data, error, loading } = useFetch('/platform/users', { ...params, ...v.fixed });

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (u) => (
        <span className="name-cell">
          <Avatar name={u.name} seed={u.id} />
          <span className="name-cell-text">
            <strong>
              <Link to={`/platform/users/${u.id}`}>{u.name}</Link>
              {u.id === me.id && <span className="muted t-label"> (you)</span>}
            </strong>
            {u.mustChangePassword && u.isActive && (
              <StatusPill tone="due" icon={KeyRound} className="plat-name-pill">
                Must change password
              </StatusPill>
            )}
          </span>
        </span>
      ),
    },
    { key: 'email', header: 'Email', sortKey: 'email', render: (u) => u.email },
    { key: 'hospitals', header: 'Access', className: 'plat-access-cell', render: (u) => <HospitalsCell user={u} /> },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (u.isActive ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>),
    },
    { key: 'lastLoginAt', header: 'Last login', sortKey: 'lastLoginAt', sortFirst: 'desc', render: (u) => <DayAndTime value={u.lastLoginAt} /> },
    { key: 'createdAt', header: 'Created', sortKey: 'createdAt', sortFirst: 'desc', render: (u) => <DayAndTime value={u.createdAt} /> },
  ];

  const filtered = params.search || params.status || params.type || params.role || params.tenantId;

  return (
    <>
      <PageHeader
        breadcrumbs={rolePage ? [{ label: 'Staff', to: '/platform/staff' }, { label: v.title }] : [...crumbs, { label: v.title }]}
        title={v.title}
        subtitle={v.note ?? 'Every account on the platform. One account can work at several hospitals.'}
        tabs={platformTabs(rolePage ? 'staff' : 'users', platform)}
        actions={
          canEditArea(platform, 'users') && (
            <Link to="/platform/users/new" className="btn btn-primary">
              <UserPlus aria-hidden="true" /> New account
            </Link>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <DataTable
          caption={v.title}
          columns={columns}
          rows={data?.users}
          loading={loading}
          sort={params.sort}
          onSort={(sort) => setParams({ sort })}
          onRowClick={(u) => navigate(`/platform/users/${u.id}`)}
          rowClassName={(u) => (u.isActive ? '' : 'row-inactive')}
          emptyText={v.empty}
          toolbar={
            <>
              <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Search by name or email…" label="Search users" />
              {variant === 'all' && (
                <FilterSelect
                  label="Type"
                  value={params.type}
                  onChange={(type) => setParams({ type })}
                  allLabel="All types"
                  options={[
                    { value: 'superadmin', label: 'Super admins' },
                    { value: 'member', label: 'Hospital staff' },
                  ]}
                />
              )}
              {variant !== 'pending' && (
                <FilterSelect
                  label="Status"
                  value={params.status}
                  onChange={(status) => setParams({ status })}
                  allLabel="Any status"
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Deactivated' },
                    { value: 'pending', label: 'Pending first login' },
                  ]}
                />
              )}
              {staffFilters && !rolePage && (
                <FilterSelect
                  label="Role"
                  value={params.role}
                  onChange={(role) => setParams({ role })}
                  allLabel="Any role"
                  options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              )}
              {staffFilters && (
                <FilterSelect
                  label="Hospital"
                  value={params.tenantId}
                  onChange={(tenantId) => setParams({ tenantId })}
                  allLabel="All hospitals"
                  options={(hospitals.data?.tenants ?? []).map((t) => ({ value: t.id, label: t.name }))}
                />
              )}
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
                label="accounts"
              />
            )
          }
        />
      </div>
    </>
  );
}

// A new account, as in the earlier Perinexa1: the type of account, the name and email, and for hospital staff the
// hospital and the roles there – all in one step. Super admins and platform admins only a super admin makes.
export function UserNewPage() {
  const { platform } = useAuth();
  const isSuper = platform?.role === 'superadmin';
  const empty = { accountType: 'staff', name: '', email: '', tenantId: '', roles: [] };
  const [form, setForm] = useState(empty);
  const hospitals = useFetch('/platform/tenants', { status: 'active', limit: 100, sort: 'name' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);
  const staff = form.accountType === 'staff';
  // A platform admin without "Hospital admins' access" is not offered the hospital admin role
  const without = canEditArea(platform, 'hospitalAdmins') ? [] : ['admin'];

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (staff && !form.tenantId) return setFieldErrors({ tenantId: 'Choose the hospital' });
    if (staff && !form.roles.length) return setFieldErrors({ roles: 'Choose at least one role' });
    setSubmitting(true);
    try {
      const body = staff ? form : { accountType: form.accountType, name: form.name, email: form.email };
      const res = await api('/platform/users', { method: 'POST', body });
      setCreated({ id: res.user.id, name: res.user.name, email: res.user.email, password: res.temporaryPassword, hospitals: res.user.hospitals });
      setForm({ ...empty, accountType: form.accountType, tenantId: form.tenantId });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  return (
    <>
      <PageHeader breadcrumbs={[...crumbs, { label: 'New account' }]} title="New account" tabs={platformTabs('users', platform)} />
      <div className="pf-content">
        {created && (
          <>
            <TemporaryPassword email={created.email} password={created.password} onClose={() => setCreated(null)} />
            <p className="row">
              <Link to={`/platform/users/${created.id}`} className="btn btn-secondary">
                Open {created.name}'s account <ArrowRight aria-hidden="true" />
              </Link>
              {created.hospitals?.length > 0 && <span className="muted">{created.hospitals.map((h) => `${h.tenantName} · ${rolesLabel(h.roles)}`).join(', ')}</span>}
            </p>
          </>
        )}
        <form className="card form-card" onSubmit={onSubmit} noValidate>
          <h2>Account details</h2>
          <Alert type="error">{error}</Alert>
          {isSuper && (
            <Field label="Type of account" id="new-type">
              <select id="new-type" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
                <option value="staff">Hospital staff</option>
                <option value="platformAdmin">Platform admin (sees everything, changes what you allow)</option>
                <option value="superAdmin">Super admin (whole platform, never patient data)</option>
              </select>
            </Field>
          )}
          <div className="form-grid">
            <Field label="Full name" id="new-name" error={fieldErrors.name}>
              <input id="new-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoFocus />
            </Field>
            <Field label="Email" id="new-email" error={fieldErrors.email} hint="Use a made-up address, e.g. name@example.com" keepHint>
              <input id="new-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
            </Field>
          </div>
          {staff && (
            <>
              <Field label="Hospital" id="new-hospital" error={fieldErrors.tenantId}>
                <select id="new-hospital" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                  <option value="">Choose the hospital…</option>
                  {(hospitals.data?.tenants ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="fieldset">
                <legend>Roles in this hospital</legend>
                {fieldErrors.roles && <p className="field-error">{fieldErrors.roles}</p>}
                <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} idPrefix="new-role" without={without} />
              </fieldset>
              <p className="hint">Someone who works at several hospitals: add the other hospitals later on their account (Hospital access).</p>
            </>
          )}
          {form.accountType === 'platformAdmin' && <p className="hint">A new platform admin starts view only; tick what they may change under User permissions.</p>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </button>
            <Link to="/platform/users" className="btn btn-link">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}

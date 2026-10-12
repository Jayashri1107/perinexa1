import { useState } from 'react';
import { ArrowRight, KeyRound, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, Field, StatusPill, TemporaryPassword, formatDateTime, rolesLabel } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { canEditArea, platformTabs } from '../../platform/modules.js';

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

export function UsersListPage({ variant = 'all' }) {
  const v = VARIANTS[variant];
  const navigate = useNavigate();
  const { user: me, platform } = useAuth();
  const defaults = { search: '', status: '', type: '', sort: '-createdAt', page: 1, limit: 25 };
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

  const filtered = params.search || params.status || params.type;

  return (
    <>
      <PageHeader
        breadcrumbs={[...crumbs, { label: v.title }]}
        title={v.title}
        subtitle={v.note ?? 'Every account on the platform. One account can work at several hospitals.'}
        tabs={platformTabs('users', platform)}
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

export function UserNewPage() {
  const { platform } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', isSuperAdmin: false });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api('/platform/users', { method: 'POST', body: form });
      setCreated({ id: res.user.id, name: res.user.name, email: res.user.email, password: res.temporaryPassword });
      setForm({ name: '', email: '', isSuperAdmin: false });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader breadcrumbs={[...crumbs, { label: 'New account' }]} title="New account" tabs={platformTabs('users', platform)} />
      <div className="pf-content">
        {created && (
          <>
            <TemporaryPassword email={created.email} password={created.password} onClose={() => setCreated(null)} />
            <p className="row">
              <Link to={`/platform/users/${created.id}/hospitals`} className="btn btn-primary">
                Tag {created.name} to hospitals <ArrowRight aria-hidden="true" />
              </Link>
              <Link to={`/platform/users/${created.id}`} className="btn btn-secondary">
                Open account
              </Link>
            </p>
          </>
        )}
        <form className="card form-card" onSubmit={onSubmit} noValidate>
          <h2>Account details</h2>
          <p className="hint help">
            Tip: to add hospital staff, it's quickest to open the hospital and use "Add person" on its Staff tab. Use this form
            for another super admin, or for someone you'll tag to hospitals afterwards.
          </p>
          <Alert type="error">{error}</Alert>
          <div className="form-grid">
            <Field label="Full name" id="new-name" error={fieldErrors.name}>
              <input id="new-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoFocus />
            </Field>
            <Field label="Email" id="new-email" error={fieldErrors.email} hint="Use a made-up address, e.g. name@example.com" keepHint>
              <input id="new-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
            </Field>
          </div>
          {platform?.role === 'superadmin' && (
          <label className="checkbox">
            <input type="checkbox" checked={form.isSuperAdmin} onChange={(e) => setForm({ ...form, isSuperAdmin: e.target.checked })} />
            <span>
              <strong>Super admin</strong>{' '}
              <span className="muted">— manages hospitals and users; cannot see patient data or be tagged to hospitals.</span>
            </span>
          </label>
          )}
          <div className="row">
            {/* One primary per screen: once an account is created, "Tag … to hospitals" above is the next step. */}
            <button type="submit" className={`btn ${created ? 'btn-secondary' : 'btn-primary'}`} disabled={submitting}>
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

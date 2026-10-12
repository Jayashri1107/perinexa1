import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canEditArea } from '../../platform/modules.js';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { formatNumber } from '../../components/DataTable.jsx';
import { MembersPanel } from '../../components/MembersPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDateTime, useConfirm } from '../../components/ui.jsx';
import { STAFF_ROLE_PAGES } from '../../platform/modules.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// A hospital's status: colour + icon + word.
const TenantStatus = ({ active }) =>
  active ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>;

// One hospital, with its own tabs: Overview, Staff, Activity.
export function HospitalWorkspace() {
  const { id } = useParams();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/platform/tenants/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const { platform, openHospital } = useAuth();
  const navigate = useNavigate();
  const tenant = data?.tenant;
  // Its setup (Hospital admin pages – never its patients); a platform admin without "Hospitals' setup" only looks
  const openSetup = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await openHospital(tenant.id);
      navigate('/admin/staff');
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  if (error && !tenant) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'Hospitals', to: '/platform/hospitals' }, { label: 'Not found' }]} title="Hospital not found" />
        <div className="pf-content">
          <div className="card narrow">
            <p>{error}</p>
            <Link to="/platform/hospitals" className="plat-back">
              <ArrowLeft aria-hidden="true" /> Back to hospitals
            </Link>
          </div>
        </div>
      </>
    );
  }
  if (!tenant) return <FullPageSpinner />;

  const toggleActive = async () => {
    const ok = await confirm(
      tenant.isActive
        ? {
            title: `Deactivate ${tenant.name}?`,
            text: 'Nobody will be able to work in this hospital until it is reactivated. Nothing is deleted.',
            confirmLabel: 'Deactivate hospital',
            danger: true,
          }
        : { title: `Reactivate ${tenant.name}?`, confirmLabel: 'Reactivate hospital' },
    );
    if (!ok) return;
    setActionError(null);
    setBusy(true);
    try {
      await api(`/platform/tenants/${id}/status`, { method: 'PATCH', body: { isActive: !tenant.isActive } });
      setFlash(tenant.isActive ? 'Hospital deactivated.' : 'Hospital reactivated.');
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const base = `/platform/hospitals/${id}`;
  return (
    <>
      {confirmDialog}
      <PageHeader
        breadcrumbs={[{ label: 'Hospitals', to: '/platform/hospitals' }, { label: tenant.name }]}
        title={tenant.name}
        badges={<TenantStatus active={tenant.isActive} />}
        subtitle={`${formatNumber(tenant.members)} active staff · ${formatNumber(tenant.admins)} ${tenant.admins === 1 ? 'admin' : 'admins'} · created ${formatDateTime(tenant.createdAt)}`}
        actions={
          <>
            {tenant.isActive && (
              <button type="button" className="btn btn-secondary" onClick={openSetup} disabled={busy}>
                {canEditArea(platform, 'hospitalSetup') ? 'Open hospital setup' : 'View hospital setup'}
              </button>
            )}
            {canEditArea(platform, 'hospitals') && (
              <button type="button" className={`btn ${tenant.isActive ? 'btn-danger' : 'btn-secondary'}`} onClick={toggleActive} disabled={busy}>
                {tenant.isActive ? 'Deactivate hospital' : 'Reactivate hospital'}
              </button>
            )}
          </>
        }
        tabs={[
          { label: 'Overview', to: base, end: true },
          { label: 'Staff', to: `${base}/staff`, end: true },
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
        {tenant.admins === 0 && tenant.isActive && (
          <Alert type="warning">
            <strong>This hospital has no admin yet.</strong> Go to <Link to={`${base}/staff`}>Staff</Link>, choose "Add person" and tick the role "Hospital admin".
          </Alert>
        )}
        <Outlet context={{ tenant, reload }} />
      </div>
    </>
  );
}

export function HospitalOverviewTab() {
  const { tenant, reload } = useOutletContext();
  const [name, setName] = useState(tenant.name);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await api(`/platform/tenants/${tenant.id}`, { method: 'PATCH', body: { name } });
      setSaved(true);
      reload();
    } catch (err) {
      setError(err.fields?.name ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="two-col">
      <form className="card" onSubmit={save} noValidate>
        <h2>Hospital details</h2>
        <Alert type="success">{saved && 'Name saved.'}</Alert>
        <Field label="Hospital name" id="tenant-name" error={error}>
          <input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === tenant.name || !name.trim()}>
          Save name
        </button>
      </form>
      <section className="card">
        <h2>Key facts</h2>
        <dl className="details">
          <div>
            <dt>Status</dt>
            <dd>
              <TenantStatus active={tenant.isActive} />
            </dd>
          </div>
          <div>
            <dt>Active staff</dt>
            <dd className="tabular">{formatNumber(tenant.members)}</dd>
          </div>
          <div>
            <dt>Admins</dt>
            <dd className="tabular">{formatNumber(tenant.admins)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd className="tabular">{formatDateTime(tenant.createdAt)}</dd>
          </div>
          <div>
            <dt>Hospital ID</dt>
            <dd className="mono muted">{tenant.id}</dd>
          </div>
        </dl>
        <p className="hint help">Patient records are only visible to this hospital's staff, not to super admins.</p>
      </section>
      <HospitalAtAGlance tenant={tenant} />
    </div>
  );
}

// Everything about one hospital on its Overview (owner, 12 Oct 2026): its staff by role – each card opens the Staff
// tab with that role – and links to its numbers (Analytics: whole months, numbers only, never a patient) and its
// activity. The super admin never sees its patients.
function HospitalAtAGlance({ tenant }) {
  const { data, error } = useFetch('/platform/users/role-counts', { tenantId: tenant.id });
  const base = `/platform/hospitals/${tenant.id}`;
  return (
    <section className="card card-wide">
      <h2>Staff by role</h2>
      <Alert type="error">{error}</Alert>
      <div className="kpi-grid">
        {STAFF_ROLE_PAGES.map((r) => (
          <KpiCard
            key={r.role}
            to={`${base}/staff?role=${r.role}`}
            label={r.label}
            value={data ? formatNumber(data.counts[r.role] ?? 0) : '—'}
            sub={data?.counts[r.role] ? 'Open the list' : 'Nobody yet'}
          />
        ))}
      </div>
      <p className="row">
        <Link to={`/platform/analytics?hospital=${tenant.id}`} className="btn btn-secondary btn-sm">
          This hospital's numbers (Analytics)
        </Link>
        <Link to={`${base}/activity`} className="btn btn-link btn-sm">
          Its activity
        </Link>
      </p>
    </section>
  );
}

export function HospitalStaffTab() {
  const { tenant, reload } = useOutletContext();
  return (
    <MembersPanel
      basePath={`/platform/tenants/${tenant.id}/members`}
      linkToUser
      defaultRoles={tenant.admins === 0 ? ['admin'] : ['doctor']}
      onChanged={reload}
    />
  );
}

export function HospitalActivityTab() {
  const { tenant } = useOutletContext();
  return <AuditLogView endpoint="/platform/audit-logs" tenantId={tenant.id} />;
}

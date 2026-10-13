import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canEditArea } from '../../platform/modules.js';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { formatNumber } from '../../components/DataTable.jsx';
import { MembersPanel } from '../../components/MembersPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime, useConfirm } from '../../components/ui.jsx';
import { STAFF_ROLE_PAGES } from '../../platform/modules.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// A hospital's status: colour + icon + word.
const TenantStatus = ({ active }) =>
  active ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>;

// One hospital, with two tabs: the hospital and its staff, and its activity.
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
      navigate('/');
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
                Open this hospital
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
          { label: 'Hospital and staff', to: base, end: true },
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
            <strong>This hospital has no admin yet.</strong> In the staff list below, choose "Add person" and tick the role "Hospital admin".
          </Alert>
        )}
        <Outlet context={{ tenant, reload }} />
      </div>
    </>
  );
}

// One hospital on one page, as in Perinexa1 of 7 Oct (owner, 13 Oct 2026): three cards side by side – its details,
// its staff by role, its numbers and activity – and its staff list underneath. The super admin never sees its patients.
export function HospitalOverviewTab() {
  const { tenant, reload } = useOutletContext();
  const [changes, setChanges] = useState(0); // a change in the staff list counts the roles again
  return (
    <>
      <div className="hw-cards">
        <HospitalDetails tenant={tenant} reload={reload} />
        <StaffByRole key={changes} tenant={tenant} />
        <section className="card hw-card">
          <h2>Numbers and activity</h2>
          <p className="muted">Whole months, numbers only – never a patient.</p>
          <ul className="hw-links">
            <li>
              <Link to={`/platform/analytics?hospital=${tenant.id}`}>This hospital's numbers (Analytics)</Link>
            </li>
            <li>
              <Link to={`/platform/hospitals/${tenant.id}/activity`}>Its activity (who did what, and when)</Link>
            </li>
          </ul>
          <p className="hint help">Patient records are only visible to this hospital's staff, not to super admins.</p>
        </section>
      </div>
      <div id="staff" className="hw-staff">
        <MembersPanel
          basePath={`/platform/tenants/${tenant.id}/members`}
          linkToUser
          defaultRoles={tenant.admins === 0 ? ['admin'] : ['doctor']}
          onChanged={() => {
            setChanges((n) => n + 1);
            reload();
          }}
        />
      </div>
    </>
  );
}

// Its details: the name (changed here) and the key facts.
function HospitalDetails({ tenant, reload }) {
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
    <form className="card hw-card" onSubmit={save} noValidate>
      <h2>Hospital details</h2>
      <Alert type="success">{saved && 'Name saved.'}</Alert>
      <Field label="Hospital name" id="tenant-name" error={error}>
        <div className="hw-name">
          <input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          <button type="submit" className="btn btn-secondary" disabled={busy || name.trim() === tenant.name || !name.trim()}>
            Save
          </button>
        </div>
      </Field>
      <dl className="hw-facts">
        <dt>Status</dt>
        <dd>
          <TenantStatus active={tenant.isActive} />
        </dd>
        <dt>Active staff</dt>
        <dd className="tabular">{formatNumber(tenant.members)}</dd>
        <dt>Admins</dt>
        <dd className="tabular">{formatNumber(tenant.admins)}</dd>
        <dt>Created</dt>
        <dd className="tabular">{formatDateTime(tenant.createdAt)}</dd>
        <dt>Hospital ID</dt>
        <dd className="mono muted">{tenant.id}</dd>
      </dl>
    </form>
  );
}

// Its staff by role: one row per role with the count; a row filters the staff list below to that role.
function StaffByRole({ tenant }) {
  const { data, error } = useFetch('/platform/users/role-counts', { tenantId: tenant.id });
  const [, setSearchParams] = useSearchParams();
  const show = (role) => {
    setSearchParams({ role });
    document.getElementById('staff')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <section className="card hw-card">
      <h2>Staff by role</h2>
      <Alert type="error">{error}</Alert>
      <ul className="hw-roles">
        {STAFF_ROLE_PAGES.map((r) => {
          const count = data ? (data.counts[r.role] ?? 0) : null;
          return (
            <li key={r.role}>
              <button type="button" onClick={() => show(r.role)} disabled={!count}>
                <span>{r.label}</span>
                <strong className="tabular">{count === null ? '—' : formatNumber(count)}</strong>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The old Staff tab's address (new hospitals open it): the staff list is on the hospital's own page now.
export function HospitalStaffTab() {
  const location = useLocation();
  return <Navigate to={{ pathname: location.pathname.replace(/\/staff\/?$/, ''), search: location.search }} replace />;
}

export function HospitalActivityTab() {
  const { tenant } = useOutletContext();
  return <AuditLogView endpoint="/platform/audit-logs" tenantId={tenant.id} />;
}

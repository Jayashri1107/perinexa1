import { useState } from 'react';
import { ArrowLeft, Building2, CalendarDays, ChartColumn, FlaskConical, Headset, HeartPulse, History, Lock, Pill, Receipt, ShieldCheck, Stethoscope, UserCog, Users } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canEditArea } from '../../platform/modules.js';
import { AuditLogView } from '../../components/AuditLogView.jsx';
import { formatNumber } from '../../components/DataTable.jsx';
import { MembersPanel } from '../../components/MembersPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, useConfirm } from '../../components/ui.jsx';
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

// One hospital on one page (owner, 14 Oct 2026 redesign): its numbers at the top, then its details beside its staff by
// role, a strip with the privacy rule and its numbers and activity, and its staff list underneath. The super admin
// never sees its patients.
const ROLE_ICONS = { doctor: Stethoscope, rmo: UserCog, nurse: HeartPulse, receptionist: Headset, lab: FlaskConical, pharmacist: Pill, billing: Receipt, admin: ShieldCheck };

export function HospitalOverviewTab() {
  const { tenant, reload } = useOutletContext();
  const roles = useFetch('/platform/users/role-counts', { tenantId: tenant.id });
  const doctors = roles.data ? (roles.data.counts.doctor ?? 0) : null;
  return (
    <>
      <div className="hw-stats" role="list" aria-label="This hospital in numbers">
        {[
          ['staff', Users, 'Active staff', formatNumber(tenant.members)],
          ['admins', ShieldCheck, 'Hospital admins', formatNumber(tenant.admins)],
          ['doctors', Stethoscope, 'Doctors', doctors === null ? '—' : formatNumber(doctors)],
          ['created', CalendarDays, 'Created on', formatDate(tenant.createdAt)],
        ].map(([key, Icon, label, value]) => (
          <div key={key} className={`card hw-stat is-${key}`} role="listitem">
            <span className="hw-stat-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="hw-stat-text">
              <span>{label}</span>
              <strong className="tabular">{value}</strong>
            </span>
          </div>
        ))}
      </div>
      <div className="hw-cards">
        <HospitalDetails tenant={tenant} reload={reload} />
        <StaffByRole counts={roles.data?.counts ?? null} error={roles.error} />
      </div>
      <div className="card hw-privacy">
        <span className="hw-privacy-icon" aria-hidden="true">
          <Lock />
        </span>
        <p>
          <strong>Patient records are only visible to this hospital's staff</strong>
          <span className="muted">Super admins see numbers only – whole months, never a patient.</span>
        </p>
        <div className="hw-privacy-links">
          <Link to={`/platform/analytics?hospital=${tenant.id}`} className="btn btn-secondary btn-sm">
            <ChartColumn aria-hidden="true" /> Numbers (Analytics)
          </Link>
          <Link to={`/platform/hospitals/${tenant.id}/activity`} className="btn btn-secondary btn-sm">
            <History aria-hidden="true" /> Activity log
          </Link>
        </div>
      </div>
      <div id="staff" className="hw-staff">
        <MembersPanel
          basePath={`/platform/tenants/${tenant.id}/members`}
          linkToUser
          defaultRoles={tenant.admins === 0 ? ['admin'] : ['doctor']}
          onChanged={() => {
            roles.reload(); // a change in the staff list counts the roles again
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
      <h2>
        <Building2 aria-hidden="true" /> Hospital details
      </h2>
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
        <div>
          <dt>Status</dt>
          <dd>
            <TenantStatus active={tenant.isActive} />
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="tabular">{formatDateTime(tenant.createdAt)}</dd>
        </div>
        <div>
          <dt>Active staff</dt>
          <dd className="tabular">{formatNumber(tenant.members)}</dd>
        </div>
        <div>
          <dt>Admins</dt>
          <dd className="tabular">{formatNumber(tenant.admins)}</dd>
        </div>
        <div className="hw-facts-wide">
          <dt>Hospital ID</dt>
          <dd className="mono muted">{tenant.id}</dd>
        </div>
      </dl>
    </form>
  );
}

// Its staff by role: a tile per role with its count; a tile filters the staff list below to that role.
function StaffByRole({ counts, error }) {
  const [, setSearchParams] = useSearchParams();
  const show = (role) => {
    setSearchParams({ role });
    document.getElementById('staff')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <section className="card hw-card">
      <h2>
        <Users aria-hidden="true" /> Staff by role
      </h2>
      <Alert type="error">{error}</Alert>
      <ul className="hw-roles">
        {STAFF_ROLE_PAGES.map((r) => {
          const count = counts ? (counts[r.role] ?? 0) : null;
          const Icon = ROLE_ICONS[r.role] ?? Users;
          return (
            <li key={r.role}>
              <button type="button" onClick={() => show(r.role)} disabled={!count} title={count ? `Show the ${r.label.toLowerCase()} below` : undefined}>
                <span className="hw-role-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="hw-role-label">{r.label}</span>
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

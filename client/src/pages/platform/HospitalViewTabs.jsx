import { useState } from 'react';
import { FlaskConical, Receipt, Stethoscope, UserPlus } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination, formatNumber } from '../../components/DataTable.jsx';
import { Alert, StatusPill, formatDate, formatDateTime, roleLabel, rolesLabel } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { DEPARTMENTS } from '../../platform/departments.js';
import { CARE_TYPE_LABELS } from '../patients/patientFormat.js';

// One hospital, everything, for the super admin (docs/USER_GROUPS_PLAN.md Part A; server: routes/platformHospitalView.js):
// its departments' numbers today, its staff by department, and its patients by department (identity only, super admins
// only – each list shown is in the hospital's audit log; a record opens inside the hospital, audited there).

const rupees = (paise) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const DEPARTMENT_OPTIONS = [...DEPARTMENTS.map((d) => ({ value: d, label: d })), { value: 'none', label: 'No department' }];

// The day's numbers in four cards, two related figures in each (developer, 14 Nov 2026)
const SERVICE_CARDS = [
  { key: 'desk', title: 'Front desk', icon: UserPlus, figures: [['registrationsToday', 'Registered'], ['appointmentsToday', 'Appointments']] },
  { key: 'opd', title: 'OPD and wards', icon: Stethoscope, figures: [['visitsToday', 'Visits'], ['inpatientsNow', 'In-patients now']] },
  { key: 'lab', title: 'Lab', icon: FlaskConical, figures: [['labOrdersToday', 'Orders'], ['labReportedToday', 'Reports']] },
  { key: 'money', title: 'Pharmacy and billing', icon: Receipt, figures: [['pharmacySalesToday', 'Pharmacy sales'], ['collectedTodayPaise', 'Collected', 'money']] },
];
const DEPT_FIGURES = [
  ['newToday', 'New today'],
  ['appointmentsToday', 'Appointments'],
  ['visitsToday', 'Visits'],
  ['inpatientsNow', 'In-patients'],
  ['labOrdersToday', 'Lab orders'],
];

/** The departments with a total row ("All departments") at the end. PURE. */
export const withTotal = (departments = []) => {
  const keys = ['patients', ...DEPT_FIGURES.map(([k]) => k)];
  const total = Object.fromEntries(keys.map((k) => [k, departments.reduce((sum, d) => sum + (d[k] ?? 0), 0)]));
  return [...departments, { key: 'total', label: 'All departments', total: true, ...total }];
};

export function HospitalDepartmentsTab() {
  const { tenant } = useOutletContext();
  const { platform } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(`/platform/hospital-view/${tenant.id}/departments`);
  const s = data?.services;
  const superAdmin = platform?.role === 'superadmin';
  const rows = data ? withTotal(data.departments) : null;
  const allPatients = rows?.at(-1)?.patients ?? 0;
  // A zero is grey, so the departments with work today stand out
  const count = (v) => <span className={`tabular ${v ? 'hv-num' : 'hv-zero'}`}>{formatNumber(v ?? 0)}</span>;
  const columns = [
    {
      key: 'label',
      header: 'Department',
      render: (d) => (d.total ? <strong>{d.label}</strong> : <span className="strong-name">{d.label}</span>),
    },
    {
      key: 'patients',
      header: 'Patients',
      width: 200,
      render: (d) => (
        <span className="hv-share">
          {count(d.patients)}
          {!d.total && (
            <span className="hv-bar" aria-hidden="true">
              <span style={{ width: `${allPatients ? Math.round((d.patients / allPatients) * 100) : 0}%` }} />
            </span>
          )}
        </span>
      ),
    },
    ...DEPT_FIGURES.map(([key, header]) => ({ key, header, align: 'right', width: 120, render: (d) => count(d[key]) })),
  ];
  return (
    <>
      <Alert type="error">{error}</Alert>
      <div className="hv-head">
        <h2>Today{data?.today ? ` · ${formatDate(data.today)}` : ''}</h2>
        <span className="muted">Numbers only – no patient is named on this page.</span>
      </div>
      <div className="hv-cards" role="list" aria-label="This hospital today">
        {SERVICE_CARDS.map(({ key, title, icon: Icon, figures }) => (
          <section key={key} className={`card hv-card is-${key}`} role="listitem" aria-label={title}>
            <h3>
              <span className="hv-card-icon" aria-hidden="true">
                <Icon />
              </span>
              {title}
            </h3>
            <dl>
              {figures.map(([field, label, kind]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd className="tabular">{s ? (kind === 'money' ? rupees(s[field]) : formatNumber(s[field])) : '—'}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="hv-head">
        <h2>By department</h2>
        <span className="muted">
          {superAdmin ? 'Choose a department to see its patients. ' : ''}In-patients count by the department on the admission form.
        </span>
      </div>
      <DataTable
        caption="Departments today"
        columns={columns}
        rows={rows}
        rowKey="key"
        loading={loading}
        rowClassName={(d) => (d.total ? 'hv-total' : '')}
        onRowClick={superAdmin ? (d) => navigate(`/platform/hospitals/${tenant.id}/patients${d.total ? '' : `?department=${encodeURIComponent(d.key)}`}`) : undefined}
        emptyText="No departments."
      />
    </>
  );
}

export function HospitalTeamsTab() {
  const { tenant } = useOutletContext();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(`/platform/hospital-view/${tenant.id}/staff`);
  const columns = [
    { key: 'name', header: 'Name', render: (p) => <span className="strong-name">{p.name}</span> },
    { key: 'roles', header: 'Roles', render: (p) => rolesLabel(p.roles) || '–' },
    { key: 'email', header: 'Email', render: (p) => <span className="muted">{p.email}</span> },
    { key: 'lastLoginAt', header: 'Last sign-in', width: 180, render: (p) => (p.lastLoginAt ? <span className="nowrap">{formatDateTime(p.lastLoginAt)}</span> : <span className="muted">Never</span>) },
    {
      key: 'active',
      header: 'Status',
      width: 140,
      render: (p) => (p.active ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>),
    },
  ];
  if (loading && !data) return <DataTable caption="Staff" columns={columns} rows={null} loading emptyText="" />;
  return (
    <>
      <Alert type="error">{error}</Alert>
      {data && !data.groups.length && <p className="muted">No staff in this hospital yet.</p>}
      {data?.groups.map((g) => {
        // A department by its name; staff without one by their role (a doctor without one: "Doctor – no department")
        const label = g.role ? `${roleLabel(g.role)}${g.role === 'doctor' ? ' – no department' : ''}` : g.label;
        return (
          <section key={g.key} className="hv-group" aria-label={label}>
            <h2>
              {label} <span className="muted tabular">· {formatNumber(g.people.length)}</span>
            </h2>
            <DataTable caption={`${label} staff`} columns={columns} rows={g.people} onRowClick={(p) => navigate(`/platform/users/${p.id}`)} emptyText="" />
          </section>
        );
      })}
    </>
  );
}

const PATIENT_DEFAULTS = { department: '', search: '', careType: '', sort: '-createdAt', page: 1, limit: 10 };

export function HospitalPatientsTab() {
  const { tenant } = useOutletContext();
  const { platform, openHospital } = useAuth();
  const navigate = useNavigate();
  const [params, setParams, reset] = useListParams(PATIENT_DEFAULTS);
  const superAdmin = platform?.role === 'superadmin';
  const { data, error, loading } = useFetch(superAdmin ? `/platform/hospital-view/${tenant.id}/patients` : null, params);
  const [openError, setOpenError] = useState(null);

  if (!superAdmin) return <Alert type="info">Only a super admin sees a hospital's patients.</Alert>;

  const open = async (p) => {
    setOpenError(null);
    try {
      await openHospital(tenant.id);
      navigate(`/patients/${p.id}`);
    } catch (err) {
      setOpenError(err.message);
    }
  };
  const columns = [
    { key: 'fullName', header: 'Patient', sortKey: 'fullName', render: (p) => <span className="strong-name">{p.fullName}</span> },
    { key: 'mrn', header: 'Patient number', sortKey: 'mrn', width: 140, render: (p) => <span className="tabular">{p.mrn}</span> },
    { key: 'department', header: 'Department', width: 150, render: (p) => p.department || <span className="muted">None</span> },
    { key: 'careType', header: 'Type of care', width: 170, render: (p) => CARE_TYPE_LABELS[p.careType] ?? p.careType },
    { key: 'doctor', header: 'Doctor', render: (p) => p.doctor || '–' },
    { key: 'createdAt', header: 'Added', sortKey: 'createdAt', sortFirst: 'desc', width: 180, render: (p) => <span className="nowrap">{formatDateTime(p.createdAt)}</span> },
  ];
  const filtered = params.department || params.search || params.careType;
  return (
    <>
      <Alert type="error">{error ?? openError}</Alert>
      <DataTable
        caption={`Patients of ${tenant.name}`}
        columns={columns}
        rows={data?.patients}
        loading={loading}
        sort={params.sort}
        onSort={(sort) => setParams({ sort })}
        onRowClick={open}
        emptyText={filtered ? 'No patients match these filters.' : 'No patients registered in this hospital yet.'}
        toolbar={
          <>
            <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Name or patient number…" label="Search patients" />
            <FilterSelect label="Department" value={params.department} onChange={(department) => setParams({ department })} allLabel="All departments" options={DEPARTMENT_OPTIONS} />
            <FilterSelect
              label="Type of care"
              value={params.careType}
              onChange={(careType) => setParams({ careType })}
              allLabel="Any type of care"
              options={Object.entries(CARE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
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
              label="patients"
            />
          )
        }
      />
      <p className="help">Name, number, department and doctor only. Opening a patient opens this hospital; each list and record seen is in its audit log.</p>
    </>
  );
}

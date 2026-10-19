import { useState } from 'react';
import {
  BadgeCheck,
  Banknote,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  FileText,
  FlaskConical,
  Home,
  Inbox,
  LayoutGrid,
  ListChecks,
  Package,
  Search,
  Settings,
  ShieldCheck,
  TestTube,
  Timer,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { rupees } from '../billing/billingFormat.js';
import { departmentName } from './labFormat.js';

// The lab's dashboard (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md, the eLabAssist layout in Perinexa's look): every
// lab module as a button with what waits there; for lab staff also the day's numbers (registered, reported, charged,
// late) and the tests and charges by department, for a period. Numbers only – no patient, no test names.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PERIODS = {
  today: { label: 'Today', range: () => [new Date(), new Date()] },
  week: { label: 'Last 7 days', range: () => [new Date(Date.now() - 6 * 86_400_000), new Date()] },
  month: { label: 'This month', range: () => [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()] },
};

/** The lab's modules as buttons, in the order work moves through the lab. waitKey: the worklist count shown on it. */
const MODULES = [
  { key: 'new', label: 'Registration', sub: 'Walk-in or referred patient', to: '/lab/new', icon: UserPlus, labOnly: true },
  { key: 'collect', label: 'Sample collection', sub: 'Samples to take', to: '/lab?list=collect', icon: TestTube, waitKey: 'collect' },
  { key: 'receive', label: 'Sample receiving', sub: 'Scan the label', to: '/lab?list=receive', icon: Inbox, waitKey: 'receive' },
  { key: 'results', label: 'Result entry', sub: 'By department', to: '/lab/results', icon: ClipboardPen, waitKey: 'report' },
  { key: 'verify', label: 'Authorisation', sub: 'Results to check', to: '/lab?list=verify', icon: ClipboardCheck, waitKey: 'verify' },
  { key: 'reports', label: 'Reports', sub: 'Reported, last 7 days', to: '/lab?list=done', icon: FileText },
  { key: 'home', label: 'Home collection', sub: 'Scheduled visits', to: '/lab?list=home', icon: Home, waitKey: 'home' },
  { key: 'outside', label: 'Outside labs', sub: 'Sent out, not back', to: '/lab?list=outside', icon: Truck, waitKey: 'outside' },
  { key: 'find', label: 'Find', sub: 'Sample, patient, date', to: '/lab/find', icon: Search },
  { key: 'register', label: 'Lab register', sub: 'Print or save for Excel', to: '/lab/register', icon: ClipboardList },
  { key: 'qc', label: 'Quality control', sub: 'Runs and Westgard rules', to: '/lab/qc', icon: ShieldCheck },
  { key: 'stock', label: 'Stock', sub: 'Reagents, cost per test', to: '/lab/stock', icon: Package },
  { key: 'tests', label: 'Test master', sub: 'Tests, ranges, times', to: '/lab/tests', icon: ListChecks },
  { key: 'referrers', label: 'Referrers', sub: 'Doctors and centres', to: '/lab/referrers', icon: Users },
  { key: 'cash', label: 'Cash', sub: 'Day-end handover', to: '/cash-handover', icon: Banknote, labOnly: true },
  { key: 'settings', label: 'Settings', sub: 'Check before report', to: '/lab/settings', icon: Settings },
];

function ModuleGrid({ waiting, isLab }) {
  return (
    <nav className="lab-modules" aria-label="Lab modules">
      {MODULES.filter((m) => isLab || !m.labOnly).map((m) => {
        const n = m.waitKey ? waiting?.[m.waitKey] : null;
        return (
          <Link key={m.key} to={m.to} className="lab-module">
            <span className="lab-module-icon" aria-hidden="true">
              <m.icon />
            </span>
            <span className="lab-module-text">
              <strong>{m.label}</strong>
              <span className="muted">{m.sub}</span>
            </span>
            {n > 0 && (
              <span className="lab-module-count tabular" aria-label={`${n} waiting`}>
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tests and charges by department, as bars (the longest bar is the busiest department). */
function DepartmentBars({ rows }) {
  if (!rows?.length) return <p className="muted">No tests in this period.</p>;
  const most = Math.max(...rows.map((r) => r.tests), 1);
  return (
    <table className="lab-dept-bars">
      <thead>
        <tr>
          <th scope="col">Department</th>
          <th scope="col">Tests</th>
          <th scope="col" className="num">
            Charged
          </th>
        </tr>
      </thead>
      <tbody>
        {[...rows]
          .sort((a, b) => b.tests - a.tests)
          .map((r) => (
            <tr key={r.key}>
              <th scope="row">{departmentName(r.key)}</th>
              <td>
                <span className="lab-bar">
                  <span className="lab-bar-fill" style={{ width: `${Math.max(4, (r.tests / most) * 100)}%` }} />
                  <span className="tabular">{r.tests}</span>
                </span>
              </td>
              <td className="num tabular">{rupees(r.chargedPaise)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

export function LabDashboardPage() {
  const { activeMembership } = useAuth();
  const isLab = (activeMembership?.roles ?? []).includes('lab');
  const [period, setPeriod] = useState('today');
  const [from, to] = PERIODS[period].range().map(iso);
  const dash = useFetch(isLab ? '/lab/dashboard' : null, { from, to });
  // Doctors, RMOs and nurses: the counts of the patients they may see (the worklist's)
  const work = useFetch(isLab ? null : '/lab/worklist', { list: 'collect' });
  const d = dash.data;
  const waiting = isLab ? d?.waiting : work.data?.counts;

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Lab dashboard"
        documentTitle="Lab dashboard"
        help="Every part of the lab in one place: open a module to work in it. The numbers are counts only."
        actions={
          isLab && (
            <Link to="/lab/new" className="btn btn-primary">
              <UserPlus aria-hidden="true" /> New registration
            </Link>
          )
        }
      />
      <div className="pf-content lab-dash">
        <Alert type="error">{dash.error || work.error}</Alert>
        <section aria-labelledby="lab-dash-modules">
          <h2 id="lab-dash-modules" className="lab-dash-title">
            <LayoutGrid aria-hidden="true" /> Lab modules
          </h2>
          <ModuleGrid waiting={waiting} isLab={isLab} />
        </section>

        {isLab && (
          <section aria-labelledby="lab-dash-numbers">
            <div className="row-between lab-dash-head">
              <h2 id="lab-dash-numbers" className="lab-dash-title">
                <FlaskConical aria-hidden="true" /> {PERIODS[period].label}
              </h2>
              <div className="segmented" role="group" aria-label="Period">
                {Object.entries(PERIODS).map(([k, p]) => (
                  <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {!d ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <div className="kpi-grid">
                  <KpiCard icon={UserPlus} label="Registered" value={d.registered.orders} sub={`${d.registered.patients} patient${d.registered.patients === 1 ? '' : 's'} · ${d.registered.walkIn} walk-in`} />
                  <KpiCard icon={TestTube} label="Tests" value={d.registered.tests} sub="On the orders registered" />
                  <KpiCard tone="stable" icon={BadgeCheck} label="Reported" value={d.reported} sub="Reports finished" />
                  <KpiCard icon={Banknote} label="Charged" value={rupees(d.chargedPaise)} textValue sub="Lab tests on the bills" />
                </div>
                <div className="lab-dash-cols">
                  <div className="card lab-dash-card">
                    <h3>Tests and charges by department</h3>
                    <DepartmentBars rows={d.byDepartment} />
                  </div>
                  <div className="card lab-dash-card">
                    <h3>Waiting now</h3>
                    <dl className="lab-dash-wait">
                      <div>
                        <dt>Samples to take</dt>
                        <dd className="tabular">{d.waiting.collect}</dd>
                      </div>
                      <div>
                        <dt>Samples to receive</dt>
                        <dd className="tabular">{d.waiting.receive}</dd>
                      </div>
                      <div>
                        <dt>Results to enter</dt>
                        <dd className="tabular">{d.waiting.report}</dd>
                      </div>
                      <div>
                        <dt>Results to check</dt>
                        <dd className="tabular">{d.waiting.verify}</dd>
                      </div>
                      <div>
                        <dt>At outside labs</dt>
                        <dd className="tabular">{d.waiting.outside}</dd>
                      </div>
                      <div className={d.late ? 'is-late' : ''}>
                        <dt>
                          <Timer aria-hidden="true" /> Past their due time
                        </dt>
                        <dd className="tabular">{d.late}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}

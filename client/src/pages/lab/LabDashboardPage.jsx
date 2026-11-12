import { useState } from 'react';
import {
  Banknote,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  FileText,
  FlaskConical,
  Home,
  Inbox,
  ListChecks,
  Package,
  Search,
  Settings,
  ShieldCheck,
  TestTube,
  Timer,
  TriangleAlert,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { rupees } from '../billing/billingFormat.js';
import { departmentName } from './labFormat.js';

// The lab's dashboard (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md; made simpler 12 Nov 2026): first what waits
// now as big counts that open their lists (and a critical or late line when there is one), then for lab staff the
// period's four numbers (departments folded away), then every other lab screen as plain links. Numbers only.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PERIODS = {
  today: { label: 'Today', range: () => [new Date(), new Date()] },
  week: { label: 'Last 7 days', range: () => [new Date(Date.now() - 6 * 86_400_000), new Date()] },
  month: { label: 'This month', range: () => [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()] },
};

/** What waits now, in the order work moves through the lab – each a big count that opens its list. */
const WAITING = [
  { key: 'collect', label: 'Samples to take', to: '/lab?list=collect', icon: TestTube },
  { key: 'receive', label: 'Samples to receive', to: '/lab?list=receive', icon: Inbox },
  { key: 'report', label: 'Results to enter', to: '/lab/results', icon: ClipboardPen },
  { key: 'verify', label: 'Results to check', to: '/lab?list=verify', icon: ClipboardCheck },
  { key: 'home', label: 'Home visits', to: '/lab?list=home', icon: Home },
  { key: 'outside', label: 'At outside labs', to: '/lab?list=outside', icon: Truck },
];

/** Everything else, as plain links in two short groups. */
const LINKS = [
  {
    key: 'daily',
    title: 'Daily work',
    items: [
      { label: 'Find a sample or patient', to: '/lab/find', icon: Search },
      { label: 'Reports of the last 7 days', to: '/lab?list=done', icon: FileText },
      { label: 'Lab register', to: '/lab/register', icon: ClipboardList },
      { label: 'Cash handover', to: '/cash-handover', icon: Banknote, labOnly: true },
    ],
  },
  {
    key: 'setup',
    title: 'Setup',
    items: [
      { label: 'Tests and prices', to: '/lab/tests', icon: ListChecks },
      { label: 'Referring doctors', to: '/lab/referrers', icon: Users },
      { label: 'Stock', to: '/lab/stock', icon: Package },
      { label: 'Quality control', to: '/lab/qc', icon: ShieldCheck },
      { label: 'Settings', to: '/lab/settings', icon: Settings },
    ],
  },
];

function WaitingTiles({ waiting }) {
  return (
    <ul className="ldb-wait">
      {WAITING.map((w) => {
        const n = waiting?.[w.key];
        return (
          <li key={w.key}>
            <Link to={w.to} className={`ldb-tile${n > 0 ? ' has-work' : ''}`}>
              <w.icon aria-hidden="true" />
              <span className="ldb-tile-n tabular">{n ?? '–'}</span>
              <span className="ldb-tile-label">{w.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
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

  const late = isLab ? (d?.late ?? 0) : 0;
  const critical = waiting?.critical ?? 0;

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Lab"
        documentTitle="Lab dashboard"
        help="What is waiting now, the day's numbers, and every other part of the lab. Numbers only – no patient names."
        actions={
          isLab && (
            <Link to="/lab/new" className="btn btn-primary">
              <UserPlus aria-hidden="true" /> New patient test
            </Link>
          )
        }
      />
      <div className="pf-content lab-dash">
        <Alert type="error">{dash.error || work.error}</Alert>
        {(critical > 0 || late > 0) && (
          <div className="ldb-alerts">
            {critical > 0 && (
              <Link to="/lab?list=critical" className="ldb-alert is-high">
                <TriangleAlert aria-hidden="true" /> Critical: {critical} result{critical === 1 ? '' : 's'} not yet called to a doctor
              </Link>
            )}
            {late > 0 && (
              <span className="ldb-alert is-watch">
                <Timer aria-hidden="true" /> Late: {late} past their due time
              </span>
            )}
          </div>
        )}

        <section aria-labelledby="lab-dash-waiting">
          <h2 id="lab-dash-waiting" className="lab-dash-title">
            Waiting now
          </h2>
          <WaitingTiles waiting={waiting} />
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
                <dl className="ldb-numbers">
                  <div>
                    <dt>Patients</dt>
                    <dd className="tabular">{d.registered.patients}</dd>
                  </div>
                  <div>
                    <dt>Tests</dt>
                    <dd className="tabular">{d.registered.tests}</dd>
                  </div>
                  <div>
                    <dt>Reports finished</dt>
                    <dd className="tabular">{d.reported}</dd>
                  </div>
                  <div>
                    <dt>Charged</dt>
                    <dd className="tabular">{rupees(d.chargedPaise)}</dd>
                  </div>
                </dl>
                <details className="ldb-more">
                  <summary>By department</summary>
                  <DepartmentBars rows={d.byDepartment} />
                </details>
              </>
            )}
          </section>
        )}

        <div className="ldb-links">
          {LINKS.map((g) => (
            <nav key={g.key} aria-labelledby={`ldb-${g.key}`} className="card ldb-group">
              <h2 id={`ldb-${g.key}`}>{g.title}</h2>
              <ul>
                {g.items
                  .filter((i) => isLab || !i.labOnly)
                  .map((i) => (
                    <li key={i.to}>
                      <Link to={i.to}>
                        <i.icon aria-hidden="true" /> {i.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </>
  );
}

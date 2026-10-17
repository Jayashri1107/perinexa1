import { useMemo, useState } from 'react';
import { CircleCheck, FilePen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DEPARTMENTS, departmentName } from './labFormat.js';

// Lab → Tests (docs/LAB_LIMS_PLAN.md features 2 and 3): the hospital's test list by department – the built-in tests
// and the hospital's own – with the sample, the turnaround time, the price and whether the usual ranges are approved
// by a doctor (DRAFT until then). The lab, doctors and RMOs open a test to change it; nurses read the list.

export const rupees = (paise) => (paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`);

export function TestStatus({ test }) {
  return test.status === 'approved' ? (
    <StatusPill tone="stable" icon={CircleCheck}>
      Approved
    </StatusPill>
  ) : (
    <StatusPill tone="watch" icon={FilePen}>
      DRAFT
    </StatusPill>
  );
}

export function LabTestsPage() {
  const { data, error, loading } = useFetch('/lab-setup/tests');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('adult');
  const groups = useMemo(() => {
    const byDept = new Map(Object.keys(DEPARTMENTS).map((k) => [k, []]));
    for (const t of data?.tests ?? []) {
      if (t.who !== who) continue;
      if (q && !t.name.toLowerCase().includes(q.toLowerCase())) continue;
      byDept.get(t.department)?.push(t);
    }
    return [...byDept.entries()].filter(([, list]) => list.length);
  }, [data, q, who]);

  return (
    <>
      <PageHeader title="Lab tests" documentTitle="Lab tests" help="The hospital's test list. Open a test to change its department, times, outside lab or usual ranges. A change to a range is a DRAFT until a doctor approves it." />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <div className="lab-toolbar">
          <div className="segmented" aria-label="Whose tests">
            <button type="button" aria-pressed={who === 'adult'} onClick={() => setWho('adult')}>
              Adult tests
            </button>
            <button type="button" aria-pressed={who === 'newborn'} onClick={() => setWho('newborn')}>
              Baby tests
            </button>
          </div>
          <label className="lab-filter" htmlFor="lab-tests-q">
            <span>Find a test</span>
            <input id="lab-tests-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {data?.canEdit && (
            <Link to="/lab/tests/new" className="btn btn-primary">
              <Plus aria-hidden="true" /> Add a test
            </Link>
          )}
        </div>
        {loading && !data && <p className="muted">Loading…</p>}
        {data && !groups.length && <p className="muted">No test matches.</p>}
        {groups.map(([dept, list]) => (
          <section key={dept} className="card" aria-labelledby={`dept-${dept}`}>
            <h2 id={`dept-${dept}`}>
              {departmentName(dept)} <span className="muted tabular">({list.length})</span>
            </h2>
            <ul className="wl-list">
              {list.map((t) => (
                <li key={t.key}>
                  <div className="wl-row-head">
                    <span className="wl-who">
                      <Link to={`/lab/tests/${t.key}`} className="strong-name">
                        {t.name}
                      </Link>
                      <span className="muted">
                        {[t.custom ? "Hospital's own" : null, t.sample, `${t.tatHours} h (urgent ${t.urgentTatHours} h)`, rupees(t.pricePaise), t.outsideLab ? `usually sent to ${t.outsideLab}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="wl-counts">
                      {!t.active && (
                        <StatusPill tone="inactive" icon={FilePen}>
                          Not offered
                        </StatusPill>
                      )}
                      <TestStatus test={t} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {data && <p className="hint">Prices come from the hospital's price list (Billing → Price list), kept by the hospital admin. A new test starts at ₹0.</p>}
      </div>
    </>
  );
}

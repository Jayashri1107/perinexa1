import { useState } from 'react';
import { Lock, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_PAYROLL } from '../../platform/modules.js';
import { ListButtons } from './PayrollClose.jsx';
import { PayslipsPrint } from './PayslipPrint.jsx';
import { monthLabel } from './runFormat.js';

// Payroll → Lists (docs/PAYROLL_BUILD_NOTE.md section 4, "Screens"): every locked month in one place, with its
// payslips and its monthly lists – the salary register, the PF, ESI and professional tax lists and, where the
// hospital admin switched it on, the bank payment list. The same files as on Run payroll, part 6; nothing is worked
// out here. A month that is not locked has no lists: it is named with a link to Run payroll.

export function PayrollListsPage() {
  const res = useFetch('/payroll/runs');
  const [saved, setSaved] = useState({}); // month → the lists saved from this screen since it was opened
  const [print, setPrint] = useState(null); // the month whose payslips are open
  const runs = res.data?.runs ?? [];
  const locked = runs.filter((r) => r.locked);
  const open = runs.filter((r) => !r.locked);
  return (
    <>
      <PageHeader tabs={HOSPITAL_PAYROLL.tabs} title="Lists" documentTitle="Payroll lists" help="Payslips and the monthly lists of every locked month. Each file saved is written in the audit log." />
      <div className="pf-content pr-page">
        <Alert type="error">{res.error}</Alert>
        {res.data && locked.length === 0 && (
          <section className="card">
            <p className="muted">No month is locked yet. Payslips and lists are made from a locked month: Payroll → Run payroll, part 6.</p>
          </section>
        )}
        {locked.map((r) => (
          <section className="card" key={r.month} aria-labelledby={`pr-list-${r.month}`}>
            <h2 id={`pr-list-${r.month}`}>{monthLabel(r.month)}</h2>
            <p className="pr-draft">
              <StatusPill tone="stable" icon={Lock}>{`Locked – version ${r.locked.version}`}</StatusPill> {`By ${r.locked.byName}, ${formatDateTime(r.locked.at)} – ${r.locked.people} ${r.locked.people === 1 ? 'person' : 'people'}.`} <Link to={`/payroll/run?month=${r.month}`}>Open the month</Link>
            </p>
            <div className="row pr-lock-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPrint(r.month)}>
                <Printer aria-hidden="true" /> Print the payslips
              </button>
            </div>
            <h3 className="pr-sub">The monthly lists</h3>
            <ListButtons month={r.month} lists={res.data.lists} downloads={[...r.downloads, ...(saved[r.month] ?? [])]} onSaved={(d) => setSaved({ ...saved, [r.month]: [...(saved[r.month] ?? []), d] })} />
          </section>
        ))}
        {open.length > 0 && (
          <p className="hint">
            Not locked yet:{' '}
            {open.map((r, i) => (
              <span key={r.month}>
                {i > 0 && ', '}
                <Link to={`/payroll/run?month=${r.month}`}>{monthLabel(r.month)}</Link>
              </span>
            ))}
            . Lists are made once a month is locked.
          </p>
        )}
        {!res.data && !res.error && <p className="muted">Loading…</p>}
      </div>
      {print && <PayslipsPrint month={print} onClose={() => setPrint(null)} />}
    </>
  );
}

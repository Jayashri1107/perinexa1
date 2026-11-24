import { Banknote, CircleCheck, FileUp, ListChecks, Settings, TriangleAlert, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { payrollToDo } from './payrollFormat.js';
import { monthLabel } from './runFormat.js';

// The accounts login's Today (24 Nov 2026): what is waiting in the payroll, in counts only – no name, no amount.
// A page of its own, not a jump to the staff list: Today and Payroll are two different pages in the menu.
// (A hospital admin keeps the hospital's Overview as Today; Payroll is one of its areas there.)
export function PayrollToday() {
  const { user } = useAuth();
  const { data: o, error } = useFetch('/payroll/overview');
  const items = payrollToDo(o);
  const waiting = items.filter((i) => i.tone !== 'stable').length;
  const run = o ? `/payroll/run?month=${o.month}` : '/payroll/run';
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Today' }]} title="Today" />
      <div className="pf-content wl-page td-page">
        <div className="td-hero">
          <p className="td-hero-hello">Welcome, {user?.name}</p>
        </div>
        <Alert type="error">{error}</Alert>
        {o && (
          <>
            <section className="td-group" aria-labelledby="pt-glance">
              <h2 className="td-group-title" id="pt-glance">
                At a glance
              </h2>
              <div className="kpi-grid">
                <KpiCard to="/payroll" icon={Users} label="Working staff" value={o.staff.working} sub={o.staff.left ? `${o.staff.left} left or off the payroll` : 'On the payroll'} />
                <KpiCard to="/payroll" tone={o.staff.withoutPay ? 'watch' : 'stable'} label="Pay not entered" value={o.staff.withoutPay} sub={o.staff.withoutPay ? 'Open each person to enter it' : 'Everyone working has pay'} />
                <KpiCard to="/payroll" icon={ListChecks} label="No attendance code" value={o.staff.withoutCode} sub="Their rows in a file are matched by the code" />
                <KpiCard to={run} tone={o.run?.sheetReady ? 'stable' : 'watch'} icon={o.run?.sheetReady ? CircleCheck : FileUp} label={`Salary sheet, ${monthLabel(o.month)}`} value={o.run?.sheetReady ? 'Made' : 'Not made yet'} textValue sub={o.run?.files ? `${o.run.files} attendance file${o.run.files === 1 ? '' : 's'} read` : 'No attendance file read'} />
              </div>
            </section>

            <section className="td-group" aria-labelledby="pt-todo">
              <h2 className="td-group-title" id="pt-todo">
                {waiting ? `To do (${waiting})` : 'To do'}
              </h2>
              <div className="card">
                {items.length === 0 && <p className="panel-empty">Nothing is waiting in the payroll.</p>}
                {items.length > 0 && (
                  <ul className="pr-todo">
                    {items.map((i) => (
                      <li key={i.key}>
                        <StatusPill tone={i.tone} icon={i.tone === 'stable' ? CircleCheck : TriangleAlert}>
                          {i.tone === 'stable' ? 'Done' : 'To do'}
                        </StatusPill>
                        <span className="pr-todo-text">{i.text}</span>
                        <Link to={i.to}>{i.link}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="td-group" aria-labelledby="pt-open">
              <h2 className="td-group-title" id="pt-open">
                Open
              </h2>
              <div className="row pr-open">
                <Link className="btn btn-secondary" to="/payroll">
                  <Users aria-hidden="true" /> Payroll staff
                </Link>
                <Link className="btn btn-secondary" to={run}>
                  <Banknote aria-hidden="true" /> Run payroll
                </Link>
                <Link className="btn btn-secondary" to="/payroll/settings">
                  <Settings aria-hidden="true" /> Payroll settings
                </Link>
              </div>
            </section>
          </>
        )}
        {!o && !error && <p className="muted">Loading…</p>}
      </div>
    </>
  );
}

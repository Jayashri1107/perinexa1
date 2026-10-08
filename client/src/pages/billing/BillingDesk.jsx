// The billing desk on Today (owner, 8 Oct 2026): the latest bills, who owes (oldest first, with how long), today's
// money by payment mode, today's activity and the money taken in each of the last 7 days. Every row opens the bill;
// "Collect" opens it with the payment form. The full lists stay on the Billing pages.
import { ArrowRight, Ban, FilePlus2, IndianRupee, Printer, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ColumnChart, CHART_COLORS } from '../../components/charts/ColumnChart.jsx';
import { formatMoney } from '../../utils/format.js';
import { BillStatus } from './BillStatus.jsx';

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const daysText = (d) => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

function CardHead({ title, to, link }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {to && <Link to={to} className="small">{link} <ArrowRight size={12} aria-hidden /></Link>}
    </div>
  );
}

function RecentBills({ bills }) {
  return (
    <section className="card bd-wide">
      <CardHead title="Recent bills" to="/hospital/billing" link="All bills" />
      {bills.length === 0 ? (
        <p className="muted">No bills yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table bd-table">
            <thead>
              <tr><th>Bill</th><th>Patient</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap"><Link to={`/hospital/billing/bills/${b.id}`}><strong>{b.billNumber}</strong></Link></td>
                  <td>{b.patient.name}<span className="muted block small">{b.patient.patientNumber}</span></td>
                  <td className="num">{formatMoney(b.total)}</td>
                  <td className="num">{formatMoney(b.paid)}</td>
                  <td className="num"><strong>{formatMoney(b.balance)}</strong></td>
                  <td><BillStatus bill={b} /></td>
                  <td className="actions">
                    <span className="row-actions">
                      {b.status === 'open' && b.balance > 0 && (
                        <Link to={`/hospital/billing/bills/${b.id}?pay=1`} className="btn btn-ghost btn-sm"><IndianRupee size={14} aria-hidden /> Collect</Link>
                      )}
                      <Link to={`/hospital/print/bill/${b.id}`} target="_blank" className="icon-btn" aria-label={`Print bill ${b.billNumber}`} title="Print"><Printer size={15} /></Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Oldest first; overdue (older than overdueDays) in red, the others in amber – colour + word.
function PendingPayments({ bills, overdueDays }) {
  return (
    <section className="card">
      <CardHead title="Pending payments" to="/hospital/billing/unpaid" link="All unpaid" />
      {bills.length === 0 ? (
        <p className="muted">Nothing owed – every bill is paid.</p>
      ) : (
        <ul className="plain-list bd-pending">
          {bills.map((b) => {
            const overdue = b.days > overdueDays;
            return (
              <li key={b.id} className={overdue ? 'is-overdue' : 'is-due'}>
                <span className="bd-pending-who">
                  <Link to={`/hospital/billing/bills/${b.id}`}><strong>{b.patient.name}</strong></Link>
                  <span className="muted small"> {b.billNumber} · total {formatMoney(b.total)} · paid {formatMoney(b.paid)}</span>
                </span>
                <span className="bd-pending-due">
                  <strong>{formatMoney(b.balance)}</strong>
                  <span className={`bd-age ${overdue ? 'bd-age-overdue' : ''}`}>{overdue ? `Overdue · ${daysText(b.days)}` : daysText(b.days)}</span>
                </span>
                <Link to={`/hospital/billing/bills/${b.id}?pay=1`} className="btn btn-ghost btn-sm">Collect</Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Today's money by payment mode, after refunds: one simple bar each.
function TodaysCollection({ byMode, total }) {
  const shown = byMode.filter((m) => m.count > 0);
  const max = Math.max(1, ...shown.map((m) => Math.abs(m.net)));
  return (
    <section className="card">
      <CardHead title="Today's collection" to="/hospital/billing/daily" link="Cash summary" />
      {shown.length === 0 ? (
        <p className="muted">No payments yet today.</p>
      ) : (
        <ul className="plain-list bd-modes">
          {shown.map((m) => (
            <li key={m.mode}>
              <span className="bd-mode-label">{m.label}<span className="muted small"> · {m.count}</span></span>
              <span className="bd-mode-bar" aria-hidden><span style={{ width: `${(Math.max(0, m.net) / max) * 100}%` }} /></span>
              <strong className="bd-mode-amount">{formatMoney(m.net)}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="bd-total">
        <span>Total (after refunds)</span>
        <strong>{formatMoney(total)}</strong>
      </div>
    </section>
  );
}

const ACTIVITY = {
  payment: { icon: IndianRupee, word: 'Payment received', tone: 'tone-green' },
  refund: { icon: Undo2, word: 'Refund given', tone: 'tone-amber' },
  bill: { icon: FilePlus2, word: 'Bill made', tone: '' },
  bill_cancelled: { icon: Ban, word: 'Bill made, then cancelled', tone: 'tone-grey' },
};

function RecentActivity({ items, modes }) {
  const modeLabel = (k) => modes.find((m) => m.mode === k)?.label ?? k;
  return (
    <section className="card">
      <CardHead title="Today's activity" />
      {items.length === 0 ? (
        <p className="muted">Nothing yet today.</p>
      ) : (
        <ul className="plain-list bd-activity">
          {items.map((a, n) => {
            const look = ACTIVITY[a.kind] ?? ACTIVITY.bill;
            return (
              <li key={n}>
                <span className={`notif-icon ${look.tone}`} aria-hidden><look.icon size={15} /></span>
                <span className="bd-activity-text">
                  <strong className="block">{look.word}</strong>
                  <span className="small">
                    <Link to={`/hospital/billing/bills/${a.billId}`}>{a.patient || a.billNumber}</Link> · {formatMoney(a.amount)}
                    {a.mode && ` · ${modeLabel(a.mode)}`}
                  </span>
                </span>
                <span className="muted small nowrap">{time.format(new Date(a.at))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function WeekChart({ week }) {
  const data = week.map((d, i) => ({ label: i === week.length - 1 ? 'Today' : weekday.format(new Date(`${d.date}T12:00:00`)), values: [d.net] }));
  const total = week.reduce((n, d) => n + d.net, 0);
  return (
    <section className="card">
      <CardHead title="Collection – last 7 days" to="/hospital/billing/daily" link="By day" />
      <p className="muted small bd-week-total">{formatMoney(total)} in 7 days, after refunds</p>
      <ColumnChart data={data} series={[{ label: 'Collected', color: CHART_COLORS[0] }]} format={formatMoney} title="Money collected each day, last 7 days" empty="Nothing collected in the last 7 days." height={170} />
    </section>
  );
}

export function BillingDesk({ billing }) {
  return (
    <div className="bd-grid span-2">
      <RecentBills bills={billing.recentBills} />
      <PendingPayments bills={billing.pendingBills} overdueDays={billing.overdueDays} />
      <TodaysCollection byMode={billing.byMode} total={billing.collectedToday} />
      <RecentActivity items={billing.activity} modes={billing.byMode} />
      <WeekChart week={billing.week} />
    </div>
  );
}

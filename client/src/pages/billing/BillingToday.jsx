import { BedDouble, Banknote, FilePlus2, FileText, HandCoins, ReceiptText, RotateCcw, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { Alert, KpiCard, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KIND_LABELS, STATUS_LOOK, rupees } from './billingFormat.js';

/**
 * The billing department's Today (owner, 13 Oct 2026): six number cards from the bills already kept – collected today,
 * unpaid, bills made today, advances held for patients still in hospital, discharged stays not settled and money to
 * give back – the day's quick actions, and the latest bills. Numbers only from the bills; nothing is worked out twice.
 */
export function BillingToday() {
  const daily = useFetch('/billing/reports/daily');
  const unpaid = useFetch('/billing/reports/unpaid');
  const bills = useFetch('/billing/bills');
  const navigate = useNavigate();

  const todays = bills.data?.bills ?? [];
  const made = todays.filter((b) => b.date === bills.data?.today && b.status !== 'cancelled');
  const staying = todays.filter((b) => b.kind === 'ipd' && b.stay?.inHospital && b.status !== 'cancelled' && b.paid > 0);
  const owing = unpaid.data?.bills ?? [];
  const toSettle = owing.filter((b) => b.kind === 'ipd' && b.stay && !b.stay.inHospital && b.balance > 0);
  const giveBack = owing.filter((b) => b.balance < 0);
  const sum = (list, pick) => list.reduce((s, b) => s + pick(b), 0);
  const modes = (daily.data?.byMode ?? []).filter((m) => m.net !== 0).map((m) => `${m.label} ${rupees(m.net)}`);
  const recent = todays.slice(0, 8);
  const error = daily.error || unpaid.error || bills.error;
  // Phones, as in the app design (2 Nov 2026): the day's money first, then what to look at, from the same numbers
  const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 719px)').matches);
  const d = daily.data;
  const owed = owing.filter((b) => b.balance > 0);
  const howMany = (n, one) => `${formatNumber(n)} ${one}${n === 1 ? '' : 's'}`;
  const looks = [
    { label: 'Unpaid bills', sub: unpaid.data ? howMany(owed.length, 'bill') : '', value: unpaid.data ? rupees(unpaid.data.owed ?? 0) : '—', to: '/billing/unpaid', tone: owed.length ? 'is-watch' : '' },
    { label: 'Cash in the drawer', sub: 'Cash only, after expenses', value: d ? rupees(d.cashInHand ?? 0) : '—', to: '/billing/daily' },
    { label: 'Expenses today', sub: d ? howMany((d.expenses ?? []).length, 'entry').replace('entrys', 'entries') : '', value: d ? rupees(d.totals.expenses ?? 0) : '—', to: '/expenses' },
    { label: 'Cash handover', sub: 'Day-end handover', value: '', to: '/cash-handover' },
    { label: 'Bills made today', sub: bills.data ? `${rupees(sum(made, (b) => b.total))} charged` : '', value: bills.data ? formatNumber(made.length) : '—', to: '/billing' },
    { label: 'Advances held', sub: bills.data ? `Paid by ${howMany(staying.length, 'patient')} still in hospital` : '', value: bills.data ? rupees(sum(staying, (b) => b.paid)) : '—', to: '/billing' },
    { label: 'Discharged, not settled', sub: unpaid.data ? (toSettle.length ? `${rupees(sum(toSettle, (b) => b.balance))} still to pay` : 'Every discharged stay is settled') : '', value: unpaid.data ? formatNumber(toSettle.length) : '—', to: '/billing/unpaid', tone: toSettle.length ? 'is-watch' : '' },
    { label: 'Money to give back', sub: unpaid.data ? (unpaid.data.dueBack ? `${rupees(unpaid.data.dueBack)} to refund` : 'No refunds due') : '', value: unpaid.data ? formatNumber(giveBack.length) : '—', to: '/billing/unpaid', tone: giveBack.length ? 'is-high' : '' },
  ];

  return (
    <>
      {error && <Alert type="error">{error}</Alert>}
      {onPhone && (
        <div className="bh-home">
          <Link to="/billing/daily" className="bh-hero" aria-label="Open the daily collection">
            <span>Collected today</span>
            <strong className="tabular">{d ? rupees(d.totals.net) : '—'}</strong>
            <span className="bh-modes">
              {(d?.byMode ?? [])
                .filter((m) => m.net !== 0 || ['cash', 'upi', 'card'].includes(m.mode))
                .map((m) => (
                  <span key={m.mode}>
                    <strong className="tabular">{rupees(m.net)}</strong>
                    {m.label}
                  </span>
                ))}
            </span>
          </Link>
          <Link to="/billing" className="btn btn-primary">
            Open bills
          </Link>
          <section aria-labelledby="bh-look">
            <h2 id="bh-look">To look at</h2>
            <ul className="bh-list">
              {looks.map((l) => (
                <li key={l.label}>
                  <Link to={l.to} className={l.tone || undefined}>
                    <span>
                      <strong>{l.label}</strong>
                      {l.sub}
                    </span>
                    {l.value && <strong className="tabular">{l.value}</strong>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {!onPhone && (
      <>
      <section className="td-group" aria-labelledby="bt-glance">
        <h2 className="td-group-title" id="bt-glance">
          Billing at a glance
        </h2>
        <div className="kpi-grid">
          <KpiCard
            to="/billing/daily"
            icon={Banknote}
            label="Collected today"
            value={daily.data ? rupees(daily.data.totals.net) : '—'}
            textValue
            sub={daily.data ? (modes.length ? modes.join(' · ') : 'Nothing collected yet') : undefined}
          />
          <KpiCard
            to="/billing/unpaid"
            tone={owing.some((b) => b.balance > 0) ? 'watch' : 'neutral'}
            icon={Wallet}
            label="Unpaid bills"
            value={unpaid.data ? formatNumber(owing.filter((b) => b.balance > 0).length) : '—'}
            sub={unpaid.data ? (unpaid.data.owed ? `${rupees(unpaid.data.owed)} owed` : 'Nothing owed') : undefined}
          />
          <KpiCard
            to="/billing"
            icon={FileText}
            label="Bills made today"
            value={bills.data ? formatNumber(made.length) : '—'}
            sub={bills.data ? `${rupees(sum(made, (b) => b.total))} charged` : undefined}
          />
          <KpiCard
            to="/billing"
            tone={staying.length ? 'due' : 'neutral'}
            icon={HandCoins}
            label="Advances held"
            value={bills.data ? rupees(sum(staying, (b) => b.paid)) : '—'}
            textValue
            sub={bills.data ? `Paid by ${formatNumber(staying.length)} patient${staying.length === 1 ? '' : 's'} still in hospital` : undefined}
          />
          <KpiCard
            to="/billing/unpaid"
            tone={toSettle.length ? 'watch' : 'neutral'}
            icon={BedDouble}
            label="Discharged, not settled"
            value={unpaid.data ? formatNumber(toSettle.length) : '—'}
            sub={unpaid.data ? (toSettle.length ? `${rupees(sum(toSettle, (b) => b.balance))} still to pay` : 'Every discharged stay is settled') : undefined}
          />
          <KpiCard
            to="/billing/unpaid"
            tone={giveBack.length ? 'high' : 'neutral'}
            icon={RotateCcw}
            label="Money to give back"
            value={unpaid.data ? formatNumber(giveBack.length) : '—'}
            sub={unpaid.data ? (unpaid.data.dueBack ? `${rupees(unpaid.data.dueBack)} to refund` : 'No refunds due') : undefined}
          />
        </div>
      </section>

      <nav className="td-quick" aria-label="Billing quick actions">
        <Link to="/billing?new=1" className="btn btn-secondary btn-sm">
          <FilePlus2 aria-hidden="true" /> New bill
        </Link>
        <Link to="/billing/unpaid" className="btn btn-secondary btn-sm">
          <Wallet aria-hidden="true" /> Take payment
        </Link>
        <Link to="/billing/daily" className="btn btn-secondary btn-sm">
          <ReceiptText aria-hidden="true" /> Close the day (daily summary)
        </Link>
      </nav>
      </>
      )}

      <section className="card bt-recent" aria-labelledby="bt-recent-title">
        <div className="bt-recent-head">
          <h2 id="bt-recent-title">Today's bills</h2>
          <Link to="/billing" className="btn btn-link btn-sm">
            All bills
          </Link>
        </div>
        {bills.data && recent.length === 0 && <p className="muted">No bills yet today.</p>}
        {recent.length > 0 && (
          <div className="bt-table-wrap">
            <table className="bt-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Bill</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col" className="num">
                    Paid
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => {
                  const look = STATUS_LOOK[b.status] ?? STATUS_LOOK.no_charges;
                  return (
                    <tr key={b.id} onClick={() => navigate(`/billing/bills/${b.id}`)}>
                      <td>
                        <Link to={`/billing/bills/${b.id}`} onClick={(e) => e.stopPropagation()}>
                          {b.patient?.fullName ?? 'Patient'}
                        </Link>
                        <span className="muted tabular bt-sub">{b.patient?.mrn}</span>
                      </td>
                      <td>
                        <span className="tabular">{b.number}</span>
                        <span className="muted bt-sub">{KIND_LABELS[b.kind]}</span>
                      </td>
                      <td className="num tabular">{rupees(b.total)}</td>
                      <td className="num tabular">{rupees(b.paid)}</td>
                      <td className="num tabular">{rupees(Math.abs(b.balance))}</td>
                      <td>
                        <StatusPill tone={look.tone} icon={look.icon}>
                          {look.label}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

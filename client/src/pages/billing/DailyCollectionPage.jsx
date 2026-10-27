import { useState } from 'react';
import { Ban, Banknote, ChevronLeft, ChevronRight, Download, HandCoins, Plus, Printer, ReceiptText, RotateCcw, Search, Wallet } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDateTime, formatTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { addDaysIso, dayLabel } from '../appointments/appointmentFormat.js';
import { amountInWords } from './amountWords.js';
import { MODE_LABELS, PAYMENT_KIND_LABELS, REPORT_ROLES, billingTabs, rupees, toPaise } from './billingFormat.js';
import { Modal } from './billingUi.jsx';

// Billing → Daily summary, redesigned (owner, 27 Oct 2026): the day at a glance – collected, given back, the day's
// expenses and what is left – then the money by mode, OPD and IPD, the expenses paid from the counter (entered here,
// taken off the total), who collected, the groups charged and every receipt. Printed or saved as a PDF for the
// handover at the end of the day.

export const EXPENSE_CATEGORY_LABELS = {
  petty_cash: 'Petty cash',
  refreshments: 'Tea and refreshments',
  stationery: 'Stationery and printing',
  courier: 'Courier and post',
  transport: 'Transport',
  cleaning: 'Cleaning and housekeeping',
  repairs: 'Repairs and maintenance',
  salary_advance: 'Staff advance',
  other: 'Other',
};
const EXPENSE_MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };
const EMPTY_EXPENSE = { category: 'refreshments', amount: '', mode: 'cash', paidTo: '', description: '' };

/** The day's figures, worked out from the server's summary (older summaries without expenses count none). */
export function dayFigures(d) {
  const expenses = d.totals.expenses ?? 0;
  return { collected: d.totals.in, givenBack: d.totals.out, net: d.totals.net, expenses, balance: d.totals.balance ?? d.totals.net - expenses, cashInHand: d.cashInHand ?? d.byMode.find((m) => m.mode === 'cash')?.net ?? 0 };
}

function ModeTable({ d }) {
  const spentBy = Object.fromEntries(Object.keys(EXPENSE_MODE_LABELS).map((m) => [m, 0]));
  for (const e of d.expenses ?? []) if (!e.cancelled) spentBy[e.mode] += e.amountPaise;
  const f = dayFigures(d);
  return (
    <table className="bill-report dc-table">
      <caption>Money by mode</caption>
      <thead>
        <tr>
          <th scope="col">Mode</th>
          <th scope="col" className="num">Collected</th>
          <th scope="col" className="num">Given back</th>
          <th scope="col" className="num">Expenses</th>
          <th scope="col" className="num">Balance</th>
        </tr>
      </thead>
      <tbody>
        {d.byMode.map((m) => (
          <tr key={m.mode}>
            <td>{m.label}</td>
            <td className="num">{rupees(m.in)}</td>
            <td className="num">{m.out ? `−${rupees(m.out)}` : rupees(0)}</td>
            <td className="num">{spentBy[m.mode] ? `−${rupees(spentBy[m.mode])}` : rupees(0)}</td>
            <td className="num">{rupees(m.net - (spentBy[m.mode] ?? 0))}</td>
          </tr>
        ))}
        {spentBy.bank > 0 && (
          <tr>
            <td>Bank transfer</td>
            <td className="num">{rupees(0)}</td>
            <td className="num">{rupees(0)}</td>
            <td className="num">−{rupees(spentBy.bank)}</td>
            <td className="num">−{rupees(spentBy.bank)}</td>
          </tr>
        )}
        <tr className="bill-report-total">
          <th scope="row">Total</th>
          <td className="num">{rupees(f.collected)}</td>
          <td className="num">{f.givenBack ? `−${rupees(f.givenBack)}` : rupees(0)}</td>
          <td className="num">{f.expenses ? `−${rupees(f.expenses)}` : rupees(0)}</td>
          <td className="num">{rupees(f.balance)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function KindTable({ d }) {
  if (!d.byKind) return null;
  return (
    <table className="bill-report dc-table">
      <caption>OPD and IPD</caption>
      <thead>
        <tr>
          <th scope="col">Department</th>
          <th scope="col" className="num">Collected</th>
          <th scope="col" className="num">Given back</th>
          <th scope="col" className="num">Net</th>
        </tr>
      </thead>
      <tbody>
        {d.byKind.map((k) => (
          <tr key={k.kind}>
            <td>{k.kind === 'ipd' ? 'IPD (inpatient)' : 'OPD (outpatient)'}</td>
            <td className="num">{rupees(k.in)}</td>
            <td className="num">{k.out ? `−${rupees(k.out)}` : rupees(0)}</td>
            <td className="num">{rupees(k.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpensesTable({ expenses, onCancel }) {
  const live = expenses.filter((e) => !e.cancelled);
  return (
    <table className="bill-report dc-table dc-expenses">
      <caption>Expenses paid from the counter</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">For</th>
          <th scope="col">Paid to / note</th>
          <th scope="col">Mode</th>
          <th scope="col" className="num">Amount</th>
          <th scope="col">By</th>
          {onCancel && <th scope="col"><span className="sr-only">Cancel</span></th>}
        </tr>
      </thead>
      <tbody>
        {expenses.map((e) => (
          <tr key={e.id} className={e.cancelled ? 'dc-cancelled' : undefined}>
            <td>{e.at ? formatTime(e.at) : ''}</td>
            <td>{EXPENSE_CATEGORY_LABELS[e.category] ?? e.category}</td>
            <td className="dc-wrap">
              {[e.paidTo, e.description].filter(Boolean).join(' – ')}
              {e.cancelled && (
                <span className="dc-cancel-note">
                  Cancelled by {e.cancelled.byName}: {e.cancelled.reason}
                </span>
              )}
            </td>
            <td>{EXPENSE_MODE_LABELS[e.mode] ?? e.mode}</td>
            <td className="num">{rupees(e.amountPaise)}</td>
            <td>{e.byName}</td>
            {onCancel && (
              <td>
                {!e.cancelled && (
                  <button type="button" className="icon-btn" aria-label={`Cancel the expense of ${rupees(e.amountPaise)}`} title="Cancel (entered by mistake)" onClick={() => onCancel(e)}>
                    <Ban aria-hidden="true" />
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
        {!expenses.length && (
          <tr>
            <td colSpan={onCancel ? 7 : 6} className="muted">
              No expenses entered for this day.
            </td>
          </tr>
        )}
        {live.length > 0 && (
          <tr className="bill-report-total">
            <th scope="row" colSpan={4}>
              Total expenses
            </th>
            <td className="num">{rupees(live.reduce((s, e) => s + e.amountPaise, 0))}</td>
            <td colSpan={onCancel ? 2 : 1} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SmallTables({ d }) {
  return (
    <>
      <table className="bill-report dc-table">
        <caption>Collected by</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col" className="num">Receipts</th>
            <th scope="col" className="num">Collected</th>
            <th scope="col" className="num">Given back</th>
          </tr>
        </thead>
        <tbody>
          {d.byPerson.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="num">{p.count}</td>
              <td className="num">{rupees(p.in)}</td>
              <td className="num">{p.out ? `−${rupees(p.out)}` : rupees(0)}</td>
            </tr>
          ))}
          {!d.byPerson.length && (
            <tr>
              <td colSpan={4} className="muted">
                No money taken this day.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {d.byGroup?.length > 0 && (
        <table className="bill-report dc-table">
          <caption>Charged this day, by service group</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col" className="num">Services</th>
              <th scope="col" className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.byGroup.map((g) => (
              <tr key={g.group}>
                <td>{g.label}</td>
                <td className="num">{g.count}</td>
                <td className="num">{rupees(g.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.discounts.length > 0 && (
        <table className="bill-report dc-table">
          <caption>Discounts given</caption>
          <tbody>
            {d.discounts.map((x) => (
              <tr key={x.billId}>
                <td>{x.number}</td>
                <td>{x.patient?.fullName}</td>
                <td className="num">{rupees(x.discountPaise)}</td>
                <td className="dc-wrap">
                  {x.reason} ({x.byName})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.cancelled.length > 0 && (
        <table className="bill-report dc-table">
          <caption>Bills cancelled</caption>
          <tbody>
            {d.cancelled.map((x) => (
              <tr key={x.billId}>
                <td>{x.number}</td>
                <td>{x.patient?.fullName}</td>
                <td className="dc-wrap">
                  {x.reason} ({x.byName})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ReceiptsTable({ payments }) {
  return (
    <table className="bill-report bill-receipts dc-table">
      <caption>Every receipt</caption>
      <thead>
        <tr>
          <th scope="col">Sr.</th>
          <th scope="col">Time</th>
          <th scope="col">Receipt</th>
          <th scope="col">Bill</th>
          <th scope="col">Reg. no.</th>
          <th scope="col">Patient</th>
          <th scope="col">OPD / IPD</th>
          <th scope="col">Services</th>
          <th scope="col">Doctor</th>
          <th scope="col">Mode</th>
          <th scope="col" className="num">Amount</th>
          <th scope="col">By</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p, i) => (
          <tr key={p.receipt}>
            <td>{i + 1}</td>
            <td>{formatTime(p.at)}</td>
            <td>{p.receipt}</td>
            <td>{p.number}</td>
            <td>{p.patient?.mrn}</td>
            <td>{p.patient?.fullName}</td>
            <td>{p.billKind === 'ipd' ? 'IPD' : 'OPD'}</td>
            <td className="bill-receipts-services">
              {p.services}
              {p.kind !== 'payment' ? ` (${PAYMENT_KIND_LABELS[p.kind].toLowerCase()})` : ''}
            </td>
            <td>{p.doctorName}</td>
            <td>{MODE_LABELS[p.mode]}</td>
            <td className="num">{p.kind === 'refund' ? `−${rupees(p.amountPaise)}` : rupees(p.amountPaise)}</td>
            <td>{p.byName}</td>
          </tr>
        ))}
        {!payments.length && (
          <tr>
            <td colSpan={12} className="muted">
              No receipts this day.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Enter one expense of the day. */
function ExpenseForm({ date, onAdded }) {
  const [v, setV] = useState(EMPTY_EXPENSE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const amountPaise = toPaise(v.amount);
  const save = async (e) => {
    e.preventDefault();
    if (!amountPaise || amountPaise < 100) return setFields({ amountPaise: 'Enter the amount in rupees, for example 120.' });
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api('/billing/expenses', { method: 'POST', body: { date, category: v.category, mode: v.mode, amountPaise, paidTo: v.paidTo.trim(), description: v.description.trim() } });
      setV(EMPTY_EXPENSE);
      onAdded();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="dc-expense-form" onSubmit={save} noValidate>
      <Alert type="error">{error}</Alert>
      <div className="dc-expense-grid">
        <Field label="For" id="dc-exp-category" error={fields.category}>
          <select id="dc-exp-category" value={v.category} onChange={set('category')}>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount ₹" id="dc-exp-amount" error={fields.amountPaise}>
          <input id="dc-exp-amount" inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="e.g. 120" />
        </Field>
        <Field label="Paid by" id="dc-exp-mode" error={fields.mode}>
          <select id="dc-exp-mode" value={v.mode} onChange={set('mode')}>
            {Object.entries(EXPENSE_MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid to (optional)" id="dc-exp-paidto" error={fields.paidTo}>
          <input id="dc-exp-paidto" value={v.paidTo} onChange={set('paidTo')} maxLength={100} placeholder="e.g. tea stall" />
        </Field>
      </div>
      <Field label="Note (optional)" id="dc-exp-note" error={fields.description} hint="Never a patient's name or details.">
        <input id="dc-exp-note" value={v.description} onChange={set('description')} maxLength={200} />
      </Field>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        <Plus aria-hidden="true" /> {busy ? 'Saving…' : 'Add expense'}
      </button>
    </form>
  );
}

function CancelExpenseDialog({ expense, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/billing/expenses/${expense.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="dc-cancel" title={`Cancel the expense of ${rupees(expense.amountPaise)}?`} onClose={onClose}>
      <p>It stays listed, struck through, and is no longer taken off the day's total.</p>
      <Alert type="error">{error}</Alert>
      <Field label="Why is it cancelled" id="dc-cancel-reason">
        <input id="dc-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. entered twice" autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={reason.trim().length < 3 || busy} onClick={send}>
          {busy ? 'Saving…' : 'Cancel the expense'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

export function DailySummaryPage() {
  const { activeMembership } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const res = useFetch('/billing/reports/daily', { date });
  const [version, setVersion] = useState(0); // a new print after an expense was added
  const lh = useFetch('/tenant/settings/letterhead');
  const [printing, setPrinting] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [filter, setFilter] = useState('');
  const [excel, setExcel] = useState({ busy: false, error: null });
  const d = res.data;
  const day = d?.date ?? date;
  const go = (x) => setParams({ date: x }, { replace: true });
  const reload = () => {
    setVersion((n) => n + 1);
    res.reload();
  };
  const seesExport = activeMembership.roles.some((r) => REPORT_ROLES.includes(r));
  const today = new Date().toLocaleDateString('en-CA');
  const downloadExcel = async () => {
    setExcel({ busy: true, error: null });
    try {
      const { blob, name } = await apiFile('/billing/export', { query: { from: day, to: day, what: 'payments' } });
      downloadFile(blob, name);
      setExcel({ busy: false, error: null });
    } catch (err) {
      setExcel({ busy: false, error: err.message });
    }
  };
  const f = d ? dayFigures(d) : null;
  const q = filter.trim().toLowerCase();
  const shown = d ? d.payments.filter((p) => !q || [p.receipt, p.number, p.patient?.mrn, p.patient?.fullName, p.services, p.doctorName, p.byName].some((x) => (x ?? '').toLowerCase().includes(q))) : [];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Daily summary' }]}
        title="Daily collection"
        tabs={billingTabs(activeMembership.roles)}
        actions={
          d && (
            <>
              {seesExport && (
                <button type="button" className="btn btn-secondary" onClick={downloadExcel} disabled={excel.busy}>
                  <Download aria-hidden="true" /> {excel.busy ? 'Preparing…' : 'Download Excel'}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> Print or download PDF
              </button>
            </>
          )
        }
      />
      <div className="pf-content dc-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        {excel.error && <Alert type="error">{excel.error}</Alert>}
        {day && (
          <div className="card dc-daybar">
            <div className="appt-daynav" role="group" aria-label="Day">
              <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, -1))} aria-label="Previous day">
                <ChevronLeft aria-hidden="true" />
              </button>
              <input type="date" aria-label="Day" value={day} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, 1))} aria-label="Next day" disabled={day >= today}>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <strong className="dc-dayname">{dayLabel(day)}</strong>
            {day !== today && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => go(today)}>
                Back to today
              </button>
            )}
          </div>
        )}
        {d && (
          <>
            <div className="kpi-grid dc-kpis">
              <KpiCard tone="stable" icon={Banknote} label="Collected" value={rupees(f.collected)} sub={`${d.payments.filter((p) => p.kind !== 'refund').length} receipts`} />
              <KpiCard tone="watch" icon={RotateCcw} label="Given back" value={rupees(f.givenBack)} sub="Refunds" />
              <KpiCard tone="high" icon={HandCoins} label="Expenses" value={rupees(f.expenses)} sub={`${(d.expenses ?? []).filter((e) => !e.cancelled).length} entered`} />
              <KpiCard tone="brand" icon={Wallet} label="Balance" value={rupees(f.balance)} sub="Collected − given back − expenses" />
              <KpiCard tone="due" icon={ReceiptText} label="Cash in the drawer" value={rupees(f.cashInHand)} sub="Cash only, after cash expenses" />
            </div>

            <div className="dc-grid">
              <section className="card dc-section" aria-labelledby="dc-money">
                <h2 id="dc-money">Money</h2>
                <ModeTable d={d} />
                <KindTable d={d} />
              </section>

              <section className="card dc-section" aria-labelledby="dc-exp">
                <div className="dc-section-head">
                  <h2 id="dc-exp">Expenses</h2>
                  <StatusPill tone={f.expenses ? 'high' : 'neutral'} icon={HandCoins}>
                    {f.expenses ? `−${rupees(f.expenses)}` : 'None'}
                  </StatusPill>
                </div>
                <p className="hint">Money paid out from the counter today – it is taken off the day's balance.</p>
                <ExpenseForm date={day} onAdded={reload} />
                <ExpensesTable expenses={d.expenses ?? []} onCancel={setCancelling} />
              </section>

              <section className="card dc-section" aria-labelledby="dc-people">
                <h2 id="dc-people">People and services</h2>
                <SmallTables d={d} />
              </section>
            </div>

            <section className="card dc-section" aria-labelledby="dc-receipts">
              <div className="dc-section-head">
                <h2 id="dc-receipts">Every receipt</h2>
                <label className="dc-search">
                  <Search aria-hidden="true" />
                  <span className="sr-only">Find a receipt</span>
                  <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Receipt, bill, patient, doctor…" />
                </label>
              </div>
              <div className="table-scroll">
                <ReceiptsTable payments={shown} />
              </div>
            </section>
          </>
        )}
      </div>

      {cancelling && (
        <CancelExpenseDialog
          expense={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      )}

      {printing && d && (
        <PrintPreview
          title="Daily collection – print preview"
          hint="Print it to hand over the cash at the end of the day, or save it as a PDF."
          pdf={{ fileName: `Daily collection ${d.date}.pdf`, title: `Daily collection ${d.date}`, share: false, onSaved: () => api('/billing/reports/daily/saved', { method: 'POST', body: { date: d.date } }) }}
          docKey={lh.data ? `${d.date}-${version}` : null}
          pageNumbers
          onClose={() => setPrinting(false)}
        >
          <PrintDocument className="bill-doc bill-daily-doc">
            {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} centered />}
            <div className="bill-doc-titlebar">
              <h1 className="pdoc-title">Daily collection – {dayLabel(d.date)}</h1>
              <span className="pdoc-small">Print date {formatDateTime(new Date())}</span>
            </div>
            <table className="dc-print-sums">
              <tbody>
                <tr>
                  <th scope="row">Collected</th>
                  <td>{rupees(f.collected)}</td>
                  <th scope="row">Given back</th>
                  <td>−{rupees(f.givenBack)}</td>
                </tr>
                <tr>
                  <th scope="row">Expenses</th>
                  <td>−{rupees(f.expenses)}</td>
                  <th scope="row">Balance</th>
                  <td>
                    <strong>{rupees(f.balance)}</strong>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Cash in the drawer</th>
                  <td>{rupees(f.cashInHand)}</td>
                  <th scope="row">In words</th>
                  <td>{amountInWords(Math.max(0, f.balance))}</td>
                </tr>
              </tbody>
            </table>
            <ModeTable d={d} />
            <KindTable d={d} />
            {(d.expenses ?? []).length > 0 && <ExpensesTable expenses={d.expenses} />}
            <SmallTables d={d} />
            {d.payments.length > 0 && <ReceiptsTable payments={d.payments} />}
            <p className="bill-sign">Handed over by: ____________________ &nbsp; Received by: ____________________</p>
          </PrintDocument>
        </PrintPreview>
      )}
    </>
  );
}

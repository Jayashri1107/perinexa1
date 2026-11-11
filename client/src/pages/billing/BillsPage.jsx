import { useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, CircleCheck, FilePlus2, FileText, Phone, RotateCcw, Search, Stethoscope, Wallet } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, useDebounced, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { addDaysIso, dayLabel } from '../appointments/appointmentFormat.js';
import { KIND_LABELS, MODE_LABELS, PAYMENT_KIND_LABELS, STATUS_LOOK, billingTabs, rupees, takeMoneyLabel } from './billingFormat.js';
import { Tile } from './billingUi.jsx';

// Billing → Bills (docs/BILLING_PLAN.md): a day's bills (outpatient bills of the day, and stays still open), or the
// bills matching a search (name, phone, patient or bill number). "New bill" opens today's bill for a patient (e.g. a
// scan with no visit). Charges from visits, lab orders and stays appear by themselves.

export function BillStatus({ status }) {
  const look = STATUS_LOOK[status];
  if (!look) return null;
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.label}
    </StatusPill>
  );
}

export const billColumns = ({ showPatient = true } = {}) => [
  { key: 'number', header: 'Bill', render: (b) => <span className="tabular">{b.number}</span> },
  { key: 'date', header: 'Date', render: (b) => dayLabel(b.date) },
  ...(showPatient ? [{ key: 'patient', header: 'Patient', render: (b) => (b.patient ? <span>{b.patient.fullName} <span className="muted tabular">{b.patient.mrn}</span></span> : '') }] : []),
  { key: 'kind', header: 'Type', render: (b) => `${KIND_LABELS[b.kind]}${b.stay?.inHospital ? ' (in hospital)' : ''}` },
  { key: 'total', header: 'Total', align: 'right', render: (b) => <span className="tabular">{rupees(b.total)}</span> },
  { key: 'paid', header: 'Paid', align: 'right', render: (b) => <span className="tabular">{rupees(b.paid)}</span> },
  { key: 'balance', header: 'Balance', align: 'right', render: (b) => <strong className="tabular">{rupees(b.balance)}</strong> },
  { key: 'status', header: 'Status', render: (b) => <BillStatus status={b.status} /> },
  // The latest money in or out: when, and how (owner, 13 Oct 2026)
  {
    key: 'lastPayment',
    header: 'Last payment',
    render: (b) =>
      b.lastPayment ? (
        <span className="bill-last">
          <span className="tabular">{formatDateTime(b.lastPayment.at)}</span>
          <span className="muted">
            {MODE_LABELS[b.lastPayment.mode] ?? b.lastPayment.mode}
            {b.lastPayment.kind !== 'payment' ? ` · ${PAYMENT_KIND_LABELS[b.lastPayment.kind]}` : ''}
          </span>
        </span>
      ) : (
        <span className="muted">None yet</span>
      ),
  },
  // Take the money straight from the list: opens the bill with its payment box
  {
    key: 'actions',
    header: <span className="sr-only">Actions</span>,
    render: (b) =>
      b.status !== 'cancelled' && b.balance > 0 ? (
        <Link to={`/billing/bills/${b.id}?pay=1`} className="btn btn-secondary btn-sm bill-pay" onClick={(e) => e.stopPropagation()}>
          <Wallet aria-hidden="true" /> {takeMoneyLabel(b)}
          <span className="sr-only"> for bill {b.number}</span>
        </Link>
      ) : null,
  },
];

// The statuses to show (the tiles above the list choose OPD, IPD, to collect, to give back)
const STATUS_FILTERS = [
  ['', 'Any status'],
  ['unpaid', 'Unpaid'],
  ['part_paid', 'Part paid'],
  ['paid', 'Paid'],
  ['refund_due', 'Money to give back'],
  ['cancelled', 'Cancelled'],
];

function NewBillDialog({ onClose, onOpened }) {
  const ref = useDialogFocus(onClose);
  const [error, setError] = useState(null);
  const open = async (p) => {
    setError(null);
    try {
      const { bill } = await api('/billing/bills', { method: 'POST', body: { patientId: p.id } });
      onOpened(bill);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="nb-title">
        <h2 id="nb-title">New bill</h2>
        <p>Opens the patient's bill for today (or her stay's bill while she is in hospital), to add items such as a scan.</p>
        <Alert type="error">{error}</Alert>
        <PatientFinder onPick={open} />
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// The page as the IPD and Unpaid lists (11 Nov 2026): number tiles for the day (or the search) that filter the list –
// all bills, OPD, IPD, still to collect, to give back – one toolbar (search, the day, the status), and one row per
// bill: the patient (her phone to call), the bill, the money, its status with the last payment, and the next step.
const VIEWS = {
  '': { title: 'All bills', match: () => true },
  opd: { title: 'OPD bills', match: (b) => b.kind === 'opd' },
  ipd: { title: 'IPD bills', match: (b) => b.kind === 'ipd' },
  due: { title: 'Still to collect', match: (b) => b.status !== 'cancelled' && b.balance > 0 },
  back: { title: 'Money to give back', match: (b) => b.status !== 'cancelled' && b.balance < 0 },
};

/** "11 Nov 2026" from "2026-11-11". */
const shortDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

export function BillsPage() {
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const list = useFetch('/billing/bills', search.length >= 2 ? { search } : { date });
  const [creating, setCreating] = useState(() => params.get('new') === '1'); // ?new=1: from Today's "New bill"
  const day = list.data?.date ?? date;
  const today = list.data?.today;
  const searching = search.length >= 2;
  const go = (d) => {
    const next = new URLSearchParams(params);
    if (d && d !== today) next.set('date', d);
    else next.delete('date');
    setParams(next, { replace: true });
  };
  // ?view= (the tiles; ?kind= of older links still works) and ?status= (the list of statuses)
  const view = Object.hasOwn(VIEWS, params.get('view') ?? '') ? (params.get('view') ?? '') : Object.hasOwn(VIEWS, params.get('kind') ?? '') ? (params.get('kind') ?? '') : '';
  const status = STATUS_FILTERS.some(([k]) => k && k === params.get('status')) ? params.get('status') : '';
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    next.delete('kind');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const all = list.data?.bills ?? [];
  const live = all.filter((b) => b.status !== 'cancelled');
  const count = (key) => all.filter(VIEWS[key].match).length;
  const sum = (list2, pick) => list2.reduce((s, b) => s + pick(b), 0);
  const rows = all.filter((b) => VIEWS[view].match(b) && (!status || b.status === status));
  const tile = (key, label, value, tone, icon) => (
    <Tile label={`${label} · ${count(key)}`} value={value} tone={count(key) && key !== '' ? tone : 'neutral'} icon={icon} pressed={view === key} onClick={() => setFilter('view', key)} />
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing' }]}
        className="ph-fab"
        title="Billing"
        subtitle={searching ? `Bills matching "${search}"` : day ? dayLabel(day) : undefined}
        tabs={billingTabs(activeMembership.roles)}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <FilePlus2 aria-hidden="true" /> New bill
          </button>
        }
      />
      <div className="pf-content ipd-list-page bills-page">
        <Alert type="error">{list.error}</Alert>
        <div className="ipd-tiles" aria-label={searching ? 'The bills found' : 'The bills of this day'}>
          {tile('', 'Bills', rupees(sum(live, (b) => b.total)), 'neutral', FileText)}
          {tile('opd', 'OPD', rupees(sum(live.filter(VIEWS.opd.match), (b) => b.total)), 'neutral', Stethoscope)}
          {tile('ipd', 'IPD', rupees(sum(live.filter(VIEWS.ipd.match), (b) => b.total)), 'neutral', BedDouble)}
          <Tile label="Collected" value={rupees(sum(live, (b) => b.paid))} tone="stable" icon={CircleCheck} />
          {tile('due', 'To collect', rupees(sum(all.filter(VIEWS.due.match), (b) => b.balance)), 'watch', Wallet)}
          {tile('back', 'To give back', rupees(sum(all.filter(VIEWS.back.match), (b) => -b.balance)), 'due', RotateCcw)}
        </div>

        <section className="card ipd-list-card" aria-labelledby="bills-title">
          <div className="ipd-list-head bills-head">
            <h2 id="bills-title">
              {VIEWS[view].title}
              {searching ? '' : day ? <span className="muted"> · {shortDay(day)}</span> : null}
            </h2>
            <div className="bills-tools">
              <div className="ipd-search" role="search">
                <label htmlFor="bills-q" className="sr-only">
                  Find a bill by name, phone, patient or bill number
                </label>
                <span className="ipd-search-box">
                  <Search aria-hidden="true" />
                  <input id="bills-q" type="search" placeholder="Name, phone, UHID or bill no." value={text} maxLength={60} onChange={(e) => setText(e.target.value)} />
                </span>
              </div>
              {!searching && day && (
                <div className="appt-daynav bills-daynav" role="group" aria-label="Day">
                  <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, -1))} aria-label="Previous day">
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <input type="date" aria-label="Day" value={day} onChange={(e) => e.target.value && go(e.target.value)} />
                  <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, 1))} aria-label="Next day">
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(today)} disabled={day === today}>
                    Today
                  </button>
                </div>
              )}
              <label className="bill-filter">
                <span className="sr-only">Status</span>
                <select value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
                  {STATUS_FILTERS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {list.loading && !list.data ? (
            <p className="muted" aria-busy="true">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="muted ipd-empty">
              {view || status ? (
                <>
                  No bills match these filters.{' '}
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setParams(date ? { date } : {}, { replace: true })}>
                    Show all bills
                  </button>
                </>
              ) : searching ? (
                'No bills match this search.'
              ) : (
                'No bills on this day. Bills appear here when a visit, lab test or stay is charged, or with New bill.'
              )}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="bill-report ipd-table bills-table">
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
                    <th scope="col" className="ipd-act-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className={b.status === 'cancelled' ? 'bill-row-cancelled' : undefined}>
                      <td className="ipd-who">
                        <Link className="ipd-name" to={`/billing/bills/${b.id}`}>
                          {b.patient?.fullName ?? '–'}
                        </Link>
                        <span className="ipd-sub tabular">
                          {b.patient?.mrn}
                          {b.patient?.phone && (
                            <>
                              {' · '}
                              <a href={`tel:${b.patient.phone.replace(/\s+/g, '')}`} className="unpaid-phone">
                                <Phone aria-hidden="true" /> {b.patient.phone}
                              </a>
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        <Link to={`/billing/bills/${b.id}`} className="tabular bills-number">
                          {b.number}
                        </Link>
                        <span className="ipd-sub">
                          {b.kind === 'ipd' ? (b.stay?.inHospital ? 'IPD, in hospital' : 'IPD') : 'OPD'} · {shortDay(b.date)}
                        </span>
                      </td>
                      <td className="num tabular">{rupees(b.total)}</td>
                      <td className="num tabular">{rupees(b.paid)}</td>
                      <td className="num tabular">
                        <strong>{b.balance < 0 ? `−${rupees(-b.balance)}` : rupees(b.balance)}</strong>
                        {b.insuranceDue > 0 && <span className="ipd-sub">insurance {rupees(b.insuranceDue)}</span>}
                      </td>
                      <td>
                        <BillStatus status={b.status} />
                        <span className="ipd-sub">
                          {b.lastPayment
                            ? `${formatDateTime(b.lastPayment.at)} · ${MODE_LABELS[b.lastPayment.mode] ?? b.lastPayment.mode}${b.lastPayment.kind !== 'payment' ? ` ${PAYMENT_KIND_LABELS[b.lastPayment.kind].toLowerCase()}` : ''}`
                            : 'Nothing paid yet'}
                        </span>
                      </td>
                      <td className="ipd-act-col">
                        {b.status !== 'cancelled' && b.balance > 0 ? (
                          <Link to={`/billing/bills/${b.id}?pay=1`} className="btn btn-secondary btn-sm">
                            <Wallet aria-hidden="true" /> {takeMoneyLabel(b)}
                            <span className="sr-only"> for bill {b.number}</span>
                          </Link>
                        ) : b.status !== 'cancelled' && b.balance < 0 ? (
                          <Link to={`/billing/bills/${b.id}`} className="btn btn-secondary btn-sm">
                            <RotateCcw aria-hidden="true" /> Give back
                            <span className="sr-only"> for bill {b.number}</span>
                          </Link>
                        ) : (
                          <Link to={`/billing/bills/${b.id}`} className="btn btn-link btn-sm">
                            Open<span className="sr-only"> bill {b.number}</span>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {creating && <NewBillDialog onClose={() => setCreating(false)} onOpened={(b) => navigate(`/billing/bills/${b.id}`)} />}
    </>
  );
}

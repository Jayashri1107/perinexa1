import { useState } from 'react';
import { ChevronLeft, ChevronRight, FilePlus2, Search, Wallet } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, useDebounced, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { addDaysIso, dayLabel } from '../appointments/appointmentFormat.js';
import { KIND_LABELS, MODE_LABELS, PAYMENT_KIND_LABELS, STATUS_LOOK, billingTabs, rupees, takeMoneyLabel } from './billingFormat.js';

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

// Quick filters on the list: the type of bill and where its money stands
const KIND_FILTERS = [
  ['', 'All bills'],
  ['opd', 'Outpatient (OPD)'],
  ['ipd', 'Inpatient (IPD)'],
];
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
  const go = (d) => {
    const next = new URLSearchParams(params);
    if (d && d !== today) next.set('date', d);
    else next.delete('date');
    setParams(next, { replace: true });
  };
  const kind = KIND_FILTERS.some(([k]) => k && k === params.get('kind')) ? params.get('kind') : '';
  const status = STATUS_FILTERS.some(([k]) => k && k === params.get('status')) ? params.get('status') : '';
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const all = list.data?.bills;
  const rows = all?.filter((b) => (!kind || b.kind === kind) && (!status || b.status === status));
  const owed = (rows ?? []).filter((b) => b.status !== 'cancelled' && b.balance > 0).reduce((s, b) => s + b.balance, 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing' }]}
        title="Billing"
        subtitle={search.length >= 2 ? `Bills matching "${search}"` : day ? dayLabel(day) : undefined}
        tabs={billingTabs(activeMembership.roles)}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <FilePlus2 aria-hidden="true" /> New bill
          </button>
        }
      />
      <div className="pf-content bill-page">
        {list.error && <Alert type="error">{list.error}</Alert>}
        <DataTable
          caption="Bills"
          columns={billColumns()}
          rows={rows}
          loading={list.loading}
          onRowClick={(b) => navigate(`/billing/bills/${b.id}`)}
          rowClassName={(b) => (b.status === 'cancelled' ? 'bill-row-cancelled' : '')}
          emptyText={
            kind || status ? (
              <span>
                No bills match these filters.{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setParams(date ? { date } : {}, { replace: true })}>
                  Show all bills
                </button>
              </span>
            ) : search.length >= 2 ? (
              'No bills match.'
            ) : (
              'No bills on this day. Bills appear here when a visit, lab test or stay is charged, or with "New bill".'
            )
          }
          toolbar={
            <div className="bill-toolbar">
              <label className="bill-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Find a bill</span>
                <input type="search" placeholder="Name, phone, patient or bill number" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {search.length < 2 && day && (
                <div className="appt-daynav" role="group" aria-label="Day">
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
                <span>Type</span>
                <select value={kind} onChange={(e) => setFilter('kind', e.target.value)}>
                  {KIND_FILTERS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bill-filter">
                <span>Status</span>
                <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
                  {STATUS_FILTERS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {rows && owed > 0 && <span className="muted">Still to collect on this list: {rupees(owed)}</span>}
            </div>
          }
        />
      </div>
      {creating && <NewBillDialog onClose={() => setCreating(false)} onOpened={(b) => navigate(`/billing/bills/${b.id}`)} />}
    </>
  );
}

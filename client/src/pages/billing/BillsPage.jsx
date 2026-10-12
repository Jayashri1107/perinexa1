import { useState } from 'react';
import { ChevronLeft, ChevronRight, FilePlus2, Search } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, useDebounced, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { addDaysIso, dayLabel } from '../appointments/appointmentFormat.js';
import { KIND_LABELS, STATUS_LOOK, billingTabs, rupees } from './billingFormat.js';

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
  const [creating, setCreating] = useState(false);
  const day = list.data?.date ?? date;
  const today = list.data?.today;
  const go = (d) => setParams(d && d !== today ? { date: d } : {}, { replace: true });
  const rows = list.data?.bills;
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
          emptyText={search.length >= 2 ? 'No bills match.' : 'No bills on this day.'}
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
              {rows && owed > 0 && <span className="muted">Still to collect on this list: {rupees(owed)}</span>}
            </div>
          }
        />
      </div>
      {creating && <NewBillDialog onClose={() => setCreating(false)} onOpened={(b) => navigate(`/billing/bills/${b.id}`)} />}
    </>
  );
}

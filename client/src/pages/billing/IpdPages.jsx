import { useEffect, useState } from 'react';
import { BadgePercent, Ban, BedDouble, ClipboardCheck, DoorOpen, FileCheck, FileClock, LockOpen, Plus, Printer, Search, Trash2, Wallet, X } from 'lucide-react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { ClearDialog, StayPaper } from '../beds/AdmissionDesk.jsx';
import { AddItemDialog, DiscountDialog, PaymentDialog, ReasonDialog } from './BillPage.jsx';
import { BillStatus } from './BillsPage.jsx';
import { amountInWords } from './amountWords.js';
import { HeadedBillLines, RemoveTickedDialog, ServiceEntryRow } from './ServiceEntry.jsx';
import { MODE_LABELS, NO_SEX_WORDS_HINT, PAYMENT_KIND_LABELS, billingTabs, rupees, toInput, toPaise } from './billingFormat.js';
import { InlineForms, Modal, Tile, useSend } from './billingUi.jsx';
import { BILL_LAYOUTS, adminChargeOf, advanceTotal, billTitle, linesByDate, stayStep, summaryByGroup } from './ipdFormat.js';

// Billing → IPD (docs/IPD_DISCHARGE_BILLING_PLAN.md, 9 Nov 2026), like the hospital's old HIMS: the patients in hospital
// (or discharged in the last 30 days), and one stay's bill window – her details and the bill's sums on the left; the
// services, advances, her other bills, bed transfers and a summary in tabs; the print layout, administrative charges and
// the concession at the foot. The order is the HIMS's: the doctor's discharge card → the discharge details here → the
// final bill → settlement → clearance and the gate pass.

const STEP_LOOK = (stay, bill) => {
  const s = stayStep(stay, bill);
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusPill>
  );
};

// ---------- The lists ----------

// The IPD desk's two lists, like the HIMS's IPD menu: patients in hospital (advance, services) and the discharges
export const IPD_SUBTABS = [
  { label: 'In hospital', to: '/billing/ipd', end: true },
  { label: 'Discharge', to: '/billing/ipd/discharges', end: true },
];

function SearchBox({ onSearch, label = 'Name, UHID or IPD number' }) {
  const [typed, setTyped] = useState('');
  return (
    <form
      className="ipd-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(typed.trim());
      }}
    >
      <label htmlFor="ipd-q" className="sr-only">
        {label}
      </label>
      <span className="ipd-search-box">
        <Search aria-hidden="true" />
        <input id="ipd-q" type="search" placeholder={label} value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} />
      </span>
      <button type="submit" className="btn btn-secondary">
        Search
      </button>
    </form>
  );
}

// ---------- Cells shared by the two lists ----------

/** The IPD bill page of a stay, opened on a step (do) and with the list it came from (back link). */
const billPath = (id, step, from) => {
  const q = new URLSearchParams();
  if (step) q.set('do', step);
  if (from) q.set('from', from);
  const text = q.toString();
  return `/billing/ipd/${id}${text ? `?${text}` : ''}`;
};

/** Her name (opens the bill page) with UHID and IPD number under it. */
function WhoCell({ s, from }) {
  return (
    <td className="ipd-who">
      <Link className="ipd-name" to={billPath(s.id, null, from)} title="Open the IPD bill">
        {s.patient.fullName}
      </Link>
      <span className="ipd-sub tabular">
        {s.patient.mrn}
        {s.ipdNo ? ` · ${s.ipdNo}` : ''}
      </span>
    </td>
  );
}
/** A date on one line, its time under it. */
function WhenCell({ at }) {
  if (!at) return <td>–</td>;
  const text = formatDateTime(at);
  const [day, time] = text.split(', ');
  return (
    <td className="ipd-when">
      <span>{day}</span>
      {time && <span className="ipd-sub">{time}</span>}
    </td>
  );
}
function PlaceCell({ s }) {
  return (
    <td className="ipd-place">
      <span>{s.ward || '–'}</span>
      {s.bed && <span className="ipd-sub">Bed {s.bed}</span>}
    </td>
  );
}
/** "DAMA (discharge against medical advice)" → "DAMA" in the list; the full words on hover. */
const shortType = (label) => (label ? label.split(' (')[0] : '');

const Loading = () => (
  <p className="muted" aria-busy="true">
    Loading…
  </p>
);

export function IpdStaysPage() {
  const FROM = 'ipd';
  const { activeMembership } = useAuth();
  const [q, setQ] = useState('');
  const res = useFetch('/billing/ipd/stays', { status: 'admitted', q });
  const stays = res.data?.stays ?? [];
  const sum = (k) => stays.reduce((t, s) => t + (s.bill?.[k] ?? 0), 0);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'IPD bills' }]}
        title="IPD bills"
        subtitle="Patients in hospital: take an advance, add services, print the interim bill."
        tabs={billingTabs(activeMembership.roles)}
        subtabs={IPD_SUBTABS}
      />
      <div className="pf-content ipd-list-page">
        <div className="ipd-tiles" aria-label="In hospital now">
          <Tile label="In hospital" value={stays.length} icon={BedDouble} />
          <Tile label="Net bill" value={rupees(sum('total'))} />
          <Tile label="Advance taken" value={rupees(sum('paid'))} />
          <Tile label="Balance due" value={rupees(Math.max(0, sum('balance')))} tone={sum('balance') > 0 ? 'watch' : 'neutral'} />
        </div>
        <section className="card ipd-list-card" aria-labelledby="ipd-list-title">
          <div className="ipd-list-head">
            <h2 id="ipd-list-title">In hospital</h2>
            <SearchBox onSearch={setQ} />
          </div>
          <Alert type="error">{res.error}</Alert>
          {res.loading && !res.data ? (
            <Loading />
          ) : stays.length === 0 ? (
            <p className="muted ipd-empty">{q ? 'No patient matches this search.' : 'No patient is in hospital.'}</p>
          ) : (
            <div className="table-scroll">
              <table className="bill-report ipd-table">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Admitted</th>
                    <th scope="col">Ward / bed</th>
                    <th scope="col">Doctor</th>
                    <th scope="col" className="num">
                      Net bill
                    </th>
                    <th scope="col" className="num">
                      Advance
                    </th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                    <th scope="col" className="ipd-act-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stays.map((s) => (
                    <tr key={s.id}>
                      <WhoCell s={s} from={FROM} />
                      <WhenCell at={s.admittedAt} />
                      <PlaceCell s={s} />
                      <td className="ipd-doc-cell">{s.doctorName || '–'}</td>
                      <td className="num tabular">{s.bill ? rupees(s.bill.total) : '–'}</td>
                      <td className="num tabular">{s.bill ? rupees(s.bill.paid) : '–'}</td>
                      <td className="num tabular">
                        <strong>{s.bill ? rupees(s.bill.balance) : '–'}</strong>
                      </td>
                      <td className="ipd-act-col">
                        <span className="ipd-row-actions">
                          <Link className="btn btn-secondary btn-sm" to={billPath(s.id, 'advance', FROM)} aria-label={`IPD advance for ${s.patient.fullName}`}>
                            <Wallet aria-hidden="true" /> Advance
                          </Link>
                          <Link className="btn btn-secondary btn-sm" to={billPath(s.id, 'add', FROM)} aria-label={`Add services for ${s.patient.fullName}`}>
                            <Plus aria-hidden="true" /> Services
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// The Discharge list's steps (server: routes/ipdBilling.js DISCHARGE_STEPS), each with its look
const DISCHARGE_FILTERS = [
  { key: 'record', label: 'To record', tone: 'watch', icon: ClipboardCheck },
  { key: 'final_due', label: 'Final bill due', tone: 'watch', icon: FileClock },
  { key: 'to_clear', label: 'To clear', tone: 'due', icon: FileCheck },
  { key: 'cleared', label: 'Cleared', tone: 'stable', icon: DoorOpen },
];
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
};

/**
 * IPD → Discharge (owner, 9 Nov 2026), like the HIMS's Discharge menu: every discharge (the doctor has signed the card)
 * in the chosen days, by step – to record at the desk, final bill due, to clear, cleared. Each row opens the bill
 * window over the list, straight on the step to do: Patient discharge, Final bill or Discharge clearance.
 */
export function IpdDischargesPage() {
  const FROM = 'discharges';
  const { activeMembership } = useAuth();
  const [q, setQ] = useState('');
  const [step, setStep] = useState('');
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => isoOf(new Date()));
  const res = useFetch('/billing/ipd/stays', { status: 'discharged', q, from, to, ...(step ? { step } : {}) });
  const stays = res.data?.stays ?? [];
  const counts = res.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const action = (s) => {
    if (s.step === 'record') return { label: 'Discharge', icon: DoorOpen, dialog: 'discharge' };
    if (s.step === 'final_due') return { label: 'Final bill', icon: FileCheck, dialog: 'final' };
    if (s.step === 'to_clear') return s.bill?.balance > 0 ? { label: 'Payment', icon: Wallet, dialog: 'advance' } : { label: 'Clearance', icon: DoorOpen, dialog: 'clear' };
    return null;
  };
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'IPD bills', to: '/billing/ipd' }, { label: 'Discharge' }]}
        title="Discharge"
        subtitle="Record the discharge, make the final bill, take the balance and clear her for leaving."
        tabs={billingTabs(activeMembership.roles)}
        subtabs={IPD_SUBTABS}
      />
      <div className="pf-content ipd-list-page">
        <div className="ipd-tiles" role="group" aria-label="Show the discharges at this step">
          <Tile label="All discharges" value={total} pressed={step === ''} onClick={() => setStep('')} />
          {DISCHARGE_FILTERS.map((f) => (
            <Tile key={f.key} label={f.label} value={counts[f.key] ?? 0} tone={f.tone} icon={f.icon} pressed={step === f.key} onClick={() => setStep(step === f.key ? '' : f.key)} />
          ))}
        </div>
        <section className="card ipd-list-card" aria-labelledby="ipd-dis-title">
          <div className="ipd-list-head ipd-list-head-stack">
            <h2 id="ipd-dis-title">{step ? DISCHARGE_FILTERS.find((f) => f.key === step)?.label : 'All discharges'}</h2>
            <div className="ipd-list-filters">
              <label className="ipd-date">
                From <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </label>
              <label className="ipd-date">
                To <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
              </label>
              <SearchBox onSearch={setQ} />
            </div>
          </div>
          <Alert type="error">{res.error}</Alert>
          {res.loading && !res.data ? (
            <Loading />
          ) : stays.length === 0 ? (
            <p className="muted ipd-empty">{q ? 'No discharge matches this search.' : 'No discharge in these days.'}</p>
          ) : (
            <div className="table-scroll">
              <table className="bill-report ipd-table">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Discharged</th>
                    <th scope="col">Ward / bed</th>
                    <th scope="col">Doctor</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">
                      Net bill
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
                  {stays.map((s) => {
                    const a = action(s);
                    return (
                      <tr key={s.id}>
                        <WhoCell s={s} from={FROM} />
                        <WhenCell at={s.dischargedAt} />
                        <PlaceCell s={s} />
                        <td className="ipd-doc-cell">{s.doctorName || '–'}</td>
                        <td title={s.discharge?.label}>{s.discharge ? shortType(s.discharge.label) : <span className="muted">Not recorded</span>}</td>
                        <td className="num tabular">{s.bill ? rupees(s.bill.total) : '–'}</td>
                        <td className="num tabular">
                          <strong>{s.bill ? rupees(s.bill.balance) : '–'}</strong>
                        </td>
                        <td>{STEP_LOOK(s, s.bill)}</td>
                        <td className="ipd-act-col">
                          <span className="ipd-row-actions">
                            {a && (
                              <Link className="btn btn-secondary btn-sm" to={billPath(s.id, a.dialog, FROM)} aria-label={`${a.label} for ${s.patient.fullName}`}>
                                <a.icon aria-hidden="true" /> {a.label}
                              </Link>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/** Her record's IPD tab for reception and billing (owner, 9 Nov 2026): the bill window of her stay, a choice when there are several. */
export function PatientIpdBillRoute() {
  const { patient } = useOutletContext();
  const { activeMembership } = useAuth();
  if (!(activeMembership?.roles ?? []).some((r) => ['receptionist', 'billing', 'admin'].includes(r))) return <div className="card">The IPD bill is for reception, the billing department and the hospital admin.</div>;
  return <PatientIpdBillTab patientId={patient.id} />;
}

export function PatientIpdBillTab({ patientId }) {
  const res = useFetch('/billing/ipd/stays', { status: 'all', patientId });
  const stays = res.data?.stays ?? [];
  const [chosen, setChosen] = useState(null);
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!res.data) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!stays.length) return <div className="card">No stay in hospital yet.</div>;
  const id = chosen ?? stays[0].id;
  return (
    <div className="ipd-patient-tab">
      {stays.length > 1 && (
        <label className="ipd-stay-choice">
          Stay{' '}
          <select value={id} onChange={(e) => setChosen(e.target.value)}>
            {stays.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.ipdNo, `admitted ${formatDateTime(s.admittedAt)}`, s.status === 'admitted' ? 'in hospital' : `discharged ${formatDateTime(s.dischargedAt)}`].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </label>
      )}
      <IpdBillWindow key={id} stayId={id} embedded onChanged={res.reload} />
    </div>
  );
}

// ---------- The discharge form ----------

function DischargeDialog({ data, onClose, onDone }) {
  const { stay, patient } = data;
  const current = stay.discharge;
  const signer = data.doctors.find((d) => d.name === (current?.doctorName || stay.dischargedByName));
  const [type, setType] = useState(current && current.type !== 'closed' ? current.type : '');
  const [doctorId, setDoctorId] = useState(signer?.id ?? '');
  const [remark, setRemark] = useState(current?.remark ?? '');
  const s = useSend(onDone);
  const ready = patient.closed || type;
  return (
    <Modal id="ipd-discharge" title="Discharge" wide onClose={onClose}>
      <dl className="ipd-facts">
        <div>
          <dt>UHID</dt>
          <dd className="tabular">{patient.mrn}</dd>
        </div>
        <div>
          <dt>Patient</dt>
          <dd>{patient.fullName}</dd>
        </div>
        <div>
          <dt>Doctor</dt>
          <dd>{stay.doctorName || '–'}</dd>
        </div>
        <div>
          <dt>Admitted on</dt>
          <dd>{formatDateTime(stay.admittedAt)}</dd>
        </div>
        <div>
          <dt>Ward / bed</dt>
          <dd>{[stay.ward, stay.bed].filter(Boolean).join(' · ') || '–'}</dd>
        </div>
        <div>
          <dt>Discharged on</dt>
          <dd>
            {formatDateTime(stay.dischargedAt)}
            <span className="muted"> – from the discharge card{stay.dischargedByName ? ` signed by ${stay.dischargedByName}` : ''}</span>
          </dd>
        </div>
      </dl>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        {patient.closed ? (
          <Field label="Discharge type" id="ipd-dis-type">
            <input id="ipd-dis-type" value="Record closed – the type is taken from her record" readOnly />
          </Field>
        ) : (
          <Field label="Discharge type" id="ipd-dis-type" error={s.fields.type}>
            <select id="ipd-dis-type" value={type} onChange={(e) => setType(e.target.value)} autoFocus>
              <option value="">Choose…</option>
              {data.dischargeTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Discharging doctor" id="ipd-dis-doctor" error={s.fields.doctorId}>
          <select id="ipd-dis-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">{stay.dischargedByName ? `${stay.dischargedByName} (signed the card)` : 'Not recorded'}</option>
            {data.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Remark (optional)" id="ipd-dis-remark" error={s.fields.remark} hint={NO_SEX_WORDS_HINT}>
        <input id="ipd-dis-remark" value={remark} maxLength={300} onChange={(e) => setRemark(e.target.value)} />
      </Field>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || s.busy}
          onClick={() => s.send(`/billing/ipd/stays/${stay.id}/discharge`, { ...(patient.closed ? {} : { type }), doctorId: doctorId || null, remark: remark.trim() }, () => 'Discharge recorded. Check the items, then make the final bill.')}
        >
          <DoorOpen aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save the discharge'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function AdminChargeDialog({ bill, onClose, onDone }) {
  const [amount, setAmount] = useState(toInput(adminChargeOf(bill.lines)));
  const s = useSend(onDone);
  const paise = toPaise(amount || '0');
  return (
    <Modal id="ipd-admin" title="Administrative charges" onClose={onClose}>
      <p>One line on the bill. Enter 0 to take it off; a changed amount keeps the old line as taken off.</p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Amount (₹)" id="ipd-admin-amount" error={s.fields.amountPaise}>
        <input id="ipd-admin-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={paise == null || s.busy} onClick={() => s.send(`/billing/ipd/bills/${bill.id}/admin-charge`, { amountPaise: paise }, () => 'Administrative charges saved.', 'PUT')}>
          {s.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function FinalDialog({ bill, onClose, onDone }) {
  const s = useSend(onDone);
  return (
    <Modal id="ipd-final" title="Make the final bill" onClose={onClose}>
      <p>
        Net payable {rupees(bill.total)}, paid {rupees(bill.paid)}, {bill.balance < 0 ? `due back ${rupees(-bill.balance)}` : `balance ${rupees(bill.balance)}`}. After this, items can no longer be added or taken off. Payments,
        refunds and the concession still can.
      </p>
      <Alert type="error">{s.error}</Alert>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy} onClick={() => s.send(`/billing/ipd/bills/${bill.id}/final`, {}, () => 'Final bill made.')}>
          <FileCheck aria-hidden="true" /> {s.busy ? 'Saving…' : 'Make the final bill'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ---------- The bill window ----------

const TABS = [
  { key: 'services', label: 'Services' },
  { key: 'advance', label: 'Advance list' },
  { key: 'previous', label: 'Previous bills' },
  { key: 'moves', label: 'Bed transfers' },
  { key: 'summary', label: 'Summary' },
];

// The steps a list may open the page on (?do=), and the list it came from (?from=) for the way back
const PAGE_STEPS = ['advance', 'add', 'discharge', 'final', 'clear'];
const BACK_TO = { ipd: { label: 'IPD bills', to: '/billing/ipd' }, discharges: { label: 'Discharge', to: '/billing/ipd/discharges' } };

export function IpdBillPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [step] = useState(() => (PAGE_STEPS.includes(params.get('do')) ? params.get('do') : null));
  // The step is opened once: a reload of the page does not open it again
  useEffect(() => {
    if (!params.has('do')) return;
    const next = new URLSearchParams(params);
    next.delete('do');
    setParams(next, { replace: true });
  }, []);
  const back = BACK_TO[params.get('from')] ?? BACK_TO.ipd;
  return <IpdBillWindow key={id} stayId={id} initialDialog={step} back={back} />;
}

/**
 * The bill window of one stay. embedded: inside another page (the IPD → Discharge pop-up, her record's IPD tab) –
 * a heading of its own in place of the page header. onChanged: told after every change (to refresh a list).
 */
export function IpdBillWindow({ stayId, embedded = false, onChanged, initialDialog = null, onClose = null, back = { label: 'IPD bills', to: '/billing/ipd' } }) {
  const { activeMembership } = useAuth();
  const res = useFetch(`/billing/ipd/stays/${stayId}`);
  const [tab, setTab] = useState('services');
  const [showRemoved, setShowRemoved] = useState(false);
  const [ticked, setTicked] = useState(() => new Set()); // lines ticked to take off together
  const [layout, setLayout] = useState('details'); // the print's layout, chosen in the Print menu
  const [dialog, setDialog] = useState(initialDialog); // add | advance | refund | discharge | admin | concession | final | reopen | clear | { remove: line }
  const [printing, setPrinting] = useState(null); // 'bill' | 'gatepass'
  const [flash, setFlash] = useState(null);
  const data = res.data;
  const done = (_out, message, { keepOpen = false } = {}) => {
    setTicked(new Set());
    res.reload();
    onChanged?.();
    if (keepOpen) return;
    setDialog(null);
    setFlash(message ?? null);
  };

  if (res.error && !data) return <div className={embedded ? '' : 'pf-content'}><Alert type="error">{res.error}</Alert></div>;
  if (!data) return <div className={embedded ? '' : 'pf-content'}><p className="muted" aria-busy="true">Loading the IPD bill…</p></div>;
  const { stay, patient, bill } = data;
  const step = stayStep(stay, bill);
  const open = bill && !bill.cancelled;
  const editable = open && !bill.final;
  const live = bill ? bill.lines.filter((l) => !l.removed) : [];
  const shown = bill ? bill.lines.filter((l) => showRemoved || !l.removed) : [];
  const tickable = editable ? shown.filter((l) => !l.removed) : [];
  const removedCount = bill ? bill.lines.filter((l) => l.removed).length : 0;
  const tickedLines = tickable.filter((l) => ticked.has(l.id));
  const tick = (id, on) =>
    setTicked((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const advance = bill ? advanceTotal(bill.payments) : 0;
  const refunds = bill ? bill.payments.filter((p) => p.kind === 'refund').reduce((s, p) => s + p.amountPaise, 0) : 0;

  // One primary button, by the step she is at
  let primary = null;
  if (open && step.key === 'in') primary = { label: 'Take advance', icon: Wallet, onClick: () => setDialog('advance') };
  else if (step.key === 'card') primary = { label: 'Record discharge', icon: DoorOpen, onClick: () => setDialog('discharge') };
  else if (open && step.key === 'recorded') primary = { label: 'Make final bill', icon: FileCheck, onClick: () => setDialog('final') };
  else if (open && step.key === 'final' && bill.balance > 0) primary = { label: 'Take payment', icon: Wallet, onClick: () => setDialog('advance') };
  else if (step.key === 'final') primary = { label: 'Clear for leaving', icon: DoorOpen, onClick: () => setDialog('clear') };

  const title = `IPD bill${stay.ipdNo ? ` – ${stay.ipdNo}` : ''}`;
  const badges = (
    <>
      <StatusPill tone={step.tone} icon={step.icon}>
        {step.label}
      </StatusPill>
      {bill && <BillStatus status={bill.status} />}
    </>
  );
  const actions = (
          <>
            {/* Print as Details (the headed bill), Date-wise draft or Summary – one menu (11 Nov 2026) */}
            {bill && (
              <MenuButton
                className="btn btn-secondary"
                icon={Printer}
                label={bill.final ? 'Print final bill' : stay.status === 'admitted' ? 'Print interim bill' : 'Print draft bill'}
                align="end"
                items={[...BILL_LAYOUTS].sort((a, b) => (b.key === 'details') - (a.key === 'details')).map((l) => ({
                  label: l.key === 'details' ? 'Details (by heading)' : l.label,
                  icon: Printer,
                  onSelect: () => {
                    setLayout(l.key);
                    setPrinting('bill');
                  },
                }))}
              />
            )}
            {/* With money still due she may leave only with a reason (e.g. insurance claim pending) */}
            {step.key === 'final' && primary?.label === 'Take payment' && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialog('clear')}>
                <DoorOpen aria-hidden="true" /> Clear for leaving
              </button>
            )}
            {stay.clearance && (
              <button type="button" className="btn btn-secondary" onClick={() => setPrinting('gatepass')}>
                <Printer aria-hidden="true" /> Gate pass
              </button>
            )}
            {primary && (
              <button type="button" className="btn btn-primary" onClick={primary.onClick}>
                <primary.icon aria-hidden="true" /> {primary.label}
              </button>
            )}
          </>
  );

  return (
    <>
      {embedded ? (
        <div className="ipd-embed-head">
          <div>
            <h2>{title}</h2>
            <p className="muted">{[patient.fullName, patient.mrn].join(' · ')}</p>
            <div className="ipd-embed-badges">{badges}</div>
          </div>
          <div className="ipd-embed-actions">
            {actions}
            {/* The pop-up's close, in the same row as its buttons */}
            {onClose && (
              <button type="button" className="btn btn-link ipd-sheet-x" onClick={onClose} aria-label="Close the IPD bill">
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <PageHeader
          breadcrumbs={[{ label: 'Billing', to: '/billing' }, back, { label: patient.fullName }]}
          title={title}
          documentTitle="IPD bill"
          subtitle={[patient.fullName, patient.mrn].join(' · ')}
          badges={badges}
          tabs={billingTabs(activeMembership.roles)}
          actions={actions}
        />
      )}
      <div className={embedded ? 'ipd-page ipd-embedded' : 'pf-content ipd-page'}>
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {/* The forms open here, in the page above the bill (owner, 9 Nov 2026) – not as windows over it */}
        <InlineForms.Provider value>
      {dialog === 'add' && <AddItemDialog bill={bill} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === 'advance' || dialog === 'refund') && <PaymentDialog bill={bill} refund={dialog === 'refund'} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'discharge' && <DischargeDialog data={data} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'admin' && <AdminChargeDialog bill={bill} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'concession' && <DiscountDialog bill={bill} title="Concession" authorities={data.authorities} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'final' && <FinalDialog bill={bill} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'reopen' && (
        <ReasonDialog
          id="ipd-reopen"
          title="Reopen the final bill"
          text="Items can then be added or taken off again. The reason is kept with the bill."
          label="Reason"
          confirmLabel="Reopen"
          path={`/billing/ipd/bills/${bill.id}/reopen`}
          message="Final bill reopened."
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === 'removeTicked' && tickedLines.length > 0 && <RemoveTickedDialog bill={bill} lines={tickedLines} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.remove && (
        <ReasonDialog
          id="ipd-remove"
          title={`Remove ${dialog.remove.name}`}
          text={`${rupees(dialog.remove.amountPaise)} comes off the bill. The line is kept, marked Removed, with the reason (Show removed services).`}
          label="Reason"
          confirmLabel="Remove it"
          path={`/billing/bills/${bill.id}/lines/${dialog.remove.id}/remove`}
          message={`Removed: ${dialog.remove.name}.`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === 'clear' && (
        <ClearDialog
          stay={{ id: stay.id, balancePaise: bill ? bill.balance : 0, patient }}
          onClose={() => setDialog(null)}
          onCleared={() => {
            setDialog(null);
            setFlash('Cleared for leaving. Print the gate pass for the security desk.');
            res.reload();
            onChanged?.();
            setPrinting('gatepass');
          }}
        />
      )}
        </InlineForms.Provider>
        {step.next && !flash && <p className="muted">{step.next}</p>}
        {!bill && <Alert type="info">This stay has no bill.</Alert>}
        {/* The entry strip of the hospital's old billing screen (11 Nov 2026): across the page, on one line */}
        {editable && <ServiceEntryRow bill={bill} roles={activeMembership?.roles ?? []} onDone={done} onMore={() => setDialog('add')} />}
        <div className="ipd-layout">
          {/* Left: her details and the bill's sums */}
          <aside className="card ipd-side" aria-label="Patient and stay">
            {/* Label beside value, as the old screen's left panel (11 Nov 2026); her name first */}
            <dl className="ipd-facts ipd-facts-rows">
              <div className="ipd-wide ipd-who">
                <dt>Patient</dt>
                <dd>
                  <strong>{patient.fullName}</strong>
                </dd>
              </div>
              <div>
                <dt>UHID</dt>
                <dd className="tabular">
                  <Link to={`/patients/${patient.id}`}>{patient.mrn}</Link>
                </dd>
              </div>
              <div>
                <dt>IPD no.</dt>
                <dd className="tabular">{stay.ipdNo ?? '–'}</dd>
              </div>
              <div>
                <dt>MLC</dt>
                <dd>{stay.mlc ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Age</dt>
                <dd>{patient.age != null ? `${patient.age} years` : '–'}</dd>
              </div>
              <div>
                <dt>Admitted on</dt>
                <dd>{formatDateTime(stay.admittedAt)}</dd>
              </div>
              <div>
                <dt>Ward (class)</dt>
                <dd>{stay.ward || '–'}</dd>
              </div>
              <div>
                <dt>Bed</dt>
                <dd>{stay.bed || '–'}</dd>
              </div>
              <div>
                <dt>Days</dt>
                <dd>{stay.days}</dd>
              </div>
              <div className="ipd-wide">
                <dt>Doctor</dt>
                <dd>{stay.doctorName || '–'}</dd>
              </div>
              <div className="ipd-wide">
                <dt>Payer</dt>
                <dd>{stay.payer || 'Self'}</dd>
              </div>
            </dl>
            {bill && (
              <>
                <h3 className="ipd-side-title">Bill</h3>
                <dl className="ipd-sums ipd-sums-rows" aria-label="Bill information">
                  <div>
                    <dt>Bill amount</dt>
                    <dd>{rupees(bill.total)}</dd>
                  </div>
                  <div>
                    <dt>Advance</dt>
                    <dd>{rupees(advance)}</dd>
                  </div>
                  {refunds > 0 && (
                    <div>
                      <dt>Refunded</dt>
                      <dd>{rupees(refunds)}</dd>
                    </div>
                  )}
                  <div className="ipd-sums-balance">
                    <dt>{bill.balance < 0 ? 'Due back' : 'Balance'}</dt>
                    <dd>{rupees(Math.abs(bill.balance))}</dd>
                  </div>
                </dl>
              </>
            )}
            <h3 className="ipd-side-title">
              Discharge{' '}
              {stay.status === 'admitted' && (
                <StatusPill tone="admitted" icon={BedDouble}>
                  In hospital
                </StatusPill>
              )}
            </h3>
            {stay.status === 'admitted' ? (
              <p className="muted ipd-side-note">The doctor signs the discharge card first; then the discharge is recorded here.</p>
            ) : (
              <dl className="ipd-facts">
                <div className="ipd-wide">
                  <dt>Discharged on</dt>
                  <dd>
                    {formatDateTime(stay.dischargedAt)}
                    {stay.dischargedByName ? <span className="muted"> · card by {stay.dischargedByName}</span> : null}
                  </dd>
                </div>
                <div className="ipd-wide">
                  <dt>Type</dt>
                  <dd>{stay.discharge?.label ?? 'Not recorded yet'}</dd>
                </div>
                {stay.discharge && (
                  <div className="ipd-wide">
                    <dt>Doctor</dt>
                    <dd>{stay.discharge.doctorName || '–'}</dd>
                  </div>
                )}
                {stay.discharge?.remark && (
                  <div className="ipd-wide">
                    <dt>Remark</dt>
                    <dd>{stay.discharge.remark}</dd>
                  </div>
                )}
                {stay.clearance && (
                  <div className="ipd-wide">
                    <dt>Gate pass</dt>
                    <dd className="tabular">
                      {stay.clearance.passNo} · {stay.clearance.byName}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {stay.status === 'discharged' && stay.discharge && !stay.clearance && (
              <button type="button" className="btn btn-link" onClick={() => setDialog('discharge')}>
                Change the discharge details
              </button>
            )}
          </aside>

          {/* Right: the tabs and the foot */}
          <section className="card ipd-main" aria-label="Bill">
            {bill && (
              <>
                <div className="ipd-toolbar">
                  <span className="muted tabular">Bill {bill.number}</span>
                  {bill.final && (
                    <StatusPill tone="due" icon={FileCheck}>
                      Final bill · {bill.final.byName}, {formatDateTime(bill.final.at)}
                    </StatusPill>
                  )}
                  {bill.final && data.canReopen && !stay.clearance && (
                    <button type="button" className="btn btn-link" onClick={() => setDialog('reopen')}>
                      <LockOpen aria-hidden="true" /> Reopen
                    </button>
                  )}
                </div>
                <div className="ipd-tabs" role="tablist" aria-label="Bill parts">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" role="tab" id={`ipd-tab-${t.key}`} aria-selected={tab === t.key} aria-controls="ipd-panel" onClick={() => setTab(t.key)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div id="ipd-panel" role="tabpanel" aria-labelledby={`ipd-tab-${tab}`} className="ipd-panel">
                  {tab === 'services' && (
                    <>
                      {/* No group filter (11 Nov 2026): every service shows; the printed bill groups them under headings */}
                      <div className="ipd-filters">
                        <label>
                          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed services
                          {removedCount > 0 ? ` (${removedCount})` : ''}
                        </label>
                        {tickedLines.length > 0 && (
                          <button type="button" className="btn btn-secondary btn-sm svc-remove" onClick={() => setDialog('removeTicked')}>
                            <Trash2 aria-hidden="true" /> Remove ticked ({tickedLines.length})
                          </button>
                        )}
                      </div>
                      <div className="table-scroll">
                        <table className="bill-report">
                          <thead>
                            <tr>
                              <th scope="col" className="ipd-tick">
                                {tickable.length > 0 ? (
                                  <input
                                    type="checkbox"
                                    aria-label="Tick all items"
                                    checked={tickedLines.length === tickable.length}
                                    onChange={(e) => setTicked(new Set(e.target.checked ? tickable.map((l) => l.id) : []))}
                                  />
                                ) : (
                                  <span className="sr-only">Tick</span>
                                )}
                              </th>
                              <th scope="col">Sr.</th>
                              <th scope="col">Date</th>
                              <th scope="col">Service</th>
                              <th scope="col" className="num">
                                Price
                              </th>
                              <th scope="col" className="num">
                                Qty
                              </th>
                              <th scope="col" className="num">
                                Amount
                              </th>
                              <th scope="col">Doctor</th>
                              <th scope="col">
                                <span className="sr-only">Remove</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.length === 0 && (
                              <tr>
                                <td colSpan={9} className="muted">
                                  No items.
                                </td>
                              </tr>
                            )}
                            {shown.map((l, i) => (
                              <tr key={l.id} className={l.removed ? 'ipd-removed' : undefined}>
                                <td className="ipd-tick">
                                  {editable && !l.removed && <input type="checkbox" aria-label={`Tick ${l.name}`} checked={ticked.has(l.id)} onChange={(e) => tick(l.id, e.target.checked)} />}
                                </td>
                                <td>{i + 1}</td>
                                <td>{l.addedAt ? formatDateTime(l.addedAt) : '–'}</td>
                                <td>
                                  <span className="svc-name">{l.name}</span>
                                  {l.removed && (
                                    <span className="svc-removed-why">
                                      Removed by {l.removed.byName}
                                      {l.removed.at ? `, ${formatDateTime(l.removed.at)}` : ''}: {l.removed.reason}
                                    </span>
                                  )}
                                  {l.priceNotSet && !l.removed && <span className="muted"> – price not set</span>}
                                </td>
                                <td className="num tabular">{rupees(l.ratePaise)}</td>
                                <td className="num tabular">{l.qty}</td>
                                <td className="num tabular">{rupees(l.amountPaise)}</td>
                                <td>{l.doctorName || '–'}</td>
                                <td className="svc-action">
                                  {l.removed ? (
                                    <StatusPill tone="inactive" icon={Ban}>
                                      Removed
                                    </StatusPill>
                                  ) : (
                                    editable && (
                                      <button type="button" className="btn btn-secondary btn-sm svc-remove" onClick={() => setDialog({ remove: l })}>
                                      <Trash2 aria-hidden="true" /> Remove<span className="sr-only"> {l.name}</span>
                                    </button>
                                    )
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {tab === 'advance' && (
                    <div className="table-scroll">
                      <table className="bill-report">
                        <thead>
                          <tr>
                            <th scope="col">Receipt</th>
                            <th scope="col">Date</th>
                            <th scope="col">Kind</th>
                            <th scope="col">Mode</th>
                            <th scope="col" className="num">
                              Amount
                            </th>
                            <th scope="col">Taken by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bill.payments.length === 0 && (
                            <tr>
                              <td colSpan={6} className="muted">
                                No advance or payment yet.
                              </td>
                            </tr>
                          )}
                          {bill.payments.map((p) => (
                            <tr key={p.id}>
                              <td className="tabular">{p.receipt}</td>
                              <td>{formatDateTime(p.at)}</td>
                              <td>{PAYMENT_KIND_LABELS[p.kind]}</td>
                              <td>
                                {MODE_LABELS[p.mode]}
                                {p.reference ? ` · ${p.reference}` : ''}
                              </td>
                              <td className="num tabular">{p.kind === 'refund' ? `−${rupees(p.amountPaise)}` : rupees(p.amountPaise)}</td>
                              <td>{p.byName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {tab === 'previous' && (
                    <div className="table-scroll">
                      <table className="bill-report">
                        <thead>
                          <tr>
                            <th scope="col">Bill</th>
                            <th scope="col">Date</th>
                            <th scope="col">Type</th>
                            <th scope="col" className="num">
                              Total
                            </th>
                            <th scope="col" className="num">
                              Balance
                            </th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.previousBills.length === 0 && (
                            <tr>
                              <td colSpan={6} className="muted">
                                No other bills.
                              </td>
                            </tr>
                          )}
                          {data.previousBills.map((b) => (
                            <tr key={b.id}>
                              <td className="tabular">
                                <Link to={`/billing/bills/${b.id}`}>{b.number}</Link>
                              </td>
                              <td>{dayLabel(b.date)}</td>
                              <td>{b.kind === 'ipd' ? 'IPD' : 'OPD'}</td>
                              <td className="num tabular">{rupees(b.total)}</td>
                              <td className="num tabular">{rupees(b.balance)}</td>
                              <td>
                                <BillStatus status={b.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {tab === 'moves' && (
                    <>
                      {stay.moves.length === 0 ? (
                        <p className="muted">No bed transfer recorded. (Moves before 9 Nov 2026 are in the audit log only.)</p>
                      ) : (
                        <table className="bill-report">
                          <thead>
                            <tr>
                              <th scope="col">When</th>
                              <th scope="col">From</th>
                              <th scope="col">To</th>
                              <th scope="col">By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stay.moves.map((m, i) => (
                              <tr key={i}>
                                <td>{formatDateTime(m.at)}</td>
                                <td>{[m.fromWard, m.fromBed].filter(Boolean).join(' · ') || '–'}</td>
                                <td>{[m.toWard, m.toBed].filter(Boolean).join(' · ')}</td>
                                <td>{m.byName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                  {tab === 'summary' && (
                    <table className="bill-report">
                      <thead>
                        <tr>
                          <th scope="col">Group</th>
                          <th scope="col" className="num">
                            Items
                          </th>
                          <th scope="col" className="num">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryByGroup(live).map((g) => (
                          <tr key={g.group}>
                            <td>{g.label}</td>
                            <td className="num tabular">{g.items}</td>
                            <td className="num tabular">{rupees(g.amountPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* The foot as the old screen's (11 Nov 2026): the sums in one column, administrative charges and the
                    concession in it with their own Change; giving money back beside them when it is due */}
                <div className="ipd-foot">
                  <div className="ipd-foot-note">
                    {bill.discountInfo && (
                      <p className="muted">
                        Concession: {bill.discountInfo.reason}
                        {bill.discountInfo.authorisedByName ? ` · authorised by ${bill.discountInfo.authorisedByName}` : ''}
                      </p>
                    )}
                    {open && bill.balance < 0 && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('refund')}>
                        Give money back
                      </button>
                    )}
                  </div>
                  <dl className="ipd-totals">
                    <div>
                      <dt>Total amount</dt>
                      <dd>{rupees(bill.subtotal - adminChargeOf(bill.lines))}</dd>
                    </div>
                    <div>
                      <dt>
                        Administrative charges
                        {editable && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('admin')}>
                            Change<span className="sr-only"> the administrative charges</span>
                          </button>
                        )}
                      </dt>
                      <dd>{rupees(adminChargeOf(bill.lines))}</dd>
                    </div>
                    <div>
                      <dt>
                        Concession
                        {open && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('concession')}>
                            <BadgePercent aria-hidden="true" /> {bill.discountInfo ? 'Change' : 'Give'}
                            <span className="sr-only"> concession</span>
                          </button>
                        )}
                      </dt>
                      <dd>{bill.discount ? `−${rupees(bill.discount)}` : rupees(0)}</dd>
                    </div>
                    <div className="ipd-net">
                      <dt>Net payable</dt>
                      <dd>{rupees(bill.total)}</dd>
                    </div>
                  </dl>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {printing === 'bill' && bill && <IpdBillPrint data={data} layout={layout} onClose={() => setPrinting(null)} />}
      {printing === 'gatepass' && <StayPaper stay={{ id: stay.id }} what="gatepass" onClose={() => setPrinting(null)} />}
    </>
  );
}

// ---------- The printed bill (A4) ----------

function IpdBillPrint({ data, layout, onClose }) {
  const { stay, patient, bill } = data;
  const lh = useFetch('/tenant/settings/letterhead');
  const { user } = useAuth();
  const lines = bill.lines.filter((l) => !l.removed);
  const title = billTitle(stay, bill);
  const record = () => api(`/billing/bills/${bill.id}/printed`, { method: 'POST', body: {} });
  const layoutLabel = BILL_LAYOUTS.find((l) => l.key === layout)?.label ?? '';
  let n = 0;
  const lineRow = (l) => (
    <tr key={l.id}>
      <td>{(n += 1)}</td>
      <td>{l.name}</td>
      <td>{l.doctorName}</td>
      <td className="num">{rupees(l.ratePaise)}</td>
      <td className="num">{l.qty}</td>
      <td className="num">{rupees(l.amountPaise)}</td>
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th scope="col">Sr. no.</th>
        <th scope="col">Service</th>
        <th scope="col">Doctor</th>
        <th scope="col" className="num">
          Rate
        </th>
        <th scope="col" className="num">
          Qty
        </th>
        <th scope="col" className="num">
          Amount
        </th>
      </tr>
    </thead>
  );
  return (
    <PrintPreview
      title={`${title} – print preview`}
      hint="Check it, then print on A4 paper – or save it as a PDF."
      page={{ size: 'A4', margin: '12mm' }}
      pdf={{ fileName: `${title} ${bill.number}.pdf`, title: `${title} ${bill.number}`, onSaved: () => record() }}
      docKey={lh.data ? `${bill.id}-${layout}` : null}
      onPrint={record}
      onClose={onClose}
    >
      <PrintDocument className="bill-doc ipd-doc">
        {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} centered />}
        <div className="bill-doc-titlebar">
          <h1 className="pdoc-title">
            {title}
            {layout !== 'details' ? ` (${layoutLabel.toLowerCase()})` : ''}
          </h1>
          <span className="pdoc-small">Print date {formatDateTime(new Date())}</span>
        </div>
        <div className="bill-doc-box">
          <table className="bill-doc-head">
            <tbody>
              <tr>
                <th scope="row">Patient name</th>
                <td>{patient.fullName}</td>
                <th scope="row">Bill no.</th>
                <td>{bill.number}</td>
              </tr>
              <tr>
                <th scope="row">Age</th>
                <td>{patient.age != null ? `${patient.age} Y` : ''}</td>
                <th scope="row">UHID</th>
                <td>{patient.mrn}</td>
              </tr>
              <tr>
                <th scope="row">Consultant</th>
                <td>{stay.doctorName}</td>
                <th scope="row">IPD no.</th>
                <td>{stay.ipdNo ?? ''}</td>
              </tr>
              <tr>
                <th scope="row">Ward / bed</th>
                <td>{[stay.ward, stay.bed].filter(Boolean).join(' · ')}</td>
                <th scope="row">Company</th>
                <td>{stay.payer || 'Self'}</td>
              </tr>
              <tr>
                <th scope="row">Admitted</th>
                <td>{formatDateTime(stay.admittedAt)}</td>
                <th scope="row">Discharged</th>
                <td>{stay.dischargedAt ? formatDateTime(stay.dischargedAt) : 'In hospital'}</td>
              </tr>
              {stay.discharge && (
                <tr>
                  <th scope="row">Discharge type</th>
                  <td>{stay.discharge.label}</td>
                  <th scope="row">Days</th>
                  <td>{stay.days}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* As the hospital's old IP final bill (11 Nov 2026): under headings with their totals, the class beneath */}
          {layout === 'details' && <HeadedBillLines lines={lines} classLabel={stay.ward} />}
          {layout === 'datewise' && (
            <table className="bill-doc-lines">
              {head}
              {linesByDate(lines).map((d) => (
                <tbody key={d.day}>
                  <tr className="bill-doc-group">
                    <td />
                    <th scope="rowgroup" colSpan={4}>
                      {d.day ? dayLabel(d.day) : 'Date not known'}
                    </th>
                    <td className="num">{rupees(d.amountPaise)}</td>
                  </tr>
                  {d.lines.map(lineRow)}
                </tbody>
              ))}
            </table>
          )}
          {layout === 'summary' && (
            <table className="bill-doc-lines">
              <thead>
                <tr>
                  <th scope="col">Sr. no.</th>
                  <th scope="col">Charges</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaryByGroup(lines).map((g, i) => (
                  <tr key={g.group}>
                    <td>{i + 1}</td>
                    <td>{g.label} charges</td>
                    <td className="num">{g.items}</td>
                    <td className="num">{rupees(g.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <table className="bill-doc-sums">
            <tbody>
              <tr>
                <th scope="row">Total amount</th>
                <td>{rupees(bill.subtotal)}</td>
              </tr>
              <tr>
                <th scope="row">
                  Discount amount{bill.discountInfo?.authorisedByName ? ` (authorised by ${bill.discountInfo.authorisedByName})` : ''}
                </th>
                <td>{rupees(bill.discount ?? 0)}</td>
              </tr>
              <tr>
                <th scope="row">Net pay amount</th>
                <td>{rupees(bill.total)}</td>
              </tr>
              <tr>
                <th scope="row">Paid amount</th>
                <td>{rupees(bill.paid)}</td>
              </tr>
              <tr className="bill-doc-balance">
                <th scope="row">{bill.balance < 0 ? 'Due back' : 'Balance amount'}</th>
                <td>{rupees(Math.abs(bill.balance))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="bill-doc-words">
          <strong>Amount in words:</strong> {amountInWords(bill.total)}
        </p>
        {bill.payments.length > 0 && (
          <p className="pdoc-small">
            Receipts: {bill.payments.map((p) => `${p.receipt} ${PAYMENT_KIND_LABELS[p.kind].toLowerCase()} ${rupees(p.amountPaise)} (${MODE_LABELS[p.mode]})`).join('; ')}.
          </p>
        )}
        <div className="bill-doc-foot">
          <span />
          <div className="bill-doc-sign">
            <strong>Signature</strong>
            <span>{user?.name}</span>
          </div>
        </div>
        <p className="pdoc-small">This is a computer-generated {title.toLowerCase()}.</p>
      </PrintDocument>
    </PrintPreview>
  );
}

import { useState } from 'react';
import { HandCoins, RotateCcw, UserRound } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { MODE_LABELS, STATUS_LOOK, billingTabs, rupees, toInput, toPaise } from './billingFormat.js';
import { isCredit, liveServices, refundFor, settlementCheck } from './refundFormat.js';

// Billing → Refund and Billing → Settlement (owner, 28 Oct 2026), like the hospital's old "Refund of Bill" and "Bill
// Settlement" screens: find the patient, see her bills, choose one. A refund takes the whole bill or chosen services
// off with the remark and gives back what was paid for them; a settlement takes the money still due on a credit bill,
// with a concession and its reason if one is given. The server checks everything again (routes/billing.js).

const REFUND_MODES = { cash: 'Cash', upi: 'UPI', card: 'Card' };

/** The patient chosen on the left, or the finder. */
function PatientChoice({ patient, onPick, onClear }) {
  if (!patient) return <PatientFinder onPick={onPick} />;
  return (
    <div className="rs-patient">
      <UserRound aria-hidden="true" />
      <div>
        <strong>{patient.fullName}</strong>
        <span className="muted">
          {' '}
          {patient.mrn}
          {patient.phone ? ` · ${patient.phone}` : ''}
        </span>
      </div>
      <button type="button" className="btn btn-link" onClick={onClear}>
        Change patient
      </button>
    </div>
  );
}

/** A patient's bills as a table; the chosen one is highlighted. */
function BillsTable({ caption, bills, chosenId, onChoose, columns, empty }) {
  return (
    <table className="bill-report dc-table rs-bills">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Bill date</th>
          <th scope="col">Bill no.</th>
          {columns.map((c) => (
            <th key={c.key} scope="col" className="num">
              {c.label}
            </th>
          ))}
          <th scope="col">
            <span className="sr-only">Choose</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {bills.map((b) => (
          <tr key={b.id} className={b.id === chosenId ? 'rs-chosen' : undefined}>
            <td>{formatDate(b.date)}</td>
            <td>{b.number}</td>
            {columns.map((c) => (
              <td key={c.key} className="num">
                {rupees(c.value(b))}
              </td>
            ))}
            <td>
              {onChoose && (
                <button type="button" className="btn btn-link" onClick={() => onChoose(b)} aria-pressed={b.id === chosenId}>
                  {b.id === chosenId ? 'Chosen' : 'Choose'}
                </button>
              )}
            </td>
          </tr>
        ))}
        {!bills.length && (
          <tr>
            <td colSpan={columns.length + 3} className="muted">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function usePatientBills(patient) {
  const res = useFetch(patient ? `/billing/patient/${patient.id}` : null);
  return { ...res, bills: (res.data?.bills ?? []).filter((b) => b.status !== 'cancelled') };
}

// ---------- Refund of bill ----------

function RefundForm({ billId, onDone }) {
  const res = useFetch(`/billing/bills/${billId}`);
  const bill = res.data?.bill;
  const [whole, setWhole] = useState(true);
  const [chosen, setChosen] = useState([]);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  if (res.error) return <Alert type="error">{res.error.message}</Alert>;
  if (!bill) return <p className="muted">Loading the bill…</p>;
  const services = liveServices(bill);
  const ids = whole ? services.map((l) => l.id) : chosen;
  const refund = refundFor(bill, ids);
  const toggle = (id) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  const send = async () => {
    const problems = {};
    if (!ids.length) problems.lineIds = 'Choose the services to refund.';
    if (remark.trim().length < 3) problems.reason = 'Write the remark: why the money is given back.';
    if (!problems.lineIds && refund <= 0) problems.lineIds = 'Nothing was paid for these services, so there is nothing to give back.';
    setFields(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api(`/billing/bills/${bill.id}/refund`, { method: 'POST', body: { ...(whole ? { all: true } : { lineIds: chosen }), mode, reference: reference.trim(), reason: remark.trim() } });
      onDone(`Refund ${out.payment.receipt}: ${rupees(out.payment.amountPaise)} given back by ${REFUND_MODES[mode]} on bill ${bill.number}.`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };

  return (
    <div className="rs-form">
      <Alert type="error">{error}</Alert>
      <dl className="rs-sums">
        <div>
          <dt>Bill no.</dt>
          <dd>
            {bill.number} · {formatDate(bill.date)}
          </dd>
        </div>
        <div>
          <dt>Net bill amount</dt>
          <dd>{rupees(bill.total)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{rupees(bill.paid)}</dd>
        </div>
        <div>
          <dt>Total refund so far</dt>
          <dd>{rupees(bill.refunded ?? 0)}</dd>
        </div>
      </dl>
      {!services.length ? (
        <p className="muted">There are no services left on this bill.</p>
      ) : (
        <>
          <fieldset className="exp-modes">
            <legend>Refund</legend>
            <label className="exp-mode">
              <input type="radio" name="rs-what" checked={whole} onChange={() => setWhole(true)} /> Whole bill
            </label>
            <label className="exp-mode">
              <input type="radio" name="rs-what" checked={!whole} onChange={() => setWhole(false)} /> Services
            </label>
          </fieldset>
          {!whole && (
            <fieldset className="rs-services" aria-describedby={fields.lineIds ? 'rs-lines-error' : undefined}>
              <legend className="sr-only">Services to refund</legend>
              {services.map((l) => (
                <label key={l.id} className="rs-service">
                  <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => toggle(l.id)} />
                  <span>
                    {l.name}
                    {l.qty > 1 ? ` × ${l.qty}` : ''}
                  </span>
                  <span className="num">{rupees(l.amountPaise)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {fields.lineIds && (
            <p className="field-error" id="rs-lines-error">
              {fields.lineIds}
            </p>
          )}
          <p className="rs-refund">
            Refund amount: <strong>{rupees(refund)}</strong>
          </p>
          <div className="exp-grid">
            <Field label="Given back by" id="rs-mode" error={fields.mode}>
              <select id="rs-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(REFUND_MODES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference (optional)" id="rs-ref" error={fields.reference} hint="e.g. the UPI transaction number">
              <input id="rs-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
          </div>
          <Field label="Remark" id="rs-remark" error={fields.reason} hint="Why the money is given back. Never the baby's sex.">
            <input id="rs-remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200} placeholder="e.g. doctor not available" />
          </Field>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>
            <RotateCcw aria-hidden="true" /> {busy ? 'Saving…' : `Give refund of ${rupees(refund)}`}
          </button>
        </>
      )}
    </div>
  );
}

export function RefundPage() {
  const { activeMembership } = useAuth();
  const [patient, setPatient] = useState(null);
  const [billId, setBillId] = useState(null);
  const [done, setDone] = useState(null);
  const [round, setRound] = useState(0);
  const bills = usePatientBills(patient);
  const paid = bills.bills.filter((b) => b.paid > 0 || (b.refunded ?? 0) > 0);
  const pick = (p) => {
    setPatient(p);
    setBillId(null);
    setDone(null);
  };
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Refund' }]} title="Refund of bill" tabs={billingTabs(activeMembership.roles)} />
      <div className="exp-layout">
        <section className="card" aria-labelledby="rs-find-title">
          <h2 id="rs-find-title">Patient and bills</h2>
          <PatientChoice patient={patient} onPick={pick} onClear={() => pick(null)} />
          {patient && (
            <>
              <Alert type="error">{bills.error?.message}</Alert>
              <BillsTable
                caption="Bills with money paid"
                bills={paid}
                chosenId={billId}
                onChoose={(b) => {
                  setBillId(b.id);
                  setDone(null);
                }}
                empty="No bill of this patient has money paid."
                columns={[
                  { key: 'amount', label: 'Bill amount', value: (b) => b.total },
                  { key: 'paid', label: 'Paid', value: (b) => b.paid },
                  { key: 'refunded', label: 'Refunded', value: (b) => b.refunded ?? 0 },
                ]}
              />
            </>
          )}
        </section>
        <section className="card" aria-labelledby="rs-refund-title">
          <h2 id="rs-refund-title">Refund</h2>
          <Alert type="success">{done}</Alert>
          {billId ? (
            <RefundForm
              key={`${billId}-${round}`}
              billId={billId}
              onDone={(text) => {
                setDone(text);
                setRound((r) => r + 1);
                bills.reload();
              }}
            />
          ) : (
            <p className="muted">Find the patient, then choose the bill to refund.</p>
          )}
        </section>
      </div>
    </>
  );
}

// ---------- Bill settlement ----------

function SettleForm({ bill, onDone }) {
  const [v, setV] = useState({ concession: '', concessionReason: '', amount: toInput(bill.balance), mode: 'cash', reference: '', scheme: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const concessionPaise = v.concession.trim() ? toPaise(v.concession) : 0;
  const amountPaise = v.amount.trim() ? toPaise(v.amount) : 0;
  const { left } = settlementCheck(bill, { concessionPaise: concessionPaise ?? 0, amountPaise: amountPaise ?? 0 });

  const send = async () => {
    const bad = {};
    if (concessionPaise === null) bad.concessionPaise = 'Enter the concession in rupees, for example 100.';
    if (amountPaise === null) bad.amountPaise = 'Enter the amount in rupees, for example 500.';
    const { fields: problems } = settlementCheck(bill, { concessionPaise: concessionPaise ?? 0, amountPaise: amountPaise ?? 0, concessionReason: v.concessionReason, mode: v.mode });
    const all = { ...problems, ...bad };
    setFields(all);
    if (Object.keys(all).length) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api(`/billing/bills/${bill.id}/settle`, {
        method: 'POST',
        body: {
          concessionPaise,
          concessionReason: v.concessionReason.trim(),
          ...(amountPaise ? { mode: v.mode, amountPaise, reference: v.reference.trim(), scheme: v.scheme.trim() } : {}),
        },
      });
      const parts = [out.payment && `${rupees(out.payment.amountPaise)} received (${out.payment.receipt})`, concessionPaise && `concession ${rupees(concessionPaise)}`].filter(Boolean);
      onDone(`Bill ${bill.number}: ${parts.join(', ')}. Still due: ${rupees(out.bill.balance)}.`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };

  return (
    <div className="rs-form">
      <Alert type="error">{error}</Alert>
      <dl className="rs-sums">
        <div>
          <dt>Bill no.</dt>
          <dd>
            {bill.number} · {formatDate(bill.date)}
          </dd>
        </div>
        <div>
          <dt>Bill amount</dt>
          <dd>{rupees(bill.subtotal)}</dd>
        </div>
        <div>
          <dt>Concession so far</dt>
          <dd>{rupees(bill.discount)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{rupees(bill.paid)}</dd>
        </div>
        <div>
          <dt>Balance due</dt>
          <dd>
            <strong>{rupees(bill.balance)}</strong>
          </dd>
        </div>
      </dl>
      <div className="exp-grid">
        <Field label="Concession ₹ (optional)" id="st-con" error={fields.concessionPaise}>
          <input id="st-con" inputMode="decimal" value={v.concession} onChange={set('concession')} placeholder="0" />
        </Field>
        <Field label="Amount received ₹" id="st-amount" error={fields.amountPaise}>
          <input id="st-amount" inputMode="decimal" value={v.amount} onChange={set('amount')} />
        </Field>
      </div>
      {concessionPaise > 0 && (
        <Field label="Why the concession is given" id="st-con-reason" error={fields.concessionReason} hint="Shown on the bill. Never the baby's sex.">
          <input id="st-con-reason" value={v.concessionReason} onChange={set('concessionReason')} maxLength={150} placeholder="e.g. staff family" />
        </Field>
      )}
      <div className="exp-grid">
        <Field label="Paid by" id="st-mode" error={fields.mode}>
          <select id="st-mode" value={v.mode} onChange={set('mode')}>
            {Object.entries(MODE_LABELS).map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)" id="st-ref" error={fields.reference} hint="e.g. the UPI transaction or claim number">
          <input id="st-ref" value={v.reference} onChange={set('reference')} maxLength={80} autoComplete="off" />
        </Field>
      </div>
      {v.mode === 'insurance' && (
        <Field label="Insurance company or scheme" id="st-scheme" error={fields.scheme}>
          <input id="st-scheme" value={v.scheme} onChange={set('scheme')} maxLength={80} placeholder={bill.insurer || ''} />
        </Field>
      )}
      <p className="rs-refund">
        Still due after this: <strong>{rupees(left)}</strong>
      </p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>
        <HandCoins aria-hidden="true" /> {busy ? 'Saving…' : 'Settle bill'}
      </button>
    </div>
  );
}

export function SettlementPage() {
  const { activeMembership } = useAuth();
  const [patient, setPatient] = useState(null);
  const [billId, setBillId] = useState(null);
  const [done, setDone] = useState(null);
  const bills = usePatientBills(patient);
  const credit = bills.bills.filter(isCredit);
  const settled = bills.bills.filter((b) => !isCredit(b) && b.total > 0);
  const chosen = credit.find((b) => b.id === billId) ?? null;
  const pick = (p) => {
    setPatient(p);
    setBillId(null);
    setDone(null);
  };
  const columns = [
    { key: 'amount', label: 'Bill amt', value: (b) => b.subtotal },
    { key: 'con', label: 'Con. amt', value: (b) => b.discount },
    { key: 'net', label: 'Net payable', value: (b) => b.total },
    { key: 'paid', label: 'Paid', value: (b) => b.paid },
    { key: 'due', label: 'Balance', value: (b) => b.balance },
  ];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Settlement' }]} title="Bill settlement" tabs={billingTabs(activeMembership.roles)} />
      <div className="exp-layout">
        <section className="card" aria-labelledby="st-find-title">
          <h2 id="st-find-title">Patient and bills</h2>
          <PatientChoice patient={patient} onPick={pick} onClear={() => pick(null)} />
          {patient && (
            <>
              <Alert type="error">{bills.error?.message}</Alert>
              <BillsTable
                caption="Credit bills (money still due)"
                bills={credit}
                chosenId={billId}
                onChoose={(b) => {
                  setBillId(b.id);
                  setDone(null);
                }}
                empty="Nothing is due from this patient."
                columns={columns}
              />
              <BillsTable caption="Paid bills" bills={settled} columns={columns} empty="No paid bills." />
              {bills.data?.owed > 0 && (
                <p>
                  <StatusPill tone={STATUS_LOOK.unpaid.tone} icon={STATUS_LOOK.unpaid.icon}>
                    Due from this patient: {rupees(bills.data.owed)}
                  </StatusPill>
                </p>
              )}
            </>
          )}
        </section>
        <section className="card" aria-labelledby="st-settle-title">
          <h2 id="st-settle-title">Settle</h2>
          <Alert type="success">{done}</Alert>
          {chosen ? (
            <SettleForm
              key={`${chosen.id}-${chosen.balance}`}
              bill={chosen}
              onDone={(text) => {
                setDone(text);
                setBillId(null);
                bills.reload();
              }}
            />
          ) : (
            <p className="muted">Find the patient, then choose a credit bill to settle.</p>
          )}
        </section>
      </div>
    </>
  );
}

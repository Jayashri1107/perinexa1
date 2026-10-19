import { useState } from 'react';
import { BadgePercent, Ban, FileText, Link2, Minus, Plus, Printer, RotateCcw, Search, Wallet, X } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { blobToBase64 } from '../visits/whatsapp.js';
import { ClaimFormPrint, InsuranceDialog, InsuranceSection, UpiLinkDialog } from './BillingExtras.jsx';
import { BillStatus } from './BillsPage.jsx';
import { CLAIM_LAYOUTS, GROUP_LABELS, KIND_LABELS, MODE_LABELS, NO_SEX_WORDS_HINT, PAYMENT_KIND_LABELS, billingTabs, claimNumberHint, rupees, takeMoneyLabel, toInput, toPaise } from './billingFormat.js';
import { Modal, useSend } from './billingUi.jsx';

// One bill (billing): its items (added by the work done, or by reception from the price list), discount, payments,
// deposits and refunds, and what is still to pay or to give back. Reception (and the hospital admin) do everything,
// with a reason for taking items off, discounts and cancelling. The bill and each receipt print on A5.
// Billing extras (BillingExtras.jsx): insurance or scheme details, the claim form and the PM-JAY claim sheet (A4), and
// the UPI payment link – which records nothing; the payment is recorded here with "Take payment".

// Adding items (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md: "make sure it get easy to add them"): type a few
// letters or tap a common item, it goes into a list; change the quantity with − and +; choose the doctor once; one
// button adds them all. Lab tests, scans, beds, nursing, ward rounds and medicines come onto the bill by themselves.
const QUICK_GROUPS = ['consultation', 'procedure', 'inpatient', 'other'];
const MAX_SHOWN = 40;

function AddItemDialog({ bill, onClose, onDone }) {
  const prices = useFetch('/billing/prices');
  const doctors = useFetch('/appointments/doctors'); // not for the billing department: then no doctor is asked
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [basket, setBasket] = useState([]); // { item, qty, amount, name }
  const [doctorId, setDoctorId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const all = (prices.data?.items ?? []).filter((i) => i.active);
  const doctorList = doctors.data?.doctors ?? [];
  const chosenDoctor = doctorId ?? doctorList.find((d) => d.name === bill.doctorName)?.id ?? '';
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0 || group;
  const found = all.filter((i) => (!group || i.group === group) && words.every((w) => i.name.toLowerCase().includes(w)));
  // Common items: those with a price in the groups reception adds by hand (consultation first); if none is priced yet, the consultations
  const priced = all.filter((i) => QUICK_GROUPS.includes(i.group) && i.pricePaise > 0).sort((x, y) => QUICK_GROUPS.indexOf(x.group) - QUICK_GROUPS.indexOf(y.group));
  const quick = (priced.length ? priced : all.filter((i) => i.group === 'consultation')).slice(0, 12);
  const shown = searching ? found.slice(0, MAX_SHOWN) : quick;

  const add = (item) =>
    setBasket((list) => (list.some((r) => r.item.id === item.id) ? list.map((r) => (r.item.id === item.id ? { ...r, qty: r.qty + 1 } : r)) : [...list, { item, qty: 1, amount: '', name: '' }]));
  const change = (id, patch) => setBasket((list) => list.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));
  const drop = (id) => setBasket((list) => list.filter((r) => r.item.id !== id));
  const rateOf = (r) => (r.item.pricePaise ? r.item.pricePaise : toPaise(r.amount));
  const ready = basket.length > 0 && basket.every((r) => Number.isInteger(r.qty) && r.qty >= 1 && rateOf(r) > 0);
  const total = basket.reduce((sum, r) => sum + (rateOf(r) > 0 ? rateOf(r) * r.qty : 0), 0);
  const hasMedicine = basket.some((r) => r.item.group === 'medicine') || group === 'medicine';

  const addAll = async () => {
    setBusy(true);
    setError(null);
    let last = null;
    const left = [...basket];
    try {
      while (left.length) {
        const r = left[0];
        const needsAmount = !r.item.pricePaise;
        last = await api(`/billing/bills/${bill.id}/lines`, {
          method: 'POST',
          body: {
            priceItemId: r.item.id,
            qty: r.qty,
            ...(needsAmount ? { ratePaise: rateOf(r), ...(r.name.trim().length >= 2 ? { name: r.name.trim() } : {}) } : {}),
            ...(chosenDoctor ? { doctorId: chosenDoctor } : {}),
          },
        });
        left.shift();
      }
      onDone(last, `Added ${basket.length} item${basket.length > 1 ? 's' : ''}: ${rupees(total)}.`);
    } catch (err) {
      // What was added stays on the bill; what is left stays in the list to try again
      setBasket(left);
      setError(`${left[0].item.name}: ${err.message}`);
      setBusy(false);
      if (last) onDone(last, null, { keepOpen: true });
    }
  };

  return (
    <Modal id="bill-add" title="Add items" onClose={onClose}>
      <Alert type="error">{error || prices.error}</Alert>
      <div className="bill-add-search">
        <Search aria-hidden="true" />
        <label htmlFor="bill-add-q" className="sr-only">
          Find an item
        </label>
        <input id="bill-add-q" type="search" placeholder="Type to find – e.g. consult, CTG, delivery" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus autoComplete="off" />
      </div>
      <div className="bill-add-groups" role="group" aria-label="Group">
        {[{ key: '', label: 'Common' }, ...(prices.data?.groups ?? [])].map((g) => (
          <button key={g.key || 'all'} type="button" className={`bill-add-chip${group === g.key ? ' is-on' : ''}`} aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>
            {g.key ? g.label : words.length ? 'All groups' : 'Common'}
          </button>
        ))}
      </div>
      <ul className="bill-add-results" aria-label={searching ? 'Items found' : 'Common items'}>
        {shown.map((i) => {
          const inList = basket.find((r) => r.item.id === i.id);
          return (
            <li key={i.id}>
              <button type="button" className={`bill-add-pick${inList ? ' is-in' : ''}`} onClick={() => add(i)}>
                <span className="bill-add-pick-name">{i.name}</span>
                <span className="muted">{i.pricePaise ? rupees(i.pricePaise) : 'amount to enter'}</span>
                <Plus aria-hidden="true" />
                {inList && <span className="sr-only">(in the list: {inList.qty})</span>}
              </button>
            </li>
          );
        })}
        {searching && !found.length && <li className="muted">Nothing found. The hospital admin adds new items in Billing → Price list.</li>}
        {searching && found.length > MAX_SHOWN && <li className="muted">{found.length - MAX_SHOWN} more – type a little more to narrow the list.</li>}
      </ul>
      {/* Medicines come from the pharmacy stock (owner, 13 Oct 2026): sold there, they come onto this bill by themselves */}
      {hasMedicine && (
        <Alert type="info">
          Medicines from the hospital pharmacy come onto this bill by themselves (Pharmacy → Sell, or Issue to ward). Add a medicine here only if it did
          not come from the pharmacy – it does not take anything from the stock.
        </Alert>
      )}

      <h3 className="bill-add-title">To add {basket.length > 0 && <span className="muted">· {basket.length}</span>}</h3>
      {basket.length === 0 ? (
        <p className="muted">Tap an item above to put it here.</p>
      ) : (
        <ul className="bill-add-basket">
          {basket.map((r) => (
            <li key={r.item.id}>
              <div className="bill-add-row">
                <span className="bill-add-pick-name">{r.item.name}</span>
                <span className="bill-add-qty">
                  <button type="button" className="icon-btn" onClick={() => (r.qty > 1 ? change(r.item.id, { qty: r.qty - 1 }) : drop(r.item.id))} aria-label={`One less ${r.item.name}`}>
                    <Minus aria-hidden="true" />
                  </button>
                  <input inputMode="numeric" aria-label={`Quantity of ${r.item.name}`} value={r.qty} onChange={(e) => change(r.item.id, { qty: Number(e.target.value) || 0 })} />
                  <button type="button" className="icon-btn" onClick={() => change(r.item.id, { qty: r.qty + 1 })} aria-label={`One more ${r.item.name}`}>
                    <Plus aria-hidden="true" />
                  </button>
                </span>
                <span className="num">{rateOf(r) > 0 ? rupees(rateOf(r) * r.qty) : '–'}</span>
                <button type="button" className="icon-btn" onClick={() => drop(r.item.id)} aria-label={`Take ${r.item.name} out of the list`}>
                  <X aria-hidden="true" />
                </button>
              </div>
              {!r.item.pricePaise && (
                <div className="form-grid">
                  <Field label="Amount (₹ each)" id={`bill-add-amount-${r.item.id}`}>
                    <input id={`bill-add-amount-${r.item.id}`} inputMode="decimal" value={r.amount} onChange={(e) => change(r.item.id, { amount: e.target.value })} />
                  </Field>
                  <Field label="What it is for (optional)" id={`bill-add-name-${r.item.id}`} hint={NO_SEX_WORDS_HINT}>
                    <input id={`bill-add-name-${r.item.id}`} value={r.name} maxLength={120} onChange={(e) => change(r.item.id, { name: e.target.value })} />
                  </Field>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {doctorList.length > 0 && (
        <Field label="Doctor" id="bill-add-doctor" hint="Printed with these items on the bill.">
          <select id="bill-add-doctor" value={chosenDoctor} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">No doctor</option>
            {doctorList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.name === bill.doctorName ? ' (her doctor)' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={addAll}>
          <Plus aria-hidden="true" /> {busy ? 'Adding…' : basket.length ? `Add to the bill · ${rupees(total)}` : 'Add to the bill'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function PaymentDialog({ bill, refund = false, onClose, onDone }) {
  const due = refund ? -bill.balance : Math.max(bill.balance, 0);
  const deposit = !refund && bill.stay?.inHospital;
  const [amount, setAmount] = useState(toInput(due));
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  // Paid by insurance: the insurer and the claim number come from the bill's insurance details, so the two agree
  const [scheme, setScheme] = useState(bill.insurance?.insurer ?? '');
  const [claimRef, setClaimRef] = useState(bill.insurance?.claimNumber ?? '');
  const s = useSend(onDone);
  const paise = toPaise(amount);
  const ready = paise > 0 && (mode !== 'insurance' || scheme.trim().length >= 2);
  const insured = mode === 'insurance';
  const what = refund ? 'refund' : deposit ? 'deposit' : 'payment';
  return (
    <Modal id="bill-pay" title={refund ? 'Give money back' : deposit ? 'Take a deposit' : 'Take payment'} onClose={onClose}>
      <p>
        {refund ? `Due back to the patient: ${rupees(due)}.` : deposit ? `She is in hospital: this is a deposit, set against the final bill. Balance so far: ${rupees(bill.balance)}.` : `Balance to pay: ${rupees(due)}.`}
      </p>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Amount (₹)" id="bill-pay-amount" error={s.fields.amountPaise}>
          <input id="bill-pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label={refund ? 'Given back by' : 'Paid by'} id="bill-pay-mode">
          <select id="bill-pay-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABELS)
              .filter(([m]) => !refund || m !== 'insurance')
              .map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {insured && (
        <Field label="Insurance company or scheme" id="bill-pay-scheme" error={s.fields.scheme} hint={bill.insurance?.insurer ? 'From this bill’s insurance details. Change it only when someone else paid.' : 'It is also noted in this bill’s insurance details.'}>
          <input id="bill-pay-scheme" value={scheme} maxLength={80} onChange={(e) => setScheme(e.target.value)} />
        </Field>
      )}
      {insured && (
        <Field
          label="Claim number (optional)"
          id="bill-pay-claim"
          error={s.fields.reference}
          hint={claimNumberHint(bill.insurance, scheme)}
        >
          <input id="bill-pay-claim" value={claimRef} maxLength={80} onChange={(e) => setClaimRef(e.target.value)} />
        </Field>
      )}
      {!insured && mode !== 'cash' && (
        <Field label={`${MODE_LABELS[mode]} reference (optional)`} id="bill-pay-ref" error={s.fields.reference} hint="The number of the payment. No names of people.">
          <input id="bill-pay-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || s.busy}
          onClick={() =>
            s.send(
              `/billing/bills/${bill.id}/payments`,
              { kind: refund ? 'refund' : 'payment', mode, amountPaise: paise, reference: insured ? claimRef.trim() : mode === 'cash' ? '' : reference.trim(), scheme: insured ? scheme.trim() : '' },
              (res) => `${PAYMENT_KIND_LABELS[res.payment.kind]} of ${rupees(res.payment.amountPaise)} recorded – receipt ${res.payment.receipt}.`,
            )
          }
        >
          {refund ? <RotateCcw aria-hidden="true" /> : <Wallet aria-hidden="true" />} {s.busy ? 'Saving…' : `Record the ${what}`}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function DiscountDialog({ bill, onClose, onDone }) {
  const [mode, setMode] = useState(bill.discountInfo?.mode ?? 'amount');
  const [value, setValue] = useState(bill.discountInfo ? (bill.discountInfo.mode === 'amount' ? toInput(bill.discountInfo.value) : String(bill.discountInfo.value)) : '');
  const [reason, setReason] = useState(bill.discountInfo?.reason ?? '');
  const s = useSend(onDone);
  const v = mode === 'amount' ? toPaise(value || '0') : Number(value || 0);
  const ok = v != null && !Number.isNaN(v) && v >= 0 && (mode === 'amount' || v <= 100);
  const shown = ok ? (mode === 'percent' ? Math.round((bill.subtotal * v) / 100) : v) : null;
  return (
    <Modal id="bill-discount" title="Discount" onClose={onClose}>
      <p>Bill before discount: {rupees(bill.subtotal)}. Enter 0 to take the discount off.</p>
      <Alert type="error">{s.error}</Alert>
      <div className="segmented" role="group" aria-label="Discount as">
        <button type="button" aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>
          Amount (₹)
        </button>
        <button type="button" aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>
          Percentage
        </button>
      </div>
      <div className="form-grid">
        <Field label={mode === 'amount' ? 'Discount (₹)' : 'Discount (%)'} id="bill-disc-value" error={s.fields.value}>
          <input id="bill-disc-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" id="bill-disc-reason" error={s.fields.reason} hint={`For example: staff family, hardship. ${NO_SEX_WORDS_HINT}`}>
          <input id="bill-disc-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {shown != null && shown > 0 && <p className="appt-when">Discount {rupees(shown)} · to pay {rupees(bill.subtotal - shown)}</p>}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok || s.busy}
          onClick={() => s.send(`/billing/bills/${bill.id}/discount`, { mode, value: v, reason: reason.trim() }, () => (v ? 'Discount saved.' : 'Discount taken off.'))}
        >
          <BadgePercent aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save discount'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function ReasonDialog({ id, title, text, label, confirmLabel, path, message, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id={id} title={title} onClose={onClose}>
      {text && <p>{text}</p>}
      <Alert type="error">{s.error}</Alert>
      <Field label={label} id={`${id}-reason`} error={s.fields.reason} hint={NO_SEX_WORDS_HINT}>
        <input id={`${id}-reason`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send(path, { reason: reason.trim() }, () => message)}>
          {s.busy ? 'Saving…' : confirmLabel}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

/** The printed bill (A5), or one receipt. */
function BillPrint({ bill, receipt = null, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const payment = receipt ? bill.payments.find((p) => p.receipt === receipt) : null;
  const lines = bill.lines.filter((l) => !l.removed);
  const record = () => api(`/billing/bills/${bill.id}/printed`, { method: 'POST', body: receipt ? { receipt } : {} });
  // In one click from the hospital's WhatsApp number, when she agreed to WhatsApp messages (docs/WHATSAPP_DESK_PLAN.md)
  const offer = useFetch(`/billing/bills/${bill.id}/whatsapp`);
  const what = receipt ? `Receipt ${receipt}` : `Bill ${bill.number}`;
  const pdf = {
    fileName: `${what}.pdf`,
    title: what,
    onSaved: () => record(),
    sendNow: offer.data?.available
      ? { label: offer.data.label, practice: offer.data.practice, send: async (blob) => api(`/billing/bills/${bill.id}/whatsapp`, { method: 'POST', body: { pdf: await blobToBase64(blob), ...(receipt ? { receipt } : {}) } }) }
      : null,
  };
  return (
    <PrintPreview
      title={receipt ? 'Receipt – print preview' : 'Bill – print preview'}
      hint="Check it, then print on A5 paper."
      page={{ size: 'A5', margin: '10mm' }}
      pdf={pdf}
      docKey={lh.data ? `${bill.id}-${receipt ?? ''}` : null}
      onPrint={record}
      onClose={onClose}
    >
      <PrintDocument className="bill-doc">
        {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
        <h1 className="pdoc-title">{receipt ? 'Receipt' : bill.kind === 'ipd' ? 'Inpatient bill' : 'Bill'}</h1>
        <table className="bill-doc-head">
          <tbody>
            <tr>
              <th scope="row">{receipt ? 'Receipt no.' : 'Bill no.'}</th>
              <td>{receipt ?? bill.number}</td>
              <th scope="row">Date</th>
              <td>{payment ? formatDateTime(payment.at) : dayLabel(bill.date)}</td>
            </tr>
            <tr>
              <th scope="row">Patient</th>
              <td>{bill.patient?.fullName}</td>
              <th scope="row">Patient no.</th>
              <td>{bill.patient?.mrn}</td>
            </tr>
            {bill.doctorName && !receipt && (
              <tr>
                <th scope="row">Doctor</th>
                <td>{bill.doctorName}</td>
                <th scope="row" />
                <td />
              </tr>
            )}
            {receipt && (
              <tr>
                <th scope="row">Bill no.</th>
                <td>{bill.number}</td>
                <th scope="row" />
                <td />
              </tr>
            )}
            {bill.stay && !receipt && (
              <tr>
                <th scope="row">Admitted</th>
                <td>{formatDateTime(bill.stay.admittedAt)}</td>
                <th scope="row">Discharged</th>
                <td>{bill.stay.dischargedAt ? formatDateTime(bill.stay.dischargedAt) : 'In hospital'}</td>
              </tr>
            )}
          </tbody>
        </table>
        {payment ? (
          <p className="bill-doc-receipt">
            Received with thanks {rupees(payment.amountPaise)} by {MODE_LABELS[payment.mode]}
            {payment.scheme ? ` (${payment.scheme})` : ''}
            {payment.reference ? `, reference ${payment.reference}` : ''}
            {payment.kind === 'deposit' ? ', as a deposit' : ''}
            {payment.kind === 'refund' ? ' – refunded to the patient' : ''}.
          </p>
        ) : (
          <table className="bill-doc-lines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.name}
                    {l.doctorName && !l.name.includes(l.doctorName) ? <span className="pdoc-small"> · {l.doctorName}</span> : null}
                  </td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{rupees(l.ratePaise)}</td>
                  <td className="num">{rupees(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <table className="bill-doc-sums">
          <tbody>
            {!payment && bill.discount > 0 && (
              <>
                <tr>
                  <th scope="row">Subtotal</th>
                  <td>{rupees(bill.subtotal)}</td>
                </tr>
                <tr>
                  <th scope="row">Discount</th>
                  <td>−{rupees(bill.discount)}</td>
                </tr>
              </>
            )}
            <tr>
              <th scope="row">Total</th>
              <td>{rupees(bill.total)}</td>
            </tr>
            <tr>
              <th scope="row">Paid</th>
              <td>{rupees(bill.paid)}</td>
            </tr>
            <tr className="bill-doc-balance">
              <th scope="row">{bill.balance < 0 ? 'Due back' : 'Balance'}</th>
              <td>{rupees(Math.abs(bill.balance))}</td>
            </tr>
          </tbody>
        </table>
        {!payment && bill.payments.length > 0 && (
          <p className="pdoc-small">
            Payments: {bill.payments.map((p) => `${p.receipt} ${PAYMENT_KIND_LABELS[p.kind].toLowerCase()} ${rupees(p.amountPaise)} (${MODE_LABELS[p.mode]})`).join('; ')}.
          </p>
        )}
        <p className="pdoc-small">This is a computer-generated {receipt ? 'receipt' : 'bill'}.</p>
      </PrintDocument>
    </PrintPreview>
  );
}

export function BillPage() {
  const { id } = useParams();
  const { activeMembership } = useAuth();
  const res = useFetch(`/billing/bills/${id}`);
  const [bill, setBill] = useState(null);
  // add | pay | refund | discount | cancel | insurance | upi | { remove: line }; ?pay=1 (Take payment on the Bills list) opens pay
  const { search: query } = useLocation();
  const [dialog, setDialog] = useState(() => (new URLSearchParams(query).get('pay') === '1' ? 'pay' : null));
  const [printing, setPrinting] = useState(null); // { receipt? } | { claim: 'claim' | 'pmjay' }
  const [flash, setFlash] = useState(null);
  const b = bill ?? res.data?.bill;
  const done = (out, message, { keepOpen = false } = {}) => {
    setBill(out.bill);
    if (keepOpen) return;
    setDialog(null);
    setFlash(message ?? null);
  };

  if (res.error && !b) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!b) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the bill…</p></div>;
  const open = b.status !== 'cancelled';
  const removed = b.lines.filter((l) => l.removed);
  const printItems = [
    { label: 'Print the bill', icon: Printer, onSelect: () => setPrinting({}) },
    ...b.payments.map((p) => ({ label: `Print receipt ${p.receipt}`, icon: Printer, onSelect: () => setPrinting({ receipt: p.receipt }) })),
    // The claim forms: for a bill with charges that is not cancelled
    ...(open && b.items > 0 ? Object.entries(CLAIM_LAYOUTS).map(([layout, look]) => ({ label: look.menu, icon: FileText, onSelect: () => setPrinting({ claim: layout }) })) : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: b.number }]}
        title={`Bill ${b.number}`}
        documentTitle="Bill"
        badges={<BillStatus status={b.status} />}
        subtitle={[b.patient?.fullName, b.patient?.mrn, KIND_LABELS[b.kind], dayLabel(b.date)].filter(Boolean).join(' · ')}
        tabs={billingTabs(activeMembership.roles)}
        actions={
          <>
            <MenuButton className="btn btn-secondary" icon={Printer} label="Print" items={printItems} align="end" />
            {open && b.balance > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialog('upi')}>
                <Link2 aria-hidden="true" /> UPI payment link
              </button>
            )}
            {open && b.balance > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('pay')}>
                <Wallet aria-hidden="true" /> {takeMoneyLabel(b)}
              </button>
            )}
            {open && b.balance === 0 && b.stay?.inHospital && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('pay')}>
                <Wallet aria-hidden="true" /> Take a deposit
              </button>
            )}
            {open && b.balance < 0 && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('refund')}>
                <RotateCcw aria-hidden="true" /> Give money back
              </button>
            )}
          </>
        }
      />
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {b.cancelled && (
          <Alert type="warning" icon={Ban}>
            Cancelled by {b.cancelled.byName} on {formatDateTime(b.cancelled.at)}: {b.cancelled.reason}
          </Alert>
        )}
        {b.priceNotSet && (
          <Alert type="warning">
            Some items have no price yet (₹0). Ask the hospital admin to set them in the price list – the bill picks the price up by itself.
          </Alert>
        )}
        {/* The note reception sees on a bill of a record marked as a duplicate: the bill stays here; new charges go on the main record */}
        {b.patient?.duplicateOf && (
          <Alert type="info">
            This bill is on {b.patient.mrn}, which is marked as a duplicate of <Link to={`/patients/${b.patient.duplicateOf.id}`}>{b.patient.duplicateOf.mrn}</Link>. It stays
            on this record: settle it here. New charges go on the bills of {b.patient.duplicateOf.mrn}.
          </Alert>
        )}
        {b.patient && (
          <p className="hint">
            <Link to={`/patients/${b.patient.id}`}>Open {b.patient.fullName}'s record</Link>
            {b.stay ? ` · ${b.stay.ward || 'Ward not given'}${b.stay.bed ? `, bed ${b.stay.bed}` : ''} · admitted ${formatDateTime(b.stay.admittedAt)}${b.stay.dischargedAt ? ` · discharged ${formatDateTime(b.stay.dischargedAt)}` : ' · in hospital'}` : ''}
          </p>
        )}

        <section className="card bill-section" aria-labelledby="bill-items">
          <div className="row-between">
            <h2 id="bill-items">Items</h2>
            {open && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('add')}>
                <Plus aria-hidden="true" /> Add an item
              </button>
            )}
          </div>
          <table className="bill-lines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {b.lines
                .filter((l) => !l.removed)
                .map((l) => (
                  <tr key={l.id}>
                    <td data-label="Item">
                      {l.name}
                      <span className="muted bill-line-from">
                        {' '}
                        · {GROUP_LABELS[l.group]}
                        {l.doctorName ? ` · ${l.doctorName}` : ''}
                        {l.source === 'auto' ? ' · added by itself' : ` · added by ${l.addedByName}`}
                        {l.priceNotSet ? ' · price not set' : ''}
                      </span>
                    </td>
                    <td data-label="Qty" className="num">
                      {l.qty}
                    </td>
                    <td data-label="Rate" className="num">
                      {rupees(l.ratePaise)}
                    </td>
                    <td data-label="Amount" className="num">
                      {rupees(l.amountPaise)}
                    </td>
                    <td>
                      {open && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ remove: l })} aria-label={`Take ${l.name} off the bill`}>
                          Take off
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              {!b.items && (
                <tr>
                  <td colSpan={5} className="muted">
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="bill-sums">
            <tbody>
              <tr>
                <th scope="row">Subtotal</th>
                <td>{rupees(b.subtotal)}</td>
              </tr>
              <tr>
                <th scope="row">
                  Discount
                  {b.discountInfo ? <span className="muted"> ({b.discountInfo.mode === 'percent' ? `${b.discountInfo.value}%` : 'amount'} – {b.discountInfo.reason})</span> : ''}
                  {open && b.subtotal > 0 && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('discount')}>
                      {b.discountInfo ? 'Change' : 'Give a discount'}
                    </button>
                  )}
                </th>
                <td>{b.discount ? `−${rupees(b.discount)}` : rupees(0)}</td>
              </tr>
              <tr>
                <th scope="row">Total</th>
                <td>{rupees(b.total)}</td>
              </tr>
              <tr>
                <th scope="row">Paid</th>
                <td>{rupees(b.paid)}</td>
              </tr>
              <tr className="bill-balance">
                <th scope="row">{b.balance < 0 ? 'To give back' : 'Balance to pay'}</th>
                <td>{rupees(Math.abs(b.balance))}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <InsuranceSection bill={b} open={open} onEdit={() => setDialog('insurance')} />

        <section className="card bill-section" aria-labelledby="bill-payments">
          <h2 id="bill-payments">Payments</h2>
          {!b.payments.length && <p className="muted">Nothing paid yet.</p>}
          <ul className="appt-lines">
            {b.payments.map((p) => (
              <li key={p.id} className="bill-payment">
                <span>
                  <strong>
                    {PAYMENT_KIND_LABELS[p.kind]} {p.kind === 'refund' ? '−' : ''}
                    {rupees(p.amountPaise)}
                  </strong>{' '}
                  <span className="muted">
                    {MODE_LABELS[p.mode]}
                    {p.scheme ? ` · ${p.scheme}` : ''}
                    {p.reference ? ` · ${p.reference}` : ''} · {p.receipt} · {formatDateTime(p.at)} · {p.byName}
                  </span>
                </span>
                <button type="button" className="btn btn-link btn-sm" onClick={() => setPrinting({ receipt: p.receipt })}>
                  <Printer aria-hidden="true" /> Receipt
                </button>
              </li>
            ))}
          </ul>
        </section>

        {removed.length > 0 && (
          <section className="card bill-section" aria-labelledby="bill-removed">
            <h2 id="bill-removed">Taken off</h2>
            <ul className="appt-lines">
              {removed.map((l) => (
                <li key={l.id}>
                  <s>{l.name}</s> {rupees(l.amountPaise)}{' '}
                  <span className="muted">
                    – {l.removed.reason} ({l.removed.byName}, {formatDateTime(l.removed.at)})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {open && b.paid === 0 && (
          <p>
            <button type="button" className="btn btn-link btn-sm bill-cancel" onClick={() => setDialog('cancel')}>
              <Ban aria-hidden="true" /> Cancel this bill
            </button>
          </p>
        )}
      </div>

      {dialog === 'add' && <AddItemDialog bill={b} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === 'pay' || dialog === 'refund') && <PaymentDialog bill={b} refund={dialog === 'refund'} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'discount' && <DiscountDialog bill={b} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'insurance' && <InsuranceDialog bill={b} earlier={res.data?.earlierInsurance ?? null} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'upi' && <UpiLinkDialog bill={b} upiReady={Boolean(res.data?.upiReady)} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && (
        <ReasonDialog
          id="bill-cancel"
          title={`Cancel bill ${b.number}`}
          text="The bill is kept, marked cancelled. A new charge for her today opens a new bill."
          label="Why is it cancelled"
          confirmLabel="Cancel the bill"
          path={`/billing/bills/${b.id}/cancel`}
          message="The bill was cancelled."
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.remove && (
        <ReasonDialog
          id="bill-remove"
          title={`Take "${dialog.remove.name}" off`}
          text={b.paid > 0 ? 'If it was already paid for, the bill will show the money to give back.' : null}
          label="Why"
          confirmLabel="Take it off"
          path={`/billing/bills/${b.id}/lines/${dialog.remove.id}/remove`}
          message={`${dialog.remove.name} was taken off.`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {printing && !printing.claim && <BillPrint bill={b} receipt={printing.receipt ?? null} onClose={() => setPrinting(null)} />}
      {printing?.claim && <ClaimFormPrint bill={b} layout={printing.claim} onClose={() => setPrinting(null)} />}
    </>
  );
}

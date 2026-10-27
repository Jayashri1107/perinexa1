import { useState } from 'react';
import { BadgePercent, Ban, CircleAlert, FileText, History, Link2, Minus, PencilLine, Plus, Printer, RotateCcw, Search, Tag, Wallet, X } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { blobToBase64 } from '../visits/whatsapp.js';
import { ClaimFormPrint, InsuranceDialog, InsuranceSection, UpiLinkDialog } from './BillingExtras.jsx';
import { BillStatus } from './BillsPage.jsx';
import { TallyMarks } from './TallyPage.jsx';
import { CLAIM_LAYOUTS, GROUP_LABELS, KIND_LABELS, MODE_LABELS, NO_SEX_WORDS_HINT, PAYMENT_KIND_LABELS, billingTabs, claimNumberHint, rupees, takeMoneyLabel, toInput, toPaise } from './billingFormat.js';
import { Modal, useSend } from './billingUi.jsx';
import { amountInWords } from './amountWords.js';

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

/** The time of day of an instant (HH:MM, 24 hours) – for the correction's time box. */
const hhmm = (at) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)); // as the times on screen
/** "₹500 by UPI (ref …)" – what a payment is or was. */
const paidAs = (x) => `${rupees(x.amountPaise)} by ${MODE_LABELS[x.mode]}${x.scheme ? ` (${x.scheme})` : ''}${x.reference ? `, ref ${x.reference}` : ''}`;

/**
 * Correct a payment (owner, 19 Oct 2026 – docs/BILL_CORRECTIONS_PLAN.md): e.g. the UPI payment failed and she paid in
 * cash. What it was is kept and shown; a reason always; the receipt keeps its number and prints "Corrected".
 */
function CorrectPaymentDialog({ bill, payment: p, onClose, onDone }) {
  const [amount, setAmount] = useState(toInput(p.amountPaise));
  const [mode, setMode] = useState(p.mode);
  const [reference, setReference] = useState(p.reference);
  const [scheme, setScheme] = useState(p.scheme);
  const [time, setTime] = useState(hhmm(p.at));
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  const paise = toPaise(amount);
  const insured = mode === 'insurance';
  const ready = paise > 0 && reason.trim().length >= 3 && /^\d\d:\d\d$/.test(time) && (!insured || scheme.trim().length >= 2);
  return (
    <Modal id="bill-correct" title={`Correct ${PAYMENT_KIND_LABELS[p.kind].toLowerCase()} ${p.receipt}`} onClose={onClose}>
      <p>
        Recorded as <strong>{paidAs(p)}</strong> at {formatDateTime(p.at)} by {p.byName}. Change what is wrong – for example a UPI payment that failed and was
        then paid in cash. What it was stays on the bill with your reason.
      </p>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Amount (₹)" id="bill-corr-amount" error={s.fields.amountPaise}>
          <input id="bill-corr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={p.kind === 'refund' ? 'Given back by' : 'Paid by'} id="bill-corr-mode">
          <select id="bill-corr-mode" value={mode} onChange={(e) => setMode(e.target.value)} autoFocus>
            {Object.entries(MODE_LABELS)
              .filter(([m]) => p.kind !== 'refund' || m !== 'insurance')
              .map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Time (same day)" id="bill-corr-time" error={s.fields.time}>
          <input id="bill-corr-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {insured && (
        <Field label="Insurance company or scheme" id="bill-corr-scheme" error={s.fields.scheme}>
          <input id="bill-corr-scheme" value={scheme} maxLength={80} onChange={(e) => setScheme(e.target.value)} />
        </Field>
      )}
      {mode !== 'cash' && (
        <Field label={insured ? 'Claim number (optional)' : `${MODE_LABELS[mode]} reference (optional)`} id="bill-corr-ref" error={s.fields.reference} hint="The number of the payment. No names of people.">
          <input id="bill-corr-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
      )}
      <Field label="Why is it corrected" id="bill-corr-reason" error={s.fields.reason} hint={`For example: UPI failed, paid in cash. ${NO_SEX_WORDS_HINT}`}>
        <input id="bill-corr-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || s.busy}
          onClick={() =>
            s.send(
              `/billing/bills/${bill.id}/payments/${p.id}/correct`,
              { mode, amountPaise: paise, reference: mode === 'cash' ? '' : reference.trim(), scheme: insured ? scheme.trim() : '', time, reason: reason.trim() },
              (res) => `Receipt ${res.payment.receipt} corrected: ${paidAs(res.payment)}. Print the receipt again for the patient.`,
            )
          }
        >
          <PencilLine aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save the correction'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Set the price of an item with no price yet (the hospital admin): the price list changes, and the bill takes it. */
function SetPriceDialog({ bill, line, onClose, onDone }) {
  const prices = useFetch('/billing/prices');
  const item = (prices.data?.items ?? []).find((i) => (line.priceItemId ? i.id === line.priceItemId : line.key && i.key === line.key));
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const paise = toPaise(amount);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/billing/prices/${item.id}`, { method: 'PATCH', body: { pricePaise: paise } });
      const fresh = await api(`/billing/bills/${bill.id}`);
      onDone(fresh, `${item.name}: ${rupees(paise)} in the price list.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="bill-set-price" title={`Set the price of ${line.name}`} onClose={onClose}>
      <p>This changes the hospital's price list: this bill, and every bill from now on, uses the new price.</p>
      <Alert type="error">{error || prices.error}</Alert>
      {prices.data && !item && <Alert type="warning">This item is not in the price list. Set it in Billing → Price list.</Alert>}
      <Field label="Price (₹)" id="bill-set-price-amount">
        <input id="bill-set-price-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!item || !(paise > 0) || busy} onClick={save}>
          <Tag aria-hidden="true" /> {busy ? 'Saving…' : 'Save the price'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The bill's live items by service group, in the price list's order (the printed bill's sections). */
function linesByGroup(lines) {
  const known = Object.keys(GROUP_LABELS);
  const groups = known.map((g) => ({ group: g, lines: lines.filter((l) => l.group === g) }));
  const rest = lines.filter((l) => !known.includes(l.group));
  return [...groups, { group: 'more', lines: rest }].filter((x) => x.lines.length);
}

/**
 * The printed bill (A5), or one receipt – laid out as the hospital's own OPD receipt (owner, 27 Oct 2026): the patient,
 * her consultant and department on the left, the bill's numbers on the right; the services by group with doctor, rate,
 * unit and amount; the sums, how it was paid and the amount in words; the hospital's notes and the signature.
 */
function BillPrint({ bill, receipt = null, notes = '', onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const { user } = useAuth();
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
  const modes = [...new Set(bill.payments.filter((p) => p.kind !== 'refund').map((p) => MODE_LABELS[p.mode]))].join(', ');
  const received = payment ? payment.amountPaise : Math.max(0, bill.paid);
  const noteLines = notes
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  const title = receipt ? (payment?.corrections?.length ? 'Receipt (corrected)' : 'Receipt') : bill.kind === 'ipd' ? 'IPD Bill' : 'OPD Receipt';
  let n = 0; // the items' numbers, across the groups
  return (
    <PrintPreview
      title={receipt ? 'Receipt – print preview' : 'Bill – print preview'}
      hint="Check it, then print on A5 paper – or save it as a PDF."
      page={{ size: 'A5', margin: '10mm' }}
      pdf={pdf}
      docKey={lh.data ? `${bill.id}-${receipt ?? ''}` : null}
      onPrint={record}
      onClose={onClose}
    >
      <PrintDocument className="bill-doc">
        {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} centered />}
        <div className="bill-doc-titlebar">
          <h1 className="pdoc-title">{title}</h1>
          <span className="pdoc-small">Print date {formatDateTime(new Date())}</span>
        </div>
        <div className="bill-doc-box">
          <table className="bill-doc-head">
            <tbody>
              <tr>
                <th scope="row">Patient name</th>
                <td>{bill.patient?.fullName}</td>
                <th scope="row">{receipt ? 'Receipt no.' : 'Bill no.'}</th>
                <td>{receipt ?? bill.number}</td>
              </tr>
              <tr>
                <th scope="row">Age</th>
                <td>{bill.patient?.age != null ? `${bill.patient.age} Y` : ''}</td>
                <th scope="row">{receipt ? 'Date' : 'Bill date'}</th>
                <td>{payment ? formatDateTime(payment.at) : dayLabel(bill.date)}</td>
              </tr>
              <tr>
                <th scope="row">Consultant</th>
                <td>{bill.doctorName}</td>
                <th scope="row">Reg. no.</th>
                <td>{bill.patient?.mrn}</td>
              </tr>
              <tr>
                <th scope="row">Department</th>
                <td>{bill.doctorDepartment}</td>
                <th scope="row">Mob. no.</th>
                <td>{bill.patient?.phone}</td>
              </tr>
              {receipt && (
                <tr>
                  <th scope="row" />
                  <td />
                  <th scope="row">Bill no.</th>
                  <td>{bill.number}</td>
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
              Received {rupees(payment.amountPaise)} by {MODE_LABELS[payment.mode]}
              {payment.scheme ? ` (${payment.scheme})` : ''}
              {payment.reference ? `, reference ${payment.reference}` : ''}
              {payment.kind === 'deposit' ? ', as a deposit' : ''}
              {payment.kind === 'refund' ? ' – refunded to the patient' : ''}.
            </p>
          ) : (
            <table className="bill-doc-lines">
              <thead>
                <tr>
                  <th scope="col">Sr. no.</th>
                  <th scope="col">Service description</th>
                  <th scope="col">Doctor name</th>
                  <th scope="col" className="num">
                    Rate
                  </th>
                  <th scope="col" className="num">
                    Unit
                  </th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              {linesByGroup(lines).map((g) => (
                <tbody key={g.group}>
                  <tr className="bill-doc-group">
                    <td />
                    <th scope="rowgroup" colSpan={5}>
                      {GROUP_LABELS[g.group] ?? 'Other'} charges
                    </th>
                  </tr>
                  {g.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{(n += 1)}</td>
                      <td>{l.name}</td>
                      <td>{l.doctorName}</td>
                      <td className="num">{rupees(l.ratePaise)}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{rupees(l.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
          {payment?.corrections?.length ? (
            <p className="pdoc-small bill-doc-corrected">
              {payment.corrections.map((c, i) => (
                <span key={i}>
                  Corrected on {formatDateTime(c.at)} by {c.byName}: was {paidAs(c.before)} at {formatDateTime(c.before.at)}. Reason: {c.reason}.{' '}
                </span>
              ))}
            </p>
          ) : null}
          <table className="bill-doc-sums">
            <tbody>
              <tr>
                <th scope="row">Bill amount</th>
                <td>{rupees(bill.subtotal ?? bill.total)}</td>
              </tr>
              {bill.discount > 0 && (
                <tr>
                  <th scope="row">Discount</th>
                  <td>−{rupees(bill.discount)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Net payable amount</th>
                <td>{rupees(bill.total)}</td>
              </tr>
              <tr>
                <th scope="row">Paid amount</th>
                <td>{rupees(bill.paid)}</td>
              </tr>
              {(payment || modes) && (
                <tr>
                  <th scope="row">Payment mode</th>
                  <td>{payment ? MODE_LABELS[payment.mode] : modes}</td>
                </tr>
              )}
              {bill.balance !== 0 && (
                <tr className="bill-doc-balance">
                  <th scope="row">{bill.balance < 0 ? 'Due back' : 'Balance'}</th>
                  <td>{rupees(Math.abs(bill.balance))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {received > 0 && payment?.kind !== 'refund' && (
          <p className="bill-doc-words">
            <strong>Received with thanks:</strong> {amountInWords(received)}
          </p>
        )}
        {!payment && bill.payments.length > 1 && (
          <p className="pdoc-small">
            Payments: {bill.payments.map((p) => `${p.receipt} ${PAYMENT_KIND_LABELS[p.kind].toLowerCase()} ${rupees(p.amountPaise)} (${MODE_LABELS[p.mode]}${p.corrections?.length ? ', corrected' : ''})`).join('; ')}.
          </p>
        )}
        <div className="bill-doc-foot">
          {noteLines.length > 0 ? (
            <ol className="bill-doc-notes">
              {noteLines.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          ) : (
            <span />
          )}
          <div className="bill-doc-sign">
            <strong>Signature</strong>
            <span>{user?.name}</span>
          </div>
        </div>
        <p className="pdoc-small">This is a computer-generated {receipt ? 'receipt' : 'bill'}.</p>
      </PrintDocument>
    </PrintPreview>
  );
}

/**
 * The bill as a hospital bill (owner, 19 Oct 2026 – docs/BILL_CORRECTIONS_PLAN.md): the bill's details at the top; the
 * items as a numbered table (item, category, doctor, qty, rate, amount) with the totals beside it; then the payments as a
 * table with their receipts and corrections; insurance and what was taken off below.
 */
export function BillPage() {
  const { id } = useParams();
  const { activeMembership } = useAuth();
  const res = useFetch(`/billing/bills/${id}`);
  const corr = useFetch(`/billing/bills/${id}/corrections`);
  const [bill, setBill] = useState(null);
  // add | pay | refund | discount | cancel | insurance | upi | { remove: line } | { correct: payment } | { price: line };
  // ?pay=1 (Take payment on the Bills list) opens pay
  const { search: query } = useLocation();
  const [dialog, setDialog] = useState(() => (new URLSearchParams(query).get('pay') === '1' ? 'pay' : null));
  const [printing, setPrinting] = useState(null); // { receipt? } | { claim: 'claim' | 'pmjay' }
  const [flash, setFlash] = useState(null);
  const b = bill ?? res.data?.bill;
  const done = (out, message, { keepOpen = false } = {}) => {
    setBill(out.bill);
    corr.reload();
    if (keepOpen) return;
    setDialog(null);
    setFlash(message ?? null);
  };

  if (res.error && !b) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!b) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the bill…</p></div>;
  const open = b.status !== 'cancelled';
  const isAdmin = (activeMembership?.roles ?? []).includes('admin');
  const lines = b.lines.filter((l) => !l.removed);
  const removed = b.lines.filter((l) => l.removed);
  const unpriced = lines.filter((l) => l.priceNotSet).length;
  const canCorrect = (p) => open && (corr.data?.correctableBy?.[p.id] === 'desk' || corr.data?.isAdmin);
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
        subtitle={[b.patient?.fullName, b.patient?.mrn].filter(Boolean).join(' · ')}
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
        {/* The note reception sees on a bill of a record marked as a duplicate: the bill stays here; new charges go on the main record */}
        {b.patient?.duplicateOf && (
          <Alert type="info">
            This bill is on {b.patient.mrn}, which is marked as a duplicate of <Link to={`/patients/${b.patient.duplicateOf.id}`}>{b.patient.duplicateOf.mrn}</Link>. It stays
            on this record: settle it here. New charges go on the bills of {b.patient.duplicateOf.mrn}.
          </Alert>
        )}

        <section className="card bill-head" aria-label="Bill details">
          <dl className="bill-head-grid">
            <div>
              <dt>Patient</dt>
              <dd>{b.patient ? <Link to={`/patients/${b.patient.id}`}>{b.patient.fullName}</Link> : '–'}</dd>
            </div>
            <div>
              <dt>Patient no.</dt>
              <dd className="tabular">{b.patient?.mrn ?? '–'}</dd>
            </div>
            <div>
              <dt>Bill type</dt>
              <dd>{b.kind === 'ipd' ? 'IPD – inpatient' : 'OPD – outpatient'}</dd>
            </div>
            <div>
              <dt>Doctor</dt>
              <dd>{b.doctorName || '–'}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{dayLabel(b.date)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <BillStatus status={b.status} />
              </dd>
            </div>
            {b.stay && (
              <>
                <div>
                  <dt>Ward and bed</dt>
                  <dd>{[b.stay.ward || 'Ward not given', b.stay.bed ? `bed ${b.stay.bed}` : ''].filter(Boolean).join(', ')}</dd>
                </div>
                <div>
                  <dt>Admitted</dt>
                  <dd>{formatDateTime(b.stay.admittedAt)}</dd>
                </div>
                <div>
                  <dt>Discharged</dt>
                  <dd>{b.stay.dischargedAt ? formatDateTime(b.stay.dischargedAt) : 'In hospital'}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <div className="bill-body">
          <section className="card bill-section bill-items" aria-labelledby="bill-items">
            <div className="row-between">
              <h2 id="bill-items">
                Items <span className="muted">· {lines.length}</span>
              </h2>
              {open && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('add')}>
                  <Plus aria-hidden="true" /> Add items
                </button>
              )}
            </div>
            {unpriced > 0 && (
              <p className="bill-unpriced-note">
                <CircleAlert aria-hidden="true" /> {unpriced} item{unpriced > 1 ? 's have' : ' has'} no price yet (₹0).{' '}
                {isAdmin ? 'Set the price on the item below.' : 'Ask the hospital admin to set it in the price list – the bill takes it by itself.'}
              </p>
            )}
            <div className="bill-table-wrap">
              <table className="bill-lines">
                <thead>
                  <tr>
                    <th scope="col" className="bill-col-no">
                      No.
                    </th>
                    <th scope="col">Item</th>
                    <th scope="col" className="bill-col-cat">
                      Category
                    </th>
                    <th scope="col" className="bill-col-doctor">
                      Doctor
                    </th>
                    <th scope="col" className="num">
                      Qty
                    </th>
                    <th scope="col" className="num">
                      Rate
                    </th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col" className="bill-col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id} className={l.priceNotSet ? 'is-unpriced' : ''}>
                      <td data-label="No." className="bill-col-no tabular">
                        {i + 1}
                      </td>
                      <td data-label="Item" className="bill-col-item">
                        <span className="bill-item-name">{l.name}</span>
                        <span className="muted bill-line-from">{l.source === 'auto' ? 'Added by itself' : `Added by ${l.addedByName}`}</span>
                        <span className="bill-item-cat muted">{GROUP_LABELS[l.group]}</span>
                        <span className="bill-item-qty muted">
                          Qty {l.qty} × {rupees(l.ratePaise)}
                          {l.doctorName ? ` · ${l.doctorName}` : ''}
                        </span>
                        {l.priceNotSet && (
                          <span className="bill-unpriced">
                            <StatusPill tone="watch" icon={CircleAlert}>
                              Price not set
                            </StatusPill>
                            {open && isAdmin && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ price: l })}>
                                <Tag aria-hidden="true" /> Set price
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      <td data-label="Category" className="bill-col-cat">
                        {GROUP_LABELS[l.group]}
                      </td>
                      <td data-label="Doctor" className="bill-col-doctor">{l.doctorName || <span className="muted">–</span>}</td>
                      <td data-label="Qty" className="num">
                        {l.qty}
                      </td>
                      <td data-label="Rate" className="num">
                        {rupees(l.ratePaise)}
                      </td>
                      <td data-label="Amount" className="num bill-col-amount">
                        {rupees(l.amountPaise)}
                      </td>
                      <td className="bill-col-actions">
                        {open && (
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ remove: l })} aria-label={`Take ${l.name} off the bill`}>
                            Take off
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!lines.length && (
                    <tr>
                      <td colSpan={8} className="muted">
                        No items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card bill-section bill-totals" aria-labelledby="bill-totals">
            <h2 id="bill-totals">Amount</h2>
            <table className="bill-sums">
              <tbody>
                <tr>
                  <th scope="row">Subtotal</th>
                  <td>{rupees(b.subtotal)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    Discount
                    {b.discountInfo ? <span className="muted bill-sum-note">{b.discountInfo.mode === 'percent' ? `${b.discountInfo.value}%` : 'Amount'} – {b.discountInfo.reason}</span> : null}
                  </th>
                  <td>{b.discount ? `−${rupees(b.discount)}` : rupees(0)}</td>
                </tr>
                <tr className="bill-total">
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
            {open && b.subtotal > 0 && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('discount')}>
                <BadgePercent aria-hidden="true" /> {b.discountInfo ? 'Change the discount' : 'Give a discount'}
              </button>
            )}
          </section>
        </div>

        {/* The Tally link: whether this bill went to the accountant's Tally (the hospital admin only) */}
        {activeMembership.roles.includes('admin') && <TallyMarks model="bill" id={b.id} />}
        <section className="card bill-section" aria-labelledby="bill-payments">
          <h2 id="bill-payments">
            Payments <span className="muted">· {b.payments.length}</span>
          </h2>
          {!b.payments.length ? (
            <p className="muted">Nothing paid yet.</p>
          ) : (
            <div className="bill-table-wrap">
              <table className="bill-lines bill-pay-table">
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Date and time</th>
                    <th scope="col">Type</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Reference</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Taken by</th>
                    <th scope="col" className="bill-col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {b.payments.map((p) => (
                    <PaymentRow key={p.id} p={p} canCorrect={canCorrect(p)} adminOnly={open && corr.data?.correctableBy?.[p.id] === 'admin' && !corr.data?.isAdmin} onPrint={() => setPrinting({ receipt: p.receipt })} onCorrect={() => setDialog({ correct: p })} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <InsuranceSection bill={b} open={open} onEdit={() => setDialog('insurance')} />

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
      {dialog?.correct && <CorrectPaymentDialog bill={b} payment={dialog.correct} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.price && <SetPriceDialog bill={b} line={dialog.price} onClose={() => setDialog(null)} onDone={done} />}
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
      {printing && !printing.claim && <BillPrint bill={b} receipt={printing.receipt ?? null} notes={res.data?.billNotes ?? ''} onClose={() => setPrinting(null)} />}
      {printing?.claim && <ClaimFormPrint bill={b} layout={printing.claim} onClose={() => setPrinting(null)} />}
    </>
  );
}

/** One payment in the payments table, with "Corrected" and what it was before. */
function PaymentRow({ p, canCorrect, adminOnly, onPrint, onCorrect }) {
  const [history, setHistory] = useState(false);
  const corrected = p.corrections?.length > 0;
  return (
    <>
      <tr>
        <td data-label="Receipt" className="tabular">
          {p.receipt}
          {corrected && (
            <StatusPill tone="due" icon={History}>
              Corrected
            </StatusPill>
          )}
        </td>
        <td data-label="Date and time">{formatDateTime(p.at)}</td>
        <td data-label="Type">{PAYMENT_KIND_LABELS[p.kind]}</td>
        <td data-label="Mode">
          {MODE_LABELS[p.mode]}
          {p.scheme ? <span className="muted bill-line-from">{p.scheme}</span> : null}
        </td>
        <td data-label="Reference">{p.reference || <span className="muted">–</span>}</td>
        <td data-label="Amount" className="num bill-col-amount">
          {p.kind === 'refund' ? '−' : ''}
          {rupees(p.amountPaise)}
        </td>
        <td data-label="Taken by">{p.byName}</td>
        <td className="bill-col-actions">
          <button type="button" className="btn btn-link btn-sm" onClick={onPrint} aria-label={`Print receipt ${p.receipt}`}>
            <Printer aria-hidden="true" /> Receipt
          </button>
          {canCorrect && (
            <button type="button" className="btn btn-link btn-sm" onClick={onCorrect} aria-label={`Correct ${p.receipt}`}>
              <PencilLine aria-hidden="true" /> Correct
            </button>
          )}
          {corrected && (
            <button type="button" className="btn btn-link btn-sm" aria-expanded={history} onClick={() => setHistory(!history)}>
              {history ? 'Hide history' : 'History'}
            </button>
          )}
        </td>
      </tr>
      {(history || adminOnly) && (
        <tr className="bill-pay-history">
          <td colSpan={8}>
            {adminOnly && <p className="hint">The day's cash handover is confirmed, or the day has passed: only the hospital admin corrects this payment now.</p>}
            {history && (
              <ul className="appt-lines">
                {p.corrections.map((c, i) => (
                  <li key={i}>
                    {formatDateTime(c.at)} · {c.byName}: was {paidAs(c.before)} at {formatDateTime(c.before.at)} – <em>{c.reason}</em>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

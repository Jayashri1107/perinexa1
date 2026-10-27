import { useState } from 'react';
import { CircleCheck, Receipt, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { GROUP_LABELS, rupees, toPaise } from './billingFormat.js';

// Service charges for a registered patient (owner, 27 Oct 2026): one or more services from the price list onto today's
// bill, and how she pays – Cash, UPI, Card, or Later at the billing desk. Patients → OPD → Add service charge, and the
// registration form (charged once she is saved). The same endpoints as Billing (POST /billing/bills, lines, payments).

export const PAY_CHOICES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['later', 'Later'],
];
let seq = 0;

const rateOf = (x) => (x.item.pricePaise ? x.item.pricePaise : toPaise(x.rate));
/** Every chosen service has an amount (a priced one keeps its price). */
export const chargesOk = (lines) => lines.every((x) => rateOf(x) > 0);
export const chargesTotal = (lines) => (chargesOk(lines) ? lines.reduce((s, x) => s + rateOf(x), 0) : 0);

/** The price list's items a service charge may use (not the inpatient ones), or null while loading. */
export function useChargeItems(enabled = true) {
  const prices = useFetch(enabled ? '/billing/prices' : null);
  return { items: prices.data ? prices.data.items.filter((i) => i.active && i.group !== 'inpatient') : null, error: prices.error };
}

/**
 * Puts the services on her bill for today (with the doctor they are for, when given) and, unless paid later, records
 * the payment. Returns the bill. If adding the services worked but the payment did not, the error carries `bill`.
 */
export async function billCharges(patientId, lines, pay, existingBill = null, doctorId = null) {
  let bill = existingBill;
  if (!bill) {
    ({ bill } = await api('/billing/bills', { method: 'POST', body: { patientId } }));
    for (const x of lines) {
      // A priced item keeps its price; an item with none takes the amount typed
      ({ bill } = await api(`/billing/bills/${bill.id}/lines`, { method: 'POST', body: { priceItemId: x.item.id, qty: 1, ...(x.item.pricePaise ? {} : { ratePaise: rateOf(x) }), ...(doctorId ? { doctorId } : {}) } }));
    }
  }
  try {
    if (pay !== 'later' && bill.balance > 0) ({ bill } = await api(`/billing/bills/${bill.id}/payments`, { method: 'POST', body: { mode: pay, amountPaise: Math.min(bill.balance, chargesTotal(lines)) } }));
  } catch (err) {
    throw Object.assign(err, { bill });
  }
  return bill;
}

/** The chosen services (lines: [{ key, item, rate }]), a list to add another, the total and how she pays. */
export function ChargeLines({ items, lines, onLines, pay, onPay, locked = false, idPrefix = 'svc' }) {
  const total = chargesTotal(lines);
  return (
    <>
      <div className="fu-bb-fee">
        {lines.map((x) => (
          <div key={x.key} className="fu-bb-extra">
            <span>{x.item.name}</span>
            {x.item.pricePaise ? (
              <span className="tabular">{rupees(x.item.pricePaise)}</span>
            ) : (
              <input className="ph-num" aria-label={`Amount for ${x.item.name}`} inputMode="decimal" placeholder="₹" disabled={locked} value={x.rate} onChange={(e) => onLines(lines.map((y) => (y.key === x.key ? { ...y, rate: e.target.value } : y)))} />
            )}
            {!locked && (
              <button type="button" className="icon-btn" aria-label={`Remove ${x.item.name}`} onClick={() => onLines(lines.filter((y) => y.key !== x.key))}>
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <div className="fu-bb-add">
            <label className="field-label" htmlFor={`${idPrefix}-item`}>
              {lines.length ? 'Add another service' : 'Choose a service'}
            </label>
            <select
              id={`${idPrefix}-item`}
              value=""
              onChange={(e) => {
                const item = items?.find((i) => i.id === e.target.value);
                if (item) onLines([...lines, { key: `s${(seq += 1)}`, item, rate: '' }]);
              }}
            >
              <option value="">{items ? 'Choose from the price list…' : 'Loading the price list…'}</option>
              {Object.entries(GROUP_LABELS)
                .filter(([g]) => items?.some((i) => i.group === g))
                .map(([g, label]) => (
                  <optgroup key={g} label={label}>
                    {items
                      .filter((i) => i.group === g)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.pricePaise ? ` – ${rupees(i.pricePaise)}` : ''}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </div>
        )}
      </div>
      {total > 0 && (
        <div className="fu-bb-pay">
          <span className="fu-bb-total">
            Total <strong className="tabular">{rupees(total)}</strong>
          </span>
          <div className="segmented" role="group" aria-label="Paid by">
            {PAY_CHOICES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={pay === k} onClick={() => onPay(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {total > 0 && pay === 'later' && <p className="hint">The charges go on today's bill; she pays at the billing desk.</p>}
    </>
  );
}

/** One line on what was billed: "Bill B-000020: ₹450, paid." */
export const billedText = (bill) => `Bill ${bill.number}: ${rupees(bill.total)}${bill.balance > 0 ? `, ${rupees(bill.balance)} to pay at the billing desk.` : ', paid.'}`;

export function ServiceChargeDialog({ patient, onClose }) {
  const ref = useDialogFocus(onClose);
  const { items, error: pricesError } = useChargeItems();
  const [lines, setLines] = useState([]);
  const [pay, setPay] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bill, setBill] = useState(null); // the bill once the services are on it (kept if the payment fails)
  const [done, setDone] = useState(false);
  const total = chargesTotal(lines);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setBill(await billCharges(patient.id, lines, pay, bill));
      setDone(true);
    } catch (err) {
      if (err.bill) setBill(err.bill);
      setError(err.bill ? `The charges are on bill ${err.bill.number}, but the payment could not be saved: ${err.message} Press the button again, or finish it under Billing.` : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide fu-bookbill" role="dialog" aria-modal="true" aria-labelledby="svc-title">
        <h2 id="svc-title">Add service charge</h2>
        <p className="fu-bb-who">
          <strong>{patient.fullName}</strong>
          <span className="muted">
            {patient.mrn}
            {patient.phone ? ` · ${patient.phone}` : ''}
          </span>
        </p>

        {done ? (
          <div className="fu-bb-done" role="status">
            <p>
              <CircleCheck aria-hidden="true" /> {billedText(bill)}
            </p>
            <div className="row">
              <Link className="btn btn-secondary" to={`/billing/bills/${bill.id}`}>
                <Receipt aria-hidden="true" /> Open the bill
              </Link>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <Alert type="error">{error ?? pricesError}</Alert>
            <section className="fu-bb-step" aria-labelledby="svc-services">
              <h3 id="svc-services">Services</h3>
              <ChargeLines items={items} lines={lines} onLines={setLines} pay={pay} onPay={setPay} locked={Boolean(bill)} />
            </section>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!lines.length || !chargesOk(lines) || busy} onClick={run}>
                <Receipt aria-hidden="true" /> {busy ? 'Saving…' : bill ? 'Save the payment' : total > 0 ? `Add to bill · ${rupees(total)}` : 'Add to bill'}
              </button>
              <button type="button" className="btn btn-link" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

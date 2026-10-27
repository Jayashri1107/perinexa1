import { useState } from 'react';
import { CircleCheck, Receipt, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { GROUP_LABELS, rupees, toPaise } from './billingFormat.js';

// Patients → OPD → Add service charge (owner, 27 Oct 2026): for a registered patient, one or more services from the
// price list onto today's bill, and how she pays – Cash, UPI, Card, or Later at the billing desk. The same endpoints as
// Billing (POST /billing/bills, its lines and payments); if a step fails, what was already done is said.

const PAY_CHOICES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['later', 'Later'],
];
let seq = 0;

export function ServiceChargeDialog({ patient, onClose }) {
  const ref = useDialogFocus(onClose);
  const prices = useFetch('/billing/prices');
  const items = (prices.data?.items ?? []).filter((i) => i.active && i.group !== 'inpatient');
  const [lines, setLines] = useState([]); // { key, item, rate }
  const [pay, setPay] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bill, setBill] = useState(null); // the bill once made (kept if a later step fails)
  const [done, setDone] = useState(false);

  const rateOf = (x) => (x.item.pricePaise ? x.item.pricePaise : toPaise(x.rate));
  const linesOk = lines.length > 0 && lines.every((x) => rateOf(x) > 0);
  const total = linesOk ? lines.reduce((s, x) => s + rateOf(x), 0) : 0;

  const run = async () => {
    setBusy(true);
    setError(null);
    let b = bill;
    try {
      if (!b) {
        ({ bill: b } = await api('/billing/bills', { method: 'POST', body: { patientId: patient.id } }));
        for (const x of lines) {
          // A priced item keeps its price; an item with none takes the amount typed
          ({ bill: b } = await api(`/billing/bills/${b.id}/lines`, { method: 'POST', body: { priceItemId: x.item.id, qty: 1, ...(x.item.pricePaise ? {} : { ratePaise: rateOf(x) }) } }));
        }
        setBill(b);
      }
      if (pay !== 'later' && b.balance > 0) ({ bill: b } = await api(`/billing/bills/${b.id}/payments`, { method: 'POST', body: { mode: pay, amountPaise: Math.min(b.balance, total) } }));
      setBill(b);
      setDone(true);
    } catch (err) {
      setError(b ? `The charges are on bill ${b.number}, but the payment could not be saved: ${err.message} Press the button again, or finish it under Billing.` : err.message);
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
              <CircleCheck aria-hidden="true" /> Bill {bill.number}: {rupees(bill.total)}
              {bill.balance > 0 ? `, ${rupees(bill.balance)} to pay at the billing desk.` : ', paid.'}
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
            <Alert type="error">{error ?? prices.error}</Alert>
            <section className="fu-bb-step" aria-labelledby="svc-services">
              <h3 id="svc-services">Services</h3>
              <div className="fu-bb-fee">
                {lines.map((x) => (
                  <div key={x.key} className="fu-bb-extra">
                    <span>{x.item.name}</span>
                    {x.item.pricePaise ? (
                      <span className="tabular">{rupees(x.item.pricePaise)}</span>
                    ) : (
                      <input className="ph-num" aria-label={`Amount for ${x.item.name}`} inputMode="decimal" placeholder="₹" disabled={Boolean(bill)} value={x.rate} onChange={(e) => setLines(lines.map((y) => (y.key === x.key ? { ...y, rate: e.target.value } : y)))} />
                    )}
                    {!bill && (
                      <button type="button" className="icon-btn" aria-label={`Remove ${x.item.name}`} onClick={() => setLines(lines.filter((y) => y.key !== x.key))}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {!bill && (
                  <div className="fu-bb-add">
                    <label className="field-label" htmlFor="svc-item">
                      {lines.length ? 'Add another service' : 'Choose a service'}
                    </label>
                    <select
                      id="svc-item"
                      value=""
                      onChange={(e) => {
                        const item = items.find((i) => i.id === e.target.value);
                        if (item) setLines([...lines, { key: `s${(seq += 1)}`, item, rate: '' }]);
                      }}
                    >
                      <option value="">{prices.data ? 'Choose from the price list…' : 'Loading the price list…'}</option>
                      {Object.entries(GROUP_LABELS)
                        .filter(([g]) => items.some((i) => i.group === g))
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
                      <button key={k} type="button" aria-pressed={pay === k} onClick={() => setPay(k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {total > 0 && pay === 'later' && <p className="hint">The charges go on today's bill now; she pays at the billing desk.</p>}
            </section>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!linesOk || busy} onClick={run}>
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

import { useState } from 'react';
import { CalendarCheck, CircleCheck, Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { SlotChooser } from '../appointments/AppointmentDialogs.jsx';
import { PURPOSE_LABELS, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';
import { GROUP_LABELS, MODE_LABELS, rupees, toPaise } from '../billing/billingFormat.js';

// Follow-ups → Book (owner, 26 Oct 2026): one popup to book her visit, add the charges from the price list and make the
// bill – with the payment if she pays now – without leaving the Follow-ups page. The steps use the same endpoints as
// Appointments and Billing (POST /appointments, /billing/bills, its lines and payments), in that order; if one fails,
// what was already done is said. "Only the bill" skips the booking (she is already booked, or is here now).

const COUNTER_MODES = ['cash', 'upi', 'card'];
let seq = 0;

/** who: { patient, doctorId?, purpose?, note?, from? } – a follow-up added by hand, or a patient to call. */
export function BookAndBillDialog({ who, today, onClose, onDone }) {
  const ref = useDialogFocus(onClose);
  const p = who.patient;
  const doctors = useFetch('/appointments/doctors');
  const prices = useFetch('/billing/prices');
  const list = doctors.data?.doctors ?? [];
  const own = list.find((d) => d.id === who.doctorId) ?? list.find((d) => d.name === p.doctorName);
  const [doctorId, setDoctorId] = useState('');
  const chosenDoctor = doctorId || own?.id || list[0]?.id || '';
  const [date, setDate] = useState(who.from && who.from > today ? who.from : today);
  const [start, setStart] = useState(null);
  const [onlyBill, setOnlyBill] = useState(false);
  const items = (prices.data?.items ?? []).filter((i) => i.active && i.group !== 'inpatient');
  // The charges: the follow-up consultation to start with (changeable)
  const [lines, setLines] = useState(null);
  const followFee = items.find((i) => i.key === 'consult_follow');
  const shown = lines ?? (followFee ? [{ key: 'first', item: followFee, qty: '1', rate: '' }] : []);
  const [adding, setAdding] = useState('');
  const [pay, setPay] = useState(true);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [done, setDone] = useState(null);

  const setLine = (key, field, value) => setLines(shown.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const rateOf = (l) => (l.item.pricePaise ? l.item.pricePaise : toPaise(l.rate));
  const qtyOf = (l) => (/^\d+$/.test(l.qty) && Number(l.qty) > 0 ? Number(l.qty) : null);
  const linesOk = shown.length > 0 && shown.every((l) => qtyOf(l) && rateOf(l) > 0);
  const total = linesOk ? shown.reduce((s, l) => s + rateOf(l) * qtyOf(l), 0) : 0;
  const payPaise = amount === null ? total : toPaise(amount);
  const payOk = !pay || (payPaise > 0 && payPaise <= total);
  const ready = chosenDoctor && (onlyBill || start) && linesOk && payOk && !busy;
  const doctor = list.find((d) => d.id === chosenDoctor);

  const run = async (confirm = false) => {
    setBusy(true);
    setError(null);
    let booked = done?.appointment ?? null;
    try {
      if (!onlyBill && !booked) {
        try {
          booked = (await api('/appointments', { method: 'POST', body: { doctorId: chosenDoctor, date, start, visitType: 'follow_up', confirm, patientId: p.id } })).appointment;
        } catch (err) {
          if (err.status === 409 && ['SLOT_TAKEN', 'ALREADY_BOOKED'].includes(err.code)) {
            setWarning(err.message);
            setBusy(false);
            return;
          }
          throw err;
        }
        setWarning(null);
      }
      let { bill } = await api('/billing/bills', { method: 'POST', body: { patientId: p.id } });
      for (const l of shown) {
        ({ bill } = await api(`/billing/bills/${bill.id}/lines`, {
          method: 'POST',
          body: { priceItemId: l.item.id, qty: qtyOf(l), ...(l.item.pricePaise ? {} : { ratePaise: rateOf(l) }), ...(chosenDoctor && l.item.group === 'consultation' ? { doctorId: chosenDoctor } : {}) },
        }));
      }
      if (pay) ({ bill } = await api(`/billing/bills/${bill.id}/payments`, { method: 'POST', body: { mode, amountPaise: payPaise, reference: mode === 'cash' ? '' : reference.trim() } }));
      setDone({ appointment: booked, bill });
    } catch (err) {
      setDone(booked ? { appointment: booked, bill: null } : null);
      setError(booked ? `The visit is booked, but the bill could not be finished: ${err.message} Open Billing to finish it.` : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide fu-bookbill" role="dialog" aria-modal="true" aria-labelledby="fu-bb-title">
        <h2 id="fu-bb-title">Book and bill</h2>
        <p className="fu-bb-who">
          <strong>{p.fullName}</strong>
          <span className="muted">
            {p.mrn}
            {p.phone ? ` · ${p.phone}` : ''}
            {who.purpose ? ` · ${PURPOSE_LABELS[who.purpose]}${who.note ? `: ${who.note}` : ''}` : ''}
          </span>
        </p>

        {done?.bill ? (
          <div className="fu-bb-done" role="status">
            <p>
              <CircleCheck aria-hidden="true" />{' '}
              {done.appointment ? `Booked: ${dayLabel(done.appointment.date)}${done.appointment.start ? `, ${timeLabel(done.appointment.start)}` : ''} with ${doctor?.name ?? 'the doctor'}. ` : ''}
              Bill {done.bill.number}: {rupees(done.bill.total)}
              {done.bill.balance > 0 ? `, ${rupees(done.bill.balance)} still to pay` : ', paid in full'}.
            </p>
            <div className="row">
              <Link className="btn btn-secondary" to={`/billing/bills/${done.bill.id}`}>
                <Receipt aria-hidden="true" /> Open the bill
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => onDone(done)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <Alert type="error">{error ?? doctors.error ?? prices.error}</Alert>

            <section className="fu-bb-step" aria-labelledby="fu-bb-visit">
              <h3 id="fu-bb-visit">1. The visit</h3>
              <div className="form-grid">
                <Field label="Doctor" id="fu-bb-doctor">
                  <select
                    id="fu-bb-doctor"
                    value={chosenDoctor}
                    onChange={(e) => {
                      setDoctorId(e.target.value);
                      setStart(null);
                    }}
                  >
                    {list.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {!onlyBill && (
                  <Field label="Day" id="fu-bb-date">
                    <input
                      id="fu-bb-date"
                      type="date"
                      value={date}
                      min={today}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setStart(null);
                      }}
                    />
                  </Field>
                )}
              </div>
              <label className="appt-reason">
                <input type="checkbox" checked={onlyBill} onChange={(e) => setOnlyBill(e.target.checked)} disabled={Boolean(done?.appointment)} /> Only the bill – no booking (she is already booked, or is here now)
              </label>
              {!onlyBill && !done?.appointment && <SlotChooser doctorId={chosenDoctor} date={date} value={start} onChange={setStart} />}
              {done?.appointment && <p className="hint">Booked already – finishing the bill.</p>}
            </section>

            <section className="fu-bb-step" aria-labelledby="fu-bb-charges">
              <h3 id="fu-bb-charges">2. Charges</h3>
              {shown.length > 0 && (
                <table className="bill-lines fu-bb-lines">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Rate ₹</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.key}>
                        <td data-label="Service">{l.item.name}</td>
                        <td data-label="Qty">
                          <input className="ph-num" aria-label={`Quantity of ${l.item.name}`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} />
                        </td>
                        <td data-label="Rate">
                          {l.item.pricePaise ? (
                            <span className="tabular">{rupees(l.item.pricePaise)}</span>
                          ) : (
                            <input className="ph-num" aria-label={`Amount for ${l.item.name}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, 'rate', e.target.value)} />
                          )}
                        </td>
                        <td data-label="Amount" className="num tabular">
                          {rateOf(l) && qtyOf(l) ? rupees(rateOf(l) * qtyOf(l)) : '—'}
                        </td>
                        <td>
                          <button type="button" className="icon-btn" aria-label={`Remove ${l.item.name}`} onClick={() => setLines(shown.filter((x) => x.key !== l.key))}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bill-report-total">
                      <th scope="row" colSpan={3}>
                        Total
                      </th>
                      <td className="num tabular">{rupees(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
              <div className="fu-bb-add">
                <label className="sr-only" htmlFor="fu-bb-item">
                  Add a service
                </label>
                <select id="fu-bb-item" value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Add a service from the price list…</option>
                  {Object.entries(GROUP_LABELS)
                    .filter(([g]) => items.some((i) => i.group === g))
                    .map(([g, label]) => (
                      <optgroup key={g} label={label}>
                        {items
                          .filter((i) => i.group === g)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} {i.pricePaise ? `– ${rupees(i.pricePaise)}` : '– amount to enter'}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!adding}
                  onClick={() => {
                    const item = items.find((i) => i.id === adding);
                    setLines([...shown, { key: `l${(seq += 1)}`, item, qty: '1', rate: '' }]);
                    setAdding('');
                  }}
                >
                  <Plus aria-hidden="true" /> Add
                </button>
              </div>
            </section>

            <section className="fu-bb-step" aria-labelledby="fu-bb-pay">
              <h3 id="fu-bb-pay">3. Payment</h3>
              <label className="appt-reason">
                <input type="checkbox" checked={pay} onChange={(e) => setPay(e.target.checked)} /> She pays now
              </label>
              {pay && (
                <div className="form-grid">
                  <Field label="Paid by" id="fu-bb-mode">
                    <select id="fu-bb-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                      {COUNTER_MODES.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Amount ₹" id="fu-bb-amount" error={payOk ? undefined : 'At most the total of the charges.'}>
                    <input id="fu-bb-amount" inputMode="decimal" value={amount ?? (total ? String(total / 100) : '')} onChange={(e) => setAmount(e.target.value)} />
                  </Field>
                  {mode !== 'cash' && (
                    <Field label="Reference number (optional)" id="fu-bb-ref">
                      <input id="fu-bb-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
                    </Field>
                  )}
                </div>
              )}
              {!pay && <p className="hint">The bill stays open; she can pay at the billing desk.</p>}
            </section>

            {warning && (
              <div className="appt-warning" role="alert">
                <p>
                  <TriangleAlert aria-hidden="true" /> {warning}
                </p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(true)} disabled={busy}>
                  Book anyway
                </button>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!ready || Boolean(warning)} onClick={() => run(false)}>
                <CalendarCheck aria-hidden="true" /> {busy ? 'Saving…' : onlyBill || done?.appointment ? 'Make the bill' : 'Book and make the bill'}
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

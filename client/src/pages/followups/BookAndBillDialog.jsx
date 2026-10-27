import { useState } from 'react';
import { CalendarCheck, CircleCheck, Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { SlotChooser } from '../appointments/AppointmentDialogs.jsx';
import { PURPOSE_LABELS, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';
import { GROUP_LABELS, rupees, toPaise } from '../billing/billingFormat.js';

// Follow-ups → Book (owner, 26 Oct 2026): book her FOLLOW-UP – a day and time with her doctor – and, if there is a fee,
// its bill, in one simple popup. The booking stays a follow-up: it is saved on the follow-up (POST
// /added-follow-ups/:id/booked; a patient to call gets a follow-up first), and is her appointment (visit type
// follow-up) in the doctor's day, so her doctor sees her. The bill: the follow-up fee (from the price list when it has
// a price), any other charge, and how she pays – Cash, UPI, Card, or Later at the billing desk. The steps use the same
// endpoints as Appointments and Billing; if one fails, what was already done is said.

const PAY_CHOICES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['later', 'Later'],
];
let seq = 0;

/** who: { patient, followUpId?, doctorId?, purpose?, note?, from? } – a follow-up added by hand, or a patient to call. */
export function BookAndBillDialog({ who, today, onClose, onDone }) {
  const ref = useDialogFocus(onClose);
  const p = who.patient;
  const doctors = useFetch('/appointments/doctors');
  const prices = useFetch('/billing/prices');
  const list = doctors.data?.doctors ?? [];
  const own = list.find((d) => d.id === who.doctorId) ?? list.find((d) => d.name === p.doctorName);
  const [doctorId, setDoctorId] = useState('');
  const chosenDoctor = doctorId || own?.id || list[0]?.id || '';
  const doctor = list.find((d) => d.id === chosenDoctor);
  const [date, setDate] = useState(who.from && who.from > today ? who.from : today);
  const [start, setStart] = useState(null);
  // No time to choose – the doctor has not set OPD timings, has no OPD that day, or every time has passed: she is
  // booked for the day without a time and the bill is made at once (owner, 27 Oct 2026). Not on a day of leave.
  const day = useFetch(chosenDoctor && date ? '/appointments/day' : null, { doctorId: chosenDoctor, date });
  const noTimes = Boolean(day.data && !day.data.leave && !day.data.slots.some((s) => !s.past));
  const items = (prices.data?.items ?? []).filter((i) => i.active && i.group !== 'inpatient');
  const feeItem = items.find((i) => i.key === 'consult_follow');
  const [fee, setFee] = useState(null); // ₹ typed; starts at the price list's follow-up fee
  const feeText = fee ?? (feeItem?.pricePaise ? String(feeItem.pricePaise / 100) : '');
  const [extras, setExtras] = useState([]); // { key, item, rate }
  const [adding, setAdding] = useState(null); // the price-list item being chosen ('' while open)
  const [pay, setPay] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [done, setDone] = useState(null); // { appointment, bill, finished } – the appointment kept if the bill fails

  const feePaise = feeText.trim() === '' ? 0 : toPaise(feeText);
  const rateOf = (x) => (x.item.pricePaise ? x.item.pricePaise : toPaise(x.rate));
  const chargesOk = feePaise !== null && (feePaise === 0 || Boolean(feeItem)) && extras.every((x) => rateOf(x) > 0);
  const total = chargesOk ? feePaise + extras.reduce((s, x) => s + rateOf(x), 0) : 0;
  const ready = chosenDoctor && (start || noTimes) && chargesOk && !busy;

  const run = async (confirm = false) => {
    setBusy(true);
    setError(null);
    let appointment = done?.appointment ?? null;
    try {
      if (!appointment) {
        try {
          appointment = (await api('/appointments', { method: 'POST', body: { doctorId: chosenDoctor, date, start: noTimes ? null : start, visitType: 'follow_up', confirm, patientId: p.id } })).appointment;
        } catch (err) {
          if (err.status === 409 && ['SLOT_TAKEN', 'ALREADY_BOOKED'].includes(err.code)) {
            setWarning(err.message);
            setBusy(false);
            return;
          }
          throw err;
        }
        setWarning(null);
        // Kept as a follow-up: on hers, or on a new one (a patient to call)
        const followUpId = who.followUpId ?? (await api('/added-follow-ups', { method: 'POST', body: { patientId: p.id, doctorId: chosenDoctor, purpose: who.purpose ?? 'consultation', from: date } })).followUp.id;
        await api(`/added-follow-ups/${followUpId}/booked`, { method: 'POST', body: { appointmentId: appointment.id } });
      }
      let bill = null;
      if (total > 0) {
        ({ bill } = await api('/billing/bills', { method: 'POST', body: { patientId: p.id } }));
        const lines = [...(feePaise ? [{ item: feeItem, ratePaise: feePaise, doctor: true }] : []), ...extras.map((x) => ({ item: x.item, ratePaise: rateOf(x) }))];
        for (const l of lines) {
          // A priced item keeps its price; an item with none takes the amount typed
          ({ bill } = await api(`/billing/bills/${bill.id}/lines`, {
            method: 'POST',
            body: { priceItemId: l.item.id, qty: 1, ...(l.item.pricePaise ? {} : { ratePaise: l.ratePaise }), ...(l.doctor ? { doctorId: chosenDoctor } : {}) },
          }));
        }
        // Paid now: what these charges come to (at most what is due on the day's bill)
        if (pay !== 'later' && bill.balance > 0) ({ bill } = await api(`/billing/bills/${bill.id}/payments`, { method: 'POST', body: { mode: pay, amountPaise: Math.min(bill.balance, total) } }));
      }
      setDone({ appointment, bill, finished: true });
    } catch (err) {
      setDone(appointment ? { appointment, bill: null, finished: false } : null);
      setError(appointment ? `The follow-up is booked, but the bill could not be finished: ${err.message} Press the button again, or finish it under Billing.` : err.message);
    } finally {
      setBusy(false);
    }
  };

  const when = done?.appointment ? `${dayLabel(done.appointment.date)}${done.appointment.start ? `, ${timeLabel(done.appointment.start)}` : ''}` : '';
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide fu-bookbill" role="dialog" aria-modal="true" aria-labelledby="fu-bb-title">
        <h2 id="fu-bb-title">Book follow-up</h2>
        <p className="fu-bb-who">
          <strong>{p.fullName}</strong>
          <span className="muted">
            {p.mrn}
            {p.phone ? ` · ${p.phone}` : ''}
            {who.purpose ? ` · ${PURPOSE_LABELS[who.purpose]}${who.note ? `: ${who.note}` : ''}` : ''}
          </span>
        </p>

        {done?.finished ? (
          <div className="fu-bb-done" role="status">
            <p>
              <CircleCheck aria-hidden="true" /> Follow-up booked: {when} with {doctor?.name ?? 'the doctor'}.
              {done.bill ? ` Bill ${done.bill.number}: ${rupees(done.bill.total)}${done.bill.balance > 0 ? `, ${rupees(done.bill.balance)} to pay at the billing desk` : ', paid'}.` : ' No bill (no fee).'}
            </p>
            <div className="row">
              {done.bill && (
                <Link className="btn btn-secondary" to={`/billing/bills/${done.bill.id}`}>
                  <Receipt aria-hidden="true" /> Open the bill
                </Link>
              )}
              <button type="button" className="btn btn-primary" onClick={() => onDone(done)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <Alert type="error">{error ?? doctors.error ?? prices.error}</Alert>

            <section className="fu-bb-step" aria-labelledby="fu-bb-visit">
              <h3 id="fu-bb-visit">When</h3>
              {done?.appointment ? (
                <p>
                  <CircleCheck aria-hidden="true" className="fu-bb-ok" /> Booked: {when} with {doctor?.name}.
                </p>
              ) : (
                <>
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
                    <Field label="Day" id="fu-bb-date">
                      <input
                        id="fu-bb-date"
                        type="date"
                        required
                        value={date}
                        min={today}
                        onChange={(e) => {
                          setDate(e.target.value || today);
                          setStart(null);
                        }}
                      />
                    </Field>
                  </div>
                  <SlotChooser doctorId={chosenDoctor} date={date} value={start} onChange={setStart} />
                  {noTimes && <p className="hint">You can still book her follow-up for this day without a time and make the bill. The time can be set later under Appointments → Needs a time.</p>}
                </>
              )}
            </section>

            <section className="fu-bb-step" aria-labelledby="fu-bb-bill">
              <h3 id="fu-bb-bill">Bill</h3>
              <div className="fu-bb-fee">
                <Field label="Follow-up fee ₹" id="fu-bb-fee" hint={feeItem?.pricePaise ? 'From the price list.' : 'Leave empty if there is no fee.'} error={feePaise === null ? 'Write the amount in rupees, for example 300.' : undefined}>
                  <input id="fu-bb-fee" inputMode="decimal" value={feeText} readOnly={Boolean(feeItem?.pricePaise)} onChange={(e) => setFee(e.target.value)} />
                </Field>
                {extras.map((x) => (
                  <div key={x.key} className="fu-bb-extra">
                    <span>{x.item.name}</span>
                    {x.item.pricePaise ? (
                      <span className="tabular">{rupees(x.item.pricePaise)}</span>
                    ) : (
                      <input className="ph-num" aria-label={`Amount for ${x.item.name}`} inputMode="decimal" placeholder="₹" value={x.rate} onChange={(e) => setExtras(extras.map((y) => (y.key === x.key ? { ...y, rate: e.target.value } : y)))} />
                    )}
                    <button type="button" className="icon-btn" aria-label={`Remove ${x.item.name}`} onClick={() => setExtras(extras.filter((y) => y.key !== x.key))}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {adding === null ? (
                  <button type="button" className="btn btn-link btn-sm fu-bb-more" onClick={() => setAdding('')}>
                    <Plus aria-hidden="true" /> Add another charge
                  </button>
                ) : (
                  <div className="fu-bb-add">
                    <label className="sr-only" htmlFor="fu-bb-item">
                      Another charge
                    </label>
                    <select
                      id="fu-bb-item"
                      value={adding}
                      autoFocus
                      onChange={(e) => {
                        const item = items.find((i) => i.id === e.target.value);
                        if (item) setExtras([...extras, { key: `x${(seq += 1)}`, item, rate: '' }]);
                        setAdding(null);
                      }}
                    >
                      <option value="">Choose from the price list…</option>
                      {Object.entries(GROUP_LABELS)
                        .filter(([g]) => items.some((i) => i.group === g && i.key !== 'consult_follow'))
                        .map(([g, label]) => (
                          <optgroup key={g} label={label}>
                            {items
                              .filter((i) => i.group === g && i.key !== 'consult_follow')
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
              {total > 0 && pay === 'later' && <p className="hint">The bill is made now; she pays at the billing desk.</p>}
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
              <button type="button" className="btn btn-primary" disabled={!(ready || (done?.appointment && chargesOk && !busy)) || Boolean(warning)} onClick={() => run(false)}>
                <CalendarCheck aria-hidden="true" /> {busy ? 'Saving…' : done?.appointment ? 'Make the bill' : total > 0 ? `Book follow-up · ${rupees(total)}` : 'Book follow-up'}
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

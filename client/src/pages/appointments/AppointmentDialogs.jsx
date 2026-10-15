import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, IndianRupee, Search, TriangleAlert, UserPlus } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canRegisterPatients } from '../../platform/modules.js';
import { Alert, Field, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { CANCEL_REASONS, VISIT_TYPES, VISIT_TYPE_LABELS, dayLabel, timeLabel, whenLabel, whoLabel } from './appointmentFormat.js';

// The booking dialogs of appointment booking: Book (a registered patient, or a quick booking with name and phone),
// Move (another day, time or doctor – also giving a "needs a time" booking its time) and Cancel. A warning the
// server can be talked past (slot already taken, a second booking that day) is shown with "Book anyway".

function Modal({ id, title, onClose, wide = false, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Sends a booking or a move; a confirmable warning (409) waits for "Book anyway". */
function useSend(send) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const run = async (confirm = false) => {
    setBusy(true);
    setError(null);
    try {
      await send(confirm);
      setWarning(null);
    } catch (err) {
      if (err.status === 409 && ['SLOT_TAKEN', 'ALREADY_BOOKED'].includes(err.code)) setWarning(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, warning, run };
}

function WarningBox({ warning, busy, onConfirm, confirmLabel }) {
  if (!warning) return null;
  return (
    <div className="appt-warning" role="alert">
      <p>
        <TriangleAlert aria-hidden="true" /> {warning}
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onConfirm} disabled={busy}>
        {confirmLabel}
      </button>
    </div>
  );
}

/** Finding a registered patient by name, phone or patient number (the same search as the Patients page). */
export function PatientFinder({ onPick }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const term = text.trim();
  useEffect(() => {
    if (term.length < 2) {
      setResult(null);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/patients', { query: { search: term, doctor: 'all', limit: 8, sort: 'fullName' } });
        if (current) setResult({ patients: res.patients });
      } catch (err) {
        if (current) setResult({ error: err.message });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);
  return (
    <div className="appt-finder">
      <Field label="Find the patient" id="appt-find" hint="Name, phone number or patient number">
        <input id="appt-find" type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoFocus />
      </Field>
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {result?.patients && (
        <ul className="appt-pick-list" aria-label="Patients found">
          {result.patients.length === 0 && <li className="muted">No patient found. Use "New patient" for someone not registered yet.</li>}
          {result.patients.map((p) => (
            <li key={p.id}>
              <button type="button" className="appt-pick" onClick={() => onPick(p)}>
                <strong>{p.fullName}</strong>
                <span className="muted">
                  {p.mrn}
                  {p.phone ? ` · ${p.phone}` : ''}
                  {p.assignedDoctorName ? ` · ${p.assignedDoctorName}` : ''}
                  {/* Found only by its own patient number: it takes nothing new, so the main record is named */}
                  {p.duplicateOf ? ` · Duplicate of ${p.duplicateOf.mrn} – choose ${p.duplicateOf.mrn} instead` : ''}
                  {/* Closed (never said why): it takes no appointment */}
                  {p.closed ? ' · Record closed – takes no appointment' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Book a time slot: doctor, day and time are chosen on the page; here the patient and the visit type. */
export function BookDialog({ doctor, date, start, patient: preset = null, lengths = null, onClose, onBooked }) {
  const [mode, setMode] = useState(preset ? 'patient' : 'find'); // find | patient | guest
  const [patient, setPatient] = useState(preset);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [visitType, setVisitType] = useState('follow_up');
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
  const canRegister = canRegisterPatients(activeMembership?.roles ?? []);
  const send = useSend(async (confirm) => {
    const body = { doctorId: doctor.id, date, start, visitType, confirm, ...(mode === 'guest' ? { guest } : { patientId: patient.id }) };
    const { appointment } = await api('/appointments', { method: 'POST', body });
    if (mode === 'guest' && canRegister) {
      // A new patient: the time is kept, then her full registration form opens with the name, phone and doctor
      // filled in; once she is saved the appointment joins her record (the same as "Register" on Today).
      navigate(`/patients/new?appointment=${appointment.id}`, {
        state: { fromBooking: { id: appointment.id, name: guest.name.trim(), phone: guest.phone.trim(), doctorId: doctor.id } },
      });
      return;
    }
    onBooked(appointment);
  });
  const ready = mode === 'guest' ? guest.name.trim().length >= 2 && guest.phone.trim().length >= 6 : mode === 'patient' && patient;

  return (
    <Modal id="appt-book" title="Book an appointment" onClose={onClose} wide>
      <p className="appt-when">
        <CalendarCheck aria-hidden="true" /> {dayLabel(date)} · {timeLabel(start)} · {doctor.name}
      </p>
      <Alert type="error">{send.error}</Alert>
      {mode !== 'patient' && (
        <div className="segmented" role="group" aria-label="Who is it for">
          <button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>
            <Search aria-hidden="true" /> Registered patient
          </button>
          <button
            type="button"
            aria-pressed={mode === 'guest'}
            onClick={() => {
              setMode('guest');
              setVisitType('new');
            }}
          >
            <UserPlus aria-hidden="true" /> New patient
          </button>
        </div>
      )}
      {mode === 'find' && (
        <PatientFinder
          onPick={(p) => {
            setPatient(p);
            setMode('patient');
            setVisitType('follow_up');
          }}
        />
      )}
      {mode === 'patient' && patient && (
        <div className="appt-chosen">
          <strong>{patient.fullName}</strong>
          <span className="muted">
            {patient.mrn}
            {patient.phone ? ` · ${patient.phone}` : ''}
          </span>
          {!preset && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setMode('find')}>
              Choose someone else
            </button>
          )}
        </div>
      )}
      {mode === 'guest' && (
        <div className="form-grid appt-guest">
          <Field label="Her name" id="appt-guest-name">
            <input id="appt-guest-name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} maxLength={150} autoFocus />
          </Field>
          <Field label="Phone number" id="appt-guest-phone" hint={canRegister ? 'Next, her full registration form opens to fill in all her details.' : 'Reception registers her in full.'}>
            <input id="appt-guest-phone" type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} maxLength={30} />
          </Field>
        </div>
      )}
      {(mode === 'patient' || mode === 'guest') && (
        <Field
          label="Visit type"
          id="appt-type"
          hint={lengths?.[visitType] > 10 ? `Takes ${lengths[visitType]} minutes with ${doctor.name}: the times that follow are kept free too.` : 'No medical details here – reception sees this.'}
          keepHint={lengths?.[visitType] > 10}
        >
          <select id="appt-type" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VISIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <WarningBox warning={send.warning} busy={send.busy} onConfirm={() => send.run(true)} confirmLabel="Book anyway" />
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || send.busy || Boolean(send.warning)}
          onClick={() => send.run(false)}
        >
          <CalendarCheck aria-hidden="true" /> {send.busy ? 'Booking…' : mode === 'guest' && canRegister ? 'Book and register' : 'Book'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The free slots of a doctor's day, to choose one (Move, and giving a time). */
function SlotChooser({ doctorId, date, value, onChange, exceptId }) {
  const day = useFetch(doctorId && date ? '/appointments/day' : null, { doctorId, date });
  if (!doctorId || !date) return null;
  if (day.error) return <Alert type="error">{day.error}</Alert>;
  if (!day.data) return <p className="muted" aria-busy="true">Loading the times…</p>;
  const d = day.data;
  if (d.leave) return <Alert type="warning">{d.doctor.name} is on leave that day.</Alert>;
  if (!d.slots.length) return <Alert type="warning">{d.hasTimings ? `${d.doctor.name} has no OPD that day.` : `${d.doctor.name} has not set OPD timings yet.`}</Alert>;
  // By part of the day, so a time is easy to find; times that have passed are left out.
  const open = d.slots.filter((s) => !s.past);
  const passed = d.slots.length - open.length;
  const groups = DAY_PARTS.map((p) => ({ ...p, slots: open.filter((s) => p.fits(minutesOf(s.start))) })).filter((g) => g.slots.length);
  const takenBy = (s) => {
    const others = s.appointments.filter((a) => a.id !== exceptId);
    const busy = s.busyWith && s.busyWith.id !== exceptId ? s.busyWith : null;
    return others.length || busy ? (others.length ? others.map(whoLabel).join(', ') : busy.name || 'another patient') : null;
  };
  return (
    <fieldset className="appt-slot-choices">
      <legend>Time</legend>
      {groups.length === 0 && <p className="hint">Every time of this day has passed. Choose another day.</p>}
      {groups.map((g) => {
        const free = g.slots.filter((s) => !takenBy(s)).length;
        return (
          <div key={g.key} className="appt-slot-part">
            <p className="appt-slot-part-title">
              {g.label} <span className="muted">· {free} free</span>
            </p>
            <div className="appt-slot-grid" role="group" aria-label={`${g.label} times`}>
              {g.slots.map((s) => {
                const who = takenBy(s);
                return (
                  <button
                    key={s.start}
                    type="button"
                    className={`appt-slot-choice ${who ? 'is-taken' : ''}`}
                    aria-pressed={value === s.start}
                    onClick={() => onChange(s.start)}
                    title={who ? `Booked: ${who}` : 'Free'}
                  >
                    {timeLabel(s.start)}
                    {who && <span className="sr-only"> (booked)</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="hint">
        Times with a line are already booked (you will be asked before double booking).
        {passed > 0 && ` ${passed} time${passed === 1 ? ' has' : 's have'} already passed today and ${passed === 1 ? 'is' : 'are'} not shown.`}
      </p>
    </fieldset>
  );
}

// Parts of the day for the time chooser (minutes after midnight on the hospital's clock).
const DAY_PARTS = [
  { key: 'morning', label: 'Morning', fits: (m) => m < 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', fits: (m) => m >= 12 * 60 && m < 17 * 60 },
  { key: 'evening', label: 'Evening', fits: (m) => m >= 17 * 60 },
];
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Move an appointment, or give a "needs a time" booking its time. */
export function MoveDialog({ appointment: a, doctors, today, onClose, onMoved }) {
  const [doctorId, setDoctorId] = useState(a.doctor.id);
  const [date, setDate] = useState(a.date >= today ? a.date : today);
  const [start, setStart] = useState(null);
  const send = useSend(async (confirm) => {
    const { appointment } = await api(`/appointments/${a.id}/move`, { method: 'POST', body: { doctorId, date, start, confirm } });
    onMoved(appointment);
  });
  return (
    <Modal id="appt-move" title={a.needsTime ? `Give ${whoLabel(a)} a time` : `Move ${whoLabel(a)}'s appointment`} onClose={onClose} wide>
      <p className="muted">
        Now: {dayLabel(a.date)} · {whenLabel(a)} · {a.doctor.name}
      </p>
      <Alert type="error">{send.error}</Alert>
      <div className="form-grid">
        <Field label="Doctor" id="appt-move-doctor">
          <select
            id="appt-move-doctor"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setStart(null);
            }}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day" id="appt-move-date">
          <input
            id="appt-move-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStart(null);
            }}
          />
        </Field>
      </div>
      <SlotChooser doctorId={doctorId} date={date} value={start} onChange={setStart} exceptId={a.id} />
      <WarningBox warning={send.warning} busy={send.busy} onConfirm={() => send.run(true)} confirmLabel="Book anyway" />
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!start || send.busy || Boolean(send.warning)} onClick={() => send.run(false)}>
          <CalendarCheck aria-hidden="true" /> {send.busy ? 'Saving…' : a.needsTime ? 'Book this time' : 'Move here'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * Take the consultation fee for an appointment in advance (reception): the price from the price list, paid in full.
 * It goes on her bill of that day with a receipt; her visit then adds no second consultation.
 */
export function FeeDialog({ appointment: a, onClose, onTaken }) {
  const fee = useFetch(`/appointments/${a.id}/fee`);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [scheme, setScheme] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({}); // what the server says under a box (e.g. a word that may not be on a bill)
  const take = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const out = await api(`/appointments/${a.id}/fee`, { method: 'POST', body: { mode, reference: mode === 'cash' ? '' : reference.trim(), scheme: mode === 'insurance' ? scheme.trim() : '' } });
      onTaken(out);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="appt-fee" title={`Take the fee from ${whoLabel(a)}`} onClose={onClose}>
      <p>
        {dayLabel(a.date)} · {whenLabel(a)} · {a.doctor.name}
      </p>
      <Alert type="error">{fee.error ?? error}</Alert>
      {fee.data && (
        <>
          <p className="appt-fee-amount">
            {fee.data.name}: <strong className="tabular">{rupees(fee.data.amountPaise)}</strong>
          </p>
          <Field label="Paid by" id="appt-fee-mode">
            <select id="appt-fee-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {fee.data.modes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'insurance' && (
            <Field label="Insurance company or scheme" id="appt-fee-scheme" error={fields.scheme}>
              <input id="appt-fee-scheme" value={scheme} maxLength={80} onChange={(e) => setScheme(e.target.value)} />
            </Field>
          )}
          {mode !== 'cash' && (
            <Field label={mode === 'insurance' ? 'Claim number (optional)' : 'Reference number (optional)'} id="appt-fee-ref" error={fields.reference}>
              <input id="appt-fee-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <p className="hint">The consultation goes on her bill of that day, paid, with a receipt. If the appointment is cancelled, the bill shows the money as due back.</p>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!fee.data || busy} onClick={take}>
          <IndianRupee aria-hidden="true" /> {busy ? 'Saving…' : 'Fee received'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Cancel an appointment, with the reason. */
export function CancelDialog({ appointment: a, onClose, onCancelled }) {
  const [reason, setReason] = useState('patient_asked');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const { appointment } = await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: { reason } });
      onCancelled(appointment);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="appt-cancel" title={`Cancel ${whoLabel(a)}'s appointment`} onClose={onClose}>
      <p>
        {dayLabel(a.date)} · {whenLabel(a)} · {a.doctor.name}
      </p>
      <Alert type="error">{error}</Alert>
      <fieldset className="appt-reasons">
        <legend>Why</legend>
        {CANCEL_REASONS.map((r) => (
          <label key={r.value} className="appt-reason">
            <input type="radio" name="appt-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} /> {r.label}
          </label>
        ))}
      </fieldset>
      {a.patient && <p className="hint">If she agreed to messages, she is told by SMS or WhatsApp.</p>}
      <div className="row">
        <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
          {busy ? 'Cancelling…' : 'Cancel the appointment'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose} autoFocus>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

/**
 * New appointment (the page's main button, owner 13 Oct 2026): choose the doctor and the day, then one of the free
 * times; the booking itself (patient, visit type) is the Book dialog. Doctors without OPD timings are named as such.
 */
export function NewAppointmentDialog({ doctors, today, doctorId: firstDoctor, date: firstDate, onClose, onChosen }) {
  const [doctorId, setDoctorId] = useState(firstDoctor ?? doctors[0]?.id ?? '');
  const [date, setDate] = useState(firstDate && firstDate >= today ? firstDate : today);
  const day = useFetch(doctorId && date ? '/appointments/day' : null, { doctorId, date });
  const d = day.data?.doctor?.id === doctorId && day.data?.date === date ? day.data : null;
  const free = d ? d.slots.filter((s) => !s.past && !s.appointments.length && !s.busyWith) : [];
  const doctor = doctors.find((x) => x.id === doctorId);
  return (
    <Modal id="appt-new" title="New appointment" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Doctor" id="appt-new-doctor">
          <select id="appt-new-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} autoFocus>
            {doctors.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.hasTimings ? '' : ' (no OPD timings yet)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day" id="appt-new-date">
          <input id="appt-new-date" type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
      </div>
      <Alert type="error">{day.error}</Alert>
      {!d && !day.error && <p className="muted">Looking for free times…</p>}
      {d && !d.hasTimings && <Alert type="warning">{doctor?.name ?? 'This doctor'} has not set OPD timings yet, so there are no times to book.</Alert>}
      {d?.leave && <Alert type="warning">{d.doctor.name} is on leave on this day.</Alert>}
      {d && d.hasTimings && !d.leave && !d.slots.length && <Alert type="info">{d.doctor.name} has no OPD on this day. Choose another day.</Alert>}
      {d && d.slots.length > 0 && (
        <>
          <p className="field-label">
            {free.length ? `Free times (${free.length})` : 'No free time left on this day – choose another day.'}
          </p>
          <div className="appt-free-times" role="group" aria-label="Free times">
            {free.map((s) => (
              <button key={s.start} type="button" className="btn btn-secondary btn-sm" onClick={() => onChosen({ doctor: d.doctor, date: d.date, start: s.start, lengths: d.lengths })}>
                {timeLabel(s.start)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

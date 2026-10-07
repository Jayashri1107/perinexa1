// The appointment dialogs: book (a registered patient or a quick booking), move, cancel, link a quick booking to
// her record, and a walk-in token. Times offered are only the free ones, worked out from the doctor's day.
import { useEffect, useState } from 'react';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { toOptions } from '../../utils/format.js';
import { dayText, freeStarts } from './appointmentFormat.js';

function Select({ id, label, value, onChange, options, placeholder, error, required, width = 'full' }) {
  return (
    <div className={`form-field width-${width}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required" aria-hidden> *</span>}
      </label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

function Field({ id, label, error, children, required, width = 'full' }) {
  return (
    <div className={`form-field width-${width}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required" aria-hidden> *</span>}
      </label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

// The free times of one doctor's day for a visit type (reloaded when any of them changes).
function useFreeTimes(doctorId, date, visitType, exceptId) {
  const { opd } = useAppConfig();
  const [state, setState] = useState({ times: [], day: null, loading: false });
  useEffect(() => {
    if (!doctorId || !date) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    appointmentsApi
      .day(doctorId, date)
      .then((day) => !cancelled && setState({ day, loading: false, times: freeStarts(day, day.lengths[visitType] ?? opd.slotMinutes, opd.slotMinutes, exceptId) }))
      .catch(() => !cancelled && setState({ times: [], day: null, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [doctorId, date, visitType, exceptId, opd.slotMinutes]);
  return state;
}

// The free times of the day as buttons, by part of the day, for a visit of this length. allowNone: book with no time
// yet (reception gives it one later, under "Needs a time").
const PARTS = [
  ['Morning', (m) => m < 12 * 60],
  ['Afternoon', (m) => m >= 12 * 60 && m < 17 * 60],
  ['Evening', (m) => m >= 17 * 60],
];
const minutesOfTime = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

function TimeChoice({ free, value, onChange, visitLabel, allowNone = false, error }) {
  const minutes = free.day?.lengths?.[visitLabel?.key];
  const note = dayNote(free.day);
  return (
    <div className={`form-field${error ? ' has-error' : ''}`}>
      <span className="field-label">
        Time<span className="required" aria-hidden> *</span>
        {minutes ? <span className="muted"> – free times for a {visitLabel.label.toLowerCase()} visit ({minutes} minutes)</span> : null}
      </span>
      {free.loading && <span className="muted small">Loading the doctor’s free times…</span>}
      {!free.loading && note && <span className="muted small">{note}</span>}
      {!free.loading && !note && free.times.length === 0 && <span className="muted small">No free time left that day. Choose another day{allowNone ? ', or book without a time' : ''}.</span>}
      {!free.loading &&
        PARTS.map(([label, fits]) => {
          const times = free.times.filter((t) => fits(minutesOfTime(t)));
          if (!times.length) return null;
          return (
            <div key={label} className="time-part">
              <span className="muted small">{label}</span>
              <div className="time-chips" role="group" aria-label={`${label} times`}>
                {times.map((t) => (
                  <button key={t} type="button" className={`time-chip${value === t ? ' on' : ''}`} aria-pressed={value === t} onClick={() => onChange(t)}>{t}</button>
                ))}
              </div>
            </div>
          );
        })}
      {allowNone && (
        <label className="inline-check small">
          <input type="checkbox" checked={value === 'none'} onChange={(e) => onChange(e.target.checked ? 'none' : '')} />
          Book without a time – reception gives it one later (it shows under “Needs a time”)
        </label>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

function dayNote(day) {
  if (!day) return '';
  if (day.leave) return 'The doctor is on leave that day.';
  if (!day.hasTimings) return 'This doctor has no OPD timings yet.';
  if (!day.sessions.length) return 'The doctor has no OPD that day.';
  return '';
}

// Runs a save; on "she already has an appointment that day" asks once and saves again with confirm.
function useSave(onDone) {
  const [state, setState] = useState({ saving: false, error: '', fields: {}, confirm: '' });
  const run = async (action, data) => {
    setState({ saving: true, error: '', fields: {}, confirm: '' });
    try {
      onDone(await action(data));
    } catch (err) {
      if (err.code === 'ALREADY_BOOKED') setState({ saving: false, error: '', fields: {}, confirm: err.message, retry: () => run(action, { ...data, confirm: true }) });
      else setState({ saving: false, error: err.message, fields: err.fields ?? {}, confirm: '' });
    }
  };
  return { ...state, run };
}

function Foot({ onClose, saving, label, disabled }) {
  return (
    <div className="modal-foot inline">
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={saving || disabled}>{saving ? 'Saving…' : label}</button>
    </div>
  );
}

function ConfirmAgain({ save }) {
  if (!save.confirm) return null;
  return (
    <Alert type="info">
      {save.confirm}{' '}
      <button type="button" className="btn btn-link" onClick={save.retry}>Book anyway</button>
    </Alert>
  );
}

export function BookDialog({ doctors, initial, onClose, onDone }) {
  const { opd } = useAppConfig();
  const [patient, setPatient] = useState(initial.patient ?? null);
  const [quick, setQuick] = useState(false);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [doctorId, setDoctorId] = useState(doctors.some((d) => d.id === initial.doctorId) ? initial.doctorId : doctors[0]?.id ?? '');
  const [date, setDate] = useState(initial.date);
  const [visitType, setVisitType] = useState(initial.visitType ?? opd.visitTypes[0].key);
  const [start, setStart] = useState(initial.start ?? '');
  const free = useFreeTimes(doctorId, date, visitType, null);
  const save = useSave((r) => onDone(r.appointment));

  useEffect(() => {
    if (start && start !== 'none' && !free.loading && free.day && !free.times.includes(start)) setStart('');
  }, [free, start]);

  const submit = (e) => {
    e.preventDefault();
    save.run(appointmentsApi.book, {
      doctorId,
      date,
      visitType,
      start: start === 'none' ? null : start || undefined,
      ...(quick ? { guest } : { patientId: patient?.id }),
    });
  };

  return (
    <Modal title="Book an appointment" onClose={onClose} size="lg">
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Alert type="error">{save.error}</Alert>
          <ConfirmAgain save={save} />
          <div className="form-field">
            <div className="segmented" role="group" aria-label="Who">
              <button type="button" className={quick ? '' : 'on'} aria-pressed={!quick} onClick={() => setQuick(false)}>Registered patient</button>
              <button type="button" className={quick ? 'on' : ''} aria-pressed={quick} onClick={() => setQuick(true)}>Quick booking (not registered yet)</button>
            </div>
          </div>
          {quick ? (
            <>
              <Field id="guest-name" label="Her name" required width="half" error={save.fields['guest.name']}>
                <input id="guest-name" value={guest.name} onChange={(e) => setGuest((g) => ({ ...g, name: e.target.value }))} />
              </Field>
              <Field id="guest-phone" label="Phone" required width="half" error={save.fields['guest.phone']}>
                <input id="guest-phone" type="tel" value={guest.phone} onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))} />
              </Field>
            </>
          ) : (
            <PatientPicker search={appointmentsApi.patients} value={patient} onChange={setPatient} error={save.fields.patientId} />
          )}
          <Select id="book-doctor" label="Doctor" required value={doctorId} onChange={setDoctorId} placeholder="Choose…" options={doctors.map((d) => ({ value: d.id, label: d.name }))} error={save.fields.doctorId} />
          <Field id="book-date" label="Day" required width="half" error={save.fields.date}>
            <input id="book-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Select id="book-type" label="Visit" required value={visitType} onChange={setVisitType} options={toOptions(opd.visitTypes)} width="half" error={save.fields.visitType} />
          {date && <p className="muted small span-2">{dayText(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          <TimeChoice free={free} value={start} onChange={setStart} visitLabel={opd.visitTypes.find((v) => v.key === visitType)} allowNone error={save.fields.start} />
        </div>
        <Foot onClose={onClose} saving={save.saving} label="Book" disabled={!start} />
      </form>
    </Modal>
  );
}

export function MoveDialog({ appointment, doctors, onClose, onDone }) {
  const { opd } = useAppConfig();
  const [doctorId, setDoctorId] = useState(appointment.doctor.id);
  const [date, setDate] = useState(appointment.date);
  const [visitType, setVisitType] = useState(appointment.visitType);
  const [start, setStart] = useState('');
  const free = useFreeTimes(doctorId, date, visitType, appointment.id);
  const save = useSave((r) => onDone(r.appointment));

  const submit = (e) => {
    e.preventDefault();
    save.run((data) => appointmentsApi.move(appointment.id, data), { doctorId, date, start, visitType });
  };
  return (
    <Modal title={appointment.needsTime ? 'Give a time' : 'Move the appointment'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Alert type="error">{save.error}</Alert>
          <ConfirmAgain save={save} />
          <Select id="move-doctor" label="Doctor" required value={doctorId} onChange={setDoctorId} options={doctors.map((d) => ({ value: d.id, label: d.name }))} error={save.fields.doctorId} />
          <Field id="move-date" label="Day" required width="half" error={save.fields.date}>
            <input id="move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Select id="move-type" label="Visit" value={visitType} onChange={setVisitType} options={toOptions(opd.visitTypes)} width="half" />
          <TimeChoice free={free} value={start} onChange={setStart} visitLabel={opd.visitTypes.find((v) => v.key === visitType)} error={save.fields.start} />
        </div>
        <Foot onClose={onClose} saving={save.saving} label="Save" disabled={!start} />
      </form>
    </Modal>
  );
}

export function CancelDialog({ appointment, onClose, onDone }) {
  const { appointments } = useAppConfig();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const save = useSave((r) => onDone(r.appointment));
  const submit = (e) => {
    e.preventDefault();
    save.run((data) => appointmentsApi.cancel(appointment.id, data), { reason, note });
  };
  return (
    <Modal title="Cancel the appointment" onClose={onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Alert type="error">{save.error}</Alert>
          <Select id="cancel-reason" label="Why" required value={reason} onChange={setReason} placeholder="Choose…" options={toOptions(appointments.cancelReasons)} error={save.fields.reason} />
          <Field id="cancel-note" label="Note (optional)" error={save.fields.note}>
            <input id="cancel-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Foot onClose={onClose} saving={save.saving} label="Cancel appointment" disabled={!reason} />
      </form>
    </Modal>
  );
}

// A quick booking → the patient she was registered as.
export function LinkDialog({ appointment, onClose, onDone }) {
  const [patient, setPatient] = useState(null);
  const save = useSave((r) => onDone(r.appointment));
  const submit = (e) => {
    e.preventDefault();
    save.run(() => appointmentsApi.link(appointment.id, patient.id));
  };
  return (
    <Modal title={`Link ${appointment.guest?.name ?? 'the booking'} to her record`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Alert type="error">{save.error}</Alert>
          <p className="muted small span-2">Register her under Patients first if she is new. Phone given: {appointment.guest?.phone}.</p>
          <PatientPicker search={appointmentsApi.patients} value={patient} onChange={setPatient} error={save.fields.patientId} />
        </div>
        <Foot onClose={onClose} saving={save.saving} label="Link" disabled={!patient} />
      </form>
    </Modal>
  );
}

// A walk-in: she gets the next token number of the doctor's day and joins the waiting list.
export function WalkInDialog({ doctors, doctorId: initialDoctor, onClose, onDone }) {
  const [patient, setPatient] = useState(null);
  // only a doctor on the list (never an id the list does not have)
  const [doctorId, setDoctorId] = useState(doctors.some((d) => d.id === initialDoctor) ? initialDoctor : doctors[0]?.id ?? '');
  const save = useSave((r) => onDone(r.appointment));
  const submit = (e) => {
    e.preventDefault();
    save.run(() => appointmentsApi.token(doctorId, patient.id));
  };
  return (
    <Modal title="Walk-in: give a token" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Alert type="error">{save.error}</Alert>
          <PatientPicker search={appointmentsApi.patients} value={patient} onChange={setPatient} error={save.fields.patientId} />
          <Select id="walkin-doctor" label="Doctor" required value={doctorId} onChange={setDoctorId} placeholder="Choose…" options={doctors.map((d) => ({ value: d.id, label: d.name }))} error={save.fields.doctorId} />
          <p className="muted small span-2">She is marked as arrived today and waits for this doctor.</p>
        </div>
        <Foot onClose={onClose} saving={save.saving} label="Give token" disabled={!patient || !doctorId} />
      </form>
    </Modal>
  );
}

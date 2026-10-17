import { useState } from 'react';
import { Clock, Hash, Printer, UserCheck, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from './AppointmentDialogs.jsx';
import { PatientRow, Section } from '../worklist/WorklistSections.jsx';
import { NEEDS_TIME_LOOK, TOKEN_LOOK, VISIT_TYPE_LABELS, dayLabel, timeLabel, whenLabel } from './appointmentFormat.js';

// Appointment booking on the Today page: marking a walk-in arrived gives her a token for the doctor she will see,
// with a slip to print; each doctor's waiting list in the order to call; quick bookings of the day (new patients
// to register); and how many next visits still need a time.

/**
 * Mark arrived for a patient with no appointment today: which doctor she will see (her own doctor first), for a
 * token. "Arrived, no token" marks her arrived without one (e.g. she came only for the lab). With no patient given
 * (the "Walk-in" button), she is found first.
 */
export function ArrivalDialog({ patient: given = null, doctorName: givenDoctor = null, onClose, onDone }) {
  const ref = useDialogFocus(onClose);
  const [found, setFound] = useState(null);
  const patient = given ?? found;
  const doctorName = givenDoctor ?? found?.assignedDoctorName ?? null;
  const doctors = useFetch('/appointments/doctors');
  const list = doctors.data?.doctors ?? [];
  const own = list.find((d) => d.name === doctorName);
  const [chosen, setChosen] = useState(null);
  const doctorId = chosen ?? own?.id ?? list[0]?.id ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mark = async (withToken) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api('/arrivals', { method: 'POST', body: { patientId: patient.id, ...(withToken && doctorId ? { doctorId } : {}) } });
      onDone(res.appointment, res.queueTime);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="arr-title">
        <h2 id="arr-title">{patient ? `${patient.fullName} has arrived` : 'A walk-in patient'}</h2>
        <Alert type="error">{error || doctors.error}</Alert>
        {!patient && (
          <>
            <p>Find her record. A new patient is registered first (New patient), then given a token here.</p>
            <PatientFinder onPick={setFound} />
            <div className="row">
              <button type="button" className="btn btn-link" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
        {patient && (
          <>
            <p>{given ? 'She has no appointment today. ' : ''}Choose the doctor she will see: she gets the next walk-in token for that doctor. If she has an appointment today, she is marked arrived for it instead.</p>
            <Field label="Doctor" id="arr-doctor">
              <select id="arr-doctor" value={doctorId} onChange={(e) => setChosen(e.target.value)} disabled={!list.length}>
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.id === own?.id ? ' (her doctor)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => mark(true)} disabled={busy || !doctorId} autoFocus>
                <Hash aria-hidden="true" /> {busy ? 'Saving…' : 'Give a token'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => mark(false)} disabled={busy}>
                <UserCheck aria-hidden="true" /> Arrived, no token
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

/** The token slip: hospital, doctor, token number and date – nothing medical, no name (a slip can be dropped). */
export function TokenSlip({ appointment: a, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  return (
    <PrintPreview title="Token slip – print preview" hint="Give the slip to the patient. It has no name or medical details." page={{ size: 'A5', margin: '12mm' }} onClose={onClose}>
      <PrintDocument>
        {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
        <div className="token-slip">
          <p className="token-slip-label">Token</p>
          <p className="token-slip-number">{a.token}</p>
          <p className="token-slip-doctor">{a.doctor.name}</p>
          <p>{dayLabel(a.date)}</p>
          <p className="pdoc-small">Please wait to be called. Patients with a booked time are seen at their time; walk-ins in token order.</p>
        </div>
      </PrintDocument>
    </PrintPreview>
  );
}

/** "Print token slip" next to a walk-in's token. */
export function TokenButton({ appointment, onPrint }) {
  return (
    <button type="button" className="btn btn-link btn-sm" onClick={() => onPrint(appointment)} aria-label={`Print the slip for token ${appointment.token}`}>
      <Printer aria-hidden="true" /> Slip
    </button>
  );
}

/** One line of a waiting list: "Next", the time or token and when she came show without opening the row. */
function WaitingLine({ w, next }) {
  return (
    <PatientRow
      patient={w.patient}
      to={`/patients/${w.patient.id}`}
      openLabel="Open the record"
      marker={
        <span className="appt-row-marker">
          {next && (
            <StatusPill tone="stable" icon={UserCheck}>
              Next
            </StatusPill>
          )}
          <span className="appt-when-chip">{whenLabel(w)}</span>
        </span>
      }
    >
      <p className="hint">
        {w.kind === 'token' ? 'Walk-in' : `Booked · ${VISIT_TYPE_LABELS[w.visitType]}`}
        {w.arrivedAt ? ` · arrived ${formatTime(w.arrivedAt)}` : ''}
      </p>
    </PatientRow>
  );
}

/**
 * Each doctor's waiting list (doctors, RMOs, nurses, reception): who has arrived, in the order to call them – booked
 * patients at their time, walk-ins in the gaps by token – then who is still expected. A doctor's own list comes first.
 */
export function WaitingLists() {
  const queue = useFetch('/appointments/queue');
  if (queue.error) return <Alert type="error">{queue.error}</Alert>;
  if (!queue.data) return null;
  const { queues, me } = queue.data;
  const ordered = [...queues].sort((a, b) => (a.doctor.id === me ? -1 : b.doctor.id === me ? 1 : 0));
  const waiting = queues.reduce((n, q) => n + q.waiting.length, 0);
  return (
    <Section id="td-waiting-lists" icon={Users} title="Waiting to be seen" count={waiting} empty="Nobody is waiting: no patient with an appointment or token today has arrived yet.">
      {ordered.map((q) => (
        <div key={q.doctor.id} className="appt-queue">
          <h3 className="appt-queue-title">
            {q.doctor.name}
            {q.doctor.id === me ? ' (you)' : ''}
            <span className="muted">
              {' '}
              · {q.waiting.length} waiting · {q.expected.length} still expected · {q.seen} seen
            </span>
          </h3>
          {q.waiting.length > 0 && (
            <ul className="wl-list">
              {q.waiting.map((w, i) => (
                <WaitingLine key={w.id} w={w} next={i === 0} />
              ))}
            </ul>
          )}
          {q.expected.length > 0 && (
            <p className="hint">
              Still expected: {q.expected.map((e) => `${e.patient?.fullName ?? e.guest?.name} (${whenLabel(e)})`).join(', ')}
            </p>
          )}
        </div>
      ))}
    </Section>
  );
}

/** Quick bookings of the day: new patients booked by phone, to register when they come. */
export function QuickBookingsSection({ guests, canRegister }) {
  if (!guests?.length) return null;
  return (
    <Section id="td-guests" icon={UserPlus} title="New patients booked today" count={guests.length} empty="">
      <ul className="wl-list">
        {guests.map((g) => (
          <li key={g.id} className="wl-row appt-guest-row">
            <div>
              <strong>{g.guest.name}</strong>
              <p className="hint">
                {whenLabel(g)} · {g.doctorName} · {g.guest.phone} · not registered yet
              </p>
            </div>
            {canRegister && (
              <Link className="btn btn-secondary btn-sm" to={`/patients/new?appointment=${g.id}`} state={{ fromBooking: { id: g.id, name: g.guest.name, phone: g.guest.phone, doctorId: g.doctorId } }}>
                <UserPlus aria-hidden="true" /> Register
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** How many next visits still need a time (reception and doctors), with a link to give them one. */
export function NeedsTimeNotice() {
  const list = useFetch('/appointments/needs-time');
  const n = list.data?.appointments?.length ?? 0;
  if (!n) return null;
  return (
    <Alert type="warning" icon={NEEDS_TIME_LOOK.icon}>
      {n} next visit{n > 1 ? 's' : ''} still need{n > 1 ? '' : 's'} a time.{' '}
      <Link to="/appointments/needs-time">Give {n > 1 ? 'them' : 'it'} a time</Link>
    </Alert>
  );
}

/** The appointment of a row on Today's patients: "10:30 AM · Dr A", "Token 3 · Dr A" or "Time to be given". */
export function AppointmentChip({ appointment: a }) {
  if (!a) return null;
  const look = a.kind === 'token' ? TOKEN_LOOK : a.needsTime ? NEEDS_TIME_LOOK : null;
  return (
    <span className="appt-when-chip">
      {look ? <look.icon aria-hidden="true" /> : <Clock aria-hidden="true" />}
      {a.kind === 'token' ? `Token ${a.token}` : a.start ? timeLabel(a.start) : 'Time to be given'}
      {a.doctorName ? ` · ${a.doctorName}` : ''}
    </span>
  );
}

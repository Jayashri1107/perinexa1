import { useState } from 'react';
import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Hash, IndianRupee, Plane } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { BookDialog, CancelDialog, FeeDialog, MoveDialog } from './AppointmentDialogs.jsx';
import { NEEDS_TIME_LOOK, STATUS_LOOK, VISIT_TYPE_LABELS, addDaysIso, dayLabel, timeLabel, whenLabel, whoLabel } from './appointmentFormat.js';

// Appointment booking (docs/APPOINTMENTS_PLAN.md): one doctor's day in 10-minute slots. Reception and doctors click
// a free time to book (a registered patient, or a new one with name and phone), and move or cancel bookings. RMOs
// and nurses can look. The doctor and day are in the address (?doctor=…&date=…), so a page can be shared or reloaded.

export const appointmentTabs = (canBook) => [
  { label: 'Day', to: '/appointments', end: true },
  { label: 'Month', to: '/appointments/month', end: true },
  { label: 'Needs a time', to: '/appointments/needs-time', end: true },
  ...(canBook !== false ? [{ label: 'OPD timings', to: '/appointments/timings', end: true }] : []),
];

/** One booking in a list: who, visit type, status, and Move / Cancel. */
export function AppointmentLine({ a, canBook, onMove, onCancel, onFee = null, showWhen = false, showDoctor = false }) {
  const look = a.needsTime ? NEEDS_TIME_LOOK : STATUS_LOOK[a.status];
  const changeable = canBook && a.kind === 'slot' && a.status === 'booked';
  // Reception may take the consultation fee in advance: a registered patient's New or Follow-up visit, not yet seen
  const feeDue = onFee && !a.fee && a.patient && a.kind === 'slot' && ['booked', 'arrived'].includes(a.status) && ['new', 'follow_up'].includes(a.visitType);
  return (
    <div className="appt-line">
      <div className="appt-line-who">
        {a.patient ? (
          <Link to={`/patients/${a.patient.id}`}>
            <strong>{a.patient.fullName}</strong>
          </Link>
        ) : (
          <strong>{a.guest?.name}</strong>
        )}
        <span className="muted">
          {[
            showWhen ? `${dayLabel(a.date)} · ${whenLabel(a)}` : null,
            showDoctor ? a.doctor.name : null,
            a.patient ? a.patient.mrn : 'Not registered yet',
            a.patient?.phone || a.guest?.phone,
            `${VISIT_TYPE_LABELS[a.visitType]}${a.minutes > 10 ? ` (${a.minutes} minutes)` : ''}`,
            a.fromVisit ? 'from the next visit' : null,
            a.source === 'portal' ? 'booked online by the patient' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="appt-line-actions">
        {look && (
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.label}
          </StatusPill>
        )}
        {a.fee &&
          (onFee ? (
            <Link to={`/billing/bills/${a.fee.billId}`} className="appt-fee-paid" title={`Bill ${a.fee.number}`}>
              <StatusPill tone="stable" icon={Check}>
                Fee paid {rupees(a.fee.amountPaise)}
              </StatusPill>
            </Link>
          ) : (
            <StatusPill tone="stable" icon={Check}>
              Fee paid
            </StatusPill>
          ))}
        {feeDue && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFee(a)}>
            <IndianRupee aria-hidden="true" /> Take fee
          </button>
        )}
        {changeable && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(a)}>
              {a.needsTime ? 'Give a time' : 'Move'}
            </button>
            <button type="button" className="btn btn-link btn-sm" onClick={() => onCancel(a)} aria-label={`Cancel the appointment of ${whoLabel(a)}`}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The Book / Move / Cancel dialogs of a page, and what to do after. */
export function useAppointmentDialogs({ doctors, today, onDone }) {
  const [dialog, setDialog] = useState(null); // { kind: 'book' | 'move' | 'cancel', … }
  const [flash, setFlash] = useState(null);
  const done = (message) => {
    setDialog(null);
    setFlash(message);
    onDone?.();
  };
  const element = !dialog ? null : dialog.kind === 'book' ? (
    <BookDialog
      doctor={dialog.doctor}
      date={dialog.date}
      start={dialog.start}
      patient={dialog.patient ?? null}
      lengths={dialog.lengths ?? null}
      onClose={() => setDialog(null)}
      onBooked={(a) => done(`Booked: ${whoLabel(a)}, ${dayLabel(a.date)} at ${timeLabel(a.start)} with ${a.doctor.name}.`)}
    />
  ) : dialog.kind === 'move' ? (
    <MoveDialog
      appointment={dialog.appointment}
      doctors={doctors}
      today={today}
      onClose={() => setDialog(null)}
      onMoved={(a) => done(`${whoLabel(a)} is now booked for ${dayLabel(a.date)} at ${timeLabel(a.start)} with ${a.doctor.name}.`)}
    />
  ) : dialog.kind === 'fee' ? (
    <FeeDialog
      appointment={dialog.appointment}
      onClose={() => setDialog(null)}
      onTaken={(out) => done(`Fee received from ${whoLabel(out.appointment)}: ${rupees(out.appointment.fee?.amountPaise ?? 0)}, receipt ${out.receipt}. Print it from her bill (click "Fee paid").`)}
    />
  ) : (
    <CancelDialog
      appointment={dialog.appointment}
      onClose={() => setDialog(null)}
      onCancelled={(a) => done(`Cancelled: ${whoLabel(a)}, ${dayLabel(a.date)}.${dialog.appointment.fee ? ' Her fee now shows as due back on her bill (Billing → Unpaid).' : ''}`)}
    />
  );
  return {
    element,
    flash,
    clearFlash: () => setFlash(null),
    book: (doctor, date, start, patient, lengths) => setDialog({ kind: 'book', doctor, date, start, patient, lengths }),
    move: (appointment) => setDialog({ kind: 'move', appointment }),
    cancel: (appointment) => setDialog({ kind: 'cancel', appointment }),
    fee: (appointment) => setDialog({ kind: 'fee', appointment }),
  };
}

export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const doctorsRes = useFetch('/appointments/doctors');
  const info = doctorsRes.data;
  const doctors = info?.doctors ?? [];
  const today = info?.today;
  const doctorId = params.get('doctor') || info?.me || doctors[0]?.id || null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : today;
  const day = useFetch(doctorId && date ? '/appointments/day' : null, { doctorId, date });
  const dialogs = useAppointmentDialogs({ doctors, today, onDone: day.reload });
  // A patient chosen elsewhere to book (her record's "Book an appointment")
  const forPatient = location.state?.bookFor ?? null;

  const go = (next) => setParams({ ...(doctorId ? { doctor: doctorId } : {}), ...next }, { replace: true });
  const d = day.data;
  const canBook = Boolean(info?.canBook && d?.canBook);
  const doctor = doctors.find((x) => x.id === doctorId);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Appointments' }]}
        title="Appointments"
        subtitle={[doctor?.name, date ? dayLabel(date) : null].filter(Boolean).join(' · ')}
        tabs={appointmentTabs(info?.canBook)}
      />
      <div className="pf-content appt-page">
        <Alert type="success" onClose={dialogs.clearFlash}>
          {dialogs.flash}
        </Alert>
        {doctorsRes.error && <Alert type="error">{doctorsRes.error}</Alert>}
        {forPatient && <Alert type="info">Choose a free time to book {forPatient.fullName}.</Alert>}
        {info && !doctors.length && <Alert type="warning">There are no doctors in this hospital yet.</Alert>}

        {doctors.length > 0 && (
          <div className="card appt-toolbar">
            <label className="appt-toolbar-field">
              <span className="field-label">Doctor</span>
              <select value={doctorId ?? ''} onChange={(e) => go({ doctor: e.target.value, ...(date ? { date } : {}) })}>
                {doctors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.hasTimings ? '' : ' (no OPD timings yet)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="appt-daynav" role="group" aria-label="Day">
              <button type="button" className="icon-btn" onClick={() => go({ date: addDaysIso(date, -1) })} aria-label="Previous day" disabled={!date}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <input type="date" aria-label="Day" value={date ?? ''} onChange={(e) => e.target.value && go({ date: e.target.value })} />
              <button type="button" className="icon-btn" onClick={() => go({ date: addDaysIso(date, 1) })} aria-label="Next day" disabled={!date}>
                <ChevronRight aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => go({ date: today })} disabled={date === today}>
                Today
              </button>
            </div>
          </div>
        )}

        {day.error && <Alert type="error">{day.error}</Alert>}
        {d && !d.hasTimings && (
          <Alert type="warning">
            {d.doctor.name} has not set OPD timings yet, so there are no times to book.{' '}
            {doctor?.canEditTimings && <Link to={`/appointments/timings?doctor=${d.doctor.id}`}>Set the OPD timings</Link>}
          </Alert>
        )}
        {d?.leave && (
          <Alert type="warning" icon={Plane}>
            {d.doctor.name} is on leave{d.leave.note ? ` (${d.leave.note})` : ''} from {dayLabel(d.leave.from)} to {dayLabel(d.leave.to)}.
          </Alert>
        )}
        {d && d.hasTimings && !d.leave && !d.slots.length && <Alert type="info">{d.doctor.name} has no OPD on this day.</Alert>}

        {d && d.other.length > 0 && (
          <section className="card appt-section" aria-labelledby="appt-other-title">
            <h2 id="appt-other-title">
              <Clock aria-hidden="true" /> To give a time
            </h2>
            <p className="hint">Booked for this day without a time (e.g. from a next visit while the doctor was on leave), or at a time no longer in the OPD timings.</p>
            <ul className="appt-lines">
              {d.other.map((a) => (
                <li key={a.id}>
                  <AppointmentLine a={a} canBook={canBook} onMove={dialogs.move} onCancel={dialogs.cancel} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {d && d.slots.length > 0 && (
          <section className="card appt-section" aria-labelledby="appt-slots-title">
            <h2 id="appt-slots-title">
              <CalendarClock aria-hidden="true" /> Times
              <span className="muted appt-count">
                {d.slots.filter((s) => s.appointments.length || s.busyWith).length} of {d.slots.length} booked
              </span>
            </h2>
            {d.sessions.length > 0 && <p className="hint">OPD: {d.sessions.map((s) => `${timeLabel(s.from)} – ${timeLabel(s.to)}`).join(', ')} · {d.slotMinutes}-minute slots</p>}
            <ol className="appt-slots">
              {d.slots.map((s) => (
                <li key={s.start} className={`appt-slot ${s.past ? 'is-past' : ''} ${s.appointments.length || s.busyWith ? 'is-booked' : 'is-free'}`}>
                  <span className="appt-slot-time">{timeLabel(s.start)}</span>
                  <div className="appt-slot-body">
                    {s.appointments.map((a) => (
                      <AppointmentLine key={a.id} a={a} canBook={canBook} onMove={dialogs.move} onCancel={dialogs.cancel} onFee={d.canTakeFee ? dialogs.fee : null} />
                    ))}
                    {s.busyWith && (
                      <span className="muted">
                        Taken – the {timeLabel(s.busyWith.start)} visit{s.busyWith.name ? ` of ${s.busyWith.name}` : ''} is still going on
                      </span>
                    )}
                    {!s.appointments.length && !s.busyWith && (s.past ? <span className="muted">Free (passed)</span> : <span className="muted">Free</span>)}
                  </div>
                  {canBook && !s.past && (
                    <button
                      type="button"
                      className={`btn btn-sm ${s.appointments.length || s.busyWith ? 'btn-link' : 'btn-secondary'}`}
                      onClick={() => dialogs.book(d.doctor, d.date, s.start, forPatient, d.lengths)}
                      aria-label={`Book ${timeLabel(s.start)}${s.appointments.length ? ' (already booked)' : ''}`}
                    >
                      <CalendarPlus aria-hidden="true" /> {s.appointments.length || s.busyWith ? 'Add' : 'Book'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {d && d.tokens.length > 0 && (
          <section className="card appt-section" aria-labelledby="appt-tokens-title">
            <h2 id="appt-tokens-title">
              <Hash aria-hidden="true" /> Walk-ins
            </h2>
            <ul className="appt-lines">
              {d.tokens.map((a) => (
                <li key={a.id} className="appt-token-row">
                  <span className="appt-slot-time">Token {a.token}</span>
                  <AppointmentLine a={a} canBook={false} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {dialogs.element}
    </>
  );
}

/** "Needs a time": next visits the app could not place, from today on – reception gives each a time. */
export function NeedsTimePage() {
  const doctorsRes = useFetch('/appointments/doctors');
  const list = useFetch('/appointments/needs-time');
  const info = doctorsRes.data;
  const dialogs = useAppointmentDialogs({ doctors: info?.doctors ?? [], today: info?.today, onDone: list.reload });
  const rows = list.data?.appointments ?? [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Appointments', to: '/appointments' }, { label: 'Needs a time' }]} title="Needs a time" tabs={appointmentTabs(info?.canBook)} />
      <div className="pf-content appt-page">
        <Alert type="success" onClose={dialogs.clearFlash}>
          {dialogs.flash}
        </Alert>
        {list.error && <Alert type="error">{list.error}</Alert>}
        <section className="card appt-section" aria-labelledby="appt-needs-title">
          <h2 id="appt-needs-title">
            <Clock aria-hidden="true" /> Next visits without a time <span className="muted appt-count">{rows.length}</span>
          </h2>
          <p className="hint">
            A doctor set a next visit, but the app could not book a time: the doctor was on leave, had no OPD that day, or the day was full. Give each one a
            time and tell the patient.
          </p>
          {list.data && !rows.length && <p className="muted">Nothing to do: every next visit has a time.</p>}
          <ul className="appt-lines">
            {rows.map((a) => (
              <li key={a.id}>
                <AppointmentLine a={a} canBook={list.data.canBook} onMove={dialogs.move} onCancel={dialogs.cancel} showWhen showDoctor />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {dialogs.element}
    </>
  );
}

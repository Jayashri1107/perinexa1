import { useState } from 'react';
import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Footprints, IndianRupee, PenLine, Plane, Plus, Settings, UserCheck } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, useDialogFocus } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canRegisterPatients } from '../../platform/modules.js';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { BookDialog, CancelDialog, FeeDialog, MoveDialog, NewAppointmentDialog } from './AppointmentDialogs.jsx';
import { EditPatientDialog, RegisterAndBook } from './RegisterAndBook.jsx';
import { NEEDS_TIME_LOOK, STATUS_LOOK, VISIT_TYPE_LABELS, addDaysIso, dayLabel, dayList, firstName, slotGroups, timeLabel, whenLabel, whoLabel } from './appointmentFormat.js';
import { ExportButton } from '../../components/ExportButton.jsx';

// Appointment booking (docs/APPOINTMENTS_PLAN.md): one doctor's day in 10-minute slots. Reception and doctors click
// a free time to book (a registered patient, or a new one with name and phone), and move or cancel bookings. RMOs
// and nurses can look. The doctor and day are in the address (?doctor=…&date=…), so a page can be shared or reloaded.

/** A free slot kept for walk-ins (owner, 17 Oct 2026): not offered online; reception and doctors book it here. */
const WalkInWord = () => (
  <>
    <Footprints aria-hidden="true" className="appt-walkin-icon" /> Walk-in
  </>
);

export const appointmentTabs = (canBook) => [
  { label: 'Schedule', to: '/appointments', end: true },
  { label: 'Month', to: '/appointments/month', end: true },
  { label: 'Needs a time', to: '/appointments/needs-time', end: true },
  ...(canBook !== false ? [{ label: 'OPD settings', to: '/appointments/timings', end: true }] : []),
];

/** Up to two initials of a name, for the round badge beside it ("Asha Sample" → "AS"). */
export const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/**
 * One booking in a list: who, visit type, status, then the actions on one row – Edit info, Take fee, Reschedule, and
 * Cancel last (doctors and reception). Edit info (those who register patients, 26 Oct 2026), in a dialog on this page:
 * her details (onEdit), or for a booking "Not registered yet" her registration with that name and phone (onRegister).
 * avatar: the initials in a round badge (the day's list of patients).
 */
export function AppointmentLine({ a, canBook, onMove, onCancel, onFee = null, onEdit = null, onRegister = null, showWhen = false, showDoctor = false, avatar = false }) {
  const look = a.needsTime ? NEEDS_TIME_LOOK : STATUS_LOOK[a.status];
  const changeable = canBook && a.kind === 'slot' && a.status === 'booked';
  // Reception may take the consultation fee in advance: a registered patient's New or Follow-up visit, not yet seen
  const feeDue = onFee && !a.fee && a.patient && a.kind === 'slot' && ['booked', 'arrived'].includes(a.status) && ['new', 'follow_up'].includes(a.visitType);
  const editInfo = a.patient ? onEdit && (() => onEdit(a)) : onRegister && a.guest && ['booked', 'arrived'].includes(a.status) && (() => onRegister(a));
  const hasActions = Boolean(editInfo || feeDue || changeable);
  return (
    <div className="appt-line">
      <div className="appt-line-top">
        {avatar && (
          <span className={`appt-avatar${a.patient ? '' : ' is-guest'}`} aria-hidden="true">
            {initialsOf(whoLabel(a))}
          </span>
        )}
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
        <div className="appt-line-pills">
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
        </div>
      </div>
      {hasActions && (
        <div className="appt-line-actions">
          {editInfo && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={editInfo} aria-label={`Edit the information of ${whoLabel(a)}`}>
              <PenLine aria-hidden="true" /> Edit info
            </button>
          )}
          {feeDue && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFee(a)}>
              <IndianRupee aria-hidden="true" /> Take fee
            </button>
          )}
          {changeable && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(a)}>
                <CalendarClock aria-hidden="true" /> {a.needsTime ? 'Give a time' : 'Reschedule'}
              </button>
              <button type="button" className="btn btn-link btn-sm appt-cancel" onClick={() => onCancel(a)} aria-label={`Cancel the appointment of ${whoLabel(a)}`}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
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
      onMoved={(a, messaged) =>
        done(`${whoLabel(a)} is now booked for ${dayLabel(a.date)} at ${timeLabel(a.start)} with ${a.doctor.name}.${messaged ? ' She is sent a message with the new time.' : ''}`)
      }
    />
  ) : dialog.kind === 'edit' ? (
    <EditPatientDialog
      patientId={dialog.appointment.patient.id}
      onClose={() => setDialog(null)}
      onSaved={(p) => done(`Saved: the details of ${p?.fullName ?? whoLabel(dialog.appointment)}.`)}
    />
  ) : dialog.kind === 'register' ? (
    <RegisterDialog appointment={dialog.appointment} onClose={() => setDialog(null)} onDone={(a, p) => done(`${p.fullName} is registered as ${p.mrn}; her booking of ${dayLabel(a.date)} is on her record.`)} />
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
    edit: (appointment) => setDialog({ kind: 'edit', appointment }),
    register: (appointment) => setDialog({ kind: 'register', appointment }),
  };
}

/** Register the patient of a booking made by name and phone, in a dialog (RegisterAndBook with the booking). */
function RegisterDialog({ appointment: a, onClose, onDone }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide modal-register" role="dialog" aria-modal="true" aria-labelledby="appt-register-title">
        <h2 id="appt-register-title">Edit info – {whoLabel(a)}</h2>
        <p className="muted">Not registered yet: fill in her details to register her. Her booking joins her record.</p>
        <p className="appt-when">
          <CalendarClock aria-hidden="true" /> Booked: {dayLabel(a.date)} · {whenLabel(a)} · {a.doctor.name}
        </p>
        <RegisterAndBook doctor={a.doctor} date={a.date} start={a.start} appointment={a} onBooked={onDone} onCancel={onClose} />
      </div>
    </div>
  );
}

export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const registers = canRegisterPatients(useAuth()?.activeMembership?.roles ?? []); // Edit details / Register in a dialog
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
  const needsTime = useFetch('/appointments/needs-time');
  // the New appointment dialog – open at once when a patient's record sent her here to book
  const [choosing, setChoosing] = useState(Boolean(location.state?.bookFor));

  const go = (next) => setParams({ ...(doctorId ? { doctor: doctorId } : {}), ...next }, { replace: true });
  const d = day.data;
  const canBook = Boolean(info?.canBook && d?.canBook);
  const doctor = doctors.find((x) => x.id === doctorId);
  // The numbers above the schedule: this doctor's chosen day, and every next visit still waiting for a time
  const booked = d ? [...d.slots.flatMap((s) => s.appointments), ...d.other] : [];
  const live = booked.filter((a) => ['booked', 'arrived'].includes(a.status)).length;
  const seen = [...booked, ...(d?.tokens ?? [])].filter((a) => a.status === 'seen').length;
  const free = d ? d.slots.filter((s) => !s.past && !s.appointments.length && !s.busyWith).length : 0;
  // The day at a glance: the times by part of the day, and everyone on the day in order (walk-ins and bookings
  // without a time included), the next one marked
  const groups = slotGroups(d?.slots);
  const people = dayList(d);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Appointments' }]}
        title="Appointments"
        tabs={appointmentTabs(info?.canBook)}
        actions={
          <>
            <ExportButton what="appointments" />
            {info?.canBook && doctors.length > 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => setChoosing(true)}>
                <CalendarPlus aria-hidden="true" /> New appointment
              </button>
            ) : null}
          </>
        }
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
            {d && (
              <p className="appt-hours">
                <Clock aria-hidden="true" />
                {!d.hasTimings ? 'No OPD timings yet' : d.leave ? 'On leave this day' : d.sessions.length ? `OPD ${d.sessions.map((s) => `${timeLabel(s.from)}–${timeLabel(s.to)}`).join(', ')}` : 'No OPD this day'}
              </p>
            )}
          </div>
        )}

        {d && d.hasTimings && (
          <p className="appt-summary" role="status">
            <span className="appt-stat is-booked">
              <strong>{live}</strong> booked
            </span>
            <span className="appt-stat is-free">
              <strong>{free}</strong> free
            </span>
            <span className="appt-stat is-seen">
              <strong>{seen}</strong> seen
            </span>
            {needsTime.data?.appointments.length > 0 && (
              <Link to="/appointments/needs-time">
                <strong>{needsTime.data.appointments.length}</strong> {needsTime.data.appointments.length === 1 ? 'needs' : 'need'} a time
              </Link>
            )}
          </p>
        )}
        {day.error && <Alert type="error">{day.error}</Alert>}
        {d && !d.hasTimings && (
          <section className="card appt-setup">
            <span className="appt-setup-icon" aria-hidden="true">
              <Settings />
            </span>
            <div>
              <h2>OPD timings not set for {d.doctor.name}</h2>
              <p className="muted">The working days, consultation hours and leave days decide which times can be booked. Until they are set, there is nothing to book for this doctor.</p>
              {doctor?.canEditTimings ? (
                <Link to={`/appointments/timings?doctor=${d.doctor.id}`} className="btn btn-secondary">
                  <Settings aria-hidden="true" /> Set the OPD timings
                </Link>
              ) : (
                <p>
                  <strong>Ask {d.doctor.name} or the hospital admin</strong> to set them in Appointments → OPD settings. Walk-in tokens still work on the Today page.
                </p>
              )}
            </div>
          </section>
        )}
        {d?.leave && (
          <Alert type="warning" icon={Plane}>
            {d.doctor.name} is on leave{d.leave.note ? ` (${d.leave.note})` : ''} from {dayLabel(d.leave.from)} to {dayLabel(d.leave.to)}.
          </Alert>
        )}
        {d && d.hasTimings && !d.leave && !d.slots.length && <Alert type="info">{d.doctor.name} has no OPD on this day.</Alert>}

        {d && (d.slots.length > 0 || people.list.length > 0) && (
          <div className="appt-day">
            {d.slots.length > 0 && (
              <section className="card appt-section appt-times" aria-labelledby="appt-slots-title">
                <h2 id="appt-slots-title">
                  <CalendarClock aria-hidden="true" /> Times
                  <span className="muted appt-count">{d.slotMinutes}-minute slots</span>
                </h2>
                {/* What the colours of the times mean – in words too */}
                <ul className="appt-legend" aria-label="What the times show">
                  <li className="is-free">Free – click to book</li>
                  <li className="is-booked">Booked</li>
                  <li className="is-walkin">Kept for walk-ins</li>
                  <li className="is-past">Passed</li>
                </ul>
                {groups.map((g) => (
                  <div key={g.label} className="appt-part">
                    <h3>{g.label}</h3>
                    <ul className="appt-chips">
                      {g.slots.map((s) => {
                        const taken = s.appointments.length > 0 || Boolean(s.busyWith);
                        const bookHere = () => dialogs.book(d.doctor, d.date, s.start, forPatient, d.lengths);
                        return (
                          <li key={s.start} className={`appt-chip ${taken ? 'is-booked' : 'is-free'} ${s.past ? 'is-past' : ''}${s.walkIn && !taken ? ' is-walkin' : ''}`}>
                            {!taken ? (
                              canBook && !s.past ? (
                                <button type="button" className="appt-chip-main" onClick={bookHere} aria-label={`Book ${timeLabel(s.start)}${s.walkIn ? ' (kept for walk-ins)' : ''}`}>
                                  <span className="appt-chip-time">{timeLabel(s.start)}</span>
                                  <span className="appt-chip-who">{s.walkIn ? <WalkInWord /> : 'Free'}</span>
                                </button>
                              ) : (
                                <span className="appt-chip-main">
                                  <span className="appt-chip-time">{timeLabel(s.start)}</span>
                                  <span className="appt-chip-who">{s.walkIn ? <WalkInWord /> : 'Free'}</span>
                                </span>
                              )
                            ) : (
                              <span className="appt-chip-main" title={s.appointments.map(whoLabel).join(', ') || 'Taken by the visit before'}>
                                <span className="appt-chip-time">{timeLabel(s.start)}</span>
                                <span className="appt-chip-who">{s.appointments.length ? s.appointments.map(firstName).join(', ') : 'Taken'}</span>
                              </span>
                            )}
                            {taken && canBook && !s.past && (
                              <button type="button" className="appt-chip-add" onClick={bookHere} aria-label={`Add another booking at ${timeLabel(s.start)}`} title="Add another booking">
                                <Plus aria-hidden="true" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {!groups.length && <p className="muted">Every time of this day has passed.</p>}
              </section>
            )}
            <section className="card appt-section appt-people" aria-labelledby="appt-people-title">
              <h2 id="appt-people-title">
                <UserCheck aria-hidden="true" /> {date === today && doctorId === info?.me ? 'My patients today' : `Patients on ${dayLabel(date)}`}
              </h2>
              {people.list.length === 0 ? (
                <p className="muted">No one booked yet.</p>
              ) : (
                <ul className="appt-lines">
                  {people.list.map((a) => (
                    <li key={a.id} className={`appt-token-row appt-card is-${a.needsTime ? 'needs-time' : a.status}${a === people.next ? ' is-next' : ''}`}>
                      <span className="appt-slot-time">
                        {whenLabel(a)}
                        {a.minutes > 10 && <span className="appt-card-length">{a.minutes} min</span>}
                      </span>
                      <div className="appt-person">
                        {a === people.next && (
                          <StatusPill tone="brand" icon={ChevronRight}>
                            Next
                          </StatusPill>
                        )}
                        <AppointmentLine avatar a={a} canBook={canBook && a.kind !== 'token'} onMove={dialogs.move} onCancel={dialogs.cancel} onFee={d.canTakeFee ? dialogs.fee : null} onEdit={registers ? dialogs.edit : null} onRegister={registers ? dialogs.register : null} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
      {dialogs.element}
      {choosing && doctors.length > 0 && today && (
        <NewAppointmentDialog
          doctors={doctors}
          today={today}
          doctorId={doctorId}
          date={date}
          onClose={() => setChoosing(false)}
          onChosen={(c) => {
            setChoosing(false);
            dialogs.book(c.doctor, c.date, c.start, forPatient, c.lengths);
          }}
        />
      )}
    </>
  );
}

/** "Needs a time": next visits the app could not place, from today on – reception gives each a time. */
export function NeedsTimePage() {
  const registers = canRegisterPatients(useAuth()?.activeMembership?.roles ?? []);
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
                <AppointmentLine a={a} canBook={list.data.canBook} onMove={dialogs.move} onCancel={dialogs.cancel} onEdit={registers ? dialogs.edit : null} onRegister={registers ? dialogs.register : null} showWhen showDoctor />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {dialogs.element}
    </>
  );
}

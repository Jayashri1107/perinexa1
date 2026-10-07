// One doctor's day (as in Perinexa's Appointments → Day): the time slots with who is booked, walk-in tokens, and –
// today – who is waiting, in the order to call them. Reception and doctors book, move and cancel; doctors, RMOs and
// nurses mark a patient as seen. The doctor and day are kept in the address, so a reload stays on them.
import { CalendarX, ChevronLeft, ChevronRight, DoorOpen, Plus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { labelOf } from '../../utils/format.js';
import { AppointmentActions } from './AppointmentActions.jsx';
import { BookDialog, WalkInDialog } from './AppointmentDialogs.jsx';
import { AppointmentsFrame } from './AppointmentsFrame.jsx';
import { addDaysIso, appointmentLook, dayText, phoneOf, whenText, whoText } from './appointmentFormat.js';

// The doctors who take appointments, and what this person may do (loaded once per page).
export function useAppointmentDoctors() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    appointmentsApi.doctors().then(setInfo).catch((err) => setError(err.message));
  }, []);
  return { info, error };
}

function AppointmentRow({ a, day, info, onChanged, onError }) {
  const { opd } = useAppConfig();
  return (
    <div className="appt-row">
      <div className="appt-who">
        {a.patient ? <Link to={`/hospital/patients/${a.patient.id}`}><strong>{whoText(a)}</strong></Link> : <strong>{whoText(a)}</strong>}
        <span className="muted small block">
          {[a.patient?.patientNumber, labelOf(opd.visitTypes, a.visitType), a.minutes && `${a.minutes} min`, phoneOf(a)].filter(Boolean).join(' · ')}
        </span>
      </div>
      <StateBadge look={appointmentLook(a)} small />
      <AppointmentActions appointment={a} today={day.today} canBook={day.canBook} canMarkSeen={day.canMarkSeen} doctors={info.doctors} onChanged={onChanged} onError={onError} showPatientLink={false} />
    </div>
  );
}

export function DayPage() {
  const { info, error: infoError } = useAppointmentDoctors();
  const [params, setParams] = useSearchParams();
  const [day, setDay] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'book' | 'walkin', start? }
  const [showFree, setShowFree] = useState(true);

  const wanted = params.get('doctor') || info?.me;
  const doctorId = (info?.doctors.some((x) => x.id === wanted) ? wanted : info?.doctors[0]?.id) || '';
  const date = params.get('date') || info?.today || '';
  const choose = (next) => setParams({ doctor: next.doctor ?? doctorId, date: next.date ?? date }, { replace: true });

  const load = useCallback(() => {
    if (!doctorId || !date) return;
    setError('');
    appointmentsApi.day(doctorId, date).then(setDay).catch((err) => setError(err.message));
  }, [doctorId, date]);
  useEffect(load, [load]);

  if (infoError) return <AppointmentsFrame><Alert type="error">{infoError}</Alert></AppointmentsFrame>;
  if (!info) return <AppointmentsFrame><Loader /></AppointmentsFrame>;
  if (!info.doctors.length) {
    return (
      <AppointmentsFrame>
        <Alert type="info">No doctor works in this hospital yet. The hospital admin adds doctors under Hospital admin → Staff.</Alert>
      </AppointmentsFrame>
    );
  }

  const isToday = day?.date === day?.today;
  const changed = () => load();
  const doctor = info.doctors.find((d) => d.id === doctorId);
  // free slots that have passed are of no use: only booked ones stay
  const slots = day ? day.slots.filter((s) => s.appointments.length || s.busyWith || (showFree && !s.past)) : [];

  return (
    <AppointmentsFrame
      subtitle="One doctor’s day: booked times, walk-ins and who is waiting."
      actions={
        info.canBook && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'walkin' })}><UserPlus size={16} aria-hidden /> Walk-in</button>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'book' })}><Plus size={16} aria-hidden /> Book</button>
          </>
        )
      }
    >
      <section className="card day-toolbar">
        <label className="filter">
          <span>Doctor</span>
          <select value={doctorId} onChange={(e) => choose({ doctor: e.target.value })}>
            {info.doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.id === info.me ? ' (me)' : ''}</option>
            ))}
          </select>
        </label>
        <div className="day-nav">
          <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => choose({ date: addDaysIso(date, -1) })}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose({ date: info.today })}>Today</button>
          <button type="button" className="icon-btn" aria-label="Next day" onClick={() => choose({ date: addDaysIso(date, 1) })}><ChevronRight size={18} /></button>
          <input type="date" value={date} aria-label="Day" onChange={(e) => e.target.value && choose({ date: e.target.value })} />
        </div>
        <h2 className="day-title" aria-live="polite">{dayText(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      </section>

      <Alert type="error">{error}</Alert>
      {!day && !error && <Loader />}

      {day && (
        <>
          {!day.hasTimings && (
            <Alert type="info">
              {doctor?.name} has no OPD timings yet, so there are no time slots.{' '}
              {doctor?.canEditTimings && <Link to="/hospital/appointments/timings">Set OPD timings</Link>}
            </Alert>
          )}
          {day.leave && (
            <Alert type="info"><CalendarX size={14} aria-hidden /> On leave {dayText(day.leave.from)} to {dayText(day.leave.to)}{day.leave.note ? ` – ${day.leave.note}` : ''}.</Alert>
          )}
          {day.hasTimings && !day.leave && !day.sessions.length && <Alert type="info">No OPD on this day.</Alert>}

          <div className="day-layout">
            <section className="card">
              <div className="card-head">
                <h2>Time slots {day.sessions.length > 0 && <span className="muted small">{day.sessions.map((s) => `${s.from}–${s.to}`).join(', ')}</span>}</h2>
                {day.slots.length > 0 && (
                  <label className="inline-check small">
                    <input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} /> Show free slots
                  </label>
                )}
              </div>
              {slots.length === 0 && <p className="muted">{day.slots.length ? 'No bookings on this day.' : 'No time slots on this day.'}</p>}
              <ul className="slot-list">
                {slots.map((s) => (
                  <li key={s.start} className={`slot${s.past ? ' past' : ''}`}>
                    <span className="slot-time">{s.start}</span>
                    <div className="slot-body">
                      {s.appointments.map((a) => (
                        <AppointmentRow key={a.id} a={a} day={day} info={info} onChanged={changed} onError={setError} />
                      ))}
                      {!s.appointments.length && s.busyWith && <span className="muted small">Taken by the {s.busyWith.start} visit{s.busyWith.name ? ` (${s.busyWith.name})` : ''}</span>}
                      {!s.appointments.length && !s.busyWith && (
                        <span className="slot-free">
                          <span className="muted small">{s.past ? 'Passed' : 'Free'}</span>
                          {!s.past && day.canBook && (
                            <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ kind: 'book', start: s.start })}>Book</button>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <div className="day-side">
              {isToday && (
                <section className="card">
                  <h2><DoorOpen size={18} aria-hidden /> Waiting</h2>
                  {day.waiting.length === 0 && <p className="muted">Nobody is waiting.</p>}
                  <ol className="waiting-list">
                    {day.waiting.map((a) => (
                      <li key={a.id}>
                        <AppointmentRow a={a} day={day} info={info} onChanged={changed} onError={setError} />
                        <span className="muted small">{whenText(a)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <section className="card">
                <h2>Walk-ins</h2>
                {day.tokens.length === 0 && <p className="muted">No walk-ins.</p>}
                {day.tokens.map((a) => (
                  <div key={a.id} className="token-row">
                    <span className="token">{a.token}</span>
                    <AppointmentRow a={a} day={day} info={info} onChanged={changed} onError={setError} />
                  </div>
                ))}
              </section>
              {day.other.length > 0 && (
                <section className="card">
                  <h2>Not on a slot</h2>
                  <p className="muted small">Bookings with no time yet, or at a time that is no longer in the doctor’s timings.</p>
                  {day.other.map((a) => (
                    <div key={a.id} className="token-row">
                      <span className="muted small nowrap">{whenText(a)}</span>
                      <AppointmentRow a={a} day={day} info={info} onChanged={changed} onError={setError} />
                    </div>
                  ))}
                </section>
              )}
            </div>
          </div>
        </>
      )}

      {dialog?.kind === 'book' && (
        <BookDialog
          doctors={info.doctors}
          initial={{ doctorId, date, start: dialog.start }}
          onClose={() => setDialog(null)}
          onDone={(a) => {
            setDialog(null);
            if (a.doctor.id !== doctorId || a.date !== date) choose({ doctor: a.doctor.id, date: a.date });
            else load();
          }}
        />
      )}
      {dialog?.kind === 'walkin' && (
        <WalkInDialog
          doctors={info.doctors}
          doctorId={doctorId}
          onClose={() => setDialog(null)}
          onDone={(a) => {
            setDialog(null);
            choose({ doctor: a.doctor.id, date: a.date });
            load();
          }}
        />
      )}
    </AppointmentsFrame>
  );
}

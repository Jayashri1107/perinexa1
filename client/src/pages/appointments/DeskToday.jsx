import { CalendarOff, Phone, PhoneCall, Plane, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusPill } from '../../components/ui.jsx';
import { Section } from '../worklist/WorklistSections.jsx';
import { dayLabel, timeLabel, whoLabel } from './appointmentFormat.js';

// The front desk's day (owner, 14 Oct 2026), from GET /appointments/desk: which doctors are in today, and tomorrow's
// bookings to call and confirm.

/** A doctor's state today: colour + icon + word, and the hours or why there is no OPD. */
export function doctorToday(d) {
  if (d.leave) return { tone: 'watch', icon: Plane, word: 'On leave', line: `Until ${dayLabel(d.leave.to)}${d.leave.note ? ` · ${d.leave.note}` : ''}` };
  if (!d.hasTimings) return { tone: 'inactive', icon: CalendarOff, word: 'No OPD timings', line: 'Set in Appointments → OPD settings' };
  if (!d.sessions.length) return { tone: 'inactive', icon: CalendarOff, word: 'No OPD today', line: '' };
  return { tone: 'stable', icon: Stethoscope, word: 'In OPD', line: d.sessions.map((s) => `${timeLabel(s.from)}–${timeLabel(s.to)}`).join(', ') };
}

/** "Doctors today": one row per doctor – state, hours, and how many are expected, waiting and seen. */
export function DoctorsToday({ doctors }) {
  if (!doctors?.length) return null;
  return (
    <section className="card desk-doctors" aria-labelledby="desk-doctors-title">
      <h2 id="desk-doctors-title">
        <Stethoscope aria-hidden="true" /> Doctors today
      </h2>
      <ul>
        {doctors.map((d) => {
          const s = doctorToday(d);
          return (
            <li key={d.id}>
              <div className="desk-doctor-who">
                <Link to={`/appointments?doctor=${d.id}`}>
                  <strong>{d.name}</strong>
                </Link>
                {s.line && <span className="muted">{s.line}</span>}
              </div>
              <StatusPill tone={s.tone} icon={s.icon}>
                {s.word}
              </StatusPill>
              <span className="desk-doctor-counts">
                <span>
                  <strong>{d.expected}</strong> expected
                </span>
                <span>
                  <strong>{d.waiting}</strong> waiting
                </span>
                <span>
                  <strong>{d.seen}</strong> seen
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Tomorrow – call to confirm": tomorrow's bookings by time, with the phone to call. */
export function TomorrowCalls({ list, tomorrow }) {
  return (
    <Section id="td-tomorrow" icon={PhoneCall} title={`Tomorrow – call to confirm${tomorrow ? ` (${dayLabel(tomorrow)})` : ''}`} count={list.length} empty="Nobody is booked for tomorrow yet.">
      <ul className="wl-list desk-calls">
        {list.map((a) => {
          const phone = a.patient?.phone || a.guest?.phone || '';
          return (
            <li key={a.id} className="desk-call">
              <span className="appt-slot-time">{a.start ? timeLabel(a.start) : 'No time yet'}</span>
              <div className="desk-call-who">
                {a.patient ? (
                  <Link to={`/patients/${a.patient.id}`}>
                    <strong>{a.patient.fullName}</strong>
                  </Link>
                ) : (
                  <strong>{whoLabel(a)}</strong>
                )}
                <span className="muted">
                  {[a.patient ? a.patient.mrn : 'Not registered yet', a.doctor.name].join(' · ')}
                </span>
              </div>
              {phone ? (
                <a className="btn btn-secondary btn-sm" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                  <Phone aria-hidden="true" /> {phone}
                </a>
              ) : (
                <span className="muted">No phone</span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

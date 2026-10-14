import { CalendarOff, Check, DoorOpen, LogOut, Phone, PhoneCall, Plane, Stethoscope, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusPill, formatTime } from '../../components/ui.jsx';
import { rupees } from '../billing/billingFormat.js';
import { Section } from '../worklist/WorklistSections.jsx';
import { dayLabel, timeLabel, whoLabel } from './appointmentFormat.js';

// The front desk's day (owner, 14 Oct 2026), from GET /appointments/desk: which doctors are in today, and tomorrow's
// bookings to call and confirm.

/** A doctor's state today: colour + icon + word, and the hours or why there is no OPD. */
export function doctorToday(d) {
  if (d.leave) return { tone: 'watch', icon: Plane, word: 'On leave', line: `Until ${dayLabel(d.leave.to)}${d.leave.note ? ` · ${d.leave.note}` : ''}` };
  if (!d.hasTimings) return { tone: 'watch', icon: CalendarOff, word: 'No OPD timings', line: '', setUp: true };
  if (!d.sessions.length) return { tone: 'inactive', icon: CalendarOff, word: 'No OPD today', line: '' };
  return { tone: 'stable', icon: Stethoscope, word: 'In OPD', line: d.sessions.map((s) => `${timeLabel(s.from)}–${timeLabel(s.to)}`).join(', ') };
}

/** "Doctors today": one row per doctor – state, hours, and how many are expected, waiting and seen. */
export function DoctorsToday({ doctors, linkNames = true }) {
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
                {linkNames ? (
                  <Link to={`/appointments?doctor=${d.id}`}>
                    <strong>{d.name}</strong>
                  </Link>
                ) : (
                  <strong>{d.name}</strong>
                )}
                {s.line && <span className="muted">{s.line}</span>}
                {s.setUp && (
                  <Link to={`/appointments/timings?doctor=${d.id}`} className="desk-setup-link">
                    Set the OPD timings
                  </Link>
                )}
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

/** The bill of a stay, from the unpaid bills (none listed: settled, or no charge yet). */
const billOf = (bills, patientId) => (bills ?? []).find((b) => b.stay && b.patient?.id === patientId && b.balance > 0 && !b.cancelled) ?? null;

function StayRow({ x, pill, bill, settledWord }) {
  return (
    <li className="desk-call">
      <span className="appt-slot-time">{[x.ward, x.bed].filter(Boolean).join(' · ') || 'No bed'}</span>
      <div className="desk-call-who">
        <Link to={`/patients/${x.patient.id}`}>
          <strong>{x.patient.fullName}</strong>
        </Link>
        <span className="muted">{x.patient.mrn}</span>
        <span className="desk-stay-pills">
          {pill}
          {bill ? (
            <StatusPill tone="watch" icon={Wallet}>
              {rupees(bill.balance)} to pay
            </StatusPill>
          ) : (
            settledWord && (
              <StatusPill tone="stable" icon={Check}>
                {settledWord}
              </StatusPill>
            )
          )}
        </span>
      </div>
      {bill ? (
        <Link to={`/billing/bills/${bill.id}`} className="btn btn-secondary btn-sm">
          <Wallet aria-hidden="true" /> Open the bill
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * "Discharges": who is going home (her doctor is writing the discharge card – confirming it ends the stay and frees
 * the bed) and who went home today, each with her bill – so the bill is ready before the family comes to the desk.
 * Reception never discharges: that is the doctor's.
 */
export function DischargesSection({ desk, bills }) {
  const count = desk.goingHome.length + desk.dischargedToday.length;
  return (
    <Section id="td-discharges" icon={DoorOpen} title="Discharges" count={count} empty="Nobody is being discharged today.">
      {desk.goingHome.length > 0 && (
        <>
          <h3 className="desk-subtitle">Going home – the doctor is writing the discharge card</h3>
          <ul className="wl-list desk-calls">
            {desk.goingHome.map((x) => (
              <StayRow
                key={x.stayId}
                x={x}
                bill={billOf(bills, x.patient.id)}
                pill={
                  <StatusPill tone="due" icon={LogOut}>
                    Being discharged
                  </StatusPill>
                }
              />
            ))}
          </ul>
        </>
      )}
      {desk.dischargedToday.length > 0 && (
        <>
          <h3 className="desk-subtitle">Discharged today</h3>
          <ul className="wl-list desk-calls">
            {desk.dischargedToday.map((x) => (
              <StayRow
                key={x.stayId}
                x={x}
                bill={billOf(bills, x.patient.id)}
                settledWord="Nothing to pay"
                pill={
                  <StatusPill tone="inactive" icon={DoorOpen}>
                    Went home {formatTime(x.dischargedAt)}
                  </StatusPill>
                }
              />
            ))}
          </ul>
        </>
      )}
      <p className="hint desk-note">The doctor confirms the discharge card; that ends the stay and frees the bed. Reception settles the bill.</p>
    </Section>
  );
}

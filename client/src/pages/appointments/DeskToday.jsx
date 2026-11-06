import { CalendarOff, Check, DoorOpen, LogOut, Phone, PhoneCall, Plane, Stethoscope, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, formatTime } from '../../components/ui.jsx';
import { rupees } from '../billing/billingFormat.js';
import { Section } from '../worklist/WorklistSections.jsx';
import { dayLabel, timeLabel, whoLabel } from './appointmentFormat.js';
import { LIST_PAGES, Paged } from '../../components/DataTable.jsx';

// The front desk's day (owner, 14 Oct 2026), from GET /appointments/desk: which doctors are in today, and tomorrow's
// bookings to call and confirm.

/** A doctor's state today: colour + icon + word, and the hours or why there is no OPD. */
export function doctorToday(d) {
  if (d.leave) return { tone: 'watch', icon: Plane, word: 'On leave', line: `Until ${dayLabel(d.leave.to)}${d.leave.note ? ` · ${d.leave.note}` : ''}` };
  if (!d.hasTimings) return { tone: 'watch', icon: CalendarOff, word: 'No OPD timings', line: '', setUp: true };
  if (!d.sessions.length) return { tone: 'inactive', icon: CalendarOff, word: 'No OPD today', line: '' };
  return { tone: 'stable', icon: Stethoscope, word: 'In OPD', line: d.sessions.map((s) => `${timeLabel(s.from)}–${timeLabel(s.to)}`).join(', ') };
}

/**
 * Doctors today, short (6 Nov 2026 – a hospital of 24 doctors): those with patients today first, then those in OPD now,
 * then the rest, by name; the first `DOCTORS_SHOWN` (or all with patients, if more) are shown, the others behind
 * "Show all". Returns { shown, hidden }.
 */
export const DOCTORS_SHOWN = 5;
const busyCount = (d) => (d.expected ?? 0) + (d.waiting ?? 0) + (d.seen ?? 0);
export function doctorsForToday(doctors = [], showAll = false) {
  const rank = (d) => (busyCount(d) > 0 ? 0 : doctorToday(d).word === 'In OPD' ? 1 : 2);
  const sorted = [...doctors].sort((a, b) => rank(a) - rank(b) || busyCount(b) - busyCount(a) || a.name.localeCompare(b.name));
  const limit = showAll ? sorted.length : Math.max(DOCTORS_SHOWN, sorted.filter((d) => busyCount(d) > 0).length);
  return { shown: sorted.slice(0, limit), hidden: sorted.length - Math.min(limit, sorted.length) };
}

/** "Show all 24 doctors" / "Show fewer" under a short Doctors today. */
export function MoreDoctors({ hidden, total, showAll, onToggle }) {
  if (!hidden && !showAll) return null;
  return (
    <button type="button" className="btn btn-link btn-sm desk-doctors-more" aria-expanded={showAll} onClick={onToggle}>
      {showAll ? 'Show fewer' : `Show all ${total} doctors`}
    </button>
  );
}

/** "Doctors today": one row per doctor – state, hours, and how many are expected, waiting and seen. */
export function DoctorsToday({ doctors, linkNames = true }) {
  const [showAll, setShowAll] = useState(false);
  if (!doctors?.length) return null;
  const { shown, hidden } = doctorsForToday(doctors, showAll);
  return (
    <section className="card desk-doctors" aria-labelledby="desk-doctors-title">
      <h2 id="desk-doctors-title">
        <Stethoscope aria-hidden="true" /> Doctors today
      </h2>
      <ul>
        {shown.map((d) => {
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
      <MoreDoctors hidden={hidden} total={doctors.length} showAll={showAll} onToggle={() => setShowAll(!showAll)} />
    </section>
  );
}

/** "Tomorrow – call to confirm": tomorrow's bookings by time, with the phone to call. */
export function TomorrowCalls({ list, tomorrow }) {
  return (
    <Section id="td-tomorrow" icon={PhoneCall} title={`Tomorrow – call to confirm${tomorrow ? ` (${dayLabel(tomorrow)})` : ''}`} count={list.length} empty="Nobody is booked for tomorrow yet.">
      <Paged rows={list} label="patients" {...LIST_PAGES}>
        {(page) => (
          <ul className="wl-list desk-calls">
            {page.map((a) => {
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
        )}
      </Paged>
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
          <Paged rows={desk.goingHome} label="patients" {...LIST_PAGES}>
            {(page) => (
              <ul className="wl-list desk-calls">
                {page.map((x) => (
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
            )}
          </Paged>
        </>
      )}
      {desk.dischargedToday.length > 0 && (
        <>
          <h3 className="desk-subtitle">Discharged today</h3>
          <Paged rows={desk.dischargedToday} label="patients" {...LIST_PAGES}>
            {(page) => (
              <ul className="wl-list desk-calls">
                {page.map((x) => (
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
            )}
          </Paged>
        </>
      )}
      <p className="hint desk-note">The doctor confirms the discharge card; that ends the stay and frees the bed. Reception settles the bill.</p>
    </Section>
  );
}

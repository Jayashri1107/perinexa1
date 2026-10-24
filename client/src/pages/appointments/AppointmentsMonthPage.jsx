import { CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, CircleSlash, Clock, Plane, UserCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { appointmentTabs } from './AppointmentsPage.jsx';
import { STATUS_LOOK, TOKEN_LOOK, dayLabel, timeLabel, whenLabel, whoLabel } from './appointmentFormat.js';
import { dayCounts, monthLabel, monthOf, sessionLook, shiftMonth, weeksOf } from './monthFormat.js';

const WEEK_HEAD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Appointments → Month (owner, 13 Oct 2026 – the slot calendar): one doctor's month. Each day shows the doctor's OPD
// sessions with how many slots are still free (or Full), leave days, and how many were booked, seen and cancelled.
// Click a day: beside the calendar, that day's sessions and bookings, and the way to the day to book. The month
// itself has counts only – names appear only for the chosen day, as on the Day tab.
export function AppointmentsMonthPage() {
  const [params, setParams] = useSearchParams();
  const doctorsRes = useFetch('/appointments/doctors');
  const info = doctorsRes.data;
  const doctors = info?.doctors ?? [];
  const today = info?.today;
  const doctorId = params.get('doctor') || info?.me || doctors[0]?.id || null;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : monthOf(today);
  const chosen = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') && monthOf(params.get('date')) === month ? params.get('date') : month === monthOf(today) ? today : month ? `${month}-01` : null;
  const res = useFetch(doctorId && month ? '/appointments/month' : null, { doctorId, month });
  const day = useFetch(doctorId && chosen ? '/appointments/day' : null, { doctorId, date: chosen });
  const data = res.data?.month === month ? res.data : null;
  const go = (next) => setParams({ ...(doctorId ? { doctor: doctorId } : {}), ...(month ? { month } : {}), ...next }, { replace: true });
  const doctor = doctors.find((x) => x.id === doctorId);
  const chosenDay = data?.days.find((d) => d.date === chosen);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Appointments', to: '/appointments' }, { label: 'Month' }]} title="Appointments" tabs={appointmentTabs(info?.canBook)} />
      <div className="pf-content appt-month-page">
        {doctorsRes.error && <Alert type="error">{doctorsRes.error}</Alert>}
        {res.error && <Alert type="error">{res.error}</Alert>}
        {info && !doctors.length && <Alert type="warning">There are no doctors in this hospital yet.</Alert>}

        {doctors.length > 0 && (
          <div className="card appt-toolbar am-toolbar">
            <label className="appt-toolbar-field">
              <span className="field-label">Doctor</span>
              <select value={doctorId ?? ''} onChange={(e) => go({ doctor: e.target.value })}>
                {doctors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.hasTimings ? '' : ' (no OPD timings yet)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="appt-daynav" role="group" aria-label="Month">
              <button type="button" className="icon-btn" onClick={() => go({ month: shiftMonth(month, -1) })} aria-label="Previous month" disabled={!month}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <strong className="am-month">{month ? monthLabel(month) : ''}</strong>
              <button type="button" className="icon-btn" onClick={() => go({ month: shiftMonth(month, 1) })} aria-label="Next month" disabled={!month}>
                <ChevronRight aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => go({ month: monthOf(today), date: today })} disabled={month === monthOf(today)}>
                Today
              </button>
            </div>
            <ul className="am-legend" aria-label="What the colours mean">
              <li>
                <span className="am-chip is-free">
                  <Check aria-hidden="true" /> Free slots
                </span>
              </li>
              <li>
                <span className="am-chip is-full">
                  <CircleSlash aria-hidden="true" /> Full
                </span>
              </li>
              <li>
                <span className="am-chip is-leave">
                  <Plane aria-hidden="true" /> On leave
                </span>
              </li>
            </ul>
          </div>
        )}

        {data && !data.hasTimings && (
          <Alert type="warning">
            {data.doctor.name} has not set OPD timings yet, so there are no slots to show.{' '}
            {doctor?.canEditTimings && <Link to={`/appointments/timings?doctor=${data.doctor.id}`}>Set the OPD timings</Link>}
          </Alert>
        )}

        <div className="am-layout">
          <aside className="am-side" aria-label={chosen ? `Bookings on ${dayLabel(chosen)}` : 'The chosen day'}>
            <section className="card am-side-card">
              <h2>
                <CalendarDays aria-hidden="true" /> {chosen ? dayLabel(chosen) : 'Choose a day'}
              </h2>
              {chosenDay?.leave && (
                <StatusPill tone="watch" icon={Plane}>
                  On leave
                </StatusPill>
              )}
              {chosenDay && !chosenDay.leave && chosenDay.sessions.length === 0 && <p className="muted">No OPD on this day.</p>}
              {chosenDay?.sessions.length > 0 && (
                <ul className="am-side-sessions">
                  {chosenDay.sessions.map((s) => {
                    const look = sessionLook(s);
                    return (
                      <li key={s.from} className={`am-chip ${look.full ? 'is-full' : 'is-free'}`}>
                        <Clock aria-hidden="true" /> {timeLabel(s.from)} – {timeLabel(s.to)} · {look.text} ({s.taken}/{s.slots})
                      </li>
                    );
                  })}
                </ul>
              )}
              {chosen && (
                <Link to={`/appointments?doctor=${doctorId}&date=${chosen}`} className="btn btn-secondary btn-sm">
                  <CalendarCheck aria-hidden="true" /> Open this day to book
                </Link>
              )}
            </section>
            <section className="card am-side-card">
              <h2>Bookings</h2>
              {day.error && <Alert type="error">{day.error}</Alert>}
              {!day.data && !day.error && chosen && <p className="muted">Loading…</p>}
              {day.data && <DayBookings data={day.data} />}
            </section>
          </aside>

          <section className="card am-calendar" aria-label={month ? `${monthLabel(month)}, ${doctor?.name ?? ''}` : 'Month'}>
            {!data && !res.error && <p className="muted">Loading the month…</p>}
            {data && (
              <table className="am-grid">
                <thead>
                  <tr>
                    {WEEK_HEAD.map((w) => (
                      <th key={w} scope="col">
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeksOf(data.days).map((week, i) => (
                    <tr key={i}>
                      {week.map((d, j) => (d ? <DayCell key={d.date} d={d} today={data.today} chosen={d.date === chosen} onChoose={() => go({ date: d.date })} /> : <td key={`x${j}`} className="am-day is-outside" />))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DayCell({ d, today, chosen, onChoose }) {
  const counts = dayCounts(d.counts);
  return (
    <td className={`am-day${d.past ? ' is-past' : ''}${d.date === today ? ' is-today' : ''}${chosen ? ' is-chosen' : ''}`}>
      <button type="button" className="am-day-btn" onClick={onChoose} aria-pressed={chosen} aria-label={`${dayLabel(d.date)}${d.leave ? ', on leave' : ''}${counts ? `, ${counts}` : ''}`}>
        <span className="am-day-n">{Number(d.date.slice(8))}</span>
        {d.leave && (
          <span className="am-chip is-leave">
            <Plane aria-hidden="true" /> Leave
          </span>
        )}
        {d.sessions.map((s) => {
          const look = sessionLook(s);
          return (
            <span key={s.from} className={`am-chip ${look.full ? 'is-full' : 'is-free'}`}>
              {timeLabel(s.from)}–{timeLabel(s.to)} · {look.text}
            </span>
          );
        })}
        {counts && <span className="am-day-counts">{counts}</span>}
      </button>
    </td>
  );
}

/** The chosen day's bookings and walk-ins: time, who, status. */
function DayBookings({ data }) {
  const rows = [...data.slots.flatMap((s) => s.appointments), ...data.other, ...data.tokens];
  if (!rows.length) return <p className="muted">Nobody is booked on this day.</p>;
  return (
    <ul className="am-bookings">
      {rows.map((a) => {
        const look = a.kind === 'token' ? TOKEN_LOOK : (STATUS_LOOK[a.status] ?? STATUS_LOOK.booked);
        const Icon = look.icon ?? UserCheck;
        return (
          <li key={a.id}>
            <div>
              <strong>{whoLabel(a)}</strong>
              <span className="muted">
                {whenLabel(a)}
                {a.patient?.mrn ? ` · ${a.patient.mrn}` : ''}
              </span>
            </div>
            <StatusPill tone={look.tone} icon={Icon}>
              {look.label}
            </StatusPill>
          </li>
        );
      })}
    </ul>
  );
}

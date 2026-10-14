import { Link } from 'react-router-dom';
import { addDaysIso, weekdayLabel } from './calendarDates.js';
import { CalendarRow } from './DayView.jsx';

// "Coming up" beside the month (owner, 14 Oct 2026): the next 7 days after today, from the same calendar answers
// (GET /api/calendar, week view, this week and the next), so the doctor sees the month and the work ahead together.

const DAYS = 7;
const MAX_ROWS = 12;
const ORDER = { booked: 0, plan: 1, edd: 2, lmp: 3 };

/**
 * The days after `today` (up to 7) that have entries: [{ date, rows: [[event…] per patient] }], at most 12 rows in
 * all, and how many rows were left out. answers: the week answers (any order; the same entry is listed once).
 */
export function upcomingDays(answers, today) {
  if (!today) return { days: [], hidden: 0 };
  const last = addDaysIso(today, DAYS);
  const seen = new Set();
  const byDate = new Map();
  for (const a of answers) {
    for (const e of a?.events ?? []) {
      if (e.date <= today || e.date > last || seen.has(e.id)) continue;
      seen.add(e.id);
      const day = byDate.get(e.date) ?? new Map();
      day.set(e.patientId, [...(day.get(e.patientId) ?? []), e]);
      byDate.set(e.date, day);
    }
  }
  let left = MAX_ROWS;
  let hidden = 0;
  const days = [];
  for (const date of [...byDate.keys()].sort()) {
    const rows = [...byDate.get(date).values()].map((list) => list.sort((x, y) => (ORDER[x.type] ?? 9) - (ORDER[y.type] ?? 9)));
    const shown = rows.slice(0, Math.max(left, 0));
    hidden += rows.length - shown.length;
    left -= shown.length;
    if (shown.length) days.push({ date, rows: shown });
  }
  return { days, hidden };
}

/** answers: the week answers; loading: still loading; weekHref: the address of the week view. */
export function Upcoming({ answers, today, loading, patientsOf, showDoctor, weekHref }) {
  const { days, hidden } = upcomingDays(answers, today);
  return (
    <section className="card cal-panel cal-upcoming" aria-label="Coming up" aria-busy={loading || undefined}>
      <h3 className="cal-panel-title">Coming up – next 7 days</h3>
      {loading && !days.length ? (
        <p className="cal-note">Loading…</p>
      ) : !days.length ? (
        <p className="cal-note">Nothing in the next 7 days.</p>
      ) : (
        days.map((d) => (
          <div key={d.date} className="cal-upcoming-day">
            <h4>{weekdayLabel(d.date)}</h4>
            <ul className="wl-list">
              {d.rows.map((list) => (
                <CalendarRow key={list[0].patientId} events={list} patient={patientsOf(list[0].patientId)} patientId={list[0].patientId} showDoctor={showDoctor} />
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="cal-note">
        {hidden > 0 ? `${hidden} more – ` : ''}
        <Link to={weekHref}>Open the week</Link>
      </p>
    </section>
  );
}

import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { weekdayLabel } from './calendarDates.js';
import { weekSections } from './calendarFormat.js';
import { CalendarRow } from './DayView.jsx';
import { Section } from '../worklist/WorklistSections.jsx';

// The week view: one box per day with how many entries it has. Today's box is open; a click opens any other.
// Inside, one row per entry – only the patient's name, in bold, and what it is; a click shows the rest.

// A day's entries, one row per patient (a booked visit first, then her other entries that day)
const ORDER = { booked: 0, plan: 1, edd: 2, lmp: 3 };
function byPatient(events) {
  const map = new Map();
  for (const e of events) map.set(e.patientId, [...(map.get(e.patientId) ?? []), e]);
  return [...map.values()].map((list) => list.sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9)));
}

/** data: the server's week answer. dayHref(date): the address of that day's day view. */
export function WeekView({ data, level, dayHref }) {
  const sections = weekSections(data.events, data.days);
  const showDoctor = data.scope === 'all';
  return (
    <div className="td-sections cal-week">
      {sections.map((s) => {
        const isToday = s.date === data.today;
        const label = weekdayLabel(s.date);
        const count = new Set(s.events.map((e) => e.patientId)).size + (s.more ?? 0);
        return (
          <Section
            key={s.date}
            id={`cal-week-${s.date}`}
            icon={CalendarDays}
            title={label}
            badge={isToday ? <span className="cal-today-label">Today</span> : null}
            count={count}
            empty="Nothing on this day."
            remember={false}
            defaultOpen={isToday && count > 0}
          >
            <ul className="wl-list">
              {byPatient(s.events).map((list) => (
                <CalendarRow key={list[0].patientId} events={list} patient={data.patients?.[list[0].patientId] ?? null} patientId={list[0].patientId} showDoctor={showDoctor} />
              ))}
            </ul>
            <p className="cal-note">
              {s.more > 0 ? `Showing ${formatNumber(s.events.length)} of ${formatNumber(s.events.length + s.more)} entries – ` : ''}
              <Link to={dayHref(s.date)}>Open this day</Link>
            </p>
          </Section>
        );
      })}
    </div>
  );
}

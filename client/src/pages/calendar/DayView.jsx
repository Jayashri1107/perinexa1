import { useId, useState } from 'react';
import { ChevronDown, UserCheck, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { Avatar, StatusPill, formatTime } from '../../components/ui.jsx';
import { EVENT_LOOK, EVENT_TYPES, dayCounts, dayRows, emptyDayText, eventLines, mergedPlanLine, planStatusLook, sectionTitle, withBookedText } from './calendarFormat.js';
import { EventMark } from './EventMark.jsx';
import { Section } from '../worklist/WorklistSections.jsx';

// The day view: one white card per kind of entry (Booked visits, Plan visits, EDD, LMP), rows keyed by patient.
// A booking stays on its day marked "Arrived · time" once her visit is started that day.

const clinical = (patient) => patient?.level === 'clinical';

/** Initials, the name (opens the record) and the patient number. */
export function PatientCell({ patient, patientId }) {
  return (
    <span className="name-cell">
      <Avatar name={patient?.fullName ?? ''} seed={patientId} />
      <span className="name-cell-text">
        <Link to={`/patients/${patientId}`}>{patient?.fullName ?? 'Patient'}</Link>
        {patient?.mrn && <span className="cell-sub">{patient.mrn}</span>}
      </span>
    </span>
  );
}

/** The mark and the details of the entries in one row (a booked row may carry the day's care-plan visit too). */
export function EventDetails({ events, patient, withMark = true }) {
  const [first, ...rest] = events;
  const level = patient?.level ?? 'reception';
  // Without the mark (month panel), a reception booked row has nothing more to say: no empty block.
  if (!withMark && !rest.length && !eventLines(first, patient).length) return null;
  if (first.type === 'booked') {
    return (
      <div className="cal-details">
        {withMark && <EventMark type="booked" level={level} event={first} />}
        <Lines lines={eventLines(first, patient)} />
        {rest.map((e) => (
          <span key={e.id} className="cal-line">
            {mergedPlanLine(e, patient)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="cal-details">
      {withMark && <EventMark type={first.type} level={level} event={first} />}
      {events.map((e) => (
        <Lines key={e.id} lines={eventLines(e, patient)} />
      ))}
    </div>
  );
}

function Lines({ lines }) {
  if (!lines.length) return null;
  const [head, ...tail] = lines;
  return (
    <span className="cal-line">
      {head}
      {tail.length > 0 && <span className="cell-sub">{tail.join(' · ')}</span>}
    </span>
  );
}

/** The status: a care-plan visit's pill (clinical), "Arrived · 10:20", or "No visit recorded" for a past booking. */
export function EventStatus({ events, patient }) {
  const pills = [];
  for (const e of events) {
    if (e.type === 'booked' && e.state === 'arrived') {
      pills.push(
        <StatusPill key={e.id} tone="stable" icon={UserCheck}>
          Arrived · {formatTime(e.arrivedAt)}
        </StatusPill>,
      );
    } else if (e.type === 'booked' && e.state === 'no_visit') {
      pills.push(
        <StatusPill key={e.id} tone="inactive" icon={UserX}>
          No visit recorded
        </StatusPill>,
      );
    } else if (e.type === 'plan' && clinical(patient) && events[0].type !== 'booked') {
      const look = planStatusLook(e);
      pills.push(
        <StatusPill key={e.id} tone={look.tone} icon={look.icon}>
          {look.word}
        </StatusPill>,
      );
    }
  }
  return pills.length ? <span className="cal-pills">{pills}</span> : null;
}

/** Clinical rows: "Care plan" (a care-plan visit) and "Visit" (the visit where the booking was made). */
export function EventLinks({ events, patient, patientId }) {
  if (!clinical(patient)) return null;
  const plan = events.some((e) => e.type === 'plan');
  const booked = events.find((e) => e.type === 'booked' && e.visitId);
  if (!plan && !booked) return null;
  return (
    <span className="row-actions">
      {plan && (
        <Link className="btn btn-link btn-sm" to={`/patients/${patientId}/care-plan`}>
          Care plan
        </Link>
      )}
      {booked && (
        <Link className="btn btn-link btn-sm" to={`/patients/${patientId}/visits/${booked.visitId}`}>
          Visit
        </Link>
      )}
    </span>
  );
}

/**
 * One patient's entry: only her name, in bold, and what the entry is ("Booked visit"); a click shows the rest –
 * patient number, phone, doctor, the details, the status and the links – and "Open the record".
 */
export function CalendarRow({ events, patient, patientId, showDoctor = false }) {
  const [open, setOpen] = useState(false);
  const bodyId = `cal-row-${patientId}-${events.map((e) => e.id).join('-')}`.replace(/[^\w-]/g, '');
  const level = patient?.level ?? 'reception';
  const types = [...new Set(events.map((e) => e.type))];
  const arrived = events.some((e) => e.type === 'booked' && e.state === 'arrived');
  const facts = [patient?.mrn, patient?.phone, showDoctor ? (patient?.doctorName ?? 'No doctor assigned') : null].filter(Boolean).join(' · ');
  return (
    <li className={`wl-row${open ? ' is-open' : ''}`}>
      <button type="button" className="wl-row-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="wl-row-name">{patient?.fullName ?? 'Patient'}</span>
        {types.map((t) => (
          <EventMark key={t} type={t} level={level} event={events.find((e) => e.type === t)} />
        ))}
        {arrived && (
          <StatusPill tone="stable" icon={UserCheck}>
            Arrived
          </StatusPill>
        )}
        <ChevronDown aria-hidden="true" className="wl-row-chevron" />
      </button>
      <div id={bodyId} className="wl-row-body" hidden={!open}>
        {open && (
          <>
            {facts && <p className="wl-row-facts muted tabular">{facts}</p>}
            <EventDetails events={events} patient={patient} withMark={false} />
            <EventStatus events={events} patient={patient} />
            <span className="cal-row-links">
              <EventLinks events={events} patient={patient} patientId={patientId} />
              <Link to={`/patients/${patientId}`} className="btn btn-link btn-sm wl-row-open">
                Open the record →
              </Link>
            </span>
          </>
        )}
      </div>
    </li>
  );
}

/** A list of entries, one row per patient. */
function RowList({ rows, showDoctor }) {
  return (
    <ul className="wl-list">
      {rows.map((r) => (
        <CalendarRow key={r.patientId} events={r.events} patient={r.patient} patientId={r.patientId} showDoctor={showDoctor} />
      ))}
    </ul>
  );
}

/** A day's entries. data: the server's day answer. compact: the month view's side panel. */
export function DayView({ data, loading, level, compact = false, onShowAll }) {
  const uid = useId();
  const date = data.date;
  const types = data.types;
  const rows = dayRows(data.events, data.patients, date);
  const showDoctor = data.scope === 'all';
  // The same numbers as the month cell (the server's count of the day), so the grid and this list agree.
  const counts = dayCounts(data.days?.[0], rows);
  const total = counts.booked + counts.plan + counts.edd + counts.lmp;
  const more = data.days?.[0]?.more ?? 0;
  const isToday = date === data.today;

  if (!total) {
    return (
      <EmptyCard compact={compact} scope={data.scope} onShowAll={onShowAll}>
        {emptyDayText(types, level)}
      </EmptyCard>
    );
  }

  const planBody = () => (
    <>
      {level === 'clinical' && counts.opens > 0 && <h4 className="cal-subtitle">Window opens this day ({formatNumber(counts.opens)})</h4>}
      {rows.planOpens.length > 0 && <RowList rows={rows.planOpens} showDoctor={showDoctor} />}
      {level === 'clinical' && counts.attended > 0 && <h4 className="cal-subtitle">Attended this day ({formatNumber(counts.attended)})</h4>}
      {rows.attended.length > 0 && <RowList rows={rows.attended} showDoctor={showDoctor} />}
      {counts.withBooked > 0 && <p className="cal-note">{withBookedText(counts.withBooked)}</p>}
    </>
  );

  // The month view's side panel: plain headings and the rows (the grid beside it is the overview)
  if (compact) {
    return (
      <div className="cal-day cal-day-compact">
        {EVENT_TYPES.filter((t) => types.includes(t) && counts[t]).map((t) => (
          <section key={t} className="cal-day-section cal-day-section-compact" aria-labelledby={`${uid}-${t}`}>
            <h3 className="cal-section-title" id={`${uid}-${t}`}>
              <EventMark type={t} level={level} compact decorative />
              {sectionTitle(t, level)} ({formatNumber(counts[t])})
            </h3>
            {t === 'plan' ? planBody() : <RowList rows={rows[t]} showDoctor={showDoctor} />}
          </section>
        ))}
      </div>
    );
  }

  // The day: one box per kind of entry, opened with a click (the browser remembers which were left open)
  return (
    <div className="cal-day">
      {more > 0 && (
        <p className="cal-note">
          Showing {formatNumber(data.events.length)} of {formatNumber(data.events.length + more)} entries on this day.
        </p>
      )}
      {isToday && level === 'clinical' && types.includes('plan') && (
        <p className="cal-note">Visits already due or overdue from earlier days are shown on each patient&apos;s Care plan tab.</p>
      )}
      <div className="td-sections">
        {EVENT_TYPES.filter((t) => types.includes(t)).map((t) => (
          <Section key={t} id={`cal-day-${t}`} icon={EVENT_LOOK[t].icon} title={sectionTitle(t, level)} count={counts[t]} empty="None on this day.">
            {t === 'plan' ? planBody() : <RowList rows={rows[t]} showDoctor={showDoctor} />}
          </Section>
        ))}
      </div>
    </div>
  );
}

/** "Nothing …" with, on My patients, "Showing your patients only. Show all patients". */
export function EmptyCard({ children, compact, scope, onShowAll }) {
  return (
    <section className={compact ? 'cal-empty cal-empty-compact' : 'card cal-empty'}>
      <p className="muted">{children}</p>
      {scope === 'mine' && onShowAll && (
        <p className="muted">
          Showing your patients only.{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={onShowAll}>
            Show all patients
          </button>
        </p>
      )}
    </section>
  );
}

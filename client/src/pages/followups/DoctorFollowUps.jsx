import { CalendarClock, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PURPOSE_LABELS, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';

// The doctor's follow-ups on her Today (owner, 26 Oct 2026): her patients asked to come back – those booked, by day and
// time, then those not booked yet – with what for. From GET /api/added-follow-ups?mine=1. Names and purposes only.

export function DoctorFollowUps() {
  const res = useFetch('/added-follow-ups', { mine: '1' });
  const rows = res.data?.followUps ?? [];
  const today = res.data?.today ?? '';
  const booked = rows.filter((f) => f.booked).sort((a, b) => `${a.booked.date} ${a.booked.start ?? ''}`.localeCompare(`${b.booked.date} ${b.booked.start ?? ''}`));
  const waiting = rows.filter((f) => !f.booked);
  if (res.data && !rows.length) return null;
  return (
    <section className="card fu-doctor" aria-labelledby="fu-doctor-title">
      <h2 id="fu-doctor-title" className="fu-title">
        <ClipboardList aria-hidden="true" /> Your follow-ups <span className="muted tabular">({rows.length})</span>
      </h2>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {booked.length > 0 && (
        <ul className="fu-doctor-list" aria-label="Booked">
          {booked.map((f) => (
            <li key={f.id}>
              <span className="fu-doctor-when tabular">
                {f.booked.date === today ? 'Today' : dayLabel(f.booked.date)}
                {f.booked.start ? ` · ${timeLabel(f.booked.start)}` : ''}
              </span>
              <span>
                <Link to={`/patients/${f.patient.id}`}>{f.patient.fullName}</Link> <span className="muted tabular">{f.patient.mrn}</span>
              </span>
              <StatusPill tone="due" icon={CalendarClock}>
                {PURPOSE_LABELS[f.purpose]}
              </StatusPill>
              {f.note ? <span className="muted">{f.note}</span> : <span />}
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="hint">
          Not booked yet: {waiting.map((f) => f.patient.fullName).join(', ')}. Reception calls them.
        </p>
      )}
    </section>
  );
}

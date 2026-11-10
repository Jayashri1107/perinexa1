import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, StatusPill, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { MOMENTS, canSeeTimeline, clockTime, durationWords, timelineParts } from './visitTimelineFormat.js';

// Time in hospital (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md section 5): the moments of this
// visit's day and the minutes of each stage, for her doctor only. Loaded when opened – each look is in the audit log.
// Times and stage names only, never who. A stage that took longer than 9 of 10 visits of the last three months in this
// hospital carries the "Longer than usual" mark (colour + icon + words, docs/BRAND.md).

export function VisitTimeline({ patient, visitId, version }) {
  const { activeMembership, isPlatform } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed = canSeeTimeline({ isDoctor: hasRole(activeMembership, 'doctor'), isPlatform: isPlatform || Boolean(activeMembership?.platform) });
  const { data, error, loading } = useFetch(allowed && open ? `/patients/${patient.id}/visits/${visitId}/timeline` : null, { v: version });
  if (!allowed) return null;
  const parts = data ? timelineParts(data) : null;
  return (
    <details className="card vs-history vs-timeline" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Clock aria-hidden="true" /> Time in hospital
      </summary>
      <Alert type="error">{error}</Alert>
      {loading && !data && <p className="hint">Loading…</p>}
      {parts && parts.moments.length === 0 && <p className="hint">No times were noted for this visit. Times are noted from 10 Nov 2026 on.</p>}
      {parts && parts.moments.length > 0 && (
        <>
          <p className="vs-timeline-line tabular">
            {parts.moments.map((m, i) => (
              <span key={m.key}>
                {i > 0 && ' · '}
                {MOMENTS[m.key]} {clockTime(m.at)}
              </span>
            ))}
            {parts.total != null && <strong> · {durationWords(parts.total)} in all</strong>}
          </p>
          {parts.stages.length > 0 && (
            <table className="dt vs-timeline-table">
              <caption className="sr-only">Minutes of each stage of this visit</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col" className="num">
                    Time
                  </th>
                  <th scope="col">Compared with this hospital</th>
                </tr>
              </thead>
              <tbody>
                {parts.stages.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    <td className="num tabular">{durationWords(s.minutes)}</td>
                    <td>
                      {s.longer ? (
                        <StatusPill tone="watch">Longer than usual</StatusPill>
                      ) : s.usualLimit == null ? (
                        <span className="muted">Not enough visits yet</span>
                      ) : (
                        <span className="muted">Within the usual time</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {data && <p className="hint help">Noted by the computer from what staff did – no names. Only her doctor sees this; each look is recorded.</p>}
    </details>
  );
}

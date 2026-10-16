import { History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// "Continue Mrs ___'s visit" at the top of Today (doctor ideas #4, 16 Oct 2026): visits the signed-in person typed on
// and did not save (their own drafts, newest first). Nothing shows when there are none.

const PART_WORDS = { details: 'visit details', rx: 'prescription' };

export function ContinueVisits({ enabled }) {
  const res = useFetch(enabled ? '/visit-drafts' : null);
  const list = res.data?.drafts ?? [];
  if (!list.length) return null;
  return (
    <Alert type="info" icon={History}>
      <strong>Not saved yet:</strong>
      <ul className="cv-list">
        {list.map((d) => (
          <li key={d.visitId}>
            <Link to={`/patients/${d.patient.id}/visits/${d.visitId}${d.parts.length === 1 && d.parts[0] === 'rx' ? '?tab=prescription' : ''}`}>
              Continue {d.patient.fullName}'s visit
            </Link>{' '}
            <span className="muted">
              {d.patient.mrn} · visit of {formatDate(d.visitOn)} · {d.parts.map((p) => PART_WORDS[p]).join(' and ')} · last typed {formatDateTime(d.savedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

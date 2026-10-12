// Where and when the values of a red flag were recorded, in words and as links. A flag always says this: a value
// from a visit, from a lab result or – for a patient in hospital – from the nursing chart of the stay.
// (The server has the same words for the AI's text: server/src/redflags/redFlags.js sourceText.)
import { formatDate, formatDateTime } from '../../components/ui.jsx';

/** "the visit on 3 Oct 2026", "the lab result of 3 Oct 2026", "the nursing chart, 3 Oct 2026, 14:30", "her record, 3 Oct 2026". */
export function sourceText(s) {
  if (s?.source === 'visit') return `the visit on ${formatDate(s.on)}`;
  if (s?.source === 'lab') return `the lab result of ${formatDate(s.on)}`;
  if (s?.source === 'chart') return `the nursing chart, ${formatDateTime(s.at)}`;
  if (s?.source === 'record') return `her record, ${formatDate(s.on)}`; // a finding of a pregnancy loss (Overview → Pregnancy loss)
  return '';
}

/** The page that shows the value – the visit, the lab result, the stay or her record (null: none). */
export function sourceLink(patientId, s) {
  if (!patientId || !s) return null;
  if (s.source === 'visit' && s.visitId) return `/patients/${patientId}/visits/${s.visitId}`;
  if (s.source === 'lab' && s.orderId) return `/patients/${patientId}/lab/${s.orderId}`;
  if (s.source === 'chart' && s.admissionId) return `/patients/${patientId}/stays/${s.admissionId}`;
  if (s.source === 'record') return `/patients/${patientId}`;
  return null;
}

/** "from the visit on 3 Oct 2026 and the lab result of 1 Oct 2026" ('' for a flag worked out from today's date only). */
export function flagFromText(flag) {
  const parts = (flag?.sources ?? []).map(sourceText).filter(Boolean);
  return parts.length ? `from ${parts.join(' and ')}` : '';
}

const OPEN_WORDS = { visit: 'Open the visit', lab: 'Open the lab result', chart: 'Open the stay', record: 'Open the record' };
/**
 * Where a patient's row in a list of flags leads: to where the first (most urgent) flag's value was recorded –
 * the visit, the lab result or the stay – otherwise to her record. { to, label }
 */
export function flagRowTarget(patientId, flags) {
  for (const f of flags ?? []) {
    for (const s of f.sources ?? []) {
      const to = sourceLink(patientId, s);
      if (to) return { to, label: OPEN_WORDS[s.source] };
    }
  }
  return { to: `/patients/${patientId}`, label: 'Open the record' };
}

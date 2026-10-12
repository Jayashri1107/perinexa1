// Her records from other hospitals (ABDM milestone M3) in words: the request's status and each hospital's, what came,
// what was withheld or left out and why, and the "Ask" form's starting values. PURE – the server decides everything
// (server/src/abdm/fetchRecords.js, fhirReader.js); this only says it. A status is always colour, icon and word.
import { Ban, CircleCheck, CircleX, Clock, Hourglass, Smartphone, Trash2, TriangleAlert } from 'lucide-react';

/** ABDM's kinds of record a hospital can ask for (the server's FETCH_TYPE_WORDS). */
export const FETCH_TYPE_WORDS = {
  OPConsultation: 'Consultation',
  Prescription: 'Prescription',
  DiagnosticReport: 'Lab or scan report',
  DischargeSummary: 'Discharge summary',
  ImmunizationRecord: 'Vaccination record',
  HealthDocumentRecord: 'Other health document',
  WellnessRecord: 'Wellness record',
};
export const FETCH_HI_TYPES = Object.keys(FETCH_TYPE_WORDS);
export const fetchTypesLine = (types = []) => types.map((t) => FETCH_TYPE_WORDS[t] ?? t).join(', ');

/** How long the consent (and the records kept here) lasts: the choices the server accepts. */
export const DAY_CHOICES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months (90 days)' },
  { days: 180, label: '6 months (180 days)' },
  { days: 365, label: '1 year (365 days)' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Oct 2026" – the day of a moment on this computer's clock (as the other times on the screens). */
export const dayOf = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The "Ask" form to start with: the last 12 months, every kind of record, a consent of 30 days. */
export function fetchDefaults(today = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  return { from: iso(from), to: iso(today), hiTypes: [...FETCH_HI_TYPES], days: 30 };
}

/** Until when the records of a request may be kept (the earliest end of its hospitals' consents). */
export const keptUntil = (r) => [...(r.hospitals ?? []).map((h) => h.expiresAt), r.expiresAt].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] ?? null;

/** A request's status: { tone, icon, label, hint }. */
export function requestStatus(r) {
  switch (r.status) {
    case 'requested':
      return { tone: 'due', icon: Hourglass, label: 'Sent to ABDM', hint: 'Waiting for ABDM to pass it to her ABHA app.' };
    case 'waiting':
      return { tone: 'due', icon: Smartphone, label: 'Waiting for her answer', hint: 'She agrees or refuses in her ABHA app. Nothing comes until she agrees.' };
    case 'granted': {
      const n = r.hospitals?.length ?? 0;
      return { tone: 'stable', icon: CircleCheck, label: 'She agreed', hint: n ? `${plural(n, 'hospital')} answered. Records kept until ${dayOf(keptUntil(r))}, then deleted.` : 'No hospital has records for her of these kinds and dates.' };
    }
    case 'denied':
      return { tone: 'inactive', icon: CircleX, label: 'She refused', hint: 'Nothing was received.' };
    case 'revoked':
      return { tone: 'inactive', icon: Ban, label: 'She withdrew her consent', hint: 'Every record received with it was deleted.' };
    case 'expired':
      if (r.hospitals?.length) return { tone: 'inactive', icon: Clock, label: 'Consent ended', hint: 'Every record received with it was deleted.' };
      // She agreed, but no hospital had records: the request ended without anything to receive
      if (r.agreed) return { tone: 'inactive', icon: Clock, label: 'Ended – nothing came', hint: 'She agreed, but no hospital had records for her of these kinds and dates. The request has ended.' };
      return { tone: 'inactive', icon: Clock, label: 'No answer', hint: 'She did not answer in time. Nothing was received.' };
    case 'failed':
      return { tone: 'high', icon: TriangleAlert, label: 'ABDM refused the request', hint: r.error ? `ABDM said: ${r.error}` : 'Ask again.' };
    default:
      return { tone: 'inactive', icon: Clock, label: r.status, hint: '' };
  }
}

const DELETED_WORDS = { expired: 'her consent ended', revoked: 'she withdrew her consent' };

/** One hospital's answer: { tone, icon, label, hint }. */
export function hospitalStatus(h) {
  switch (h.step) {
    case 'details':
      return { tone: 'due', icon: Hourglass, label: 'Waiting for the consent', hint: 'ABDM has not sent the details of her consent yet.' };
    case 'asked':
      return { tone: 'due', icon: Hourglass, label: 'Waiting for the records', hint: 'The hospital has not sent them yet.' };
    case 'received': {
      const parts = [
        h.files ? `${plural(h.files, 'file')} to download` : '',
        h.filesLeftOut ? `${plural(h.filesLeftOut, 'file')} not offered` : '',
        h.withheld ? `${plural(h.withheld, 'sentence')} withheld (PC-PNDT)` : '',
        h.failed ? `${h.failed} could not be read` : '',
      ].filter(Boolean);
      return { tone: 'stable', icon: CircleCheck, label: `${plural(h.documents, 'document')} received`, hint: parts.length ? `${parts.join(', ')}.` : '' };
    }
    case 'failed':
      return { tone: 'high', icon: TriangleAlert, label: 'Not received', hint: h.error ?? 'The records could not be received.' };
    case 'deleted':
      return { tone: 'inactive', icon: Trash2, label: 'Deleted', hint: `Deleted ${dayOf(h.deletedAt)}${DELETED_WORDS[h.deletedWhy] ? ` – ${DELETED_WORDS[h.deletedWhy]}` : ''}.` };
    default:
      return { tone: 'inactive', icon: Clock, label: h.step, hint: '' };
  }
}

/** "Consultation, Lab or scan report · records of 5 Oct 2025 to 5 Oct 2026 · consent for 30 days" */
export const requestLine = (r) => [fetchTypesLine(r.hiTypes), `records of ${dayOf(r.from)} to ${dayOf(r.to)}`, `consent for ${plural(r.days, 'day')}`].filter(Boolean).join(' · ');

/** A document's own date, or that it gives none (never the day it was sent or received). */
export const documentDate = (d) => dayOf(d.date) || 'Date not given';

/** What the other hospital says of the whole document (Composition.status): an alert's type and words, or null. */
export function documentStatusNote(status) {
  if (status === 'entered-in-error') return { type: 'error', text: 'The other hospital marked this whole document as entered in error: it is not valid. Do not act on it.' };
  if (status === 'preliminary') return { type: 'warning', text: 'The other hospital marked this document as preliminary: it may still change.' };
  if (status === 'amended') return { type: 'info', text: 'The other hospital changed this document after it was first written.' };
  return null;
}

/** Made-up documents of practice mode: said in the list and on the document, so they are never taken as hers. */
export const PRACTICE_LABEL = 'Practice – made up';
export const PRACTICE_NOTE = "Practice – made up by Perinexa's practice mode, not her records. Do not act on it.";

/** The kind of a document received, in words. */
export const documentType = (d) => FETCH_TYPE_WORDS[d.hiType] ?? (d.typeText || 'Health record');

/** What is said where a sentence was withheld (PC-PNDT). */
export const withheldNote = (n) => `${n === 1 ? 'A sentence was' : `${n} sentences were`} withheld here: ${n === 1 ? 'it' : 'they'} may mention a baby's sex (PC-PNDT Act).`;
export const withheldSummary = (n) => `${plural(n, 'sentence')} withheld: ${n === 1 ? 'it' : 'they'} may mention a baby's sex (PC-PNDT Act). Perinexa never keeps or shows a baby's sex before birth – the check is a word list, so a sentence may be withheld that did not.`;

/** Why an attached file is not offered. */
export const LEFT_OUT_WORDS = {
  type: 'not a PDF, JPEG or PNG file – not offered, for safety',
  size: 'larger than 10 MB – not offered',
  link: 'a link to another website – never opened',
  empty: 'empty',
  too_many: 'more than 20 files in one document – not offered',
};
export const leftOutLine = (f) => `${f.title || 'Attached file'}: ${LEFT_OUT_WORDS[f.why] ?? 'not offered'}`;

const TYPE_SHORT = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG photo', 'image/png': 'PNG picture' };
/** "PDF, 12 KB" */
export function fileLine(f) {
  const n = Number(f.size) || 0;
  const size = n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${TYPE_SHORT[f.contentType] ?? 'File'}, ${size}`;
}

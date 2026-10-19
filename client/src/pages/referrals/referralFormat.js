import { AlarmClock, Ban, CalendarClock, Check, CircleCheck, CircleDashed, Clock, FileOutput, FilePen, Hourglass, Minus, Send, TriangleAlert, X } from 'lucide-react';

// Referrals from other doctors (docs/REFERRALS_PLAN.md): words, looks and small calculations shared by the screens.
// Every status is colour + icon + word (brand rule 4); the words follow the hospital's Clinical Partner Guide.

/** A promise's clock (server referrals/clocks.js): its state as a pill. */
export const PROMISE_LOOK = {
  not_started: { tone: 'neutral', icon: CircleDashed, word: 'Not started yet' },
  waiting: { tone: 'due', icon: Clock, word: 'Waiting' },
  soon: { tone: 'watch', icon: AlarmClock, word: 'Due soon' },
  late: { tone: 'high', icon: TriangleAlert, word: 'Late' },
  met: { tone: 'stable', icon: Check, word: 'Done' },
  // Done, but after its time: still a miss for the weekly review
  met_late: { tone: 'watch', icon: CircleCheck, word: 'Done late' },
  not_needed: { tone: 'inactive', icon: Minus, word: 'Not needed' },
  // She said No to sharing: the note or the discharge summary is not sent, and that is never a miss
  no_consent: { tone: 'inactive', icon: Ban, word: 'Not sent – she did not agree' },
};
for (const look of Object.values(PROMISE_LOOK)) look.label = look.word; // the same word under both names
export const promiseLook = (p) => PROMISE_LOOK[p?.state] ?? PROMISE_LOOK.not_started;

/** The guide's promises, when the server sends no label. */
export const PROMISE_LABELS = {
  reply: 'Reply within 2 working hours',
  seen: 'Seen in time',
  note: 'Consultant note within 24 hours',
  discharge: 'Discharge summary within 24 hours',
};
export const promiseLabel = (p) => p?.label || PROMISE_LABELS[p?.key] || p?.key || '';
/** States the weekly review asks about: a promise not kept on time. */
export const MISSED_STATES = ['late', 'met_late'];

export const STATUS_LOOK = {
  open: { tone: 'due', icon: Clock, word: 'Open' },
  closed: { tone: 'inactive', icon: Check, word: 'Closed' },
  cancelled: { tone: 'inactive', icon: X, word: 'Cancelled' },
};
export const statusLook = (r) => STATUS_LOOK[r?.status] ?? STATUS_LOOK.open;

export const URGENCY_LOOK = {
  urgent: { tone: 'high', icon: AlarmClock, word: 'Urgent' },
  routine: { tone: 'neutral', icon: CalendarClock, word: 'Routine' },
};
export const urgencyLook = (r) => URGENCY_LOOK[r?.urgency] ?? URGENCY_LOOK.routine;
export const URGENCY_OPTIONS = [
  { value: 'urgent', label: 'Urgent – seen the same day' },
  { value: 'routine', label: 'Routine – seen within 48 hours' },
];

/** Her agreement to send the consultant note and the discharge summary to her doctor. */
export const SHARING_LOOK = {
  yes: { tone: 'stable', icon: Check, word: 'She agreed' },
  no: { tone: 'inactive', icon: Ban, word: 'She did not agree' },
  none: { tone: 'watch', icon: Hourglass, word: 'Not asked yet' },
};
export const sharingLook = (sharing) => SHARING_LOOK[sharing?.answer] ?? SHARING_LOOK.none;

/** What is waiting on a referral (listView.waiting) – neutral tags with an icon, the clocks carry the urgency. */
export const WAITING_LOOK = [
  { key: 'reply', icon: Send, word: 'Reply to send' },
  { key: 'note', icon: FilePen, word: 'Note to write' },
  { key: 'release', icon: FileOutput, word: 'PDF to release' },
  { key: 'send', icon: Send, word: 'PDF to send' },
];

export const VIA_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Phone call' },
  { value: 'walk_in', label: 'She walked in with a letter or slip' },
  { value: 'letter', label: 'Letter' },
];
export const VIA_LABELS = { whatsapp: 'WhatsApp', call: 'Phone call', walk_in: 'Walked in', letter: 'Letter' };

/** The groups of the guide's reasons (server referrals/reasons.js), in the guide's order. */
export const REASON_GROUPS = [
  { key: 'urgent', label: 'Urgent – seen the same day' },
  { key: 'within48', label: 'Within 48 hours' },
  { key: 'routine', label: 'Routine' },
  { key: 'gynae', label: 'Gynaecology' },
];

/** What the referring doctor sent with her (the guide's list), each a short line of text. */
export const SENT_FIELDS = [
  { key: 'lmpEdd', label: 'LMP or EDD' },
  { key: 'gravidaPara', label: 'Gravida and para' },
  { key: 'bp', label: 'BP today' },
  { key: 'hb', label: 'Latest Hb' },
  { key: 'sugar', label: 'Latest blood sugar' },
  { key: 'medicines', label: 'Current medicines' },
  { key: 'scans', label: 'Scan reports' },
];
export const emptySent = () => Object.fromEntries(SENT_FIELDS.map((f) => [f.key, '']));

/**
 * The consultant note in the guide's own layout (page 7). "Next at …" names this hospital (the guide's "Next at
 * Anandi"), so it reads right for any hospital.
 */
export const noteFields = (hospitalName) => [
  // max: the server's limits (server/src/models/Referral.js NOTE_FIELDS)
  { key: 'questionRestated', label: 'Your question', rows: 2, max: 300 },
  { key: 'findings', label: 'Findings', rows: 4, required: true, max: 3000 },
  { key: 'diagnosis', label: 'Diagnosis', rows: 2, required: true, max: 1000 },
  { key: 'plan', label: 'Plan', rows: 4, required: true, max: 3000 },
  { key: 'needFromYou', label: 'We need from you', rows: 2, max: 1000 },
  { key: 'returnsToYouFor', label: 'Returns to you for', rows: 2, required: true, max: 500 },
  { key: 'nextAtAnandi', label: `Next at ${hospitalName || 'our hospital'}`, rows: 2, max: 300 },
];
export const NOTE_KEYS = noteFields('').map((f) => f.key);
export const emptyNote = () => Object.fromEntries(NOTE_KEYS.map((k) => [k, '']));

export const MESSAGE_LABELS = { reply: 'Reply (appointment and consultant)', note: 'Consultant note', discharge: 'Discharge summary', other: 'Other message' };
export const RELEASE_LABELS = { note: 'Consultant note', discharge: 'Discharge summary' };
/** The PDF's file name: the referral number only, never her name (it stays in the Downloads folder). */
export const releaseFileName = (number, kind) => `${number}-${kind === 'note' ? 'consultant-note' : 'discharge-summary'}.pdf`;

/** Who the referral is for: her name on her record, or the name given before she was registered. */
export const whoName = (r) => r?.patient?.fullName ?? r?.guest?.name ?? '—';
/** "P-000012 · 28 yrs", or "Not registered yet · 28 yrs". */
export function whoFacts(r) {
  const age = r?.patient?.ageYears ?? r?.guest?.ageYears;
  return [r?.patient ? r.patient.mrn : 'Not registered yet', age != null ? `${age} yrs` : null].filter(Boolean).join(' · ');
}

/** "2 h 15 min left", "40 min late", "3 days left" – from the due time and now. */
export function timeLeftWords(due, now = new Date()) {
  if (!due) return '';
  const minutes = Math.round((new Date(due).getTime() - now.getTime()) / 60000);
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const span = hours >= 48 ? `${Math.round(hours / 24)} days` : hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
  return minutes >= 0 ? `${span} left` : `${span} late`;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** Today in this computer's time (the hospital's day): "2026-10-15". */
export const localIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** "YYYY-MM-DD" n days later. */
export const isoAddDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Monday of the week a day falls in (weeks run Monday to Sunday). */
export function mondayOf(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return isoAddDays(iso, -((day + 6) % 7));
}
export const shiftWeek = (monday, n) => isoAddDays(monday, 7 * n);

/** "2026-Q4" for a day. */
export function quarterOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
export function shiftQuarter(key, n) {
  const [, y, q] = /^(\d{4})-Q([1-4])$/.exec(key) ?? [];
  const index = Number(y) * 4 + Number(q) - 1 + n;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}
const QUARTER_MONTHS = ['January to March', 'April to June', 'July to September', 'October to December'];
/** "October to December 2026". */
export function quarterWords(key) {
  const [, y, q] = /^(\d{4})-Q([1-4])$/.exec(key ?? '') ?? [];
  return y ? `${QUARTER_MONTHS[Number(q) - 1]} ${y}` : '';
}

/** Every text field of a form (for the check on words about the baby's sex before anything is sent). */
export const textsOf = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(textsOf) : []);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "15 Oct 2026" for a moment (a visit, a referral), in this computer's time – not a date stored as midnight UTC. */
export function formatLocalDay(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}
/** "Mon 12 Oct" for a "YYYY-MM-DD" day. */
export function shortDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

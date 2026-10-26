import { CalendarCheck, CalendarX2, Clock, Hash, UserCheck, UserX } from 'lucide-react';

// Appointment booking (docs/APPOINTMENTS_PLAN.md): words, times and status looks shared by the Appointments page,
// Today, the patient's Appointments tab and the calendar. Same lists as server/src/appointments/appointmentRules.js.

// The referral desk books a referred patient's appointment, and so sees the doctors' days (docs/REFERRALS_PLAN.md).
export const BOOKING_ROLES = ['receptionist', 'referral_desk', 'doctor'];
export const QUEUE_ROLES = ['receptionist', 'referral_desk', 'doctor', 'rmo', 'nurse'];
export const VISIT_TYPES = ['new', 'follow_up', 'scan', 'other'];
export const VISIT_TYPE_LABELS = { new: 'New', follow_up: 'Follow-up', scan: 'Scan', other: 'Other' };
// Why a patient comes (26 Oct 2026): a follow-up added by hand, and the reason marked at check-in. A short fixed list –
// reception sees it, so never a medical detail. Same list as server/src/appointments/visitPurpose.js.
export const VISIT_PURPOSES = ['consultation', 'reports', 'test', 'procedure', 'prescription', 'other'];
export const PURPOSE_LABELS = { consultation: 'Follow-up consultation', reports: 'Show reports', test: 'Test or scan', procedure: 'Dressing or procedure', prescription: 'Prescription', other: 'Other' };
export const PURPOSE_NOTE_MAX = 120;
/** "Show reports (bring the blood report)". */
export const purposeText = (p) => (p?.kind || p?.purpose ? `${PURPOSE_LABELS[p.kind ?? p.purpose]}${p.note ? ` (${p.note})` : ''}` : '');
export const CANCEL_REASONS = [
  { value: 'patient_asked', label: 'The patient asked' },
  { value: 'doctor_leave', label: 'Doctor on leave' },
  { value: 'other', label: 'Other reason' },
];
export const CANCEL_LABELS = {
  patient_asked: 'patient asked',
  doctor_leave: 'doctor on leave',
  other: 'other reason',
  next_visit_cleared: 'next visit removed',
  visit_cancelled: 'visit cancelled',
  arrival_undone: 'arrival undone',
  record_closed: 'record closed', // cancelled by the app when a doctor closed the record (no message was sent)
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Monday first, as on the calendar.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "17:30" → "5:30 PM" (as patients read times). */
export function timeLabel(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "10:30 AM", "Token 4" or "Time to be given". */
export const whenLabel = (a) => (a.kind === 'token' ? `Token ${a.token}` : a.start ? timeLabel(a.start) : 'Time to be given');

/** The status of an appointment as a pill: colour + icon + word. */
export const STATUS_LOOK = {
  booked: { tone: 'due', icon: CalendarCheck, label: 'Booked' },
  arrived: { tone: 'stable', icon: UserCheck, label: 'Arrived' },
  seen: { tone: 'inactive', icon: UserCheck, label: 'Checkup done' },
  no_show: { tone: 'watch', icon: UserX, label: 'Did not come' },
  cancelled: { tone: 'inactive', icon: CalendarX2, label: 'Cancelled' },
};
export const NEEDS_TIME_LOOK = { tone: 'watch', icon: Clock, label: 'Needs a time' };
export const TOKEN_LOOK = { tone: 'neutral', icon: Hash, label: 'Walk-in' };

/** Who the appointment is for: the patient's name, or the name given on a quick booking. */
export const whoLabel = (a) => a.patient?.fullName ?? a.guest?.name ?? 'Patient';

/** "YYYY-MM-DD" n days later. */
export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Day of the week (0 = Sunday) of a "YYYY-MM-DD" date. */
export const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tuesday 29 Sep 2026". */
export function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------- The doctor's day at a glance (owner, 14 Oct 2026) ----------

const PART_OF_DAY = (hhmm) => (hhmm < '12:00' ? 'Morning' : hhmm < '16:00' ? 'Afternoon' : 'Evening');

/** The day's slots by part of the day, past free slots left out: [{ label, slots }]. */
export function slotGroups(slots) {
  const groups = [];
  for (const s of slots ?? []) {
    if (s.past && !s.appointments.length && !s.busyWith) continue;
    const label = PART_OF_DAY(s.start);
    if (groups.at(-1)?.label !== label) groups.push({ label, slots: [] });
    groups.at(-1).slots.push(s);
  }
  return groups;
}

const DONE = new Set(['seen', 'no_show', 'cancelled']);

/**
 * Everyone on the day, in order: the slot bookings by time, then walk-ins by token, then the bookings still
 * without a time. next: the first one not seen yet (arrived first, then booked).
 */
export function dayList(day) {
  if (!day) return { list: [], next: null };
  const slotted = (day.slots ?? []).flatMap((s) => s.appointments.map((a) => ({ a, key: `${a.start ?? s.start}|0|${a.id}` })));
  const tokens = (day.tokens ?? []).map((a) => ({ a, key: `${a.start ?? '99:99'}|1|${String(a.token).padStart(4, '0')}` }));
  const other = (day.other ?? []).map((a) => ({ a, key: `99:99|2|${a.id}` }));
  const list = [...slotted, ...tokens, ...other].sort((x, y) => x.key.localeCompare(y.key)).map((x) => x.a);
  const open = list.filter((a) => !DONE.has(a.status));
  const next = open.find((a) => a.status === 'arrived') ?? open.find((a) => a.status === 'booked') ?? null;
  return { list, next };
}

/** "Sanjana" from "Sanjana Sample" (a slot shows the first name only). */
export const firstName = (a) => whoLabel(a).split(/\s+/)[0];

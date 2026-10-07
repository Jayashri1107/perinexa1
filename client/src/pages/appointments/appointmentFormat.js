// Words and looks for appointments, shared by the Appointments pages, the calendar, Today and the patient record.
import { Ban, CalendarClock, CircleCheck, CircleX, DoorOpen, Hourglass } from 'lucide-react';
import { labelOf } from '../../utils/format.js';

const LOOKS = {
  booked: { tone: 'info', icon: CalendarClock, word: 'Booked' },
  arrived: { tone: 'pending', icon: DoorOpen, word: 'Arrived' },
  seen: { tone: 'active', icon: CircleCheck, word: 'Seen' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
  no_show: { tone: 'danger', icon: CircleX, word: 'Did not come' },
};
export const appointmentLook = (a) => (a.needsTime && a.status === 'booked' ? { tone: 'pending', icon: Hourglass, word: 'Needs a time' } : LOOKS[a.status] ?? LOOKS.booked);

// "Asha Sample" or "Phone Caller (not registered)"
export const whoText = (a) => a.patient?.name ?? (a.guest ? `${a.guest.name} (not registered)` : '—');
export const phoneOf = (a) => a.patient?.phone || a.guest?.phone || '';

// "09:30" / "Token 4" / "No time yet"
export const whenText = (a) => (a.kind === 'token' ? `Token ${a.token}` : a.start ?? 'No time yet');

export const visitTypeText = (visitTypes, key) => labelOf(visitTypes, key);

// "2026-10-07" → "Wed, 7 Oct 2026" (the date itself, not the computer's time zone)
export const dayText = (iso, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '—';

// "2026-10-07" + n days
export const addDaysIso = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The times a visit of this length can start on a day (the server's day answer): every slot it takes must be free,
// in a session, and not past. exceptId: an appointment being moved (its own slots count as free).
export function freeStarts(day, minutes, slotMinutes, exceptId = null) {
  if (!day) return [];
  const slots = new Map(day.slots.map((s) => [s.start, s]));
  const isFree = (s) => s && !s.past && s.appointments.every((a) => a.id === exceptId) && (!s.busyWith || s.busyWith.id === exceptId);
  const steps = Math.max(1, Math.round(minutes / slotMinutes));
  return day.slots
    .filter((s) => {
      for (let i = 0; i < steps; i += 1) {
        const t = minutesOf(s.start) + i * slotMinutes;
        const key = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        if (!isFree(slots.get(key))) return false;
      }
      return true;
    })
    .map((s) => s.start);
}

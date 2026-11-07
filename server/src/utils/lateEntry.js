// Late entry (PX-X-04): a chart keeps the clinical time (when it happened, as typed) apart from the system time (when it
// was typed – the record's createdAt). An entry typed more than LATE_ENTRY_MINUTES after its clinical time is shown
// and printed with a "late entry" badge. Owner's decision (7 Nov 2026, through the developer): the badge is built –
// it reverses the earlier "not built". Any chart can use these two functions; each keeps both times as they were.

export const LATE_ENTRY_MINUTES = 60;

/** Minutes between the clinical time and the time it was typed (negative when typed before), or null. PURE. */
export function entryDelayMinutes(clinicalTime, systemTime) {
  const c = new Date(clinicalTime ?? NaN).getTime();
  const s = new Date(systemTime ?? NaN).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(s)) return null;
  return Math.floor((s - c) / 60_000);
}

/** True when it was typed more than `minutes` (default 60) after its clinical time. PURE. */
export function isLateEntry(clinicalTime, systemTime, minutes = LATE_ENTRY_MINUTES) {
  const c = new Date(clinicalTime ?? NaN).getTime();
  const s = new Date(systemTime ?? NaN).getTime();
  return Number.isFinite(c) && Number.isFinite(s) && s - c > minutes * 60_000;
}

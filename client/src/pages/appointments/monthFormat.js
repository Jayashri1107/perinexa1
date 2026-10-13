// The slot calendar (Appointments → Month, owner 13 Oct 2026): the weeks of a month and how each session looks.

/** "2026-10" for a day "2026-10-13". */
export const monthOf = (iso) => (iso ?? '').slice(0, 7);

/** The month before or after: shiftMonth("2026-01", -1) → "2025-12". */
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "October 2026". */
export const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The month's days in weeks of seven, Sunday first; null for the days before the 1st and after the last. */
export function weeksOf(days) {
  if (!days?.length) return [];
  const lead = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** A session as the calendar shows it: free slots left, or full. */
export function sessionLook(s) {
  const free = Math.max(0, s.slots - s.taken);
  return { free, full: free === 0, text: free === 0 ? 'Full' : `${free} free` };
}

/** The day's line under its sessions: "2 booked · 1 seen · 1 cancelled" (only what is there). */
export function dayCounts(c) {
  if (!c) return '';
  return [
    [c.booked, 'booked'],
    [c.seen, 'seen'],
    [c.noShow, 'did not come'],
    [c.cancelled, 'cancelled'],
    [c.tokens, c.tokens === 1 ? 'walk-in' : 'walk-ins'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`)
    .join(' · ');
}

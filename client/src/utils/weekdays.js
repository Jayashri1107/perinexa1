// Day numbers as the server stores them (0 = Sunday … 6 = Saturday), shown Monday first, in the browser's language.
const SUNDAY = new Date(Date.UTC(2024, 0, 7)); // a known Sunday
const nameOf = (day, weekday) =>
  new Intl.DateTimeFormat(undefined, { weekday, timeZone: 'UTC' }).format(new Date(SUNDAY.getTime() + day * 86400000));

export const dayName = (day) => nameOf(day, 'long');
export const dayShort = (day) => nameOf(day, 'short');
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// "Mon 10:00–13:00, 17:00–20:00 · Wed 10:00–13:00"
export const weekSummary = (week = []) =>
  WEEK_ORDER.map((d) => week.find((w) => w.day === d))
    .filter((w) => w?.sessions.length)
    .map((w) => `${dayShort(w.day)} ${w.sessions.map((s) => `${s.from}–${s.to}`).join(', ')}`)
    .join(' · ');

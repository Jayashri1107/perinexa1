// Words for Analytics → Waiting times (WaitingTimesPage.jsx). The periods are the server's
// (server/src/analytics/waitingTimes.js WAIT_PERIODS).
import { durationWords } from '../visits/visitTimelineFormat.js';

export const WAIT_PERIOD_OPTIONS = [
  { value: 'month', label: 'This month so far', doctorOnly: true },
  { value: 'last', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' },
  { value: '12m', label: 'Last 12 months' },
];

export const WEEKDAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "09:00–10:00" for an hour of arrival. */
export const hourWords = (h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;

/** A time in a table: the minutes in words, "Too few visits to show" below the minimum, "—" when there are none. */
export function timeCell(cell, which) {
  if (cell.tooFew) return 'Too few visits to show';
  return durationWords(cell[which] ?? null);
}

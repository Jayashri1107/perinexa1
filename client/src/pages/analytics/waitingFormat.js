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

// ---------- The look of the page (23 Nov 2026): groups, bars, the slowest row ----------

const GROUP_OF = { whole: 'whole', wholeWithSale: 'whole', labSample: 'lab', labReport: 'lab' };
/** "Each stage" in three groups. bars: the group whose rows are drawn as bars on one shared scale. */
export const STAGE_GROUPS = [
  { key: 'parts', label: 'Stages of the visit', bars: true },
  { key: 'whole', label: 'Whole visit', bars: false },
  { key: 'lab', label: 'Lab', bars: false },
];

/** The stages in their groups, in the order the server sends them; a stage this page does not know joins the first group. */
export function stageGroups(stages) {
  return STAGE_GROUPS.map((g) => ({ ...g, rows: (stages ?? []).filter((s) => (GROUP_OF[s.key] ?? 'parts') === g.key) })).filter((g) => g.rows.length > 0);
}

/** What a full bar stands for: the longest slow time of the rows (their usual time where no slow time is sent). */
export function barScale(cells) {
  return Math.max(0, ...(cells ?? []).map((c) => (c.tooFew ? 0 : (c.p90 ?? c.median ?? 0))));
}

/** The widths (0 to 100) of a row's usual and slow bar against a scale; null when there is no time to draw. */
export function barWidths(cell, scale) {
  if (!cell || cell.tooFew || cell.median == null || !(scale > 0)) return null;
  const pct = (v) => Math.max(0, Math.min(100, Math.round((v / scale) * 1000) / 10));
  return { usual: pct(cell.median), slow: pct(cell.p90 ?? cell.median) };
}

/** The key of the row with the longest usual time – only with two or more known rows and no tie; otherwise null. */
export function slowestKey(cells) {
  const known = (cells ?? []).filter((c) => !c.tooFew && c.median != null);
  if (known.length < 2) return null;
  const top = Math.max(...known.map((c) => c.median));
  const at = known.filter((c) => c.median === top);
  return at.length === 1 ? at[0].key : null;
}

/** Does any row have a time, or say "Too few visits to show"? false: nothing was measured in this period. */
export const hasTimes = (cells) => Boolean(cells?.some((c) => c.tooFew || c.median != null));

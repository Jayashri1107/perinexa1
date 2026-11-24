// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): the words and small sums of the Run payroll screen.
// The file's layout is chosen by the person on a preview – nothing here guesses what a column or a mark means.
// No requests: every function is PURE.

export const SHAPES = ['register', 'days', 'summary'];
export const SHAPE_WORDS = {
  register: 'A register – one row per person, one column per day',
  days: 'A daily list – one row per person per day (a punch log)',
  summary: 'Totals – one row per person with the month’s totals',
};
export const DAY_KINDS = ['present', 'half', 'weeklyOff', 'holiday', 'paidLeave', 'unpaidLeave', 'absent'];
export const KIND_WORDS = { present: 'Present', half: 'Half day', weeklyOff: 'Weekly off', holiday: 'Holiday', paidLeave: 'Paid leave', unpaidLeave: 'Unpaid leave', absent: 'Absent', skip: 'Not counted' };
export const MARK_MEANINGS = [...DAY_KINDS, 'skip'];
export const SUMMARY_COLUMNS = [...DAY_KINDS, 'paidDays'];
export const SUMMARY_WORDS = { present: 'Days present', half: 'Half days', weeklyOff: 'Weekly offs', holiday: 'Holidays', paidLeave: 'Paid leave', unpaidLeave: 'Unpaid leave', absent: 'Days absent', paidDays: 'Paid days (the file’s own total)' };
// "A month's pay is divided by 31 days – the days of that month"
export const BASIS_SHORT = { calendar: 'the days of that month', thirty: 'every month', twentySix: 'every month' };
export const DATE_ORDER_WORDS = { dmy: 'Day, month, year – 25/10/2026', mdy: 'Month, day, year – 10/25/2026', ymd: 'Year, month, day – 2026-10-25' };
export const EMPTY_MARK = '(empty)';
export const MAX_FILE_BYTES = 1024 * 1024;

// Why the sheet is not made yet, in plain words
export const BLOCKER_WORDS = {
  basis: 'How one day’s pay is counted is not chosen yet (Payroll → Settings; the hospital admin).',
  nobody: 'Nobody is on the payroll for this month. Add the staff first (Payroll → Staff).',
  codes: 'A code in the file belongs to nobody on the payroll. Tie it to a staff member or leave its row out.',
  noRow: 'Someone on the payroll has no row in the file. Write their paid days by hand, with a reason.',
  twoRows: 'Someone has two rows in the file (two of their codes). Remove one of the files, or take one code off the person.',
};
// A mark on a row of the sheet
export const NOTE_WORDS = {
  joined: 'Joined this month',
  left: 'Left this month',
  capped: 'More paid days than the basis – the full monthly pay',
  payChanged: 'Pay changed this month – the pay on the last working day is used',
  noPay: 'Pay not entered',
  noRow: 'No row in the file',
};

/** Column 1 → "A", 27 → "AA": as Excel names them. */
export function columnName(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
/** "C – Name": the column's letter and what its heading says. */
export const columnLabel = (n, heading) => `${columnName(n)}${heading ? ` – ${String(heading).slice(0, 24)}` : ''}`;

/** "2026-10" → "October 2026". */
export function monthLabel(month) {
  const [y, m] = String(month ?? '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
/** The month before "2026-11" → "2026-10" (the month whose attendance is usually read). */
export function previousMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m ?? ''));

/** 29.5 → "29.5", 31 → "31", null → "—". */
export const daysText = (n) => (n == null ? '—' : String(Math.round(n * 100) / 100));

/** A layout nobody has filled in yet. */
export const emptyLayout = () => ({ shape: 'register', headerRow: 1, codeColumn: 0, nameColumn: 0, firstDayColumn: 0, dateColumn: 0, dateOrder: 'dmy', statusColumn: 0, columns: {}, marks: {} });

/** A saved layout back in the form (what its shape does not use starts empty). */
export const layoutFromSaved = (saved) => ({ ...emptyLayout(), ...saved, columns: { ...(saved.columns ?? {}) }, marks: { ...(saved.marks ?? {}) } });

/** The layout as sent to the server: numbers as numbers, and only the marks that have a meaning. */
export function layoutBody(l) {
  const n = (v) => Number(v) || 0;
  return {
    shape: l.shape,
    headerRow: n(l.headerRow),
    codeColumn: n(l.codeColumn),
    nameColumn: n(l.nameColumn),
    firstDayColumn: n(l.firstDayColumn),
    dateColumn: n(l.dateColumn),
    dateOrder: l.dateOrder,
    statusColumn: n(l.statusColumn),
    columns: Object.fromEntries(SUMMARY_COLUMNS.map((k) => [k, n(l.columns?.[k])])),
    marks: Object.fromEntries(Object.entries(l.marks ?? {}).filter(([, v]) => MARK_MEANINGS.includes(v))),
  };
}

/** Does this layout read marks (so the marks found in the file need a meaning each)? */
export const usesMarks = (l) => l.shape === 'register' || (l.shape === 'days' && Number(l.statusColumn) > 0);

/** The marks found in the file that still have no meaning. */
export const marksToExplain = (layout, marks) => (usesMarks(layout) ? (marks ?? []).filter((m) => !MARK_MEANINGS.includes(layout.marks?.[m.mark])).map((m) => m.mark) : []);

/** May the file be read now? check: the server's last answer for this layout; changed: the columns changed since. */
export function canRead(layout, check, changed) {
  if (!check || changed) return false;
  if (Object.keys(check.fields ?? {}).length || (check.problems ?? []).length || !check.people) return false;
  return marksToExplain(layout, check.marks).length === 0;
}

/** "Present 23 · Half day 1 · Weekly off 4": the counts that are not zero. */
export const countsText = (counts) => DAY_KINDS.filter((k) => counts?.[k]).map((k) => `${KIND_WORDS[k]} ${daysText(counts[k])}`).join(' · ') || 'No days';

/** The days of a sheet row that are not paid: absent and unpaid leave together. */
export const notPaid = (counts) => (counts ? (counts.absent ?? 0) + (counts.unpaidLeave ?? 0) : null);

/** A typed number of days ("25.5") → the number, or null when it is not one. */
export function readDaysTyped(text, max = 31) {
  const t = String(text ?? '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= max && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9 ? n : null;
}

/** The bytes of a chosen file as base64, for sending (the server reads it as text and keeps it as it was). */
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

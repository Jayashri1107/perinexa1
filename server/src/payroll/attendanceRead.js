// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): from the rows of an attendance file to each person's days.
// The file's layout is DATA, not code: the accounts person says once, on a preview of the first rows, which column
// holds what, and that layout is kept for next month. Three shapes are expected (decision 4 – until the hospital's own
// files are seen):
//   'register' – one row per person, one column per day of the month, a mark in each (P, A, HD, WO, H, L …)
//   'days'     – one row per person per day (a punch log, or a daily list): a date, and a mark or an in-time
//   'summary'  – one row per person with the month's totals
// Matching to staff is by the code in the file – never by name. Nothing here knows a salary.
// No database, no requests: every function here is PURE.

export const SHAPES = ['register', 'days', 'summary'];
// What a day can be. 'skip': not counted at all (an empty box for a day before joining, a note in a cell).
export const DAY_KINDS = ['present', 'half', 'weeklyOff', 'holiday', 'paidLeave', 'unpaidLeave', 'absent'];
export const MARK_MEANINGS = [...DAY_KINDS, 'skip'];
// The totals a summary file can carry. 'paidDays': the file already says how many days are paid.
export const SUMMARY_COLUMNS = [...DAY_KINDS, 'paidDays'];
export const DATE_ORDERS = ['dmy', 'mdy', 'ymd'];
export const MAX_MARKS = 40;
export const MAX_PROBLEMS = 30;
export const EMPTY_MARK = '(empty)';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (m) => MONTH.test(String(m ?? ''));
/** The number of days in a month given as "2026-11". */
export function monthDays(month) {
  const m = MONTH.exec(month);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** A mark as it is compared: "p " → "P", an empty box → "(empty)". */
export const normaliseMark = (cell) => {
  const s = String(cell ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return s === '' ? EMPTY_MARK : s;
};
const cellAt = (row, column) => (column > 0 ? String(row[column - 1] ?? '').trim() : '');
const noCounts = () => Object.fromEntries(DAY_KINDS.map((k) => [k, 0]));

/** A date cell in the order the layout names → { y, m, d } or null. "05/11/2026", "5-11-26", "2026-11-05 09:12". */
export function readDate(cell, order) {
  const parts = String(cell ?? '').trim().split(/[\sT]/)[0].split(/[/.-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  const n = parts.map(Number);
  const [y, m, d] = order === 'ymd' ? n : order === 'mdy' ? [n[2], n[0], n[1]] : [n[2], n[1], n[0]];
  const year = y < 100 ? 2000 + y : y;
  if (m < 1 || m > 12 || d < 1 || d > 31 || year < 2000 || year > 2100) return null;
  if (d > new Date(Date.UTC(year, m, 0)).getUTCDate()) return null;
  return { y: year, m, d };
}

/** A total in a summary file: "26", "25.5" → a number of days (at most two decimals), or null. */
export function readDays(cell) {
  const s = String(cell ?? '').trim();
  if (s === '') return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 31 ? n : null;
}

/** The data rows of the file under a layout: [{ row (its number in the file), cells }], without empty lines. */
function dataRows(rows, layout) {
  const out = [];
  for (let i = layout.headerRow; i < rows.length; i += 1) if (rows[i].some((c) => c !== '')) out.push({ row: i + 1, cells: rows[i] });
  return out;
}

/** The different marks in the day boxes of a register, or in the status column of a daily list, most frequent first. */
export function marksIn(rows, layout, month) {
  const found = new Map();
  const add = (cell) => {
    const mark = normaliseMark(cell);
    found.set(mark, (found.get(mark) ?? 0) + 1);
  };
  for (const { cells } of dataRows(rows, layout)) {
    if (!cellAt(cells, layout.codeColumn)) continue;
    if (layout.shape === 'register') for (let d = 1; d <= monthDays(month); d += 1) add(cells[layout.firstDayColumn + d - 2]);
    else if (layout.shape === 'days' && layout.statusColumn > 0) add(cells[layout.statusColumn - 1]);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([mark, count]) => ({ mark, count }));
}

/**
 * Reads the file under a layout for one month.
 * Returns { people, problems, unmapped, skippedRows, otherMonths }:
 *  - people: [{ code, name, row, counts, paidDaysGiven, days }] – days: { "1": kind … } where the file is day by day
 *    (so joining and leaving inside the month can be applied), null for a summary;
 *  - problems: sentences that stop the read (a code twice, a total that is not a number, a date that can't be read);
 *  - unmapped: marks found in the file that the layout gives no meaning – the read waits for them;
 *  - skippedRows: rows with no code (titles, totals) – not read, only counted;
 *  - otherMonths: rows of a daily list whose date is in another month – not read, only counted.
 */
export function readAttendance(rows, layout, month) {
  const last = monthDays(month);
  const [year, monthNo] = month.split('-').map(Number);
  const problems = [];
  const problem = (text) => problems.length < MAX_PROBLEMS && problems.push(text);
  const unmapped = new Set();
  const marks = Object.fromEntries(Object.entries(layout.marks ?? {}).map(([k, v]) => [normaliseMark(k === EMPTY_MARK ? '' : k), v]));
  const meaning = (cell) => {
    const mark = normaliseMark(cell);
    if (MARK_MEANINGS.includes(marks[mark])) return marks[mark];
    unmapped.add(mark);
    return null;
  };
  const byCode = new Map();
  let skippedRows = 0;
  let otherMonths = 0;

  for (const { row, cells } of dataRows(rows, layout)) {
    const code = cellAt(cells, layout.codeColumn);
    if (!code) {
      skippedRows += 1;
      continue;
    }
    const name = cellAt(cells, layout.nameColumn).slice(0, 120);
    if (layout.shape === 'days') {
      const date = readDate(cells[layout.dateColumn - 1], layout.dateOrder);
      if (!date) {
        problem(`Row ${row}: the date “${cellAt(cells, layout.dateColumn).slice(0, 20)}” can’t be read – check the date column and the order of day, month and year.`);
        continue;
      }
      if (date.y !== year || date.m !== monthNo) {
        otherMonths += 1;
        continue;
      }
      // With a status column the mark says what the day was; without one, a row for the day means present
      const kind = layout.statusColumn > 0 ? meaning(cells[layout.statusColumn - 1]) : 'present';
      const person = byCode.get(code) ?? { code, name, row, days: {} };
      // The same day twice (in and out as two rows): counted once – the first row that says more than "not counted"
      if (kind && kind !== 'skip' && !person.days[date.d]) person.days[date.d] = kind;
      byCode.set(code, person);
      continue;
    }
    if (byCode.has(code)) {
      problem(`The code ${code} is on rows ${byCode.get(code).row} and ${row}. Each person has one row in this kind of file.`);
      continue;
    }
    if (layout.shape === 'register') {
      const days = {};
      for (let d = 1; d <= last; d += 1) {
        const kind = meaning(cells[layout.firstDayColumn + d - 2]);
        if (kind && kind !== 'skip') days[d] = kind;
      }
      byCode.set(code, { code, name, row, days });
    } else {
      const counts = noCounts();
      let paidDaysGiven = null;
      for (const key of SUMMARY_COLUMNS) {
        const column = layout.columns?.[key] ?? 0;
        if (!column) continue;
        const n = readDays(cells[column - 1]);
        if (n == null) problem(`Row ${row}, column ${column}: “${cellAt(cells, column).slice(0, 20)}” is not a number of days.`);
        else if (key === 'paidDays') paidDaysGiven = n;
        else counts[key] = n;
      }
      const total = DAY_KINDS.reduce((sum, k) => sum + counts[k], 0);
      if (total > last) problem(`Row ${row}: the days add up to ${total}, more than the ${last} days of the month.`);
      byCode.set(code, { code, name, row, counts, paidDaysGiven, days: null });
    }
  }

  const people = [...byCode.values()].map((p) => (p.days ? { ...p, counts: countDays(p.days), paidDaysGiven: null } : p));
  if (!people.length && !problems.length) problem('No row with a code was found. Check the code column and the row the headings are on.');
  return { people, problems, unmapped: [...unmapped], skippedRows, otherMonths };
}

/** { "1": "present", "2": "half" … } → how many of each kind, between two days of the month (both counted). */
export function countDays(days, from = 1, to = 31) {
  const counts = noCounts();
  for (const [d, kind] of Object.entries(days ?? {})) if (Number(d) >= from && Number(d) <= to && DAY_KINDS.includes(kind)) counts[kind] += 1;
  return counts;
}

/** What is wrong with a layout as sent ({ field: sentence }) – before any file is read with it. */
export function layoutProblems(layout, month) {
  const fields = {};
  const used = [];
  const column = (key, label, required = true) => {
    const n = layout[key] ?? 0;
    if (!n && required) fields[key] = `Choose the ${label} column`;
    if (n) used.push([key, n]);
  };
  column('codeColumn', 'code');
  column('nameColumn', 'name', false);
  if (layout.shape === 'register') {
    column('firstDayColumn', 'day 1');
    if (layout.firstDayColumn && layout.firstDayColumn + monthDays(month) - 1 > 80) fields.firstDayColumn = 'The day columns run past the end of the file';
  } else if (layout.shape === 'days') {
    column('dateColumn', 'date');
    column('statusColumn', 'status', false);
  } else {
    const chosen = SUMMARY_COLUMNS.filter((k) => layout.columns?.[k]);
    if (!chosen.length) fields.columns = 'Choose at least one column of days';
    for (const k of chosen) used.push([`columns.${k}`, layout.columns[k]]);
    // The file's own "paid days" and its parts would be counted twice
    if (layout.columns?.paidDays && chosen.length > 1) fields.columns = 'Choose either the paid days column, or the columns it is made of – not both';
  }
  const seen = new Map();
  for (const [key, n] of used) {
    if (seen.has(n) && !fields[key.split('.')[0]]) fields[key.split('.')[0]] = `Column ${n} is chosen twice`;
    seen.set(n, key);
  }
  if (layout.shape === 'register' && layout.firstDayColumn) {
    const end = layout.firstDayColumn + monthDays(month) - 1;
    for (const key of ['codeColumn', 'nameColumn']) if (layout[key] >= layout.firstDayColumn && layout[key] <= end) fields[key] = 'This column is one of the day columns';
  }
  return fields;
}

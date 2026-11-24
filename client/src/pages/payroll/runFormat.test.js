import { describe, expect, it } from 'vitest';
import { moduleByKey } from '../../platform/modules.js';
import { pageForPath } from '../../platform/pageAccess.js';
import { hospitalModules } from '../../platform/modules.js';
import { EMPTY_MARK, canRead, columnLabel, columnName, countsText, daysText, emptyLayout, isMonth, layoutBody, layoutFromSaved, marksToExplain, monthLabel, notPaid, previousMonth, readDaysTyped, toBase64, usesMarks } from './runFormat.js';

describe('payroll: the Run payroll screen', () => {
  it('is a tab of Payroll, after Staff, and belongs to its page access', () => {
    expect(moduleByKey('payroll').tabs.map((t) => t.label)).toEqual(['Staff', 'Run payroll', 'Advances', 'Lists', 'Rates', 'Settings']);
    expect(pageForPath('/payroll/run', hospitalModules(['accounts']))).toBe('payroll');
  });

  it('names columns as Excel does, and months and days in plain words', () => {
    expect([1, 2, 26, 27, 33, 80].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AG', 'CB']);
    expect(columnLabel(3, 'Name of the employee and more')).toBe('C – Name of the employee and');
    expect(columnLabel(5, '')).toBe('E');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('')).toBe('');
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect([daysText(29.5), daysText(31), daysText(null), daysText(25.25)]).toEqual(['29.5', '31', '—', '25.25']);
    expect(countsText({ present: 23, half: 1, weeklyOff: 4, holiday: 0, absent: 1 })).toBe('Present 23 · Half day 1 · Weekly off 4 · Absent 1');
    expect(countsText({})).toBe('No days');
    expect(notPaid({ absent: 1, unpaidLeave: 2 })).toBe(3);
    expect(notPaid(null)).toBeNull();
  });

  it('sends a layout as numbers, with only the marks that were given a meaning', () => {
    const typed = { ...emptyLayout(), headerRow: '2', codeColumn: '1', nameColumn: '2', firstDayColumn: '3', marks: { P: 'present', A: '', W: 'weeklyOff', X: 'nonsense' } };
    expect(layoutBody(typed)).toMatchObject({ shape: 'register', headerRow: 2, codeColumn: 1, nameColumn: 2, firstDayColumn: 3, dateColumn: 0, statusColumn: 0, marks: { P: 'present', W: 'weeklyOff' } });
    expect(layoutBody({ ...emptyLayout(), shape: 'summary', columns: { present: '3', paidDays: '' } }).columns).toMatchObject({ present: 3, paidDays: 0, half: 0 });
    const saved = layoutFromSaved({ shape: 'days', headerRow: 1, codeColumn: 1, dateColumn: 2, dateOrder: 'ymd', statusColumn: 5, marks: { P: 'present' } });
    expect(saved).toMatchObject({ shape: 'days', dateOrder: 'ymd', firstDayColumn: 0, columns: {}, marks: { P: 'present' } });
  });

  it('a file can be read only when every mark has a meaning and the last check found nothing wrong', () => {
    const layout = { ...emptyLayout(), codeColumn: 1, firstDayColumn: 3, marks: { P: 'present' } };
    const marks = [{ mark: 'P', count: 200 }, { mark: 'A', count: 12 }, { mark: EMPTY_MARK, count: 3 }];
    expect(usesMarks(layout)).toBe(true);
    expect(usesMarks({ ...layout, shape: 'summary' })).toBe(false);
    expect(usesMarks({ ...layout, shape: 'days', statusColumn: 0 })).toBe(false);
    expect(marksToExplain(layout, marks)).toEqual(['A', EMPTY_MARK]);
    const check = { fields: {}, problems: [], people: 7, marks };
    expect(canRead(layout, check, false)).toBe(false); // two marks still without a meaning
    const done = { ...layout, marks: { P: 'present', A: 'absent', [EMPTY_MARK]: 'skip' } };
    expect(canRead(done, check, false)).toBe(true);
    expect(canRead(done, check, true)).toBe(false); // a column changed since the check
    expect(canRead(done, { ...check, problems: ['The code A-17 is on rows 3 and 9.'] }, false)).toBe(false);
    expect(canRead(done, { ...check, fields: { codeColumn: 'Choose the code column' } }, false)).toBe(false);
    expect(canRead(done, { ...check, people: 0 }, false)).toBe(false);
    expect(canRead(done, null, false)).toBe(false);
  });

  it('reads typed days in wholes, halves and quarters, and turns a file into base64', () => {
    expect([readDaysTyped('26'), readDaysTyped('25.5'), readDaysTyped('25.25'), readDaysTyped('0')]).toEqual([26, 25.5, 25.25, 0]);
    expect([readDaysTyped('25.3'), readDaysTyped('32'), readDaysTyped('31', 30), readDaysTyped('-1'), readDaysTyped('ten'), readDaysTyped('')]).toEqual([null, null, null, null, null, null]);
    expect(toBase64(new TextEncoder().encode('Code,Name\nA-17,Sample'))).toBe('Q29kZSxOYW1lCkEtMTcsU2FtcGxl');
  });
});

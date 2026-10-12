// Calendar date helpers: UTC only, so the computer's time zone never shifts a day (all fake dates).
import { afterEach, describe, expect, it } from 'vitest';
import { gridKeyMove, longDay, monthTitle, monthWeeks, panelDayTitle, rangeTitle, shortDay, spokenDay, stepDate, weekdayLabel } from './calendarDates.js';

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);

// The server's days[] for a month shown as whole weeks, Monday first (as GET /api/calendar?view=month answers).
function serverDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    out.push({ date: iso(new Date(t)), booked: 0, plan: 0, attended: 0, edd: 0, lmp: 0 });
  }
  return out;
}

describe('stepDate', () => {
  it('moves by a day, a week or a month', () => {
    expect(stepDate('month', '2026-10-31', 1)).toBe('2026-11-30');
    expect(stepDate('month', '2027-01-31', 1)).toBe('2027-02-28');
    expect(stepDate('month', '2026-10-12', -1)).toBe('2026-09-12');
    expect(stepDate('month', '2026-12-15', 1)).toBe('2027-01-15');
    expect(stepDate('week', '2026-10-12', -1)).toBe('2026-10-05');
    expect(stepDate('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(stepDate('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepDate('day', '2026-03-01', -1)).toBe('2026-02-28');
  });
  it('gives null for a date that is not a day', () => {
    expect(stepDate('day', '2026-13-01', 1)).toBeNull();
    expect(stepDate('day', '', 1)).toBeNull();
  });
});

describe('rangeTitle and day words', () => {
  it('writes the range over the calendar', () => {
    expect(rangeTitle('week', '2026-10-12', '2026-10-18', '2026-10-12')).toBe('12–18 Oct 2026');
    expect(rangeTitle('week', '2026-09-28', '2026-10-04', '2026-10-01')).toBe('28 Sep – 4 Oct 2026');
    expect(rangeTitle('week', '2026-12-28', '2027-01-03', '2027-01-01')).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(rangeTitle('month', '2026-09-28', '2026-11-01', '2026-10-12')).toBe('October 2026');
    expect(rangeTitle('day', '2026-10-12', '2026-10-12', '2026-10-12')).toBe('Monday, 12 Oct 2026');
  });
  it('names days and months', () => {
    expect(weekdayLabel('2026-10-12')).toBe('Mon 12 Oct');
    expect(shortDay('2026-10-12')).toBe('Mon, 12 Oct 2026');
    expect(longDay('2026-10-18')).toBe('Sunday, 18 Oct 2026');
    expect(spokenDay('2026-10-12')).toBe('Monday 12 October 2026');
    expect(monthTitle('2027-02-01')).toBe('February 2027');
  });
});

describe('panelDayTitle', () => {
  it('starts with "Today ·" only on the hospital\'s today', () => {
    expect(panelDayTitle('2026-10-12', '2026-10-12')).toBe('Today · Mon, 12 Oct 2026');
    expect(panelDayTitle('2026-10-13', '2026-10-12')).toBe('Tue, 13 Oct 2026');
    expect(panelDayTitle('2026-10-13', undefined)).toBe('Tue, 13 Oct 2026');
  });
});

describe('gridKeyMove (Monday first)', () => {
  it('moves by keys and ignores others', () => {
    expect(gridKeyMove('2026-10-31', 'ArrowRight', 1)).toBe('2026-11-01');
    expect(gridKeyMove('2026-10-01', 'ArrowLeft', 1)).toBe('2026-09-30');
    expect(gridKeyMove('2026-10-01', 'ArrowUp', 1)).toBe('2026-09-24');
    expect(gridKeyMove('2026-10-28', 'ArrowDown', 1)).toBe('2026-11-04');
    expect(gridKeyMove('2026-10-15', 'Home', 1)).toBe('2026-10-12');
    expect(gridKeyMove('2026-10-15', 'End', 1)).toBe('2026-10-18');
    expect(gridKeyMove('2026-10-12', 'Home', 1)).toBe('2026-10-12');
    expect(gridKeyMove('2026-10-18', 'End', 1)).toBe('2026-10-18');
    expect(gridKeyMove('2026-10-31', 'PageDown', 1)).toBe('2026-11-30');
    expect(gridKeyMove('2026-10-31', 'PageUp', 1)).toBe('2026-09-30');
    expect(gridKeyMove('2026-10-15', 'Enter', 1)).toBeNull();
    expect(gridKeyMove('2026-10-15', 'a', 1)).toBeNull();
  });
  it('follows the first weekday of the grid (Sunday first)', () => {
    expect(gridKeyMove('2026-10-15', 'Home', 0)).toBe('2026-10-11');
    expect(gridKeyMove('2026-10-15', 'End', 0)).toBe('2026-10-17');
  });
});

describe('monthWeeks', () => {
  it('builds rows of seven from the server days', () => {
    const oct = monthWeeks(serverDays('2026-09-28', '2026-11-01'), '2026-10-12');
    expect(oct).toHaveLength(5);
    expect(oct.every((r) => r.length === 7)).toBe(true);
    expect(oct[0][0]).toMatchObject({ date: '2026-09-28', inMonth: false });
    expect(oct[0][3]).toMatchObject({ date: '2026-10-01', inMonth: true });
    expect(oct[4][6]).toMatchObject({ date: '2026-11-01', inMonth: false });
    expect(monthWeeks(serverDays('2027-02-01', '2027-02-28'), '2027-02-10')).toHaveLength(4);
    expect(monthWeeks(serverDays('2027-07-26', '2027-09-05'), '2027-08-01')).toHaveLength(6);
  });
});

describe('time zone of the computer', () => {
  const before = process.env.TZ;
  afterEach(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
  it('gives the same results in New York as in India', () => {
    const run = () => [
      rangeTitle('week', '2026-10-12', '2026-10-18', '2026-10-12'),
      rangeTitle('day', '2026-10-12', '2026-10-12', '2026-10-12'),
      rangeTitle('month', '2026-09-28', '2026-11-01', '2026-10-31'),
      stepDate('month', '2026-10-31', 1),
      stepDate('day', '2026-11-01', -1),
      gridKeyMove('2026-10-31', 'ArrowRight', 1),
      gridKeyMove('2026-11-01', 'Home', 1),
      weekdayLabel('2026-11-01'),
      JSON.stringify(monthWeeks(serverDays('2026-09-28', '2026-11-01'), '2026-10-12')),
    ];
    process.env.TZ = 'Asia/Kolkata';
    const india = run();
    process.env.TZ = 'America/New_York';
    const newYork = run();
    expect(newYork).toEqual(india);
    expect(newYork.slice(0, 8)).toEqual(['12–18 Oct 2026', 'Monday, 12 Oct 2026', 'October 2026', '2026-11-30', '2026-10-31', '2026-11-01', '2026-10-26', 'Sun 1 Nov']);
  });
});

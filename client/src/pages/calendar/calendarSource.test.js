// The calendar screen never reads the computer's clock or local-time dates: the hospital's today comes from the
// server, and every date helper works in UTC. This test reads the screen's own source files.
import { describe, expect, it } from 'vitest';

const sources = Object.entries(import.meta.glob('./*.{js,jsx}', { query: '?raw', import: 'default', eager: true })).filter(
  ([path]) => !/\.test\.jsx?$/.test(path),
);

describe('calendar source files', () => {
  it('are all read', () => {
    const names = sources.map(([path]) => path).sort();
    expect(names).toEqual(
      expect.arrayContaining(['./CalendarPage.jsx', './CalendarToolbar.jsx', './DayView.jsx', './EventMark.jsx', './MonthView.jsx', './WeekView.jsx', './calendarDates.js', './calendarFormat.js']),
    );
  });

  it.each(sources)('%s never reads the clock or local dates', (_path, text) => {
    expect(text).not.toMatch(/new Date\(\s*\)/);
    expect(text).not.toMatch(/Date\.now\(/);
    expect(text).not.toMatch(/\.(getDate|getDay|getMonth|getFullYear|getHours|getMinutes)\(/);
  });

  it('the month grid leaves browser shortcuts alone (Alt+Left = Back)', () => {
    const month = sources.find(([path]) => path === './MonthView.jsx')[1];
    expect(month).toMatch(/e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey\) return/);
  });
});

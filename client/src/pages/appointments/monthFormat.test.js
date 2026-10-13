// The slot calendar: months, weeks and how a session looks (no browser needed).
import { describe, expect, it } from 'vitest';
import { dayCounts, monthLabel, monthOf, sessionLook, shiftMonth, weeksOf } from './monthFormat.js';

describe('months', () => {
  it('moves a month back and forward across the year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthOf('2026-10-13')).toBe('2026-10');
    expect(monthLabel('2026-10')).toMatch(/October 2026/);
  });
  it('lays out the weeks Sunday first, with empty cells around the month', () => {
    const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}` })); // 1 Oct 2026 is a Thursday
    const weeks = weeksOf(days);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0][4].date).toBe('2026-10-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeksOf([])).toEqual([]);
  });
});

describe('a day', () => {
  it('a session shows its free slots, or Full', () => {
    expect(sessionLook({ slots: 18, taken: 5 })).toEqual({ free: 13, full: false, text: '13 free' });
    expect(sessionLook({ slots: 6, taken: 6 })).toEqual({ free: 0, full: true, text: 'Full' });
  });
  it('the counts line names only what is there', () => {
    expect(dayCounts({ booked: 2, seen: 1, noShow: 0, cancelled: 1, tokens: 1 })).toBe('2 booked · 1 seen · 1 cancelled · 1 walk-in');
    expect(dayCounts({ booked: 0, seen: 0, noShow: 0, cancelled: 0, tokens: 0 })).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { addDaysIso, dayLabel, timeLabel, weekdayOf, whenLabel, whoLabel } from './appointmentFormat.js';

describe('appointment words', () => {
  it('writes times as patients read them', () => {
    expect(timeLabel('00:10')).toBe('12:10 AM');
    expect(timeLabel('09:00')).toBe('9:00 AM');
    expect(timeLabel('12:00')).toBe('12:00 PM');
    expect(timeLabel('17:30')).toBe('5:30 PM');
    expect(timeLabel(null)).toBe('');
  });

  it('says the time, the token or that a time is still to be given', () => {
    expect(whenLabel({ kind: 'slot', start: '10:40' })).toBe('10:40 AM');
    expect(whenLabel({ kind: 'slot', start: null })).toBe('Time to be given');
    expect(whenLabel({ kind: 'token', token: 4 })).toBe('Token 4');
    expect(whoLabel({ patient: { fullName: 'Sample Mother' } })).toBe('Sample Mother');
    expect(whoLabel({ patient: null, guest: { name: 'Phone Caller' } })).toBe('Phone Caller');
  });

  it('moves through days and names them', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-09-28')).toBe(1);
    expect(dayLabel('2026-09-29')).toBe('Tuesday 29 Sep 2026');
  });
});

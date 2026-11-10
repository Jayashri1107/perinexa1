// "Today" / "Yesterday" on the patients list (10 Nov 2026: a patient registered yesterday evening showed as "Today" on
// the live site). Dates are the hospital's (India). Fake data only.
import { describe, expect, it } from 'vitest';
import { sinceText } from './patientFormat.js';

// 10 Nov 2026, 14:12 in India
const NOW = new Date('2026-11-10T08:42:00Z');

describe('sinceText – the Registered and Last visit columns', () => {
  it('a patient registered yesterday evening in India is "Yesterday", not "Today"', () => {
    expect(sinceText('2026-11-09T13:30:00Z', NOW)).toBe('Yesterday'); // 19:00 on 9 Nov in India
    expect(sinceText('2026-11-09T18:20:00Z', NOW)).toBe('Yesterday'); // 23:50 on 9 Nov in India
  });
  it('registered after midnight in India is "Today", though it is still 9 Nov in UTC', () => {
    expect(sinceText('2026-11-09T18:40:00Z', NOW)).toBe('Today'); // 00:10 on 10 Nov in India
    expect(sinceText('2026-11-10T04:30:00Z', NOW)).toBe('Today'); // 10:00 on 10 Nov in India
  });
  it('early in the morning in India, yesterday is still yesterday', () => {
    const early = new Date('2026-11-09T19:00:00Z'); // 00:30 on 10 Nov in India (9 Nov in UTC)
    expect(sinceText('2026-11-09T05:00:00Z', early)).toBe('Yesterday'); // 10:30 on 9 Nov in India
    expect(sinceText('2026-11-09T18:45:00Z', early)).toBe('Today'); // 00:15 on 10 Nov in India
  });
  it('a hospital date (midnight UTC, like the last visit day) counts as that day', () => {
    expect(sinceText('2026-11-10T00:00:00.000Z', NOW)).toBe('Today');
    expect(sinceText('2026-11-09T00:00:00.000Z', NOW)).toBe('Yesterday');
    expect(sinceText('2026-11-03T00:00:00.000Z', NOW)).toBe('7 days ago');
  });
  it('nothing for no date or a bad one', () => {
    expect(sinceText(null, NOW)).toBe('');
    expect(sinceText('not a date', NOW)).toBe('');
  });
});

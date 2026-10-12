import { describe, expect, it } from 'vitest';
import { datesWarning } from './patientFormat.js';

const NOW = new Date(2026, 8, 30, 11, 0); // 30 Sep 2026, local time

describe('datesWarning', () => {
  it('says nothing for a normal pregnancy (LMP 18 May 2026 = 19 weeks)', () => {
    expect(datesWarning({ lmp: '2026-05-18', scanEdd: '' }, NOW)).toBe(null);
    expect(datesWarning({ lmp: '', scanEdd: '' }, NOW)).toBe(null);
  });
  it('catches a date heard or typed wrongly (18 November 2025 = 45 weeks)', () => {
    expect(datesWarning({ lmp: '2025-11-18', scanEdd: '' }, NOW)).toBe(
      'The LMP entered is 18 November 2025, which makes her 45 weeks today – more than 42 weeks. Please check the date (day, month and year).',
    );
  });
  it('catches an LMP in the future and a scan EDD long past', () => {
    expect(datesWarning({ lmp: '2026-11-05', scanEdd: '' }, NOW)).toMatch(/5 November 2026 – that is in the future/);
    expect(datesWarning({ lmp: '', scanEdd: '2026-08-01' }, NOW)).toMatch(/scan EDD entered is 1 August 2026, which makes her 48 weeks/);
  });
});

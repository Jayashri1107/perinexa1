import { describe, expect, it } from 'vitest';
import { eddFromLmp, gestationOn, lmpFromEdd, milestoneDates, ribbonPosition } from './pregnancyTimeline.js';

// Doctor ideas #7 and #8 (16 Oct 2026). DRAFT clinical rules.
const d = (s) => new Date(`${s}T00:00:00Z`);

describe('the pregnancy wheel', () => {
  it('works out the EDD from the LMP and back (280 days)', () => {
    expect(eddFromLmp(d('2026-01-01')).toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(lmpFromEdd(d('2026-10-08')).toISOString().slice(0, 10)).toBe('2026-01-01');
  });
  it('gives weeks and days on any date', () => {
    expect(gestationOn(d('2026-10-08'), d('2026-01-01'))).toEqual({ weeks: 0, days: 0, total: 0 });
    expect(gestationOn(d('2026-10-08'), d('2026-05-21'))).toEqual({ weeks: 20, days: 0, total: 140 });
    expect(gestationOn(d('2026-10-08'), d('2025-12-31'))).toBeNull();
  });
  it('places dates on the ribbon and lists the milestones', () => {
    expect(ribbonPosition(d('2026-10-08'), d('2026-01-01'))).toBe(0);
    expect(ribbonPosition(d('2026-10-08'), d('2026-10-08'))).toBeCloseTo((280 / 294) * 100);
    expect(ribbonPosition(d('2026-10-08'), d('2027-06-01'))).toBe(100);
    const m = milestoneDates(d('2026-10-08'));
    expect(m.find((x) => x.weeks === 40).on.toISOString().slice(0, 10)).toBe('2026-10-08');
  });
});

// Time in hospital and Waiting times – the words (docs/PATIENT_FLOW_PLAN.md). Fake data only.
import { describe, expect, it } from 'vitest';
import { hourWords, timeCell } from '../analytics/waitingFormat.js';
import { analyticsTabs } from '../analytics/analyticsFormat.js';
import { canSeeTimeline, clockTime, durationWords, timelineParts } from './visitTimelineFormat.js';

describe('Time in hospital', () => {
  it('is for doctors only – never a super admin or platform admin, also inside a hospital', () => {
    expect(canSeeTimeline({ isDoctor: true, isPlatform: false })).toBe(true);
    expect(canSeeTimeline({ isDoctor: true, isPlatform: true })).toBe(false);
    expect(canSeeTimeline({ isDoctor: false, isPlatform: false })).toBe(false);
  });

  it('words durations and clock times', () => {
    expect([durationWords(null), durationWords(0), durationWords(45), durationWords(60), durationWords(92)]).toEqual(['—', '0 min', '45 min', '1 h', '1 h 32 min']);
    expect(clockTime('2026-11-10T04:32:00Z')).toBe('10:02');
  });

  it('puts the known moments in time order and leaves out unknown stages', () => {
    const parts = timelineParts({
      moments: { arrived: '2026-11-10T04:30:00Z', doctor: '2026-11-10T05:20:00Z', rmo: '2026-11-10T04:55:00Z', paid: null },
      stages: [
        { key: 'toRmo', label: 'Reception to RMO', minutes: 25 },
        { key: 'billing', label: 'Billing wait', minutes: null },
        { key: 'whole', label: 'Whole visit', minutes: 92 },
      ],
    });
    expect(parts.moments.map((m) => m.key)).toEqual(['arrived', 'rmo', 'doctor']);
    expect(parts.stages.map((s) => s.key)).toEqual(['toRmo']);
    expect(parts.total).toBe(92);
  });
});

describe('Waiting times', () => {
  it('says "Too few visits to show" below the minimum, and names the hours', () => {
    expect(timeCell({ tooFew: true, median: null }, 'median')).toBe('Too few visits to show');
    expect(timeCell({ tooFew: false, median: 25 }, 'median')).toBe('25 min');
    expect(hourWords(9)).toBe('09:00–10:00');
    expect(hourWords(23)).toBe('23:00–00:00');
  });

  it('is a tab of Analytics when asked for, after the sections', () => {
    const tabs = analyticsTabs('/analytics', '', { waiting: true, report: true });
    expect(tabs.map((t) => t.label)).toContain('Waiting times');
    expect(tabs.find((t) => t.label === 'Waiting times').to).toBe('/analytics/waiting');
    // Lab times (P9 – docs/LAB_BUILD_NOTE.md) follows Waiting times
    expect(analyticsTabs('/platform/analytics', '', { waiting: true }).slice(-2).map((t) => t.to)).toEqual(['/platform/analytics/waiting', '/platform/analytics/lab-times']);
    expect(analyticsTabs('/analytics').map((t) => t.label)).not.toContain('Waiting times');
  });
});

// The cycle (follicular study) sheet's words and helpers (docs/FERTILITY_PLAN.md section 7). Fake sample data.
import { describe, expect, it } from 'vitest';
import { REPORT_WORDS, blankEntry, cycleDay, cycleErrors, cyclePayload, cycleSummary, cycleValues, leadFollicleText, mmText, parseMm, protocolText } from './fertilityCycleFormat.js';

const formatDate = (d) => new Date(d).toISOString().slice(0, 10);
const stored = {
  id: 'c1',
  number: 2,
  status: 'after_trigger',
  day1: '2026-10-02T00:00:00.000Z',
  protocol: { kind: 'letrozole', drug: 'Letrozole', dose: '2.5 mg', days: 'day 3 to 7' },
  entries: [
    { on: '2026-10-11T00:00:00.000Z', day: 10, right: [12, 10], left: [9], endometriumMm: 6.5, pattern: 'trilaminar', e2: null, lh: null, p4: null, given: 'Letrozole finished', note: '', byName: 'Rani Demo-RMO', at: '2026-10-11T05:00:00.000Z' },
    { on: '2026-10-13T00:00:00.000Z', day: 12, right: [11, 16], left: [9.5], endometriumMm: 8, pattern: '', e2: null, lh: null, p4: null, given: '', note: 'Lead on the right', byName: 'Dr. Riley Demo', at: '2026-10-13T05:00:00.000Z' },
  ],
  trigger: { drug: 'hCG', dose: '10,000 IU', at: '2026-10-14T00:00:00.000Z', day: 13 },
  timing: { kind: 'iui', on: '2026-10-16T00:00:00.000Z', day: 15, postWashMillions: 12.5, note: '' },
  luteal: 'Progesterone 200 mg',
  cancelled: null,
  outcome: { test: '', testOn: null, betaHcg: null, betaHcgOn: null, clinical: '', scanOn: null, note: '' },
};

describe('the cycle sheet helpers', () => {
  it('reads follicle sizes typed with commas and writes them largest first', () => {
    expect(parseMm('16, 14.5')).toEqual([16, 14.5]);
    expect(parseMm(' 12 ; 10  9 ')).toEqual([12, 10, 9]);
    expect(parseMm('')).toEqual([]);
    expect(parseMm('16, big')).toBeNull();
    expect(mmText([11, 16, 9.5])).toBe('16, 11, 9.5');
    expect(cycleDay('2026-10-02', '2026-10-13')).toBe(12);
    expect(cycleDay('2026-10-02', '2026-10-02')).toBe(1);
    expect(cycleDay('', '2026-10-13')).toBeNull();
  });

  it('turns a stored sheet into form values and back, checking the numbers first', () => {
    const v = cycleValues(stored);
    expect(v.day1).toBe('2026-10-02');
    expect(v.entries[1]).toMatchObject({ on: '2026-10-13', right: '16, 11', left: '9.5', endometriumMm: '8', pattern: '' });
    expect(v.timing).toMatchObject({ kind: 'iui', on: '2026-10-16', postWashMillions: '12.5' });
    expect(cycleErrors(v)).toEqual({});
    const payload = cyclePayload(v, 3);
    expect(payload.rev).toBe(3);
    expect(payload.entries[1]).toMatchObject({ on: '2026-10-13', right: [16, 11], left: [9.5], endometriumMm: 8 });
    expect(payload.trigger).toEqual({ drug: 'hCG', dose: '10,000 IU', at: '2026-10-14' });
    expect(payload.outcome).toMatchObject({ test: '', testOn: null, betaHcg: null });
    const bad = { ...v, entries: [{ ...blankEntry('2026-10-01'), right: 'x' }], timing: { ...v.timing, kind: 'iui', on: '' }, outcome: { ...v.outcome, test: 'positive', testOn: '' } };
    expect(cycleErrors(bad)).toEqual({
      'entries.0.on': 'A scan day cannot be before day 1.',
      'entries.0.right': 'Sizes in mm, separated by commas – for example 16, 14.5',
      'timing.on': 'Give the IUI date.',
      'outcome.testOn': 'Give the date of the pregnancy test.',
    });
    expect(blankEntry().on).toBe('');
  });

  it('says what a cycle is in one line, and names the lead follicle', () => {
    expect(protocolText(stored.protocol)).toBe('Letrozole 2.5 mg day 3 to 7');
    expect(protocolText({ kind: 'natural', drug: '', dose: '', days: '' })).toBe('Natural cycle (no medicines)');
    expect(cycleSummary(stored, formatDate)).toBe('Cycle 2 · Letrozole tablets · 2 scans · IUI 2026-10-16');
    expect(leadFollicleText(stored)).toBe('Lead follicle 16 mm (right), day 12');
    expect(cycleSummary({ ...stored, status: 'cancelled', cancelled: { reason: 'no_response' }, timing: { kind: '' }, trigger: {} }, formatDate)).toBe('Cycle 2 · Letrozole tablets · 2 scans · stopped – No follicle grew');
    expect(cycleSummary({ ...stored, outcome: { ...stored.outcome, test: 'positive', clinical: 'yes' } }, formatDate)).toContain('test positive · clinical pregnancy');
    // Every report word has its Marathi and Hindi
    for (const [key, words] of Object.entries(REPORT_WORDS)) expect(words.en && words.mr && words.hi, key).toBeTruthy();
  });
});

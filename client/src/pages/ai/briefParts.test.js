import { describe, expect, it } from 'vitest';
import { briefNamer, briefParts, calendarBriefBody } from './briefParts.js';

const kavya = { id: 'k1', fullName: 'Kavya Sample' };
const meera = { id: 'm1', fullName: 'Meera Sample' };

describe('the AI brief', () => {
  it('turns labels into patients, in their places', () => {
    expect(briefParts('[P1] and [P2] are due today.', { P1: kavya, P2: meera })).toEqual([
      { patient: kavya, label: 'P1' },
      { text: ' and ' },
      { patient: meera, label: 'P2' },
      { text: ' are due today.' },
    ]);
    expect(briefParts('See [P1] first', { P1: kavya })).toEqual([{ text: 'See ' }, { patient: kavya, label: 'P1' }, { text: ' first' }]);
  });

  it('keeps plain words, and an unknown label as "a patient"', () => {
    expect(briefParts('Nothing needs attention.', {})).toEqual([{ text: 'Nothing needs attention.' }]);
    expect(briefParts('Call [P9] today', {})).toEqual([{ text: 'Call ' }, { text: 'a patient' }, { text: ' today' }]);
    expect(briefParts('', {})).toEqual([]);
  });

  it('tells two patients with the same name apart by their patient number', () => {
    const one = { id: 'a', fullName: 'Prajakta Sample', mrn: 'P-000012' };
    const two = { id: 'b', fullName: 'Prajakta Sample', mrn: 'P-000040' };
    const name = briefNamer({ P1: one, P2: two, P3: kavya });
    expect([name(one), name(two), name(kavya)]).toEqual(['Prajakta Sample (P-000012)', 'Prajakta Sample (P-000040)', 'Kavya Sample']);
    expect(briefNamer({ P1: one })(one)).toBe('Prajakta Sample');
  });

  it("asks the calendar's brief only for the choices that are set", () => {
    expect(calendarBriefBody({ view: 'week', date: '', types: '', scope: 'all' })).toEqual({ view: 'week', scope: 'all' });
    expect(calendarBriefBody({ view: 'month', date: '2026-09-01', types: 'booked,edd', scope: undefined })).toEqual({ view: 'month', date: '2026-09-01', types: 'booked,edd' });
  });
});

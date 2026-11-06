// Reception's "Doctors today" (owner, 14 Oct 2026): each doctor's state as colour + icon + word.
import { describe, expect, it } from 'vitest';
import { DOCTORS_SHOWN, doctorToday, doctorsForToday } from './DeskToday.jsx';

const doctor = (extra) => ({ id: 'd', name: 'Dr Sample', hasTimings: true, sessions: [], leave: null, ...extra });

describe('doctorToday', () => {
  it('says In OPD with the hours, On leave until when, or why there is no OPD', () => {
    const inOpd = doctorToday(doctor({ sessions: [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }] }));
    expect([inOpd.tone, inOpd.word]).toEqual(['stable', 'In OPD']);
    expect(inOpd.line).toMatch(/10.*1.*5.*8/);
    const leave = doctorToday(doctor({ leave: { to: '2026-10-16', note: 'Conference' } }));
    expect([leave.tone, leave.word]).toEqual(['watch', 'On leave']);
    expect(leave.line).toMatch(/Conference/);
    expect(doctorToday(doctor({})).word).toBe('No OPD today');
    expect(doctorToday(doctor({ hasTimings: false })).word).toBe('No OPD timings');
  });
});

describe('doctorsForToday (a hospital of many doctors)', () => {
  const list = Array.from({ length: 12 }, (_, i) => doctor({ id: `d${i}`, name: `Dr ${String.fromCharCode(65 + i)}`, expected: 0, waiting: 0, seen: 0 }));
  list[9] = { ...list[9], waiting: 2 };
  list[7] = { ...list[7], sessions: [{ from: '10:00', to: '17:00' }] };
  it('shows those with patients first, then those in OPD, a few of the rest, and Show all for the others', () => {
    const { shown, hidden } = doctorsForToday(list);
    expect(shown.map((d) => d.id).slice(0, 2)).toEqual(['d9', 'd7']);
    expect(shown).toHaveLength(DOCTORS_SHOWN);
    expect(hidden).toBe(12 - DOCTORS_SHOWN);
    expect(doctorsForToday(list, true)).toMatchObject({ hidden: 0 });
    expect(doctorsForToday(list, true).shown).toHaveLength(12);
  });
  it('never hides a doctor with patients today', () => {
    const busy = list.map((d) => ({ ...d, expected: 1 }));
    expect(doctorsForToday(busy).shown).toHaveLength(12);
  });
});

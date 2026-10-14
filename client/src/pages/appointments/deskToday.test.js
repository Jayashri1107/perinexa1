// Reception's "Doctors today" (owner, 14 Oct 2026): each doctor's state as colour + icon + word.
import { describe, expect, it } from 'vitest';
import { doctorToday } from './DeskToday.jsx';

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

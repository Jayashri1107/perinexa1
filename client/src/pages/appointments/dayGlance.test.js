// The doctor's day at a glance (owner, 14 Oct 2026): times by part of the day, everyone on the day in order, the next
// one marked. Fake sample data only.
import { describe, expect, it } from 'vitest';
import { dayList, firstName, slotGroups } from './appointmentFormat.js';

const slot = (start, appointments = [], extra = {}) => ({ start, appointments, busyWith: null, past: false, ...extra });
const appt = (id, start, status = 'booked', name = `Test Patient ${id}`) => ({ id, kind: 'slot', start, status, patient: { id, fullName: name } });

describe('slotGroups', () => {
  it('splits the day into morning, afternoon and evening and leaves out free times that have passed', () => {
    const groups = slotGroups([slot('09:50', [], { past: true }), slot('10:00', [appt('a', '10:00')], { past: true }), slot('11:50'), slot('12:00'), slot('16:30')]);
    expect(groups.map((g) => [g.label, g.slots.map((s) => s.start)])).toEqual([
      ['Morning', ['10:00', '11:50']],
      ['Afternoon', ['12:00']],
      ['Evening', ['16:30']],
    ]);
  });
});

describe('dayList', () => {
  it('lists bookings by time, then walk-ins by token, then bookings without a time; next is who arrived first', () => {
    const day = {
      slots: [slot('10:20', [appt('b', '10:20', 'arrived')]), slot('10:00', [appt('a', '10:00', 'seen')]), slot('10:40', [appt('c', '10:40')])],
      tokens: [{ id: 't2', kind: 'token', token: 2, status: 'booked' }, { id: 't1', kind: 'token', token: 1, status: 'booked' }],
      other: [{ id: 'o', kind: 'slot', start: null, status: 'booked', needsTime: true }],
    };
    const { list, next } = dayList(day);
    expect(list.map((a) => a.id)).toEqual(['a', 'b', 'c', 't1', 't2', 'o']);
    expect(next.id).toBe('b');
  });

  it('marks the first booked one when nobody has arrived, and nobody when all are done', () => {
    expect(dayList({ slots: [slot('10:00', [appt('a', '10:00', 'seen')]), slot('10:10', [appt('b', '10:10')])], tokens: [], other: [] }).next.id).toBe('b');
    expect(dayList({ slots: [slot('10:00', [appt('a', '10:00', 'seen')])], tokens: [], other: [] }).next).toBeNull();
    expect(dayList(null)).toEqual({ list: [], next: null });
  });

  it('shows the first name in a slot', () => {
    expect(firstName(appt('a', '10:00', 'booked', 'Sanjana Sample'))).toBe('Sanjana');
    expect(firstName({ guest: { name: 'Meena Test' } })).toBe('Meena');
  });
});

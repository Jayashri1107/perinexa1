// The calendar's pure rules: ranges, entries, counts, limits, order and detail levels. No database.
// Fake data only.
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { addDays, isoDay } from '../src/careplans/dates.js';
import { closedForPregnancy } from '../src/careplans/plansService.js';
import { calendarLevel } from '../src/calendar/calendarAccess.js';
import {
  bookedEvent,
  bookedState,
  countDays,
  eddEvent,
  limitPerDay,
  lmpEvent,
  planEvents,
  projectPatient,
  receptionIds,
  sortEvents,
} from '../src/calendar/calendarEvents.js';
import { rangeFor } from '../src/calendar/calendarRange.js';
import { MAX_RANGE_DAYS } from '../src/calendar/calendarRules.js';
import { calendarQuerySchema } from '../src/calendar/calendarSchemas.js';

const D = (iso) => new Date(`${iso}T00:00:00Z`);
const TODAY = D('2026-10-12');
const range = (a, b) => [D(a), D(b)];
const oid = () => new mongoose.Types.ObjectId();

describe('rangeFor', () => {
  const r = (view, iso) => rangeFor(view, D(iso)).map(isoDay);
  it('gives the day, its week (Monday first) and its month as whole weeks', () => {
    expect(r('day', '2026-10-12')).toEqual(['2026-10-12', '2026-10-12']);
    expect(r('week', '2026-10-12')).toEqual(['2026-10-12', '2026-10-18']);
    expect(r('week', '2026-10-11')).toEqual(['2026-10-05', '2026-10-11']);
    expect(r('month', '2026-10-20')).toEqual(['2026-09-28', '2026-11-01']);
    expect(r('month', '2027-02-10')).toEqual(['2027-02-01', '2027-02-28']);
    expect(r('month', '2027-08-15')).toEqual(['2027-07-26', '2027-09-05']);
  });
  it('never covers more than 42 days', () => {
    for (let d = D('2026-01-01'); d < D('2029-01-01'); d = addDays(d, 1)) {
      for (const view of ['day', 'week', 'month']) {
        const [from, to] = rangeFor(view, d);
        const n = (to - from) / 86_400_000 + 1;
        expect(n).toBeLessThanOrEqual(MAX_RANGE_DAYS);
        expect(from <= d && d <= to).toBe(true);
      }
    }
  });
});

describe('query schema', () => {
  const ok = (q) => calendarQuerySchema.safeParse(q).success;
  it('accepts the documented parameters and refuses anything else', () => {
    expect(calendarQuerySchema.parse({}).view).toBe('week');
    expect(calendarQuerySchema.parse({ types: 'lmp, edd' }).types).toEqual(['lmp', 'edd']);
    expect(ok({ view: 'year' })).toBe(false);
    expect(ok({ date: '2026-13-01' })).toBe(false);
    expect(ok({ types: 'lmp,lmp' })).toBe(false);
    expect(ok({ types: '' })).toBe(false);
    expect(ok({ types: 'risk' })).toBe(false);
    expect(ok({ types: ['lmp', 'edd'] })).toBe(false);
    expect(ok({ foo: '1' })).toBe(false);
    expect(ok({ scope: 'mine' })).toBe(true);
  });
});

describe('booked visits', () => {
  it('bookedState: booked after today, today, then "no visit recorded"; arrived when she came that day', () => {
    expect(bookedState(D('2026-10-13'), TODAY)).toBe('booked');
    expect(bookedState(D('2026-10-12'), TODAY)).toBe('today');
    expect(bookedState(D('2026-10-11'), TODAY)).toBe('no_visit');
    expect(bookedState(D('2026-10-12'), TODAY, new Date('2026-10-12T04:30:00Z'))).toBe('arrived');
    expect(bookedState(D('2026-10-11'), TODAY, new Date('2026-10-11T04:30:00Z'))).toBe('arrived');
  });
  it('bookedEvent: clinical and reception shapes', () => {
    const patientId = oid();
    const visitId = oid();
    const booking = { patientId, visitId, visitOn: D('2026-09-20'), nextVisitOn: D('2026-10-20'), note: 'fasting sample', arrivedAt: null };
    const c = bookedEvent(booking, TODAY, 'clinical', D('2027-01-11'));
    expect(Object.keys(c).sort()).toEqual(['date', 'ga', 'id', 'note', 'patientId', 'state', 'type', 'visitId', 'visitOn'].sort());
    expect(c).toMatchObject({ id: `booked:${patientId}:${visitId}`, date: '2026-10-20', visitOn: '2026-09-20', state: 'booked', note: 'fasting sample', ga: { weeks: 28, days: 1 } });
    const r = bookedEvent(booking, TODAY, 'reception', D('2027-01-11'));
    expect(Object.keys(r).sort()).toEqual(['date', 'id', 'patientId', 'state', 'type']);
    expect(r.id).toBe(`booked:${patientId}`);
    const came = { ...booking, arrivedAt: new Date('2026-10-20T04:30:00Z') };
    expect(bookedEvent(came, TODAY, 'reception')).toEqual({ id: `booked:${patientId}`, type: 'booked', date: '2026-10-20', patientId: String(patientId), state: 'arrived', arrivedAt: '2026-10-20T04:30:00.000Z' });
    expect(bookedEvent(came, TODAY, 'clinical')).toMatchObject({ state: 'arrived', arrivedAt: '2026-10-20T04:30:00.000Z', visitId: String(visitId) });
    expect(bookedEvent(booking, TODAY, 'clinical', null).ga).toBeNull();
  });
});

// A hand-built plan (only what the engine reads on the way to a status).
const visit = (key, fields = {}) => ({ _id: oid(), key, origin: 'template', kind: 'visit', name: `Visit ${key}`, state: 'open', done: null, ...fields });
const open = (from, to) => ({ phase: 'open', dueFrom: D(from), dueBy: D(to) });
const planOf = (items, extra = {}) => ({ patientId: oid(), status: 'active', basis: { edd: D('2027-01-11') }, items, ...extra });

describe('planEvents', () => {
  it('places an open visit on the day its window opens, with the status of the Care plan tab', () => {
    const plan = planOf([visit('a', { auto: open('2026-10-12', '2026-10-25') })]);
    const [e, ...rest] = planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), 'clinical');
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({ type: 'plan', date: '2026-10-12', status: 'due', due: { from: '2026-10-12', to: '2026-10-25' }, name: 'Visit a', doneOn: null, doneElsewhere: false, ga: { weeks: 27, days: 0 } });
    expect(e.id).toBe(`plan:${plan.patientId}:${e.itemId}`);
  });

  it('overdue, then missed once a later visit has started', () => {
    const items = [visit('v24', { auto: open('2026-09-21', '2026-10-11') }), visit('v28', { auto: open('2026-10-19', '2026-11-08') })];
    const plan = planOf(items);
    const r = range('2026-09-21', '2026-09-27');
    expect(planEvents(plan, TODAY, r, 'clinical')).toMatchObject([{ date: '2026-09-21', status: 'overdue' }]);
    expect(planEvents(plan, D('2026-10-19'), r, 'clinical')).toMatchObject([{ date: '2026-09-21', status: 'missed' }]);
    expect(planEvents(plan, D('2026-10-19'), r, 'reception')).toEqual([]);
  });

  it('leaves out items that are on hold, before booking, not applicable, waiting or need a check', () => {
    const items = ['on_hold', 'lapsed', 'not_applicable', 'waiting', 'check', 'decide'].map((phase, i) =>
      visit(`x${i}`, { auto: { phase, dueFrom: D('2026-10-12'), dueBy: D('2026-10-20') }, timing: { after: { key: 'none', weeks: 2 } } }),
    );
    expect(planEvents(planOf(items), TODAY, range('2026-10-12', '2026-10-18'), 'clinical')).toEqual([]);
  });

  it('places an attended visit on the day it was done; an empty done record is not a done date', () => {
    const items = [
      visit('d', { state: 'done', done: { on: D('2026-10-05'), elsewhere: true }, auto: { phase: 'done', dueFrom: D('2026-09-21'), dueBy: D('2026-10-11') } }),
      visit('e', { done: {}, auto: open('2026-10-06', '2026-10-20') }),
      visit('f', { state: 'done', done: {}, auto: { phase: 'done', dueFrom: D('2026-10-07'), dueBy: D('2026-10-20') } }),
    ];
    const events = planEvents(planOf(items), TODAY, range('2026-10-05', '2026-10-11'), 'clinical');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ date: '2026-10-05', status: 'done', doneOn: '2026-10-05', doneElsewhere: true });
    expect(events[1]).toMatchObject({ date: '2026-10-06', status: 'due', doneOn: null });
    expect(planEvents(planOf(items), TODAY, range('2026-10-05', '2026-10-11'), 'reception').map((e) => e.date)).toEqual(['2026-10-06']);
  });

  it('a long window shows only on its opening day', () => {
    const plan = planOf([visit('long', { auto: open('2026-09-07', '2027-01-03') })]);
    expect(planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), 'clinical')).toEqual([]);
    expect(planEvents(plan, TODAY, range('2026-09-07', '2026-09-13'), 'clinical')).toHaveLength(1);
  });

  it('reception: dates only, no missed or attended visits, nothing for sensitive records', () => {
    const plan = planOf([visit('a', { auto: open('2026-10-12', '2026-10-25') })]);
    const [e] = receptionIds(planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), 'reception'));
    expect(Object.keys(e).sort()).toEqual(['date', 'due', 'id', 'patientId', 'type']);
    expect(e.due).toEqual({ from: '2026-10-12' }); // the window's first day only
    expect(planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), 'reception', { sensitive: true })).toEqual([]);
    expect(planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), null)).toEqual([]);
  });

  it('only visits are placed', () => {
    const plan = planOf([{ ...visit('scan'), kind: 'scan', auto: open('2026-10-12', '2026-10-25') }]);
    expect(planEvents(plan, TODAY, range('2026-10-12', '2026-10-18'), 'clinical')).toEqual([]);
  });
});

describe('LMP and EDD entries', () => {
  const patient = { _id: oid(), careType: 'antenatal', pregnancy: { lmp: D('2026-10-05'), scanEdd: null, effectiveEdd: D('2027-07-12') } };
  it('clinical only, with the EDD in use and its source', () => {
    expect(lmpEvent(patient)).toEqual({ id: `lmp:${patient._id}`, type: 'lmp', date: '2026-10-05', patientId: String(patient._id), edd: '2027-07-12', eddSource: 'lmp' });
    expect(eddEvent({ ...patient, pregnancy: { ...patient.pregnancy, scanEdd: D('2027-07-10'), effectiveEdd: D('2027-07-10') } })).toMatchObject({ date: '2027-07-10', eddSource: 'scan' });
    expect(lmpEvent(patient, 'reception')).toBeNull();
    expect(eddEvent(patient, 'reception')).toBeNull();
    expect(lmpEvent({ ...patient, pregnancy: { lmp: null, scanEdd: D('2027-07-10'), effectiveEdd: D('2027-07-10') } })).toBeNull();
  });
});

describe('receptionIds', () => {
  it('builds ids from the patient and the date only', () => {
    const pid = String(oid());
    const itemIdA = String(oid());
    const events = [
      { id: null, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12', to: '2026-10-30' } },
      { id: null, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12', to: '2026-10-25' } },
      { id: null, type: 'booked', date: '2026-10-14', patientId: pid, state: 'booked' },
    ];
    receptionIds(events);
    expect(events.map((e) => e.id)).toEqual([`plan:${pid}:2026-10-12:2`, `plan:${pid}:2026-10-12`, `booked:${pid}`]);
    // Reception windows lose their end after the ids are made (still ordered by it)
    const rec = receptionIds([
      { id: null, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12', to: '2026-10-30' }, firstDayOnly: true },
      { id: null, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12', to: '2026-10-25' }, firstDayOnly: true },
    ]);
    expect(rec).toEqual([
      { id: `plan:${pid}:2026-10-12:2`, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12' } },
      { id: `plan:${pid}:2026-10-12`, type: 'plan', date: '2026-10-12', patientId: pid, due: { from: '2026-10-12' } },
    ]);
    expect(events.some((e) => e.id.includes(itemIdA))).toBe(false);
  });
});

describe('closedForPregnancy', () => {
  const edd = D('2026-10-12');
  it('a closed plan of this pregnancy (EDD within 8 weeks, or on hold for such an EDD)', () => {
    expect(closedForPregnancy([{ basis: { edd }, closed: { reason: 'pregnancy_ended' } }], edd)).toBe(true);
    expect(closedForPregnancy([{ basis: { edd: addDays(edd, 90) }, closed: { reason: 'new_pregnancy' } }], edd)).toBe(false);
    expect(closedForPregnancy([{ basis: { edd: addDays(edd, -120) }, closed: { reason: 'other' }, eddReview: { toEdd: addDays(edd, 10) } }], edd)).toBe(true);
    expect(closedForPregnancy([{ basis: { edd: addDays(edd, -120) }, closed: { reason: 'new_pregnancy' }, eddReview: { toEdd: addDays(edd, 10) } }], edd)).toBe(false);
    expect(closedForPregnancy([], edd)).toBe(false);
  });
});

describe('countDays and limitPerDay', () => {
  const ev = (type, date, extra = {}) => ({ id: `${type}:${date}:${Math.random()}`, type, date, patientId: 'p', ...extra });
  const events = [ev('booked', '2026-10-12'), ev('plan', '2026-10-12', { status: 'due' }), ev('plan', '2026-10-12', { status: 'done' }), ev('edd', '2026-10-13'), ev('lmp', '2026-10-13')];

  it('counts per day, only the types asked for; attended at clinical level only', () => {
    const days = countDays(events, range('2026-10-12', '2026-10-18'), ['booked', 'plan', 'edd'], 'clinical');
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: '2026-10-12', booked: 1, plan: 1, attended: 1, edd: 0 });
    expect(days[1]).toEqual({ date: '2026-10-13', booked: 0, plan: 0, attended: 0, edd: 1 });
    const rec = countDays(events.filter((e) => e.status !== 'done'), range('2026-10-12', '2026-10-12'), ['booked', 'plan'], 'reception');
    expect(rec).toEqual([{ date: '2026-10-12', booked: 1, plan: 1 }]);
  });

  it('keeps the first N entries per day and says how many more there are; counts stay complete', () => {
    const many = [0, 1, 2, 3, 4].map((i) => ev('booked', '2026-10-12', { id: `b${i}` }));
    const all = [...many, ev('edd', '2026-10-13')];
    const days = countDays(all, range('2026-10-12', '2026-10-13'), ['booked', 'edd'], 'clinical');
    const kept = limitPerDay(all, days, 2);
    expect(kept.map((e) => e.id)).toEqual(['b0', 'b1', all[5].id]);
    expect(days).toEqual([
      { date: '2026-10-12', booked: 5, edd: 0, more: 3 },
      { date: '2026-10-13', booked: 0, edd: 1, more: 0 },
    ]);
  });
});

describe('sortEvents', () => {
  it('date, type (booked, plan, edd, lmp), window start, name, id', () => {
    const patients = { a: { fullName: 'beta' }, b: { fullName: 'Alpha' } };
    const events = [
      { id: '9', type: 'lmp', date: '2026-10-12', patientId: 'a' },
      { id: '8', type: 'plan', date: '2026-10-12', patientId: 'a', due: { from: '2026-10-12' } },
      { id: '7', type: 'plan', date: '2026-10-12', patientId: 'b', due: { from: '2026-10-12' } },
      { id: '6', type: 'booked', date: '2026-10-13', patientId: 'a' },
      { id: '5', type: 'edd', date: '2026-10-12', patientId: 'a' },
      { id: '4', type: 'booked', date: '2026-10-12', patientId: 'a' },
      { id: '3', type: 'booked', date: '2026-10-12', patientId: 'a' },
    ];
    expect(sortEvents(events, patients).map((e) => e.id)).toEqual(['3', '4', '7', '8', '5', '9', '6']);
  });
});

describe('projectPatient', () => {
  const p = { _id: oid(), mrn: 'P-000001', fullName: 'Calendar Test', phone: '+91 00000 00000', careType: 'antenatal', pregnancy: { effectiveEdd: D('2027-01-11') }, assignedDoctor: oid(), sensitive: true, risk: { level: 'high' } };
  it('whitelists the fields per level', () => {
    expect(projectPatient(p, 'clinical', 'Dr A', TODAY)).toEqual({ id: String(p._id), mrn: 'P-000001', fullName: 'Calendar Test', phone: '+91 00000 00000', doctorName: 'Dr A', level: 'clinical', careType: 'antenatal', gaToday: { weeks: 27, days: 0 } });
    expect(projectPatient(p, 'reception', null, TODAY)).toEqual({ id: String(p._id), mrn: 'P-000001', fullName: 'Calendar Test', phone: '+91 00000 00000', doctorName: null, level: 'reception' });
  });
});

describe('calendarLevel', () => {
  const me = oid();
  const other = oid();
  const req = (...roles) => ({ user: { _id: me }, membership: { roles } });
  const own = { assignedDoctor: me, sensitive: false };
  const unassigned = { assignedDoctor: null, sensitive: false };
  const others = { assignedDoctor: other, sensitive: false };
  const othersSensitive = { assignedDoctor: other, sensitive: true };
  it('follows the need-to-know rules, counting only calendar roles', () => {
    expect(calendarLevel(req('doctor'), own)).toBe('clinical');
    expect(calendarLevel(req('doctor'), unassigned)).toBe('clinical');
    expect(calendarLevel(req('doctor'), others)).toBe('clinical');
    expect(calendarLevel(req('doctor'), othersSensitive)).toBeNull();
    expect(calendarLevel(req('rmo'), othersSensitive)).toBe('clinical');
    expect(calendarLevel(req('receptionist'), others)).toBe('reception');
    expect(calendarLevel(req('nurse'), others)).toBeNull();
    expect(calendarLevel(req('nurse', 'receptionist'), others)).toBe('reception');
    expect(calendarLevel(req('doctor', 'receptionist'), othersSensitive)).toBe('reception');
  });
});

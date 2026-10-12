// Calendar words, marks and rows (all fake sample data).
import { describe, expect, it } from 'vitest';
import {
  EVENT_LOOK,
  allowedTypesFor,
  countWords,
  dayCaption,
  dayCounts,
  dayRows,
  defaultScopeFor,
  emptyDayText,
  eventLines,
  isReceptionOnly,
  mergedPlanLine,
  monthHasEntries,
  parseScope,
  parseTypes,
  personLevel,
  planStatusLook,
  sectionTitle,
  serializeTypes,
  subtitleFor,
  todayParams,
  weekSections,
  withBookedText,
} from './calendarFormat.js';

const ALL = ['booked', 'plan', 'edd', 'lmp'];
const RECEPTION = ['booked', 'plan'];

const clinicalPatient = (id, extra = {}) => ({ id, mrn: `P-${id}`, fullName: `Calendar Test ${id}`, phone: '90000 00000', doctorName: null, level: 'clinical', careType: 'antenatal', gaToday: { weeks: 27, days: 0 }, ...extra });
const receptionPatient = (id) => ({ id, mrn: `P-${id}`, fullName: `Calendar Test ${id}`, phone: '', doctorName: null, level: 'reception' });

// A reception entry that fails the test if anything reads a clinical field from it.
function receptionEvent(fields) {
  const e = { ...fields };
  for (const key of ['status', 'name', 'note', 'itemId', 'visitId', 'ga']) {
    Object.defineProperty(e, key, {
      get() {
        throw new Error(`reception entry read: ${key}`);
      },
    });
  }
  return e;
}

describe('who sees what', () => {
  it('gives each role its level, types, scope and first view', () => {
    expect(personLevel(['doctor'])).toBe('clinical');
    expect(personLevel(['rmo'])).toBe('clinical');
    expect(personLevel(['receptionist', 'nurse'])).toBe('reception');
    expect(allowedTypesFor(['doctor', 'receptionist'])).toEqual(ALL);
    expect(allowedTypesFor(['receptionist'])).toEqual(RECEPTION);
    expect(defaultScopeFor(['doctor'])).toBe('mine');
    expect(defaultScopeFor(['doctor', 'rmo'])).toBe('all');
    expect(defaultScopeFor(['receptionist'])).toBe('all');
    expect(isReceptionOnly(['receptionist'])).toBe(true);
    expect(isReceptionOnly(['receptionist', 'doctor'])).toBe(false);
  });
});

describe('parseTypes / serializeTypes', () => {
  it('keeps the fixed order, drops unknown types and leaves "all" out of the address', () => {
    expect(parseTypes('lmp,booked', ALL)).toEqual(['booked', 'lmp']);
    expect(parseTypes('booked,foo', ALL)).toEqual(['booked']);
    expect(parseTypes('', ALL)).toEqual(ALL);
    expect(parseTypes('foo', ALL)).toEqual(ALL);
    expect(parseTypes('edd,plan', RECEPTION)).toEqual(['plan']);
    expect(serializeTypes(['lmp', 'booked'], ALL)).toBe('booked,lmp');
    expect(serializeTypes(ALL, ALL)).toBe('');
    expect(serializeTypes(['plan', 'booked'], RECEPTION)).toBe('');
    for (const list of [['booked'], ['plan', 'edd'], ['booked', 'edd', 'lmp']]) {
      expect(parseTypes(serializeTypes(list, ALL), ALL)).toEqual(list);
    }
  });
});

describe('EVENT_LOOK words', () => {
  it('uses the words for each level and view', () => {
    expect(EVENT_LOOK.plan.word('reception')).toBe('Visit due');
    expect(EVENT_LOOK.plan.word('clinical')).toBe('Plan visit');
    expect(EVENT_LOOK.plan.word('clinical', null, 'month')).toBe('Plan visit – window opens');
    expect(EVENT_LOOK.plan.word('reception', null, 'month')).toBe('Visit due – window opens');
    expect(EVENT_LOOK.edd.word('clinical', { eddSource: 'scan' })).toBe('EDD (scan)');
    expect(EVENT_LOOK.edd.word('clinical', { eddSource: 'lmp' })).toBe('EDD (LMP)');
    expect(EVENT_LOOK.edd.word('clinical')).toBe('EDD');
    expect(EVENT_LOOK.booked.word('reception')).toBe('Booked visit');
    expect(EVENT_LOOK.lmp.word('clinical')).toBe('LMP');
    for (const t of ALL) expect(EVENT_LOOK[t].className).toBe(`cal-mark-${t}`);
  });
});

describe('dayRows', () => {
  const day = '2026-10-12';
  const patients = { a: clinicalPatient('a'), b: clinicalPatient('b'), c: clinicalPatient('c'), r: receptionPatient('r') };
  const events = [
    { id: 'booked:a:v1', type: 'booked', date: day, patientId: 'a', visitId: 'v1', visitOn: '2026-09-20', state: 'today', note: '', ga: null },
    { id: 'booked:r', type: 'booked', date: day, patientId: 'r', state: 'today' },
    { id: 'plan:a:i1', type: 'plan', date: day, patientId: 'a', itemId: 'i1', name: 'Antenatal visit (28–30 weeks)', due: { from: day, to: '2026-10-25' }, status: 'due', doneOn: null, doneElsewhere: false, ga: { weeks: 27, days: 0 } },
    { id: 'plan:b:i2', type: 'plan', date: day, patientId: 'b', itemId: 'i2', name: 'Booking visit', due: { from: day, to: '2026-10-25' }, status: 'due', doneOn: null, doneElsewhere: false, ga: null },
    { id: 'plan:c:i3', type: 'plan', date: day, patientId: 'c', itemId: 'i3', name: 'Antenatal visit (24–26 weeks)', due: { from: '2026-09-21', to: '2026-10-11' }, status: 'done', doneOn: day, doneElsewhere: false, ga: null },
    { id: 'plan:b:i4', type: 'plan', date: day, patientId: 'b', itemId: 'i4', name: 'Extra review visit', due: { from: day, to: '2026-10-18' }, status: 'upcoming', doneOn: null, doneElsewhere: false, ga: null },
    { id: 'edd:c', type: 'edd', date: day, patientId: 'c', eddSource: 'lmp' },
    { id: 'lmp:b', type: 'lmp', date: '2026-10-13', patientId: 'b', edd: '2027-07-20', eddSource: 'lmp' },
  ];

  it('lists a patient with a booked and a plan visit once, under booked visits', () => {
    const rows = dayRows(events, patients, day);
    expect(rows.booked.map((r) => r.patientId)).toEqual(['a', 'r']);
    expect(rows.booked[0].eventIds).toEqual(['booked:a:v1', 'plan:a:i1']);
    expect(rows.planOpens.map((r) => r.patientId)).toEqual(['b']);
    expect(rows.planOpens[0].eventIds).toEqual(['plan:b:i2', 'plan:b:i4']);
    expect(rows.attended.map((r) => r.patientId)).toEqual(['c']);
    expect(rows.edd.map((r) => r.patientId)).toEqual(['c']);
    expect(rows.lmp).toEqual([]); // the LMP is on another day
    expect(rows.booked[0].patient).toBe(patients.a);
  });

  it('never reads a reception entry\'s status or name', () => {
    const rEvents = [
      receptionEvent({ id: 'booked:r', type: 'booked', date: day, patientId: 'r', state: 'no_visit' }),
      receptionEvent({ id: 'plan:r:2026-10-12', type: 'plan', date: day, patientId: 'r', due: { from: day } }),
      receptionEvent({ id: 'plan:s:2026-10-12', type: 'plan', date: day, patientId: 's', due: { from: day } }),
    ];
    const rp = { r: receptionPatient('r'), s: receptionPatient('s') };
    const rows = dayRows(rEvents, rp, day);
    expect(rows.booked.map((r) => r.eventIds)).toEqual([['booked:r', 'plan:r:2026-10-12']]);
    expect(rows.planOpens.map((r) => r.patientId)).toEqual(['s']);
    expect(rows.attended).toEqual([]);
    // The mark already says "Booked visit" / "Visit due": Details carry only what is extra.
    expect(eventLines(rEvents[0], rp.r)).toEqual([]);
    expect(eventLines(rEvents[1], rp.r)).toEqual(['From 12 Oct 2026']); // the window's first day only
    // Inside a booked row the plan visit has no mark, so the words stay.
    expect(mergedPlanLine(rEvents[1], rp.r)).toBe('Visit due from 12 Oct 2026');
    expect(mergedPlanLine(receptionEvent({ id: 'plan:r:x', type: 'plan', date: day, patientId: 'r' }), rp.r)).toBe('Visit due');
    // The day's numbers, without the server's count: no status read, the merged plan visit counted.
    const c = dayCounts(undefined, rows);
    expect(c).toMatchObject({ booked: 1, plan: 2, opens: 2, attended: 0, withBooked: 1 });
  });
});

describe('dayCounts', () => {
  it('counts a care-plan visit merged into a booked row, and says where it is', () => {
    const d = '2026-10-12';
    const pts = { a: clinicalPatient('a') };
    const evs = [
      { id: 'booked:a', type: 'booked', date: d, patientId: 'a', state: 'booked' },
      { id: 'plan:a:i1', type: 'plan', date: d, patientId: 'a', status: 'upcoming' },
    ];
    const rows = dayRows(evs, pts, d);
    expect(rows.planOpens).toEqual([]);
    expect(dayCounts({ date: d, booked: 1, plan: 1, attended: 0 }, rows)).toMatchObject({ booked: 1, plan: 1, opens: 1, attended: 0, withBooked: 1 });
    expect(dayCounts(undefined, rows)).toMatchObject({ booked: 1, plan: 1, opens: 1, withBooked: 1 });
  });
  it('uses the server\'s numbers (the month cell\'s), also for a cut day', () => {
    const empty = { booked: [], planOpens: [], attended: [], edd: [], lmp: [] };
    expect(dayCounts({ date: '2026-10-12', plan: 2, attended: 1 }, empty)).toMatchObject({ opens: 2, attended: 1, plan: 3, withBooked: 0 });
    const d = '2026-10-12';
    const one = dayRows([{ id: 'p1', type: 'plan', date: d, patientId: 'a', status: 'due' }], { a: clinicalPatient('a') }, d);
    expect(dayCounts({ date: d, plan: 7, attended: 0, edd: 0 }, one)).toMatchObject({ plan: 7, opens: 7, edd: 0 });
    // A type the server did not count (filtered out) falls back to the rows: none.
    expect(dayCounts({ date: d, plan: 7 }, one).lmp).toBe(0);
  });
  it('words the merged ones', () => {
    expect(withBookedText(1)).toBe('1 more is listed under Booked visits, with the booked visit.');
    expect(withBookedText(2)).toBe('2 more are listed under Booked visits, with the booked visit.');
  });
});

describe('day-view titles and captions', () => {
  it('keeps reception to its own words', () => {
    expect(sectionTitle('plan', 'reception')).toBe('Visits due');
    expect(sectionTitle('plan', 'clinical')).toBe('Plan visits');
    expect(dayCaption('planOpens', 'reception')).toBe('Visits due');
    for (const s of ['booked', 'planOpens']) expect(dayCaption(s, 'reception')).not.toMatch(/Plan|window/);
    expect(dayCaption('booked', 'reception')).toBe('Booked visits');
  });
  it('keeps the doctors\' captions', () => {
    expect(dayCaption('planOpens', 'clinical')).toBe('Plan visits – window opens this day');
    expect(dayCaption('attended', 'clinical')).toBe('Plan visits – attended this day');
    expect(dayCaption('edd', 'clinical')).toBe('EDD');
    expect(dayCaption('lmp', 'clinical')).toBe('LMP');
  });
});

describe('patients and Go to today in the address', () => {
  it('sends "mine" or "all" only for a doctor', () => {
    expect(parseScope('mine', ['rmo'])).toBe('');
    expect(parseScope('mine', ['receptionist'])).toBe('');
    expect(parseScope('all', ['receptionist'])).toBe('');
    expect(parseScope('mine', ['doctor', 'rmo'])).toBe('mine');
    expect(parseScope('all', ['doctor'])).toBe('all');
    expect(parseScope('x', ['doctor'])).toBe('');
    expect(parseScope('', ['doctor'])).toBe('');
  });
  it('Go to today clears the day and only values the server cannot use', () => {
    expect(todayParams({ view: 'month', date: '2040-01-01', types: 'edd', scope: 'all' }, ['doctor'])).toEqual({ date: '' });
    expect(todayParams({ view: 'year', date: '', types: '', scope: '' }, ['doctor'])).toEqual({ date: '', view: '' });
    expect(todayParams({ view: 'week', date: '', types: '', scope: 'mine' }, ['rmo'])).toEqual({ date: '', scope: '' });
    expect(todayParams({ view: 'week', date: '', types: '', scope: 'bogus' }, ['doctor'])).toEqual({ date: '', scope: '' });
    expect(todayParams({ view: 'day', date: 'x', types: '', scope: 'mine' }, ['doctor', 'rmo'])).toEqual({ date: '' });
  });
});

describe('entry words', () => {
  const p = clinicalPatient('a', { gaToday: { weeks: 38, days: 2 } });
  it('describes each kind of entry for doctors', () => {
    const plan = { id: 'x', type: 'plan', name: 'Antenatal visit (28–30 weeks)', due: { from: '2026-10-19', to: '2026-11-08' }, status: 'upcoming', ga: { weeks: 28, days: 1 } };
    expect(eventLines(plan, p)).toEqual(['Antenatal visit (28–30 weeks)', '19 Oct – 8 Nov 2026', '28 w 1 d on the day']);
    expect(mergedPlanLine({ ...plan, status: 'due' }, p)).toBe('Plan: Antenatal visit (28–30 weeks) · Due now');
    const booked = { id: 'y', type: 'booked', visitOn: '2026-09-20', note: 'with reports', state: 'booked', ga: null };
    expect(eventLines(booked, p)).toEqual(['Booked at the visit of 20 Sep 2026', 'with reports']);
    expect(eventLines({ id: 'z', type: 'edd', eddSource: 'scan' }, p)).toEqual(['now 38 w 2 d']);
    expect(eventLines({ id: 'w', type: 'lmp', edd: '2027-07-12', eddSource: 'lmp' }, clinicalPatient('b', { gaToday: { weeks: 1, days: 0 } }))).toEqual([
      'EDD 12 Jul 2027',
      'now 1 w 0 d',
    ]);
  });
  it('uses the Care plan tab\'s status words', () => {
    expect(planStatusLook({ status: 'done', doneElsewhere: false }).word).toBe('Attended');
    expect(planStatusLook({ status: 'done', doneElsewhere: true }).word).toBe('Attended (elsewhere)');
    expect(planStatusLook({ status: 'overdue' })).toMatchObject({ tone: 'high', word: 'Overdue' });
    expect(planStatusLook({ status: 'missed' })).toMatchObject({ tone: 'inactive', word: 'Missed' });
  });
});

describe('weekSections', () => {
  it('groups entries by day, seven sections, carrying "more"', () => {
    const days = ['12', '13', '14', '15', '16', '17', '18'].map((d) => ({ date: `2026-10-${d}`, booked: 0, more: d === '14' ? 5 : 0 }));
    const events = [
      { id: '1', date: '2026-10-12' },
      { id: '2', date: '2026-10-14' },
      { id: '3', date: '2026-10-14' },
    ];
    const s = weekSections(events, days);
    expect(s).toHaveLength(7);
    expect(s[0]).toEqual({ date: '2026-10-12', events: [events[0]], more: 0 });
    expect(s[2].events.map((e) => e.id)).toEqual(['2', '3']);
    expect(s[2].more).toBe(5);
    expect(s[6].events).toEqual([]);
  });
});

describe('countWords', () => {
  it('gives the pieces and the words a screen reader hears', () => {
    const day = { date: '2026-10-12', booked: 5, plan: 3, attended: 0, edd: 1, lmp: 0, more: 0 };
    const c = countWords(day, 'clinical');
    expect(c.label).toBe('Monday 12 October 2026: 5 booked visits, 3 visit windows open, 1 EDD');
    expect(c.pieces).toEqual([
      { type: 'booked', count: 5 },
      { type: 'plan', count: 3 },
      { type: 'edd', count: 1 },
    ]);
    expect(c.total).toBe(9);
    expect(countWords({ date: '2026-10-12', booked: 5, plan: 3 }, 'reception').label).toBe('Monday 12 October 2026: 5 booked visits, 3 visits due from this day');
    expect(countWords({ date: '2026-10-13', booked: 1, plan: 1, edd: 2, lmp: 1, attended: 1 }, 'clinical').label).toBe(
      'Tuesday 13 October 2026: 1 booked visit, 1 visit window opens, 2 EDDs, 1 LMP, 1 visit attended',
    );
    expect(countWords({ date: '2026-10-12', booked: 0, plan: 0 }, 'reception')).toEqual({ pieces: [], total: 0, label: 'Monday 12 October 2026: no entries' });
  });
});

describe('page words', () => {
  it('names only the types shown when a day is empty', () => {
    expect(emptyDayText(ALL, 'clinical')).toBe('No booked visits, plan visits, EDD or LMP on this day.');
    expect(emptyDayText(['booked', 'edd'], 'clinical')).toBe('No booked visits or EDD on this day.');
    expect(emptyDayText(['lmp'], 'clinical')).toBe('No LMP on this day.');
    expect(emptyDayText(RECEPTION, 'reception')).toBe('No booked or due visits on this day.');
    expect(emptyDayText(['plan'], 'reception')).toBe('No due visits on this day.');
  });
  it('writes the subtitle for each level and scope', () => {
    expect(subtitleFor('clinical', 'mine')).toBe('Booked visits, care-plan visits, EDD and LMP of your patients');
    expect(subtitleFor('clinical', 'all')).toBe('Booked visits, care-plan visits, EDD and LMP of all patients');
    expect(subtitleFor('reception', 'all')).toBe('Booked visits and visits due, all patients');
  });
  it('checks only the days of the month for entries', () => {
    const days = [
      { date: '2026-09-28', booked: 2 },
      { date: '2026-10-01', booked: 0, plan: 0 },
    ];
    expect(monthHasEntries(days, '2026-10-12')).toBe(false);
    expect(monthHasEntries([...days, { date: '2026-10-20', attended: 1 }], '2026-10-12')).toBe(true);
  });
});

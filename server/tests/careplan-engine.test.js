// Feature 7: the care-plan engine (pure – no database). Every worked example of the specification (§2.3)
// is an assertion here. Dates are dates only (midnight UTC); "today" is the hospital's date (India).
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import * as clientWords from '../../client/src/pcpndtWords.js';
import { ANTENATAL_DRAFT } from '../src/careplans/antenatalDraft.js';
import { POSTNATAL_DRAFT } from '../src/careplans/otherDrafts.js';
import { addDays, dayZero, gaOn, hospitalToday, isoDay, toHospitalDate, utcDay, weekEnd, weekStart } from '../src/careplans/dates.js';
import { approvalsOf, backfillApproval, itemsHash, planApproval, rulesHash } from '../src/careplans/hashes.js';
import {
  derivePlan,
  findingsWithoutPlanItems,
  itemId,
  itemStatus,
  mergeTemplate,
  newItem,
  nextVisitSuggestion,
  planFacts,
  planStatuses,
  ruleFor,
  staffBasis,
  timingKey,
  touched,
} from '../src/careplans/planEngine.js';
import { LATE_START, MIN_BOOKING_DAYS, POST_DATES_DAYS } from '../src/careplans/planRules.js';
import { Patient, gestationalAge } from '../src/models/Patient.js';
import * as serverWords from '../src/utils/pcpndt.js';

const d = (s) => new Date(`${s}T00:00:00Z`);
const iso = isoDay;
const EDD = d('2027-03-01'); // day 0 = 25 May 2026
const AT = new Date('2026-10-12T06:00:00Z');
const PERSON = 'Dr Rao';
// Every fact known, nothing that makes an optional item apply.
const LOW = { edd: EDD, eddSource: 'lmp', highRisk: 'no', mayBeHigher: false, rhNegative: 'no', previousCaesarean: 'no', diabetes: 'no', hypertension: 'no' };

function buildPlan({ bookedOn, edd = EDD, facts = LOW, items = ANTENATAL_DRAFT.items, at = AT } = {}) {
  const plan = {
    status: 'active',
    eddReview: null,
    basis: { edd },
    bookedOn: d(bookedOn),
    source: { templateName: 'Standard', version: 1, itemsHash: itemsHash(items) },
    items: items.map((t) => newItem(t)),
  };
  // A new plan: every item is worked out for the first time (rev 0, nothing for the plan log)
  derivePlan(plan, { ...facts, edd }, { at, newIds: new Set(plan.items.map(itemId)) });
  return plan;
}
const item = (plan, key) => plan.items.find((it) => it.key === key && !it.notInTemplate) ?? plan.items.find((it) => it.key === key);
const status = (plan, key, today) => itemStatus(plan, item(plan, key), typeof today === 'string' ? d(today) : today).status;
const dueOf = (it) => [iso(it.auto.dueFrom), iso(it.auto.dueBy)];
const windowOf = (it) => [iso(it.auto.windowFrom), iso(it.auto.windowTo)];

// What a person's action does to an item (the routes do the same in step 2): change it, raise its rev, re-derive.
function personDoes(plan, facts, key, change, at = AT) {
  const it = item(plan, key);
  change(it);
  it.rev += 1;
  it.revByName = PERSON;
  it.revAt = at;
  return derivePlan(plan, facts, { at, actorName: PERSON, changedIds: new Set([itemId(it)]) });
}
const actor = (at = AT) => ({ by: null, byName: PERSON, at });
const markDone = (on) => (it) => {
  it.state = 'done';
  it.done = { on: d(on), elsewhere: false, result: '', note: '', via: 'manual', visitId: null, ...actor() };
};
const moveTo = (plan, from, to) => (it) => {
  it.manualDate = { dueFrom: d(from), dueBy: d(to), reason: '', ...actor() };
  it.staffBasis = staffBasis(plan, it, AT);
};

// A finding ticked for this pregnancy, as stored on the record.
const found = (key, over = {}) => ({ key, byName: PERSON, at: AT, via: 'record', endedAt: null, endedByName: null, ...over });

// A patient record as the risk engine and planFacts read it.
function patient({ medical = {}, obstetric = {}, risk = { level: 'low' }, pregnancy = { effectiveEdd: EDD } } = {}) {
  return {
    careType: 'antenatal',
    ageYears: 28,
    createdAt: AT,
    pregnancy,
    risk,
    medical: { allergies: 'None known', bloodGroup: 'B+', conditions: [], conditionsReviewed: true, ...medical },
    obstetric: { gravida: 2, para: 1, abortions: 0, previousCaesareans: 0, pastComplications: [], ...obstetric },
  };
}

describe('1. dates', () => {
  it('works out the windows and gestation of the worked example (EDD 1 Mar 2027)', () => {
    expect(iso(dayZero(EDD))).toBe('2026-05-25');
    const w = (from, to) => [iso(weekStart(EDD, from)), iso(weekEnd(EDD, to))];
    expect(w(11, 13)).toEqual(['2026-08-10', '2026-08-30']); // NT
    expect(w(18, 20)).toEqual(['2026-09-28', '2026-10-18']); // anomaly
    expect(w(36, 36)).toEqual(['2027-02-01', '2027-02-07']); // visit 36 w
    expect(gaOn(EDD, d('2026-09-28'))).toEqual({ weeks: 18, days: 0, totalDays: 126 });
    expect(gaOn(EDD, d('2026-07-20'))).toMatchObject({ weeks: 8, days: 0 });
    const minBooking = addDays(dayZero(EDD), MIN_BOOKING_DAYS);
    expect(iso(minBooking)).toBe('2026-06-22');
    expect(gaOn(EDD, minBooking)).toMatchObject({ weeks: 4, days: 0 });
    const postDates = addDays(EDD, POST_DATES_DAYS);
    expect(iso(postDates)).toBe('2027-03-22');
    expect(gaOn(EDD, postDates)).toMatchObject({ weeks: 43, days: 0 });

    const plan = buildPlan({ bookedOn: '2026-07-20' });
    expect(windowOf(item(plan, 'scan_nt'))).toEqual(['2026-08-10', '2026-08-30']);
    expect(windowOf(item(plan, 'scan_anomaly'))).toEqual(['2026-09-28', '2026-10-18']);
    expect(windowOf(item(plan, 'visit_36'))).toEqual(['2027-02-01', '2027-02-07']);
    expect(windowOf(item(plan, 'visit_16'))).toEqual(['2026-09-07', '2026-09-27']);
    expect(windowOf(item(plan, 'visit_20'))).toEqual(['2026-10-05', '2026-10-25']);
    expect(windowOf(item(plan, 'visit_24'))).toEqual(['2026-11-09', '2026-11-29']);
    expect(windowOf(item(plan, 'visit_28'))).toEqual(['2026-12-07', '2026-12-27']);
  });

  it('counts completed weeks inclusively: "11–13 w" runs to 13 w 6 d', () => {
    expect(gaOn(EDD, weekEnd(EDD, 13))).toMatchObject({ weeks: 13, days: 6 });
    expect(gaOn(EDD, addDays(weekEnd(EDD, 13), 1))).toMatchObject({ weeks: 14, days: 0 });
    expect(gaOn(EDD, addDays(dayZero(EDD), -1))).toBeNull();
  });

  it('gaOn and weekStart are a round trip', () => {
    for (let n = 0; n <= 310; n += 1) {
      const date = addDays(dayZero(EDD), n);
      const ga = gaOn(EDD, date);
      expect(ga.totalDays).toBe(n);
      expect(iso(addDays(weekStart(EDD, ga.weeks), ga.days))).toBe(iso(date));
    }
  });

  it('LMP 1 Jun 2026 gives EDD 8 Mar 2027; a time of day is dropped; the scan EDD beats the LMP', async () => {
    const ids = { tenantId: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId() };
    const p = new Patient({ ...ids, mrn: 'P-1', careType: 'antenatal', fullName: 'Asha Sample', pregnancy: { lmp: new Date('2026-06-01T10:30:00Z') } });
    await p.validate();
    expect(p.pregnancy.lmp.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(iso(p.pregnancy.edd)).toBe('2027-03-08');
    expect(p.pregnancy.edd.toISOString()).toBe('2027-03-08T00:00:00.000Z');
    const f = planFacts(p);
    expect([iso(f.edd), f.eddSource]).toEqual(['2027-03-08', 'lmp']);
    const plan = buildPlan({ bookedOn: '2026-09-14', edd: f.edd });
    expect(windowOf(item(plan, 'scan_nt'))).toEqual(['2026-08-17', '2026-09-06']);
    expect(windowOf(item(plan, 'scan_anomaly'))).toEqual(['2026-10-05', '2026-10-25']);
    expect(gaOn(f.edd, d('2026-09-14'))).toMatchObject({ weeks: 15, days: 0 });

    p.pregnancy.scanEdd = new Date('2027-03-01T15:00:00Z');
    await p.validate();
    expect(p.pregnancy.effectiveEdd.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(planFacts(p)).toMatchObject({ edd: EDD, eddSource: 'scan' });
  });

  it("uses the hospital's date around midnight in India (UTC+5:30)", () => {
    expect(iso(hospitalToday(new Date('2026-10-18T18:29:00Z')))).toBe('2026-10-18'); // 23:59 IST
    expect(iso(hospitalToday(new Date('2026-10-18T18:31:00Z')))).toBe('2026-10-19'); // 00:01 IST
    expect(iso(hospitalToday(new Date('2026-10-18T19:00:00Z')))).toBe('2026-10-19');
    expect(iso(hospitalToday(new Date('2026-10-12T20:00:00Z')))).toBe('2026-10-13');
    expect(iso(hospitalToday(new Date('2026-10-18T19:00:00Z'), 'UTC'))).toBe('2026-10-18');
    expect(iso(toHospitalDate('2026-10-12T20:00:00Z'))).toBe('2026-10-13');
  });

  it('gives the same windows for an EDD stored with a time of day', () => {
    const clean = buildPlan({ bookedOn: '2026-07-20' });
    const timed = buildPlan({ bookedOn: '2026-07-20', edd: new Date('2027-03-01T13:45:00Z') });
    expect(timed.items.map((it) => [...windowOf(it), ...dueOf(it)])).toEqual(clean.items.map((it) => [...windowOf(it), ...dueOf(it)]));
    expect(planFacts(patient({ pregnancy: { effectiveEdd: new Date('2027-03-01T22:00:00Z') } })).edd).toEqual(EDD);
    expect(utcDay('2027-03-01T22:00:00Z')).toEqual(EDD);
  });

  it("gestationalAge uses the hospital's date at the midnight edge", () => {
    const p = { careType: 'antenatal', pregnancy: { effectiveEdd: EDD } };
    expect(gestationalAge(p, new Date('2026-09-27T18:29:00Z'))).toMatchObject({ weeks: 17, days: 6 });
    expect(gestationalAge(p, new Date('2026-09-27T18:31:00Z'))).toMatchObject({ weeks: 18, days: 0 });
    const timed = { careType: 'antenatal', pregnancy: { effectiveEdd: new Date('2027-03-01T20:00:00Z') } };
    expect(gestationalAge(timed, new Date('2026-09-27T18:31:00Z'))).toMatchObject({ weeks: 18, days: 0 });
    expect(gestationalAge({ pregnancy: { effectiveEdd: null } })).toBeNull();
  });
});

describe('2. at-booking items', () => {
  it('are due from the booking date for 14 days', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    for (const key of ['visit_booking', 'lab_cbc', 'vacc_td1', 'adv_danger']) {
      expect(dueOf(item(plan, key))).toEqual(['2026-07-20', '2026-08-02']);
      expect(item(plan, key).auto.dateSource).toBe('booking');
    }
  });

  // That the booking date defaults to the day the plan is built is a job of createPlan (tested in careplans.test.js).
  it('use the hospital date of the booking, not the UTC date', () => {
    const builtAt = new Date('2026-10-12T20:00:00Z'); // 13 Oct in India
    const plan = buildPlan({ bookedOn: iso(hospitalToday(builtAt)), at: builtAt });
    expect(dueOf(item(plan, 'lab_cbc'))).toEqual(['2026-10-13', '2026-10-26']);
  });
});

describe('3. status boundaries', () => {
  const plan = buildPlan({ bookedOn: '2026-07-20' });
  it('due on the last day, overdue the day after, upcoming the day before it starts', () => {
    expect(status(plan, 'scan_anomaly', '2026-09-27')).toBe('upcoming');
    expect(status(plan, 'scan_anomaly', '2026-09-28')).toBe('due');
    expect(status(plan, 'scan_anomaly', '2026-10-18')).toBe('due');
    expect(status(plan, 'scan_anomaly', '2026-10-19')).toBe('overdue');
  });

  it('follows the hospital date, not the UTC date', () => {
    expect(status(plan, 'scan_anomaly', hospitalToday(new Date('2026-10-18T19:00:00Z')))).toBe('overdue');
    expect(status(plan, 'scan_anomaly', hospitalToday(new Date('2026-10-18T18:29:00Z')))).toBe('due');
  });
});

describe('4. late start', () => {
  it('booking at 20 w 0 d (12 Oct 2026) – the worked example', () => {
    const plan = buildPlan({ bookedOn: '2026-10-12' });
    const T = '2026-10-12';
    expect(gaOn(EDD, d(T))).toMatchObject({ weeks: 20, days: 0 });
    for (const key of ['scan_nt', 'scan_dating', 'med_ifa', 'med_calcium']) {
      expect([key, item(plan, key).auto.lateStart, status(plan, key, T)]).toEqual([key, 'decide', 'decide']);
    }
    expect(item(plan, 'visit_16').auto.lateStart).toBe('lapsed');
    expect(status(plan, 'visit_16', T)).toBe('lapsed');
    expect(item(plan, 'visit_20').auto.lateStart).toBe('covered');
    expect(windowOf(item(plan, 'visit_20'))).toEqual(['2026-10-05', '2026-10-25']);
    expect(status(plan, 'visit_20', T)).toBe('lapsed');
    expect(windowOf(item(plan, 'scan_anomaly'))).toEqual(['2026-09-28', '2026-10-18']);
    expect(item(plan, 'scan_anomaly').auto.lateStart).toBeNull();
    expect(status(plan, 'scan_anomaly', T)).toBe('due');
    expect(status(plan, 'med_deworm', T)).toBe('due');
    expect(status(plan, 'vacc_flu', T)).toBe('due');
    for (const key of ['lab_cbc', 'lab_hiv', 'lab_group']) {
      expect(dueOf(item(plan, key))).toEqual(['2026-10-12', '2026-10-25']);
      expect(status(plan, key, T)).toBe('due');
    }
    // None of the lapsed, covered or decide items is overdue or on a reminder list. (The seventh is the advice for
    // twins, 12–16 weeks: its weeks have passed too, and it does not apply – twins are not ticked.)
    const late = plan.items.filter((it) => it.auto.lateStart);
    expect(late.length).toBe(7);
    expect(late.filter((it) => it.auto.applies === 'yes').length).toBe(6);
    for (const it of late) {
      expect(it.auto.listable).toBe(false);
      expect(itemStatus(plan, it, d('2027-01-01')).status).not.toBe('overdue');
    }
  });

  it('booking at 33 w 0 d (11 Jan 2027): advice is caught up, a visit is covered; per kind', () => {
    const plan = buildPlan({ bookedOn: '2027-01-11', facts: { ...LOW, rhNegative: 'yes' } });
    const T = '2027-01-11';
    expect(gaOn(EDD, d(T))).toMatchObject({ weeks: 33, days: 0 });
    const fmc = item(plan, 'adv_fmc');
    expect([fmc.auto.lateStart, fmc.auto.dateSource, ...dueOf(fmc)]).toEqual(['catch_up', 'catch_up', '2027-01-11', '2027-01-24']);
    expect(status(plan, 'adv_fmc', T)).toBe('due');
    expect(item(plan, 'visit_32').auto.lateStart).toBe('covered');
    expect(windowOf(item(plan, 'visit_32'))).toEqual(['2026-12-28', '2027-01-17']);
    expect(status(plan, 'visit_34', T)).toBe('upcoming');
    // What happens per kind when the window ended before booking
    const lateOf = (key) => item(plan, key).auto.lateStart;
    expect(lateOf('visit_24')).toBe(LATE_START.visit);
    expect(lateOf('lab_ogtt2')).toBe(LATE_START.investigation);
    expect(lateOf('scan_growth32')).toBe(LATE_START.scan);
    expect(lateOf('anti_d')).toBe(LATE_START.vaccination);
    expect(lateOf('med_ifa')).toBe(LATE_START.medication);
    expect(lateOf('adv_fmc')).toBe(LATE_START.advice);
    expect(LATE_START).toEqual({ visit: 'lapsed', advice: 'catch_up', medication: 'decide', investigation: 'decide', scan: 'decide', vaccination: 'decide' });
    expect(item(plan, 'lab_ogtt2').auto.lateFrom).toBe('booking');
    expect(status(plan, 'vacc_tdap', T)).toBe('due'); // 27–36 w is still open
  });

  it('booking at 16 w 3 d (17 Sep 2026): the 16-week visit is covered by the booking visit', () => {
    const plan = buildPlan({ bookedOn: '2026-09-17' });
    expect(gaOn(EDD, d('2026-09-17'))).toMatchObject({ weeks: 16, days: 3 });
    expect(windowOf(item(plan, 'visit_16'))).toEqual(['2026-09-07', '2026-09-27']);
    expect(item(plan, 'visit_16').auto.lateStart).toBe('covered');
    expect(item(plan, 'visit_16').auto.phase).toBe('lapsed');
    expect(dueOf(item(plan, 'visit_booking'))).toEqual(['2026-09-17', '2026-09-30']);
  });

  it('a window still open at booking (anomaly scan booked at 19 w) is simply due', () => {
    const plan = buildPlan({ bookedOn: '2026-10-05' });
    expect(item(plan, 'scan_anomaly').auto.lateStart).toBeNull();
    expect(status(plan, 'scan_anomaly', '2026-10-05')).toBe('due');
  });

  it('counts from the date an item was added (lateFrom "added"), and times fixed-date items as given', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    const custom = (over) => ({ origin: 'custom', appliesWhen: 'always', state: 'open', history: [], rev: 0, auto: {}, ...over });
    plan.items.push(
      custom({ key: 'custom_0a1b2c3d', kind: 'scan', name: 'Extra scan', timing: { fromWeek: 11, toWeek: 13 }, addedOn: d('2026-10-12') }),
      custom({ key: 'custom_1a2b3c4d', kind: 'visit', name: 'Review', timing: { fromWeek: 19, toWeek: 21 }, addedOn: d('2026-10-12') }),
      custom({ key: 'custom_2a3b4c5d', kind: 'investigation', name: 'Thyroid review', timing: { date: d('2026-11-02') }, addedOn: d('2026-10-12') }),
    );
    derivePlan(plan, LOW, { at: AT, newIds: new Set(['custom_0a1b2c3d', 'custom_1a2b3c4d', 'custom_2a3b4c5d']) });
    const late = item(plan, 'custom_0a1b2c3d');
    expect([late.auto.lateStart, late.auto.lateFrom, late.auto.phase]).toEqual(['decide', 'added', 'decide']);
    // A visit added later is not "covered by the booking visit": its window is still open when added.
    expect(item(plan, 'custom_1a2b3c4d').auto.lateStart).toBeNull();
    const fixed = item(plan, 'custom_2a3b4c5d');
    expect([fixed.auto.dateSource, ...dueOf(fixed), fixed.auto.windowFrom]).toEqual(['fixed', '2026-11-02', '2026-11-08', null]);
  });

  it('the covered and late-start boundaries, and advice added after its window is caught up from the date added', () => {
    // visit_16 runs 7–27 Sep 2026: a booking on its first or last day covers it; the day after, it has lapsed.
    for (const [bookedOn, late] of [['2026-09-06', null], ['2026-09-07', 'covered'], ['2026-09-27', 'covered'], ['2026-09-28', 'lapsed']]) {
      expect([bookedOn, item(buildPlan({ bookedOn }), 'visit_16').auto.lateStart]).toEqual([bookedOn, late]);
    }
    // The anomaly scan window ends 18 Oct 2026: booked that day it is due; booked the day after, a doctor decides.
    expect(status(buildPlan({ bookedOn: '2026-10-18' }), 'scan_anomaly', '2026-10-18')).toBe('due');
    const after = buildPlan({ bookedOn: '2026-10-19' });
    expect([item(after, 'scan_anomaly').auto.lateStart, status(after, 'scan_anomaly', '2026-10-19')]).toEqual(['decide', 'decide']);
    // Advice for 11–13 w added on 12 Oct (window over) is caught up from the date added, not the booking date.
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    plan.items.push({ key: 'custom_3a4b5c6d', origin: 'custom', kind: 'advice', name: 'Diet advice', appliesWhen: 'always', state: 'open', history: [], rev: 0, auto: {}, timing: { fromWeek: 11, toWeek: 13 }, addedOn: d('2026-10-12') });
    const res = derivePlan(plan, LOW, { at: AT, newIds: new Set(['custom_3a4b5c6d']) });
    const adv = item(plan, 'custom_3a4b5c6d');
    expect([adv.auto.lateStart, adv.auto.lateFrom, adv.auto.dateSource, ...dueOf(adv)]).toEqual(['catch_up', 'added', 'catch_up', '2026-10-12', '2026-10-25']);
    expect(status(plan, 'custom_3a4b5c6d', '2026-10-12')).toBe('due');
    // A new item is worked out for the first time: rev 0 and nothing for the plan log
    expect([adv.rev, res.retimed, res.nowApply]).toEqual([0, 0, []]);
  });
});

describe('5. missed visits', () => {
  it('visit_24 is overdue from 30 Nov and missed from 7 Dec 2026, when visit_28 starts', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    expect(status(plan, 'visit_24', '2026-11-29')).toBe('due');
    expect(status(plan, 'visit_24', '2026-11-30')).toBe('overdue');
    expect(status(plan, 'visit_24', '2026-12-06')).toBe('overdue');
    expect(gaOn(EDD, d('2026-12-07'))).toMatchObject({ weeks: 28, days: 0 });
    expect(status(plan, 'visit_24', '2026-12-07')).toBe('missed');
  });

  it('suggests visit_28 at 30 w 0 d (21 Dec 2026), never a missed visit, and counts the missed ones', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    const T = d('2026-12-21');
    expect(gaOn(EDD, T)).toMatchObject({ weeks: 30, days: 0 });
    const next = nextVisitSuggestion(plan, T);
    expect(next.visit).toMatchObject({ itemId: itemId(item(plan, 'visit_28')), name: 'Antenatal visit (28–30 weeks)', status: 'due' });
    expect(iso(next.visit.dueFrom)).toBe('2026-12-07');
    // booking visit, 16, 20 and 24 weeks
    expect(next.missedVisits).toBe(4);
    expect(next.alsoDue.every((a) => a.kind !== 'visit' && ['overdue', 'due', 'upcoming'].includes(a.status))).toBe(true);
    expect(next.alsoDue.map((a) => a.itemId)).toContain(itemId(item(plan, 'lab_hb28')));
  });

  it('an at-booking visit follows the same rule', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    expect(status(plan, 'visit_booking', '2026-08-03')).toBe('overdue');
    expect(status(plan, 'visit_booking', '2026-09-06')).toBe('overdue');
    expect(status(plan, 'visit_booking', '2026-09-07')).toBe('missed');
  });

  it('visit_37 is missed on 15 Feb 2027 and stays missed after visit_38 is attended on 16 Feb', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    expect(windowOf(item(plan, 'visit_37'))).toEqual(['2027-02-08', '2027-02-14']);
    expect(status(plan, 'visit_37', '2027-02-14')).toBe('due');
    expect(status(plan, 'visit_37', '2027-02-15')).toBe('missed');
    personDoes(plan, LOW, 'visit_38', markDone('2027-02-16'));
    expect(status(plan, 'visit_38', '2027-02-16')).toBe('done');
    expect(status(plan, 'visit_37', '2027-02-16')).toBe('missed');
    expect(nextVisitSuggestion(plan, d('2027-02-16')).visit.name).toBe('Antenatal visit (39 weeks)');
  });

  it('a later visit attended early also makes an earlier overdue visit missed', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    personDoes(plan, LOW, 'visit_28', markDone('2026-12-02'));
    expect(status(plan, 'visit_24', '2026-12-02')).toBe('missed');
  });
});

describe('6. items timed after another item', () => {
  const booked = () => buildPlan({ bookedOn: '2026-10-12' });

  it('wait for the first item, with an estimate never in the past; never overdue, never listed', () => {
    const plan = booked();
    const td2 = item(plan, 'vacc_td2');
    expect([td2.auto.phase, td2.auto.why, td2.auto.dueFrom, td2.auto.listable]).toEqual(['waiting', 'anchor_waiting', null, false]);
    expect(td2.auto.anchor).toEqual({ state: 'waiting', key: 'vacc_td1' });
    const at = (T) => itemStatus(plan, td2, d(T));
    expect(at('2026-10-12').status).toBe('waiting');
    expect(iso(at('2026-10-12').estimateFrom)).toBe('2026-11-09'); // Td-1 due from 12 Oct + 4 w
    expect(iso(at('2026-12-01').estimateFrom)).toBe('2026-12-29'); // today + 4 w (Td-1 is late)
    expect(at('2027-03-01').status).toBe('waiting');
  });

  it('are due from the first item\'s done date: Td-1 done 15 Oct 2026 → Td-2 due 12–25 Nov', () => {
    const plan = booked();
    personDoes(plan, LOW, 'vacc_td1', markDone('2026-10-15'));
    const td2 = item(plan, 'vacc_td2');
    expect([td2.auto.phase, td2.auto.dateSource, ...dueOf(td2), td2.auto.anchor]).toEqual(['open', 'after_done', '2026-11-12', '2026-11-25', null]);
    expect(td2.auto.listable).toBe(true);
    // Reopened → waiting again
    personDoes(plan, LOW, 'vacc_td1', (it) => Object.assign(it, { state: 'open', done: null }));
    expect(item(plan, 'vacc_td2').auto.phase).toBe('waiting');
  });

  it('need a check when the first item is not needed, missing, or in a loop (without hanging)', () => {
    const plan = booked();
    personDoes(plan, LOW, 'vacc_td1', (it) => Object.assign(it, { state: 'not_needed', notNeeded: { reasonCode: 'covered', reason: '', ...actor() } }));
    expect([item(plan, 'vacc_td2').auto.phase, item(plan, 'vacc_td2').auto.why]).toEqual(['check', 'anchor_not_needed']);

    const t = (key, afterKey) => ({ key, kind: 'vaccination', name: key, after: { key: afterKey, weeks: 4 } });
    const odd = buildPlan({ bookedOn: '2026-10-12', items: [t('a', 'b'), t('b', 'a'), t('self', 'self'), t('lost', 'nowhere'), t('into_loop', 'a')] });
    expect(odd.items.map((it) => [it.key, it.auto.phase, it.auto.why])).toEqual([
      ['a', 'check', 'timing_loop'],
      ['b', 'check', 'timing_loop'],
      ['self', 'check', 'timing_loop'],
      ['lost', 'check', 'anchor_missing'],
      ['into_loop', 'check', 'timing_loop'],
    ]);
    expect(itemStatus(odd, odd.items[0], d('2026-10-12')).status).toBe('check_needed');
  });

  it("inherit 'does not apply' from the first item; an included first item makes them apply", () => {
    const draft = (key) => ANTENATAL_DRAFT.items.find((t) => t.key === key);
    const second = { key: 'anti_d_2', kind: 'vaccination', name: 'Anti-D – second dose', after: { key: 'anti_d', weeks: 4 } };
    const plan = buildPlan({ bookedOn: '2026-07-20', items: [second, draft('anti_d')] }); // listed before its anchor
    expect([item(plan, 'anti_d_2').auto.phase, item(plan, 'anti_d_2').auto.why, item(plan, 'anti_d_2').auto.applies]).toEqual(['not_applicable', 'only_rh_negative', 'no']);
    personDoes(plan, LOW, 'anti_d', (it) => {
      it.forceInclude = { reason: "Doctor's decision", ...actor() };
      it.staffBasis = staffBasis(plan, it, AT);
    });
    expect([item(plan, 'anti_d_2').auto.applies, item(plan, 'anti_d_2').auto.phase]).toEqual(['yes', 'waiting']);
    // Unknown blood group: the second item needs a check too, and says why
    const unknown = buildPlan({ bookedOn: '2026-07-20', items: [second, draft('anti_d')], facts: { ...LOW, rhNegative: 'unknown' } });
    expect([item(unknown, 'anti_d_2').auto.phase, item(unknown, 'anti_d_2').auto.why]).toEqual(['check', 'rh_unknown']);
  });

  it('an item included on its own waits for its first item, even when the first item does not apply', () => {
    const draft = (key) => ANTENATAL_DRAFT.items.find((t) => t.key === key);
    const second = { key: 'anti_d_2', kind: 'vaccination', name: 'Anti-D – second dose', after: { key: 'anti_d', weeks: 4 } };
    const plan = buildPlan({ bookedOn: '2026-07-20', items: [draft('anti_d'), second] });
    personDoes(plan, LOW, 'anti_d_2', (it) => {
      it.forceInclude = { reason: "Doctor's decision", ...actor() };
      it.staffBasis = staffBasis(plan, it, AT);
    });
    const d2 = item(plan, 'anti_d_2');
    expect(d2.staffBasis.applies).toBe('no');
    expect([d2.auto.phase, d2.auto.why, d2.auto.listable, d2.auto.dueFrom]).toEqual(['waiting', 'anchor_waiting', false, null]);
    const st = itemStatus(plan, d2, d('2026-10-12'));
    expect([st.status, iso(st.estimateFrom)]).toEqual(['waiting', '2027-01-04']); // anti-D from 7 Dec + 4 w
    // The first item is given after all: the second is due 4 weeks later, and its rev goes up (re-timed)
    const res = personDoes(plan, LOW, 'anti_d', markDone('2026-10-10'));
    expect([d2.auto.phase, d2.auto.dateSource, ...dueOf(d2), d2.auto.listable]).toEqual(['open', 'after_done', '2026-11-07', '2026-11-20', true]);
    expect([d2.rev, d2.revByName, res.retimed]).toEqual([2, PERSON, 1]);
  });

  it('work through chains in dependency order', () => {
    const items = [
      { key: 'c', kind: 'vaccination', name: 'c', after: { key: 'b', weeks: 2 } },
      { key: 'b', kind: 'vaccination', name: 'b', after: { key: 'a', weeks: 4 } },
      { key: 'a', kind: 'vaccination', name: 'a', atBooking: true },
    ];
    const plan = buildPlan({ bookedOn: '2026-10-12', items });
    personDoes(plan, LOW, 'a', markDone('2026-10-15'));
    expect(dueOf(item(plan, 'b'))).toEqual(['2026-11-12', '2026-11-25']);
    expect(item(plan, 'c').auto.phase).toBe('waiting');
    expect(iso(itemStatus(plan, item(plan, 'c'), d('2026-10-20')).estimateFrom)).toBe('2026-11-26'); // b from 12 Nov + 2 w
  });
});

describe('7. applicability', () => {
  const f = (over) => planFacts(patient(over));

  it('high risk: override first, then the level; incomplete or "may be higher" is unknown', () => {
    expect(f({ risk: { level: 'low', override: { level: 'high' } } }).highRisk).toBe('yes');
    expect(f({ risk: { level: 'high', override: { level: 'low' } } }).highRisk).toBe('no');
    expect(f({ risk: { level: 'high', override: { level: 'moderate' } } }).highRisk).toBe('no');
    expect(f({ risk: { level: 'high' } }).highRisk).toBe('yes');
    expect(f({ risk: { level: 'low' } }).highRisk).toBe('no');
    expect(f({ risk: { level: 'moderate' } }).highRisk).toBe('no');
    expect(f({ risk: { level: 'moderate', mayBeHigher: true } }).highRisk).toBe('unknown');
    expect(f({ risk: { level: 'incomplete' } }).highRisk).toBe('unknown');
    expect(f({ risk: null }).highRisk).toBe('unknown');
    expect(ruleFor('high_risk', f({ risk: { level: 'moderate', mayBeHigher: true } }))).toEqual({ rule: 'unknown', why: 'risk_may_be_higher' });
    expect(ruleFor('high_risk', f({ risk: { level: 'incomplete' } }))).toEqual({ rule: 'unknown', why: 'risk_incomplete' });
    expect(ruleFor('high_risk', f({ risk: { level: 'low' } }))).toEqual({ rule: 'no', why: 'only_high_risk' });
  });

  it('Rh-negative, previous caesarean, diabetes and hypertension', () => {
    expect(ruleFor('rh_negative', f({ medical: { allergies: 'None known', bloodGroup: 'O-' } })).rule).toBe('yes');
    expect(ruleFor('rh_negative', f({ medical: { allergies: 'None known', bloodGroup: 'B+' } }))).toEqual({ rule: 'no', why: 'only_rh_negative' });
    expect(ruleFor('rh_negative', f({ medical: { allergies: 'None known', bloodGroup: '' } }))).toEqual({ rule: 'unknown', why: 'rh_unknown' });

    expect(ruleFor('previous_caesarean', f({ obstetric: { previousCaesareans: 1 } })).rule).toBe('yes');
    expect(ruleFor('previous_caesarean', f({ obstetric: { previousCaesareans: 0 } }))).toEqual({ rule: 'no', why: 'only_previous_caesarean' });
    // A first pregnancy has had no caesarean, even when the count was left empty
    expect(ruleFor('previous_caesarean', f({ obstetric: { gravida: 1, para: 0, previousCaesareans: null } })).rule).toBe('no');
    expect(ruleFor('previous_caesarean', f({ obstetric: { gravida: 2, previousCaesareans: null } }))).toEqual({ rule: 'unknown', why: 'caesareans_unknown' });

    for (const c of ['diabetes', 'hypertension']) {
      expect(ruleFor(c, f({ medical: { allergies: 'None known', conditions: [c] } })).rule).toBe('yes');
      expect(ruleFor(c, f({ medical: { allergies: 'None known', conditions: [], conditionsReviewed: true } }))).toEqual({ rule: 'no', why: `only_${c}` });
      // Nothing ticked and not confirmed: not known
      expect(ruleFor(c, f({ medical: { allergies: 'None known', conditions: [], conditionsReviewed: false } }))).toEqual({ rule: 'unknown', why: 'conditions_unconfirmed' });
      expect(ruleFor(c, f({ medical: { allergies: 'None known', conditions: ['thyroid'], conditionsReviewed: false } })).rule).toBe('no');
    }
    expect(ruleFor('always', f({ medical: { allergies: 'None known', bloodGroup: '' }, risk: null }))).toEqual({ rule: 'yes', why: null });
  });

  it('works out the basis key from the facts', () => {
    expect(f({}).basisKey).toBe('e2|antenatal|2027-03-01|hr:no|rh:no|cs:no|dm:no|ht:no|pf:-');
    expect(f({ pregnancy: { effectiveEdd: null }, medical: { allergies: 'None known', bloodGroup: 'O-' }, risk: null }).basisKey).toBe('e2|antenatal|none|hr:unknown|rh:yes|cs:no|dm:no|ht:no|pf:-');
    // findings ticked for this pregnancy are part of the key (in a fixed order)
    expect(f({ pregnancy: { effectiveEdd: EDD, findings: [found('multiple'), found('gdm')] } }).basisKey).toBe('e2|antenatal|2027-03-01|hr:no|rh:no|cs:no|dm:no|ht:no|pf:gdm,multiple');
  });

  it('findings ticked for this pregnancy: yes or no, never unknown; an unticked or earlier-pregnancy one does not count', () => {
    const CONDITION = { gdm: 'gdm', hypertension: 'pregnancy_hypertension', multiple: 'multiple_pregnancy', placenta_praevia: 'placenta_praevia', bleeding: 'bleeding' };
    for (const [finding, appliesWhen] of Object.entries(CONDITION)) {
      const with1 = f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding)] } });
      expect([finding, ruleFor(appliesWhen, with1)]).toEqual([finding, { rule: 'yes', why: null }]);
      // the other findings stay "no", and nothing ticked is "no" even when the conditions were never confirmed
      for (const other of Object.values(CONDITION).filter((c) => c !== appliesWhen)) expect(ruleFor(other, with1)).toEqual({ rule: 'no', why: `only_${other}` });
      expect(ruleFor(appliesWhen, f({ medical: { allergies: 'None known', conditions: [], conditionsReviewed: false }, risk: null }))).toEqual({ rule: 'no', why: `only_${appliesWhen}` });
      // unticked (ended): kept on the record, no longer counted
      expect(ruleFor(appliesWhen, f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding, { endedAt: AT, endedByName: PERSON })] } })).rule).toBe('no');
      // recorded before this pregnancy began (EDD 1 Mar 2027: counted from 11 May 2026)
      expect(ruleFor(appliesWhen, f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding, { at: new Date('2026-05-10T06:00:00Z') })] } })).rule).toBe('no');
      expect(ruleFor(appliesWhen, f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding, { at: new Date('2026-05-11T06:00:00Z') })] } })).rule).toBe('yes');
    }
    // facts worked out before findings existed (no such fact) read as "no", never "check needed"
    expect(ruleFor('gdm', LOW)).toEqual({ rule: 'no', why: 'only_gdm' });
  });

  it('"any diabetes" and "any high blood pressure": the pre-existing condition or the finding in this pregnancy', () => {
    const cases = [
      ['diabetes_any', 'diabetes', 'gdm'],
      ['hypertension_any', 'hypertension', 'hypertension'],
    ];
    for (const [appliesWhen, condition, finding] of cases) {
      expect(ruleFor(appliesWhen, f({ medical: { allergies: 'None known', conditions: [condition] } })).rule).toBe('yes');
      expect(ruleFor(appliesWhen, f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding)] } })).rule).toBe('yes');
      // the finding is enough even when the pre-existing conditions were never confirmed
      expect(ruleFor(appliesWhen, f({ medical: { allergies: 'None known', conditions: [], conditionsReviewed: false }, pregnancy: { effectiveEdd: EDD, findings: [found(finding)] } })).rule).toBe('yes');
      expect(ruleFor(appliesWhen, f({}))).toEqual({ rule: 'no', why: `only_${appliesWhen}` });
      expect(ruleFor(appliesWhen, f({ medical: { allergies: 'None known', conditions: [], conditionsReviewed: false } }))).toEqual({ rule: 'unknown', why: 'conditions_unconfirmed' });
      // the pre-existing-only conditions keep their meaning: the finding alone does not switch them on
      expect(ruleFor(condition, f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding)] } }))).toEqual({ rule: 'no', why: `only_${condition}` });
    }
  });

  it("after delivery the mother's plan still knows the findings of the pregnancy that just ended; a baby's record has none", () => {
    // delivered on 20 Feb 2027; the pregnancy's dates stay on her record (EDD 1 Mar 2027)
    const mother = { ...patient({ pregnancy: { effectiveEdd: EDD, findings: [found('gdm'), found('hypertension', { endedAt: AT, endedByName: PERSON })] } }), careType: 'postnatal', lastDelivery: { at: new Date('2027-02-20T05:00:00Z'), mode: 'normal' } };
    const facts = planFacts(mother, new Date('2027-02-25T06:00:00Z'), { careType: 'postnatal' });
    expect(ruleFor('gdm', facts).rule).toBe('yes');
    expect(ruleFor('diabetes_any', facts).rule).toBe('yes');
    expect(ruleFor('diabetes', facts)).toEqual({ rule: 'no', why: 'only_diabetes' }); // pre-existing only, as before
    expect(ruleFor('pregnancy_hypertension', facts).rule).toBe('no'); // unticked during the pregnancy
    expect(facts.basisKey).toMatch(/^e2\|postnatal\|2027-02-20\|.*\|pf:gdm$/);
    const baby = { careType: 'newborn', createdAt: AT, newborn: { birthAt: new Date('2027-02-20T05:00:00Z') }, medical: { bloodGroup: 'B+' }, obstetric: {} };
    expect(ruleFor('gdm', planFacts(baby, new Date('2027-02-25T06:00:00Z'), { careType: 'newborn' }))).toEqual({ rule: 'no', why: 'only_gdm' });
  });

  it('an item for a finding switches on when the finding is ticked, and off again when it is unticked', () => {
    const items = [
      { key: 'visit', kind: 'visit', name: 'Visit', atBooking: true },
      { key: 'gdm_scan', kind: 'scan', name: 'Growth scan (GDM)', fromWeek: 28, toWeek: 30, appliesWhen: 'gdm' },
    ];
    const before = f({});
    const plan = buildPlan({ bookedOn: '2026-07-20', items, facts: before });
    expect([item(plan, 'gdm_scan').auto.phase, item(plan, 'gdm_scan').auto.why]).toEqual(['not_applicable', 'only_gdm']);
    const ticked = f({ pregnancy: { effectiveEdd: EDD, findings: [found('gdm')] } });
    const on = derivePlan(plan, ticked, { at: AT });
    expect(on.nowApply).toEqual([itemId(item(plan, 'gdm_scan'))]);
    expect([item(plan, 'gdm_scan').auto.phase, item(plan, 'gdm_scan').auto.applies, item(plan, 'gdm_scan').rev]).toEqual(['open', 'yes', 1]);
    expect(dueOf(item(plan, 'gdm_scan'))).toEqual(['2026-12-07', '2026-12-27']); // 28 w 0 d to 30 w 6 d
    const off = derivePlan(plan, before, { at: AT });
    expect(off.noLongerApply).toEqual([itemId(item(plan, 'gdm_scan'))]);
    expect(item(plan, 'gdm_scan').auto.phase).toBe('not_applicable');
  });

  it('the built-in items for findings do not apply until their finding is ticked', () => {
    const keys = { multiple: ['scan_twins_24', 'scan_twins_28', 'scan_twins_32'], gdm: ['scan_growth_gdm'], placenta_praevia: ['scan_placenta_32'] };
    const none = buildPlan({ bookedOn: '2026-07-20', facts: f({}) });
    for (const key of Object.values(keys).flat()) expect([key, item(none, key).auto.phase]).toEqual([key, 'not_applicable']);
    for (const [finding, itemKeys] of Object.entries(keys)) {
      const plan = buildPlan({ bookedOn: '2026-07-20', facts: f({ pregnancy: { effectiveEdd: EDD, findings: [found(finding)] } }) });
      for (const key of Object.values(keys).flat()) expect([finding, key, item(plan, key).auto.phase]).toEqual([finding, key, itemKeys.includes(key) ? 'open' : 'not_applicable']);
    }
    // every built-in item for a finding is marked for the doctor to confirm, with its source
    for (const key of Object.values(keys).flat()) expect(ANTENATAL_DRAFT.items.find((t) => t.key === key).source).toMatch(/doctor to confirm/);
  });

  it("a finding ticked after an item's weeks have passed counts like an item added late: for the doctor to decide, never overdue at once", () => {
    const items = [
      { key: 'visit', kind: 'visit', name: 'Visit', atBooking: true },
      { key: 'gdm_scan', kind: 'scan', name: 'Growth scan (GDM)', fromWeek: 28, toWeek: 30, appliesWhen: 'gdm' },
      { key: 'gdm_visit', kind: 'visit', name: 'Diabetes review', fromWeek: 8, toWeek: 9, appliesWhen: 'gdm' },
      { key: 'gdm_advice', kind: 'advice', name: 'Diet advice', fromWeek: 12, toWeek: 16, appliesWhen: 'gdm' },
      { key: 'sugar_any', kind: 'investigation', name: 'Sugar profile', fromWeek: 24, toWeek: 26, appliesWhen: 'diabetes_any' },
    ];
    const plan = buildPlan({ bookedOn: '2026-07-20', items, facts: f({}) }); // booked at 8 w 0 d
    // GDM is ticked at 32 w 0 d (4 Jan 2027): the scan's weeks (28–30) have passed
    const at = new Date('2027-01-04T06:00:00Z');
    const facts = planFacts(patient({ pregnancy: { effectiveEdd: EDD, findings: [found('gdm', { at })] } }), at);
    expect(facts.appliesSince).toEqual({ gdm: d('2027-01-04'), diabetes_any: d('2027-01-04') });
    derivePlan(plan, facts, { at });
    const scan = item(plan, 'gdm_scan');
    expect([scan.auto.applies, scan.auto.lateStart, scan.auto.lateFrom, scan.auto.phase]).toEqual(['yes', 'decide', 'finding', 'decide']);
    expect(status(plan, 'gdm_scan', '2027-01-04')).toBe('decide'); // not "overdue"
    expect(windowOf(scan)).toEqual(['2026-12-07', '2026-12-27']); // the guideline window is still shown
    // a visit whose weeks had passed is "passed" – not "covered by the booking visit" (it did not apply then)
    expect([item(plan, 'gdm_visit').auto.lateStart, item(plan, 'gdm_visit').auto.lateFrom, item(plan, 'gdm_visit').auto.phase]).toEqual(['lapsed', 'finding', 'lapsed']);
    // advice catches up from the day the finding was ticked
    const adv = item(plan, 'gdm_advice');
    expect([adv.auto.lateStart, adv.auto.lateFrom, ...dueOf(adv)]).toEqual(['catch_up', 'finding', '2027-01-04', '2027-01-17']);
    expect([item(plan, 'sugar_any').auto.phase, item(plan, 'sugar_any').auto.lateFrom]).toEqual(['decide', 'finding']);

    // ticked in time (26 w 0 d): the item is simply open and upcoming
    const early = new Date('2026-11-23T06:00:00Z');
    const inTime = buildPlan({ bookedOn: '2026-07-20', items, facts: f({}) });
    derivePlan(inTime, planFacts(patient({ pregnancy: { effectiveEdd: EDD, findings: [found('gdm', { at: early })] } }), early), { at: early });
    expect([item(inTime, 'gdm_scan').auto.lateStart, item(inTime, 'gdm_scan').auto.phase, status(inTime, 'gdm_scan', '2026-11-23')]).toEqual([null, 'open', 'upcoming']);
    // "any diabetes" with diabetes known before the pregnancy has no such date: it applied from the start
    const chronic = planFacts(patient({ medical: { allergies: 'None known', conditions: ['diabetes'] }, pregnancy: { effectiveEdd: EDD, findings: [found('gdm', { at })] } }), at);
    expect(chronic.appliesSince).toEqual({ gdm: d('2027-01-04') });
    // a plan booked after the finding counts from the booking, as before
    const lateBooked = buildPlan({ bookedOn: '2027-01-11', items, facts, at: new Date('2027-01-11T06:00:00Z') });
    expect([item(lateBooked, 'gdm_scan').auto.lateStart, item(lateBooked, 'gdm_scan').auto.lateFrom]).toEqual(['decide', 'booking']);
    // an unticked finding leaves no date behind
    expect(f({ pregnancy: { effectiveEdd: EDD, findings: [found('gdm', { endedAt: AT, endedByName: PERSON })] } }).appliesSince).toEqual({});
  });

  it('names the ticked findings a plan has no items for, although the template it was built from has them now', () => {
    const old = [
      { key: 'visit', kind: 'visit', name: 'Visit', atBooking: true },
      { key: 'sugar', kind: 'investigation', name: 'Sugar test', fromWeek: 24, toWeek: 28, appliesWhen: 'diabetes' },
    ];
    const plan = buildPlan({ bookedOn: '2026-07-20', items: old, facts: f({}) });
    // the template now: the sugar test is for any diabetes, and there is a scan for twins
    const now = { _id: 't1', name: 'Standard', kind: 'standard', version: 2, items: [old[0], { ...old[1], appliesWhen: 'diabetes_any' }, { key: 'twins', kind: 'scan', name: 'Twin scan', fromWeek: 24, toWeek: 25, appliesWhen: 'multiple_pregnancy' }] };
    const she = (findings) => patient({ pregnancy: { effectiveEdd: EDD, findings } });
    expect(findingsWithoutPlanItems(plan, now, she([]), AT)).toEqual([]);
    // bleeding is ticked too, but the template has no item for it: there is nothing to update to
    expect(findingsWithoutPlanItems(plan, now, she([found('multiple'), found('gdm'), found('bleeding')]), AT)).toEqual(['gdm', 'multiple']);
    expect(findingsWithoutPlanItems(plan, { items: old }, she([found('multiple')]), AT)).toEqual([]); // the template is as the plan
    expect(findingsWithoutPlanItems(plan, null, she([found('multiple')]), AT)).toEqual([]); // the template is gone
    expect(findingsWithoutPlanItems(plan, now, she([found('multiple', { endedAt: AT, endedByName: PERSON })]), AT)).toEqual([]); // unticked
    // after the plan was updated to the template, nothing is left to say
    const both = [found('multiple'), found('gdm')];
    mergeTemplate(plan, now, { at: AT, actor: { id: null, name: PERSON }, facts: planFacts(she(both), AT) });
    expect(findingsWithoutPlanItems(plan, now, she(both), AT)).toEqual([]);
    expect([item(plan, 'sugar').auto.applies, item(plan, 'twins').auto.applies]).toEqual(['yes', 'yes']);
  });

  it('the built-in postnatal checks follow the findings of the pregnancy: sugar test after GDM, BP check after high blood pressure', () => {
    expect(POSTNATAL_DRAFT.items.find((t) => t.key === 'pnc_sugar').appliesWhen).toBe('diabetes_any');
    expect(POSTNATAL_DRAFT.items.find((t) => t.key === 'pnc_bp').appliesWhen).toBe('hypertension_any');
    const delivered = { careType: 'postnatal', lastDelivery: { at: new Date('2027-02-20T05:00:00Z'), mode: 'normal' } };
    const at = new Date('2027-02-25T06:00:00Z');
    const factsOf = (findings) => planFacts({ ...patient({ pregnancy: { effectiveEdd: EDD, findings } }), ...delivered }, at, { careType: 'postnatal' });
    const applies = (findings, key) => ruleFor(POSTNATAL_DRAFT.items.find((t) => t.key === key).appliesWhen, factsOf(findings));
    expect(applies([found('gdm')], 'pnc_sugar').rule).toBe('yes');
    expect(applies([found('hypertension')], 'pnc_bp').rule).toBe('yes');
    expect(applies([found('gdm')], 'pnc_bp')).toEqual({ rule: 'no', why: 'only_hypertension_any' });
    expect(applies([], 'pnc_sugar')).toEqual({ rule: 'no', why: 'only_diabetes_any' });
    // the built-in antenatal draft itself has no item left on the pre-existing-only conditions
    expect([...ANTENATAL_DRAFT.items, ...POSTNATAL_DRAFT.items].filter((t) => ['diabetes', 'hypertension'].includes(t.appliesWhen))).toEqual([]);
  });

  it('shows items that depend on unknown facts as "check needed", and high-risk items as risk-based', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20', facts: { ...LOW, rhNegative: 'unknown', highRisk: 'unknown' } });
    for (const key of ['lab_ict1', 'lab_ict28', 'anti_d']) expect([key, item(plan, key).auto.phase, item(plan, key).auto.why]).toEqual([key, 'check', 'rh_unknown']);
    expect([item(plan, 'scan_doppler').auto.phase, item(plan, 'scan_doppler').auto.why, item(plan, 'scan_doppler').auto.riskBased]).toEqual(['check', 'risk_incomplete', true]);
    expect(item(plan, 'lab_cbc').auto.riskBased).toBe(false);
  });

  it('"Include anyway" makes an item apply; "no longer indicated" only when the rule changed after the action', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20', facts: { ...LOW, rhNegative: 'unknown' } });
    const include = (it) => {
      it.forceInclude = { reason: "Doctor's decision", ...actor() };
      it.staffBasis = staffBasis(plan, it, AT);
    };
    personDoes(plan, { ...LOW, rhNegative: 'unknown' }, 'anti_d', include);
    expect([item(plan, 'anti_d').auto.phase, item(plan, 'anti_d').auto.applies, item(plan, 'anti_d').auto.flags]).toEqual(['open', 'unknown', []]);
    // The blood group turns out Rh-positive AFTER the doctor included it
    derivePlan(plan, LOW, { at: AT });
    const antiD = item(plan, 'anti_d');
    expect([antiD.auto.phase, antiD.auto.why, antiD.auto.flags]).toEqual(['check', 'no_longer_indicated', ['no_longer_indicated']]);

    // Included while the rule was already 'no': not flagged
    const plan2 = buildPlan({ bookedOn: '2026-07-20' });
    personDoes(plan2, LOW, 'anti_d', (it) => {
      it.forceInclude = { reason: 'GDM in this pregnancy', ...actor() };
      it.staffBasis = staffBasis(plan2, it, AT);
    });
    expect([item(plan2, 'anti_d').auto.phase, item(plan2, 'anti_d').auto.flags]).toEqual(['open', []]);
  });

  it('Rh corrected to positive: unmoved items no longer apply (notes kept), a moved one needs a check, a done one stays done', () => {
    const RH = { ...LOW, rhNegative: 'yes' };
    const plan = buildPlan({ bookedOn: '2026-07-20', facts: RH });
    personDoes(plan, RH, 'lab_ict28', (it) => (it.note = { text: 'Ask about previous anti-D', ...actor() }));
    personDoes(plan, RH, 'anti_d', moveTo(plan, '2026-12-09', '2026-12-15'));
    personDoes(plan, RH, 'lab_ict1', markDone('2026-07-21'));
    const res = derivePlan(plan, LOW, { at: AT });
    expect(item(plan, 'lab_ict28').auto.phase).toBe('not_applicable');
    expect(item(plan, 'lab_ict28').note.text).toBe('Ask about previous anti-D');
    expect([item(plan, 'anti_d').auto.phase, item(plan, 'anti_d').auto.why]).toEqual(['check', 'no_longer_indicated']);
    expect([item(plan, 'lab_ict1').auto.phase, item(plan, 'lab_ict1').auto.applies, item(plan, 'lab_ict1').state]).toEqual(['done', 'no', 'done']);
    expect(res.noLongerApply.sort()).toEqual(['anti_d', 'lab_ict28'].sort());
    // O− again: they apply again (log "items now apply")
    expect(derivePlan(plan, RH, { at: AT }).nowApply.sort()).toEqual(['anti_d', 'lab_ict28'].sort());
  });

  it('O− entered at 32 w: the Rh items apply, and windows that closed after booking are overdue', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20', facts: { ...LOW, rhNegative: 'unknown' } });
    const T = '2027-01-04';
    expect(gaOn(EDD, d(T))).toMatchObject({ weeks: 32, days: 0 });
    const res = derivePlan(plan, { ...LOW, rhNegative: 'yes' }, { at: new Date('2027-01-04T06:00:00Z') });
    expect(res.nowApply.sort()).toEqual(['anti_d', 'lab_ict1', 'lab_ict28']);
    for (const key of ['lab_ict1', 'lab_ict28', 'anti_d']) {
      expect([key, item(plan, key).auto.phase, item(plan, key).auto.lateStart, status(plan, key, T)]).toEqual([key, 'open', null, 'overdue']);
    }
  });

  it('risk override high → low → high: the Doppler scan stops applying (or needs a check if moved) and comes back with its note and date', () => {
    const H = { ...LOW, highRisk: 'yes' };
    const plan = buildPlan({ bookedOn: '2026-07-20', facts: H });
    const doppler = () => item(plan, 'scan_doppler');
    personDoes(plan, H, 'scan_doppler', (it) => (it.note = { text: 'Check cord flow', ...actor() }));
    // Not moved: does not apply, then applies again with its window dates
    expect(derivePlan(plan, LOW, { at: AT }).noLongerApply).toEqual(['scan_doppler']);
    expect([doppler().auto.phase, doppler().auto.why]).toEqual(['not_applicable', 'only_high_risk']);
    expect(derivePlan(plan, H, { at: AT }).nowApply).toEqual(['scan_doppler']);
    expect([doppler().auto.phase, doppler().auto.dateSource, doppler().note.text]).toEqual(['open', 'window', 'Check cord flow']);
    // Moved while high risk: needs a check when the risk goes down, then applies again on the doctor's date
    personDoes(plan, H, 'scan_doppler', moveTo(plan, '2027-01-25', '2027-01-31'));
    derivePlan(plan, LOW, { at: AT });
    expect([doppler().auto.phase, doppler().auto.why]).toEqual(['check', 'no_longer_indicated']);
    derivePlan(plan, H, { at: AT });
    expect([doppler().auto.phase, doppler().auto.flags, doppler().auto.dateSource, ...dueOf(doppler())]).toEqual(['open', [], 'manual', '2027-01-25', '2027-01-31']);
    expect([doppler().note.text, iso(doppler().manualDate.dueFrom)]).toEqual(['Check cord flow', '2027-01-25']);
  });
});

describe('8. EDD changes', () => {
  it('7 days earlier: re-timed; moved items get "check date" (and "outside window"); done items unchanged', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    personDoes(plan, LOW, 'scan_anomaly', moveTo(plan, '2026-10-12', '2026-10-18'));
    personDoes(plan, LOW, 'lab_cbc', markDone('2026-07-20'));
    expect(item(plan, 'scan_anomaly').auto.flags).toEqual([]);
    const doneBefore = structuredClone(item(plan, 'lab_cbc').done);

    const newEdd = d('2027-02-22');
    plan.basis.edd = newEdd;
    const res = derivePlan(plan, { ...LOW, edd: newEdd }, { at: AT });
    expect(windowOf(item(plan, 'scan_nt'))).toEqual(['2026-08-03', '2026-08-23']);
    const anomaly = item(plan, 'scan_anomaly');
    expect(windowOf(anomaly)).toEqual(['2026-09-21', '2026-10-11']);
    expect([...dueOf(anomaly), anomaly.auto.dateSource]).toEqual(['2026-10-12', '2026-10-18', 'manual']);
    expect(anomaly.auto.flags).toEqual(['check_date', 'outside_window']);
    expect(item(plan, 'lab_cbc').done).toEqual(doneBefore);
    expect(item(plan, 'lab_cbc').state).toBe('done');
    expect(res.checkDate).toBe(1);
    expect(res.retimed).toBeGreaterThan(20);
  });

  it('200 days: on hold and nothing listable until the decision; reverting clears it', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    const before = plan.items.map((it) => structuredClone(it.auto));
    plan.eddReview = { fromEdd: EDD, toEdd: addDays(EDD, 200), detectedAt: AT };
    derivePlan(plan, { ...LOW, edd: addDays(EDD, 200) }, { at: AT });
    expect(plan.items.some((it) => it.auto.listable)).toBe(false);
    plan.items.forEach((it, i) => {
      if (before[i].phase === 'open') expect(it.auto.phase).toBe('on_hold');
    });
    expect(itemStatus(plan, item(plan, 'lab_cbc'), d('2026-12-01')).status).toBe('on_hold');
    plan.eddReview = null;
    derivePlan(plan, LOW, { at: AT });
    expect(plan.items.map((it) => it.auto)).toEqual(before);
  });
});

describe('9. rev rule', () => {
  it('raises the rev only when what a person sees changes; idempotent; not twice for changed items', () => {
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    expect(plan.items.every((it) => it.rev === 0)).toBe(true); // building the plan is not a change
    const again = derivePlan(plan, LOW, { at: new Date('2026-10-13T06:00:00Z') });
    expect(again).toEqual({ nowApply: [], noLongerApply: [], retimed: 0, checkDate: 0, changed: false });
    expect(plan.basis.syncedAt).toEqual(AT); // nothing changed, so no new sync time

    const later = new Date('2026-10-14T06:00:00Z');
    derivePlan(plan, { ...LOW, rhNegative: 'yes' }, { at: later, actorName: 'Automatic' });
    expect(item(plan, 'lab_ict1')).toMatchObject({ rev: 1, revByName: 'Automatic', revAt: later });
    expect(item(plan, 'lab_cbc').rev).toBe(0);
    expect(plan.basis.syncedAt).toEqual(later);
    derivePlan(plan, { ...LOW, rhNegative: 'yes' }, { at: later });
    expect(item(plan, 'lab_ict1').rev).toBe(1);

    // A person's action raises the rev once; the derive that follows does not raise it again
    personDoes(plan, { ...LOW, rhNegative: 'yes' }, 'lab_ict1', markDone('2026-10-14'));
    expect(item(plan, 'lab_ict1')).toMatchObject({ rev: 2, revByName: PERSON });
  });

  it('a change to the reason alone (not a watched field) leaves the rev as it was', () => {
    const facts = { ...LOW, highRisk: 'unknown' };
    const plan = buildPlan({ bookedOn: '2026-07-20', facts });
    expect(item(plan, 'scan_doppler').auto.why).toBe('risk_incomplete');
    const res = derivePlan(plan, { ...facts, mayBeHigher: true }, { at: new Date('2026-10-14T06:00:00Z') });
    expect(res.changed).toBe(true); // the reason did change ...
    expect(item(plan, 'scan_doppler')).toMatchObject({ rev: 0, revByName: null, auto: { phase: 'check', why: 'risk_may_be_higher' } }); // ... but not what a person acts on
  });

  it('raises the rev of every existing item, whatever its stored values look like (an included item with no dates)', () => {
    const draft = (key) => ANTENATAL_DRAFT.items.find((t) => t.key === key);
    const second = { key: 'anti_d_2', kind: 'vaccination', name: 'Anti-D – second dose', after: { key: 'anti_d', weeks: 4 } };
    const plan = buildPlan({ bookedOn: '2026-07-20', items: [draft('anti_d'), second] });
    personDoes(plan, LOW, 'anti_d_2', (it) => {
      it.forceInclude = { reason: "Doctor's decision", ...actor() };
      it.staffBasis = staffBasis(plan, it, AT);
    });
    const d2 = item(plan, 'anti_d_2');
    expect([d2.rev, d2.auto.dueFrom, d2.auto.dateSource]).toEqual([1, null, null]);
    const later = new Date('2026-10-14T06:00:00Z');
    derivePlan(plan, { ...LOW, rhNegative: 'unknown' }, { at: later });
    expect([d2.auto.applies, d2.rev, d2.revByName, d2.revAt]).toEqual(['unknown', 2, 'Automatic', later]);
    const res = derivePlan(plan, { ...LOW, rhNegative: 'yes' }, { at: later });
    expect([d2.auto.applies, d2.rev]).toEqual(['yes', 3]);
    expect(res.nowApply.sort()).toEqual(['anti_d', 'anti_d_2']);
  });
});

// A small seeded random number generator, so a failure can be repeated.
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STAFF_FIELDS = ['state', 'done', 'notNeeded', 'manualDate', 'forceInclude', 'note', 'staffBasis', 'added'];
const staffOf = (plan) => new Map(plan.items.map((it) => [it, JSON.stringify(STAFF_FIELDS.map((f) => it[f] ?? null))]));

describe('10. property: automatic changes never touch what people recorded', () => {
  it('200 random changes of facts, EDD, booking date and template', () => {
    const rnd = random(20260928);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const yn = () => pick(['yes', 'no', 'unknown']);
    let facts = { ...LOW };
    const plan = buildPlan({ bookedOn: '2026-07-20' });
    const people = [
      (it) => markDone(iso(addDays(d('2026-07-20'), Math.floor(rnd() * 200))))(it),
      (it) => Object.assign(it, { state: 'not_needed', notNeeded: { reasonCode: 'declined', reason: '', ...actor() } }),
      (it) => (it.state === 'open' ? moveTo(plan, '2026-11-02', '2026-11-08')(it) : null),
      (it) => Object.assign(it, { forceInclude: { reason: "Doctor's decision", ...actor() }, staffBasis: staffBasis(plan, it, AT) }),
      (it) => (it.note = { text: 'Sample note', ...actor() }),
    ];
    const variants = [
      ANTENATAL_DRAFT.items,
      ANTENATAL_DRAFT.items.filter((_, i) => i % 3 !== 0),
      ANTENATAL_DRAFT.items.map((t) => (t.fromWeek != null ? { ...t, fromWeek: t.fromWeek + 1, toWeek: (t.toWeek ?? t.fromWeek) + 1, name: `${t.name} *` } : t)),
    ];

    for (let step = 0; step < 200; step += 1) {
      // Now and then a person does something (allowed to change staff fields)
      if (rnd() < 0.3) {
        const it = pick(plan.items);
        pick(people)(it);
        it.rev += 1;
        derivePlan(plan, facts, { at: AT, actorName: PERSON, changedIds: new Set([itemId(it)]) });
      }
      const before = staffOf(plan);
      const touchedBefore = plan.items.filter(touched);
      const historyBefore = new Map(plan.items.map((it) => [it, it.history.length]));
      const at = new Date(AT.getTime() + step * 3600_000);
      const change = pick(['facts', 'edd', 'booking', 'hold', 'template']);
      if (change === 'facts') facts = { ...facts, highRisk: yn(), rhNegative: yn(), previousCaesarean: yn(), diabetes: yn(), hypertension: yn() };
      if (change === 'edd') plan.basis.edd = addDays(EDD, Math.floor(rnd() * 21) - 10);
      if (change === 'booking') plan.bookedOn = addDays(d('2026-06-22'), Math.floor(rnd() * 120));
      if (change === 'hold') plan.eddReview = plan.eddReview ? null : { fromEdd: EDD, toEdd: addDays(EDD, 200), detectedAt: at };
      facts = { ...facts, edd: plan.basis.edd };
      if (change === 'template') {
        const items = pick(variants);
        mergeTemplate(plan, { _id: 't1', name: 'Protocol', kind: 'personal', version: step, items }, { at, actor: { id: null, name: PERSON }, facts });
      } else derivePlan(plan, facts, { at });

      // Staff-owned fields of every remaining item are unchanged; nothing a person touched was dropped.
      const after = staffOf(plan);
      for (const [it, staff] of before) if (after.has(it)) expect(after.get(it)).toBe(staff);
      for (const it of touchedBefore) expect(plan.items).toContain(it);
      for (const it of plan.items) {
        const extra = it.history.slice(historyBefore.get(it) ?? 0);
        expect(extra.every((h) => ['template_changed', 'kept_not_in_template'].includes(h.action))).toBe(true);
      }
      // Idempotent: working it out again changes nothing
      const revs = plan.items.map((it) => it.rev);
      const autos = JSON.stringify(plan.items.map((it) => it.auto));
      expect(derivePlan(plan, facts, { at: new Date(at.getTime() + 1) }).changed).toBe(false);
      expect(plan.items.map((it) => it.rev)).toEqual(revs);
      expect(JSON.stringify(plan.items.map((it) => it.auto))).toBe(autos);
    }
  });

  it('the basis key is stable for the same patient and changes with the facts', () => {
    const p = patient({ medical: { allergies: 'None known', bloodGroup: 'O-' } });
    expect(planFacts(p).basisKey).toBe(planFacts(structuredClone(p)).basisKey);
    expect(planFacts(p).basisKey).not.toBe(planFacts(patient({ medical: { allergies: 'None known', bloodGroup: 'O+' } })).basisKey);
    expect(planFacts(p).basisKey).not.toBe(planFacts(patient({ medical: { allergies: 'None known', bloodGroup: 'O-' }, pregnancy: { effectiveEdd: addDays(EDD, 1) } })).basisKey);
  });
});

describe('11. template merge', () => {
  const draft = (key) => ANTENATAL_DRAFT.items.find((t) => t.key === key);
  const MERGE_AT = new Date('2026-10-12T20:00:00Z'); // 13 Oct 2026 in India
  const DOCTOR = { id: 'u1', name: PERSON };

  // A plan booked at 20 w with some staff changes, and a doctor's from-scratch protocol.
  function setup() {
    const plan = buildPlan({ bookedOn: '2026-10-12' });
    personDoes(plan, LOW, 'scan_nt', markDone('2026-08-20'));
    personDoes(plan, LOW, 'scan_anomaly', moveTo(plan, '2026-10-12', '2026-10-18'));
    personDoes(plan, LOW, 'vacc_td1', markDone('2026-10-12'));
    item(plan, 'lab_tsh').history.push({ at: AT, by: null, byName: PERSON, action: 'reopen', reason: '' }); // only a history entry
    item(plan, 'lab_hbsag').history.push({ at: AT, by: null, byName: 'Dr Old', action: 'template_changed', to: { fields: ['name'] } });
    plan.items.push({
      key: 'custom_0a1b2c3d', origin: 'custom', kind: 'investigation', name: 'Thyroid review', appliesWhen: 'always',
      timing: { fromWeek: 24, toWeek: 26 }, addedOn: d('2026-10-12'), state: 'open', history: [], rev: 0, auto: {},
      added: { reason: '', ...actor() },
    });
    derivePlan(plan, LOW, { at: AT, newIds: new Set(['custom_0a1b2c3d']) });
    const template = {
      _id: 'tpl2',
      name: 'Dr Rao antenatal',
      kind: 'personal',
      ownerName: PERSON,
      version: 3,
      items: [
        { ...draft('scan_anomaly'), fromWeek: 19, toWeek: 21 }, // timing changed
        draft('lab_cbc'), // unchanged
        draft('lab_hb28'),
        { key: 'nt', kind: 'scan', name: 'NT scan', fromWeek: 11, toWeek: 13 }, // same scan, another key
        { key: 'vacc_td1', kind: 'advice', name: 'Tetanus advice', atBooking: true }, // kind changed
        { key: 'hb_again', kind: 'investigation', name: 'Repeat Haemoglobin.', fromWeek: 36, toWeek: 37 }, // same name as lab_hb28
      ],
    };
    return { plan, template };
  }

  it('updates same key and kind, keeps touched items, drops untouched ones and adds the new ones', () => {
    const { plan, template } = setup();
    const custom = structuredClone(item(plan, 'custom_0a1b2c3d'));
    const rep = mergeTemplate(plan, template, { at: MERGE_AT, actor: DOCTOR, facts: LOW });

    const anomaly = item(plan, 'scan_anomaly');
    expect(rep.changed).toEqual([{ itemId: 'scan_anomaly', name: anomaly.name, fields: ['timing'], keepsDoctorDate: true }]);
    expect(timingKey(anomaly)).toBe('w19-21');
    expect(anomaly.auto.flags).toContain('check_date'); // the doctor's date is kept, to be checked
    expect(dueOf(anomaly)).toEqual(['2026-10-12', '2026-10-18']);
    expect(anomaly.history.at(-1)).toMatchObject({ action: 'template_changed', byName: PERSON, to: { fields: ['timing'] } });
    expect(rep.unchanged).toBe(2);

    expect(rep.kept.map((k) => [k.itemId, k.why]).sort()).toEqual([['lab_tsh', 'history'], ['scan_nt', 'done'], ['vacc_td1', 'done']]);
    const nt = plan.items.find((it) => it.key === 'scan_nt');
    expect(nt.notInTemplate).toEqual({ since: MERGE_AT, templateName: 'Dr Rao antenatal', version: 3 });
    expect(nt.auto.phase).toBe('done');
    expect(nt.history.at(-1)).toMatchObject({ action: 'kept_not_in_template' });
    // Only a 'template_changed' entry (by the merge) counts as untouched
    expect(rep.dropped.map((x) => x.itemId)).toContain('lab_hbsag');
    expect(rep.dropped.map((x) => x.itemId)).toContain('lab_urine');
    expect(plan.items.some((it) => it.key === 'lab_hbsag')).toBe(false);

    // Kind changed under the same key: the done Td-1 is kept, and the new advice item is added
    expect(plan.items.filter((it) => it.key === 'vacc_td1').map((it) => [it.kind, it.state, Boolean(it.notInTemplate)])).toEqual([
      ['vaccination', 'done', true],
      ['advice', 'open', false],
    ]);

    expect(rep.added.map((a) => a.key)).toEqual(['nt', 'vacc_td1', 'hb_again']);
    for (const a of rep.added) {
      const it = plan.items.find((x) => x.key === a.key && !x.notInTemplate);
      expect([iso(it.addedOn), it.origin, it.rev, it.state]).toEqual(['2026-10-13', 'template', 0, 'open']);
    }
    const newNt = item(plan, 'nt');
    expect([newNt.auto.lateStart, newNt.auto.lateFrom, newNt.auto.phase]).toEqual(['decide', 'added', 'decide']);
    expect(rep.needsDecision).toEqual([{ itemId: 'nt', key: 'nt', name: 'NT scan' }]);
    expect(rep.possibleDuplicates).toEqual([
      { itemId: 'nt', key: 'nt', name: 'NT scan', withItemId: 'scan_nt', withName: draft('scan_nt').name },
      { itemId: 'hb_again', key: 'hb_again', name: 'Repeat Haemoglobin.', withItemId: 'lab_hb28', withName: 'Repeat haemoglobin' },
    ]);

    expect(rep.customKept).toBe(1);
    expect(item(plan, 'custom_0a1b2c3d')).toEqual(custom);
    expect(plan.source).toMatchObject({ templateId: 'tpl2', templateName: 'Dr Rao antenatal', templateKind: 'personal', ownerName: PERSON, version: 3, itemsHash: itemsHash(template.items) });
    expect(plan.source.chosenBy).toEqual({ by: 'u1', byName: PERSON, at: MERGE_AT });
  });

  it('the preview (on a copy) equals the apply', () => {
    const { plan, template } = setup();
    const copy = structuredClone(plan);
    const preview = mergeTemplate(copy, template, { at: MERGE_AT, actor: DOCTOR, facts: LOW });
    const applied = mergeTemplate(plan, template, { at: MERGE_AT, actor: DOCTOR, facts: LOW });
    expect(applied).toEqual(preview);
    expect(plan).toEqual(copy);
  });

  it('marks an added item that may repeat another ("possible_duplicate") until it is kept or one of the two is not needed – a marker only', () => {
    const { plan, template } = setup();
    const hb28Before = structuredClone(item(plan, 'lab_hb28'));
    mergeTemplate(plan, template, { at: MERGE_AT, actor: DOCTOR, facts: LOW });
    const again = item(plan, 'hb_again');
    expect(again.possibleDuplicate).toEqual({ withItemId: 'lab_hb28', withName: 'Repeat haemoglobin', at: MERGE_AT });
    expect([again.auto.flags, again.auto.phase, again.rev]).toEqual([['possible_duplicate'], 'open', 0]); // still due and listable: never held back
    expect(again.auto.listable).toBe(true);
    expect(item(plan, 'nt').auto.flags).toEqual(['possible_duplicate']); // beside the done NT scan (its own phase, Decide, stays)
    expect(item(plan, 'nt').auto.phase).toBe('decide');
    // The item it may repeat is not changed by the mark
    expect([item(plan, 'lab_hb28').possibleDuplicate ?? null, item(plan, 'lab_hb28').rev, item(plan, 'lab_hb28').auto.flags]).toEqual([null, hb28Before.rev, []]);

    // Answered by marking the other one not needed afterwards
    const LATER = new Date('2026-10-14T06:00:00Z');
    personDoes(plan, LOW, 'lab_hb28', (it) => {
      it.state = 'not_needed';
      it.notNeeded = { reasonCode: 'covered', reason: '', by: null, byName: PERSON, at: LATER };
    }, LATER);
    expect(item(plan, 'hb_again').auto.flags).toEqual([]);
    // Reopened: the question is back; the item itself done: no flag
    personDoes(plan, LOW, 'lab_hb28', (it) => {
      it.state = 'open';
      it.notNeeded = null;
    }, LATER);
    expect(item(plan, 'hb_again').auto.flags).toEqual(['possible_duplicate']);
    personDoes(plan, LOW, 'hb_again', markDone('2026-10-13'), LATER);
    expect(item(plan, 'hb_again').auto.flags).toEqual([]);
    // A mark whose other item is no longer on the plan asks nothing
    const lone = { ...structuredClone(item(plan, 'nt')), possibleDuplicate: { withItemId: 'gone', withName: 'Gone', at: MERGE_AT } };
    plan.items = plan.items.map((it) => (it.key === 'nt' ? lone : it));
    derivePlan(plan, LOW, { at: LATER });
    expect(item(plan, 'nt').auto.flags).toEqual([]);
  });

  it('switching back brings a kept item back into the template', () => {
    const { plan, template } = setup();
    mergeTemplate(plan, template, { at: MERGE_AT, actor: DOCTOR, facts: LOW });
    const rev = plan.items.find((it) => it.key === 'scan_nt').rev;
    const rep = mergeTemplate(plan, { _id: 'std', name: 'Standard', kind: 'standard', version: 1, items: ANTENATAL_DRAFT.items }, { at: MERGE_AT, actor: DOCTOR, facts: LOW });
    const nt = plan.items.find((it) => it.key === 'scan_nt');
    expect([nt.notInTemplate, nt.rev]).toEqual([null, rev + 1]);
    expect(rep.dropped.map((x) => x.itemId)).toEqual(expect.arrayContaining(['nt', 'hb_again']));
  });
});

describe('12. hashes and approvals', () => {
  const items = ANTENATAL_DRAFT.items;
  const rules = ANTENATAL_DRAFT.riskRules;

  it('itemsHash ignores order and empty-value differences, and changes with every field', () => {
    const h = itemsHash(items);
    expect(itemsHash([...items].reverse())).toBe(h);
    expect(itemsHash(items.map((t) => ({ ...t, patientText: t.patientText || null, appliesWhen: t.appliesWhen ?? 'always', atBooking: Boolean(t.atBooking) })))).toBe(h);
    const first = items[0]; // visit_booking
    const changes = [
      { key: 'visit_first' },
      { kind: 'advice' },
      { name: 'Booking visit' },
      { patientText: 'First check' },
      { atBooking: false },
      { fromWeek: 6 },
      { toWeek: 12 },
      { after: { key: 'x', weeks: null } },
      { after: { key: null, weeks: 2 } },
      { appliesWhen: 'high_risk' },
      { source: 'WHO' },
    ];
    for (const change of changes) expect([change, itemsHash([{ ...first, ...change }, ...items.slice(1)])]).not.toEqual([change, h]);
  });

  it('rulesHash ignores order, changes with every field and is null without rules', () => {
    const h = rulesHash(rules);
    expect(rulesHash([...rules].reverse())).toBe(h);
    for (const change of [{ key: 'k' }, { label: 'L' }, { factor: 'bmi' }, { op: 'gte' }, { value: 18 }, { condition: 'diabetes' }, { complication: 'pph' }, { level: 'moderate' }, { source: 'S' }]) {
      expect(rulesHash([{ ...rules[0], ...change }, ...rules.slice(1)])).not.toBe(h);
    }
    expect(rulesHash([])).toBeNull();
    expect(rulesHash(undefined)).toBeNull();
    expect(itemsHash(items)).not.toBe(rulesHash(rules));
  });

  it('rulesHash: a rule on a finding counts its finding; rules approved before findings existed keep their fingerprint', () => {
    const finding = rules.find((r) => r.factor === 'finding');
    const others = rules.filter((r) => r !== finding);
    expect(rulesHash([{ ...finding, finding: 'bleeding' }, ...others])).not.toBe(rulesHash(rules));
    // the rules as they were before (no finding field), stored with the new empty field or without it: the same
    // fingerprint as the one written down when a doctor approved them – worked out here the way it was then
    const old = rules.filter((r) => r.factor !== 'finding');
    const then = createHash('sha256')
      .update(JSON.stringify(old.map((r) => [r.key, r.label, r.factor, r.op, r.value, r.condition, r.complication, r.level, r.source].map((v) => (v === undefined || v === null || v === '' ? null : v))).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))))
      .digest('hex');
    expect(rulesHash(old)).toBe(then);
    expect(rulesHash(old.map((r) => ({ ...r, finding: null })))).toBe(then);
  });

  it('backfills a pre-Feature-7 approval only when the approved version is the current one', () => {
    const at = new Date('2026-09-01T10:00:00Z');
    const t = { items, riskRules: rules, status: 'approved', version: 4, approvedVersion: 4, approvedBy: 'u9', approvedByName: 'Dr Rao', approvedAt: at, approvals: [] };
    expect(approvalsOf(t)).toEqual([{ version: 4, itemsHash: itemsHash(items), rulesHash: rulesHash(rules), by: 'u9', byName: 'Dr Rao', at }]);
    expect(t.approvals).toEqual([]); // reading never writes
    expect(backfillApproval(t)).toMatchObject({ version: 4 });
    expect(backfillApproval(t)).toBeNull(); // idempotent
    expect(t.approvals).toHaveLength(1);
    expect(approvalsOf(t)).toEqual(t.approvals);

    const raced = { ...t, approvals: [], approvedVersion: 3 }; // left "approved" by the old approve race
    expect(backfillApproval(raced)).toBeNull();
    expect(approvalsOf(raced)).toEqual([]);
    expect(approvalsOf({ ...t, approvals: [], status: 'draft' })).toEqual([]);
    expect(approvalsOf({ ...t, approvals: undefined, approvedVersion: null })).toEqual([]);
  });
});

describe('13. plan approval label', () => {
  const items = ANTENATAL_DRAFT.items;
  const rules = ANTENATAL_DRAFT.riskRules;
  const approval = (over) => ({ version: 1, itemsHash: itemsHash(items), rulesHash: rulesHash(rules), by: 'u9', byName: 'Dr Rao', at: AT, ...over });
  const std = (over = {}) => ({ items, riskRules: rules, status: 'approved', version: 1, approvals: [approval()], ...over });
  const plan = buildPlan({ bookedOn: '2026-07-20' }); // has the high-risk Doppler scan (riskBased)
  const lowPatient = { risk: { level: 'low' } };

  it('is approved when a doctor approved this content and the risk rules', () => {
    const t = std();
    expect(planApproval(plan, { srcT: t, stdT: t, patient: lowPatient })).toMatchObject({
      approved: true,
      label: null,
      draftReason: null,
      itemsApproval: { version: 1 },
      updateAvailable: false,
      newerApprovedVersion: null,
    });
  });

  it('is a draft (content) when no doctor approved the content', () => {
    const t = std({ status: 'draft', approvals: [] });
    expect(planApproval(plan, { srcT: t, stdT: t, patient: lowPatient })).toMatchObject({
      approved: false,
      label: 'Draft – not approved for clinical use',
      draftReason: 'content',
    });
  });

  it('is a draft (risk rules) when only the rules changed; an override or no high-risk items clears it', () => {
    const edited = std({ status: 'draft', version: 2, riskRules: [...rules.slice(1)] });
    expect(planApproval(plan, { srcT: edited, stdT: edited, patient: lowPatient })).toMatchObject({ approved: false, draftReason: 'risk_rules', itemsApproval: { version: 1 } });
    expect(planApproval(plan, { srcT: edited, stdT: edited, patient: { risk: { level: 'high', override: { level: 'high' } } } }).approved).toBe(true);
    const noRiskItems = buildPlan({ bookedOn: '2026-07-20', items: items.filter((t) => t.appliesWhen !== 'high_risk') });
    noRiskItems.source.itemsHash = itemsHash(items);
    expect(planApproval(noRiskItems, { srcT: edited, stdT: edited, patient: lowPatient }).approved).toBe(true);
  });

  it('shows when newer approved content replaced the approved content', () => {
    const newItems = items.map((t) => (t.key === 'lab_tsh' ? { ...t, name: 'TSH' } : t));
    const t = std({ items: newItems, version: 5, approvals: [approval(), approval({ version: 5, itemsHash: itemsHash(newItems) })] });
    expect(planApproval(plan, { srcT: t, stdT: t, patient: lowPatient })).toMatchObject({
      approved: true,
      itemsApproval: { version: 1 },
      updateAvailable: true,
      updateApproved: true,
      newerApprovedVersion: 5,
      currentVersion: 5,
    });
    // A newer draft: an update is available but not approved
    const draftNewer = std({ items: newItems, version: 6, status: 'draft' });
    expect(planApproval(plan, { srcT: draftNewer, stdT: draftNewer, patient: lowPatient })).toMatchObject({ approved: true, updateAvailable: true, updateApproved: false, newerApprovedVersion: null });
  });
});

describe('14. PCPNDT patterns', () => {
  const pass = ['beta hCG 1200', 'sonography', 'person', 'sexually transmitted', 'Hb 11.2 g/dL', 'TIFFA normal, AFI 12'];
  const refuse = ["It's a boy", 'ladki', 'ladke', '46,XY', '46, XX', '♀', '♂', 'Baby GIRL', 'sons', 'larka', 'ladkiyaan', 'gender reveal'];

  it('lets ordinary clinical text through and refuses words about the baby’s sex (server and website)', () => {
    for (const words of [serverWords, clientWords]) {
      for (const t of pass) expect([t, words.mentionsFetalSex(t)]).toEqual([t, false]);
      for (const t of refuse) expect([t, words.mentionsFetalSex(t)]).toEqual([t, true]);
      expect(words.mentionsFetalSex('')).toBe(false);
      expect(words.mentionsFetalSex(null)).toBe(false);
    }
  });

  it('the server and the website use identical patterns and message', () => {
    for (const name of ['FETAL_SEX_WORDS', 'KARYOTYPE', 'SEX_SYMBOLS']) {
      expect([name, clientWords[name].source, clientWords[name].flags]).toEqual([name, serverWords[name].source, serverWords[name].flags]);
    }
    expect(clientWords.PCPNDT_MESSAGE).toBe(serverWords.PCPNDT_MESSAGE);
  });

  it('safeText refuses such words with the PCPNDT message', () => {
    const schema = serverWords.safeText('Result', 500);
    expect(schema.parse('  Hb 11.2 g/dL ')).toBe('Hb 11.2 g/dL');
    const r = schema.safeParse("It's a boy");
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe(serverWords.PCPNDT_MESSAGE);
    expect(schema.safeParse('x'.repeat(501)).success).toBe(false);
  });
});

describe('statuses of a whole plan', () => {
  it('gives every item a status', () => {
    const plan = buildPlan({ bookedOn: '2026-10-12' });
    const all = planStatuses(plan, d('2026-10-12'));
    expect(all.size).toBe(plan.items.length);
    const counts = {};
    for (const { status: s } of all.values()) counts[s] = (counts[s] ?? 0) + 1;
    // not applicable: 3 Rh-negative items, the high-risk scan and the 6 items for findings in this pregnancy
    expect(counts).toEqual({ due: 16, lapsed: 2, upcoming: 17, not_applicable: 10, decide: 4, waiting: 1 });
  });
});

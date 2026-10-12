// Red flags beyond pregnancy visits (4 Oct 2026): lab results, postnatal and newborn care, patients in hospital,
// rules that say which types of care they apply to, and the built-in upgrade rule. Fake data only.
// Time is pinned: 4 Oct 2026, 11:30 in India; the sample mother's scan EDD is 1 Mar 2027 (18 w 6 d today).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { LAB_TESTS } from '../src/lab/labTests.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CARE_TYPES, Patient } from '../src/models/Patient.js';
import { RedFlagRuleSet } from '../src/models/RedFlagRuleSet.js';
import {
  BUILT_IN_RED_FLAG_RULES,
  BUILT_IN_RED_FLAG_VERSION,
  BUILT_IN_SINCE,
  LAB_FACTOR_SOURCES,
  RED_FLAGS_NOT_CHECKED,
  RED_FLAG_CARE_TYPES,
  RED_FLAG_FACTORS,
  RULE_VALUES_WITHIN_DAYS,
  ageText,
  chartReadings,
  evaluateRedFlags,
  flagFromText,
  flagLatestDay,
  labReadings,
  labTestKeysOf,
  redFlagFacts,
  ruleCareTypes,
  ruleText,
} from '../src/redflags/redFlags.js';
import { todayBriefText } from '../src/ai/brief.js';
import { patientContext } from '../src/ai/context.js';
import { episodeSince, flagEpisode } from '../src/redflags/redFlagService.js';
import { RED_FLAG_LIST_DAYS } from '../src/routes/worklist.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import * as website from '../../client/src/pages/redflags/redFlagFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-04T06:00:00Z');
const TODAY = new Date('2026-10-04T00:00:00Z');
const EDD = new Date('2027-03-01T00:00:00Z');
const D = (s) => new Date(`${s}T00:00:00Z`);
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
const V1_RULES = BUILT_IN_RED_FLAG_RULES.filter((r) => !BUILT_IN_SINCE[r.key]);
const NEW_RULES = BUILT_IN_RED_FLAG_RULES.length - V1_RULES.length;

// ---------- The rules engine (no database) ----------

const keysOf = (facts, rules = BUILT_IN_RED_FLAG_RULES) => evaluateRedFlags(rules, facts).map((f) => f.key);
const visit = (vitals = {}, on = TODAY, extra = {}) => ({ _id: 'v1', visitOn: on, vitals, details: {}, ...extra });
const order = (tests, { at = '2026-10-03T05:00:00Z', status = 'reported', id = 'o1' } = {}) => ({
  _id: id,
  status,
  collected: { at: new Date(at) },
  reported: { at: new Date(at) },
  tests: tests.map(([key, values]) => ({ key, values: Object.entries(values).map(([k, value]) => ({ key: k, value: String(value) })) })),
});

describe('rules say which types of care they apply to', () => {
  it('knows the same types of care as the patient record, and every built-in rule names its types and its source', () => {
    expect([...RED_FLAG_CARE_TYPES].sort()).toEqual([...CARE_TYPES].sort());
    expect(BUILT_IN_RED_FLAG_VERSION).toBe(3); // 3: pregnancy-loss care (pregnancy-loss-care.test.js)
    expect(V1_RULES).toHaveLength(21);
    for (const r of BUILT_IN_RED_FLAG_RULES) {
      expect(r.appliesTo.length, r.key).toBeGreaterThan(0);
      expect(r.appliesTo.every((t) => RED_FLAG_CARE_TYPES.includes(t)), r.key).toBe(true);
      expect(r.source.length, r.key).toBeGreaterThan(10);
      // Every check exists for every type of care of its rule
      for (const c of r.conditions) for (const t of r.appliesTo) expect(RED_FLAG_FACTORS[c.factor].careTypes?.includes(t) ?? true, `${r.key} ${c.factor} ${t}`).toBe(true);
      // Weeks only on pregnancy rules, a baby's age only on newborn rules
      if (r.fromWeek != null || r.toWeek != null) expect(r.appliesTo, r.key).toContain('antenatal');
      if (r.fromDay != null || r.toDay != null) expect(r.appliesTo, r.key).toContain('newborn');
    }
    // The rules of the first version are all for pregnancy care, as they always were
    expect(V1_RULES.every((r) => r.appliesTo.join() === 'antenatal')).toBe(true);
    // A rule saved before rules had "applies to" is for pregnancy care
    expect(ruleCareTypes({ key: 'old' })).toEqual(['antenatal']);
    expect(ruleCareTypes({ appliesTo: [] })).toEqual(['antenatal']);
  });

  it('the same BP raises the pregnancy rule for an antenatal patient, the postnatal rule after delivery, nothing for other types', () => {
    const bp = { bpSystolic: 150, bpDiastolic: 96 };
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: visit(bp), edd: EDD, today: TODAY }))).toEqual(['htn_sys']);
    expect(keysOf(redFlagFacts({ careType: 'postnatal', visit: visit(bp), today: TODAY }))).toEqual(['pn_bp_sys']);
    for (const careType of ['gynaecology', 'infertility', 'abortion', 'newborn']) expect(keysOf(redFlagFacts({ careType, visit: visit(bp), today: TODAY })), careType).toEqual([]);
    // A rule without "applies to" (saved before 4 Oct 2026) stays a pregnancy rule
    const old = [{ key: 'old_bp', label: 'Raised BP', level: 'watch', conditions: [{ factor: 'bpSystolic', op: 'gte', value: 140 }] }];
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: visit(bp), edd: EDD, today: TODAY }), old)).toEqual(['old_bp']);
    expect(keysOf(redFlagFacts({ careType: 'postnatal', visit: visit(bp), today: TODAY }), old)).toEqual([]);
    // The weeks of a rule are ignored outside pregnancy care (there are none), not a reason to stay silent
    const both = [{ ...old[0], key: 'both', appliesTo: ['antenatal', 'postnatal'], fromWeek: 20 }];
    expect(keysOf(redFlagFacts({ careType: 'postnatal', visit: visit(bp), today: TODAY }), both)).toEqual(['both']);
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: visit(bp), edd: EDD, today: TODAY }), both)).toEqual([]); // 18 weeks
  });
});

describe('postnatal and newborn rules (draft)', () => {
  const pn = (vitals) => keysOf(redFlagFacts({ careType: 'postnatal', visit: visit(vitals), today: TODAY }));
  const nb = (vitals, newborn = { birthAt: new Date('2026-10-01T03:00:00Z'), birthWeightGrams: 3000 }) => evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'newborn', visit: visit(vitals), today: TODAY, newborn }));

  it('after delivery: BP 140/90, temperature 100.4 °F, pulse over 110, Hb under 7', () => {
    expect(pn({ bpSystolic: 138, bpDiastolic: 88, temperatureF: 99, pulse: 110, hb: 7 })).toEqual([]);
    expect(pn({ bpSystolic: 140, bpDiastolic: 80 })).toEqual(['pn_bp_sys']);
    expect(pn({ bpSystolic: 130, bpDiastolic: 90 })).toEqual(['pn_bp_dia']);
    expect(pn({ bpSystolic: 164, bpDiastolic: 112 })).toEqual(['pn_bp_severe_sys']); // one line for the reading
    expect(pn({ temperatureF: 100.4 })).toEqual(['pn_fever']);
    expect(pn({ temperatureF: 100.3 })).toEqual([]);
    expect(pn({ pulse: 111 })).toEqual(['pn_pulse_high']);
    expect(pn({ hb: 6.9 })).toEqual(['pn_hb_severe']);
    // The pregnancy bands (moderate, mild anaemia) are not postnatal rules
    expect(pn({ hb: 9 })).toEqual([]);
  });

  it('a baby: temperature under 97.7 °F or over 99.5 °F, and weight more than 10 % below the birth weight', () => {
    expect(nb({ temperatureF: 98.4 })).toEqual([]);
    expect(nb({ temperatureF: 97.6 }).map((f) => [f.key, f.level])).toEqual([['nb_temp_low', 'watch']]);
    expect(nb({ temperatureF: 95.8 }).map((f) => [f.key, f.level])).toEqual([['nb_temp_very_low', 'urgent']]);
    expect(nb({ temperatureF: 99.6 }).map((f) => [f.key, f.level])).toEqual([['nb_temp_high', 'urgent']]);
    expect(nb({ temperatureF: 99.5 })).toEqual([]);
    // 2.65 kg against 3000 g at birth: 11.7 % below
    const [loss] = nb({ weightKg: 2.65 });
    expect(loss).toMatchObject({ key: 'nb_weight_loss', level: 'urgent', detail: 'Weight 2.65 kg – 11.7 % below the birth weight of 3000 g', rule: 'Weight below birth weight by over 10 %' });
    expect(nb({ weightKg: 2.7 })).toEqual([]); // exactly 10 %
    // 2.699 kg is 10.03 % below: "more than 10 %". The loss is not rounded before it is checked, and is shown so
    expect(nb({ weightKg: 2.699 }).map((f) => [f.key, f.detail])).toEqual([['nb_weight_loss', 'Weight 2.699 kg – 10.03 % below the birth weight of 3000 g']]);
    expect(nb({ weightKg: 3.4 })).toEqual([]); // above the birth weight
    // No birth weight on the record: not worked out, so no flag (and never a guess)
    expect(nb({ weightKg: 2.0 }, { birthAt: new Date('2026-10-01T03:00:00Z'), birthWeightGrams: null })).toEqual([]);
    // An adult's rules never fire for a baby: a pulse of 140 is normal for her
    expect(nb({ pulse: 140, bpSystolic: 70, bpDiastolic: 40 })).toEqual([]);
  });
});

describe('lab results', () => {
  it('every lab check points at a value of the lab test list, in the same unit', () => {
    const tests = new Map(LAB_TESTS.map((t) => [t.key, t]));
    for (const [factor, source] of Object.entries(LAB_FACTOR_SOURCES)) {
      const f = RED_FLAG_FACTORS[factor];
      expect(f?.group, factor).toBe('lab');
      for (const [testKey, valueKey] of Object.entries(source.tests)) {
        const field = tests.get(testKey)?.fields.find((x) => x.key === valueKey);
        expect(field, `${factor}: ${testKey}.${valueKey}`).toBeTruthy();
        if (f.type === 'number') {
          expect(field.type, `${factor}: ${testKey}.${valueKey}`).toBe('number');
          expect(field.unit, `${factor}: ${testKey}.${valueKey}`).toBe(f.unit);
        } else {
          // Urine albumin: the lab's grades are the dipstick's grades
          expect(field.options.map((x) => x.toLowerCase())).toEqual(f.order);
        }
        // A baby's test never feeds an adult-only check, and the other way round
        const who = tests.get(testKey).who === 'newborn' ? 'newborn' : 'postnatal';
        expect(f.careTypes?.includes(who) ?? true, `${factor}: ${testKey}`).toBe(true);
      }
    }
    expect(labTestKeysOf(BUILT_IN_RED_FLAG_RULES).sort()).toEqual(['cbc', 'fbs', 'hb', 'nb_bilirubin', 'nb_cbc', 'nb_sugar', 'nb_tsh', 'ogtt', 'rbs', 'tsh', 'urine']);
    expect(labTestKeysOf(V1_RULES)).toEqual([]); // rules without a lab check read no lab orders
  });

  it('takes the latest reported value of this pregnancy; a saved or cancelled result, or a value in another unit, does not count', () => {
    const since = D('2026-05-11');
    const orders = [
      order([['cbc', { hb: '9.5', platelets: '2.1' }]], { at: '2026-09-01T05:00:00Z', id: 'old' }),
      order([['hb', { hb: '6,4' }]], { at: '2026-10-03T05:00:00Z', id: 'new' }), // a comma as the decimal point
      order([['hb', { hb: '5.0' }]], { at: '2026-10-03T09:00:00Z', id: 'saved', status: 'collected' }),
      order([['hb', { hb: '4.0' }]], { at: '2026-10-03T10:00:00Z', id: 'gone', status: 'cancelled' }),
      order([['cbc', { hb: '5.5' }]], { at: '2026-03-01T05:00:00Z', id: 'before' }), // before this pregnancy
      order([['cbc', { platelets: '150000' }]], { at: '2026-10-03T11:00:00Z', id: 'unit' }), // typed per µL, not in lakh
      order([['urine', { albumin: '2+' }], ['tsh', { tsh: '' }]], { at: '2026-10-02T05:00:00Z', id: 'urine' }),
    ];
    const r = labReadings(orders, { since });
    expect(r.labHb).toMatchObject({ value: 6.4, orderId: 'new', on: D('2026-10-03') });
    expect(r.labPlatelets).toMatchObject({ value: 2.1, orderId: 'old' });
    expect(r.labUrineAlbumin).toMatchObject({ value: '2+', orderId: 'urine' });
    expect(r.labTsh).toBeUndefined();
    // Without a first day everything on the record counts
    expect(labReadings([orders[4]]).labHb.value).toBe(5.5);
  });

  it('a flag from a lab result says so, with the value, its date and the rule', () => {
    const lab = labReadings([order([['cbc', { hb: '6.4', platelets: '0.8' }]])]);
    const flags = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'antenatal', edd: EDD, today: TODAY, lab }));
    expect(flags.map((f) => f.key)).toEqual(['lab_hb_severe', 'lab_platelets_low']);
    expect(flags[0]).toMatchObject({
      label: 'Severe anaemia',
      level: 'urgent',
      detail: 'Haemoglobin (lab) 6.4 g/dL',
      rule: 'Haemoglobin (lab) under 7 g/dL',
      sources: [{ source: 'lab', on: D('2026-10-03'), orderId: 'o1' }],
    });
    expect(flagFromText(flags[0])).toBe('from the lab result of 3 Oct 2026');
    expect(flagLatestDay(flags[0])).toEqual(D('2026-10-03'));
    // Low platelets are also a postnatal rule; the anaemia bands of pregnancy are not
    expect(keysOf(redFlagFacts({ careType: 'postnatal', today: TODAY, lab }))).toEqual(['lab_platelets_low', 'pn_lab_hb_severe']);
  });

  it('blood sugar, TSH and urine protein from the lab', () => {
    const flagsOf = (tests, careType = 'antenatal', edd = EDD) => keysOf(redFlagFacts({ careType, edd, today: TODAY, lab: labReadings([order(tests)]) }));
    expect(flagsOf([['ogtt', { glucose2h: '139' }]])).toEqual([]);
    expect(flagsOf([['ogtt', { glucose2h: '152' }]])).toEqual(['lab_ogtt_gdm']);
    expect(flagsOf([['ogtt', { glucose2h: '210' }]])).toEqual(['lab_ogtt_diabetes']);
    expect(flagsOf([['fbs', { fbs: '96' }]])).toEqual(['lab_fbs_high']);
    expect(flagsOf([['fbs', { fbs: '130' }]])).toEqual(['lab_fbs_diabetes']);
    expect(flagsOf([['rbs', { rbs: '230' }]])).toEqual(['lab_rbs_high']);
    expect(flagsOf([['ppbs', { ppbs: '230' }]])).toEqual([]); // a check exists, but no built-in rule
    expect(flagsOf([['tsh', { tsh: '5.2' }]])).toEqual(['lab_tsh_high']);
    expect(flagsOf([['tsh', { tsh: '0.05' }]])).toEqual(['lab_tsh_low']);
    expect(flagsOf([['tsh', { tsh: '2.1' }]])).toEqual([]);
    // Urine protein from 20 weeks only: at 18 weeks on the day of the sample nothing is raised …
    expect(flagsOf([['urine', { albumin: '2+' }]])).toEqual([]);
    // … with an EDD four weeks earlier the same sample was taken at 22 weeks
    expect(flagsOf([['urine', { albumin: '2+' }]], 'antenatal', D('2027-02-01'))).toEqual(['lab_urine_protein']);
    expect(flagsOf([['urine', { albumin: 'Trace' }]], 'antenatal', D('2027-02-01'))).toEqual([]);
    // These are pregnancy rules
    expect(flagsOf([['ogtt', { glucose2h: '210' }], ['tsh', { tsh: '9' }]], 'gynaecology')).toEqual([]);
  });

  it('raised BP at the visit with protein in the lab urine test is possible pre-eclampsia – each value with its own date', () => {
    const edd = D('2027-02-01'); // 23 weeks today
    const lab = labReadings([order([['urine', { albumin: '1+' }]], { at: '2026-10-01T05:00:00Z' })]);
    const flags = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'antenatal', visit: visit({ bpSystolic: 146, bpDiastolic: 94 }), edd, today: TODAY, lab }));
    expect(flags.map((f) => f.key)).toEqual(['pe_lab_sys', 'lab_urine_protein']); // and not also "raised BP"
    expect(flags[0].detail).toBe('BP 146/94 mmHg, Urine albumin (lab) 1+');
    expect(flagFromText(flags[0])).toBe('from the visit on 4 Oct 2026 and the lab result of 1 Oct 2026');
  });

  it('a rule never joins values recorded far apart: a lab urine result of months ago with today\'s BP is not pre-eclampsia', () => {
    expect(RULE_VALUES_WITHIN_DAYS).toBe(7);
    const edd = D('2026-11-01'); // 36 weeks today
    const old = labReadings([order([['urine', { albumin: '1+' }]], { at: '2026-06-21T05:00:00Z' })]); // at 21 weeks
    const flagsWith = (vitals, lab = old) => keysOf(redFlagFacts({ careType: 'antenatal', visit: visit(vitals), edd, today: TODAY, lab }));
    // No dipstick at the visit: the lab value is still the latest urine albumin, but 15 weeks older than the BP
    expect(flagsWith({ bpSystolic: 142, bpDiastolic: 88 })).toEqual(['htn_sys', 'lab_urine_protein']);
    // A dipstick at the visit is the newer urine albumin: the lab value of 21 weeks no longer counts at all
    expect(flagsWith({ bpSystolic: 142, bpDiastolic: 88, urineAlbumin: 'nil' })).toEqual(['htn_sys']);
    expect(flagsWith({ bpSystolic: 142, bpDiastolic: 88, urineAlbumin: '2+' })).toEqual(['pe_sys']);
    // Seven days apart is still joined, eight days is not
    const week = (at) => labReadings([order([['urine', { albumin: '1+' }]], { at })]);
    expect(flagsWith({ bpSystolic: 142, bpDiastolic: 88 }, week('2026-09-27T05:00:00Z'))).toEqual(['pe_lab_sys', 'lab_urine_protein']);
    expect(flagsWith({ bpSystolic: 142, bpDiastolic: 88 }, week('2026-09-26T05:00:00Z'))).toEqual(['htn_sys', 'lab_urine_protein']);
    // The rule says so in words, on the server and on the website
    const rule = BUILT_IN_RED_FLAG_RULES.find((r) => r.key === 'pe_lab_sys');
    expect(ruleText(rule)).toBe('BP systolic at least 140 mmHg and Urine albumin (lab) 1+ or more, from 20 weeks, values recorded within 7 days of each other');
    expect(rule.message).toMatch(/within 7 days/);
    expect(ruleText(BUILT_IN_RED_FLAG_RULES.find((r) => r.key === 'pe_sys'))).toBe('BP systolic at least 140 mmHg and Urine albumin 1+ or more, from 20 weeks');
    // In hospital the same holds for the chart's BP with a dipstick of a visit long ago
    const chart = chartReadings([{ kind: 'vitals', at: new Date('2026-10-04T02:00:00Z'), admissionId: 'a1', vitals: { bpSystolic: 150, bpDiastolic: 96 } }]);
    const earlier = visit({ urineAlbumin: '2+' }, D('2026-09-10'));
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: earlier, edd, today: TODAY, chart }))).toEqual(['htn_sys']);
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: visit({ urineAlbumin: '2+' }, D('2026-10-01')), edd, today: TODAY, chart }))).toEqual(['pe_sys']);
  });

  it('haemoglobin and urine albumin count once – the newer of the visit and the lab reading – so a lab flag clears at the next visit', () => {
    const edd = D('2027-02-01'); // 22 weeks today
    const booking = labReadings([order([['cbc', { hb: '10.4' }]], { at: '2026-08-10T05:00:00Z' })]);
    const flagsWith = (v, lab = booking, rules = BUILT_IN_RED_FLAG_RULES) => keysOf(redFlagFacts({ careType: 'antenatal', visit: v, edd, today: TODAY, lab }), rules);
    expect(flagsWith(null)).toEqual(['lab_hb_mild']);
    // A later visit measured the Hb again: only that reading counts – normal, or low
    expect(flagsWith(visit({ hb: 11.8 }))).toEqual([]);
    expect(flagsWith(visit({ hb: 9.2 }))).toEqual(['hb_moderate']);
    // A visit that did not measure it leaves the lab value standing
    expect(flagsWith(visit({ bpSystolic: 110, bpDiastolic: 70 }))).toEqual(['lab_hb_mild']);
    // The lab report is the newer one: the visit's low value no longer counts
    const fresh = labReadings([order([['cbc', { hb: '11.6' }]], { at: '2026-10-03T05:00:00Z' })]);
    expect(flagsWith(visit({ hb: 9.2 }, D('2026-09-01')), fresh)).toEqual([]);
    // Both on the same day: nobody can tell which is newer, so both are checked
    expect(flagsWith(visit({ hb: 9.2 }, D('2026-10-03')), labReadings([order([['cbc', { hb: '10.4' }]])]))).toEqual(['hb_moderate', 'lab_hb_mild']);
    // Rules with no check of the lab haemoglobin for this type of care: a newer lab value must not hide the visit's flag
    const noLabHb = [...V1_RULES, ...BUILT_IN_RED_FLAG_RULES.filter((r) => r.key === 'lab_ogtt_gdm' || r.key === 'pn_lab_hb_severe')];
    expect(flagsWith(visit({ hb: 6.5 }, D('2026-09-01')), fresh, noLabHb)).toEqual(['hb_severe']);
  });

  it("a baby's age for bilirubin is worked out early, not late, when the lab did not mark the sample as collected", () => {
    const birthAt = new Date('2026-10-02T03:00:00Z');
    const result = (extra) => ({ _id: 'o1', status: 'reported', createdAt: new Date('2026-10-02T22:00:00Z'), tests: [{ key: 'nb_bilirubin', values: [{ key: 'total', value: '11' }] }], ...extra });
    const flagsOf = (o) => keysOf(redFlagFacts({ careType: 'newborn', today: TODAY, newborn: { birthAt }, lab: labReadings([o], { birthAt }) }));
    const next = { at: new Date('2026-10-03T09:00:00Z') }; // the next morning: 30 hours old
    // Ordered at 19 hours of age, reported at 30 hours without "sample collected": the sample was taken somewhere
    // in between – the limit of the first day (5.8) is used, not the second day's 11.7
    expect(flagsOf(result({ collected: next, reported: next }))).toEqual(['nb_bili_day0']);
    expect(flagsOf(result({ reported: next }))).toEqual(['nb_bili_day0']); // an order without a sample stamp
    // … also after the report was amended (the report's time has moved on; the order remembers the stamp)
    expect(flagsOf(result({ collected: next, reported: { at: new Date('2026-10-03T12:00:00Z') }, collectedAtReport: true }))).toEqual(['nb_bili_day0']);
    // The lab marked the sample as collected at 30 hours: that is its time
    expect(flagsOf(result({ collected: next, reported: { at: new Date('2026-10-03T10:00:00Z') } }))).toEqual([]);
    // The date said with the flag stays the sample's date as recorded
    expect(labReadings([result({ collected: next, reported: next })], { birthAt }).labBilirubinTotal).toMatchObject({ on: D('2026-10-03'), ageDays: 0 });
  });

  it('on the day of a delivery whose time is known, a sample taken before the birth is not "after delivery"', () => {
    const before = order([['cbc', { hb: '6.4' }]], { at: '2026-10-04T02:30:00Z', id: 'before' }); // 08:00
    const after = order([['cbc', { hb: '6.6' }]], { at: '2026-10-04T05:30:00Z', id: 'after' }); // 11:00
    const sinceAt = new Date('2026-10-04T04:30:00Z'); // delivered at 10:00
    expect(labReadings([before], { since: TODAY, sinceAt }).labHb).toBeUndefined();
    expect(labReadings([before, after], { since: TODAY, sinceAt }).labHb).toMatchObject({ value: 6.6, orderId: 'after' });
    // A delivery typed as a date has no time: the whole day counts
    expect(labReadings([before], { since: TODAY }).labHb).toMatchObject({ value: 6.4 });
  });

  it("a baby's bilirubin is checked against the day of life – only when the baby's age is known", () => {
    const birthAt = new Date('2026-10-02T03:00:00Z');
    const bili = (total, at, extra = {}, born = birthAt) =>
      keysOf(redFlagFacts({ careType: 'newborn', today: TODAY, newborn: { birthAt: born }, lab: labReadings([order([['nb_bilirubin', { total, ...extra }]], { at })], { birthAt: born }) }));
    expect(bili('6.5', '2026-10-02T20:00:00Z')).toEqual(['nb_bili_day0']); // 17 hours old
    expect(bili('5.8', '2026-10-02T20:00:00Z')).toEqual([]);
    expect(bili('6.5', '2026-10-03T04:00:00Z')).toEqual([]); // 25 hours old: the day-1 line is 11.7
    expect(bili('12.1', '2026-10-03T04:00:00Z')).toEqual(['nb_bili_day1']);
    expect(bili('15', '2026-10-04T04:00:00Z')).toEqual(['nb_bili_day2']);
    expect(bili('18', '2026-10-05T04:00:00Z')).toEqual(['nb_bili_day3']);
    expect(bili('20', '2026-10-09T04:00:00Z')).toEqual([]);
    expect(bili('21', '2026-10-09T04:00:00Z')).toEqual(['nb_bili_day4']);
    // The age the lab entered with the result is used before the time of the sample
    expect(bili('12.1', '2026-10-02T20:00:00Z', { ageHours: '30' })).toEqual(['nb_bili_day1']);
    // No time of birth and no age entered: the age is not known, so nothing is raised (never a guess)
    expect(bili('19', '2026-10-03T04:00:00Z', {}, null)).toEqual([]);
    expect(bili('19', '2026-10-03T04:00:00Z', { ageHours: '26' }, null)).toEqual(['nb_bili_day1']);
    // Direct bilirubin and a low blood sugar need no age
    expect(bili('4', '2026-10-03T04:00:00Z', { direct: '1.4' }, null)).toEqual(['nb_bili_direct']);
    expect(keysOf(redFlagFacts({ careType: 'newborn', today: TODAY, lab: labReadings([order([['nb_sugar', { glucose: '38' }]])]) }))).toEqual(['nb_lab_sugar_low']);
    expect(ageText({ fromDay: 0, toDay: 0 })).toBe('baby under 1 day old');
    expect(ageText({ fromDay: 1, toDay: 1 })).toBe('baby 1 day old');
    expect(ageText({ fromDay: 4, toDay: null })).toBe('baby 4 days old or more');
    expect(ageText({ fromDay: 2, toDay: 6 })).toBe('baby 2–6 days old');
    expect(ageText({ fromDay: null, toDay: 3 })).toBe('baby up to 3 days old');
  });
});

describe('the nursing chart of a patient in hospital', () => {
  const entry = (at, vitals, extra = {}) => ({ kind: 'vitals', at: new Date(at), admissionId: 'a1', vitals, ...extra });

  it('keeps the latest value of each vital sign; an entry marked entered in error does not count', () => {
    const r = chartReadings([
      entry('2026-10-04T02:00:00Z', { bpSystolic: 166, bpDiastolic: 112, temperatureF: 101.2 }),
      entry('2026-10-04T04:00:00Z', { pulse: 96 }), // no BP: the 02:00 reading is still the latest BP
      entry('2026-10-04T05:00:00Z', { pulse: 150, bpSystolic: 200, bpDiastolic: 130 }, { cancelled: { reason: 'Wrong patient' } }),
      { kind: 'note', at: new Date('2026-10-04T05:30:00Z'), admissionId: 'a1' },
    ]);
    expect(r.bp).toMatchObject({ systolic: 166, diastolic: 112, at: new Date('2026-10-04T02:00:00Z'), admissionId: 'a1' });
    expect(r.pulse).toMatchObject({ value: 96 });
    expect(r.temperatureF).toMatchObject({ value: 101.2 });
    expect(r.spo2).toBeNull();
  });

  it('raises the same flags as a visit, says where the value is from, and replaces the visit value when it is newer', () => {
    const chart = chartReadings([entry('2026-10-04T02:00:00Z', { bpSystolic: 166, bpDiastolic: 112 })]);
    // The visit of two days ago had a normal BP and a low Hb: the chart's BP is used, the visit's Hb stays
    const earlier = visit({ bpSystolic: 120, bpDiastolic: 80, hb: 6.8 }, D('2026-10-02'));
    const flags = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'antenatal', visit: earlier, edd: EDD, today: TODAY, chart }));
    expect(flags.map((f) => f.key)).toEqual(['bp_severe_sys', 'hb_severe']);
    expect(flags[0].sources).toEqual([{ source: 'chart', at: new Date('2026-10-04T02:00:00Z'), admissionId: 'a1' }]);
    expect(flagFromText(flags[0])).toBe('from the nursing chart, 4 Oct 2026, 07:30'); // the hospital's time
    expect(flagFromText(flags[1])).toBe('from the visit on 2 Oct 2026');
    // A visit recorded after the chart entry wins: her BP was normal at 11:00
    const later = visit({ bpSystolic: 124, bpDiastolic: 82, at: new Date('2026-10-04T05:30:00Z') });
    expect(keysOf(redFlagFacts({ careType: 'antenatal', visit: later, edd: EDD, today: TODAY, chart }))).toEqual([]);
    // After delivery the postnatal rules are used for the same chart
    expect(keysOf(redFlagFacts({ careType: 'postnatal', today: TODAY, chart }))).toEqual(['pn_bp_severe_sys']);
  });

  it('a visit saved again later never hides a newer chart reading – when nobody can tell which is newer, both are checked', () => {
    const at12 = '2026-10-04T06:30:00Z'; // 12:00 in the hospital
    const flagsOf = (v, chartVitals) => evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'antenatal', visit: v, edd: EDD, today: TODAY, chart: chartReadings([entry(at12, chartVitals)]) }));
    // The visit began at 10:00 with BP 120/80; at 13:00 an Hb was added, so the visit's one "saved" time is 13:00
    const resaved = (vitals) => visit({ ...vitals, rev: 2, at: new Date('2026-10-04T07:30:00Z') }, TODAY, { createdAt: new Date('2026-10-04T04:30:00Z') });
    const kept = flagsOf(resaved({ bpSystolic: 120, bpDiastolic: 80, hb: 11.6 }), { bpSystolic: 170, bpDiastolic: 110 });
    expect(kept.map((f) => [f.key, f.detail, f.sources[0].source])).toEqual([['bp_severe_sys', 'BP 170/110 mmHg', 'chart']]);
    // The other way round: a normal BP on the chart does not hide a severe BP of that visit
    const fromVisit = flagsOf(resaved({ bpSystolic: 172, bpDiastolic: 112 }), { bpSystolic: 124, bpDiastolic: 80 });
    expect(fromVisit.map((f) => [f.key, f.detail, f.sources[0].source])).toEqual([['bp_severe_sys', 'BP 172/112 mmHg', 'visit']]);
    // Both raised: one line for each reading, each saying where it is from
    const both = flagsOf(resaved({ bpSystolic: 172, bpDiastolic: 112, pulse: 90 }), { bpSystolic: 170, bpDiastolic: 110, pulse: 126 });
    expect(both.map((f) => [f.key, f.detail, f.sources[0].source])).toEqual([
      ['bp_severe_sys', 'BP 170/110 mmHg', 'chart'],
      ['bp_severe_sys', 'BP 172/112 mmHg', 'visit'],
      ['pulse_high', 'Pulse 126 /min', 'chart'],
    ]);
    // Saved once, the time is known: before the chart entry the chart's reading replaces it …
    const once = (at, vitals) => visit({ ...vitals, rev: 1, at: new Date(at) }, TODAY, { createdAt: new Date('2026-10-04T04:30:00Z') });
    expect(flagsOf(once('2026-10-04T04:35:00Z', { bpSystolic: 172, bpDiastolic: 112 }), { bpSystolic: 124, bpDiastolic: 80 })).toEqual([]);
    // … and after it the visit's does
    expect(flagsOf(once('2026-10-04T07:30:00Z', { bpSystolic: 124, bpDiastolic: 80 }), { bpSystolic: 170, bpDiastolic: 110 })).toEqual([]);
    // A visit entered for an earlier day never outranks the chart of today, however late it was saved
    const backdated = visit({ bpSystolic: 120, bpDiastolic: 80, rev: 3, at: new Date('2026-10-04T08:00:00Z') }, D('2026-10-02'), { createdAt: new Date('2026-10-04T07:50:00Z') });
    expect(flagsOf(backdated, { bpSystolic: 170, bpDiastolic: 110 }).map((f) => f.key)).toEqual(['bp_severe_sys']);
  });

  it('a value charted in labour, before the delivery, is not a value "after delivery"', () => {
    const entries = [entry('2026-10-04T02:30:00Z', { bpSystolic: 150, bpDiastolic: 95 })]; // 08:00
    const sinceAt = new Date('2026-10-04T04:30:00Z'); // delivered at 10:00
    expect(chartReadings(entries, { since: TODAY, sinceAt }).bp).toBeNull();
    expect(chartReadings(entries, { since: TODAY }).bp).toMatchObject({ systolic: 150 }); // a delivery typed as a date: the whole day
    expect(chartReadings([...entries, entry('2026-10-04T05:00:00Z', { bpSystolic: 152, bpDiastolic: 96 })], { since: TODAY, sinceAt }).bp).toMatchObject({ systolic: 152 });
  });
});

describe('the words', () => {
  it('the website says every rule and the "not checked" sentence in the same words', () => {
    expect(website.RED_FLAGS_NOT_CHECKED).toBe(RED_FLAGS_NOT_CHECKED);
    expect(RED_FLAGS_NOT_CHECKED).toMatch(/symptoms written as text/);
    for (const r of BUILT_IN_RED_FLAG_RULES) expect(website.ruleChecksText(r), r.key).toBe(ruleText(r));
    expect([...website.RULE_CARE_TYPES].sort()).toEqual([...RED_FLAG_CARE_TYPES].sort());
    expect(website.ruleCareTypes({})).toEqual(['antenatal']);
    expect(Object.keys(website.RULE_CARE_LABELS).sort()).toEqual([...RED_FLAG_CARE_TYPES].sort());
    expect(website.FACTOR_GROUPS.map((g) => g.key).sort()).toEqual([...new Set(Object.values(RED_FLAG_FACTORS).map((f) => f.group))].sort());
    const groups = website.rulesByCareType(BUILT_IN_RED_FLAG_RULES);
    expect(groups.map((g) => g.careType)).toEqual(['antenatal', 'postnatal', 'newborn', 'abortion']);
    expect(groups.find((g) => g.careType === 'postnatal').rules.map((r) => r.key)).toContain('lab_platelets_low'); // listed under both of its types
    expect(website.appliesToText({ appliesTo: ['postnatal', 'antenatal'] })).toBe('Pregnancy (antenatal), After delivery (postnatal)');
  });

  it('the text for the AI brief says where each flag is from – and never a name', () => {
    const lab = labReadings([order([['cbc', { hb: '6.4' }]])]);
    const flags = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType: 'postnatal', today: TODAY, lab, chart: chartReadings([{ kind: 'vitals', at: new Date('2026-10-04T02:00:00Z'), admissionId: 'a1', vitals: { pulse: 124 } }]) }));
    const work = { redFlags: [{ patient: { id: 'p1', fullName: 'Sample Mother', mrn: 'P-000009' }, flags }], rules: { status: 'draft' } };
    const { text } = todayBriefText({ work, facts: new Map(), now: NOW, scope: 'all' });
    expect(text).toContain("## Red flags (from each patient's latest visit, lab results and, in hospital, the nursing chart; the red-flag rules are still a draft, not yet approved by a doctor)");
    expect(text).toContain('[P1] urgent: Fast pulse after delivery (Pulse 124 /min) from the nursing chart, 4 Oct 2026, 07:30; urgent: Severe anaemia after delivery (Haemoglobin (lab) 6.4 g/dL) from the lab result of 3 Oct 2026');
    expect(text).not.toMatch(/Sample Mother|P-000009/);
  });

  it("the AI's text about one patient says when the flags come from draft rules – for every type of care", async () => {
    const p = await postnatal();
    await visitWith(p, { temperatureF: 102 });
    const req = { tenantId: hospital._id, user: people.drA, now: new Date() };
    const text = async () => patientContext(req, await Patient.findOne({ tenantId: hospital._id, _id: p.id }));
    const draft = await text();
    expect(draft).toContain('Red flags (from draft rules, not yet approved by a doctor – reminders only): Fever after delivery [urgent] Temperature 102 °F – from the visit on 4 Oct 2026');
    expect(draft).not.toMatch(/Delivered Mother|P-0000/);
    // Once a doctor has approved the rules the flags are no longer called a draft
    const version = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet.version;
    expect((await (await as('drA')).post('/api/red-flag-rules/approve').send({ confirm: true, version })).status).toBe(200);
    const approved = await text();
    expect(approved).toContain('Red flags: Fever after delivery [urgent]');
    expect(approved).not.toContain('draft rules');
  });

  it('this pregnancy or episode of care begins: two weeks before the LMP, at the delivery, at birth, or three months ago', () => {
    expect(episodeSince({ careType: 'antenatal', pregnancy: { effectiveEdd: EDD } }, NOW)).toEqual(D('2026-05-11'));
    expect(episodeSince({ careType: 'postnatal', lastDelivery: { at: new Date('2026-09-20T20:00:00Z') } }, NOW)).toEqual(D('2026-09-21')); // 01:30 on the 21st in India
    expect(episodeSince({ careType: 'postnatal' }, NOW)).toEqual(D('2026-08-23')); // no delivery on the record: six weeks
    expect(episodeSince({ careType: 'newborn', newborn: { birthAt: new Date('2026-10-01T03:00:00Z') } }, NOW)).toEqual(D('2026-10-01'));
    expect(episodeSince({ careType: 'newborn', newborn: {} }, NOW)).toBeNull();
    expect(episodeSince({ careType: 'gynaecology' }, NOW)).toEqual(D('2026-07-06'));
  });

  it('a mother still recorded as pregnancy care after her confirmed delivery is checked with the rules for care after delivery', () => {
    const delivered = { at: new Date('2026-10-03T08:00:00Z'), mode: 'normal', documentId: 'd1' };
    const pregnant = { careType: 'antenatal', pregnancy: { effectiveEdd: D('2026-10-10') } };
    expect(flagEpisode(pregnant, NOW)).toMatchObject({ careType: 'antenatal', delivered: false, visitTypes: ['antenatal'], sinceAt: null });
    // The delivery note of this pregnancy was confirmed: postnatal rules, from the moment of the delivery
    expect(flagEpisode({ ...pregnant, lastDelivery: delivered }, NOW)).toEqual({ careType: 'postnatal', visitTypes: ['antenatal', 'postnatal'], delivered: true, since: D('2026-10-03'), sinceAt: delivered.at, notALossNow: false });
    // A delivery of an earlier pregnancy on the same record changes nothing
    expect(flagEpisode({ ...pregnant, lastDelivery: { ...delivered, at: new Date('2025-06-01T08:00:00Z') } }, NOW)).toMatchObject({ careType: 'antenatal', delivered: false });
    // No pregnancy dates on the record (she came in labour): a delivery in the last six weeks counts, an older one does not
    expect(flagEpisode({ careType: 'antenatal', lastDelivery: delivered }, NOW)).toMatchObject({ careType: 'postnatal', delivered: true });
    expect(flagEpisode({ careType: 'antenatal', lastDelivery: { ...delivered, at: new Date('2026-07-01T08:00:00Z') } }, NOW)).toMatchObject({ careType: 'antenatal', delivered: false });
    // A postnatal record: the time counts only when a delivery note gave it (a typed date has none)
    expect(flagEpisode({ careType: 'postnatal', lastDelivery: delivered }, NOW)).toMatchObject({ careType: 'postnatal', delivered: false, since: D('2026-10-03'), sinceAt: delivered.at });
    expect(flagEpisode({ careType: 'postnatal', lastDelivery: { at: D('2026-10-03'), mode: 'normal', documentId: null } }, NOW)).toMatchObject({ since: D('2026-10-03'), sinceAt: null });
    // A hospital whose rules have none for care after delivery (approved before there were any): her pregnancy rules
    // stay in use rather than nothing – from the start of the pregnancy, marked as delivered
    expect(flagEpisode({ ...pregnant, lastDelivery: delivered }, NOW, { postnatalRules: false })).toEqual({ careType: 'antenatal', visitTypes: ['antenatal'], delivered: true, since: D('2025-12-20'), sinceAt: null, notALossNow: false });
    // "41 weeks or more – plan delivery" is not raised once she has delivered
    const facts = (extra) => redFlagFacts({ careType: 'antenatal', edd: D('2026-09-20'), today: TODAY, ...extra });
    expect(keysOf(facts({}))).toEqual(['postdates']);
    expect(keysOf(facts({ delivered: true }))).toEqual([]);
  });
});

// ---------- Through the app ----------

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Wider Flags Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const at = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
async function register(overrides = {}, who = 'drA') {
  const res = await (await as(who)).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Flag Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      medical: { allergies: 'None known', bloodGroup: 'B+' },
      ...overrides,
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const postnatal = (overrides = {}) => register({ careType: 'postnatal', fullName: 'Delivered Mother', pregnancy: undefined, ...overrides });
const baby = (overrides = {}) =>
  register({ careType: 'newborn', fullName: 'Baby Sample', ageYears: undefined, pregnancy: undefined, medical: undefined, newborn: { birthAt: '2026-10-02T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' }, ...overrides });
async function visitWith(p, vitals, body = {}, who = 'drA') {
  const res = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const saved = await (await as(who)).patch(`/api/patients/${p.id}/visits/${res.body.visit.id}`).send({ vitals: { rev: 0, ...vitals } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body;
}
const record = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
const flagKeys = async (who, p) => (await record(who, p)).redFlags?.flags.map((f) => f.key);
const lab = (path) => `/api/lab/orders/${path}`;
async function labOrder(p, tests) {
  const res = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((key) => ({ key })) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order;
}
const putResults = async (who, o, tests, body = {}) => (await as(who)).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests, ...body });
const cbc = (hb) => [{ key: 'cbc', values: [{ key: 'hb', value: hb }, { key: 'tlc', value: '8000' }, { key: 'platelets', value: '2.1' }] }];
const admit = async (p, who = 'drA') => {
  const res = await (await as(who)).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-04T01:00:00.000Z', ward: 'Ward 1', bed: '4', reason: 'For observation' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.admission;
};
const chart = async (who, p, a, vitals, extra = {}) => (await as(who)).post(`/api/patients/${p.id}/admissions/${a.id}/nursing`).send({ clientRequestId: randomUUID(), kind: 'vitals', vitals, ...extra });
const stay = async (who, p, a) => (await (await as(who)).get(`/api/patients/${p.id}/admissions/${a.id}`)).body;
const listPill = async (who, p) => (await (await as(who)).get('/api/patients?limit=100')).body.patients.find((x) => x.id === p.id).redFlags;
const todayFlags = async (who, scope = '') => (await (await as(who)).get(`/api/worklist${scope}`)).body.redFlags.map((r) => [r.patient.fullName, r.flags.map((f) => f.key)]);
// A delivery note written and confirmed by her doctor (the delivery is then on her record, with its time)
async function confirmDelivery(p, a, deliveredAt) {
  const docs = `/api/patients/${p.id}/admissions/${a.id}/documents`;
  const d = (await (await as('drA')).post(docs).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
  const content = { deliveredAt, mode: 'normal', gestationWeeks: 40, bloodLossMl: 300, babies: [{ sex: 'female', weightGrams: 3100, apgar1: 8, apgar5: 9, outcome: 'live' }] };
  const saved = await (await as('drA')).put(`${docs}/${d.id}`).send({ rev: d.rev, content });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const signed = await (await as('drA')).post(`${docs}/${d.id}/sign`).send({ rev: saved.body.document.rev });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
}

describe('lab results raise flags once the lab reports them', () => {
  it('not while only saved; from the report; again with the new values when amended; never for reception or the lab', async () => {
    const p = await register();
    const o = await labOrder(p, ['cbc']);
    const collected = (await (await as('lab')).post(lab(`${o.id}/collect`)).send({ rev: o.rev })).body.order;
    const saved = await putResults('lab', collected, cbc('6.4'));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await flagKeys('drA', p)).toEqual([]); // saved, not reported

    const reported = (await putResults('lab', saved.body.order, cbc('6.4'), { report: true })).body.order;
    expect(reported.status).toBe('reported');
    const seen = (await record('nurse', p)).redFlags; // before any doctor has reviewed it
    expect(seen.flags.map((f) => f.key)).toEqual(['lab_hb_severe']);
    expect(seen.flags[0]).toMatchObject({ detail: 'Haemoglobin (lab) 6.4 g/dL', rule: 'Haemoglobin (lab) under 7 g/dL', sources: [{ source: 'lab', on: '2026-10-04T00:00:00.000Z', orderId: o.id }] });
    expect(seen.rules).toMatchObject({ status: 'draft' });
    expect(seen.visitId).toBeNull();

    // Reception and the lab never get red flags; nothing about them is in what the lab is sent
    expect((await record('reception', p)).redFlags).toBeUndefined();
    expect((await record('lab', p)).redFlags).toBeUndefined();
    expect(JSON.stringify((await (await as('lab')).get(lab(o.id))).body)).not.toMatch(/redFlags|Severe anaemia/);
    expect(JSON.stringify(reported)).not.toMatch(/redFlags/);

    // The Patients list pill and Today's worklist
    const row = (await (await as('drA')).get('/api/patients')).body.patients.find((x) => x.id === p.id);
    expect(row.redFlags).toEqual({ count: 1, urgent: 1 });
    expect((await (await as('reception')).get('/api/patients')).body.patients.find((x) => x.id === p.id).redFlags).toBeUndefined();
    const work = (await (await as('drA')).get('/api/worklist')).body;
    expect(work.redFlags.map((r) => [r.patient.fullName, r.flags.map((f) => f.key)])).toEqual([['Flag Mother', ['lab_hb_severe']]]);

    // The doctor's review changes nothing about the flag; an amended report does
    const reviewed = (await (await as('drA')).post(lab(`${o.id}/review`)).send({ rev: reported.rev, comment: 'Admitted for transfusion' })).body.order;
    expect(await flagKeys('drA', p)).toEqual(['lab_hb_severe']);
    const amended = await putResults('lab', reviewed, cbc('8.4'), { reason: 'Typing mistake corrected' });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);
    expect(await flagKeys('drA', p)).toEqual(['lab_hb_moderate']);
    const fixed = await putResults('lab', amended.body.order, cbc('11.6'), { reason: 'Repeat sample' });
    expect(fixed.status).toBe(200);
    expect(await flagKeys('drA', p)).toEqual([]);

    // The visit page shows the flags of the visit's own values only
    const page = await visitWith(p, { bpSystolic: 118, bpDiastolic: 76 });
    expect(page.redFlags.flags).toEqual([]);
    // The audit log never holds a value or a flag
    const entries = await AuditLog.find({ tenantId: hospital._id }).lean();
    expect(JSON.stringify(entries.map((e) => e.details))).not.toMatch(/6\.4|Severe anaemia|lab_hb/);
  });

  it("a flag from a lab result alone leaves Today's list after six weeks and stays on the record; a newer visit value replaces a lab value", async () => {
    at('2026-08-01T06:00:00Z');
    const p = await register();
    const o = await labOrder(p, ['ogtt', 'cbc']);
    const tests = [{ key: 'ogtt', values: [{ key: 'glucose2h', value: '152' }] }, ...cbc('10.4')];
    expect((await putResults('lab', o, tests, { report: true })).status).toBe(200);
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['lab_hb_mild', 'lab_ogtt_gdm']]]);
    // Nine weeks later neither test was repeated: the record, the header and the Patients list still show both …
    at('2026-10-04T06:00:00Z');
    expect(await flagKeys('drA', p)).toEqual(['lab_hb_mild', 'lab_ogtt_gdm']);
    expect(await listPill('drA', p)).toEqual({ count: 2, urgent: 0 });
    // … but the daily list no longer does (it would only grow: an OGTT is never repeated)
    expect(await todayFlags('drA')).toEqual([]);
    // A visit today measures the Hb again: 11.8 replaces the lab's 10.4 of August – the anaemia flag is gone everywhere
    await visitWith(p, { hb: 11.8, bpSystolic: 118, bpDiastolic: 76 });
    expect(await flagKeys('drA', p)).toEqual(['lab_ogtt_gdm']);
    // A flag of her latest visit stays on Today until the next visit, as it always did – also beside an old lab flag
    at('2026-10-04T08:00:00Z'); // a second visit, later the same day
    await visitWith(p, { hb: 11.8, bpSystolic: 150, bpDiastolic: 96 });
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['htn_sys']]]);
    expect(await flagKeys('drA', p)).toEqual(['htn_sys', 'lab_ogtt_gdm']);
    // In hospital she is listed with every flag
    await admit(p);
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['htn_sys', 'lab_ogtt_gdm']]]);
  });

  it('a result from before this pregnancy does not count', async () => {
    const p = await register();
    const o = await labOrder(p, ['cbc']);
    await putResults('lab', o, cbc('6.4'), { report: true });
    expect(await flagKeys('drA', p)).toEqual(['lab_hb_severe']);
    // The same record is used for her next pregnancy, with its own dates: that pregnancy began after the sample
    at('2027-06-01T06:00:00Z');
    const patched = await (await as('drA')).patch(`/api/patients/${p.id}`).send({ pregnancy: { scanEdd: '2028-02-01' } });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(await flagKeys('drA', p)).toEqual([]);
  });
});

describe('postnatal and newborn patients', () => {
  it('a postnatal visit raises the postnatal rules – on the visit page, the record, the Patients list and Today', async () => {
    const p = await postnatal();
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-09-28', mode: 'normal' } })).status).toBe(200);
    const page = await visitWith(p, { bpSystolic: 150, bpDiastolic: 96, temperatureF: 101, pulse: 118, hb: 6.6 }, {}, 'nurse');
    expect(page.redFlags.flags.map((f) => f.key)).toEqual(['pn_fever', 'pn_pulse_high', 'pn_hb_severe', 'pn_bp_sys']);
    expect(page.redFlags.flags.every((f) => f.sources[0].source === 'visit' && f.sources[0].visitId === page.visit.id)).toBe(true);
    expect((await record('drA', p)).redFlags.flags.map((f) => f.key)).toEqual(['pn_fever', 'pn_pulse_high', 'pn_hb_severe', 'pn_bp_sys']);
    expect((await record('reception', p)).redFlags).toBeUndefined();
    const row = (await (await as('nurse')).get('/api/patients')).body.patients.find((x) => x.id === p.id);
    expect(row.redFlags).toEqual({ count: 4, urgent: 3 });
    const work = (await (await as('drA')).get('/api/worklist')).body;
    expect(work.redFlags).toHaveLength(1);
    expect(work.redFlags[0].patient).toMatchObject({ fullName: 'Delivered Mother', careType: 'postnatal', gestationalAge: null, risk: null });
    expect(work.seenToday.map((v) => v.flagged)).toEqual([true]);
    expect((await (await as('reception')).get('/api/worklist')).status).toBe(403);
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'WORKLIST_VIEWED' }).lean();
    expect(entry.details).toMatchObject({ scope: 'mine', redFlags: 1 });
  });

  it('without a delivery date the last six weeks count, with one everything since the delivery; Today lists a postnatal patient for six weeks', async () => {
    expect(RED_FLAG_LIST_DAYS).toBe(42);
    const p = await postnatal();
    await visitWith(p, { bpSystolic: 166, bpDiastolic: 112 }, { visitOn: '2026-08-10' });
    // No delivery on the record: the last six weeks count – the visit of 10 Aug is older
    expect(await flagKeys('drA', p)).toEqual([]);
    await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-08-01', mode: 'normal' } });
    expect(await flagKeys('drA', p)).toEqual(['pn_bp_severe_sys']); // after the delivery: counts, whatever its age
    // … but Today no longer lists her: the value is more than six weeks old and she is not in hospital
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags).toEqual([]);
    const q = await postnatal({ fullName: 'Recent Mother' });
    await visitWith(q, { temperatureF: 102 }, { visitOn: '2026-09-01' });
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags.map((r) => r.patient.fullName)).toEqual(['Recent Mother']);
    // Another doctor's patients are left out of "my patients", sensitive ones of everything
    const theirs = await postnatal({ fullName: 'Other Mother', assignedDoctor: people.drB._id.toString() });
    await visitWith(theirs, { temperatureF: 102 }, {}, 'drB');
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags.map((r) => r.patient.fullName)).toEqual(['Recent Mother']);
    expect((await (await as('drA')).get('/api/worklist?scope=all')).body.redFlags.map((r) => r.patient.fullName).sort()).toEqual(['Other Mother', 'Recent Mother']);
    await (await as('drB')).patch(`/api/patients/${theirs.id}/sensitive`).send({ sensitive: true });
    expect((await (await as('drA')).get('/api/worklist?scope=all')).body.redFlags.map((r) => r.patient.fullName)).toEqual(['Recent Mother']);
    expect((await (await as('nurse')).get('/api/worklist')).body.redFlags.map((r) => r.patient.fullName)).toEqual(['Recent Mother']);
  });

  it('the Patients list, the record and Today count from the same day: the delivery on the record', async () => {
    // Delivered on 1 Aug – more than six weeks ago – with a severe BP at a postnatal visit on 10 Aug
    const p = await postnatal();
    await visitWith(p, { bpSystolic: 166, bpDiastolic: 112 }, { visitOn: '2026-08-10' });
    expect((await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-08-01', mode: 'normal' } })).status).toBe(200);
    expect(await flagKeys('drA', p)).toEqual(['pn_bp_severe_sys']);
    expect(await listPill('drA', p)).toEqual({ count: 1, urgent: 1 }); // the list reads the delivery date itself
    expect(await listPill('nurse', p)).toEqual({ count: 1, urgent: 1 });
    expect(await listPill('reception', p)).toBeUndefined();

    // A visit and a lab result of 15 Sep, then a delivery on 20 Sep: both are from before the delivery
    at('2026-09-15T06:00:00Z');
    const q = await postnatal({ fullName: 'Second Mother' });
    await visitWith(q, { bpSystolic: 166, bpDiastolic: 112 });
    const o = await labOrder(q, ['cbc']);
    expect((await putResults('lab', o, cbc('6.4'), { report: true })).status).toBe(200);
    expect(await flagKeys('drA', q)).toEqual(['pn_bp_severe_sys', 'pn_lab_hb_severe']); // no delivery on the record yet: the last six weeks
    at('2026-10-04T06:00:00Z');
    expect((await (await as('drA')).patch(`/api/patients/${q.id}`).send({ delivery: { on: '2026-09-20', mode: 'lscs' } })).status).toBe(200);
    expect(await flagKeys('drA', q)).toEqual([]);
    expect(await listPill('drA', q)).toBeNull();
    expect((await todayFlags('drA')).map(([name]) => name)).not.toContain('Second Mother');
    // A visit after the delivery raises its flag in all three places
    await visitWith(q, { temperatureF: 102 }, { visitOn: '2026-09-25' });
    expect(await flagKeys('drA', q)).toEqual(['pn_fever']);
    expect(await listPill('drA', q)).toEqual({ count: 1, urgent: 1 });
    expect(await todayFlags('drA')).toEqual([['Second Mother', ['pn_fever']]]);
  });

  it('a baby: temperature and weight at the visit, bilirubin and blood sugar from the lab', async () => {
    const b = await baby();
    const page = await visitWith(b, { weightKg: 2.6, temperatureF: 97.2 });
    expect(page.redFlags.flags.map((f) => f.key)).toEqual(['nb_weight_loss', 'nb_temp_low']);
    expect(page.redFlags.flags[0].detail).toBe('Weight 2.6 kg – 13.3 % below the birth weight of 3000 g');

    // Bilirubin 13 mg/dL at 30 hours of age, and a low blood sugar
    const o = await labOrder(b, ['nb_bilirubin', 'nb_sugar']);
    const res = await putResults('lab', o, [
      { key: 'nb_bilirubin', values: [{ key: 'ageHours', value: '30' }, { key: 'total', value: '13' }, { key: 'direct', value: '0.6' }] },
      { key: 'nb_sugar', values: [{ key: 'glucose', value: '41' }] },
    ], { report: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const flags = (await record('rmo', b)).redFlags.flags;
    expect(flags.map((f) => f.key)).toEqual(['nb_weight_loss', 'nb_bili_day1', 'nb_lab_sugar_low', 'nb_temp_low']);
    expect(flags.find((f) => f.key === 'nb_bili_day1')).toMatchObject({ level: 'urgent', detail: "Baby's total bilirubin (lab) 13 mg/dL", rule: "Baby's total bilirubin (lab) over 11.7 mg/dL, baby 1 day old" });
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags.map((r) => [r.patient.fullName, r.patient.careType, r.flags.length])).toEqual([['Baby Sample', 'newborn', 4]]);
    expect((await record('reception', b)).redFlags).toBeUndefined();
  });

  it('a patient of a type of care without rules has no flags', async () => {
    const g = await register({ careType: 'gynaecology', fullName: 'Gynae Patient', pregnancy: undefined });
    const page = await visitWith(g, { bpSystolic: 170, bpDiastolic: 112, hb: 6 });
    expect(page.redFlags.flags).toEqual([]);
    expect((await record('drA', g)).redFlags.flags).toEqual([]);
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags).toEqual([]);
  });
});

describe('patients in hospital', () => {
  it('the nursing chart raises flags on the stay page, the inpatient list and Today – for those who may see medical details', async () => {
    const p = await register();
    const a = await admit(p);
    expect((await (await as('nurse')).get(`/api/patients/${p.id}/admissions/${a.id}`)).body.redFlags.flags).toEqual([]);
    at('2026-10-04T07:00:00Z');
    const charted = await chart('nurse', p, a, { bpSystolic: 166, bpDiastolic: 112, pulse: 96, temperatureF: 98.6 });
    expect(charted.status, JSON.stringify(charted.body)).toBe(201);
    // The answer to charting already has the flag (the page shows it at once)
    expect(charted.body.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys']);
    expect(charted.body.redFlags.flags[0]).toMatchObject({ detail: 'BP 166/112 mmHg', sources: [{ source: 'chart', at: '2026-10-04T07:00:00.000Z', admissionId: a.id }] });
    expect(charted.body.redFlags.rules.status).toBe('draft');

    // A later entry without a BP does not clear it; a normal BP does
    at('2026-10-04T08:00:00Z');
    expect((await chart('nurse', p, a, { pulse: 124 })).body.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys', 'pulse_high']);

    const list = (await (await as('drA')).get('/api/inpatients')).body;
    expect(list.admitted.map((s) => [s.patient.fullName, s.redFlags.map((f) => f.key)])).toEqual([['Flag Mother', ['bp_severe_sys', 'pulse_high']]]);
    expect(list.rules.status).toBe('draft');
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags.map((r) => r.flags.map((f) => f.key))).toEqual([['bp_severe_sys', 'pulse_high']]);
    expect((await record('drA', p)).redFlags).toMatchObject({ admissionId: a.id });
    expect((await (await as('drA')).get('/api/patients')).body.patients.find((x) => x.id === p.id).redFlags).toEqual({ count: 2, urgent: 1 });

    // Reception and the lab get neither list nor stay; another doctor reads the stay (not sensitive) with its flags
    for (const who of ['reception', 'lab']) {
      expect((await (await as(who)).get('/api/inpatients')).status, who).toBe(403);
      expect((await (await as(who)).get(`/api/patients/${p.id}/admissions/${a.id}`)).status, who).toBe(403);
    }
    expect((await (await as('drB')).get(`/api/patients/${p.id}/admissions/${a.id}`)).body.redFlags.flags).toHaveLength(2);
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true });
    expect((await (await as('drB')).get(`/api/patients/${p.id}/admissions/${a.id}`)).status).toBe(403);
    expect((await (await as('drB')).get('/api/inpatients')).body.admitted).toEqual([]);
    expect((await (await as('nurse')).get('/api/inpatients')).body.admitted).toEqual([]);
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: false });

    at('2026-10-04T09:00:00Z');
    const normal = await chart('rmo', p, a, { bpSystolic: 128, bpDiastolic: 84, pulse: 92 });
    expect(normal.body.redFlags.flags).toEqual([]);
    // That entry was a mistake: marked entered in error, the earlier values count again
    const wrong = normal.body.nursing.find((e) => e.vitals?.bpSystolic === 128);
    const undone = await (await as('rmo')).post(`/api/patients/${p.id}/admissions/${a.id}/nursing/${wrong.id}/cancel`).send({ reason: 'Charted on the wrong patient' });
    expect(undone.body.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys', 'pulse_high']);

    // The audit log has ids only
    const entries = await AuditLog.find({ tenantId: hospital._id, action: /^(NURSING|ADMISSION)/ }).lean();
    expect(JSON.stringify(entries.map((e) => safeAuditDetails(e.action, e.details)))).not.toMatch(/mmHg|Severe-range|bp_severe|redFlags/);
  });

  it('uses the rules of her type of care now, and a stay that ended shows no flags', async () => {
    const p = await postnatal();
    await (await as('drA')).patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-10-03', mode: 'lscs' } });
    const a = await admit(p);
    at('2026-10-04T07:00:00Z');
    const charted = await chart('nurse', p, a, { pulse: 124, temperatureF: 101.4 });
    expect(charted.body.redFlags.flags.map((f) => f.key)).toEqual(['pn_fever', 'pn_pulse_high']);
    expect((await (await as('drA')).get('/api/inpatients')).body.admitted[0].redFlags).toHaveLength(2);

    // Discharged: the stay's page has no flags, and the chart of a stay that ended raises none on her record
    const d = (await (await as('drA')).post(`/api/patients/${p.id}/admissions/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'discharge' })).body.document;
    const content = { ...d.content, dischargedAt: '2026-10-04T06:30:00.000Z', finalDiagnosis: 'Puerperal fever, settled' };
    const savedDoc = await (await as('drA')).put(`/api/patients/${p.id}/admissions/${a.id}/documents/${d.id}`).send({ rev: d.rev, content });
    expect(savedDoc.status, JSON.stringify(savedDoc.body)).toBe(200);
    const signed = await (await as('drA')).post(`/api/patients/${p.id}/admissions/${a.id}/documents/${d.id}/sign`).send({ rev: savedDoc.body.document.rev });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const after = (await (await as('drA')).get(`/api/patients/${p.id}/admissions/${a.id}`)).body;
    expect(after.admission.status).toBe('discharged');
    expect(after.redFlags).toBeUndefined();
    expect(await flagKeys('drA', p)).toEqual([]);
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags).toEqual([]);
  });

  it('saving the visit again later does not hide a newer, worse reading on the nursing chart', async () => {
    at('2026-10-04T04:30:00Z'); // 10:00 – a visit with a normal BP, then she is admitted
    const p = await register();
    const page = await visitWith(p, { bpSystolic: 120, bpDiastolic: 80 });
    const a = await admit(p);
    at('2026-10-04T06:30:00Z'); // 12:00 – a severe BP on the chart
    expect((await chart('nurse', p, a, { bpSystolic: 170, bpDiastolic: 110 })).body.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys']);
    at('2026-10-04T07:30:00Z'); // 13:00 – someone adds the Hb to the same visit
    const again = await (await as('nurse')).patch(`/api/patients/${p.id}/visits/${page.visit.id}`).send({ vitals: { rev: 1, bpSystolic: 120, bpDiastolic: 80, hb: 11.6 } });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const flags = (await stay('drA', p, a)).redFlags.flags;
    expect(flags.map((f) => [f.key, f.detail, f.sources[0].source])).toEqual([['bp_severe_sys', 'BP 170/110 mmHg', 'chart']]);
    expect(await flagKeys('drA', p)).toEqual(['bp_severe_sys']);
    expect(await listPill('drA', p)).toEqual({ count: 1, urgent: 1 });
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['bp_severe_sys']]]);
    expect((await (await as('drA')).get('/api/inpatients')).body.admitted[0].redFlags.map((f) => f.key)).toEqual(['bp_severe_sys']);
    // A normal BP charted later clears it, as before
    at('2026-10-04T08:30:00Z');
    expect((await chart('nurse', p, a, { bpSystolic: 126, bpDiastolic: 82 })).body.redFlags.flags).toEqual([]);
  });

  it('after the confirmed delivery she is checked with the rules for care after delivery, from the moment of the birth', async () => {
    at('2026-10-04T02:00:00Z');
    const p = await register({ pregnancy: { scanEdd: '2026-09-26' } }); // 41 weeks today
    const earlier = await visitWith(p, { bpSystolic: 118, bpDiastolic: 76 }, { visitOn: '2026-09-30' });
    const a = await admit(p);
    at('2026-10-04T02:30:00Z'); // 08:00, in labour
    const inLabour = await chart('nurse', p, a, { bpSystolic: 150, bpDiastolic: 95, temperatureF: 101, pulse: 96 });
    expect(inLabour.body.redFlags).toMatchObject({ careType: 'antenatal', checked: true });
    expect(inLabour.body.redFlags.flags.map((f) => f.key)).toEqual(['postdates', 'htn_sys', 'fever']); // pregnancy rules: fever is "Watch"

    at('2026-10-04T05:00:00Z');
    await confirmDelivery(p, a, '2026-10-04T04:30:00.000Z'); // born at 10:00; the type of care still says pregnancy
    const after = (await stay('nurse', p, a)).redFlags;
    expect(after).toMatchObject({ careType: 'postnatal', checked: true });
    expect(after.flags).toEqual([]); // no "41 weeks – plan delivery", and the values charted in labour are not "after delivery"
    expect(await flagKeys('drA', p)).toEqual([]);
    expect(await listPill('drA', p)).toBeNull();
    expect(await todayFlags('drA')).toEqual([]);
    // The page of a visit before the delivery no longer says "41 weeks or more" either
    expect((await (await as('drA')).get(`/api/patients/${p.id}/visits/${earlier.visit.id}`)).body.redFlags.flags).toEqual([]);

    at('2026-10-04T06:30:00Z'); // 12:00, after the delivery
    const charted = await chart('nurse', p, a, { temperatureF: 101, pulse: 120 });
    expect(charted.body.redFlags.flags.map((f) => [f.key, f.level])).toEqual([['pn_fever', 'urgent'], ['pn_pulse_high', 'urgent']]);
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['pn_fever', 'pn_pulse_high']]]);
    expect(await listPill('drA', p)).toEqual({ count: 2, urgent: 2 });
    // A visit started after the delivery, on the record that still says pregnancy care, is checked the same way
    const pageAfter = await visitWith(p, { bpSystolic: 164, bpDiastolic: 100 });
    expect(pageAfter.redFlags.flags.map((f) => f.key)).toEqual(['pn_bp_severe_sys']);
  });

  it('says which patients are not checked, and the inpatient list is audited with counts only', async () => {
    const p = await register();
    const g = await register({ careType: 'gynaecology', fullName: 'Gynae Patient', pregnancy: undefined });
    const a = await admit(p);
    const b = await admit(g);
    at('2026-10-04T07:00:00Z');
    await chart('nurse', p, a, { bpSystolic: 166, bpDiastolic: 112 });
    expect((await chart('nurse', g, b, { pulse: 130, temperatureF: 103 })).body.redFlags).toMatchObject({ flags: [], checked: false, careType: 'gynaecology' });
    expect((await stay('drA', g, b)).redFlags).toMatchObject({ flags: [], checked: false, careType: 'gynaecology' });
    expect((await stay('drA', p, a)).redFlags).toMatchObject({ checked: true, careType: 'antenatal' });

    const list = (await (await as('nurse')).get('/api/inpatients')).body;
    expect(list.admitted.map((s) => [s.patient.fullName, s.redFlags.length, s.redFlagsChecked, s.redFlagsCareType])).toEqual([
      ['Flag Mother', 1, true, 'antenatal'],
      ['Gynae Patient', 0, false, 'gynaecology'],
    ]);
    // Every answer with flags names the types of care the rules cover, so a page never claims more
    expect(list.rules.careTypes).toEqual(['antenatal', 'postnatal', 'newborn', 'abortion']);
    expect((await (await as('drA')).get('/api/worklist')).body.rules.careTypes).toEqual(['antenatal', 'postnatal', 'newborn', 'abortion']);
    expect(website.checkedCareText(list.rules.careTypes)).toBe(
      'Checked – the types of care that have a rule: Pregnancy (antenatal), After delivery (postnatal), Newborn, Abortion (pregnancy loss). Not checked – no rule applies: Gynaecology, Infertility.',
    );

    // Reading the list is in the audit log: how many patients and how many with flags – no name, value or flag
    const entries = await AuditLog.find({ tenantId: hospital._id, action: 'INPATIENTS_VIEWED' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ admitted: 2, flagged: 1 });
    expect(String(entries[0].actor)).toBe(String(people.nurse._id));
    expect(safeAuditDetails('INPATIENTS_VIEWED', { ...entries[0].details, patientId: 'x', mrn: 'P-1' }, { scope: 'platform' })).toEqual({ admitted: 2, flagged: 1 });
    expect((await (await as('reception')).get('/api/inpatients')).status).toBe(403);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'INPATIENTS_VIEWED' })).toBe(1); // a refusal is not a view
  });

  it("another hospital's staff get 404 for the stay and never see its flags", async () => {
    const p = await register();
    const a = await admit(p);
    await chart('nurse', p, a, { bpSystolic: 166, bpDiastolic: 112 });
    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, other, 'doctor');
    const session = await loginAs(outsider, { app });
    expect((await session.get(`/api/patients/${p.id}/admissions/${a.id}`)).status).toBe(404);
    expect((await session.get(`/api/patients/${p.id}`)).status).toBe(404);
    expect((await session.get('/api/inpatients')).body.admitted).toEqual([]);
    expect((await session.get('/api/worklist?scope=all')).body.redFlags).toEqual([]);
    // … and has its own rules, not this hospital's
    const own = [{ key: 'own_rule', label: 'Own rule', level: 'watch', appliesTo: ['postnatal'], conditions: [{ factor: 'pulse', op: 'gt', value: 100 }] }];
    expect((await session.put('/api/red-flag-rules').send({ version: 1, rules: own })).status).toBe(200);
    expect((await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet.rules).toHaveLength(BUILT_IN_RED_FLAG_RULES.length);
  });
});

describe('the rule set: applies to, lab checks and the built-in upgrade', () => {
  const rule = (extra = {}) => ({ key: 'r1', label: 'Rule one', level: 'watch', message: '', conditions: [{ factor: 'pulse', op: 'gt', value: 110 }], source: '', ...extra });
  const save = async (rules, who = 'drA', version = 1) => (await as(who)).put('/api/red-flag-rules').send({ version, rules });

  it('the built-in rules are a draft of the current built-in version and pass the checks of the edit page as they are', async () => {
    const got = (await (await as('nurse')).get('/api/red-flag-rules')).body.ruleSet;
    expect(got).toMatchObject({ status: 'draft', version: 1, builtInVersion: BUILT_IN_RED_FLAG_VERSION, canEdit: false, newBuiltIn: 0 });
    expect(got.rules).toHaveLength(BUILT_IN_RED_FLAG_RULES.length);
    expect(got.rules.find((r) => r.key === 'pn_fever')).toMatchObject({ appliesTo: ['postnatal'], level: 'urgent' });
    expect(got.rules.find((r) => r.key === 'nb_bili_day4')).toMatchObject({ appliesTo: ['newborn'], fromDay: 4, toDay: null });
    const res = await save(got.rules.map(({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source }) => ({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source })));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ruleSet).toMatchObject({ status: 'draft', version: 2, builtInVersion: null, newBuiltIn: 0 });
    expect(res.body.ruleSet.rules).toHaveLength(BUILT_IN_RED_FLAG_RULES.length);
  });

  it('saves the types of care, and refuses a rule that could never be raised', async () => {
    // A rule sent without "applies to" is a pregnancy rule, as before
    const plain = await save([rule()]);
    expect(plain.body.ruleSet.rules[0].appliesTo).toEqual(['antenatal']);
    const fields = async (r) => (await save([rule(r)], 'drA', 2)).body.error?.fields;
    expect(await fields({ appliesTo: [] })).toEqual({ 'rules.0.appliesTo': 'Tick at least one type of care' });
    expect(await fields({ appliesTo: ['antenatal', 'dental'] })).toHaveProperty(['rules.0.appliesTo.1']);
    // Weeks of pregnancy without pregnancy care; a baby's age without newborn care
    expect(await fields({ appliesTo: ['postnatal'], fromWeek: 20 })).toEqual({ 'rules.0.fromWeek': 'Weeks of pregnancy are only used for antenatal care – tick it above or clear the weeks' });
    expect(await fields({ appliesTo: ['antenatal'], toDay: 3 })).toEqual({ 'rules.0.toDay': "The baby's age is only used for newborn care – tick it above or clear the days" });
    expect(await fields({ appliesTo: ['newborn'], fromDay: 5, toDay: 2 })).toEqual({ 'rules.0.toDay': '"To" day must not be before "from" day' });
    expect(await fields({ appliesTo: ['newborn'], fromDay: 1.5 })).toHaveProperty(['rules.0.fromDay']);
    // A check that does not exist for a ticked type of care – in the website's words too
    const fetal = { appliesTo: ['antenatal', 'postnatal'], conditions: [{ factor: 'fetalHeartRate', op: 'lt', value: 110 }] };
    expect(await fields(fetal)).toEqual({ 'rules.0.conditions.0.factor': website.notCheckedText('fetalHeartRate', ['antenatal', 'postnatal']) });
    expect(website.notCheckedText('fetalHeartRate', ['antenatal', 'postnatal'])).toBe('Fetal heart rate is not checked for postnatal patients – untick that type of care or choose another check');
    expect(await fields({ appliesTo: ['postnatal'], conditions: [{ factor: 'labBilirubinTotal', op: 'gt', value: 15 }] })).toHaveProperty(['rules.0.conditions.0.factor']);
    expect(await fields({ appliesTo: ['newborn'], conditions: [{ factor: 'labOgtt2h', op: 'gte', value: 140 }] })).toHaveProperty(['rules.0.conditions.0.factor']);
    expect(website.notCheckedText('labHb', ['antenatal', 'newborn'])).toBe('');
    // Words about the baby's sex are refused as before
    expect((await save([rule({ label: 'Baby is a boy' })], 'drA', 2)).status).toBe(400);
    // A number field holds digits only: a space is "not set" (never day 0), and "0x10", "1e2" or true are refused
    expect(await fields({ appliesTo: ['newborn'], toDay: '0x10' })).toEqual({ 'rules.0.toDay': '"To" day must be a whole number of days' });
    expect(await fields({ appliesTo: ['newborn'], fromDay: true })).toEqual({ 'rules.0.fromDay': '"From" day must be a whole number of days' });
    expect(await fields({ appliesTo: ['newborn'], fromDay: 1.5 })).toEqual({ 'rules.0.fromDay': '"From" day must be a whole number of days' });
    expect(await fields({ fromWeek: '1e1' })).toEqual({ 'rules.0.fromWeek': '"From" week must be a whole number' });
    expect(await fields({ toWeek: 45 })).toEqual({ 'rules.0.toWeek': '"To" week can\'t be above 44' });
    expect(await fields({ conditions: [{ factor: 'pulse', op: 'gt', value: ' ' }] })).toEqual({ 'rules.0.conditions.0.value': 'Enter a value' });
    expect(await fields({ conditions: [{ factor: 'pulse', op: 'gt', value: '0x70' }] })).toEqual({ 'rules.0.conditions.0.value': 'Value must be a number' });
    const typed = await save([rule({ appliesTo: ['antenatal', 'newborn'], fromWeek: ' 20 ', toWeek: ' ', fromDay: '2', toDay: ' ', conditions: [{ factor: 'temperatureF', op: 'gte', value: ' 100,4 ' }] })], 'drA', 2);
    expect(typed.status, JSON.stringify(typed.body)).toBe(200);
    expect(typed.body.ruleSet.rules[0]).toMatchObject({ fromWeek: 20, toWeek: null, fromDay: 2, toDay: null, conditions: [{ factor: 'temperatureF', op: 'gte', value: 100.4 }] });

    // A doctor's own rule for another type of care, with a lab check, is followed once saved
    const own = [rule({ key: 'gyn_hb', label: 'Low haemoglobin', level: 'urgent', appliesTo: ['gynaecology', 'abortion'], conditions: [{ factor: 'labHb', op: 'lt', value: 8 }] })];
    const saved = await save(own, 'drA', 3);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.ruleSet.rules[0]).toMatchObject({ appliesTo: ['gynaecology', 'abortion'], fromWeek: null, fromDay: null });
    const g = await register({ careType: 'gynaecology', fullName: 'Gynae Patient', pregnancy: undefined });
    const o = await labOrder(g, ['cbc']);
    await putResults('lab', o, cbc('7.2'), { report: true });
    expect(await flagKeys('drA', g)).toEqual(['gyn_hb']);
    expect((await (await as('drA')).get('/api/worklist')).body.redFlags.map((r) => r.patient.careType)).toEqual(['gynaecology']);
    // … and no longer for a pregnancy patient (the built-in rules were replaced)
    const p = await register({ fullName: 'Pregnant Patient' });
    await visitWith(p, { bpSystolic: 170, bpDiastolic: 112 });
    expect(await flagKeys('drA', p)).toEqual([]);
  });

  // The rules as a hospital had them before 4 Oct 2026: 21 pregnancy rules, without "applies to".
  const oldRules = () => V1_RULES.map(({ appliesTo, fromDay, toDay, ...r }) => r);
  const seedOld = (extra = {}) =>
    RedFlagRuleSet.collection.insertOne({ tenantId: hospital._id, set: 'standard', rules: oldRules(), builtInVersion: 1, status: 'draft', version: 1, updatedByName: 'Built-in draft', createdAt: new Date(), updatedAt: new Date(), __v: 0, ...extra });

  it('a draft that no doctor has changed or approved gets the new built-in rules by itself', async () => {
    await seedOld();
    const got = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    expect(got).toMatchObject({ status: 'draft', version: 2, builtInVersion: BUILT_IN_RED_FLAG_VERSION, updatedByName: 'Built-in draft', newBuiltIn: 0 });
    expect(got.rules).toHaveLength(BUILT_IN_RED_FLAG_RULES.length);
  });

  it('approved rules are never changed silently: the new rules are offered, and a doctor adds them as a draft', async () => {
    await seedOld({ status: 'approved', approvedByName: 'Sample drB', approvedAt: new Date('2026-10-01T05:00:00Z') });
    const before = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    expect(before).toMatchObject({ status: 'approved', version: 1, approvedByName: 'Sample drB', newBuiltIn: NEW_RULES });
    expect(before.rules).toHaveLength(21);
    expect(before.rules.every((r) => r.appliesTo.join() === 'antenatal')).toBe(true); // old rules read as pregnancy rules
    expect((await (await as('nurse')).get('/api/red-flag-rules')).body.ruleSet.newBuiltIn).toBe(0); // only told to those who can add them

    // Until then the approved rules work as before: pregnancy flags, nothing for a postnatal patient or from the lab
    const p = await register();
    const page = await visitWith(p, { bpSystolic: 164, bpDiastolic: 100, hb: 8.2 });
    expect(page.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys', 'hb_moderate']);
    expect(page.redFlags.rules).toMatchObject({ status: 'approved', approvedByName: 'Sample drB' });
    const o = await labOrder(p, ['cbc']);
    await putResults('lab', o, cbc('6.4'), { report: true });
    expect(await flagKeys('drA', p)).toEqual(['bp_severe_sys', 'hb_moderate']);
    const pn = await postnatal();
    expect((await visitWith(pn, { temperatureF: 102 })).redFlags.flags).toEqual([]);

    const add = async (who, version) => (await as(who)).post('/api/red-flag-rules/add-built-in').send({ version });
    expect((await add('nurse', 1)).status).toBe(403);
    expect((await add('reception', 1)).status).toBe(403);
    expect((await add('drA', 7)).status).toBe(409);
    expect((await (await as('drA')).post('/api/red-flag-rules/add-built-in').send({ version: 1, extra: true })).status).toBe(400);
    const added = await add('drA', 1);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.added).toBe(NEW_RULES);
    expect(added.body.ruleSet).toMatchObject({ status: 'draft', version: 2, builtInVersion: null, approvedByName: null, updatedByName: 'Sample drA', newBuiltIn: 0 });
    expect(added.body.ruleSet.rules.map((r) => r.key)).toEqual(BUILT_IN_RED_FLAG_RULES.map((r) => r.key)); // the old ones first, untouched
    expect((await add('drA', 2)).status).toBe(400); // nothing more to add
    // The added rules stay marked as an unreviewed built-in draft – for every doctor who opens the page – until approved
    const newKeys = BUILT_IN_RED_FLAG_RULES.filter((r) => BUILT_IN_SINCE[r.key]).map((r) => r.key);
    expect(added.body.ruleSet.builtInAdded).toEqual(newKeys);
    expect((await (await as('drB')).get('/api/red-flag-rules')).body.ruleSet.builtInAdded).toEqual(newKeys);

    // Now a draft: the new rules work, marked as based on draft rules
    expect(await flagKeys('drA', p)).toEqual(['bp_severe_sys', 'lab_hb_severe', 'hb_moderate']);
    expect((await record('drA', p)).redFlags.rules).toMatchObject({ status: 'draft', approvedByName: null });
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'RED_FLAG_RULES_UPDATED' }).lean();
    expect(entry.details).toEqual({ version: 2, rules: BUILT_IN_RED_FLAG_RULES.length, added: NEW_RULES });

    // A later edit keeps the mark on the added rules that are still there; approving the rules removes it
    const kept = added.body.ruleSet.rules.filter((r) => r.key !== 'nb_temp_low').map(({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source }) => ({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source }));
    const edited = (await (await as('drB')).put('/api/red-flag-rules').send({ version: 2, rules: kept })).body.ruleSet;
    expect(edited).toMatchObject({ status: 'draft', version: 3, updatedByName: 'Sample drB' });
    expect(edited.builtInAdded).toEqual(newKeys.filter((k) => k !== 'nb_temp_low'));
    const approved = (await (await as('drB')).post('/api/red-flag-rules/approve').send({ confirm: true, version: 3 })).body.ruleSet;
    expect(approved).toMatchObject({ status: 'approved', approvedByName: 'Sample drB', builtInAdded: [] });
    expect((await RedFlagRuleSet.findOne({ tenantId: hospital._id }).lean()).builtInAdded).toEqual([]);
  });

  it('rules approved before there were any for care after delivery: after her delivery the pregnancy rules stay in use, without "41 weeks"', async () => {
    await seedOld({ status: 'approved', approvedByName: 'Sample drB', approvedAt: new Date('2026-10-01T05:00:00Z') });
    at('2026-10-04T02:00:00Z');
    const p = await register({ pregnancy: { scanEdd: '2026-09-26' } }); // 41 weeks today
    const a = await admit(p);
    expect(await flagKeys('drA', p)).toEqual(['postdates']);
    at('2026-10-04T05:00:00Z');
    await confirmDelivery(p, a, '2026-10-04T04:30:00.000Z');
    expect(await flagKeys('drA', p)).toEqual([]);
    at('2026-10-04T06:30:00Z');
    const charted = await chart('nurse', p, a, { bpSystolic: 170, bpDiastolic: 110 });
    expect(charted.body.redFlags).toMatchObject({ careType: 'antenatal', checked: true, rules: { status: 'approved', careTypes: ['antenatal'] } });
    expect(charted.body.redFlags.flags.map((f) => f.key)).toEqual(['bp_severe_sys']); // not "nothing is checked"
    expect(await todayFlags('drA')).toEqual([['Flag Mother', ['bp_severe_sys']]]);
  });

  it('rules a doctor changed are offered the new rules too – without the ones they already have, and never one they removed', async () => {
    // Edited before 4 Oct 2026: two of the old rules kept, the rest removed by the doctor
    await seedOld({ rules: oldRules().slice(0, 2), builtInVersion: null, updatedByName: 'Sample drA' });
    const got = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    expect(got).toMatchObject({ status: 'draft', version: 1, builtInVersion: null, newBuiltIn: NEW_RULES });
    expect(got.rules).toHaveLength(2); // not replaced
    // The doctor writes a rule with the code of a new built-in one: that one is not offered again
    const own = [...got.rules, { key: 'pn_fever', label: 'Our fever rule', level: 'watch', appliesTo: ['postnatal'], conditions: [{ factor: 'temperatureF', op: 'gte', value: 100 }] }];
    const saved = (await (await as('drA')).put('/api/red-flag-rules').send({ version: 1, rules: own })).body.ruleSet;
    expect(saved.newBuiltIn).toBe(NEW_RULES - 1);
    const added = (await (await as('drA')).post('/api/red-flag-rules/add-built-in').send({ version: 2 })).body;
    expect(added.added).toBe(NEW_RULES - 1);
    expect(added.ruleSet.rules).toHaveLength(3 + NEW_RULES - 1);
    expect(added.ruleSet.rules.find((r) => r.key === 'pn_fever').label).toBe('Our fever rule');
    // Removing a new rule afterwards does not bring the offer back
    const fewer = added.ruleSet.rules.filter((r) => r.key !== 'nb_temp_low').map(({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source }) => ({ key, label, level, appliesTo, message, conditions, fromWeek, toWeek, fromDay, toDay, source }));
    expect((await (await as('drA')).put('/api/red-flag-rules').send({ version: 3, rules: fewer })).body.ruleSet.newBuiltIn).toBe(0);
  });
});

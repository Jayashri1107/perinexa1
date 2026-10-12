// Red flags: the words for rules and flags – which types of care a rule applies to, a baby's age, and where and
// when a flag's value was recorded (a visit, a lab result, the nursing chart). Fake sample data.
import { describe, expect, it } from 'vitest';
import {
  EPISODE_HINT,
  FACTOR_GROUPS,
  LISTED_TEXT,
  LOSS_LOCATION_HINT,
  LOSS_RECORD_HINT,
  READINGS_HINT,
  RED_FLAG_FACTORS,
  RED_FLAGS_NOT_CHECKED,
  RULE_CARE_LABELS,
  RULE_CARE_TYPES,
  ageText,
  appliesToText,
  checkedCareText,
  flagCountText,
  flagsElsewhere,
  newBuiltInText,
  notCheckedCareText,
  notCheckedFor,
  notCheckedText,
  ruleCareTypes,
  ruleChecksText,
  ruleToSave,
  rulesByCareType,
  withinText,
} from './redFlagFormat.js';
import { flagFromText, flagRowTarget, sourceLink, sourceText } from './redFlagSources.js';

const visitSource = { source: 'visit', on: '2026-10-03T00:00:00.000Z', visitId: 'v1' };
const labSource = { source: 'lab', on: '2026-10-01T00:00:00.000Z', orderId: 'o1' };
// The nursing chart has a time of day: said in this computer's time, so the test builds it the same way
const chartAt = new Date(2026, 9, 4, 14, 30);
const chartSource = { source: 'chart', at: chartAt.toISOString(), admissionId: 'a1' };

describe('which types of care a rule applies to', () => {
  it('a rule saved before rules had this is a pregnancy rule; the types are listed in the pages\' order', () => {
    expect(ruleCareTypes({})).toEqual(['antenatal']);
    expect(ruleCareTypes({ appliesTo: [] })).toEqual(['antenatal']);
    expect(ruleCareTypes({ appliesTo: ['newborn', 'postnatal'] })).toEqual(['postnatal', 'newborn']);
    expect(appliesToText({ appliesTo: ['newborn', 'postnatal'] })).toBe('After delivery (postnatal), Newborn');
    expect(RULE_CARE_TYPES.every((t) => RULE_CARE_LABELS[t])).toBe(true);
  });

  it('groups the rules by type of care; a rule for two types is listed under both; types without rules are left out', () => {
    const rules = [
      { key: 'a', appliesTo: ['antenatal'] },
      { key: 'old' }, // no "applies to": pregnancy
      { key: 'both', appliesTo: ['antenatal', 'postnatal'] },
      { key: 'baby', appliesTo: ['newborn'] },
    ];
    const groups = rulesByCareType(rules);
    expect(groups.map((g) => [g.careType, g.label, g.rules.map((r) => r.key)])).toEqual([
      ['antenatal', 'Pregnancy (antenatal)', ['a', 'old', 'both']],
      ['postnatal', 'After delivery (postnatal)', ['both']],
      ['newborn', 'Newborn', ['baby']],
    ]);
    expect(rulesByCareType([])).toEqual([]);
  });

  it('says when a check does not exist for a ticked type of care', () => {
    expect(notCheckedFor('fetalHeartRate', ['antenatal'])).toEqual([]);
    expect(notCheckedFor('fetalHeartRate', ['antenatal', 'postnatal', 'newborn'])).toEqual(['postnatal', 'newborn']);
    expect(notCheckedText('labBilirubinTotal', ['newborn'])).toBe('');
    expect(notCheckedText('labBilirubinTotal', ['postnatal'])).toBe("Baby's total bilirubin (lab) is not checked for postnatal patients – untick that type of care or choose another check");
    expect(notCheckedText('labOgtt2h', ['abortion', 'newborn'])).toBe('OGTT 2-hour blood sugar (lab) is not checked for newborn patients – untick that type of care or choose another check');
    // Vital signs and the lab haemoglobin exist for everyone
    for (const k of ['bpSystolic', 'pulse', 'temperatureF', 'hb', 'labHb', 'labPlatelets']) expect(notCheckedFor(k, RULE_CARE_TYPES), k).toEqual([]);
  });

  it('every check is in one of the edit page\'s groups', () => {
    const groups = FACTOR_GROUPS.map((g) => g.key);
    for (const [k, f] of Object.entries(RED_FLAG_FACTORS)) expect(groups, k).toContain(f.group);
    expect(Object.entries(RED_FLAG_FACTORS).filter(([, f]) => f.group === 'lab').map(([k]) => k)).toEqual([
      'labHb',
      'labPlatelets',
      'labFastingGlucose',
      'labOgtt2h',
      'labPostMealGlucose',
      'labRandomGlucose',
      'labTsh',
      'labUrineAlbumin',
      'labBabyGlucose',
      'labBilirubinTotal',
      'labBilirubinDirect',
    ]);
  });
});

describe('a rule in words', () => {
  it("says the weeks of pregnancy and the baby's age", () => {
    expect(ageText({})).toBe('');
    expect(ageText({ fromDay: 0, toDay: 0 })).toBe('baby under 1 day old');
    expect(ageText({ fromDay: 1, toDay: 1 })).toBe('baby 1 day old');
    expect(ageText({ fromDay: 3, toDay: 3 })).toBe('baby 3 days old');
    expect(ageText({ fromDay: 2, toDay: 6 })).toBe('baby 2–6 days old');
    expect(ageText({ fromDay: 4, toDay: null })).toBe('baby 4 days old or more');
    expect(ageText({ fromDay: 1 })).toBe('baby 1 day old or more');
    expect(ageText({ toDay: 0 })).toBe('baby under 1 day old');
    expect(ageText({ toDay: 7 })).toBe('baby up to 7 days old');
    expect(ruleChecksText({ conditions: [{ factor: 'labBilirubinTotal', op: 'gt', value: 11.7 }], fromDay: 1, toDay: 1 })).toBe("Baby's total bilirubin (lab) over 11.7 mg/dL, baby 1 day old");
    expect(ruleChecksText({ conditions: [{ factor: 'weightBelowBirth', op: 'gt', value: 10 }] })).toBe('Weight below birth weight by over 10 %');
  });

  it('a rule that joins a lab result with a value from a visit or the chart says how close in time the values must be', () => {
    const bp = { factor: 'bpSystolic', op: 'gte', value: 140 };
    const labUrine = { factor: 'labUrineAlbumin', grade: '1+' };
    expect(ruleChecksText({ conditions: [bp, labUrine], fromWeek: 20 })).toBe('BP systolic at least 140 mmHg and Urine albumin (lab) 1+ or more, from 20 weeks, values recorded within 7 days of each other');
    expect(withinText({ conditions: [bp, labUrine] })).toBe('values recorded within 7 days of each other');
    // Values of one place need no such note: a visit's BP and dipstick, two checks of one lab value, a lab value alone
    expect(withinText({ conditions: [bp, { factor: 'urineAlbumin', grade: '1+' }] })).toBe('');
    expect(withinText({ conditions: [{ factor: 'labHb', op: 'gte', value: 7 }, { factor: 'labHb', op: 'lt', value: 10 }] })).toBe('');
    expect(withinText({ conditions: [labUrine] })).toBe('');
    // "Weeks of pregnancy today" has no date of its own
    expect(withinText({ conditions: [{ factor: 'labHb', op: 'lt', value: 9 }, { factor: 'weeksToday', op: 'gte', value: 36 }] })).toBe('');
    expect(READINGS_HINT).toContain('only the newer reading raises a flag');
    expect(READINGS_HINT).toContain('within 7 days of each other');
    expect(EPISODE_HINT).toContain('after delivery, since the delivery (the last 6 weeks when no delivery date is on the record)');
    expect(EPISODE_HINT).toContain('for the other types of care, the last 3 months');
  });

  it('keeps the sentence about what is not checked, with symptoms written as text first', () => {
    expect(RED_FLAGS_NOT_CHECKED).toMatch(/^Not checked automatically: symptoms written as text/);
    expect(RED_FLAGS_NOT_CHECKED).toMatch(/Doctors must still assess these\.$/);
    expect(RED_FLAGS_NOT_CHECKED).not.toMatch(/!/);
    // Lab results the rules cannot read, and vital signs no rule looks at, are named too
    expect(RED_FLAGS_NOT_CHECKED).toContain('only attached as a file');
    expect(RED_FLAGS_NOT_CHECKED).toContain('typed in a different unit from the one shown');
    expect(RED_FLAGS_NOT_CHECKED).toContain("vital signs with no rule for the patient's type of care (for example SpO₂ after delivery or for a baby)");
  });

  it('says which types of care are checked and which are not – only what the hospital\'s rules cover', () => {
    expect(checkedCareText(['antenatal', 'postnatal', 'newborn'])).toBe(
      'Checked – the types of care that have a rule: Pregnancy (antenatal), After delivery (postnatal), Newborn. Not checked – no rule applies: Gynaecology, Infertility, Abortion (pregnancy loss).',
    );
    // Rules a doctor approved before 4 Oct 2026 cover pregnancy care only, until the new built-in rules are added
    expect(checkedCareText(['antenatal'])).toBe(
      'Checked – the types of care that have a rule: Pregnancy (antenatal). Not checked – no rule applies: After delivery (postnatal), Newborn, Gynaecology, Infertility, Abortion (pregnancy loss).',
    );
    expect(checkedCareText(RULE_CARE_TYPES)).toBe('Checked – the types of care that have a rule: Pregnancy (antenatal), After delivery (postnatal), Newborn, Gynaecology, Infertility, Abortion (pregnancy loss).');
    expect(checkedCareText([])).toBe('No patient is checked: the hospital has no red-flag rules.');
    expect(checkedCareText(undefined)).toBe(''); // an answer without the list: nothing is claimed
    expect(notCheckedCareText('gynaecology')).toBe('No red-flag rule applies to Gynaecology – the vital signs on the nursing chart are not checked.');
    expect(notCheckedCareText(null)).toBe('No red-flag rule applies to this type of care – the vital signs on the nursing chart are not checked.');
    expect(LISTED_TEXT).toContain('listed for 6 weeks after the value was recorded');
    expect(`${checkedCareText(['antenatal'])} ${LISTED_TEXT}`).not.toMatch(/every patient in hospital is checked/i);
  });
});

describe('where and when a flag was recorded', () => {
  it('says the visit, the lab result or the nursing chart, with the date', () => {
    expect(sourceText(visitSource)).toBe('the visit on 3 Oct 2026');
    expect(sourceText(labSource)).toBe('the lab result of 1 Oct 2026');
    expect(sourceText(chartSource)).toBe('the nursing chart, 4 Oct 2026, 14:30');
    expect(sourceText({ source: 'today' })).toBe('');
    expect(flagFromText({ sources: [labSource] })).toBe('from the lab result of 1 Oct 2026');
    expect(flagFromText({ sources: [visitSource, labSource] })).toBe('from the visit on 3 Oct 2026 and the lab result of 1 Oct 2026');
    expect(flagFromText({ sources: [] })).toBe(''); // "41 weeks or more": from today's date
    expect(flagFromText({})).toBe('');
  });

  it('links to the visit, the lab result or the stay', () => {
    expect(sourceLink('p1', visitSource)).toBe('/patients/p1/visits/v1');
    expect(sourceLink('p1', labSource)).toBe('/patients/p1/lab/o1');
    expect(sourceLink('p1', chartSource)).toBe('/patients/p1/stays/a1');
    expect(sourceLink(null, visitSource)).toBeNull();
    expect(sourceLink('p1', { source: 'visit', on: visitSource.on, visitId: null })).toBeNull();
    // A row in a list leads to where the first (most urgent) flag was recorded
    expect(flagRowTarget('p1', [{ sources: [labSource] }, { sources: [visitSource] }])).toEqual({ to: '/patients/p1/lab/o1', label: 'Open the lab result' });
    expect(flagRowTarget('p1', [{ sources: [chartSource] }])).toEqual({ to: '/patients/p1/stays/a1', label: 'Open the stay' });
    expect(flagRowTarget('p1', [{ sources: [visitSource] }])).toEqual({ to: '/patients/p1/visits/v1', label: 'Open the visit' });
    expect(flagRowTarget('p1', [{ sources: [] }])).toEqual({ to: '/patients/p1', label: 'Open the record' });
    expect(flagCountText([{ level: 'urgent' }, { level: 'watch' }])).toBe('1 urgent, 1 to watch');
  });
});

describe('the visit page', () => {
  it("lists the record's other flags – from the lab, the chart, today or another visit – beside the visit's own", () => {
    const fromVisit = { key: 'htn_sys', detail: 'BP 146/92 mmHg' };
    const fromLab = { key: 'lab_hb_severe', detail: 'Haemoglobin (lab) 6.4 g/dL' };
    const postdates = { key: 'postdates', detail: 'Weeks of pregnancy today 41 weeks' };
    expect(flagsElsewhere([fromVisit, fromLab, postdates], [fromVisit, postdates])).toEqual([fromLab]);
    // An earlier visit's page: the same rule raised by the latest visit's value is another flag
    expect(flagsElsewhere([{ key: 'htn_sys', detail: 'BP 150/96 mmHg' }], [fromVisit])).toEqual([{ key: 'htn_sys', detail: 'BP 150/96 mmHg' }]);
    expect(flagsElsewhere(undefined, [fromVisit])).toEqual([]);
    expect(flagsElsewhere([fromLab], undefined)).toEqual([fromLab]);
  });
});

describe('what the edit page saves', () => {
  const row = (extra = {}) => ({ key: ' r1 ', label: 'Rule', level: 'watch', appliesTo: ['antenatal'], message: '', source: '', fromWeek: '20', toWeek: '', fromDay: '2', toDay: '5', conditions: [{ factor: 'pulse', op: 'gt', value: '110', grade: '', choices: [] }], ...extra });

  it('keeps weeks only on a pregnancy rule and a baby\'s age only on a newborn rule', () => {
    expect(ruleToSave(row())).toMatchObject({ key: 'r1', appliesTo: ['antenatal'], fromWeek: '20', toWeek: '', fromDay: '', toDay: '' });
    expect(ruleToSave(row({ appliesTo: ['newborn'] }))).toMatchObject({ fromWeek: '', toWeek: '', fromDay: '2', toDay: '5' });
    expect(ruleToSave(row({ appliesTo: ['postnatal'] }))).toMatchObject({ fromWeek: '', fromDay: '', toDay: '' });
    expect(ruleToSave(row({ appliesTo: ['antenatal', 'newborn'] }))).toMatchObject({ fromWeek: '20', fromDay: '2', toDay: '5' });
    expect(ruleToSave(row()).conditions).toEqual([{ factor: 'pulse', op: 'gt', value: '110' }]);
  });
});

describe('pregnancy-loss care: checks of her record', () => {
  it('the checks of the record are for pregnancy-loss care only, with plain answers', () => {
    const record = Object.entries(RED_FLAG_FACTORS).filter(([, f]) => f.group === 'record');
    expect(record.map(([k, f]) => [k, f.label, f.choices])).toEqual([
      ['lossLocation', 'Pregnancy location', ['ectopic', 'unknown']],
      ['lossRuptureSigns', 'Signs of rupture', ['yes', 'no']],
      ['lossBleeding', 'Bleeding', ['light', 'moderate', 'heavy']],
      ['lossFeverDischarge', 'Fever with foul-smelling discharge', ['yes', 'no']],
    ]);
    for (const [k] of record) {
      expect(notCheckedFor(k, ['abortion'])).toEqual([]);
      expect(notCheckedFor(k, ['antenatal', 'abortion'])).toEqual(['antenatal']);
    }
    expect(notCheckedText('lossRuptureSigns', ['postnatal'])).toBe('Signs of rupture is not checked for postnatal patients – untick that type of care or choose another check');
    expect(FACTOR_GROUPS.at(-1)).toEqual({ key: 'record', label: 'On her record – pregnancy-loss care' });
    // Only a complete miscarriage never seen in the uterus is "unknown"; neither counts once she is treated
    expect(LOSS_LOCATION_HINT).toMatch(/pregnancy of unknown location – a complete miscarriage whose scan showed no gestational sac in the uterus/);
    expect(LOSS_LOCATION_HINT).toMatch(/"Treatment complete" or an operation is recorded/);
    expect(LOSS_RECORD_HINT).toMatch(/signs of rupture, bleeding, fever with foul-smelling discharge/);
  });

  it('says a rule of the record in words, and saves only its answers', () => {
    // As the server sends it (no weeks, no baby's age)
    const rule = { key: 'loss_ectopic_pulse', label: 'Possible ruptured ectopic pregnancy', level: 'urgent', appliesTo: ['abortion'], message: '', source: '', fromWeek: null, toWeek: null, fromDay: null, toDay: null, conditions: [{ factor: 'lossLocation', choices: ['ectopic', 'unknown'], op: null, value: null, grade: null }, { factor: 'pulse', op: 'gt', value: 110 }] };
    expect(ruleChecksText(rule)).toBe('Pregnancy location: ectopic or unknown and Pulse over 110 /min');
    expect(withinText(rule)).toBe(''); // the location has no day of its own
    expect(appliesToText(rule)).toBe('Abortion (pregnancy loss)');
    // As the edit page holds it (text fields): only the answers of each check are saved, and no weeks or baby's age
    const saved = ruleToSave({ ...rule, fromWeek: '', toWeek: '', fromDay: '', toDay: '' });
    expect(saved.conditions).toEqual([{ factor: 'lossLocation', choices: ['ectopic', 'unknown'] }, { factor: 'pulse', op: 'gt', value: 110 }]);
    expect([saved.fromWeek, saved.toWeek, saved.fromDay, saved.toDay]).toEqual(['', '', '', '']);
  });

  it('a flag from a finding on her record says so, and leads to her record', () => {
    const recordSource = { source: 'record', on: '2026-10-05T00:00:00.000Z' };
    expect(sourceText(recordSource)).toBe('her record, 5 Oct 2026');
    expect(sourceLink('p1', recordSource)).toBe('/patients/p1');
    expect(flagFromText({ sources: [recordSource] })).toBe('from her record, 5 Oct 2026');
    expect(flagRowTarget('p1', [{ sources: [recordSource] }])).toEqual({ to: '/patients/p1', label: 'Open the record' });
    // On a visit page the record's flags are listed apart from the visit's own
    const visitFlags = [{ key: 'loss_ectopic_pulse', detail: 'Pregnancy location ectopic, Pulse 124 /min' }];
    const recordFlags = [...visitFlags, { key: 'loss_rupture_signs', detail: 'Signs of rupture yes' }];
    expect(flagsElsewhere(recordFlags, visitFlags).map((f) => f.key)).toEqual(['loss_rupture_signs']);
  });

  it('the offer of new built-in rules names the types of care they are for', () => {
    expect(newBuiltInText(8, ['abortion'])).toBe('8 draft rules, for: Abortion (pregnancy loss).');
    expect(newBuiltInText(1, ['abortion'])).toBe('1 draft rule, for: Abortion (pregnancy loss).');
    expect(newBuiltInText(42, ['abortion', 'antenatal', 'newborn'])).toBe('42 draft rules, for: Pregnancy (antenatal), Newborn, Abortion (pregnancy loss).');
    expect(newBuiltInText(3)).toBe('3 draft rules.');
  });
});

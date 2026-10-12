import { describe, expect, it } from 'vitest';
import { PREGNANCY_FINDING_LABELS, currentFindings, pastFindings, readingRows } from './patientFormat.js';
import { NOT_CHECKED_YET, NUMBER_FACTORS, RISK_FACTOR_LABELS, findingsNotCheckedText, noReasonText, notMeasuredText, readingsNotCheckedText, ruleText } from './riskFormat.js';
import { WHY_TEXT, findingsWithoutItemsText, statusNote } from './carePlanFormat.js';
import { APPLIES_LABELS, builtInOfferText } from '../careplans/templateFormat.js';

// Fake sample entries, as the server sends them (findingsView): `current` says which count for this pregnancy.
const entry = (key, over = {}) => ({ key, byName: 'Dr Sample', at: '2026-09-28T06:00:00.000Z', via: 'record', endedAt: null, endedByName: null, current: true, ...over });
const day = (d) => new Date(d).toISOString().slice(0, 10);

describe('findings in this pregnancy', () => {
  it('lists the ticked findings in the order of the form, whatever order they were recorded in', () => {
    const patient = { pregnancy: { findings: [entry('bleeding'), entry('gdm'), entry('multiple', { current: false, endedAt: '2026-10-01T06:00:00.000Z', endedByName: 'RMO Sample' })] } };
    expect(currentFindings(patient).map((f) => f.key)).toEqual(['gdm', 'bleeding']);
    expect(currentFindings({ pregnancy: {} })).toEqual([]);
    expect(currentFindings(undefined)).toEqual([]); // a new patient: nothing yet
    expect(currentFindings({})).toEqual([]); // someone who does not get the medical details
  });

  it('earlier entries say who removed them, or that they are from an earlier pregnancy – newest first', () => {
    const patient = {
      pregnancy: {
        findings: [
          entry('gdm', { current: false, at: '2025-02-01T06:00:00.000Z' }), // not ended, not current: an earlier pregnancy
          entry('multiple', { current: false, endedAt: '2026-10-01T06:00:00.000Z', endedByName: 'RMO Sample' }),
          entry('bleeding'),
        ],
      },
    };
    expect(pastFindings(patient, day)).toEqual([
      { key: 'multiple', label: 'Twins or more', text: 'recorded by Dr Sample on 2026-09-28, removed by RMO Sample on 2026-10-01' },
      { key: 'gdm', label: 'Gestational diabetes (GDM)', text: 'recorded by Dr Sample on 2025-02-01, in an earlier pregnancy' },
    ]);
    expect(pastFindings({ pregnancy: { findings: [entry('gdm')] } }, day)).toEqual([]);
  });

  it('shows the readings the risk rules use, with the day and where the haemoglobin comes from', () => {
    const readings = { lowestHb: { value: 9.8, on: '2026-09-12T00:00:00.000Z', source: 'lab' }, latestBp: { systolic: 150, diastolic: 96, on: '2026-10-03T00:00:00.000Z' } };
    expect(readingRows({ pregnancy: { readings } }, day)).toEqual([
      ['Lowest Hb', '9.8 g/dL · 2026-09-12 (lab result)'],
      ['Latest BP', '150/96 · 2026-10-03'],
    ]);
    expect(readingRows({ pregnancy: { readings: { lowestHb: { value: 11.2, on: '2026-09-12T00:00:00.000Z', source: 'visit' }, latestBp: null } } }, day)).toEqual([['Lowest Hb', '11.2 g/dL · 2026-09-12 (visit)']]);
    expect(readingRows({ pregnancy: { readings: null } }, day)).toEqual([]);
    expect(readingRows({}, day)).toEqual([]);
  });
});

describe('risk rules on findings and readings, in words', () => {
  it('a rule on a finding names the finding; a rule on a reading reads like the other number rules', () => {
    expect(ruleText({ factor: 'finding', finding: 'multiple' })).toBe('Ticked for this pregnancy: Twins or more');
    expect(ruleText({ factor: 'lowestHb', op: 'lt', value: 7 })).toBe('Lowest haemoglobin in this pregnancy (g/dL) under 7');
    expect(ruleText({ factor: 'bpSystolic', op: 'gte', value: 140 })).toBe('Latest blood pressure – upper number at least 140');
    expect(ruleText({ factor: 'bpDiastolic', op: 'gte', value: 90 })).toBe('Latest blood pressure – lower number at least 90');
    for (const f of ['lowestHb', 'bpSystolic', 'bpDiastolic']) expect(NUMBER_FACTORS).toContain(f); // the editor asks for a comparison and a value
    expect(RISK_FACTOR_LABELS.finding).toBe('Finding in this pregnancy');
  });

  it('readings not measured yet are said in one plain sentence (nothing when all were measured)', () => {
    expect(notMeasuredText({ notMeasured: [] })).toBeNull();
    expect(notMeasuredText({})).toBeNull(); // a result worked out before this existed
    expect(notMeasuredText(null)).toBeNull();
    expect(notMeasuredText({ notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'] })).toEqual({
      lead: 'Not measured yet in this pregnancy:',
      list: 'Haemoglobin (Hb) · Blood pressure',
      rest: 'The rules on them are checked once a value is recorded at a visit (haemoglobin: also when a doctor reviews a lab result).',
    });
    expect(notMeasuredText({ notMeasured: ['Blood pressure'] }).rest).toBe('The rules on it are checked once a value is recorded at a visit.');
  });

  it('the note on what is not checked no longer lists what is checked now, and says it depends on the hospital rules', () => {
    expect(NOT_CHECKED_YET).not.toMatch(/blood pressure readings|twins|placenta praevia/i);
    expect(NOT_CHECKED_YET).toMatch(/count only where the hospital's risk rules have a rule for them/);
  });

  it("a finding ticked where the hospital's rules have no rule for it is said plainly: doctor to assess", () => {
    expect(findingsNotCheckedText({ findingsNotChecked: [] })).toBeNull();
    expect(findingsNotCheckedText({})).toBeNull();
    expect(findingsNotCheckedText({ findingsNotChecked: ['gdm'] })).toEqual({
      lead: 'Doctor to assess:',
      list: 'Gestational diabetes (GDM)',
      rest: "ticked for this pregnancy, but the hospital's risk rules have no rule for it, so the level does not count it.",
    });
    expect(findingsNotCheckedText({ findingsNotChecked: ['gdm', 'multiple'] })).toMatchObject({
      list: 'Gestational diabetes (GDM), Twins or more',
      rest: "ticked for this pregnancy, but the hospital's risk rules have no rule for them, so the level does not count them.",
    });
  });

  it("a reading recorded where the hospital's rules have no rule for it is said plainly too, with its value", () => {
    const readings = { lowestHb: { value: 6.5, on: '2026-09-28T00:00:00.000Z', source: 'visit' }, latestBp: { systolic: 160, diastolic: 110, on: '2026-09-28T00:00:00.000Z' } };
    expect(readingsNotCheckedText({ readingsNotChecked: [] }, readings)).toBeNull();
    expect(readingsNotCheckedText({}, readings)).toBeNull(); // a result worked out before this existed
    expect(readingsNotCheckedText({ readingsNotChecked: ['lowestHb'] }, readings)).toEqual({
      lead: 'Doctor to assess:',
      list: 'Lowest Hb 6.5 g/dL',
      rest: "recorded in this pregnancy, but the hospital's risk rules have no rule for it, so the level does not count it.",
    });
    expect(readingsNotCheckedText({ readingsNotChecked: ['lowestHb', 'latestBp'] }, readings)).toMatchObject({
      list: 'Lowest Hb 6.5 g/dL, Latest BP 160/110',
      rest: "recorded in this pregnancy, but the hospital's risk rules have no rule for them, so the level does not count them.",
    });
    expect(readingsNotCheckedText({ readingsNotChecked: ['latestBp'] }, null).list).toBe('Blood pressure'); // the value is not at hand
  });

  it('"no risk factor found in the recorded information" is only said when everything recorded was counted', () => {
    expect(noReasonText({ level: 'low', computedLevel: 'low' })).toBe('No risk factor found in the recorded information.');
    expect(noReasonText({ level: 'incomplete', computedLevel: 'incomplete' })).toBe('No risk factor found so far.');
    const uncounted = 'No risk rule applies – but not everything recorded was counted. See “Doctor to assess” below.';
    expect(noReasonText({ level: 'low', computedLevel: 'low', readingsNotChecked: ['lowestHb'] })).toBe(uncounted);
    expect(noReasonText({ level: 'low', computedLevel: 'low', findingsNotChecked: ['multiple'] })).toBe(uncounted);
  });

  it('a plan built before the template had items for a ticked finding says so, and what the update does to an approved plan', () => {
    const plan = (over = {}) => ({ findingsWithoutItems: ['multiple'], template: { name: 'Standard antenatal care', version: 3, approved: false, updateApproved: false }, ...over });
    expect(findingsWithoutItemsText({ findingsWithoutItems: [] })).toBeNull();
    expect(findingsWithoutItemsText({})).toBeNull(); // an answer from before this existed
    expect(findingsWithoutItemsText(plan())).toEqual({
      found: 'Ticked on her record: Twins or more.',
      why: 'This plan was built from an older version of “Standard antenatal care” (version 3), which had no items for it – so the plan shows none. Update the plan to add them.',
      draft: null, // the plan is a draft already: nothing to lose
    });
    expect(findingsWithoutItemsText(plan({ findingsWithoutItems: ['gdm', 'multiple'] }))).toMatchObject({ found: 'Ticked on her record: Gestational diabetes (GDM), Twins or more.' });
    // an approved plan, and the newer version is still a draft: the update makes her plan a draft – said before the click
    const approved = plan({ template: { name: 'Standard antenatal care', version: 3, approved: true, updateApproved: false } });
    expect(findingsWithoutItemsText(approved).draft).toMatch(/draft that no doctor has approved yet: after the update her plan is marked as a draft/);
    expect(findingsWithoutItemsText(plan({ template: { name: 'S', version: 3, approved: true, updateApproved: true } })).draft).toBeNull();
    expect(JSON.stringify(findingsWithoutItemsText(approved))).not.toMatch(/!/);
  });

  it('an item whose weeks had passed when the finding was ticked says so (it is not called overdue)', () => {
    const scan = { status: 'decide', why: null, lateStart: 'decide', lateFrom: 'finding', gaWindow: { from: { weeks: 28, days: 0 }, to: { weeks: 30, days: 6 } } };
    expect(statusNote(scan, { careType: 'antenatal' })).toMatch(/^Window .* ended before the finding was ticked$/);
    expect(statusNote({ status: 'lapsed', lateStart: 'lapsed', lateFrom: 'finding' }, { careType: 'antenatal' })).toBe('Passed before the finding was ticked');
  });

  it('the offer of built-in draft content lists exactly what would be added or changed', () => {
    expect(builtInOfferText(null, 'antenatal')).toBeNull();
    expect(builtInOfferText({ items: [], riskRules: [], changes: [] }, 'antenatal')).toBeNull();
    const antenatal = builtInOfferText({ riskRules: ['Twins or more', 'Bleeding in this pregnancy'], items: ['Growth scan'], changes: [] }, 'antenatal');
    expect(antenatal.counts).toBe('2 risk rules and 1 schedule item');
    expect(antenatal.about).toMatch(/^for findings in this pregnancy .* and for the measured haemoglobin and blood pressure$/);
    expect(antenatal.after).toMatch(/Risk levels are worked out again/);
    expect(antenatal.lines).toEqual(['Risk rule: Twins or more', 'Risk rule: Bleeding in this pregnancy', 'Item: Growth scan']);
    // items only (an edited draft that already got the rules): nothing about readings or risk levels
    const itemsOnly = builtInOfferText({ riskRules: [], items: ['Growth scan'] }, 'antenatal');
    expect([itemsOnly.counts, itemsOnly.about]).toEqual(['1 schedule item', 'for findings in this pregnancy (gestational diabetes, high blood pressure, twins, low-lying placenta, bleeding)']);
    expect(itemsOnly.after).toMatch(/plans keep the version they were built from/);
    // postnatal: an item's "for which patients" changes – said with both, in the words of the template editor
    const postnatal = builtInOfferText({ items: [], riskRules: [], changes: [{ name: 'Blood sugar review (diabetes)', from: 'diabetes', to: 'diabetes_any' }] }, 'postnatal');
    expect(postnatal.counts).toBe('1 changed item');
    expect(postnatal.about).toBe('so that the checks after delivery also apply after high blood pressure or diabetes found in the pregnancy');
    expect(postnatal.lines).toEqual(['Item changed: Blood sugar review (diabetes) – for “Any diabetes (pre-existing or GDM)” instead of “Pre-existing diabetes only”']);
    expect(builtInOfferText({ riskRules: ['a'], items: ['b'], changes: [{ name: 'c', from: 'diabetes', to: 'diabetes_any' }] }, 'antenatal').counts).toBe('1 risk rule, 1 schedule item and 1 changed item');
    expect(JSON.stringify([antenatal, itemsOnly, postnatal])).not.toMatch(/!/);
  });

  it('every finding has a label, a care-plan choice and a plain reason when its item does not apply', () => {
    expect(Object.keys(PREGNANCY_FINDING_LABELS)).toEqual(['gdm', 'hypertension', 'multiple', 'placenta_praevia', 'bleeding']);
    for (const c of ['gdm', 'pregnancy_hypertension', 'multiple_pregnancy', 'placenta_praevia', 'bleeding', 'diabetes_any', 'hypertension_any']) {
      expect([c, typeof APPLIES_LABELS[c], typeof WHY_TEXT[`only_${c}`]]).toEqual([c, 'string', 'string']);
    }
    // the pre-existing-only choices keep their meaning and their words
    expect(APPLIES_LABELS.diabetes).toBe('Pre-existing diabetes only');
    expect(APPLIES_LABELS.hypertension).toBe('Chronic high blood pressure only');
    // brand rules: no exclamation marks in any of the new wording
    expect(JSON.stringify([PREGNANCY_FINDING_LABELS, APPLIES_LABELS, WHY_TEXT, NOT_CHECKED_YET])).not.toMatch(/!/);
  });
});

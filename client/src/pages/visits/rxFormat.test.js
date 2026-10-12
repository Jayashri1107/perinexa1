// Words for prescriptions and visits (fake sample data only).
import { describe, expect, it } from 'vitest';
import { MEDICINES, findMedicine } from './medicines.js';
import {
  DESIGNS,
  DOSE_UNIT_WORDS,
  FORM_NAMES,
  FORM_PREFIX,
  FREQUENCY_LABELS,
  FREQUENCY_WORDS,
  RX_DESIGNS,
  RX_FORMS,
  RX_FREQUENCIES,
  RX_LABELS,
  RX_ROUTES,
  RX_SHOW,
  RX_TIMINGS,
  ROUTE_WORDS,
  SHOW_LABELS,
  SLOT_WORDS,
  TIMING_WORDS,
  doseSlots,
  doseText,
  durationShort,
  durationText,
  frequencyText,
  instructionLine,
  medicineName,
  pregnancyCheckText,
  vitalsText,
} from './rxFormat.js';

const folic = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days', route: '', instructions: '' };

describe('a medicine on paper', () => {
  it('names it the Indian way, in capitals when asked', () => {
    expect(medicineName(folic)).toBe('TAB. FOLIC ACID 5 mg');
    expect(medicineName(folic, { capitals: false })).toBe('Tab. Folic acid 5 mg');
    expect(medicineName({ ...folic, form: 'other', strength: '' })).toBe('FOLIC ACID');
  });

  it('writes the dose, how often, when and how long', () => {
    expect(doseText(folic)).toBe('1 tab');
    expect(doseText({ ...folic, form: 'syrup', dose: '10' })).toBe('10 ml');
    expect(doseText({ ...folic, dose: '2 puffs' })).toBe('2 puffs');
    expect(instructionLine(folic)).toBe('1 tab · 1-0-0 (morning) · after food · for 30 days');
    expect(instructionLine({ ...folic, frequency: '1-0-1' }, 'mr')).toBe('1 गोळी · 1-0-1 (सकाळी व रात्री) · जेवणानंतर · 30 दिवस');
    expect(instructionLine({ ...folic, frequency: '1-1-1', timing: 'before_food' }, 'hi')).toBe('1 गोली · 1-1-1 (सुबह, दोपहर और रात) · खाना खाने से पहले · 30 दिन तक');
    expect(instructionLine({ ...folic, form: 'syrup', dose: '10', frequency: '0-0-1', timing: '', durationUnit: '', durationValue: null }, 'hi')).toBe('10 मिली · 0-0-1 (रात)');
    expect(instructionLine({ ...folic, form: 'inj', dose: '', frequency: 'stat', timing: '', durationUnit: '', durationValue: null, route: 'im' })).toBe('once, now · injection in the muscle (IM)');
    expect(frequencyText({ ...folic, frequency: 'custom', frequencyText: 'On days 2 to 6 of the cycle' })).toBe('On days 2 to 6 of the cycle');
    expect(frequencyText({ ...folic, frequency: 'sos' }, 'hi')).toBe('ज़रूरत होने पर ही');
  });

  it('says how long in each language', () => {
    expect(durationText({ durationValue: 1, durationUnit: 'weeks' })).toBe('for 1 week');
    expect(durationText({ durationValue: 2, durationUnit: 'weeks' }, 'mr')).toBe('2 आठवडे');
    expect(durationText({ durationValue: 1, durationUnit: 'months' }, 'mr')).toBe('1 महिना');
    expect(durationText({ durationUnit: 'till_delivery' }, 'hi')).toBe('प्रसव तक');
    expect(durationText({ durationUnit: '' })).toBe('');
    expect(durationShort(folic)).toBe('30 days');
    expect(durationShort({ durationValue: 1, durationUnit: 'months' })).toBe('1 month');
    expect(durationShort(folic, 'hi')).toBe('30 दिन');
    // Hindi: "1 महीने तक" before तक, "1 महीना" alone
    expect(durationText({ durationValue: 1, durationUnit: 'months' }, 'hi')).toBe('1 महीने तक');
    expect(durationShort({ durationValue: 1, durationUnit: 'months' }, 'hi')).toBe('1 महीना');
    expect(durationShort({ durationValue: 3, durationUnit: 'months' }, 'hi')).toBe('3 महीने');
    expect(durationShort({ durationValue: 1, durationUnit: 'weeks' }, 'mr')).toBe('1 आठवडा');
  });

  it('fills the dose chart', () => {
    expect(doseSlots({ ...folic, frequency: '1-0-1' })).toEqual(['1', '', '', '1']);
    expect(doseSlots({ ...folic, frequency: '1-1-1', dose: '½' })).toEqual(['½', '½', '', '½']);
    expect(doseSlots({ ...folic, frequency: '1-1-1-1' })).toEqual(['1', '1', '1', '1']);
    expect(doseSlots({ ...folic, frequency: '0-0-1', dose: '' })).toEqual(['', '', '', '1']);
    expect(doseSlots({ ...folic, frequency: 'sos' })).toBeNull();
  });
});

describe('the visit on paper', () => {
  it('lists what was measured, and nothing that was not', () => {
    expect(vitalsText({ bpSystolic: 110, bpDiastolic: 70, pulse: 82, weightKg: 58, temperatureF: 98.6, urineAlbumin: 'nil', urineSugar: '' })).toBe(
      'BP 110/70 mmHg · Pulse 82/min · Weight 58 kg · Temp 98.6 °F · Urine albumin nil',
    );
    expect(vitalsText({ bpSystolic: 110, bpDiastolic: null })).toBe('');
    expect(pregnancyCheckText({ fundalHeightCm: 24, fetalHeartRate: 140, presentation: 'cephalic', fetalMovements: 'present', oedema: 'none' })).toBe(
      'Fundal height 24 cm · FHR 140/min · Cephalic · Fetal movements present · Oedema none',
    );
  });
});

describe('every code has its words', () => {
  it('on screen and on paper, in all three languages', () => {
    for (const f of RX_FORMS) expect(FORM_NAMES[f], f).toBeTruthy();
    for (const f of RX_FORMS.filter((x) => x !== 'other')) expect(FORM_PREFIX[f], f).toBeTruthy();
    for (const f of RX_FREQUENCIES) expect(FREQUENCY_LABELS[f], f).toBeTruthy();
    const all = [
      ...RX_FREQUENCIES.filter((f) => f !== 'custom').map((f) => FREQUENCY_WORDS[f]),
      ...RX_TIMINGS.filter(Boolean).map((t) => TIMING_WORDS[t]),
      ...RX_ROUTES.filter(Boolean).map((r) => ROUTE_WORDS[r]),
      ...Object.values(SLOT_WORDS),
      ...Object.values(DOSE_UNIT_WORDS),
      ...Object.values(RX_LABELS),
    ];
    for (const w of all) for (const lang of ['en', 'mr', 'hi']) expect(w?.[lang]?.trim(), JSON.stringify(w)).toBeTruthy();
  });

  it('for the 10 designs and the parts that can be printed', () => {
    expect(RX_DESIGNS).toHaveLength(10);
    for (const d of RX_DESIGNS) expect(DESIGNS[d]?.name && DESIGNS[d]?.about, d).toBeTruthy();
    for (const s of RX_SHOW) expect(SHOW_LABELS[s], s).toBeTruthy();
  });

  it('for the medicine list', () => {
    for (const m of MEDICINES) expect(RX_FORMS, m.name).toContain(m.form);
    expect(findMedicine('folic ACID')).toMatchObject({ name: 'Folic acid', form: 'tab' });
    expect(findMedicine('Brandname 500')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { amountText, convert, dosesPerDay, doseWarnings, isCombined, parseDose, parseStrength, singleDose, strengthInName } from './doseCheck.js';
import { RX_FREQUENCIES } from '../visits/rxFormat.js';

// The dose check without AI: what was typed → one dose and a day's total, compared with the usual maximum.
const row = (drug, strength, dose, frequency = '1-0-1', form = 'tab') => ({ drug, form, strength, dose, frequency });
const matches = (drug, e) => e.terms.some((t) => drug.toLowerCase().includes(t));
const PARA = { key: 'para', kind: 'dose', label: 'Paracetamol', terms: ['paracetamol', 'dolo'], doseUnit: 'mg', maxSingle: 1000, maxDaily: 4000, perKg: false, message: 'Less under 50 kg.' };
const PARA_KG = { key: 'para_kg', kind: 'dose', label: 'Paracetamol (baby)', terms: ['paracetamol'], doseUnit: 'mg', maxSingle: 20, maxDaily: 60, perKg: true, message: '' };
const METFORMIN = { key: 'metformin', kind: 'dose', label: 'Metformin', terms: ['metformin'], doseUnit: 'mg', maxSingle: null, maxDaily: 2000, perKg: false, message: '' };

describe('reading a strength', () => {
  it('one clear amount, with its unit', () => {
    expect(parseStrength('500 mg')).toEqual({ value: 500, unit: 'mg', perMl: null });
    expect(parseStrength('5mg')).toEqual({ value: 5, unit: 'mg', perMl: null });
    expect(parseStrength('1 g')).toEqual({ value: 1, unit: 'g', perMl: null });
    expect(parseStrength('400 MCG')).toEqual({ value: 400, unit: 'mcg', perMl: null });
    expect(parseStrength('60,000 IU')).toEqual({ value: 60000, unit: 'IU', perMl: null });
    expect(parseStrength('250 mg/5 ml')).toEqual({ value: 250, unit: 'mg', perMl: 5 });
    expect(parseStrength('100 mg/ml')).toEqual({ value: 100, unit: 'mg', perMl: 1 });
    expect(parseStrength('40 IU per ml')).toEqual({ value: 40, unit: 'IU', perMl: 1 });
  });
  it('nothing for a strength that is not one clear amount', () => {
    for (const t of ['', '500', '10 ml', '2%', '100 mg + 1.5 mg', '500 mg, 125 mg', 'strong', '0 mg', '250 mg/0 ml']) expect(parseStrength(t), t).toBeNull();
  });
  it('a strength written in the name counts only with a unit, and only if there is one', () => {
    expect(strengthInName('Paracetamol 650 mg')).toEqual({ value: 650, unit: 'mg', perMl: null });
    expect(strengthInName('Calpol 250 mg/5 ml')).toEqual({ value: 250, unit: 'mg', perMl: 5 });
    expect(strengthInName('Dolo 650')).toBeNull();
    expect(strengthInName('Vitamin B12')).toBeNull();
    expect(strengthInName('Iron 100 mg folic acid 1.5 mg')).toBeNull();
  });
});

describe('reading a dose', () => {
  it('a number of pieces, a volume, or an amount', () => {
    expect(parseDose('')).toEqual({ kind: 'blank' });
    expect(parseDose('1')).toEqual({ kind: 'count', value: 1 });
    expect(parseDose('½')).toEqual({ kind: 'count', value: 0.5 });
    expect(parseDose('1½')).toEqual({ kind: 'count', value: 1.5 });
    expect(parseDose('1/2')).toEqual({ kind: 'count', value: 0.5 });
    expect(parseDose('2 tabs')).toEqual({ kind: 'count', value: 2 });
    expect(parseDose('1 cap.')).toEqual({ kind: 'count', value: 1 });
    expect(parseDose('10 ml')).toEqual({ kind: 'ml', value: 10 });
    expect(parseDose('2.5ml')).toEqual({ kind: 'ml', value: 2.5 });
    expect(parseDose('1 tsp')).toEqual({ kind: 'ml', value: 5 });
    expect(parseDose('500 mg')).toEqual({ kind: 'amount', value: 500, unit: 'mg' });
    expect(parseDose('0.2 mg')).toEqual({ kind: 'amount', value: 0.2, unit: 'mg' });
  });
  it('nothing for a dose it cannot be sure of', () => {
    for (const t of ['1-2', '5 drops', '2 puffs', 'one', 'as directed', '0', '5-10 ml', '1 fingertip']) expect(parseDose(t), t).toBeNull();
  });
});

describe('one dose of a line', () => {
  it('strength × pieces, strength × volume, or the amount typed', () => {
    expect(singleDose(row('Paracetamol', '500 mg', '2'), 'mg')).toBe(1000);
    expect(singleDose(row('Paracetamol', '500 mg', ''), 'mg')).toBe(500); // no dose written: one
    expect(singleDose(row('Paracetamol', '1 g', '½'), 'mg')).toBe(500);
    expect(singleDose(row('Calpol', '250 mg/5 ml', '10', '1-0-1', 'syrup'), 'mg')).toBe(500); // a bare number of a syrup is ml
    expect(singleDose(row('Calpol drops', '100 mg/ml', '0.6 ml', '1-0-1', 'drops'), 'mg')).toBeCloseTo(60);
    expect(singleDose(row('Gentamicin', '', '15 mg', '1-0-0', 'inj'), 'mg')).toBe(15);
    expect(singleDose(row('Betamethasone', '12 mg', '1', 'stat', 'inj'), 'mg')).toBe(12); // one ampoule, as written
    expect(singleDose(row('Methergine', '0.125 mg', '1'), 'mcg')).toBeCloseTo(125);
    expect(singleDose(row('Dolo 650 mg', '', '1'), 'mg')).toBe(650);
  });
  it('null when the typed values do not allow it', () => {
    expect(singleDose(row('Paracetamol', '500', '2'), 'mg')).toBeNull();
    expect(singleDose(row('Paracetamol', '500 mg', '1-2'), 'mg')).toBeNull();
    expect(singleDose(row('Paracetamol', '500 mg', '30'), 'mg')).toBeNull(); // 30 tablets at once: a typing slip, not a dose
    expect(singleDose(row('Paracetamol', '500 mg', '10 ml'), 'mg')).toBeNull();
    expect(singleDose(row('Calpol', '250 mg/5 ml', '1', '1-0-1', 'tab'), 'mg')).toBeNull();
    expect(singleDose(row('Calpol drops', '100 mg/ml', '5 drops', '1-0-1', 'drops'), 'mg')).toBeNull();
    expect(singleDose(row('Paracetamol', '500 mg', '1', '1-0-1', 'cream'), 'mg')).toBeNull();
    // An injection with no dose written: the strength is what the vial holds, not the dose given from it
    expect(singleDose(row('Inj. Ampicillin', '500 mg', '', '1-0-1', 'inj'), 'mg')).toBeNull();
    expect(singleDose(row('Betamethasone', '12 mg', '', 'stat', 'inj'), 'mg')).toBeNull();
    for (const form of ['tab', 'cap', 'sachet', 'pessary', 'suppository']) expect(singleDose(row('Paracetamol', '500 mg', '', '1-0-1', form), 'mg'), form).toBe(500); // one, as it prints
    expect(singleDose(row('Vitamin D3', '60,000 IU', '1', 'weekly', 'sachet'), 'mg')).toBeNull(); // IU is not mg
    expect(singleDose(row('Vitamin D3', '60,000 IU', '1', 'weekly', 'sachet'), 'IU')).toBe(60000);
  });
  it('a combined medicine is never worked out', () => {
    expect(isCombined(row('Ibuprofen + Paracetamol', '400 mg', '1'))).toBe(true);
    expect(isCombined(row('Tramadol and paracetamol', '325 mg', '1'))).toBe(true);
    expect(isCombined(row('Amoxicillin/Clavulanate', '625 mg', '1'))).toBe(true);
    expect(isCombined(row('Combiflam', '400 mg + 325 mg', '1'))).toBe(true);
    expect(isCombined(row('Calpol 250 mg/5 ml', '', '5 ml'))).toBe(false);
    expect(isCombined(row('Vitamin D3', '60,000 IU', '1'))).toBe(false);
    expect(singleDose(row('Ibuprofen + Paracetamol', '400 mg', '1'), 'mg')).toBeNull();
  });
});

describe('how often', () => {
  it('knows every "how often" code of a prescription', () => {
    expect(Object.fromEntries(RX_FREQUENCIES.map((f) => [f, dosesPerDay(f)]))).toEqual({
      '1-0-0': 1, '0-1-0': 1, '0-0-1': 1, '1-0-1': 2, '1-1-1': 3, '1-1-1-1': 4, stat: 1, weekly: 1, alternate: 1, sos: null, custom: null,
    });
    expect(dosesPerDay('')).toBeNull();
  });
});

describe('amounts in words', () => {
  it('uses the next unit up for round thousands', () => {
    expect(amountText(4000, 'mg')).toBe('4 g');
    expect(amountText(2400, 'mg')).toBe('2.4 g');
    expect(amountText(1333, 'mg')).toBe('1333 mg');
    expect(amountText(650, 'mg')).toBe('650 mg');
    expect(amountText(2000, 'mcg')).toBe('2 mg');
    expect(amountText(18.75, 'mg', true)).toBe('18.8 mg/kg');
    expect(amountText(60000, 'IU')).toBe('60000 IU');
    expect(convert(1, 'g', 'mcg')).toBe(1_000_000);
    expect(convert(5, 'IU', 'mg')).toBeNull();
  });
});

describe('doseWarnings', () => {
  const check = (rows, extra = {}) => doseWarnings({ rows, list: [PARA, PARA_KG, METFORMIN], matches, ...extra });

  it('above the usual maximum of a dose, of a day, or both – never at the maximum itself', () => {
    expect(check([row('Paracetamol', '500 mg', '2', '1-1-1-1')])).toEqual([]);
    expect(check([row('Paracetamol', '650 mg', '1', '1-1-1-1')])).toEqual([]);
    const day = check([row('Paracetamol', '650 mg', '1', '1-1-1-1'), row('Dolo', '650 mg', '1', '1-1-1')]);
    expect(day).toEqual([
      {
        key: 'dose:para',
        level: 'dose',
        title: 'Paracetamol: above the usual maximum of 4 g a day',
        medicines: ['Paracetamol', 'Dolo'],
        message: 'As written: 650 mg a dose, 4550 mg a day. Usual maximum: 1 g a dose, 4 g a day. Less under 50 kg.',
      },
    ]);
    expect(check([row('Paracetamol', '1 g', '2', 'stat')])[0].title).toBe('Paracetamol: above the usual maximum of 1 g a dose');
    expect(check([row('Paracetamol', '1 g', '2', '1-1-1')])[0].title).toBe('Paracetamol: above the usual maximum of 1 g a dose and 4 g a day');
    expect(check([row('Metformin', '1 g', '1', '1-1-1')])[0]).toMatchObject({ title: 'Metformin: above the usual maximum of 2 g a day', message: 'As written: 1 g a dose, 3 g a day. Usual maximum: 2 g a day.' });
  });

  it('"only when needed" and the doctor’s own words: the dose is checked, the day is "at least"', () => {
    expect(check([row('Paracetamol', '500 mg', '2', 'sos')])).toEqual([]);
    const w = check([row('Paracetamol', '500 mg', '3', 'custom')]);
    expect(w[0].message).toBe('As written: 1.5 g a dose, at least 1.5 g a day. Usual maximum: 1 g a dose, 4 g a day. Less under 50 kg.');
  });

  it('babies: per kg with a weight; silent without one; adults never per kg', () => {
    const syrup = row('Paracetamol', '120 mg/5 ml', '5 ml', '1-1-1', 'syrup'); // 120 mg a dose
    expect(check([syrup], { baby: true, weight: null })).toEqual([]);
    expect(check([syrup], { baby: true, weight: { kg: 0, from: 'visit' } })).toEqual([]);
    expect(check([syrup], { baby: true, weight: { kg: 6, from: 'visit' } })).toEqual([]); // 20 mg/kg, 60 mg/kg a day
    const w = check([syrup], { baby: true, weight: { kg: 3.2, from: 'birth' } });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ key: 'dose:para_kg', title: 'Paracetamol (baby): above the usual maximum of 20 mg/kg a dose and 60 mg/kg a day' });
    expect(w[0].message).toBe('As written: 37.5 mg/kg a dose, 113 mg/kg a day for a weight of 3.2 kg (the birth weight – record today’s weight for a closer check). Usual maximum: 20 mg/kg a dose, 60 mg/kg a day.');
    expect(check([syrup])).toEqual([]); // an adult: 120 mg is far below the adult limit, and the per-kg entry is not hers
  });

  it('a baby’s injection with only the vial’s strength written: silent, never "As written" for a dose nobody wrote', () => {
    const AMPI = { key: 'ampi', kind: 'dose', label: 'Ampicillin (baby)', terms: ['ampicillin'], doseUnit: 'mg', maxSingle: 50, maxDaily: 200, perKg: true, message: '' };
    const baby = { baby: true, weight: { kg: 3, from: 'visit' }, ageDays: 20 };
    expect(doseWarnings({ rows: [row('Inj. Ampicillin', '500 mg', '', '1-0-1', 'inj')], list: [AMPI], matches, ...baby })).toEqual([]);
    // The dose written: checked as before
    expect(doseWarnings({ rows: [row('Inj. Ampicillin', '500 mg', '200 mg', '1-0-1', 'inj')], list: [AMPI], matches, ...baby })).toHaveLength(1);
  });

  describe('a baby’s limit by age (the lower doses of the first week of life)', () => {
    const WEEK1 = { key: 'genta_week1', kind: 'dose', label: 'Gentamicin (baby, first week of life)', terms: ['gentamicin'], doseUnit: 'mg', maxSingle: 5, maxDaily: 5, perKg: true, maxAgeDays: 7, message: '' };
    const LATER = { key: 'genta', kind: 'dose', label: 'Gentamicin (baby)', terms: ['gentamicin'], doseUnit: 'mg', maxSingle: 7.5, maxDaily: 7.5, perKg: true, maxAgeDays: null, message: '' };
    const genta = (mg) => [row('Inj. Gentamicin', '', `${mg} mg`, '1-0-0', 'inj')];
    const at = (ageDays, mg, list = [LATER, WEEK1]) => doseWarnings({ rows: genta(mg), list, matches, baby: true, weight: { kg: 3, from: 'visit' }, ageDays });

    it('a 3-day-old is checked against the first-week limit, an older baby against the general one – one warning, never two', () => {
      // 22 mg for 3 kg = 7.33 mg/kg: above 5 mg/kg in the first week, within 7.5 mg/kg later
      expect(at(3, 22).map((w) => w.key)).toEqual(['dose:genta_week1']);
      expect(at(3, 22)[0].title).toBe('Gentamicin (baby, first week of life): above the usual maximum of 5 mg/kg a dose and 5 mg/kg a day');
      expect(at(7, 22).map((w) => w.key)).toEqual(['dose:genta_week1']);
      expect(at(8, 22)).toEqual([]);
      expect(at(3, 15)).toEqual([]); // 5 mg/kg: the maximum itself
      // Far above both: still only the one that applies at this age
      expect(at(3, 30).map((w) => w.key)).toEqual(['dose:genta_week1']);
      expect(at(20, 30).map((w) => w.key)).toEqual(['dose:genta']);
    });

    it('age not known: the stricter limit is used, and the warning says to check', () => {
      const [w] = at(null, 22);
      expect(w).toMatchObject({ key: 'dose:genta_week1', unsureAge: true });
      expect(at(null, 30, [LATER])[0].unsureAge).toBeUndefined(); // a limit for any age: nothing to be unsure of
    });

    it('a list with only the first-week entry checks nothing after that age', () => {
      expect(at(3, 22, [WEEK1])).toHaveLength(1);
      expect(at(20, 60, [WEEK1])).toEqual([]);
    });

    it('an adult limit never takes an age', () => {
      const adult = { ...PARA, maxAgeDays: 7 };
      expect(doseWarnings({ rows: [row('Paracetamol', '1 g', '2', '1-1-1')], list: [adult], matches })).toHaveLength(1);
    });
  });

  it('ignores entries that are not dose limits or have no usable unit', () => {
    const rows = [row('Paracetamol', '1 g', '2', '1-1-1')];
    expect(doseWarnings({ rows, list: [{ ...PARA, kind: 'medicine' }, { ...PARA, doseUnit: '' }], matches })).toEqual([]);
    expect(doseWarnings({ rows: [], list: [PARA], matches })).toEqual([]);
  });
});

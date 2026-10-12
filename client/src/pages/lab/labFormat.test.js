// The lab module's helpers (Version 2): flags, one-line results, and the result form (fake sample values).
import { describe, expect, it } from 'vitest';
import { flagFor, formFromOrder, orderLook, resultLine, testNames, testsFromForm } from './labFormat.js';

const hb = { key: 'hb', name: 'Haemoglobin', type: 'number', unit: 'g/dL', low: 11, high: 16 };
const hiv = { key: 'hiv', name: 'HIV', type: 'choice', options: ['Non-reactive', 'Reactive'], abnormal: ['Reactive'] };
const organism = { key: 'organism', name: 'Organism', type: 'text' };
const catalogue = { tests: [{ key: 'hb', fields: [hb] }, { key: 'hiv', fields: [hiv] }, { key: 'urineCulture', fields: [organism] }] };

describe('lab helpers', () => {
  it('flags a value as the server does', () => {
    expect(flagFor(hb, '9.5')).toBe('low');
    expect(flagFor(hb, '17')).toBe('high');
    expect(flagFor(hb, '12,5')).toBe('normal');
    expect(flagFor(hb, '')).toBe('');
    expect(flagFor(hb, 'abc')).toBe('');
    expect(flagFor(hiv, 'Reactive')).toBe('abnormal');
    expect(flagFor(hiv, 'Non-reactive')).toBe('normal');
    expect(flagFor(organism, 'E. coli')).toBe('');
  });

  it('never suggests "Normal" for a number with no usual range (beta hCG): the doctor judges it', () => {
    const bhcg = { key: 'bhcg', name: 'Beta hCG', type: 'number', unit: 'mIU/mL', low: null, high: null };
    expect(flagFor(bhcg, '85000')).toBe('');
    expect(flagFor(bhcg, '12')).toBe('');
    const bile = { key: 'bileAcids', name: 'Total bile acids', type: 'number', unit: 'µmol/L', low: null, high: 18.9 };
    expect(flagFor(bile, '19')).toBe('high');
    expect(flagFor(bile, '8')).toBe('normal');
  });

  it('reads a typed number as the lab report prints it, and asks about "1,500" rather than guess', async () => {
    const { AMBIGUOUS_NUMBER, labNumber } = await import('./labFormat.js');
    expect(labNumber('1,23,456')).toEqual({ value: '123456' }); // Indian grouping
    expect(labNumber('1,234,567.5')).toEqual({ value: '1234567.5' });
    expect(labNumber('1,500.5')).toEqual({ value: '1500.5' });
    expect(labNumber('12,5')).toEqual({ value: '12.5' }); // a decimal comma
    expect(labNumber(' 9.5 ')).toEqual({ value: '9.5' });
    expect(labNumber('1,500')).toEqual({ error: AMBIGUOUS_NUMBER });
    expect(labNumber('85,000')).toEqual({ error: AMBIGUOUS_NUMBER });
    expect(labNumber('<2')).toEqual({ error: 'Enter a number.' });
    expect(AMBIGUOUS_NUMBER).toBe('Write it without the comma (1500), or with a point if it is a decimal (1.5).');
    // A grouped number is flagged on its real value – in a field that can hold one (a white cell count per µL)
    const tlc = { key: 'tlc', name: 'Total WBC count', type: 'number', unit: '/µL', low: 4000, high: 11000, range: '4000–11000 /µL' };
    expect(flagFor(tlc, '12,000.5')).toBe('high');
    expect(flagFor(hb, '1,500')).toBe('');
    // Elsewhere it is a count in another unit: refused with the unit, never flagged (platelets typed per µL in lakh/µL)
    const { groupsDigits } = await import('./labFormat.js');
    const platelets = { key: 'platelets', name: 'Platelets', type: 'number', unit: 'lakh/µL', low: 1.5, high: 4.5, range: '1.5–4.5 lakh/µL' };
    expect(labNumber('1,40,000', platelets)).toEqual({ error: 'This is far too large for lakh/µL – check the unit (1.5–4.5 lakh/µL).' });
    expect(flagFor(platelets, '1,40,000')).toBe('');
    expect(flagFor(hb, '1,600.5')).toBe('');
    expect([groupsDigits(platelets), groupsDigits(hb), groupsDigits(tlc), groupsDigits({ type: 'number', low: null, high: null }), groupsDigits(null)]).toEqual([false, false, true, true, true]);
  });

  it('writes the results in one line, with Low / High in words', () => {
    expect(resultLine({ key: 'hb', values: [{ key: 'hb', value: '9.5', flag: 'low' }], text: '' }, catalogue)).toBe('Haemoglobin 9.5 g/dL (Low)');
    expect(resultLine({ key: 'other', values: [], text: 'Low risk' }, catalogue)).toBe('Low risk');
    expect(testNames({ tests: [{ name: 'Hb' }, { name: 'HIV' }] })).toBe('Hb, HIV');
    expect(orderLook({ status: 'reported' }).word).toBe('Reported – to review');
  });

  it('turns the result form into the request and back', () => {
    const order = { tests: [{ key: 'hb', values: [{ key: 'hb', value: '9.5', flag: 'low' }], text: '' }, { key: 'hiv', values: [], text: '' }, { key: 'other', values: [], text: 'Pending' }] };
    const form = formFromOrder(order);
    expect(form[0].values.hb).toMatchObject({ value: '9.5', flag: 'low' });
    form[1].values.hiv = { value: 'Reactive', flag: 'abnormal' };
    form[2].text = ' Negative ';
    expect(testsFromForm(order, form, catalogue)).toEqual([
      { key: 'hb', values: [{ key: 'hb', value: '9.5', flag: 'low' }], text: '' },
      { key: 'hiv', values: [{ key: 'hiv', value: 'Reactive', flag: 'abnormal' }], text: '' },
      { key: 'other', values: [], text: 'Negative' },
    ]);
  });
});

describe('baby packages by day of life', () => {
  it('counts the day of birth as day 0 and finds the packages that fit', async () => {
    const { dayOfLife, packageFits, packageDays, testsFor } = await import('./labFormat.js');
    const now = new Date(2026, 9, 2, 10, 0);
    expect(dayOfLife(new Date(2026, 9, 2, 1, 0), now)).toBe(0);
    expect(dayOfLife(new Date(2026, 8, 29, 23, 0), now)).toBe(3);
    expect(dayOfLife(null, now)).toBeNull();
    const discharge = { fromDay: 2, toDay: 7 };
    expect(packageFits(discharge, 3)).toBe(true);
    expect(packageFits(discharge, 8)).toBe(false);
    expect(packageFits({ fromDay: 14, toDay: null }, 40)).toBe(true);
    expect(packageDays({ fromDay: 0, toDay: 0 })).toBe('Day 0');
    expect(packageDays({ fromDay: 2, toDay: 7 })).toBe('Day 2–7');
    expect(packageDays({ fromDay: 14, toDay: null })).toBe('From day 14');
    expect(testsFor({ careType: 'newborn' })).toBe('newborn');
    expect(testsFor({ careType: 'antenatal' })).toBe('adult');
  });
});

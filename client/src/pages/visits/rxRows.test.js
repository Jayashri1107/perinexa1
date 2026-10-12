// Medicine rows and adding a ready-made set to a prescription (fake sample data only).
import { describe, expect, it } from 'vitest';
import { addSet, appendText, emptyRow, isUsual, rowProblems, sameMedicine, toItem, toRow } from './rxRows.js';

const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days', route: '', instructions: '' };
const IFA_ROUTINE = { drug: 'Iron + folic acid (IFA)', form: 'tab', strength: '60 mg + 500 mcg', dose: '1', frequency: '0-1-0', timing: 'after_food', durationValue: null, durationUnit: 'till_delivery' };
const IFA_ANAEMIA = { ...IFA_ROUTINE, frequency: '1-0-1', durationValue: 3, durationUnit: 'months', instructions: 'Not with tea, coffee or milk' };
const PESSARY = { drug: 'Clotrimazole', form: 'pessary', strength: '100 mg', dose: '1', frequency: '0-0-1', timing: 'bedtime', durationValue: 7, durationUnit: 'days', route: 'vaginal' };
const CREAM = { drug: 'Clotrimazole', form: 'cream', strength: '1%', dose: '', frequency: '1-0-1', timing: '', durationValue: 7, durationUnit: 'days', route: 'local' };
const set = (items, more = {}) => ({ name: 'Sample set', items, notes: '', investigations: '', advice: '', ...more });

describe('a row', () => {
  it('goes back to the same medicine when saved', () => {
    const r = toRow(FOLIC);
    expect(r.durationValue).toBe('30');
    expect(toItem(r)).toEqual({ ...FOLIC, frequencyText: '' });
    expect(toItem({ ...emptyRow(), drug: '  Folic acid ' }).drug).toBe('Folic acid');
  });

  it('knows the doctor’s usual way of writing a medicine', () => {
    expect(isUsual(toRow(FOLIC), FOLIC)).toBe(true);
    expect(isUsual(toRow({ ...FOLIC, dose: '2' }), FOLIC)).toBe(false);
  });

  it('is checked like the server checks it, including words about the baby’s sex', () => {
    const rows = [toRow({ ...FOLIC, frequency: 'custom' }), toRow({ ...FOLIC, drug: '', durationValue: null }), toRow({ ...FOLIC, instructions: 'for a boy' })];
    expect(rowProblems(rows)).toMatchObject({
      'items.0.frequencyText': 'Write how often',
      'items.1.drug': 'Enter the medicine',
      'items.1.durationValue': 'Enter how many',
      'items.2.instructions': expect.stringContaining('PCPNDT'),
    });
    expect(rowProblems([toRow({ ...FOLIC, instructions: 'for a boy' })], { checkFetalSex: false })).toEqual({});
  });
});

describe('adding a ready-made set', () => {
  it('adds new medicines at the end and the set’s instructions to the notes', () => {
    const rows = [toRow(FOLIC)];
    const r = addSet({ rows, notes: 'Rest well.' }, set([IFA_ROUTINE], { notes: 'Iron and calcium 2 hours apart.' }));
    expect(r.rows.map((x) => x.drug)).toEqual(['Folic acid', 'Iron + folic acid (IFA)']);
    expect(r.rows[0]).toBe(rows[0]);
    expect(r).toMatchObject({ added: ['Iron + folic acid (IFA)'], replaced: [], notes: 'Rest well.\nIron and calcium 2 hours apart.' });
  });

  it('replaces a medicine already there with the set’s version, in its place', () => {
    const rows = [toRow(IFA_ROUTINE), toRow(FOLIC)];
    const r = addSet({ rows, notes: '' }, set([{ ...IFA_ANAEMIA, drug: 'iron + folic acid (ifa)' }]));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ key: rows[0].key, frequency: '1-0-1', durationValue: '3', durationUnit: 'months' });
    expect(r.rows[1]).toBe(rows[1]);
    expect(r).toMatchObject({ added: [], replaced: ['iron + folic acid (ifa)'] });
  });

  it('keeps a pessary and a cream of the same medicine apart', () => {
    expect(sameMedicine(toRow(PESSARY), CREAM)).toBe(false);
    const r = addSet({ rows: [], notes: '' }, set([PESSARY, CREAM]));
    expect(r.rows.map((x) => x.form)).toEqual(['pessary', 'cream']);
    const again = addSet({ rows: r.rows, notes: '' }, set([PESSARY, CREAM]));
    expect(again.rows).toHaveLength(2);
    expect(again.replaced).toEqual(['Clotrimazole', 'Clotrimazole']);
  });
});

describe('adding text', () => {
  it('adds a new line once, never twice', () => {
    expect(appendText('', 'CBC')).toBe('CBC');
    expect(appendText('Urine routine', ' CBC ')).toBe('Urine routine\nCBC');
    expect(appendText('Urine routine\nCBC', 'CBC')).toBe('Urine routine\nCBC');
    expect(appendText('Urine routine', '')).toBe('Urine routine');
  });
});

import { describe, expect, it } from 'vitest';
import { STOCK_STATUS, stockKey, stockQuestions } from './rxStock.js';

// Pharmacy stock while prescribing: which lines are asked about, and the words shown.
const row = (drug, strength = '', form = 'tab') => ({ key: `row-${drug}`, drug, strength, form, dose: '1', frequency: '1-0-1' });

describe('stock while prescribing', () => {
  it('a line is known by its medicine, strength and form – not by its dose or how often', () => {
    expect(stockKey(row(' Dolo 650 ', ' 650 MG '))).toBe('dolo 650|650 mg|tab');
    expect(stockKey({ ...row('Dolo 650', '650 mg'), dose: '2', frequency: '1-1-1' })).toBe(stockKey(row('Dolo 650', '650 mg')));
    expect(stockKey(row('Dolo 650', '650 mg', 'syrup'))).not.toBe(stockKey(row('Dolo 650', '650 mg')));
  });

  it('asks once about each line worth asking about, and never again about one already answered', () => {
    const rows = [row('Paracetamol', '500 mg'), row('paracetamol', '500 MG'), row('Pa'), row(''), row('Shelcal 500')];
    expect(stockQuestions(rows)).toEqual([
      { key: 'paracetamol|500 mg|tab', drug: 'Paracetamol', strength: '500 mg', form: 'tab' },
      { key: 'shelcal 500||tab', drug: 'Shelcal 500', strength: '', form: 'tab' },
    ]);
    const known = new Map([['paracetamol|500 mg|tab', 'in']]);
    expect(stockQuestions(rows, known).map((q) => q.drug)).toEqual(['Shelcal 500']);
    // A medicine the pharmacy could not match (null) is not asked about again either
    expect(stockQuestions(rows, new Map([...known, ['shelcal 500||tab', null]]))).toEqual([]);
    expect(stockQuestions(Array.from({ length: 60 }, (_, i) => row(`Medicine ${i}`)))).toHaveLength(40);
  });

  it('every status has its colour and its words', () => {
    expect(STOCK_STATUS).toEqual({
      in: { tone: 'stable', word: 'In the pharmacy' },
      low: { tone: 'watch', word: 'In the pharmacy – low stock' },
      out: { tone: 'inactive', word: 'Not in stock' },
    });
  });
});

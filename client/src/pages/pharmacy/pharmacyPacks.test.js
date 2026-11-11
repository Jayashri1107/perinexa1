// PH2 (docs/PHARMACY_BUILD_NOTE.md): pack sizes at the counter and on the stock list – the same price as the server
// (server/src/pharmacy/gst.js grossOf), quantities in packs and loose units, and "not split".
import { describe, expect, it } from 'vitest';
import { inPacks, looseProblem, packWords, priceOf } from './pharmacyFormat.js';

const strip = { unit: 'tablet', packSize: 10, packName: 'strip', looseSale: true };

describe('packs', () => {
  it('prices a batch bought by the pack from the pack MRP, loose units rounded down', () => {
    const b = { mrpPaise: 666, packMrpPaise: 10000, unitsPerPack: 15 };
    expect([priceOf(b, 15), priceOf(b, 30), priceOf(b, 7)]).toEqual([10000, 20000, 4666]);
    expect(priceOf({ mrpPaise: 666 }, 15)).toBe(9990);
    expect(priceOf({}, 3)).toBeNull();
  });
  it('says a quantity in packs and loose units', () => {
    expect([inPacks(143, strip), inPacks(140, strip), inPacks(1, strip), inPacks(7, { unit: 'bottle', packSize: 1 })]).toEqual(['14 strips and 3 tablets', '14 strips', '1 tablet', '7 bottles']);
    expect(packWords(strip)).toBe('Strip of 10 tablets');
    expect(packWords({ ...strip, looseSale: false })).toBe('Strip of 10 tablets – not split');
  });
  it('a medicine not sold loose: only whole packs', () => {
    const whole = { ...strip, looseSale: false };
    expect(looseProblem(whole, 15)).toBe('Sold in whole strips of 10 only.');
    expect(looseProblem(whole, 20)).toBeNull();
    expect(looseProblem(strip, 15)).toBeNull();
  });
});

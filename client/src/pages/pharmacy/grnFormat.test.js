import { describe, expect, it } from 'vitest';
import { grnLineFigures, grnTotals, perUnit } from './grnFormat.js';

// The purchase bill's sums on the screen – the same as the server's (server/src/pharmacy/grn.js).
describe('the purchase bill (GRN) sums', () => {
  it('works the bill down to the net to pay, rounded to the rupee', () => {
    const sums = grnTotals([{ qty: 2, ratePaise: 3000, discPercent: 10, gstRate: 5 }], { taxType: 'igst', schemeDiscPaise: 500, discPercent: 2, otherChargesPaise: 1000, freightPaise: 500 });
    expect(sums).toMatchObject({ totalPaise: 6000, itemDiscPaise: 600, discPaise: 108, lessPaise: 1208, addPaise: 1500, gstPaise: 270, igstPaise: 270, cgstPaise: 0, roundingPaise: 38, netPaise: 6600 });
    expect(grnTotals([{ qty: 3, ratePaise: 333, gstRate: 5 }], { taxType: 'cgst_sgst' })).toMatchObject({ cgstPaise: 25, sgstPaise: 25, netPaise: 1000 });
  });
  it('turns packs into units of sale; a unit is never priced above the pack’s MRP', () => {
    expect(perUnit({ conv: 10, qty: 2, freeQty: 1, ratePaise: 3000, mrpPaise: 4505 })).toEqual({ qty: 20, freeQty: 10, ratePaise: 300, mrpPaise: 450 });
  });
});

describe("the medicine pop-up's figures", () => {
  it('works out the line as on the earlier software (Dolo 650: 10 packs of 15 at ₹24.59, MRP ₹32.25, GST 5 %)', () => {
    expect(grnLineFigures({ conv: 15, qty: 10, freeQty: 0, ratePaise: 2459, mrpPaise: 3225, discPercent: 0, gstRate: 5 })).toEqual({
      totalPaise: 24590,
      discPaise: 0,
      gstPaise: 1230,
      netPaise: 25820,
      units: 150,
      landedPaise: 172,
      saleRatePaise: 215,
      profitPercent: 25,
    });
  });
  it('counts the free packs in the units, so they lower the landed rate', () => {
    const f = grnLineFigures({ conv: 10, qty: 9, freeQty: 1, ratePaise: 1000, mrpPaise: 1500, discPercent: 10, gstRate: 12 });
    expect(f).toMatchObject({ totalPaise: 9000, discPaise: 900, gstPaise: 972, netPaise: 9072, units: 100, landedPaise: 91, saleRatePaise: 150 });
  });
  it('leaves the per-unit figures empty until there is something to divide', () => {
    expect(grnLineFigures({ conv: 10 })).toMatchObject({ units: 0, landedPaise: null, saleRatePaise: null, profitPercent: null });
  });
});

describe('the expiry typed on the purchase pop-up', () => {
  it('reads a month and year the way packs print it', async () => {
    const { typedExpiry } = await import('./grnFormat.js');
    for (const t of ['08/27', '8/27', '08/2027', '0827', '082027', '08-27', '08.2027', ' 8 / 2027 ', '15/08/2027']) expect(typedExpiry(t)).toBe('2027-08');
    expect(typedExpiry('12/30')).toBe('2030-12');
  });
  it('refuses what is not a month and year', async () => {
    const { typedExpiry } = await import('./grnFormat.js');
    for (const t of ['', '13/27', '00/27', '8', '827', 'aug 27', '08/1999', '31/02']) expect(typedExpiry(t)).toBeNull();
  });
  it('adds the slash after the month and shows a saved month back', async () => {
    const { expiryAsTyped, expiryTyped } = await import('./grnFormat.js');
    expect(expiryAsTyped('08', '0')).toBe('08/');
    expect(expiryAsTyped('08', '08/')).toBe('08'); // deleting the slash
    expect(expiryAsTyped('08/27x', '08/27')).toBe('08/27');
    expect(expiryTyped('2027-08')).toBe('08/2027');
    expect(expiryTyped('')).toBe('');
  });
});

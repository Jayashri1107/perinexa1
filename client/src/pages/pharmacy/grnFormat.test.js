import { describe, expect, it } from 'vitest';
import { grnTotals, perUnit } from './grnFormat.js';

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

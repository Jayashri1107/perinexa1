// Refund of a bill and bill settlement: the amounts shown before saving (fake sample data).
import { describe, expect, it } from 'vitest';
import { isCredit, liveServices, refundFor, settlementCheck } from './refundFormat.js';

const lines = [
  { id: 'consult', amountPaise: 50000, removed: null },
  { id: 'cert', amountPaise: 10000, removed: null },
  { id: 'old', amountPaise: 9900, removed: { reason: 'entered twice' } },
];

describe('the refund of a bill', () => {
  it('gives back what was paid beyond the new total', () => {
    const bill = { lines, paid: 60000, discount: 0, discountInfo: null };
    expect(liveServices(bill).map((l) => l.id)).toEqual(['consult', 'cert']);
    expect(refundFor(bill, ['cert'])).toBe(10000);
    expect(refundFor(bill, ['consult', 'cert'])).toBe(60000);
    expect(refundFor({ ...bill, paid: 20000 }, ['cert'])).toBe(0); // still 30000 due: nothing to give back
  });

  it('a percentage discount follows the new subtotal; an amount discount stays', () => {
    expect(refundFor({ lines, paid: 54000, discount: 6000, discountInfo: { mode: 'percent', value: 10 } }, ['cert'])).toBe(9000);
    expect(refundFor({ lines, paid: 55000, discount: 5000, discountInfo: { mode: 'amount', value: 5000 } }, ['cert'])).toBe(10000);
  });
});

describe('settling a credit bill', () => {
  const bill = { balance: 40000 };
  it('a credit bill has money due and is not cancelled', () => {
    expect(isCredit({ status: 'part_paid', balance: 40000 })).toBe(true);
    expect(isCredit({ status: 'paid', balance: 0 })).toBe(false);
    expect(isCredit({ status: 'cancelled', balance: 5000 })).toBe(false);
  });

  it('needs a reason for a concession, and takes at most what is due', () => {
    expect(settlementCheck(bill, { concessionPaise: 5000, amountPaise: 35000, mode: 'cash' }).fields).toHaveProperty('concessionReason');
    expect(settlementCheck(bill, { concessionPaise: 5000, concessionReason: 'Staff family', amountPaise: 35000, mode: 'cash' })).toEqual({ fields: {}, left: 0 });
    expect(settlementCheck(bill, { amountPaise: 45000, mode: 'cash' }).fields).toHaveProperty('amountPaise');
    expect(settlementCheck(bill, { amountPaise: 10000, mode: 'cash' })).toEqual({ fields: {}, left: 30000 });
    expect(settlementCheck(bill, {}).fields).toHaveProperty('amountPaise');
  });
});

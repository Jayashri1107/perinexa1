// The daily collection's figures and the reports' filter (fake sample data).
import { describe, expect, it } from 'vitest';
import { dayFigures } from './DailyCollectionPage.jsx';
import { filterRows } from './MisReportsPage.jsx';

describe('the day at a glance', () => {
  it('takes the expenses off what was collected', () => {
    const d = { totals: { in: 70000, out: 5000, net: 65000, expenses: 20000, balance: 45000 }, cashInHand: 30000, byMode: [] };
    expect(dayFigures(d)).toEqual({ collected: 70000, givenBack: 5000, net: 65000, expenses: 20000, balance: 45000, cashInHand: 30000 });
  });
  it('counts no expenses for a summary without them', () => {
    const d = { totals: { in: 1000, out: 0, net: 1000 }, byMode: [{ mode: 'cash', net: 1000 }] };
    expect(dayFigures(d)).toMatchObject({ expenses: 0, balance: 1000, cashInHand: 1000 });
  });
});

describe('the filter of a report', () => {
  const report = { columns: [{ key: 'patient', label: 'Patient' }, { key: 'amount', label: 'Amount', money: true }], rows: [{ patient: 'Asha Sample', amount: 30000 }, { patient: 'Meera Sample', amount: 50000 }] };
  it('keeps the rows with the words typed, in any column', () => {
    expect(filterRows(report, 'meera').map((r) => r.patient)).toEqual(['Meera Sample']);
    expect(filterRows(report, '₹300').map((r) => r.patient)).toEqual(['Asha Sample']);
    expect(filterRows(report, '  ')).toHaveLength(2);
  });
});

// Reception's Today: the number cards and the payments to collect (fake sample data only).
import { describe, expect, it } from 'vitest';
import { paymentsToCollect, receptionCounts } from './todayReception.js';

const row = (id, arrivedAt = null) => ({ patient: { id }, arrivedAt });

describe('the number cards', () => {
  it('counts today’s patients, who arrived and who is still expected, and the calls to make', () => {
    const c = receptionCounts({ patients: [row('a', '2026-10-13T04:00:00Z'), row('b'), row('c')], dueNow: [], overdue: [{}, {}], babiesDue: [{}] });
    expect(c).toEqual({ patients: 3, arrived: 1, expected: 2, calls: 3, callsList: 'td-overdue' });
  });
  it('works before the lists have loaded', () => {
    expect(receptionCounts(null)).toEqual({ patients: 0, arrived: 0, expected: 0, calls: 0, callsList: 'td-overdue' });
  });
});

describe('payments to collect', () => {
  const bill = (id, patientId, balance, stay = null, extra = {}) => ({ id, patient: { id: patientId }, balance, stay, cancelled: null, ...extra });
  it('lists unpaid bills of patients here today and of stays that have ended – most owed first', () => {
    const bills = [
      bill('1', 'a', 30000),
      bill('2', 'b', 50000), // not here today, still owing: not an alert now
      bill('3', 'c', 120000, { inHospital: false }),
      bill('4', 'd', 90000, { inHospital: true }), // still in hospital: settled at discharge
      bill('5', 'a', -5000), // money due back is not a payment to collect
    ];
    const out = paymentsToCollect(bills, [row('a', '2026-10-13T04:00:00Z'), row('d', '2026-10-13T04:00:00Z')]);
    expect(out.map((x) => [x.bill.id, x.why])).toEqual([
      ['3', 'discharged'],
      ['1', 'here'],
    ]);
  });
});

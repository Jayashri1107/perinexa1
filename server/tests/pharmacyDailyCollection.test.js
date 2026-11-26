// Reports → Sales collection as the Pharmacy Daily Collection (24 Nov 2026, after the pharmacy's earlier software's
// printed report): Cash Sales, Cash Sales Return, Credit Sale, Due Collection; the money by mode; the net collection
// and the sale types. Pure – no database. Sample data only.
import { describe, expect, it } from 'vitest';
import { dailyCollection } from '../src/pharmacy/dailyCollection.js';
import { misReport } from '../src/pharmacy/misReports.js';

const money = (amount) => ({ amountPaise: amount, taxablePaise: Math.round((amount * 100) / 105), gstPaise: amount - Math.round((amount * 100) / 105), cgstPaise: 0, sgstPaise: 0 });
const line = (id, amount, extra = {}) => ({ _id: id, name: 'Sample Iron 100', batch: 'I1', qty: 1, mrpPaise: amount, grossPaise: amount, ...money(amount), returnedQty: 0, ...extra });
const ist = (day, hm) => new Date(`${day}T${hm}:00+05:30`);
const pay = (mode, amountPaise, at, kind = 'payment') => ({ kind, mode, amountPaise, at, byName: 'Sample Pharmacist' });
const inv = (id, number, patientId, amount, at, extra = {}) => ({ _id: id, tenantId: 't1', number, kind: 'sale', patientId, customer: patientId ? null : { name: 'Sample Walk In', phone: '' }, lines: [line(`${id}-l`, amount)], payments: [], returns: [], concessions: [], billId: null, created: { at }, ...extra });

describe('Pharmacy Daily Collection', () => {
  const day = (iso) => ({ from: new Date(`${iso}T00:00:00+05:30`), to: new Date(new Date(`${iso}T00:00:00+05:30`).getTime() + 86_400_000) });
  const D = '2026-11-23';
  const patients = new Map([['p1', { fullName: 'Sample Asha Kale', mrn: 'SH-0001' }], ['p2', { fullName: 'Sample Meera Patil', mrn: 'SH-0002' }]]);
  const invoices = [
    inv('a', 'PH-000101', null, 50000, ist(D, '10:00'), { payments: [pay('cash', 50000, ist(D, '10:00'))] }),
    inv('b', 'PH-000102', 'p1', 30000, ist(D, '10:30'), { payments: [pay('upi', 10000, ist(D, '10:30'))] }),
    inv('c', 'PH-000090', 'p2', 100000, ist('2026-11-22', '18:00'), { payments: [pay('card', 60000, ist(D, '11:00'))] }),
    inv('d', 'PH-000103', null, 40000, ist(D, '12:00'), {
      lines: [line('d-l', 40000, { returnedQty: 1 })],
      payments: [pay('cash', 40000, ist(D, '12:00')), pay('cash', 15000, new Date(ist(D, '15:00').getTime() + 40), 'refund')],
      returns: [{ number: 'CN-000007', at: ist(D, '15:00'), lines: [{ lineId: 'd-l', qty: 1, ...money(15000) }] }],
    }),
    inv('e', 'PH-000104', 'p1', 70000, ist(D, '13:00'), { billId: 'bill1' }),
    inv('f', 'PH-000105', 'p1', 9000, ist(D, '13:30'), { kind: 'issue', billId: 'bill1' }),
    inv('g', 'PH-000106', 'p2', 80000, ist(D, '14:00'), { payments: [pay('advance', 30000, ist(D, '14:00')), pay('cash', 50000, ist(D, '14:00'))] }),
    // on credit at 16:00, settled at 16:05 the same day: ₹150 in cash and a ₹50 concession
    inv('h', 'PH-000107', 'p1', 20000, ist(D, '16:00'), { payments: [{ ...pay('cash', 15000, ist(D, '16:05')), settlementId: 's1' }], concessions: [{ amountPaise: 5000, at: ist(D, '16:05'), settlementId: 's1' }] }),
  ];
  const advances = [
    { patientId: 'p1', kind: 'deposit', mode: 'cash', amountPaise: 100000, created: { at: ist(D, '09:00') } },
    { patientId: 'p1', kind: 'refund', mode: 'upi', amountPaise: 20000, created: { at: ist(D, '17:00') } },
    { patientId: 'p1', kind: 'deposit', mode: 'cash', amountPaise: 999900, created: { at: ist('2026-11-22', '09:00') } },
    { patientId: 'p2', kind: 'used', amountPaise: 30000, created: { at: ist(D, '14:00') } },
  ];

  it('one day: the four sections, by mode', () => {
    const r = dailyCollection({ invoices, patients, advances }, day(D));
    const rows = Object.fromEntries(r.sections.map((s) => [s.key, s.rows.map((x) => [x.saleNumber, x.date, x.mrn, x.netPaise, x.cashPaise, x.cardPaise, x.upiPaise, x.advancePaise])]));
    expect(rows['cash-sales']).toEqual([
      ['PH-000101', D, '', 50000, 50000, 0, 0, 0],
      ['PH-000102', D, 'SH-0001', 10000, 0, 0, 10000, 0],
      ['PH-000103', D, '', 40000, 40000, 0, 0, 0],
      ['PH-000106', D, 'SH-0002', 80000, 50000, 0, 0, 30000],
    ]);
    expect(rows['cash-sales-return']).toEqual([['CN-000007', D, '', 15000, 15000, 0, 0, 0]]);
    // 26 Nov 2026 (the pharmacy's request): a bill on credit is a credit sale as it was saved, and its settlement – the
    // same day or later – is in Due Collection
    expect(rows['credit-sale']).toEqual([
      ['PH-000102', D, 'SH-0001', 20000, 0, 0, 0, 0],
      ['PH-000104', D, 'SH-0001', 70000, 0, 0, 0, 0],
      ['PH-000107', D, 'SH-0001', 20000, 0, 0, 0, 0],
    ]);
    expect(rows['due-collection']).toEqual([
      ['PH-000090', D, 'SH-0002', 60000, 0, 60000, 0, 0],
      ['PH-000107', D, 'SH-0001', 15000, 15000, 0, 0, 0],
    ]);
    expect(r.sections[0].rows[0].name).toBe('Sample Walk In');
    const m = Object.fromEntries(r.modes.map((x) => [x.mode, [x.salesPaise, x.returnPaise, x.advancePaise, x.advanceRefundPaise, x.netPaise]]));
    expect(m).toEqual({ cash: [155000, 15000, 100000, 0, 240000], cheque: [0, 0, 0, 0, 0], card: [60000, 0, 0, 0, 60000], neft: [0, 0, 0, 0, 0], upi: [10000, 0, 0, 20000, -10000] });
    expect(r.summary).toMatchObject({ salesPaise: 225000, returnPaise: 15000, advancePaise: 100000, advanceRefundPaise: 20000, netCollectionPaise: 290000, advanceUsedPaise: 30000, saleCount: 6 });
    expect(r.saleTypes.map((t) => [t.label, t.paise])).toEqual([['Cash Sales', 180000], ['Cash Sales Return', 15000], ['Credit Sale', 110000], ['Due Collection', 75000]]);
  });

  it('two days are the sum of the days: a credit sale on one, its payment on the next', () => {
    const both = { from: day('2026-11-22').from, to: day(D).to };
    const r = dailyCollection({ invoices, patients, advances }, both);
    const credit = r.sections.find((s) => s.key === 'credit-sale').rows.map((x) => [x.saleNumber, x.date, x.netPaise]);
    expect(credit).toEqual([['PH-000090', '2026-11-22', 100000], ['PH-000102', D, 20000], ['PH-000104', D, 70000], ['PH-000107', D, 20000]]);
    expect(r.sections.find((s) => s.key === 'due-collection').rows.map((x) => [x.saleNumber, x.date])).toEqual([['PH-000090', D], ['PH-000107', D]]);
    expect(r.modes.find((x) => x.mode === 'cash').advancePaise).toBe(100000 + 999900);
    const one = dailyCollection({ invoices, patients, advances }, day('2026-11-22'));
    const two = dailyCollection({ invoices, patients, advances }, day(D));
    expect(r.summary.netCollectionPaise).toBe(one.summary.netCollectionPaise + two.summary.netCollectionPaise);
  });

  it('Sales collection carries it, its payment list unchanged', () => {
    const rep = misReport('collection', { invoices, patients, advances }, day(D));
    expect(rep.daily.summary.netCollectionPaise).toBe(290000);
    expect(rep.rows.length).toBeGreaterThan(0);
    expect(rep.columns.map((c) => c.k)).toContain('mode');
    expect(misReport('card-collection', { invoices, patients, advances }, day(D)).daily).toBe(undefined);
  });
});

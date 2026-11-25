// Search bill (23 Nov 2026, routes/pharmacyBillSearch.js and pharmacy/billSearch.js): the bills that fit a patient
// type, name, UHID, sales number, dates, item and cash or credit, with the sums under the list – as the "Browse Sales
// Bill" window of the pharmacy's earlier software. All fake sample data.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { BILL_SEARCH_LIMIT, billFilter, billRow, billTotals, isCredit, payFits } from '../src/pharmacy/billSearch.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');

let app;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  app = createApp();
  const hospital = await createTenant('Bill Search Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries({ pharm: 'pharmacist', reception: 'receptionist', drA: 'doctor', admin: 'admin' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const search = async (query = {}, who = 'pharm') => ph('get', `/bill-search?${new URLSearchParams(query)}`, undefined, who);
const numbers = async (query) => ok(await search(query)).bills.map((b) => b.number).sort();
const register = async (fullName) => ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName, assignedDoctor: people.drA._id.toString() })), 201).patient;

/** Two medicines in stock: Sample Folic 5 at ₹2 and Sample Iron 100 at ₹5 a tablet. */
async function stocked() {
  const sup = ok(await ph('post', '/suppliers', { name: 'Sample Distributors' }), 201).supplier;
  const folic = ok(await ph('post', '/medicines', { name: 'Sample Folic 5', generic: 'Folic acid', form: 'tablet', unit: 'tablet', gstRate: 5 }), 201).medicine;
  const iron = ok(await ph('post', '/medicines', { name: 'Sample Iron 100', generic: 'Ferrous sulphate', form: 'tablet', unit: 'tablet', gstRate: 5 }), 201).medicine;
  ok(
    await ph('post', '/purchases', {
      supplierId: sup.id,
      invoiceNo: 'INV-9',
      invoiceDate: '2026-09-27',
      lines: [
        { medicineId: folic.id, batch: 'F1', expiry: '2028-06', qty: 50, ratePaise: 100, mrpPaise: 200 },
        { medicineId: iron.id, batch: 'I1', expiry: '2028-06', qty: 50, ratePaise: 100, mrpPaise: 500 },
      ],
    }),
    201,
  );
  return { folic, iron };
}

/** A walk-in paid in cash with a discount, a patient's bill on credit, and one on a patient's hospital bill. */
async function threeBills() {
  const { folic, iron } = await stocked();
  const asha = await register('Sample Asha Kale');
  const meera = await register('Sample Meera Patil');
  const walkIn = ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In', phone: '' }, lines: [{ medicineId: folic.id, qty: 3 }], discountPercent: 10, discountReason: 'Staff family', payment: { mode: 'cash' } }), 201).invoice;
  const credit = ok(await ph('post', '/invoices', { kind: 'sale', patientId: asha.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', lines: [{ medicineId: iron.id, qty: 2 }] }), 201).invoice;
  const hospital = ok(await ph('post', '/invoices', { kind: 'sale', patientId: meera.id, onHospitalBill: true, lines: [{ medicineId: folic.id, qty: 1 }, { medicineId: iron.id, qty: 1 }] }), 201).invoice;
  return { folic, iron, asha, meera, walkIn, credit, hospital };
}

describe('Search bill', () => {
  it('lists the day’s bills with their medicines and the sums; sales = received + credit', async () => {
    const { asha, walkIn, credit, hospital } = await threeBills();
    const res = ok(await search({ from: '2026-09-28', to: '2026-09-28' }));
    expect(res.bills.map((b) => b.number).sort()).toEqual([walkIn.number, credit.number, hospital.number].sort());
    const row = (inv) => res.bills.find((b) => b.id === inv.id);
    expect(row(walkIn)).toMatchObject({ type: 'external', mrn: '', name: 'Sample Walk In', discPaise: 60, netPaise: 540, paidPaise: 540, balPaise: 0, onHospitalBill: false });
    expect(row(credit)).toMatchObject({ type: 'opd', mrn: asha.mrn, name: 'Sample Asha Kale', discPaise: 0, netPaise: 1000, paidPaise: 0, balPaise: 1000, onHospitalBill: false });
    expect(row(hospital)).toMatchObject({ type: 'opd', name: 'Sample Meera Patil', netPaise: 700, paidPaise: 0, balPaise: 700, onHospitalBill: true });
    expect(row(hospital).lines.map((l) => [l.name, l.batch, l.expiry.slice(0, 7), l.mrpPaise, l.qty, l.amountPaise])).toEqual([
      ['Sample Folic 5', 'F1', '2028-06', 200, 1, 200],
      ['Sample Iron 100', 'I1', '2028-06', 500, 1, 500],
    ]);
    expect(res.totals).toEqual({ count: 3, salesPaise: 2240, receivedPaise: 540, creditPaise: 1700, hospitalPaise: 700 });
    expect(res.more).toBe(false);
    expect(res.limit).toBe(BILL_SEARCH_LIMIT);
    expect(res.settings).toHaveProperty('name'); // the letterhead of the printed list
    // Nothing medical, and nothing of the payment's references, comes with a row
    expect(Object.keys(row(credit)).sort()).toEqual(['balPaise', 'date', 'discPaise', 'id', 'lines', 'mrn', 'name', 'netPaise', 'number', 'onHospitalBill', 'paidPaise', 'type']);
  });

  it('narrows by patient type, cash or credit, name, UHID, sales number and item – every part given must fit', async () => {
    const { asha, walkIn, credit, hospital } = await threeBills();
    const day = { from: '2026-09-28', to: '2026-09-28' };
    expect(await numbers({ ...day, type: 'opd' })).toEqual([credit.number, hospital.number].sort());
    expect(await numbers({ ...day, type: 'external' })).toEqual([walkIn.number]);
    expect(await numbers({ ...day, type: 'ipd' })).toEqual([]);
    expect(await numbers({ ...day, pay: 'cash' })).toEqual([walkIn.number]);
    expect(await numbers({ ...day, pay: 'credit' })).toEqual([credit.number, hospital.number].sort()); // on the hospital bill counts as credit, as on the Credit report
    // A name: registered patients and walk-in customers, each part typed in the name (any order, any case)
    expect(await numbers({ first: 'asha' })).toEqual([credit.number]);
    expect(await numbers({ first: 'KALE', last: 'asha' })).toEqual([credit.number]);
    expect(await numbers({ first: 'walk' })).toEqual([walkIn.number]);
    expect(await numbers({ first: 'sample' })).toEqual([walkIn.number, credit.number, hospital.number].sort());
    expect(await numbers({ first: 'sample', type: 'external' })).toEqual([walkIn.number]);
    expect(await numbers({ first: 'asha', last: 'patil' })).toEqual([]);
    // A UHID finds only patients (a walk-in has none)
    expect(await numbers({ mrn: asha.mrn })).toEqual([credit.number]);
    expect(await numbers({ mrn: asha.mrn, first: 'meera' })).toEqual([]);
    expect(await numbers({ number: credit.number })).toEqual([credit.number]);
    expect(await numbers({ number: 'No-Such-Bill' })).toEqual([]);
    // An item: by the medicine's name or its generic name
    expect(await numbers({ item: 'iron' })).toEqual([credit.number, hospital.number].sort());
    expect(await numbers({ item: 'folic acid' })).toEqual([walkIn.number, hospital.number].sort());
    expect(await numbers({ item: 'iron', pay: 'credit', type: 'opd', first: 'meera' })).toEqual([hospital.number]);
  });

  it('the dates choose the bills’ days; without dates every day is searched, newest first; a return’s CN number finds its bill', async () => {
    const { folic, walkIn } = await threeBills();
    ok(await ph('post', `/invoices/${walkIn.id}/returns`, { items: [{ lineId: walkIn.lines[0].id, qty: 1 }], reason: 'Not needed', refund: { mode: 'cash' } }));
    later('2026-09-29T06:00:00Z');
    const next = ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Next Day', phone: '' }, lines: [{ medicineId: folic.id, qty: 1 }], payment: { mode: 'cash' } }), 201).invoice;

    expect(await numbers({ from: '2026-09-29', to: '2026-09-29' })).toEqual([next.number]);
    expect(await numbers({ from: '2026-09-28', to: '2026-09-28' })).toHaveLength(3);
    expect(await numbers({ from: '2026-09-28', to: '2026-09-29' })).toHaveLength(4);
    expect(await numbers({ from: '2026-09-01', to: '2026-09-27' })).toEqual([]);
    const all = ok(await search());
    expect(all.bills).toHaveLength(4);
    expect(all.bills[0].number).toBe(next.number); // newest first
    // The bill after its return: one of three tablets came back and its money was given back
    const [returned] = ok(await search({ number: 'CN-' })).bills;
    expect(returned).toMatchObject({ number: walkIn.number, discPaise: 60, netPaise: 360, paidPaise: 360, balPaise: 0 });
    expect(returned.lines[0]).toMatchObject({ qty: 3, returnedQty: 1 });

    expect((await search({ from: '2026-09-29', to: '2026-09-28' })).status).toBe(400);
    expect((await search({ from: '2025-01-01', to: '2026-09-28' })).status).toBe(400); // more than a year apart
    expect((await search({ from: 'yesterday' })).status).toBe(400);
    expect((await search({ type: 'everyone' })).status).toBe(400);
    expect((await search({ pay: 'upi' })).status).toBe(400);
    expect((await search({ patientId: 'x' })).status).toBe(400); // only the parts the page sends
  });

  it('is for the pharmacist only, never shows another hospital’s bills, and is audited without the words typed', async () => {
    const { credit } = await threeBills();
    expect((await search({}, 'admin')).status).toBe(403);
    expect((await search({}, 'reception')).status).toBe(403);
    expect((await search({}, 'drA')).status).toBe(403);
    const other = await createTenant('Another Sample Hospital');
    const otherPharm = await createUser({ name: 'Sample otherPharm' });
    await addMember(otherPharm, other, 'pharmacist');
    const elsewhere = ok(await (await loginAs(otherPharm, { app })).get('/api/pharmacy/bill-search').query({ number: credit.number }));
    expect(elsewhere.bills).toEqual([]);
    expect(elsewhere.totals.count).toBe(0);

    ok(await search({ first: 'asha', from: '2026-09-28', to: '2026-09-28' }));
    ok(await search({ number: credit.number }));
    const audited = (await AuditLog.find({ action: 'PHARMACY_MIS_VIEWED', 'details.report': 'bill-search' }).sort({ _id: 1 }).lean()).slice(-2);
    expect(audited.map((a) => a.details)).toEqual([
      { report: 'bill-search', from: '2026-09-28', to: '2026-09-28', rows: 1 },
      { report: 'bill-search', rows: 1 },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/asha/i);
  });
});

describe('Search bill – the pure parts', () => {
  const rx = (t) => new RegExp(t, 'i');
  it('joins every part of the filter with $and, always under one hospital', () => {
    expect(billFilter({ tenantId: 't1' })).toEqual({ tenantId: 't1' });
    const since = new Date('2026-09-27T18:30:00Z');
    const before = new Date('2026-09-28T18:30:00Z');
    const f = billFilter({ tenantId: 't1', type: 'external', since, before, number: rx('PH-1'), item: rx('iron'), person: { patientIds: ['p1'], parts: [rx('asha'), rx('kale')], walkIns: true } });
    expect(f.tenantId).toBe('t1');
    expect(f.$and).toHaveLength(5);
    expect(f.$and[0]).toEqual({ patientId: null });
    expect(f.$and[1]).toEqual({ 'created.at': { $gte: since, $lt: before } });
    expect(f.$and[2].$or.map((x) => Object.keys(x)[0])).toEqual(['number', 'returns.number']);
    expect(f.$and[3].$or.map((x) => Object.keys(x)[0])).toEqual(['lines.name', 'lines.generic']);
    expect(f.$and[4].$or[0]).toEqual({ patientId: { $in: ['p1'] } });
    expect(f.$and[4].$or[1].$and).toHaveLength(2); // a walk-in's name holds every part typed
    // With a UHID, or no name typed, walk-in customers are not looked for
    expect(billFilter({ tenantId: 't1', person: { patientIds: [], parts: [rx('asha')], walkIns: false } }).$and[0].$or).toEqual([{ patientId: { $in: [] } }]);
    expect(billFilter({ tenantId: 't1', person: { patientIds: ['p1'], parts: [], walkIns: true } }).$and[0].$or).toHaveLength(1);
    expect(billFilter({ tenantId: 't1', before }).$and).toEqual([{ 'created.at': { $lt: before } }]);
  });

  it('lays a bill out: type, who, discount, and credit as on the Credit report', () => {
    const line = { _id: 'l1', name: 'Sample Tab', batch: 'B1', expiry: new Date('2028-06-30T00:00:00Z'), mrpPaise: 1000, qty: 2, amountPaise: 1800 };
    const sums = { grossPaise: 2000, totalPaise: 1800, netPaise: 1800, paidPaise: 500, balancePaise: 1300 };
    const inv = { _id: 'i1', number: 'PH-000001', kind: 'sale', patientId: 'p1', lines: [line], created: { at: new Date('2026-09-28T06:00:00Z') }, billId: null };
    const row = billRow(inv, sums, { fullName: 'Sample Asha Kale', mrn: 'SH-0001' });
    expect(row).toMatchObject({ id: 'i1', type: 'opd', mrn: 'SH-0001', name: 'Sample Asha Kale', discPaise: 200, netPaise: 1800, paidPaise: 500, balPaise: 1300, onHospitalBill: false });
    expect(row.lines).toEqual([{ id: 'l1', name: 'Sample Tab', batch: 'B1', expiry: '2028-06-30', mrpPaise: 1000, qty: 2, returnedQty: 0, amountPaise: 1800 }]);
    // IP bill summary (25 Nov 2026): her own total (before any return), the doctor, patientId (for her advance) and returns
    expect(row).toMatchObject({ patientId: 'p1', doctorName: '', totalPaise: 1800, returns: [] });
    const withReturn = {
      ...inv,
      doctor: { name: 'Dr Sample Shinde' },
      returns: [{ number: 'CN-00001', at: new Date('2026-09-29T07:00:00Z'), lines: [{ lineId: 'l1', qty: 1, amountPaise: 900 }] }],
    };
    expect(billRow(withReturn, sums, { fullName: 'Sample Asha Kale', mrn: 'SH-0001' })).toMatchObject({
      doctorName: 'Dr Sample Shinde',
      returns: [{ number: 'CN-00001', at: new Date('2026-09-29T07:00:00Z'), amountPaise: 900 }],
    });
    expect(billRow({ ...inv, patientId: null }, sums).patientId).toBeNull();
    // On the hospital bill: nothing paid at the counter, the whole bill is credit
    const onBill = billRow({ ...inv, kind: 'issue', billId: 'b1' }, { ...sums, paidPaise: null, balancePaise: null }, { fullName: 'Sample Asha Kale', mrn: 'SH-0001' });
    expect(onBill).toMatchObject({ type: 'ipd', paidPaise: 0, balPaise: 1800, onHospitalBill: true });
    // A walk-in: the customer's name, or the business's; a patient whose record is not found has no name
    expect(billRow({ ...inv, patientId: null, customer: { name: 'Sample Walk In' } }, sums)).toMatchObject({ type: 'external', mrn: '', name: 'Sample Walk In' });
    expect(billRow({ ...inv, patientId: null, customer: { name: 'Sample Buyer' }, buyer: { name: 'Sample Traders' } }, sums).name).toBe('Sample Traders');
    expect(billRow({ ...inv, patientId: null }, sums).name).toBe('Walk-in customer');
    expect(billRow(inv, sums, null)).toMatchObject({ type: 'opd', mrn: '', name: '' });

    const paid = { onHospitalBill: false, netPaise: 600, paidPaise: 600, balPaise: 0 };
    const due = { onHospitalBill: false, netPaise: 1000, paidPaise: 400, balPaise: 600 };
    const ward = { onHospitalBill: true, netPaise: 700, paidPaise: 0, balPaise: 700 };
    expect([paid, due, ward].map(isCredit)).toEqual([false, true, true]);
    expect([paid, due, ward].filter((r) => payFits(r, 'cash'))).toEqual([paid]);
    expect([paid, due, ward].filter((r) => payFits(r, 'credit'))).toEqual([due, ward]);
    expect([paid, due, ward].filter((r) => payFits(r, undefined))).toHaveLength(3);
    expect(billTotals([paid, due, ward])).toEqual({ count: 3, salesPaise: 2300, receivedPaise: 1000, creditPaise: 1300, hospitalPaise: 700 });
    expect(billTotals([])).toEqual({ count: 0, salesPaise: 0, receivedPaise: 0, creditPaise: 0, hospitalPaise: 0 });
  });
});

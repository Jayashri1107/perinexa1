// Pharmacy MIS reports (13 Nov 2026, server/src/pharmacy/misReports.js): the report list of the earlier software.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { StockBatch } from '../src/models/Pharmacy.js';
import { User } from '../src/models/User.js';
import { MIS_KEYS, isAntiTb } from '../src/pharmacy/misReports.js';
import { INVENTORY_KEYS } from '../src/pharmacy/inventoryReports.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js'; // samplePatient: later tests

const NOW = new Date('2026-11-11T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };
let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Pharmacy MIS Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await User.updateOne({ _id: people.drA._id }, { $set: { 'professional.registrationNumber': 'MMC-12345' } });
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const medicine = async (fields) => ok(await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields }), 201).medicine;
/** A GRN bill: qty units at rate ₹10 + 5 % GST → qty × ₹10.50. */
const bill = async (sup, m, { date = '2026-11-01', qty = 100, batch = `B-${randomUUID().slice(0, 4)}` } = {}) =>
  ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: date, lines: [{ medicineId: m.id, batch, expiry: '2028-06', qty, ratePaise: 1000, mrpPaise: 1500 }], grn: { taxType: 'cgst_sgst' } }), 201).purchase;
const mis = (report, who = 'pharm') => ph('get', `/reports/mis?report=${report}&from=2026-11-01&to=2026-11-30`, undefined, who);

describe('pharmacy MIS reports', () => {
  it('sales, collection, credit and the schedule drugs from the same bills; returns netted; audited', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample MIS Supplier', gstin: '' }), 201).supplier;
    const plain = await medicine({ name: 'Sample MIS Tab' });
    const h1 = await medicine({ name: 'Sample MIS H1 Tab', schedule: 'H1' });
    const tb = await medicine({ name: 'Sample MIS TB Tab', generic: 'Rifampicin + Isoniazid' });
    for (const m of [plain, h1, tb]) await bill(sup, m);
    const paid = ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In', phone: '9000000001' }, doctor: { name: 'Dr Sample Outside', reg: 'MMC-1' }, rxSeen: true, lines: [{ medicineId: plain.id, qty: 2 }, { medicineId: h1.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 4500 }] }), 201).invoice;
    const mother = ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample MIS Mother', assignedDoctor: people.drA._id.toString() })), 201).patient;
    // A registered patient's bill goes on her hospital bill: on credit for the pharmacy
    const owing = ok(await ph('post', '/invoices', { kind: 'sale', patientId: mother.id, doctor: { name: 'Dr Sample Outside', reg: 'MMC-1' }, rxSeen: true, lines: [{ medicineId: tb.id, qty: 2 }] }), 201).invoice;
    ok(await ph('post', `/invoices/${paid.id}/returns`, { items: [{ lineId: paid.lines.find((l) => l.name === 'Sample MIS H1 Tab').id, qty: 1 }], reason: 'Not needed', refund: { mode: 'cash' } }));

    const sales = ok(await mis('sales'));
    expect(sales.rows.map((r) => [r.bill, r.name, r.amount, r.returned, r.net])).toEqual([
      [paid.number, 'Sample Walk In', 4500, 1500, 3000],
      [owing.number, 'Sample MIS Mother', 3000, 0, 3000],
    ]);
    expect(sales.total).toMatchObject({ amount: 7500, returned: 1500, net: 6000 });

    const col = ok(await mis('collection'));
    expect(col.rows.map((r) => [r.mode, r.received, r.refunded])).toEqual([
      ['Cash', 4500, 0],
      ['Cash', 0, 1500],
    ]);
    expect(col.summary).toEqual([{ label: 'Cash', paise: 3000 }]);
    expect(ok(await mis('card-collection')).rows).toEqual([]);

    const pc = ok(await mis('patient-collection'));
    expect(pc.rows.map((r) => [r.name, r.paid, r.hospital])).toEqual([['Sample MIS Mother', 0, 3000], ['Sample Walk In', 3000, 0]]); // the most first, then by name
    const credit = ok(await mis('credit'));
    expect(credit.rows.map((r) => [r.bill, r.where, r.due])).toEqual([[owing.number, 'On the hospital bill', 3000]]);
    expect(ok(await mis('patient-credit')).rows.map((r) => [r.name, r.due])).toEqual([['Sample MIS Mother', 3000]]);

    expect(ok(await mis('h1-sales')).rows.map((r) => [r.medicine, r.qty, r.returnedQty, r.doctor])).toEqual([['Sample MIS H1 Tab', 1, 1, 'Dr Sample Outside, Reg. MMC-1']]);
    expect(ok(await mis('h1-returns')).rows.map((r) => [r.medicine, r.qty])).toEqual([['Sample MIS H1 Tab', 1]]);
    expect(ok(await mis('antitb-sales')).rows.map((r) => r.medicine)).toEqual(['Sample MIS TB Tab']);
    expect(ok(await mis('returns')).rows).toHaveLength(1);

    const gst = ok(await mis('gst-summary'));
    expect(gst.patients).toBe(false);
    expect(gst.rows.map((r) => r.rate)).toEqual([5]);
    expect(ok(await mis('grn-gst')).rows).toHaveLength(3);

    // Every report answers; the admin may read them; a doctor may not
    for (const k of MIS_KEYS) ok(await mis(k));
    ok(await mis('sales', 'admin'));
    expect((await mis('sales', 'drA')).status).toBe(403);
    expect((await ph('get', '/reports/mis?report=nope&from=2026-11-01&to=2026-11-30')).status).toBe(400);
    // Reports with names are audited; the GST summary has none
    const audited = await AuditLog.find({ action: 'PHARMACY_MIS_VIEWED' }).lean();
    expect(audited.some((a) => a.details.report === 'gst-summary')).toBe(false);
    expect(audited.find((a) => a.details.report === 'credit').details).toMatchObject({ from: '2026-11-01', to: '2026-11-30', rows: 1 });
  });

  it('anti-TB is matched on the generic or brand name (DRAFT list)', () => {
    expect(isAntiTb({ name: 'R-Cin 450', generic: 'Rifampicin' })).toBe(true);
    expect(isAntiTb({ name: 'Sample Ethambutol 800', generic: '' })).toBe(true);
    expect(isAntiTb({ name: 'Sample Paracetamol', generic: 'Paracetamol' })).toBe(false);
  });
});

const inv = (report, extra = '', who = 'pharm') => ph('get', `/reports/inventory?report=${report}&from=2026-11-01&to=2026-11-30${extra}`, undefined, who);

describe('inventory MIS reports', () => {
  it('GRN, item- and supplier-wise lists, current stock, stock date-wise and non-moving items, with the filters', async () => {
    const supA = ok(await ph('post', '/suppliers', { name: 'Sample Inv Supplier A' }), 201).supplier;
    const supB = ok(await ph('post', '/suppliers', { name: 'Sample Inv Supplier B' }), 201).supplier;
    const sold = await medicine({ name: 'Sample Inv Sold Tab' });
    const idle = await medicine({ name: 'Sample Inv Idle Tab' });
    await bill(supA, sold, { qty: 100, batch: 'SOLD-1' });
    await bill(supB, idle, { qty: 50, batch: 'IDLE-1' });
    ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In' }, lines: [{ medicineId: sold.id, qty: 10 }], payments: [{ mode: 'cash', amountPaise: 15000 }] }), 201);

    const grn = ok(await inv('grn'));
    expect(grn.rows.map((r) => [r.supplier, r.qty, r.net])).toEqual([
      ['Sample Inv Supplier A', 100, 105000],
      ['Sample Inv Supplier B', 50, 52500],
    ]);
    expect(ok(await inv('grn', `&supplierId=${supB.id}`)).rows).toHaveLength(1);
    expect(ok(await inv('grn', '&detail=1&batch=sold')).rows.map((r) => [r.medicine, r.batch, r.expiry])).toEqual([['Sample Inv Sold Tab', 'SOLD-1', '2028-06']]);
    expect(ok(await inv('item-grn')).rows.map((r) => [r.medicine, r.qty, r.avgRate])).toEqual([
      ['Sample Inv Idle Tab', 50, 1000],
      ['Sample Inv Sold Tab', 100, 1000],
    ]);
    expect(ok(await inv('supplier-grn')).total).toMatchObject({ bills: 2, net: 157500 });

    const stock = ok(await inv('current-stock'));
    expect(stock.rows.map((r) => [r.medicine, r.qty, r.costValue])).toEqual([
      ['Sample Inv Idle Tab', 50, 50000],
      ['Sample Inv Sold Tab', 90, 90000],
    ]);
    expect(ok(await inv('current-stock', `&detail=1&medicineId=${sold.id}`)).rows.map((r) => [r.batch, r.qty, r.place])).toEqual([['SOLD-1', 90, 'Pharmacy']]);
    expect(ok(await inv('current-stock', '&expiryBy=2027-12')).rows).toEqual([]); // both expire in June 2028
    expect(ok(await inv('stock-datewise')).rows.find((r) => r.medicine === 'Sample Inv Sold Tab')).toMatchObject({ opening: 0, in: 100, out: 10, closing: 90 });
    expect(ok(await inv('non-moving', '&days=30')).rows.map((r) => [r.medicine, r.idle])).toEqual([['Sample Inv Idle Tab', 'Never sold']]);

    for (const k of INVENTORY_KEYS) ok(await inv(k));
    for (const k of INVENTORY_KEYS) ok(await inv(k, '&detail=1'));
    ok(await inv('grn', '', 'admin'));
    expect((await inv('grn', '', 'drA')).status).toBe(403);
    expect((await inv('current-stock', '&expiryBy=2027-13')).status).toBe(400);
  });
});

describe('the supplier keeps the bills’ tax and credit or cash (13 Nov 2026)', () => {
  it('saved with the supplier and changed later; nothing else accepted', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Terms Supplier', taxType: 'igst', payment: 'cash' }), 201).supplier;
    expect(sup).toMatchObject({ taxType: 'igst', payment: 'cash' });
    expect(ok(await ph('post', '/suppliers', { name: 'Sample Plain Supplier' }), 201).supplier).toMatchObject({ taxType: '', payment: 'credit' });
    expect(ok(await ph('patch', `/suppliers/${sup.id}`, { taxType: '', payment: 'credit' })).supplier).toMatchObject({ taxType: '', payment: 'credit' });
    expect((await ph('post', '/suppliers', { name: 'Sample Bad Supplier', payment: 'later' })).status).toBe(400);
  });
});

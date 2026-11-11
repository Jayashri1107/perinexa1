// Pharmacy Stage C (docs/PHARMACY_BUILD_NOTE.md section 5): money and figures. PH11 what each supplier is owed.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { StockBatch } from '../src/models/Pharmacy.js';
import { User } from '../src/models/User.js';
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
  hospital = await createTenant('Pharmacy C Hospital');
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
const account = async (sup, who = 'pharm') => ok(await ph('get', `/suppliers/${sup.id}/account`, undefined, who));

describe('PH11 – what each supplier is owed', () => {
  it('bills with tax, less payments; oldest first; overdue after the credit days; a payment can name its bill', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Credit Supplier', creditDays: 15 }), 201).supplier;
    expect(sup.creditDays).toBe(15);
    const m = await medicine({ name: 'Sample Owed Tab' });
    const old = await bill(sup, m, { date: '2026-10-01' }); // ₹1,050, due 16 Oct – overdue
    const recent = await bill(sup, m, { date: '2026-11-05' }); // ₹1,050, due 20 Nov
    let a = await account(sup);
    expect(a.totals).toEqual({ billedPaise: 210000, returnedPaise: 0, paidPaise: 0, owedPaise: 210000, overduePaise: 105000 });
    expect(a.bills.map((b) => [b.number, b.dueDate, b.overdue])).toEqual([
      [old.number, '2026-10-16', true],
      [recent.number, '2026-11-20', false],
    ]);
    // A part payment settles the oldest bill first
    ok(await ph('post', `/suppliers/${sup.id}/payments`, { on: '2026-11-10', amountPaise: 50000, mode: 'cheque', reference: 'CHQ 1001' }), 201);
    a = await account(sup);
    expect(a.totals).toMatchObject({ paidPaise: 50000, owedPaise: 160000, overduePaise: 55000 });
    // A payment that names the newer bill pays that one
    const named = ok(await ph('post', `/suppliers/${sup.id}/payments`, { on: '2026-11-10', amountPaise: 105000, mode: 'bank', reference: 'NEFT 22', purchaseIds: [recent.id] }), 201);
    expect(named.bills.find((b) => b.number === recent.number).leftPaise).toBe(0);
    expect(named.totals.overduePaise).toBe(55000);
    // A cancelled payment no longer counts; it stays listed
    const pid = named.payments.find((p) => p.number === named.payment.number).id;
    const after = ok(await ph('post', `/supplier-payments/${pid}/cancel`, { reason: 'Entered twice' }));
    expect(after.totals.paidPaise).toBe(50000);
    expect(after.payments.find((p) => p.id === pid).cancelled).toMatchObject({ reason: 'Entered twice' });
    // A cheque needs its number; a future date is refused
    expect((await ph('post', `/suppliers/${sup.id}/payments`, { on: '2026-11-10', amountPaise: 100, mode: 'cheque' })).status).toBe(400);
    expect((await ph('post', `/suppliers/${sup.id}/payments`, { on: '2026-11-20', amountPaise: 100, mode: 'cash' })).status).toBe(400);
    const entries = await AuditLog.find({ action: /PHARMACY_SUPPLIER_PA/ }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => [e.action, e.details.amountPaise])).toEqual([
      ['PHARMACY_SUPPLIER_PAID', 50000],
      ['PHARMACY_SUPPLIER_PAID', 105000],
      ['PHARMACY_SUPPLIER_PAYMENT_CANCELLED', 105000],
    ]);
  });

  it('a cancelled bill and a cancelled return leave the account; a return lowers it; the admin sees, cannot pay', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Return Supplier' }), 201).supplier;
    const m = await medicine({ name: 'Sample Return Owed Tab' });
    const p1 = await bill(sup, m);
    const p2 = await bill(sup, m);
    ok(await ph('post', `/purchases/${p2.id}/cancel`, { reason: 'Entered twice' }));
    const batch = await StockBatch.findOne({ tenantId: hospital._id, purchaseId: p1.id }).lean();
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'damaged', lines: [{ batchId: String(batch._id), qty: 10 }] }), 201).return;
    let a = await account(sup, 'admin');
    expect(a.totals).toMatchObject({ billedPaise: 105000, returnedPaise: 10500, owedPaise: 94500 });
    expect(a.canPay).toBe(false);
    expect((await ph('post', `/suppliers/${sup.id}/payments`, { on: '2026-11-10', amountPaise: 100, mode: 'cash' }, 'admin')).status).toBe(403);
    ok(await ph('post', `/supplier-returns/${ret.id}/cancel`, { reason: 'Did not go back' }));
    a = await account(sup);
    expect(a.totals).toMatchObject({ returnedPaise: 0, owedPaise: 105000 });
    const dues = ok(await ph('get', '/reports/supplier-dues', undefined, 'admin'));
    expect(dues.suppliers.find((s) => s.id === sup.id)).toMatchObject({ owedPaise: 105000 });
    // The admin's export lists payments
    const csv = await (await as('admin')).get('/api/pharmacy/export?from=2026-11-01&to=2026-11-30&what=supplier_payments');
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/^﻿Payment,Date,Supplier/);
  });
});

describe('PH15 – the missing reports and the day closing', () => {
  // An outside prescription seen (an H1 medicine needs one)
  const walkIn = (m, qty, pay) => ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In' }, doctor: { name: 'Dr Sample Outside', reg: 'MMC-1' }, rxSeen: true, lines: [{ medicineId: m.id, qty }], payments: [{ mode: pay ?? 'cash', amountPaise: qty * 1500 }] });

  it('profit by medicine (net of returns), the value lost to expiry, H1 use by month, prescriptions filled', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Figures Supplier' }), 201).supplier;
    const m = await medicine({ name: 'Sample Profit Tab', schedule: 'H1' });
    await bill(sup, m, { qty: 100 }); // cost ₹10 a unit, MRP ₹15
    const sale = ok(await walkIn(m, 10), 201).invoice; // ₹150 incl. 5 % GST → taxable ₹142.86
    ok(await ph('post', `/invoices/${sale.id}/returns`, { items: [{ lineId: sale.lines[0].id, qty: 2 }], reason: 'Not needed', refund: { mode: 'cash' } }));
    const batch = await StockBatch.findOne({ tenantId: hospital._id, medicineId: m.id }).lean();
    ok(await ph('post', `/batches/${batch._id}/writeoff`, { qty: 5, reason: 'Past its date', kind: 'expired' }));
    ok(await ph('post', `/batches/${batch._id}/writeoff`, { qty: 1, reason: 'Strip torn', kind: 'damaged' }));
    const f = ok(await ph('get', '/reports/figures?from=2026-11-01&to=2026-11-30', undefined, 'admin'));
    const row = f.profit.rows.find((r) => r.medicineId === m.id);
    expect(row).toMatchObject({ qty: 8, costPaise: 8000 });
    // Net of the 2 returned: 8 of the 10 units' taxable value (within a paisa of rounding)
    expect(Math.abs(row.salesPaise - Math.round((sale.lines[0].taxablePaise * 8) / 10))).toBeLessThanOrEqual(1);
    expect(row.profitPaise).toBe(row.salesPaise - 8000);
    expect(f.expiryLoss).toMatchObject({ writtenOffPaise: 5000, writeOffs: 1 });
    expect(f.h1.months).toEqual(['2026-11']);
    expect(f.h1.rows[0]).toMatchObject({ name: 'Sample Profit Tab', byMonth: { '2026-11': 8 } });
    expect(f.prescriptions).toMatchObject({ written: 0, filled: 0 });
  });

  it('slow stock: usable stock with no sale for 90 days; a medicine sold this week is not listed', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Slow Supplier' }), 201).supplier;
    const still = await medicine({ name: 'Sample Still Tab' });
    const moving = await medicine({ name: 'Sample Moving Tab' });
    await bill(sup, still, { qty: 20 });
    await bill(sup, moving, { qty: 20 });
    ok(await walkIn(moving, 1), 201);
    const f = ok(await ph('get', '/reports/figures?from=2026-11-01&to=2026-11-30'));
    expect(f.nonMoving.rows.map((r) => [r.name, r.band, r.valuePaise])).toEqual([['Sample Still Tab', 'non_moving', 20000]]);
  });

  it('the day closing: cash expected from the walk-ins less refunds; a difference needs a note; once a day; audited', async () => {
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Day Supplier' }), 201).supplier;
    const m = await medicine({ name: 'Sample Day Tab' });
    await bill(sup, m, { qty: 50 });
    ok(await walkIn(m, 2), 201); // ₹30 cash
    ok(await walkIn(m, 1, 'upi'), 201); // ₹15 UPI
    const day = ok(await ph('get', '/reports/day?date=2026-11-11'));
    expect(day).toMatchObject({ byMode: { cash: 3000, upi: 1500 }, expectedCashPaise: 3000, invoices: 2, closed: null, canClose: true });
    expect((await ph('post', '/day-close', { date: '2026-11-11', countedCashPaise: 2900 })).status).toBe(400);
    ok(await ph('post', '/day-close', { date: '2026-11-11', countedCashPaise: 2900, note: 'Ten rupees short – change given wrongly' }), 201);
    expect((await ph('post', '/day-close', { date: '2026-11-11', countedCashPaise: 3000 })).status).toBe(409);
    const after = ok(await ph('get', '/reports/day?date=2026-11-11', undefined, 'admin'));
    expect(after.closed).toMatchObject({ differencePaise: -100, byName: 'Sample pharm' });
    expect(after.canClose).toBe(false);
    expect((await AuditLog.findOne({ action: 'PHARMACY_DAY_CLOSED' }).lean()).details).toMatchObject({ date: '2026-11-11', differencePaise: -100 });
  });
});

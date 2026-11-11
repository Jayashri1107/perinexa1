// Pharmacy Stage A (docs/PHARMACY_BUILD_NOTE.md section 3): PH4 the manufacturer's name, PH2 pack sizes (a whole pack
// at exactly its MRP, loose units rounded down, "not split"), PH3 the bill's printed total, the supplier's credit note
// and the purchase register, PH1 the opening-stock file's manufacturer and pack columns and a batch brought in twice.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { grossOf, lineMoney } from '../src/pharmacy/gst.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Medicine, StockBatch } from '../src/models/Pharmacy.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const NOW = new Date('2026-11-11T06:00:00Z');
const ROLES = { pharm: 'pharmacist', admin: 'admin' };
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
  hospital = await createTenant('Pharmacy A Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
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
const supplier = async () => ok(await ph('post', '/suppliers', { name: 'Sample Distributors', gstin: '27ABCDE1234F1Z5' }), 201).supplier;
/** A bill of strips: `packs` strips of `conv` at `packMrp` paise MRP, rate `packRate` a strip. */
const stripBill = (sup, m, { packs = 2, conv = 15, packMrp = 10000, packRate = 7000, grn = {}, batch = 'B1' } = {}) =>
  ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-11-10', lines: [{ medicineId: m.id, batch, expiry: '2028-06', conv, qty: packs, ratePaise: packRate, mrpPaise: packMrp }], grn: { taxType: 'cgst_sgst', ...grn } });
const sale = (m, qty, extra = {}) => ph('post', '/invoices', { kind: 'sale', customer: { name: 'Walk In Sample' }, lines: [{ medicineId: m.id, qty }], payment: { mode: 'cash' }, ...extra });

describe('PH2 – pack sizes', () => {
  it('a strip of 15 at ₹100: a whole strip exactly ₹100, two strips ₹200, 7 tablets ₹46.66, never above the MRP', () => {
    const b = { mrpPaise: 666, packMrpPaise: 10000, unitsPerPack: 15 };
    expect([grossOf(b, 15), grossOf(b, 30), grossOf(b, 7), grossOf(b, 1)]).toEqual([10000, 20000, 4666, 666]);
    // Fifteen single tablets (fifteen lines of one) – never more than the strip
    expect(15 * grossOf(b, 1)).toBeLessThanOrEqual(10000);
    // An old batch without pack fields: the unit MRP × qty
    expect(grossOf({ mrpPaise: 666 }, 15)).toBe(9990);
    expect(lineMoney({ qty: 15, mrpPaise: 666, gstRate: 5, grossPaise: 10000 })).toMatchObject({ amountPaise: 10000, taxablePaise: 9524, gstPaise: 476 });
  });

  it('bought by the strip, sold by the tablet: the invoice charges the strip at its printed MRP; a part return is in proportion', async () => {
    const m = await medicine({ name: 'Sample Strip Tab', packSize: 15, packName: 'strip', manufacturer: 'Sample Pharma Ltd' });
    expect(m).toMatchObject({ packSize: 15, packName: 'strip', looseSale: true, manufacturer: 'Sample Pharma Ltd' });
    const sup = await supplier();
    ok(await stripBill(sup, m), 201);
    const batch = await StockBatch.findOne({ tenantId: hospital._id, medicineId: m.id }).lean();
    expect(batch).toMatchObject({ qtyIn: 30, mrpPaise: 666, packMrpPaise: 10000, unitsPerPack: 15 });
    const strip = ok(await sale(m, 15, { payments: [{ mode: 'cash', amountPaise: 10000 }], payment: undefined }), 201).invoice;
    expect(strip.lines[0]).toMatchObject({ qty: 15, amountPaise: 10000 });
    expect(strip.totalPaise).toBe(10000);
    const loose = ok(await sale(m, 7, { payments: [{ mode: 'cash', amountPaise: 4666 }], payment: undefined }), 201).invoice;
    expect(loose.totalPaise).toBe(4666);
    // A return of 3 of the 15: in proportion to what was charged
    const back = ok(await ph('post', `/invoices/${strip.id}/returns`, { items: [{ lineId: strip.lines[0].id, qty: 3 }], reason: 'Not needed', refund: { mode: 'cash' } }));
    expect(back.invoice.returns[0].amountPaise).toBe(2000);
  });

  it('a medicine not sold loose goes in whole packs only', async () => {
    const m = await medicine({ name: 'Sample Whole Pack Tab', packSize: 10, packName: 'strip', looseSale: false });
    const sup = await supplier();
    ok(await stripBill(sup, m, { conv: 10, packMrp: 5000, packRate: 3000 }), 201);
    const res = await sale(m, 5);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/whole strips of 10/);
    expect((await sale(m, 10, { payments: [{ mode: 'cash', amountPaise: 5000 }], payment: undefined })).status).toBe(201);
  });

  it('the stock list values a batch bought by the pack at the pack price', async () => {
    const m = await medicine({ name: 'Sample Value Tab', packSize: 15, packName: 'strip' });
    ok(await stripBill(await supplier(), m), 201);
    const row = ok(await ph('get', '/stock')).medicines.find((x) => x.id === m.id);
    expect(row).toMatchObject({ qty: 30, mrpValuePaise: 20000, packSize: 15 });
  });
});

describe('PH4 – the manufacturer', () => {
  it('kept on the medicine and on the purchase line; a change of the medicine keeps what was not sent', async () => {
    const m = await medicine({ name: 'Sample Maker Tab', manufacturer: 'Sample Labs' });
    ok(await stripBill(await supplier(), m, { conv: 1, packs: 10, packMrp: 500, packRate: 300 }), 201);
    const p = ok(await ph('get', '/purchases')).purchases[0];
    expect(p.lines[0].manufacturer).toBe('Sample Labs');
    // A later change of the medicine's manufacturer does not change the purchase
    ok(await ph('patch', `/medicines/${m.id}`, { manufacturer: 'Sample Labs India' }));
    expect(ok(await ph('get', '/purchases')).purchases[0].lines[0].manufacturer).toBe('Sample Labs');
    // Stop using sends only `active`: the manufacturer and pack stay
    ok(await ph('patch', `/medicines/${m.id}`, { active: false }));
    const after = await Medicine.findOne({ tenantId: hospital._id, _id: m.id }).lean();
    expect(after).toMatchObject({ manufacturer: 'Sample Labs India', packSize: 1, active: false });
  });

  it('old purchase lines without it export as empty, never "undefined"', async () => {
    const m = await medicine({ name: 'Sample Old Tab' });
    ok(await stripBill(await supplier(), m, { conv: 1, packs: 10, packMrp: 500, packRate: 300 }), 201);
    const res = await (await as('admin')).get('/api/pharmacy/export?from=2026-11-01&to=2026-11-30&what=purchases');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Manufacturer');
    expect(res.text).not.toContain('undefined');
  });
});

describe('PH3 – the bill as printed, the credit note, the register', () => {
  it('a printed total more than ₹1 away from the sums is asked about; within ₹1 it goes through; the register lists the bill', async () => {
    const m = await medicine({ name: 'Sample Bill Tab' });
    const sup = await supplier();
    // 2 strips × ₹70 = ₹140 + 5 % GST ₹7 = ₹147
    const far = await stripBill(sup, m, { grn: { printedTotalPaise: 15000 } });
    expect(far.status).toBe(409);
    expect(far.body.error).toMatchObject({ code: 'BILL_TOTAL_DIFFERS', details: { printedTotalPaise: 15000, netPaise: 14700 } });
    ok(await stripBill(sup, m, { grn: { printedTotalPaise: 14750 } }), 201);
    ok(await stripBill(sup, m, { grn: { printedTotalPaise: 15000, totalConfirmed: true }, batch: 'B2' }), 201);
    const rep = ok(await ph('get', '/reports/purchases?from=2026-11-01&to=2026-11-30'));
    expect(rep.register.rows).toHaveLength(2);
    expect(rep.register.rows[0]).toMatchObject({ taxablePaise: 14000, cgstPaise: 350, sgstPaise: 350, igstPaise: 0, netPaise: 14700, printedTotalPaise: 14750 });
    expect(rep.register.totals.netPaise).toBe(29400);
    // A bill typed by the strip counts as typed: 2 bills × 2 strips × ₹70 (not the per-tablet rate multiplied back)
    expect(rep.bySupplier[0].totalPaise).toBe(28000);
  });

  it('a whole strip of 15 bought at ₹70 goes back on the debit note at exactly ₹70, not 15 × ₹4.67', async () => {
    const m = await medicine({ name: 'Sample Strip Return Tab' });
    const sup = await supplier();
    ok(await stripBill(sup, m, { conv: 15, packs: 2, packMrp: 10000, packRate: 7000 }), 201);
    const batch = await StockBatch.findOne({ tenantId: hospital._id, medicineId: m.id }).lean();
    expect(batch.costPaise).toBe(467); // the stock's unit cost stays rounded
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'damaged', lines: [{ batchId: String(batch._id), qty: 15 }] }), 201).return;
    expect(ret.lines[0]).toMatchObject({ qty: 15, taxablePaise: 7000 });
  });

  it("the supplier's credit note is entered on a return, corrected, and audited with ids and amounts", async () => {
    const m = await medicine({ name: 'Sample Return Tab' });
    const sup = await supplier();
    ok(await stripBill(sup, m, { conv: 1, packs: 10, packMrp: 500, packRate: 300 }), 201);
    const batch = await StockBatch.findOne({ tenantId: hospital._id, medicineId: m.id }).lean();
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'damaged', lines: [{ batchId: String(batch._id), qty: 2 }] }), 201).return;
    expect(ret.creditNote).toBeNull();
    const cn = ok(await ph('post', `/supplier-returns/${ret.id}/credit-note`, { number: 'SCN-77', date: '2026-11-11', amountPaise: 630 }));
    expect(cn.return.creditNote).toMatchObject({ number: 'SCN-77', date: '2026-11-11', amountPaise: 630, byName: 'Sample pharm' });
    ok(await ph('post', `/supplier-returns/${ret.id}/credit-note`, { number: 'SCN-77A', date: '2026-11-11', amountPaise: 630 }));
    expect((await ph('post', `/supplier-returns/${ret.id}/credit-note`, { number: 'X', date: '2026-11-11', amountPaise: 1 }, 'admin')).status).toBe(403);
    const entries = await AuditLog.find({ action: 'PHARMACY_SUPPLIER_CREDIT_NOTE' }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => e.details)).toEqual([
      { returnId: ret.id, number: ret.number, amountPaise: 630 },
      { returnId: ret.id, number: ret.number, amountPaise: 630, changed: true },
    ]);
  });
});

describe('PH1 – opening stock from a file', () => {
  const line = (row, extra = {}) => ({ row, name: 'Sample Opening Tab', batch: 'OB1', expiry: '2028-03', qty: 20, mrpPaise: 500, ratePaise: 300, ...extra });

  it('a new medicine takes the file’s manufacturer and pack size; the same batch a second time is refused', async () => {
    const check = ok(await ph('post', '/opening-stock/check', { lines: [line(2, { manufacturer: 'Sample Makers', packSize: 10 })] }));
    expect(check.lines[0].medicine).toMatchObject({ isNew: true, manufacturer: 'Sample Makers', packSize: 10 });
    ok(await ph('post', '/opening-stock', { lines: [line(2, { manufacturer: 'Sample Makers', packSize: 10 })] }), 201);
    const m = await Medicine.findOne({ tenantId: hospital._id, name: 'Sample Opening Tab' }).lean();
    expect(m).toMatchObject({ manufacturer: 'Sample Makers', packSize: 10 });
    const again = ok(await ph('post', '/opening-stock/check', { lines: [line(2)] }));
    expect(again.lines[0].problems.join(' ')).toMatch(/already brought in/);
    expect((await ph('post', '/opening-stock', { lines: [line(2)] })).status).toBe(400);
    // Another batch of the same medicine is fine
    expect(ok(await ph('post', '/opening-stock/check', { lines: [line(3, { batch: 'OB2' })] })).summary.problems).toBe(0);
  });

  it('a pack size that is not a number of units is a problem of its line', async () => {
    const check = ok(await ph('post', '/opening-stock/check', { lines: [line(2, { name: 'Sample Bad Pack Tab', packSize: 'box' })] }));
    expect(check.lines[0].problems.join(' ')).toMatch(/pack size/);
  });
});

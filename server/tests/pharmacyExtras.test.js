// Pharmacy extras (4 Oct 2026): purchase orders to suppliers (PO-000001 …, "Suggest from low stock", receiving against
// an order), returns to a supplier with debit notes (SR-000001 …, their own stock move, the registers, purchases net of
// returns), barcodes (one medicine per barcode in a hospital, exact match only) and the e-invoice file of a walk-in
// sale to a business with a GSTIN (schema INV-01, version 1.1). Made-up names and numbers only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Medicine, Purchase, PurchaseOrder, StockBatch, StockMove, SupplierReturn } from '../src/models/Pharmacy.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { einvoiceHsn, einvoiceHsnOk, einvoiceOf, einvoiceProblems, portalDate, unitCode } from '../src/pharmacy/einvoice.js';
import { debitMoney } from '../src/pharmacy/gst.js';
import { gstinCheckChar, gstinProblem, gstinState, isGstin } from '../src/pharmacy/gstin.js';
import { applyPurchase, countPurchaseOnOrder, statusFromLines, suggestedOrderQty, updateOrder } from '../src/pharmacy/ordersService.js';
import { cleanBarcode } from '../src/pharmacy/pharmacyRules.js';
import { isInterState } from '../src/pharmacy/supplierReturnsService.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };
// Made-up GSTINs with the right check character (27 = Maharashtra, 29 = Karnataka)
const gstin = (first14) => `${first14}${gstinCheckChar(first14)}`;
const PHARMACY_GSTIN = gstin('27AAAAA0000A1Z');
const BUYER_GSTIN = gstin('27BBBBB1111B1Z');
const FAR_SUPPLIER_GSTIN = gstin('29CCCCC2222C1Z');

let app;
let hospital;
let other; // another hospital, with its own pharmacist and admin
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
  hospital = await createTenant('Extras Hospital');
  other = await createTenant('Other Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  for (const [key, role] of Object.entries({ otherPharm: 'pharmacist', otherAdmin: 'admin' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], other, role);
  }
  await User.updateOne({ _id: people.drA._id }, { $set: { 'professional.registrationNumber': 'MMC-12345' } });
  await ensureStandardTemplates(hospital._id);
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

async function medicine(fields, who = 'pharm') {
  return ok(await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields }, who), 201).medicine;
}
async function supplier(fields = {}, who = 'pharm') {
  return ok(await ph('post', '/suppliers', { name: 'Sample Distributors', ...fields }, who), 201).supplier;
}
async function purchase(sup, lines, extra = {}, who = 'pharm') {
  return ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-09-27', lines, ...extra }, who), 201);
}
const line = (m, fields = {}) => ({ medicineId: m.id, batch: 'B1', expiry: '2027-12', qty: 100, ratePaise: 500, mrpPaise: 1120, ...fields });
const order = async (sup, lines, who = 'pharm') => ok(await ph('post', '/orders', { supplierId: sup.id, lines }, who), 201).order;
const stockOf = async (m) => (await ph('get', '/stock')).body.medicines.find((x) => x.id === m.id).qty;
const audits = async (action) => (await AuditLog.find({ action }).sort({ createdAt: 1 }).lean()).map((a) => a.details);
async function register(name) {
  return ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() })), 201).patient;
}

// ---------------------------------------------------------------------------------------------------------------------

describe('the pure rules', () => {
  it('a GSTIN is checked by its shape, its state code and its check character', () => {
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true); // the sample GSTIN of the GST documents
    expect(gstinState(' 27aapfu0939f1zv ')).toEqual({ code: '27', name: 'Maharashtra' });
    expect(gstinProblem('')).toMatch(/Enter the GSTIN/);
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
    expect(gstinProblem('27AAPFU0939F1ZX')).toMatch(/typing mistake/); // one character wrong
    expect(gstinProblem('27AAPFU0939F1YV')).toMatch(/does not look like a GSTIN/);
    expect(gstinProblem(gstin('99AAPFU0939F1Z'))).toMatch(/not a state/);
    expect(isGstin(PHARMACY_GSTIN) && isGstin(BUYER_GSTIN) && isGstin(FAR_SUPPLIER_GSTIN)).toBe(true);
    expect(isInterState(PHARMACY_GSTIN, FAR_SUPPLIER_GSTIN)).toBe(true);
    expect(isInterState(PHARMACY_GSTIN, BUYER_GSTIN)).toBe(false);
    expect(isInterState(PHARMACY_GSTIN, 'not a gstin')).toBe(false); // not known: treated as the same state
  });

  it('a debit note adds GST on top of the purchase rate: CGST + SGST, or IGST for a supplier in another state', () => {
    expect(debitMoney({ qty: 10, ratePaise: 500, gstRate: 12 })).toEqual({ taxablePaise: 5000, gstPaise: 600, cgstPaise: 300, sgstPaise: 300, igstPaise: 0, amountPaise: 5600 });
    expect(debitMoney({ qty: 3, ratePaise: 333, gstRate: 5, interState: true })).toEqual({ taxablePaise: 999, gstPaise: 50, cgstPaise: 0, sgstPaise: 0, igstPaise: 50, amountPaise: 1049 });
  });

  it('an order’s status follows what was received; the suggested quantity brings stock to twice the reorder level', () => {
    expect(statusFromLines([{ qty: 10, receivedQty: 0 }])).toBe('sent');
    expect(statusFromLines([{ qty: 10, receivedQty: 4 }, { qty: 5, receivedQty: 5 }])).toBe('part_received');
    expect(statusFromLines([{ qty: 10, receivedQty: 12 }, { qty: 5, receivedQty: 5 }])).toBe('received');
    expect(suggestedOrderQty({ reorderLevel: 20, usable: 5 })).toBe(35);
    expect(suggestedOrderQty({ reorderLevel: 20, usable: 5, onOrder: 30 })).toBe(5);
    expect(suggestedOrderQty({ reorderLevel: 20, usable: 5, onOrder: 60 })).toBe(0);
    expect(suggestedOrderQty({ reorderLevel: 0, usable: 0 })).toBe(1);
  });

  it('a barcode is kept without spaces, in capitals', () => {
    expect(cleanBarcode(' 8901 234 567890 ')).toBe('8901234567890');
    expect(cleanBarcode('abc-123')).toBe('ABC-123');
    expect(cleanBarcode(null)).toBe('');
  });

  it('the e-invoice file follows schema INV-01 version 1.1', () => {
    expect(portalDate(new Date('2026-09-28T00:00:00Z'))).toBe('28/09/2026');
    expect([unitCode('tablet'), unitCode('Bottle'), unitCode('ampoule'), unitCode('')]).toEqual(['TBS', 'BTL', 'NOS', 'NOS']);
    const seller = { name: 'Sample Pharmacy', gstin: PHARMACY_GSTIN, address: '1 Sample Road', place: 'Pune', pin: '411001', phone: '+91 20 0000 0000' };
    const buyer = { name: 'Sample Clinic LLP', gstin: BUYER_GSTIN, address: '2 Sample Lane', place: 'Nashik', pin: '422001' };
    const lines = [{ name: 'Rate Twelve', generic: 'Sampleol', hsn: '300490', unit: 'tablet', batch: 'B12', expiry: new Date('2027-12-31T00:00:00Z'), qty: 10, gstRate: 12, amountPaise: 112000, taxablePaise: 100000, cgstPaise: 6000, sgstPaise: 6000 }];
    expect(einvoiceProblems({ seller, buyer, lines, number: 'PH-000001' })).toEqual([]);
    const doc = einvoiceOf({ seller, buyer, doc: { type: 'INV', number: 'PH-000001', date: new Date('2026-09-28T00:00:00Z') }, lines });
    expect(doc).toEqual({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: 'INV', No: 'PH-000001', Dt: '28/09/2026' },
      SellerDtls: { Gstin: PHARMACY_GSTIN, LglNm: 'Sample Pharmacy', Addr1: '1 Sample Road', Loc: 'Pune', Pin: 411001, Stcd: '27', Ph: '912000000000' },
      BuyerDtls: { Gstin: BUYER_GSTIN, LglNm: 'Sample Clinic LLP', Addr1: '2 Sample Lane', Loc: 'Nashik', Pin: 422001, Stcd: '27', Pos: '27' },
      ItemList: [
        { SlNo: '1', PrdDesc: 'Rate Twelve – Sampleol', IsServc: 'N', HsnCd: '300490', BchDtls: { Nm: 'B12', ExpDt: '31/12/2027' }, Qty: 10, Unit: 'TBS', UnitPrice: 100, TotAmt: 1000, Discount: 0, AssAmt: 1000, GstRt: 12, IgstAmt: 0, CgstAmt: 60, SgstAmt: 60, TotItemVal: 1120 },
      ],
      ValDtls: { AssVal: 1000, CgstVal: 60, SgstVal: 60, IgstVal: 0, TotInvVal: 1120 },
    });
    // What stops it, in plain words
    const problems = einvoiceProblems({ seller: { name: 'Sample Pharmacy', gstin: '', address: '' }, buyer, lines: [{ name: 'No Code Tab', hsn: '' }], number: 'PH-000001' });
    expect(problems.join(' ')).toMatch(/pharmacy’s GSTIN.*address is missing.*city or town.*PIN code.*No HSN code for No Code Tab/);
  });

  it('the e-invoice file needs an HSN code of 6 or 8 digits: 4 digits are enough only for the printed invoice', () => {
    expect(['300490', '30049099'].map(einvoiceHsnOk)).toEqual([true, true]);
    expect(['3004', '', '30049', '3004909', 'ABCDEF', undefined].map(einvoiceHsnOk)).toEqual([false, false, false, false, false, false]);
    const seller = { name: 'Sample Pharmacy', gstin: PHARMACY_GSTIN, address: '1 Sample Road', place: 'Pune', pin: '411001' };
    const buyer = { name: 'Sample Clinic LLP', gstin: BUYER_GSTIN, address: '2 Sample Lane', place: 'Nashik', pin: '422001' };
    const lines = [{ name: 'Short Code Tab', hsn: '3004' }, { name: 'Long Code Tab', hsn: '30049099' }, { name: 'Short Code Tab', hsn: '3004' }, { name: 'No Code Tab', hsn: '' }];
    expect(einvoiceProblems({ seller, buyer, lines, number: 'PH-000001' })).toEqual([
      'No HSN code for No Code Tab: add one of 6 or 8 digits under Pharmacy → Medicines.',
      'The e-invoice portal needs an HSN code of 6 or 8 digits for Short Code Tab: write the longer code under Pharmacy → Medicines (a code that starts with the same digits is then used for this invoice too).',
    ]);
    // The code kept on an invoice line stays, unless the medicine now has the same code written out longer
    expect(einvoiceHsn('3004', '300490')).toBe('300490');
    expect(einvoiceHsn('3004', '30049099')).toBe('30049099');
    expect(einvoiceHsn('300490', '30049099')).toBe('30049099');
    expect(einvoiceHsn('3004', '210690')).toBe('3004'); // another code never replaces the one on the invoice
    expect(einvoiceHsn('30049099', '3004')).toBe('30049099');
    expect(einvoiceHsn('', '300490')).toBe('300490'); // none was kept: the medicine's present one
    expect(einvoiceHsn('3004', '')).toBe('3004');
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('purchase orders', () => {
  it('the pharmacist or the admin makes, changes and sends an order; clinical staff have none; a sent order is fixed', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Order Tab A' });
    const b = await medicine({ name: 'Order Tab B' });
    for (const who of ['drA', 'nurse', 'reception']) {
      expect((await ph('get', '/orders', undefined, who)).status).toBe(403);
      expect((await ph('post', '/orders', { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 5 }] }, who)).status).toBe(403);
    }
    // Each medicine once; medicines and suppliers in use only
    expect((await ph('post', '/orders', { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 5 }, { medicineId: a.id, qty: 2 }] })).body.error.message).toMatch(/twice/);
    expect((await ph('post', '/orders', { supplierId: sup.id, lines: [] })).status).toBe(400);
    expect((await ph('post', '/orders', { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 0 }] })).status).toBe(400);
    const stopped = await medicine({ name: 'Stopped Tab' });
    await ph('patch', `/medicines/${stopped.id}`, { active: false });
    expect((await ph('post', '/orders', { supplierId: sup.id, lines: [{ medicineId: stopped.id, qty: 5 }] })).body.error.message).toMatch(/medicine in use/);

    const o = await order(sup, [{ medicineId: a.id, qty: 50 }], 'admin'); // the hospital admin may order too
    expect(o).toMatchObject({ number: 'PO-000001', status: 'draft', statusLabel: 'Draft', supplier: { name: 'Sample Distributors' }, items: 1, units: 50, byName: 'Sample admin' });
    expect(o.lines).toEqual([expect.objectContaining({ name: 'Order Tab A', qty: 50, receivedQty: 0, outstanding: 50 })]);
    expect(o.can).toEqual({ edit: true, send: true, receive: false, cancel: true, close: false });

    const changed = ok(await ph('put', `/orders/${o.id}`, { supplierId: sup.id, note: 'Deliver before noon', lines: [{ medicineId: a.id, qty: 60 }, { medicineId: b.id, qty: 20 }] }));
    expect(changed.order).toMatchObject({ note: 'Deliver before noon', items: 2, units: 80 });
    const sent = ok(await ph('post', `/orders/${o.id}/send`, {}));
    expect(sent.order).toMatchObject({ status: 'sent', sent: { byName: 'Sample pharm' } });
    expect(sent.order.can).toMatchObject({ edit: false, send: false, receive: true, cancel: true });
    expect((await ph('put', `/orders/${o.id}`, { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 1 }] })).body.error.code).toBe('NOT_DRAFT');
    expect((await ph('post', `/orders/${o.id}/send`, {})).body.error.code).toBe('WRONG_STATUS');

    // One order with the pharmacy's details for the printout; the list; printing is recorded
    const one = ok(await ph('get', `/orders/${o.id}`, undefined, 'admin'));
    expect(one.settings).toMatchObject({ name: 'Extras Hospital' });
    expect(one.order.lines[1].medicine).toMatchObject({ name: 'Order Tab B', unit: 'tablet' });
    expect(ok(await ph('get', '/orders')).orders.map((x) => [x.number, x.status])).toEqual([['PO-000001', 'sent']]);
    expect(ok(await ph('get', '/orders?status=draft')).orders).toEqual([]);
    ok(await ph('post', `/orders/${o.id}/printed`, {}));

    // The audit log: ids, numbers and counts only – never the note or a name
    expect(await audits('PHARMACY_ORDER_CREATED')).toEqual([{ orderId: o.id, number: 'PO-000001', supplierId: sup.id, lines: 1 }]);
    expect(await audits('PHARMACY_ORDER_CHANGED')).toEqual([{ orderId: o.id, number: 'PO-000001', supplierId: sup.id, lines: 2 }]);
    expect(await audits('PHARMACY_ORDER_SENT')).toEqual([{ orderId: o.id, number: 'PO-000001' }]);
    expect(await audits('PHARMACY_ORDER_PRINTED')).toEqual([{ orderId: o.id, number: 'PO-000001' }]);
    expect(JSON.stringify(await AuditLog.find({ action: /^PHARMACY_ORDER/ }).lean())).not.toMatch(/Deliver before noon|Order Tab|Sample Distributors/);
  });

  it('"Suggest from low stock" offers medicines at or below their reorder level, less what is already on order', async () => {
    const sup = await supplier();
    const low = await medicine({ name: 'Low Tab', reorderLevel: 20 });
    const none = await medicine({ name: 'Never Bought Tab', reorderLevel: 0 });
    const plenty = await medicine({ name: 'Plenty Tab', reorderLevel: 10 });
    const expiring = await medicine({ name: 'Expiring Tab', reorderLevel: 5 });
    await purchase(sup, [line(low, { qty: 5 }), line(plenty, { qty: 50 }), line(expiring, { qty: 40, expiry: '2026-10' })]);
    expect((await ph('get', '/orders/suggest', undefined, 'drA')).status).toBe(403);

    let rows = ok(await ph('get', '/orders/suggest')).suggestions;
    expect(rows.map((r) => [r.medicine.name, r.inStock, r.reorderLevel, r.onOrder, r.suggestedQty])).toEqual([
      ['Low Tab', 5, 20, 0, 35],
      ['Never Bought Tab', 0, 0, 0, 1],
    ]);
    expect(rows[0].lastSupplier).toEqual({ id: sup.id, name: 'Sample Distributors' });
    expect(rows[1].lastSupplier).toBeNull();

    // On a sent order: it counts as coming; a draft does not
    const o = await order(sup, [{ medicineId: low.id, qty: 30 }]);
    expect(ok(await ph('get', '/orders/suggest')).suggestions[0]).toMatchObject({ onOrder: 0, suggestedQty: 35 });
    ok(await ph('post', `/orders/${o.id}/send`, {}));
    expect(ok(await ph('get', '/orders/suggest', undefined, 'admin')).suggestions[0]).toMatchObject({ onOrder: 30, onOrders: ['PO-000001'], suggestedQty: 5 });

    // Expired stock is not stock: once the batch has expired the medicine is low
    later('2026-11-02T06:00:00Z');
    rows = ok(await ph('get', '/orders/suggest')).suggestions;
    expect(rows.map((r) => r.medicine.name)).toEqual(['Expiring Tab', 'Low Tab', 'Never Bought Tab']);
    expect(rows[0]).toMatchObject({ inStock: 0, suggestedQty: 10 });
    expect(none.id).toBe(rows[2].medicine.id);
  });

  it('receiving is a purchase entered against the order: part received, received, and back when the purchase is cancelled', async () => {
    const sup = await supplier();
    const elsewhere = await supplier({ name: 'Second Supplier' });
    const a = await medicine({ name: 'Recv Tab A' });
    const b = await medicine({ name: 'Recv Tab B' });
    const extra = await medicine({ name: 'Not Ordered Tab' });
    const o = await order(sup, [{ medicineId: a.id, qty: 100 }, { medicineId: b.id, qty: 20 }]);
    const body = (lines, supplierId = sup.id) => ({ supplierId, invoiceNo: 'S-1', invoiceDate: '2026-09-27', orderId: o.id, lines });

    // Not while it is a draft; not from another supplier; not when nothing of it is on the order; not by the admin
    expect((await ph('post', '/purchases', body([line(a)]))).body.error).toMatchObject({ code: 'WRONG_STATUS', message: expect.stringMatching(/still a draft/) });
    ok(await ph('post', `/orders/${o.id}/send`, {}));
    expect((await ph('post', '/purchases', body([line(a)], elsewhere.id))).body.error.message).toMatch(/another supplier/);
    expect((await ph('post', '/purchases', body([line(extra)]))).body.error.message).toMatch(/None of these medicines is on order PO-000001/);
    expect((await ph('post', '/purchases', body([line(a)]), 'admin')).status).toBe(403);
    expect(await stockOf(a)).toBe(0); // nothing came in on the refused tries

    // First delivery: 60 of A (50 paid + 10 free), two batches of B making 20, and something not ordered
    const first = ok(await ph('post', '/purchases', body([line(a, { qty: 50, freeQty: 10 }), line(b, { batch: 'B1', qty: 12 }), line(b, { batch: 'B2', qty: 8 }), line(extra, { qty: 5 })])), 201);
    expect(first.purchase).toMatchObject({ number: 'PU-000001', order: { id: o.id, number: 'PO-000001' } });
    expect(first.order).toEqual({ id: o.id, number: 'PO-000001', status: 'part_received', closed: false, counted: true });
    let now = ok(await ph('get', `/orders/${o.id}`)).order;
    expect(now.lines.map((l) => [l.name, l.qty, l.receivedQty, l.outstanding])).toEqual([
      ['Recv Tab A', 100, 60, 40],
      ['Recv Tab B', 20, 20, 0],
    ]);
    expect(now.purchases).toEqual([expect.objectContaining({ number: 'PU-000001', invoiceNo: 'S-1', status: 'active' })]);
    expect(now.can).toMatchObject({ receive: true, cancel: false, close: true });
    expect((await ph('post', `/orders/${o.id}/cancel`, { reason: 'Changed our mind' })).body.error.code).toBe('WRONG_STATUS');
    expect(ok(await ph('get', '/purchases')).purchases[0].order).toEqual({ id: o.id, number: 'PO-000001' });

    // The rest arrives: received. Nothing more can come in against it.
    const second = ok(await ph('post', '/purchases', body([line(a, { batch: 'A2', qty: 40 })])), 201);
    expect(second.order.status).toBe('received');
    expect((await ph('post', '/purchases', body([line(a, { batch: 'A3', qty: 1 })]))).body.error).toMatchObject({ code: 'WRONG_STATUS', message: expect.stringMatching(/is received/) });
    expect(await stockOf(a)).toBe(100);

    // A purchase entered by mistake is cancelled: what it brought no longer counts
    ok(await ph('post', `/purchases/${second.purchase.id}/cancel`, { reason: 'Entered twice' }));
    now = ok(await ph('get', `/orders/${o.id}`)).order;
    expect(now).toMatchObject({ status: 'part_received' });
    expect(now.lines[0]).toMatchObject({ receivedQty: 60, outstanding: 40 });
    expect(now.purchases.map((p) => p.status)).toEqual(['active', 'cancelled']);

    expect(await audits('PHARMACY_ORDER_RECEIVED')).toEqual([
      { orderId: o.id, number: 'PO-000001', purchaseId: first.purchase.id, purchase: 'PU-000001', status: 'part_received' },
      { orderId: o.id, number: 'PO-000001', purchaseId: second.purchase.id, purchase: 'PU-000002', status: 'received' },
    ]);
    expect((await audits('PHARMACY_PURCHASE_ENTERED'))[0]).toMatchObject({ orderId: o.id, order: 'PO-000001' });
  });

  it('a draft or sent order can be cancelled with a reason; a part-received one is closed when nothing more will come', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Close Tab' });
    const draft = await order(sup, [{ medicineId: a.id, qty: 10 }]);
    expect((await ph('post', `/orders/${draft.id}/cancel`, { reason: '' })).status).toBe(400);
    const cancelled = ok(await ph('post', `/orders/${draft.id}/cancel`, { reason: 'Made by mistake' }, 'admin')).order;
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Made by mistake', byName: 'Sample admin' } });
    expect(cancelled.can).toEqual({ edit: false, send: false, receive: false, cancel: false, close: false });
    expect((await ph('post', `/orders/${draft.id}/send`, {})).status).toBe(409);

    const o = await order(sup, [{ medicineId: a.id, qty: 10 }]);
    expect((await ph('post', `/orders/${o.id}/close`, { reason: 'Supplier has no more' })).body.error.code).toBe('WRONG_STATUS'); // nothing received yet
    ok(await ph('post', `/orders/${o.id}/send`, {}));
    const got = await purchase(sup, [line(a, { qty: 4 })], { orderId: o.id });
    expect(got.order.status).toBe('part_received');
    const closed = ok(await ph('post', `/orders/${o.id}/close`, { reason: 'Supplier has no more' })).order;
    expect(closed).toMatchObject({ status: 'part_received', closed: { reason: 'Supplier has no more', byName: 'Sample pharm' } });
    expect(closed.can).toMatchObject({ receive: false, close: false, cancel: false });
    expect((await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'S-2', invoiceDate: '2026-09-27', orderId: o.id, lines: [line(a, { batch: 'B2', qty: 6 })] })).body.error.message).toMatch(/is closed/);
    // The medicine is no longer "on order" for the low-stock suggestion
    expect(ok(await ph('get', '/orders/suggest')).suggestions).toEqual([]);
    await ph('patch', `/medicines/${a.id}`, { reorderLevel: 10 });
    expect(ok(await ph('get', '/orders/suggest')).suggestions[0]).toMatchObject({ inStock: 4, onOrder: 0, suggestedQty: 16 });

    // Cancelling its only purchase opens it again
    ok(await ph('post', `/purchases/${got.purchase.id}/cancel`, { reason: 'Wrong invoice' }));
    expect(ok(await ph('get', `/orders/${o.id}`)).order).toMatchObject({ status: 'sent', closed: null });

    expect(await audits('PHARMACY_ORDER_CANCELLED')).toEqual([{ orderId: draft.id, number: 'PO-000001' }]);
    expect(await audits('PHARMACY_ORDER_CLOSED')).toEqual([{ orderId: o.id, number: 'PO-000002' }]);
    expect(JSON.stringify(await AuditLog.find({ action: /^PHARMACY_ORDER/ }).lean())).not.toMatch(/Made by mistake|Supplier has no more/);
  });

  it('two people at once: a change made from an older copy of the order is noticed', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Race Tab' });
    // What a request of the pharmacist carries (the service is called here as the route calls it)
    const req = { tenantId: hospital._id, user: { _id: people.pharm._id, name: 'Sample pharm' }, membership: { roles: ['pharmacist'] } };
    const version = async (id) => (await PurchaseOrder.findOne({ tenantId: hospital._id, _id: id }).lean()).__v;

    // One person has the draft open to change it; meanwhile another marks it as sent. The change is refused and the
    // order stays as the supplier was given it.
    const draft = await order(sup, [{ medicineId: a.id, qty: 10 }]);
    const olderCopy = await PurchaseOrder.findOne({ tenantId: hospital._id, _id: draft.id });
    const v0 = await version(draft.id);
    ok(await ph('post', `/orders/${draft.id}/send`, {}));
    expect(await version(draft.id)).toBe(v0 + 1); // marking as sent raises the version
    await expect(updateOrder(req, olderCopy, { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 99 }], note: 'Late change' })).rejects.toMatchObject({ status: 409, code: 'NOT_DRAFT' });
    expect(ok(await ph('get', `/orders/${draft.id}`)).order).toMatchObject({ status: 'sent', note: '', lines: [expect.objectContaining({ qty: 10 })] });

    // A change of a draft is one step too, and its lines keep their ids and start with nothing received
    const second = await order(sup, [{ medicineId: a.id, qty: 5 }]);
    const v1 = await version(second.id);
    const changed = ok(await ph('put', `/orders/${second.id}`, { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 7 }] })).order;
    expect(changed.lines).toEqual([expect.objectContaining({ id: expect.stringMatching(/^[a-f0-9]{24}$/), name: 'Race Tab', qty: 7, receivedQty: 0, outstanding: 7 })]);
    expect(await version(second.id)).toBe(v1 + 1);
    expect((await ph('put', `/orders/${second.id}`, { supplierId: sup.id, lines: [{ medicineId: a.id, qty: 0 }] })).status).toBe(400);

    // A purchase is saved against a sent order (its stock is in); at that very moment the admin cancels the order.
    // The purchase stays – the stock did arrive – but it is taken off the order, and the answer says why.
    const pu = (await purchase(sup, [line(a, { batch: 'R1', qty: 4 })])).purchase;
    await Purchase.updateOne({ tenantId: hospital._id, _id: pu.id }, { $set: { orderId: draft.id } }); // as createPurchase saves it
    ok(await ph('post', `/orders/${draft.id}/cancel`, { reason: 'Supplier closed down' }, 'admin'));
    expect(await version(draft.id)).toBe(v0 + 2); // cancelling raises the version
    const saved = await Purchase.findOne({ tenantId: hospital._id, _id: pu.id });
    const got = await countPurchaseOnOrder(req, draft.id, saved);
    expect(got).toMatchObject({ counted: false, why: 'cancelled', order: { status: 'cancelled' } });
    expect((await Purchase.findOne({ tenantId: hospital._id, _id: pu.id }).lean()).orderId).toBeNull();
    const after = ok(await ph('get', `/orders/${draft.id}`)).order;
    expect(after).toMatchObject({ status: 'cancelled', purchases: [] });
    expect(after.lines[0]).toMatchObject({ receivedQty: 0 });
    expect(await stockOf(a)).toBe(4); // the stock stays in

    // The same when the order was closed at that moment: nothing more is counted on a closed order
    ok(await ph('post', `/orders/${second.id}/send`, {}));
    ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'S-9', invoiceDate: '2026-09-27', orderId: second.id, lines: [line(a, { batch: 'R2', qty: 3 })] }), 201);
    ok(await ph('post', `/orders/${second.id}/close`, { reason: 'No more will come' }));
    expect(await applyPurchase(req, second.id, [{ medicineId: a.id, qty: 2, freeQty: 0 }], 1)).toMatchObject({ counted: false, order: { status: 'part_received', closed: { reason: 'No more will come' } } });
    expect(ok(await ph('get', `/orders/${second.id}`)).order.lines[0]).toMatchObject({ receivedQty: 3 });
    // …while a cancelled purchase is still taken back from a closed order (it opens again)
    expect(await applyPurchase(req, second.id, [{ medicineId: a.id, qty: 3, freeQty: 0 }], -1)).toMatchObject({ counted: true, order: { status: 'sent', closed: null } });
  });

  it('two deliveries entered against one order at the same moment are both counted', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Twice Tab' });
    const o = await order(sup, [{ medicineId: a.id, qty: 100 }]);
    ok(await ph('post', `/orders/${o.id}/send`, {}));
    const session = await as('pharm');
    const send = (batch, qty, freeQty = 0) => session.post('/api/pharmacy/purchases').send({ supplierId: sup.id, invoiceNo: `S-${batch}`, invoiceDate: '2026-09-27', orderId: o.id, lines: [line(a, { batch, qty, freeQty })] });
    const both = await Promise.all([send('T1', 30), send('T2', 20, 5), send('T3', 10)]);
    for (const res of both) expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(both.every((res) => res.body.order.counted)).toBe(true);
    const now = ok(await ph('get', `/orders/${o.id}`)).order;
    expect(now).toMatchObject({ status: 'part_received' });
    expect(now.lines[0]).toMatchObject({ qty: 100, receivedQty: 65, outstanding: 35 });
    expect(now.purchases).toHaveLength(3);
    expect(await stockOf(a)).toBe(65);
    expect((await audits('PHARMACY_ORDER_RECEIVED')).map((d) => d.notCounted)).toEqual([undefined, undefined, undefined]);
  });

  it('another hospital’s order is simply not found', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Mine Tab' });
    const o = await order(sup, [{ medicineId: a.id, qty: 10 }]);
    ok(await ph('post', `/orders/${o.id}/send`, {}));
    const theirSup = await supplier({ name: 'Their Supplier' }, 'otherPharm');
    const theirMed = await medicine({ name: 'Their Tab' }, 'otherPharm');
    expect(ok(await ph('get', '/orders', undefined, 'otherPharm')).orders).toEqual([]);
    expect((await ph('get', `/orders/${o.id}`, undefined, 'otherPharm')).status).toBe(404);
    expect((await ph('put', `/orders/${o.id}`, { supplierId: theirSup.id, lines: [{ medicineId: theirMed.id, qty: 1 }] }, 'otherAdmin')).status).toBe(404);
    for (const act of ['send', 'printed']) expect((await ph('post', `/orders/${o.id}/${act}`, {}, 'otherAdmin')).status).toBe(404);
    for (const act of ['cancel', 'close']) expect((await ph('post', `/orders/${o.id}/${act}`, { reason: 'Not ours' }, 'otherAdmin')).status).toBe(404);
    expect((await ph('post', '/purchases', { supplierId: theirSup.id, invoiceNo: 'T-1', invoiceDate: '2026-09-27', orderId: o.id, lines: [line(theirMed)] }, 'otherPharm')).status).toBe(404);
    // …and this hospital cannot order another hospital's medicine or from its supplier
    expect((await ph('post', '/orders', { supplierId: sup.id, lines: [{ medicineId: theirMed.id, qty: 1 }] })).status).toBe(400);
    expect((await ph('post', '/orders', { supplierId: theirSup.id, lines: [{ medicineId: a.id, qty: 1 }] })).status).toBe(400);
    expect(ok(await ph('get', `/orders/${o.id}`)).order.status).toBe('sent'); // untouched
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('returns to a supplier', () => {
  it('the pharmacist sends batches back to the supplier they came from – expired ones too – with a debit note', async () => {
    ok(await ph('put', '/settings', { gstin: PHARMACY_GSTIN }));
    const sup = await supplier({ gstin: gstin('27DDDDD3333D1Z') });
    const elsewhere = await supplier({ name: 'Second Supplier' });
    const a = await medicine({ name: 'Return Tab', generic: 'Sampleol', hsn: '3004', gstRate: 5 });
    const b = await medicine({ name: 'Free Units Tab', hsn: '30049099', gstRate: 5 });
    const c = await medicine({ name: 'Elsewhere Tab' });
    const pu = await purchase(sup, [line(a, { batch: 'RA1', expiry: '2026-10', qty: 100, ratePaise: 500 }), line(b, { batch: 'RB1', qty: 90, freeQty: 10, ratePaise: 1000, mrpPaise: 2000 })], { invoiceNo: 'SUP-77' });
    await purchase(elsewhere, [line(c, { batch: 'RC1' })]);
    // The GST rate changes after the purchase: the debit note keeps the rate of the purchase
    ok(await ph('patch', `/medicines/${a.id}`, { gstRate: 18 }));

    // What can go back to this supplier (the admin does not send stock back)
    expect((await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`, undefined, 'admin')).status).toBe(403);
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`));
    expect(offer.interState).toBe(false);
    expect(offer.batches.map((x) => [x.name, x.batch, x.qtyLeft, x.ratePaise, x.gstRate, x.hsn, x.invoiceNo])).toEqual([
      ['Return Tab', 'RA1', 100, 500, 5, '3004', 'SUP-77'],
      ['Free Units Tab', 'RB1', 100, 900, 5, '30049099', 'SUP-77'], // ₹10 × 90 paid, spread over the 100 units that came
    ]);
    const batchOf = (name) => offer.batches.find((x) => x.name === name);
    const theirs = ok(await ph('get', `/supplier-returns/batches?supplierId=${elsewhere.id}`)).batches[0];

    const send = (body, who = 'pharm') => ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'expired', ...body }, who);
    expect((await send({ lines: [{ batchId: batchOf('Return Tab').id, qty: 10 }] }, 'admin')).status).toBe(403);
    expect((await send({ reason: 'because', lines: [{ batchId: batchOf('Return Tab').id, qty: 10 }] })).status).toBe(400);
    expect((await send({ lines: [] })).status).toBe(400);
    expect((await send({ lines: [{ batchId: batchOf('Return Tab').id, qty: 101 }] })).body.error.message).toMatch(/only 100 left/);
    expect((await send({ lines: [{ batchId: theirs.id, qty: 1 }] })).body.error.message).toMatch(/was not bought from Sample Distributors/);
    expect((await send({ lines: [{ batchId: batchOf('Return Tab').id, qty: 1 }, { batchId: batchOf('Return Tab').id, qty: 2 }] })).body.error.message).toMatch(/twice/);
    expect(await stockOf(a)).toBe(100);

    // The batch expires; expired stock cannot be sold but may go back
    later('2026-11-02T06:00:00Z');
    expect((await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: a.id, qty: 1 }] })).status).toBe(409);
    const res = await send({ note: 'Collected by the supplier’s van', lines: [{ batchId: batchOf('Return Tab').id, qty: 40 }, { batchId: batchOf('Free Units Tab').id, qty: 10 }] });
    const ret = ok(res, 201).return;
    expect(ret).toMatchObject({ number: 'SR-000001', reason: 'expired', reasonLabel: 'Expired', note: 'Collected by the supplier’s van', interState: false, controlled: false, byName: 'Sample pharm', supplier: { name: 'Sample Distributors' } });
    expect(ret.lines).toEqual([
      expect.objectContaining({ name: 'Return Tab', hsn: '3004', batch: 'RA1', expiry: '2026-10-31', qty: 40, ratePaise: 500, gstRate: 5, taxablePaise: 20000, cgstPaise: 500, sgstPaise: 500, igstPaise: 0, amountPaise: 21000, purchaseNumber: 'PU-000001', invoiceNo: 'SUP-77', invoiceDate: '2026-09-27' }),
      expect.objectContaining({ name: 'Free Units Tab', hsn: '30049099', batch: 'RB1', qty: 10, ratePaise: 900, gstRate: 5, taxablePaise: 9000, cgstPaise: 225, sgstPaise: 225, amountPaise: 9450 }),
    ]);
    expect(ret.totals).toEqual({ qty: 50, taxablePaise: 29000, gstPaise: 1450, cgstPaise: 725, sgstPaise: 725, igstPaise: 0, amountPaise: 30450 });

    // The stock went out with its own kind of move; the purchase can no longer be cancelled
    const stock = ok(await ph('get', `/stock/${a.id}`));
    expect(stock.batches[0]).toMatchObject({ batch: 'RA1', qtyLeft: 60 });
    expect(stock.moves[0]).toMatchObject({ kind: 'supplier_return', qty: -40, balanceAfter: 60, ref: 'SR-000001', reason: 'Expired – Collected by the supplier’s van' });
    expect((await ph('post', `/purchases/${pu.purchase.id}/cancel`, { reason: 'Wrong' })).body.error.code).toBe('USED');

    // Seen and printed by the pharmacist and the admin; the list
    const seen = ok(await ph('get', `/supplier-returns/${ret.id}`, undefined, 'admin'));
    expect(seen.return.number).toBe('SR-000001');
    expect(seen.settings).toMatchObject({ gstin: PHARMACY_GSTIN });
    ok(await ph('post', `/supplier-returns/${ret.id}/printed`, {}, 'admin'));
    expect(ok(await ph('get', '/supplier-returns', undefined, 'admin')).returns.map((r) => [r.number, r.totals.amountPaise])).toEqual([['SR-000001', 30450]]);
    for (const who of ['drA', 'nurse', 'reception']) expect((await ph('get', '/supplier-returns', undefined, who)).status).toBe(403);

    // The audit log: ids, numbers and amounts – never the typed note or a name
    expect(await audits('PHARMACY_SUPPLIER_RETURNED')).toEqual([{ returnId: ret.id, number: 'SR-000001', supplierId: sup.id, reason: 'expired', lines: 2, qty: 50, amountPaise: 30450, controlled: false }]);
    expect(await audits('PHARMACY_DEBIT_NOTE_PRINTED')).toEqual([{ returnId: ret.id, number: 'SR-000001' }]);
    expect(JSON.stringify(await AuditLog.find({ action: /SUPPLIER_RETURNED|DEBIT_NOTE/ }).lean())).not.toMatch(/van|Return Tab|Sample Distributors/);
  });

  it('a supplier in another state gets IGST on the debit note', async () => {
    ok(await ph('put', '/settings', { gstin: PHARMACY_GSTIN }));
    const far = await supplier({ name: 'Far Supplier', gstin: FAR_SUPPLIER_GSTIN });
    const a = await medicine({ name: 'Far Tab', gstRate: 5 });
    await purchase(far, [line(a, { qty: 10, ratePaise: 1000 })]);
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${far.id}`));
    expect(offer.interState).toBe(true);
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: far.id, reason: 'wrong_item', lines: [{ batchId: offer.batches[0].id, qty: 10 }] }), 201).return;
    expect(ret).toMatchObject({ interState: true, reasonLabel: 'Wrong item' });
    expect(ret.totals).toMatchObject({ taxablePaise: 10000, cgstPaise: 0, sgstPaise: 0, igstPaise: 500, amountPaise: 10500 });
  });

  it('Schedule H1, X and narcotic returns are in their registers with the balance; X and narcotic need a witness', async () => {
    const sup = await supplier();
    const h1 = await medicine({ name: 'H1 Return Tab', schedule: 'H1' });
    const n = await medicine({ name: 'Morphine 10 mg/ml', form: 'injection', unit: 'ampoule', schedule: 'narcotic' });
    await purchase(sup, [line(h1, { batch: 'H1B', qty: 30 }), line(n, { batch: 'N1', qty: 10, ratePaise: 2000, mrpPaise: 3000 })]);
    const p = await register('Register Mother');
    ok(await ph('post', '/invoices', { kind: 'sale', patientId: p.id, rxSeen: true, doctor: { name: 'Dr. Outside' }, lines: [{ medicineId: h1.id, qty: 10 }] }), 201);
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`)).batches;
    const narcotic = offer.find((x) => x.name === 'Morphine 10 mg/ml');
    expect(narcotic).toMatchObject({ controlled: true, scheduleLabel: 'Narcotic (NDPS)' });

    const noWitness = await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'recalled', lines: [{ batchId: narcotic.id, qty: 4 }] });
    expect(noWitness.status).toBe(400);
    expect(noWitness.body.error).toMatchObject({ message: expect.stringMatching(/controlled medicine/), fields: { witness: expect.any(String) } });
    expect(await StockMove.countDocuments({ tenantId: hospital._id, kind: 'supplier_return' })).toBe(0); // nothing left the stock
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'recalled', witness: 'Sister Sample', lines: [{ batchId: narcotic.id, qty: 4 }, { batchId: offer.find((x) => x.name === 'H1 Return Tab').id, qty: 5 }] }), 201).return;
    expect(ret).toMatchObject({ controlled: true, witness: 'Sister Sample' });

    const reg = ok(await ph('get', '/reports/register?type=narcotic&from=2026-09-01&to=2026-09-30'));
    expect(reg.pages[0]).toMatchObject({ opening: 0, closing: 6 });
    expect(reg.pages[0].rows.map((r) => [r.kind, r.in, r.out, r.balance])).toEqual([
      ['purchase', 10, 0, 10],
      ['supplier_return', 0, 4, 6],
    ]);
    expect(reg.pages[0].rows[1]).toMatchObject({ ref: 'SR-000001', supplier: 'Sample Distributors', reason: 'Recalled', witness: 'Sister Sample', patient: '' });
    const h1reg = ok(await ph('get', '/reports/register?type=H1&from=2026-09-01&to=2026-09-30'));
    expect(h1reg.pages[0].rows.map((r) => [r.kind, r.out, r.balance])).toEqual([
      ['sale', 10, 20],
      ['supplier_return', 5, 15],
    ]);
    expect((await audits('PHARMACY_SUPPLIER_RETURNED'))[0]).toMatchObject({ controlled: true, qty: 9 });
    expect(JSON.stringify(await audits('PHARMACY_SUPPLIER_RETURNED'))).not.toMatch(/Sister Sample/);
  });

  it('a return entered by mistake is cancelled: the stock goes back, the registers show it, the reports leave it out', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Mistake Tab' });
    const n = await medicine({ name: 'Morphine 10 mg/ml', form: 'injection', unit: 'ampoule', schedule: 'narcotic' });
    const pu = await purchase(sup, [line(a, { batch: 'M1', qty: 100, ratePaise: 500 }), line(n, { batch: 'N1', qty: 10, ratePaise: 2000, mrpPaise: 3000 })]);
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`)).batches;
    const batch = (name) => offer.find((x) => x.name === name);

    // 90 typed instead of 9
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'excess', lines: [{ batchId: batch('Mistake Tab').id, qty: 90 }] }), 201).return;
    expect(ret).toMatchObject({ number: 'SR-000001', status: 'active', cancelled: null, canCancel: true });
    expect(await stockOf(a)).toBe(10);
    expect(ok(await ph('get', `/supplier-returns/${ret.id}`, undefined, 'admin')).return.canCancel).toBe(false);
    expect(ok(await ph('get', '/reports/purchases?from=2026-09-01&to=2026-09-30')).bySupplier[0]).toMatchObject({ totalPaise: 70000, returns: 1, returnedPaise: 45000, netPaise: 25000 });

    // Only the pharmacist cancels it, with a reason; another hospital finds no such return
    const cancel = (id, body, who = 'pharm') => ph('post', `/supplier-returns/${id}/cancel`, body, who);
    expect((await cancel(ret.id, { reason: 'Typed 90 for 9' }, 'admin')).status).toBe(403);
    expect((await cancel(ret.id, { reason: '' })).status).toBe(400);
    expect((await cancel(ret.id, { reason: 'Not ours' }, 'otherPharm')).status).toBe(404);
    expect(await stockOf(a)).toBe(10);
    const done = ok(await cancel(ret.id, { reason: 'Typed 90 for 9' }));
    expect(done.return).toMatchObject({ number: 'SR-000001', status: 'cancelled', canCancel: false, cancelled: { reason: 'Typed 90 for 9', byName: 'Sample pharm', witness: '' } });
    expect(done.settings).toMatchObject({ name: 'Extras Hospital' });

    // The units are back on their batch, with a stock move of their own kind
    expect(await stockOf(a)).toBe(100);
    const stock = ok(await ph('get', `/stock/${a.id}`));
    expect(stock.batches[0]).toMatchObject({ batch: 'M1', qtyLeft: 100 });
    expect(stock.moves.slice(0, 2).map((m) => [m.kind, m.qty, m.balanceAfter, m.ref, m.reason])).toEqual([
      ['supplier_return_cancelled', 90, 100, 'SR-000001', 'Return cancelled – Typed 90 for 9'],
      ['supplier_return', -90, 10, 'SR-000001', 'Excess stock'],
    ]);
    // Not twice: the stock is put back once only
    expect((await cancel(ret.id, { reason: 'Again' })).body.error).toMatchObject({ code: 'CANCELLED', message: expect.stringMatching(/already cancelled/) });
    expect(await stockOf(a)).toBe(100);

    // The report no longer counts it; the list and the accountant's export show it, marked cancelled
    expect(ok(await ph('get', '/reports/purchases?from=2026-09-01&to=2026-09-30')).bySupplier).toEqual([{ supplier: 'Sample Distributors', invoices: 1, totalPaise: 70000, returns: 0, returnedPaise: 0, netPaise: 70000 }]);
    expect(ok(await ph('get', '/supplier-returns', undefined, 'admin')).returns.map((r) => [r.number, r.status])).toEqual([['SR-000001', 'cancelled']]);
    const csv = await ph('get', '/export?from=2026-09-01&to=2026-09-30&what=supplier_returns', undefined, 'admin');
    const rows = csv.text.split('\r\n').filter(Boolean);
    expect(rows[0]).toMatch(/,Amount,Status$/);
    expect(rows[1]).toMatch(/SR-000001,.*,472\.50,Cancelled$/);

    // A narcotic that comes back into stock needs a witness, as the return did; both are in its register with the balance
    const back = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'recalled', witness: 'Sister Sample', lines: [{ batchId: batch('Morphine 10 mg/ml').id, qty: 4 }] }), 201).return;
    const noWitness = await cancel(back.id, { reason: 'Wrong batch chosen' });
    expect(noWitness.status).toBe(400);
    expect(noWitness.body.error).toMatchObject({ message: expect.stringMatching(/controlled medicine/), fields: { witness: expect.any(String) } });
    expect(await stockOf(n)).toBe(6);
    expect(ok(await cancel(back.id, { reason: 'Wrong batch chosen', witness: 'Sister Second' })).return.cancelled).toMatchObject({ witness: 'Sister Second' });
    const reg = ok(await ph('get', '/reports/register?type=narcotic&from=2026-09-01&to=2026-09-30'));
    expect(reg.pages[0]).toMatchObject({ opening: 0, closing: 10 });
    expect(reg.pages[0].rows.map((r) => [r.kind, r.in, r.out, r.balance, r.witness])).toEqual([
      ['purchase', 10, 0, 10, ''],
      ['supplier_return', 0, 4, 6, 'Sister Sample'],
      ['supplier_return_cancelled', 4, 0, 10, 'Sister Second'],
    ]);
    expect(reg.pages[0].rows[2]).toMatchObject({ ref: 'SR-000002', supplier: 'Sample Distributors', reason: 'Return cancelled – Wrong batch chosen' });

    // With everything back, the purchase itself can be cancelled again
    ok(await ph('post', `/purchases/${pu.purchase.id}/cancel`, { reason: 'Entered twice' }));

    // The audit log: ids, numbers and amounts – never the reason or the witness that was typed
    expect(await audits('PHARMACY_SUPPLIER_RETURN_CANCELLED')).toEqual([
      { returnId: ret.id, number: 'SR-000001', supplierId: sup.id, lines: 1, qty: 90, amountPaise: 47250, controlled: false },
      { returnId: back.id, number: 'SR-000002', supplierId: sup.id, lines: 1, qty: 4, amountPaise: expect.any(Number), controlled: true },
    ]);
    expect(JSON.stringify(await AuditLog.find({ action: 'PHARMACY_SUPPLIER_RETURN_CANCELLED' }).lean())).not.toMatch(/Typed 90|Wrong batch|Sister/);
  });

  it('a return is all or nothing: when a batch runs out between the check and the move, what was taken goes back', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'First Tab' });
    const b = await medicine({ name: 'Second Tab' });
    await purchase(sup, [line(a, { batch: 'F1', qty: 20 }), line(b, { batch: 'S1', qty: 10 })]);
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`)).batches;
    const batch = (name) => offer.find((x) => x.name === name);

    // The second batch is found empty at the moment of its stock move (as if it was sold just then)
    const real = StockBatch.findOneAndUpdate.bind(StockBatch);
    let moves = 0;
    const spy = vi.spyOn(StockBatch, 'findOneAndUpdate').mockImplementation((...args) => {
      moves += 1;
      return moves === 2 ? { lean: async () => null } : real(...args);
    });
    let res;
    try {
      res = await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'excess', lines: [{ batchId: batch('First Tab').id, qty: 5 }, { batchId: batch('Second Tab').id, qty: 8 }] });
    } finally {
      spy.mockRestore();
    }
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'OUT_OF_STOCK', message: expect.stringMatching(/Batch S1/) });
    expect(moves).toBe(3); // out, refused, back
    expect([await stockOf(a), await stockOf(b)]).toEqual([20, 10]);
    expect(await SupplierReturn.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'PHARMACY_SUPPLIER_RETURNED' })).toBe(0);
    const trail = ok(await ph('get', `/stock/${a.id}`)).moves.map((m) => [m.kind, m.qty, m.balanceAfter, m.reason]);
    expect(trail).toEqual([
      ['supplier_return_cancelled', 5, 20, 'Return to the supplier not completed'],
      ['supplier_return', -5, 15, 'Excess stock'],
      ['purchase', 20, 20, ''],
    ]);
    expect(ok(await ph('get', `/stock/${b.id}`)).moves.map((m) => m.kind)).toEqual(['purchase']);

    // Two returns of the same batch at the same moment: never more goes back than there is
    const session = await as('pharm');
    const send = (qty) => session.post('/api/pharmacy/supplier-returns').send({ supplierId: sup.id, reason: 'excess', lines: [{ batchId: batch('Second Tab').id, qty }] });
    const both = await Promise.all([send(8), send(8)]);
    expect(both.map((r) => r.status).sort()).toEqual(expect.arrayContaining([201]));
    expect(both.filter((r) => r.status === 201)).toHaveLength(1);
    expect([400, 409]).toContain(both.find((r) => r.status !== 201).status);
    expect(await stockOf(b)).toBe(2);
    expect(await SupplierReturn.countDocuments({ tenantId: hospital._id })).toBe(1);
    const left = await StockMove.find({ tenantId: hospital._id, medicineId: b.id }).lean();
    expect(left.reduce((sum, m) => sum + m.qty, 0)).toBe(2); // every move adds up to what is on the shelf
  });

  it('Reports show purchases by supplier net of returns; the admin exports the returns; another hospital sees none', async () => {
    const one = await supplier({ name: 'First Supplier' });
    const two = await supplier({ name: 'Second Supplier' });
    const a = await medicine({ name: 'Net Tab A' });
    const b = await medicine({ name: 'Net Tab B' });
    await purchase(one, [line(a, { qty: 100, ratePaise: 500 })]); // 50,000 paise
    await purchase(two, [line(b, { qty: 10, ratePaise: 1000 })]); // 10,000 paise
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${one.id}`)).batches;
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: one.id, reason: 'excess', lines: [{ batchId: offer[0].id, qty: 30 }] }), 201).return;

    const report = ok(await ph('get', '/reports/purchases?from=2026-09-01&to=2026-09-30', undefined, 'admin'));
    expect(report.bySupplier).toEqual([
      { supplier: 'First Supplier', invoices: 1, totalPaise: 50000, returns: 1, returnedPaise: 15000, netPaise: 35000 },
      { supplier: 'Second Supplier', invoices: 1, totalPaise: 10000, returns: 0, returnedPaise: 0, netPaise: 10000 },
    ]);
    expect(report).toMatchObject({ totalPaise: 60000, returnedPaise: 15000, netPaise: 45000 });
    // A period with only the return: the supplier still shows, below zero
    later('2026-10-05T06:00:00Z');
    const again = ok(await ph('get', `/supplier-returns/batches?supplierId=${two.id}`)).batches;
    ok(await ph('post', '/supplier-returns', { supplierId: two.id, reason: 'damaged', lines: [{ batchId: again[0].id, qty: 2 }] }), 201);
    expect(ok(await ph('get', '/reports/purchases?from=2026-10-01&to=2026-10-31')).bySupplier).toEqual([{ supplier: 'Second Supplier', invoices: 0, totalPaise: 0, returns: 1, returnedPaise: 2000, netPaise: -2000 }]);

    expect((await ph('get', '/export?from=2026-09-01&to=2026-10-31&what=supplier_returns')).status).toBe(403);
    const csv = await ph('get', '/export?from=2026-09-01&to=2026-10-31&what=supplier_returns', undefined, 'admin');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('perinexa-pharmacy-supplier-returns-2026-09-01-to-2026-10-31.csv');
    const rows = csv.text.split('\r\n').filter(Boolean);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('SR-000001,2026-09-28,First Supplier,,Excess stock');

    expect(ok(await ph('get', '/supplier-returns', undefined, 'otherAdmin')).returns).toEqual([]);
    expect((await ph('get', `/supplier-returns/${ret.id}`, undefined, 'otherAdmin')).status).toBe(404);
    expect((await ph('post', `/supplier-returns/${ret.id}/printed`, {}, 'otherAdmin')).status).toBe(404);
    expect((await ph('get', `/supplier-returns/batches?supplierId=${one.id}`, undefined, 'otherPharm')).status).toBe(404);
    // …and the other hospital's pharmacist cannot send this hospital's batch back
    const theirSup = await supplier({ name: 'Their Supplier' }, 'otherPharm');
    expect((await ph('post', '/supplier-returns', { supplierId: theirSup.id, reason: 'expired', lines: [{ batchId: offer[0].id, qty: 1 }] }, 'otherPharm')).status).toBe(400);
    expect(await stockOf(a)).toBe(70);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('barcodes', () => {
  it('a medicine holds one or more barcodes; a scan finds it by the exact barcode only', async () => {
    const sup = await supplier();
    const m = await medicine({ name: 'Scan Tab', barcodes: [' 8901 2345 67890 ', 'abc-123', '8901234567890'] });
    expect(m.barcodes).toEqual(['8901234567890', 'ABC-123']); // cleaned, each once
    await purchase(sup, [line(m, { qty: 7 })]);

    const found = ok(await ph('get', '/barcode/8901234567890'));
    expect(found.medicine).toMatchObject({ id: m.id, name: 'Scan Tab', inStock: 7, barcodes: ['8901234567890', 'ABC-123'] });
    expect(ok(await ph('get', '/barcode/abc-123', undefined, 'admin')).medicine.id).toBe(m.id); // typed in small letters
    // Never a near match
    for (const near of ['890123456789', '89012345678901', '8901234567891']) expect((await ph('get', `/barcode/${near}`)).status).toBe(404);
    expect((await ph('get', '/barcode/8901234567891')).body.error.message).toMatch(/No medicine has the barcode 8901234567891/);
    expect((await ph('get', '/barcode/12')).status).toBe(400);
    expect((await ph('get', `/barcode/${encodeURIComponent('12 34$')}`)).status).toBe(400);
    for (const who of ['drA', 'nurse', 'reception']) expect((await ph('get', '/barcode/8901234567890', undefined, who)).status).toBe(403);

    // Barcodes are changed like the rest of the medicine; the list shows them
    const changed = ok(await ph('patch', `/medicines/${m.id}`, { barcodes: ['8901234567890', '4005808123456'] }, 'admin')).medicine;
    expect(changed.barcodes).toEqual(['8901234567890', '4005808123456']);
    expect((await ph('get', '/barcode/ABC-123')).status).toBe(404); // taken off
    expect(ok(await ph('get', '/medicines')).medicines.find((x) => x.id === m.id).barcodes).toHaveLength(2);
    expect((await ph('patch', `/medicines/${m.id}`, { barcodes: ['12'] })).body.error.fields['barcodes.0']).toMatch(/4 to 32/);
    expect((await ph('patch', `/medicines/${m.id}`, { barcodes: Array.from({ length: 11 }, (_, i) => `10000${i}`) })).status).toBe(400);
    ok(await ph('patch', `/medicines/${m.id}`, { barcodes: [] }));
    expect((await ph('get', '/barcode/8901234567890')).status).toBe(404);

    expect((await audits('PHARMACY_MEDICINE_CHANGED')).filter((d) => d.fields?.includes('barcodes'))).toEqual([
      { medicineId: m.id, fields: ['barcodes'], barcodes: 2 },
      { medicineId: m.id, fields: ['barcodes'], barcodes: 0 },
    ]);
    expect(JSON.stringify(await audits('PHARMACY_MEDICINE_CHANGED'))).not.toMatch(/8901234567890|4005808123456/);
  });

  it('a change to a medicine or a supplier changes only what was sent ("Stop using" keeps the schedule and the rest)', async () => {
    const m = await medicine({ name: 'Keep Tab', generic: 'Keepamine', strength: '10 mg', hsn: '3004', schedule: 'narcotic', reorderLevel: 25, barcodes: ['8900000000031'] });
    const kept = { generic: 'Keepamine', strength: '10 mg', hsn: '3004', schedule: 'narcotic', controlled: true, reorderLevel: 25, barcodes: ['8900000000031'] };
    expect(ok(await ph('patch', `/medicines/${m.id}`, { active: false })).medicine).toMatchObject({ ...kept, active: false });
    expect(ok(await ph('patch', `/medicines/${m.id}`, { active: true })).medicine).toMatchObject({ ...kept, active: true });
    expect(ok(await ph('patch', `/medicines/${m.id}`, { barcodes: [] })).medicine).toMatchObject({ ...kept, barcodes: [] });
    expect((await audits('PHARMACY_MEDICINE_CHANGED')).slice(1).map((d) => d.fields)).toEqual([['active'], ['active'], ['barcodes']]);
    const sup = await supplier({ gstin: PHARMACY_GSTIN, drugLicence: 'DL-1', phone: '020 0000 0000', address: '1 Sample Road' });
    expect(ok(await ph('patch', `/suppliers/${sup.id}`, { active: false })).supplier).toMatchObject({ gstin: PHARMACY_GSTIN, drugLicence: 'DL-1', phone: '020 0000 0000', address: '1 Sample Road', active: false });
  });

  it('a barcode belongs to only one medicine in a hospital (another hospital may use the same one)', async () => {
    const a = await medicine({ name: 'First Holder', barcodes: ['8900000000017'] });
    const b = await medicine({ name: 'Second Holder' });
    const clash = await ph('patch', `/medicines/${b.id}`, { barcodes: ['8900000000024', ' 8900 0000 00017'] });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'DUPLICATE', message: 'Barcode 8900000000017 is already on First Holder. A barcode belongs to one medicine only.' });
    expect((await ph('post', '/medicines', { name: 'Third Holder', form: 'tablet', unit: 'tablet', gstRate: 5, barcodes: ['8900000000017'] })).status).toBe(409);
    expect(ok(await ph('get', `/stock/${b.id}`)).medicine.barcodes).toEqual([]); // nothing was saved
    // Saving a medicine again with its own barcode is fine
    expect(ok(await ph('patch', `/medicines/${a.id}`, { barcodes: ['8900000000017'], reorderLevel: 5 })).medicine.barcodes).toEqual(['8900000000017']);
    // The database refuses it too (two people at the same moment); medicines without barcodes are not affected
    await expect(Medicine.create({ tenantId: hospital._id, name: 'Straight In', barcodes: ['8900000000017'] })).rejects.toMatchObject({ code: 11000 });
    await medicine({ name: 'No Barcode One' });
    await medicine({ name: 'No Barcode Two' });

    // Another hospital: its own medicine with the same barcode; each hospital finds only its own
    const theirs = await medicine({ name: 'Their Holder', barcodes: ['8900000000017'] }, 'otherPharm');
    expect(ok(await ph('get', '/barcode/8900000000017', undefined, 'otherPharm')).medicine).toMatchObject({ id: theirs.id, name: 'Their Holder' });
    expect(ok(await ph('get', '/barcode/8900000000017')).medicine.id).toBe(a.id);
    ok(await ph('patch', `/medicines/${a.id}`, { barcodes: [] }));
    expect((await ph('get', '/barcode/8900000000017')).status).toBe(404); // not the other hospital's
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('the e-invoice file of a sale to a business', () => {
  const BUYER = { name: 'Sample Clinic LLP', gstin: BUYER_GSTIN, address: '2 Sample Lane', place: 'Nashik', pin: '422001' };
  async function stocked() {
    const sup = await supplier();
    const m = await medicine({ name: 'Rate Eighteen', generic: 'Sampleol', hsn: '300490', gstRate: 18 });
    const noHsn = await medicine({ name: 'No Code Tab', hsn: '', gstRate: 5 });
    const shortHsn = await medicine({ name: 'Short Code Tab', hsn: '3004', gstRate: 5 }); // 4 digits: as a new medicine starts
    await purchase(sup, [line(m, { batch: 'B12', qty: 50, ratePaise: 5000, mrpPaise: 11800 }), line(noHsn, { batch: 'NC1', qty: 50, ratePaise: 50, mrpPaise: 105 }), line(shortHsn, { batch: 'SC1', qty: 50, ratePaise: 50, mrpPaise: 105 })]);
    return { m, noHsn, shortHsn };
  }
  const sale = (body, who = 'pharm') => ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Buyer' }, payment: { mode: 'upi', reference: 'U1' }, ...body }, who);

  it('a walk-in sale may name a business buyer: its GSTIN is checked and its state read from it; never for a patient', async () => {
    const { m } = await stocked();
    const lines = [{ medicineId: m.id, qty: 10 }];
    const wrong = await sale({ lines, buyer: { ...BUYER, gstin: `${BUYER_GSTIN.slice(0, 14)}0` } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields['buyer.gstin']).toMatch(/typing mistake/);
    expect((await sale({ lines, buyer: { ...BUYER, gstin: 'ABC' } })).body.error.fields['buyer.gstin']).toMatch(/15 characters/);
    expect((await sale({ lines, buyer: { ...BUYER, pin: '4220' } })).body.error.fields['buyer.pin']).toMatch(/6 digits/);
    expect((await sale({ lines, buyer: { name: 'Sample Clinic LLP', gstin: BUYER_GSTIN } })).status).toBe(400); // address, town and PIN are needed
    const p = await register('Not A Business');
    const forPatient = await ph('post', '/invoices', { kind: 'sale', patientId: p.id, lines, buyer: BUYER });
    expect(forPatient.status).toBe(400);
    expect(forPatient.body.error.fields.buyer).toMatch(/not for a patient/);
    expect(await stockOf(m)).toBe(50); // nothing was sold on the refused tries

    const inv = ok(await sale({ lines, buyer: { ...BUYER, gstin: ` ${BUYER_GSTIN.toLowerCase()} ` } }), 201).invoice;
    expect(inv).toMatchObject({ number: 'PH-000001', customer: { name: 'Sample Buyer' }, buyer: { ...BUYER, state: 'Maharashtra', stateCode: '27' }, netPaise: 118000 });
    expect(ok(await sale({ lines }), 201).invoice.buyer).toBeNull(); // an ordinary walk-in sale still has no buyer
    expect(ok(await ph('get', '/invoices?search=Sample%20Clinic')).invoices.map((v) => v.number)).toEqual(['PH-000001']);
    expect((await audits('PHARMACY_SOLD'))[0]).toMatchObject({ walkIn: true, business: true });
    expect(JSON.stringify(await audits('PHARMACY_SOLD'))).not.toMatch(new RegExp(`Sample Clinic|${BUYER_GSTIN}`));
  });

  it('the admin downloads the invoice in the e-invoice format once the pharmacy’s details are complete', async () => {
    const { m, noHsn, shortHsn } = await stocked();
    const inv = ok(await sale({ lines: [{ medicineId: m.id, qty: 10 }], buyer: BUYER }), 201).invoice;
    const plain = ok(await sale({ lines: [{ medicineId: m.id, qty: 1 }] }), 201).invoice;
    const p = await register('Patient Sale');
    const patientInv = ok(await ph('post', '/invoices', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 1 }] }), 201).invoice;

    // Only the hospital admin; never for a patient's or an ordinary walk-in's invoice
    expect((await ph('get', `/invoices/${inv.id}/einvoice`)).status).toBe(403);
    for (const v of [plain, patientInv]) expect((await ph('get', `/invoices/${v.id}/einvoice`, undefined, 'admin')).body.error).toMatchObject({ code: 'NOT_BUSINESS', message: expect.stringMatching(/needs no e-invoice/) });
    expect(ok(await ph('get', `/invoices/${plain.id}`, undefined, 'admin')).einvoice).toBeUndefined();

    // The pharmacy's own details are not complete yet: said plainly, nothing downloaded
    const early = await ph('get', `/invoices/${inv.id}/einvoice`, undefined, 'admin');
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: 'INCOMPLETE', message: expect.stringMatching(/cannot be made yet.*pharmacy’s GSTIN.*city or town.*PIN code/) });
    expect(ok(await ph('get', `/invoices/${inv.id}`, undefined, 'admin')).einvoice).toMatchObject({ canDownload: true, problems: expect.arrayContaining([expect.stringMatching(/PIN code/)]) });
    expect(ok(await ph('get', `/invoices/${inv.id}`)).einvoice.canDownload).toBe(false);
    expect((await ph('put', '/settings', { pin: '4110' }, 'admin')).status).toBe(400);
    ok(await ph('put', '/settings', { name: 'Sample Pharmacy', gstin: PHARMACY_GSTIN, place: 'Pune', pin: '411001' }, 'admin'));
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'letterhead.address': '1 Sample Road, Pune', 'letterhead.phone': '020 0000 0000' } });

    const file = await ph('get', `/invoices/${inv.id}/einvoice`, undefined, 'admin');
    expect(file.status, JSON.stringify(file.body)).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/json/);
    expect(file.headers['content-disposition']).toBe('attachment; filename="einvoice-PH-000001.json"');
    expect(file.body).toHaveLength(1); // the portal's bulk upload takes a list
    expect(file.body[0]).toMatchObject({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B' },
      DocDtls: { Typ: 'INV', No: 'PH-000001', Dt: '28/09/2026' },
      SellerDtls: { Gstin: PHARMACY_GSTIN, LglNm: 'Sample Pharmacy', Addr1: '1 Sample Road, Pune', Loc: 'Pune', Pin: 411001, Stcd: '27', Ph: '02000000000' },
      BuyerDtls: { Gstin: BUYER_GSTIN, LglNm: 'Sample Clinic LLP', Addr1: '2 Sample Lane', Loc: 'Nashik', Pin: 422001, Stcd: '27', Pos: '27' },
      ItemList: [{ SlNo: '1', PrdDesc: 'Rate Eighteen – Sampleol', HsnCd: '300490', Qty: 10, Unit: 'TBS', UnitPrice: 100, TotAmt: 1000, AssAmt: 1000, GstRt: 18, CgstAmt: 90, SgstAmt: 90, IgstAmt: 0, TotItemVal: 1180, BchDtls: { Nm: 'B12', ExpDt: '31/12/2027' } }],
      ValDtls: { AssVal: 1000, CgstVal: 90, SgstVal: 90, IgstVal: 0, TotInvVal: 1180 },
    });
    expect(file.body[0].RefDtls).toBeUndefined();

    // A credit note is its own document, against the invoice
    ok(await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 4 }], reason: 'Not needed', refund: { mode: 'upi' } }));
    const note = await ph('get', `/invoices/${inv.id}/einvoice?creditNote=CN-000001`, undefined, 'admin');
    expect(note.status, JSON.stringify(note.body)).toBe(200);
    expect(note.headers['content-disposition']).toContain('einvoice-CN-000001.json');
    expect(note.body[0]).toMatchObject({ DocDtls: { Typ: 'CRN', No: 'CN-000001', Dt: '28/09/2026' }, RefDtls: { PrecDocDtls: [{ InvNo: 'PH-000001', InvDt: '28/09/2026' }] }, ItemList: [{ Qty: 4, AssAmt: 400, CgstAmt: 36, SgstAmt: 36, TotItemVal: 472 }], ValDtls: { AssVal: 400, TotInvVal: 472 } });
    expect((await ph('get', `/invoices/${inv.id}/einvoice?creditNote=CN-000009`, undefined, 'admin')).status).toBe(404);
    // The invoice's own file still says what was sold
    expect((await ph('get', `/invoices/${inv.id}/einvoice`, undefined, 'admin')).body[0].ValDtls.TotInvVal).toBe(1180);

    // A medicine without an HSN code: the file is refused until the code is added to the medicine
    const second = ok(await sale({ lines: [{ medicineId: noHsn.id, qty: 10 }], buyer: BUYER }), 201).invoice;
    expect((await ph('get', `/invoices/${second.id}/einvoice`, undefined, 'admin')).body.error.message).toMatch(/No HSN code for No Code Tab/);
    ok(await ph('patch', `/medicines/${noHsn.id}`, { hsn: '30049099' }, 'admin'));
    expect((await ph('get', `/invoices/${second.id}/einvoice`, undefined, 'admin')).body[0].ItemList[0]).toMatchObject({ HsnCd: '30049099', AssAmt: 10, CgstAmt: 0.25, SgstAmt: 0.25, TotItemVal: 10.5 });

    // A 4-digit HSN code is enough for the printed tax invoice, but the e-invoice portal refuses it: the page says so
    // and nothing is downloaded. It is put right on the medicine – with the same code written out longer, never another.
    const third = ok(await sale({ lines: [{ medicineId: shortHsn.id, qty: 10 }], buyer: BUYER }), 201).invoice;
    expect(third.lines[0].hsn).toBe('3004');
    const page = ok(await ph('get', `/invoices/${third.id}`, undefined, 'admin'));
    expect(page.einvoice.problems).toEqual([expect.stringMatching(/needs an HSN code of 6 or 8 digits for Short Code Tab/)]);
    const short = await ph('get', `/invoices/${third.id}/einvoice`, undefined, 'admin');
    expect(short.status).toBe(409);
    expect(short.body.error).toMatchObject({ code: 'INCOMPLETE', message: expect.stringMatching(/6 or 8 digits for Short Code Tab/) });
    ok(await ph('patch', `/medicines/${shortHsn.id}`, { hsn: '210690' }, 'admin')); // a different code: the invoice keeps its own
    expect((await ph('get', `/invoices/${third.id}/einvoice`, undefined, 'admin')).status).toBe(409);
    ok(await ph('patch', `/medicines/${shortHsn.id}`, { hsn: '300490' }, 'admin'));
    expect(ok(await ph('get', `/invoices/${third.id}`, undefined, 'admin')).einvoice.problems).toEqual([]);
    expect((await ph('get', `/invoices/${third.id}/einvoice`, undefined, 'admin')).body[0].ItemList[0]).toMatchObject({ HsnCd: '300490', Qty: 10 });
    expect(ok(await ph('get', `/invoices/${third.id}`, undefined, 'admin')).invoice.lines[0].hsn).toBe('3004'); // the invoice itself is not rewritten

    // Another hospital's admin: not found
    expect((await ph('get', `/invoices/${inv.id}/einvoice`, undefined, 'otherAdmin')).status).toBe(404);
    // The audit log: which invoice and which document – never the buyer
    expect(await audits('PHARMACY_EINVOICE_DOWNLOADED')).toEqual([
      { invoiceId: inv.id, number: 'PH-000001', document: 'INV' },
      { invoiceId: inv.id, number: 'PH-000001', document: 'CRN', creditNote: 'CN-000001' },
      { invoiceId: inv.id, number: 'PH-000001', document: 'INV' },
      { invoiceId: second.id, number: 'PH-000004', document: 'INV' },
      { invoiceId: third.id, number: 'PH-000005', document: 'INV' },
    ]);
  });
});

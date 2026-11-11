// Pharmacy Stage B (docs/PHARMACY_BUILD_NOTE.md section 4): safety at the counter. PH6 "already sold" on a
// prescription. All fake sample data.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-11T06:00:00Z');
const ROLES = { drA: 'doctor', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };
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
  hospital = await createTenant('Pharmacy B Hospital');
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
async function register(name) {
  return ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() })), 201).patient;
}
const medicine = async (fields) => ok(await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields }), 201).medicine;
async function stock(m, qty = 100, mrp = 500) {
  const sup = ok(await ph('post', '/suppliers', { name: `Sample Supplier ${randomUUID().slice(0, 4)}` }), 201).supplier;
  ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-11-10', lines: [{ medicineId: m.id, batch: `B-${randomUUID().slice(0, 4)}`, expiry: '2028-06', qty, ratePaise: Math.round(mrp * 0.7), mrpPaise: mrp }] }), 201);
}
async function prescribe(p, items) {
  const v = ok(await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 201).visit;
  ok(await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 0, items }));
  return v;
}
const rxOf = async (p) => ok(await ph('get', `/patients/${p.id}/prescriptions`)).prescriptions;
const sell = (p, visitId, lines) => ph('post', '/invoices', { kind: 'sale', patientId: p.id, visitId, lines });
// Folic acid 1-0-1 for 10 days: 20 tablets
const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-1', durationValue: 10, durationUnit: 'days' };

describe('PH6 – "already sold" on a prescription', () => {
  it('a part sale, then the rest; a return puts the quantity back to "still to give"', async () => {
    const m = await medicine({ name: 'Sample Folic 5', generic: 'Folic acid', strength: '5 mg' });
    await stock(m);
    const p = await register('Sample Rx Mother');
    const v = await prescribe(p, [FOLIC]);
    let [rx] = await rxOf(p);
    const item = rx.items[0];
    expect(item).toMatchObject({ suggestedQty: 20, givenQty: 0, stillToGive: 20, givenInFull: false, sold: [] });
    const first = ok(await sell(p, v.id, [{ medicineId: m.id, qty: 10, rxItemId: item.id }]), 201).invoice;
    [rx] = await rxOf(p);
    expect(rx.items[0]).toMatchObject({ givenQty: 10, stillToGive: 10, givenInFull: false, sold: [{ number: first.number, date: '2026-11-11', name: 'Sample Folic 5', qty: 10 }] });
    // The rest: no reason needed
    ok(await sell(p, v.id, [{ medicineId: m.id, qty: 10, rxItemId: item.id }]), 201);
    [rx] = await rxOf(p);
    expect(rx.items[0]).toMatchObject({ givenQty: 20, stillToGive: 0, givenInFull: true });
    // Given in full: again only with a reason
    const again = await sell(p, v.id, [{ medicineId: m.id, qty: 5, rxItemId: item.id }]);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'ALREADY_SOLD', details: { repeats: [{ rxItemId: item.id, drug: 'Folic acid' }] } });
    expect(again.body.error.message).toMatch(/already given/);
    // A return of 4 from the first sale: 4 still to give, so it sells without a reason
    ok(await ph('post', `/invoices/${first.id}/returns`, { items: [{ lineId: first.lines[0].id, qty: 4 }], reason: 'Not needed' }));
    [rx] = await rxOf(p);
    expect(rx.items[0]).toMatchObject({ givenQty: 16, stillToGive: 4, givenInFull: false });
    ok(await sell(p, v.id, [{ medicineId: m.id, qty: 4, rxItemId: item.id }]), 201);
  });

  it('a reason for every medicine – an over-the-counter one too; the reason is kept and the repeat audited', async () => {
    const m = await medicine({ name: 'Sample Paracetamol 500', generic: 'Paracetamol', strength: '500 mg' });
    await stock(m);
    const p = await register('Sample OTC Mother');
    // SOS: no quantity can be worked out – any sale counts as given in full
    const v = await prescribe(p, [{ drug: 'Paracetamol', form: 'tab', strength: '500 mg', dose: '1', frequency: 'sos', durationValue: 3, durationUnit: 'days' }]);
    const item = (await rxOf(p))[0].items[0];
    expect(item).toMatchObject({ suggestedQty: null, stillToGive: null, givenInFull: false });
    ok(await sell(p, v.id, [{ medicineId: m.id, qty: 6, rxItemId: item.id }]), 201);
    expect((await sell(p, v.id, [{ medicineId: m.id, qty: 6, rxItemId: item.id }])).body.error.code).toBe('ALREADY_SOLD');
    expect((await sell(p, v.id, [{ medicineId: m.id, qty: 6, rxItemId: item.id, repeatReason: 'x' }])).body.error.code).toBe('ALREADY_SOLD');
    const repeat = ok(await sell(p, v.id, [{ medicineId: m.id, qty: 6, rxItemId: item.id, repeatReason: 'First strip lost on the way home' }]), 201).invoice;
    const entry = await AuditLog.findOne({ action: 'PHARMACY_SOLD', 'details.number': repeat.number }).lean();
    expect(entry.details.repeats).toBe(1);
    expect(JSON.stringify(entry.details)).not.toMatch(/lost/); // the reason stays on the invoice, not in the log
  });

  it('a line not on the prescription is refused; old sales without a line are listed with the prescription only', async () => {
    const m = await medicine({ name: 'Sample Folic Old', generic: 'Folic acid', strength: '5 mg' });
    await stock(m);
    const p = await register('Sample Old Sale Mother');
    const v = await prescribe(p, [FOLIC]);
    expect((await sell(p, v.id, [{ medicineId: m.id, qty: 1, rxItemId: new mongoose.Types.ObjectId().toString() }])).status).toBe(400);
    // A sale from the prescription without the line (as before 11 Nov 2026)
    const old = ok(await sell(p, v.id, [{ medicineId: m.id, qty: 10 }]), 201).invoice;
    const [rx] = await rxOf(p);
    expect(rx.soldUnlinked).toEqual([{ number: old.number, date: '2026-11-11' }]);
    expect(rx.items[0]).toMatchObject({ givenQty: 0, sold: [] }); // never guessed onto a line
  });

  it('a sale on her main record counts for a prescription written on her earlier (duplicate) record', async () => {
    const m = await medicine({ name: 'Sample Folic Dup', generic: 'Folic acid', strength: '5 mg' });
    await stock(m);
    const main = await register('Sample Main Record');
    const earlier = await register('Sample Earlier Record');
    const v = await prescribe(earlier, [FOLIC]);
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(earlier.id) }, { $set: { duplicateOf: { patient: new mongoose.Types.ObjectId(main.id), mrn: main.mrn } } });
    const item = (await rxOf(main))[0].items[0];
    ok(await sell(main, v.id, [{ medicineId: m.id, qty: 20, rxItemId: item.id }]), 201);
    expect((await rxOf(main))[0].items[0]).toMatchObject({ givenQty: 20, givenInFull: true });
  });
});

describe('PH5 – a batch on hold, and who received it', () => {
  const batchOf = async (m, batch) => (await (await import('../src/models/Pharmacy.js')).StockBatch.find({ tenantId: hospital._id, medicineId: m.id, batch }).sort({ expiry: 1 }).lean());
  async function buy(m, batch, expiry, qty = 20) {
    const sup = ok(await ph('post', '/suppliers', { name: `Sample Supplier ${randomUUID().slice(0, 4)}` }), 201).supplier;
    ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-11-10', lines: [{ medicineId: m.id, batch, expiry, qty, ratePaise: 300, mrpPaise: 500 }] }), 201);
  }
  const walkIn = (m, qty, extra = {}) => ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In' }, lines: [{ medicineId: m.id, qty, ...extra }], payment: { mode: 'cash' } });

  it('first-expiry skips a held batch and sells the next; a held batch chosen by hand is refused; held stock is not "in stock"', async () => {
    const m = await medicine({ name: 'Sample Recall Tab', generic: 'Sample', reorderLevel: 25, manufacturer: 'Sample Makers' });
    await buy(m, 'R1', '2027-01');
    await buy(m, 'R2', '2028-01');
    // Two purchases of the same recalled batch number: both are held
    await buy(m, 'R1', '2027-01', 5);
    ok(await ph('post', '/batches/hold', { medicineId: m.id, batch: 'r1', reason: 'recalled', note: 'Recall notice 10 Nov' }));
    expect((await batchOf(m, 'R1')).every((b) => b.hold?.reason === 'recalled')).toBe(true);
    expect((await ph('post', '/batches/hold', { medicineId: m.id, batch: 'R1', reason: 'recalled' })).status).toBe(409);
    const sale = ok(await walkIn(m, 3), 201).invoice;
    expect(sale.lines[0].batch).toBe('R2');
    const [r1] = await batchOf(m, 'R1');
    const byHand = await walkIn(m, 1, { batchId: String(r1._id) });
    expect(byHand.status).toBe(409);
    expect(byHand.body.error.code).toBe('ON_HOLD');
    // The stock list: 17 usable (R2), 25 held; the low mark counts only usable stock
    const row = ok(await ph('get', '/stock')).medicines.find((x) => x.id === m.id);
    expect(row).toMatchObject({ qty: 17, heldQty: 25, low: true });
    // The doctor's "in stock" leaves it out too
    expect((await ph('get', `/medicines/${m.id}/batches`)).body.batches.map((b) => b.batch)).toEqual(['R2']);
    // Released: sold again
    expect((await ph('post', '/batches/release', { medicineId: m.id, batch: 'R1', reason: 'x' })).status).toBe(400);
    ok(await ph('post', '/batches/release', { medicineId: m.id, batch: 'R1', reason: 'The recall names another batch' }));
    expect(ok(await walkIn(m, 1), 201).invoice.lines[0].batch).toBe('R1');
    const actions = (await AuditLog.find({ action: /PHARMACY_BATCH_/ }).sort({ _id: 1 }).lean()).map((e) => e.action);
    expect(actions).toEqual(['PHARMACY_BATCH_HELD', 'PHARMACY_BATCH_RELEASED']);
  });

  it('who received it: sales and issues net of returns, with what the pharmacist already sees; a return comes back onto the hold', async () => {
    const m = await medicine({ name: 'Sample Recipients Tab', generic: 'Sample' });
    await buy(m, 'W1', '2027-06');
    const p = await register('Sample Recall Mother');
    const toHer = ok(await ph('post', '/invoices', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 6 }] }), 201).invoice;
    ok(await walkIn(m, 2), 201);
    ok(await ph('post', '/batches/hold', { medicineId: m.id, batch: 'W1', reason: 'quality', note: '' }));
    // She brings 2 back: they return onto the held batch – never into saleable stock
    ok(await ph('post', `/invoices/${toHer.id}/returns`, { items: [{ lineId: toHer.lines[0].id, qty: 2 }], reason: 'Recalled' }));
    const [w1] = await batchOf(m, 'W1');
    expect(w1).toMatchObject({ qtyLeft: 14, hold: { reason: 'quality' } });
    expect((await walkIn(m, 1)).status).toBe(409); // nothing usable
    const list = ok(await ph('get', `/batches/recipients?medicineId=${m.id}&batch=W1`));
    expect(list).toMatchObject({ batch: 'W1', inStock: 14, hold: { reason: 'quality' }, medicine: { name: 'Sample Recipients Tab' } });
    expect(list.recipients.map((r) => [r.qty, r.patient?.mrn ?? null, r.customer])).toEqual([
      [4, p.mrn, ''],
      [2, null, 'Sample Walk In'],
    ]);
    expect(list.recipients[0].patient).toMatchObject({ fullName: 'Sample Recall Mother', closed: false });
    expect((await ph('get', `/batches/recipients?medicineId=${m.id}&batch=W1`, undefined, 'admin')).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: 'PHARMACY_BATCH_RECIPIENTS_VIEWED' })).toBe(1);
  });

  it("another hospital's batch with the same number is untouched", async () => {
    const m = await medicine({ name: 'Sample Shared Number Tab' });
    await buy(m, 'S1', '2027-06');
    const other = await createTenant('Other Pharmacy Hospital');
    const { StockBatch } = await import('../src/models/Pharmacy.js');
    await StockBatch.collection.insertOne({ tenantId: other._id, medicineId: new mongoose.Types.ObjectId(m.id), batch: 'S1', expiry: new Date('2027-06-30'), mrpPaise: 500, costPaise: 300, qtyIn: 5, qtyLeft: 5, hold: null });
    ok(await ph('post', '/batches/hold', { medicineId: m.id, batch: 'S1', reason: 'recalled' }));
    expect((await StockBatch.collection.findOne({ tenantId: other._id })).hold).toBeNull();
  });
});

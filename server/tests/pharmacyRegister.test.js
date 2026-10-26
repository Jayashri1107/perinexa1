// The pharmacy's daily register (owner, 26 Oct 2026): the day's OPD, IPD and External patients only, finding someone
// from another day by her exact number or phone (audited), one supplier's bills – and no whole patient list for a
// pharmacist.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
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
  hospital = await createTenant('Register Hospital');
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
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);

async function register(name, phone) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString(), ...(phone ? { phone } : {}) }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const arrive = async (p) => expect((await (await as('reception')).post('/api/arrivals').send({ patientId: p.id })).status).toBe(201);
async function prescribe(p) {
  const v = (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
  const res = await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 0, items: [{ drug: 'Folic acid', strength: '5 mg', form: 'tab', dose: '1', frequency: '1-0-0', durationValue: 10, durationUnit: 'days' }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
async function inStock() {
  const m = (await ph('post', '/medicines', { name: 'Folvite 5', generic: 'Folic acid', strength: '5 mg', form: 'tablet', unit: 'tablet', gstRate: 5 })).body.medicine;
  const sup = (await ph('post', '/suppliers', { name: 'Sample Distributors' })).body.supplier;
  const bought = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'INV-1', invoiceDate: '2026-09-27', lines: [{ medicineId: m.id, batch: 'B1', expiry: '2027-12', qty: 100, ratePaise: 100, mrpPaise: 200 }] });
  expect(bought.status, JSON.stringify(bought.body)).toBe(201);
  return { m, sup };
}

describe('the daily register', () => {
  it('lists the day’s OPD, IPD and External patients with what the pharmacy has done – nobody else', async () => {
    const { m } = await inStock();
    const arrived = await register('Arrived Mother');
    const written = await register('Prescribed Mother');
    const admitted = await register('Admitted Mother');
    await register('Not Today Mother');
    await arrive(arrived);
    await prescribe(written);
    await (await as('drA')).post(`/api/patients/${admitted.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour room', bed: '4', reason: 'In labour' });
    expect((await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Walk In', phone: '9876500011' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 2 }] })).status).toBe(201);

    let reg = (await ph('get', '/register')).body;
    expect(reg).toMatchObject({ date: '2026-09-28', today: '2026-09-28', counts: { opd: 2, ipd: 1, external: 1 } });
    const row = (name) => reg.rows.find((r) => (r.patient?.fullName ?? r.customer?.name) === name);
    expect(row('Arrived Mother')).toMatchObject({ type: 'opd', prescription: false, status: 'no_rx', doctor: 'Sample drA' });
    expect(row('Prescribed Mother')).toMatchObject({ type: 'opd', prescription: true, status: 'rx_waiting' });
    expect(row('Admitted Mother')).toMatchObject({ type: 'ipd', ward: 'Labour room', bed: '4', status: 'not_issued' });
    expect(row('Walk In')).toMatchObject({ type: 'external', customer: { phone: '9876500011' }, status: 'billed', bills: [{ netPaise: 400 }] });
    expect(row('Not Today Mother')).toBeUndefined();
    // nothing medical in a row
    expect(JSON.stringify(reg.rows)).not.toMatch(/Folic|labour\b|In labour/);

    // Billed and issued: the status follows
    await ph('post', '/invoices', { kind: 'sale', patientId: written.id, lines: [{ medicineId: m.id, qty: 10 }] });
    await ph('post', '/invoices', { kind: 'issue', patientId: admitted.id, lines: [{ medicineId: m.id, qty: 2 }] });
    reg = (await ph('get', '/register')).body;
    expect(row('Prescribed Mother')).toMatchObject({ status: 'billed', bills: [{ number: expect.stringMatching(/^PH-/) }] });
    expect(row('Admitted Mother')).toMatchObject({ status: 'issued' });

    // The next day: yesterday's OPD and walk-ins are gone; the admitted patient stays
    later('2026-09-29T06:00:00Z');
    reg = (await ph('get', '/register')).body;
    expect(reg.counts).toEqual({ opd: 0, ipd: 1, external: 0 });
    // an earlier day can still be opened; a later one cannot
    expect((await ph('get', '/register?date=2026-09-28')).body.counts).toEqual({ opd: 2, ipd: 1, external: 1 });
    expect((await ph('get', '/register?date=2026-09-30')).status).toBe(400);
  });

  it('is for the pharmacist only', async () => {
    for (const who of ['admin', 'reception', 'drA']) expect((await ph('get', '/register', undefined, who)).status).toBe(403);
  });
});

describe('finding someone from another day', () => {
  it('by her exact patient number or her phone, in the audit log; a part of a name finds nothing', async () => {
    const { m } = await inStock();
    const p = await register('Old Card Mother', '9822012345');
    await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Earlier Walk In', phone: '+91 98220 12345' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 1 }] });

    const byNumber = (await ph('get', `/register/find?q=${encodeURIComponent(p.mrn.toLowerCase())}`)).body;
    expect(byNumber.patients).toEqual([{ id: p.id, fullName: 'Old Card Mother', mrn: p.mrn, phone: '9822012345', admitted: false }]);
    const byPhone = (await ph('get', '/register/find?q=098220%2012345')).body;
    expect(byPhone.patients.map((x) => x.id)).toEqual([p.id]);
    expect(byPhone.external).toMatchObject([{ customer: { name: 'Earlier Walk In' }, date: '2026-09-28' }]);
    expect((await ph('get', '/register/find?q=Old%20Card')).body.patients).toEqual([]);
    expect((await ph('get', '/register/find?q=ab')).status).toBe(400);

    const logged = await AuditLog.find({ action: 'PHARMACY_PATIENT_LOOKED_UP' }).sort({ _id: 1 }).lean();
    expect(logged.map((l) => l.details.by)).toEqual(['number', 'phone', 'number']);
    expect(logged[1].details).toMatchObject({ patientIds: [p.id], walkInBills: 1 });
    expect(JSON.stringify(logged)).not.toMatch(/98220/);
  });

  it('a pharmacist has no whole patient list; one who also works at reception keeps it', async () => {
    await register('Listed Mother');
    expect((await (await as('pharm')).get('/api/patients')).status).toBe(403);
    expect((await (await as('pharm')).get('/api/patients?search=Listed')).status).toBe(403);
    await Membership.updateOne({ userId: people.pharm._id, tenantId: hospital._id }, { $set: { roles: ['pharmacist', 'receptionist'] } });
    sessions = {};
    expect((await (await as('pharm')).get('/api/patients')).status).toBe(200);
  });
});

describe('a supplier’s bills', () => {
  it('lists only that supplier’s purchases', async () => {
    const { m, sup } = await inStock();
    const other = (await ph('post', '/suppliers', { name: 'Other Distributors' })).body.supplier;
    await ph('post', '/purchases', { supplierId: other.id, invoiceNo: 'OTH-9', invoiceDate: '2026-09-27', lines: [{ medicineId: m.id, batch: 'B2', expiry: '2027-12', qty: 5, ratePaise: 100, mrpPaise: 200 }] });
    expect((await ph('get', `/purchases?supplierId=${sup.id}`)).body.purchases.map((p) => p.invoiceNo)).toEqual(['INV-1']);
    expect((await ph('get', '/purchases')).body.purchases).toHaveLength(2);
  });
  it('never enters the same supplier invoice twice (its stock would come in twice); another supplier may use the number', async () => {
    const { m, sup } = await inStock();
    const line = { medicineId: m.id, batch: 'B9', expiry: '2027-12', qty: 5, ratePaise: 100, mrpPaise: 200 };
    const again = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'inv-1', invoiceDate: '2026-09-27', lines: [line] });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/INV-1 is already entered|inv-1 is already entered/);
    const other = (await ph('post', '/suppliers', { name: 'Other Distributors' })).body.supplier;
    expect((await ph('post', '/purchases', { supplierId: other.id, invoiceNo: 'INV-1', invoiceDate: '2026-09-27', lines: [line] })).status).toBe(201);
    // once cancelled, it can be entered again
    const first = (await ph('get', `/purchases?supplierId=${sup.id}`)).body.purchases[0];
    expect((await ph('post', `/purchases/${first.id}/cancel`, { reason: 'Entered wrongly' })).status).toBe(200);
    expect((await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'INV-1', invoiceDate: '2026-09-27', lines: [line] })).status).toBe(201);
  });
});

describe('the purchase bill (GRN) as in the earlier software', () => {
  it('takes packs, discounts, GST and charges; works out the net to pay; the stock gets units of sale', async () => {
    const { m, sup } = await inStock();
    const res = await ph('post', '/purchases', {
      supplierId: sup.id,
      invoiceNo: 'GRN-7',
      invoiceDate: '2026-09-27',
      // 2 strips of 10 (+ 1 free), ₹30 a strip, MRP ₹45 a strip, 10 % off, GST 5 %
      lines: [{ medicineId: m.id, batch: 'S1', expiry: '2028-01', conv: 10, qty: 2, freeQty: 1, ratePaise: 3000, mrpPaise: 4500, discPercent: 10, gstRate: 5 }],
      grn: { gateEntryNo: 'G-12', taxType: 'igst', payment: 'cash', receivedBy: 'Sample Store', remark: 'Sample', schemeDiscPaise: 500, discPercent: 2, otherChargesPaise: 1000, freightPaise: 500 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = res.body.purchase;
    // total 60.00 − (item 6.00 + scheme 5.00 + 2 % of 54.00 = 1.08) + (10.00 + 5.00) + GST 2.70 = 65.62 → 66.00
    expect(p.grn).toMatchObject({ gateEntryNo: 'G-12', taxType: 'igst', payment: 'cash', receivedBy: 'Sample Store', totalPaise: 6000, itemDiscPaise: 600, discPaise: 108, lessPaise: 1208, addPaise: 1500, gstPaise: 270, igstPaise: 270, cgstPaise: 0, roundingPaise: 38, netPaise: 6600 });
    expect(p.lines[0]).toMatchObject({ qty: 20, freeQty: 10, ratePaise: 300, mrpPaise: 450, gstRate: 5, pack: { conv: 10, qty: 2, freeQty: 1, ratePaise: 3000, mrpPaise: 4500, totalPaise: 6000, gstPaise: 270 } });
    const batches = (await ph('get', `/medicines/${m.id}/batches`)).body.batches;
    expect(batches.find((b) => b.batch === 'S1')).toMatchObject({ qtyLeft: 30, mrpPaise: 450 });
  });
  it('splits GST into CGST and SGST, and refuses discounts bigger than the bill', async () => {
    const { m, sup } = await inStock();
    const line = { medicineId: m.id, batch: 'S2', expiry: '2028-01', qty: 3, ratePaise: 333, mrpPaise: 500 };
    const same = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'GRN-8', invoiceDate: '2026-09-27', lines: [line], grn: {} });
    // 9.99 + GST 5 % (the medicine's) 0.50 → CGST 0.25 + SGST 0.25, net 10.00
    expect(same.body.purchase.grn).toMatchObject({ taxType: 'cgst_sgst', payment: 'credit', gstPaise: 50, cgstPaise: 25, sgstPaise: 25, netPaise: 1000 });
    const tooMuch = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'GRN-9', invoiceDate: '2026-09-27', lines: [line], grn: { crnAdjPaise: 5000 } });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/discounts are more than the bill/);
  });
});

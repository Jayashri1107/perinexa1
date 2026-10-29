// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md): the Pharmacist role, medicines, suppliers, purchases and
// batches, counter sales from prescriptions (first-to-expire, GST invoice, the patient's bill), walk-ins, issues to
// admitted patients, Schedule H/H1/X and narcotic rules and registers, returns with credit notes, write-offs, counts,
// alerts, reports and the export.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineMoney, suggestedQty } from '../src/pharmacy/gst.js';
import { fixOldGstRates } from '../src/pharmacy/gstRateFix.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Medicine } from '../src/models/Pharmacy.js';
import { User } from '../src/models/User.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };

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
  hospital = await createTenant('Pharmacy Hospital');
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
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);

async function register(name) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function medicine(fields) {
  const res = await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.medicine;
}
async function supplier() {
  return (await ph('post', '/suppliers', { name: 'Sample Distributors', gstin: '27ABCDE1234F1Z5' })).body.supplier;
}
async function purchase(sup, lines) {
  const res = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-09-27', lines });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.purchase;
}
const sell = (body, who = 'pharm') => ph('post', '/invoices', { kind: 'sale', ...body }, who);
async function prescribe(p, items) {
  const v = (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
  const res = await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 0, items });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return v;
}

describe('GST and quantities', () => {
  it('works the taxable value back from the MRP and splits CGST and SGST', () => {
    expect(lineMoney({ qty: 10, mrpPaise: 1120, gstRate: 12 })).toEqual({ grossPaise: 11200, amountPaise: 11200, taxablePaise: 10000, gstPaise: 1200, cgstPaise: 600, sgstPaise: 600 });
    expect(lineMoney({ qty: 1, mrpPaise: 10500, gstRate: 5, discountPercent: 10 })).toMatchObject({ amountPaise: 9450, taxablePaise: 9000, cgstPaise: 225, sgstPaise: 225 });
  });
  it('suggests how many to sell from the prescription, for medicines sold by the piece', () => {
    expect(suggestedQty({ form: 'tab', dose: '1', frequency: '1-0-1', durationValue: 5, durationUnit: 'days' })).toBe(10);
    expect(suggestedQty({ form: 'tab', dose: '½', frequency: '1-1-1', durationValue: 1, durationUnit: 'weeks' })).toBe(11);
    expect(suggestedQty({ form: 'syrup', dose: '10 ml', frequency: '1-0-1', durationValue: 5, durationUnit: 'days' })).toBeNull();
    expect(suggestedQty({ form: 'tab', frequency: 'sos', durationValue: 5, durationUnit: 'days' })).toBeNull();
  });
});

describe('the pharmacist and who may do what', () => {
  it('pharmacists see a patient’s name, number and phone – no medical details; clinical staff have no pharmacy', async () => {
    const p = await register('Privacy Mother');
    const seen = (await (await as('pharm')).get(`/api/patients/${p.id}`)).body.patient;
    expect(seen).toMatchObject({ fullName: 'Privacy Mother', mrn: p.mrn, phone: expect.any(String) });
    expect(seen.pregnancy).toBeUndefined();
    expect(seen.medical).toBeUndefined();
    for (const who of ['drA', 'nurse', 'reception']) expect((await ph('get', '/stock', undefined, who)).status).toBe(403);
    expect((await ph('get', '/stock', undefined, 'admin')).status).toBe(200);
    const m = await medicine({ name: 'Admin Tab' });
    expect((await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 1 }] }, 'admin')).status).toBe(403);
    expect((await ph('post', '/medicines', { name: 'By Admin', form: 'tablet', unit: 'tablet', gstRate: 5 }, 'admin')).status).toBe(201);
  });
});

describe('GST rates since 22 September 2025', () => {
  it('offers 0, 5 and 18 %; a new medicine starts at 5 %; 12 % is refused', async () => {
    expect((await ph('get', '/settings')).body.lists.gstRates).toEqual([0, 5, 18]);
    const res = await ph('post', '/medicines', { name: 'No Rate Tab', form: 'tablet', unit: 'tablet' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const twelve = await ph('post', '/medicines', { name: 'Old Rate Tab', form: 'tablet', unit: 'tablet', gstRate: 12 });
    expect(twelve.status).toBe(400);
    expect(twelve.body.error.fields.gstRate).toMatch(/0, 5, 18 % since 22 September 2025/);
    expect((await Medicine.create({ tenantId: hospital._id, name: 'Default Tab' })).gstRate).toBe(5);
  });
  it('npm run fix:gst-rates moves medicines still on 12 % to 5 %, in the audit log; sold invoices keep their rate', async () => {
    const old = await medicine({ name: 'Saved Before Tab' });
    const kept = await medicine({ name: 'Cosmetic Cream', gstRate: 18 });
    await Medicine.collection.updateOne({ _id: Medicine.castObject({ _id: old.id })._id }, { $set: { gstRate: 12 } });
    // a medicine still on 12 % can be changed without its rate (it is not refused for the old rate)
    expect((await ph('patch', `/medicines/${old.id}`, { reorderLevel: 5 })).status).toBe(200);
    expect(await fixOldGstRates()).toEqual([{ hospital: 'Pharmacy Hospital', medicines: ['Saved Before Tab'] }]);
    expect((await Medicine.findOne({ tenantId: hospital._id, _id: old.id }).lean()).gstRate).toBe(5);
    expect((await Medicine.findOne({ tenantId: hospital._id, _id: kept.id }).lean()).gstRate).toBe(18);
    expect((await AuditLog.findOne({ action: 'PHARMACY_MEDICINE_CHANGED', 'details.by': 'fix:gst-rates' }).lean()).details).toMatchObject({ medicineId: old.id, from: 12, to: 5 });
    expect(await fixOldGstRates()).toEqual([]);
  });
});

describe('purchases and batches', () => {
  it('adds stock batch by batch; refuses expired batches; cancels only while no stock has left', async () => {
    const sup = await supplier();
    const m = await medicine({ name: 'Ferrous Tab', generic: 'Ferrous ascorbate', reorderLevel: 20 });
    const bad = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'X1', invoiceDate: '2026-09-27', lines: [{ medicineId: m.id, batch: 'OLD', expiry: '2026-08', qty: 10, ratePaise: 500, mrpPaise: 1000 }] });
    expect(bad.status).toBe(400);
    const pu = await purchase(sup, [{ medicineId: m.id, batch: 'B1', expiry: '2027-03', qty: 100, freeQty: 10, ratePaise: 500, mrpPaise: 1000 }]);
    expect(pu).toMatchObject({ number: 'PU-000001', totalPaise: 50000 });
    let stock = (await ph('get', '/stock')).body.medicines.find((x) => x.id === m.id);
    expect(stock).toMatchObject({ qty: 110, low: false, mrpValuePaise: 110000 });
    const one = await purchase(sup, [{ medicineId: m.id, batch: 'B2', expiry: '2027-06', qty: 10, ratePaise: 500, mrpPaise: 1000 }]);
    expect((await ph('post', `/purchases/${one.id}/cancel`, { reason: 'Entered twice' })).body.purchase.status).toBe('cancelled');
    await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 1 }] });
    expect((await ph('post', `/purchases/${pu.id}/cancel`, { reason: 'Wrong' })).body.error.code).toBe('USED');
    stock = (await ph('get', '/stock')).body.medicines.find((x) => x.id === m.id);
    expect(stock.qty).toBe(109);
  });
  it('the stock sheet: one line per batch with stock, by name then expiry, with values and totals; expired ones marked', async () => {
    const sup = await supplier();
    const zinc = await medicine({ name: 'zinc Syrup' });
    const amox = await medicine({ name: 'Amox Cap' });
    await purchase(sup, [
      { medicineId: zinc.id, batch: 'Z1', expiry: '2027-01', qty: 4, ratePaise: 600, mrpPaise: 1000 },
      { medicineId: amox.id, batch: 'A2', expiry: '2028-05', qty: 3, ratePaise: 200, mrpPaise: 500 },
      { medicineId: amox.id, batch: 'A1', expiry: '2026-11', qty: 10, freeQty: 0, ratePaise: 300, mrpPaise: 450 },
    ]);
    const empty = await medicine({ name: 'Bare Tab' });
    await purchase(sup, [{ medicineId: empty.id, batch: 'E1', expiry: '2027-02', qty: 1, ratePaise: 100, mrpPaise: 200 }]);
    await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: empty.id, qty: 1 }] });
    later('2026-12-02T06:00:00Z'); // batch A1 has expired, still on the shelf
    const res = await ph('get', '/stock-sheet');
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([
      { name: 'Amox Cap', batch: 'A1', expiry: '2026-11-30', expired: true, qty: 10, mrpValuePaise: 4500, costValuePaise: 3000 },
      { name: 'Amox Cap', batch: 'A2', expiry: '2028-05-31', expired: false, qty: 3, mrpValuePaise: 1500, costValuePaise: 600 },
      { name: 'zinc Syrup', batch: 'Z1', expiry: '2027-01-31', expired: false, qty: 4, mrpValuePaise: 4000, costValuePaise: 2400 },
    ]);
    expect(res.body.totals).toEqual({ mrpValuePaise: 10000, costValuePaise: 6000 });
    expect(res.body.settings.name).toBeTruthy();
    for (const who of ['drA', 'nurse', 'reception']) expect((await ph('get', '/stock-sheet', undefined, who)).status).toBe(403);
    expect((await ph('get', '/stock-sheet', undefined, 'admin')).status).toBe(200);
  });
});

describe('selling at the counter', () => {
  it('sells from her prescription: the doctor comes with it, first-to-expire batches, GST invoice, on her bill', async () => {
    const sup = await supplier();
    const folic = await medicine({ name: 'Folvite 5', generic: 'Folic acid', strength: '5 mg', hsn: '3004', gstRate: 5 });
    await purchase(sup, [
      { medicineId: folic.id, batch: 'LATE', expiry: '2028-01', qty: 50, ratePaise: 100, mrpPaise: 210 },
      { medicineId: folic.id, batch: 'SOON', expiry: '2027-01', qty: 4, ratePaise: 100, mrpPaise: 210 },
    ]);
    const p = await register('Counter Mother');
    const v = await prescribe(p, [{ drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', durationValue: 10, durationUnit: 'days' }]);
    const rx = (await ph('get', `/patients/${p.id}/prescriptions`)).body.prescriptions[0];
    expect(rx).toMatchObject({ visitId: v.id, doctor: { name: 'Sample drA', reg: 'MMC-12345' } });
    expect(rx.items[0]).toMatchObject({ drug: 'Folic acid', suggestedQty: 10, matches: [expect.objectContaining({ id: folic.id, inStock: 54 })] });
    expect(JSON.stringify(rx)).not.toMatch(/diagnosis|complaints/);

    const res = await sell({ patientId: p.id, visitId: v.id, lines: [{ medicineId: folic.id, qty: 10 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.invoice;
    expect(inv).toMatchObject({ number: 'PH-000001', doctor: { name: 'Sample drA', reg: 'MMC-12345' }, fromPrescription: true, netPaise: 2100, balancePaise: null });
    expect(inv.lines.map((l) => [l.batch, l.qty])).toEqual([
      ['SOON', 4],
      ['LATE', 6],
    ]);
    expect(inv.lines[0]).toMatchObject({ hsn: '3004', gstRate: 5, amountPaise: 840, taxablePaise: 800, cgstPaise: 20, sgstPaise: 20 });
    const bills = (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
    const bill = (await (await as('reception')).get(`/api/billing/bills/${bills[0].id}`)).body.bill;
    expect(bill.lines.find((l) => l.group === 'medicine')).toMatchObject({ name: 'Pharmacy – invoice PH-000001', amountPaise: 2100 });
    expect(await AuditLog.countDocuments({ action: 'PHARMACY_PRESCRIPTIONS_VIEWED' })).toBe(1);
  });

  it('never sells an expired batch, nor more than is in stock', async () => {
    const sup = await supplier();
    const m = await medicine({ name: 'Short Tab' });
    await purchase(sup, [{ medicineId: m.id, batch: 'E1', expiry: '2026-10', qty: 5, ratePaise: 100, mrpPaise: 200 }]);
    expect((await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 6 }] })).body.error.code).toBe('OUT_OF_STOCK');
    later('2026-11-02T06:00:00Z');
    expect((await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 1 }] })).body.error.message).toMatch(/only 0 in stock/);
    const alerts = (await ph('get', '/reports/alerts')).body;
    expect(alerts.expiring).toEqual([expect.objectContaining({ batch: 'E1', expired: true, qtyLeft: 5 })]);
    expect(alerts.low.map((x) => x.name)).toEqual(['Short Tab']);
  });

  it('a walk-in pays at the counter; Schedule H needs a prescription seen; a discount needs a reason', async () => {
    const sup = await supplier();
    const h = await medicine({ name: 'Antibio Cap', form: 'capsule', unit: 'capsule', schedule: 'H', gstRate: 5 });
    await purchase(sup, [{ medicineId: h.id, batch: 'H1B', expiry: '2027-12', qty: 30, ratePaise: 500, mrpPaise: 1120 }]);
    const base = { customer: { name: 'Walk In Customer', phone: '90000 00000' }, lines: [{ medicineId: h.id, qty: 10 }] };
    expect((await sell(base)).status).toBe(400); // no payment
    expect((await sell({ ...base, payment: { mode: 'cash' } })).body.error.message).toMatch(/needs a prescription/);
    expect((await sell({ ...base, payment: { mode: 'cash' }, rxSeen: true, doctor: { name: 'Dr. Outside' }, discountPercent: 10 })).status).toBe(400); // no reason
    const ok = await sell({ ...base, payment: { mode: 'upi', reference: 'U1' }, rxSeen: true, doctor: { name: 'Dr. Outside' }, discountPercent: 10, discountReason: 'Senior citizen' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invoice).toMatchObject({ netPaise: 10080, paidPaise: 10080, balancePaise: 0, customer: { name: 'Walk In Customer' } });

    // A return of unopened medicines: stock back, a credit note, the money back at the counter
    const inv = ok.body.invoice;
    expect((await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 4 }], reason: 'Not needed' })).status).toBe(400); // how is the money given back
    const back = await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 4 }], reason: 'Not needed', refund: { mode: 'cash' } });
    expect(back.body).toMatchObject({ creditNote: 'CN-000001', invoice: { returnedPaise: 4032, netPaise: 6048, paidPaise: 6048 } });
    expect((await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 7 }], reason: 'Too many', refund: { mode: 'cash' } })).status).toBe(400);
    expect((await ph('get', '/stock')).body.medicines.find((x) => x.id === h.id).qty).toBe(24);
  });
});

describe('narcotic and Schedule X medicines', () => {
  it('only for registered patients, with the doctor’s registration number; their register keeps the balance; counts need a witness', async () => {
    const sup = await supplier();
    const n = await medicine({ name: 'Pethidine 50 mg/ml', form: 'injection', unit: 'ampoule', schedule: 'narcotic', gstRate: 5 });
    await purchase(sup, [{ medicineId: n.id, batch: 'N1', expiry: '2027-06', qty: 10, ratePaise: 2000, mrpPaise: 3000 }]);
    const p = await register('Narcotic Mother');
    expect((await sell({ customer: { name: 'Walk In' }, payment: { mode: 'cash' }, rxSeen: true, doctor: { name: 'Dr. X', reg: 'R1' }, lines: [{ medicineId: n.id, qty: 1 }] })).body.error.message).toMatch(/only to a registered patient/);
    expect((await sell({ patientId: p.id, rxSeen: true, doctor: { name: 'Dr. Outside' }, lines: [{ medicineId: n.id, qty: 1 }] })).body.error.message).toMatch(/registration number/);
    const v = await prescribe(p, [{ drug: 'Pethidine', form: 'inj', dose: '1', frequency: 'stat' }]);
    expect((await sell({ patientId: p.id, visitId: v.id, lines: [{ medicineId: n.id, qty: 2 }] })).status).toBe(201);

    const batch = (await ph('get', `/stock/${n.id}`)).body.batches[0];
    expect((await ph('post', `/batches/${batch.id}/count`, { counted: 7, reason: 'Ampoule broken' })).status).toBe(400);
    expect((await ph('post', `/batches/${batch.id}/count`, { counted: 7, reason: 'Ampoule broken', witness: 'Sister Sample' })).status).toBe(200);

    const reg = (await ph('get', '/reports/register?type=narcotic&from=2026-09-01&to=2026-09-30')).body;
    expect(reg.pages).toHaveLength(1);
    expect(reg.pages[0]).toMatchObject({ opening: 0, closing: 7 });
    expect(reg.pages[0].rows.map((r) => [r.kind, r.in, r.out, r.balance])).toEqual([
      ['purchase', 10, 0, 10],
      ['sale', 0, 2, 8],
      ['count', 0, 1, 7],
    ]);
    expect(reg.pages[0].rows[1]).toMatchObject({ patient: `Narcotic Mother (${p.mrn})`, doctor: 'Sample drA, Reg. MMC-12345' });
    expect(reg.pages[0].rows[2]).toMatchObject({ witness: 'Sister Sample', reason: 'Ampoule broken' });
  });
});

describe('issuing to admitted patients', () => {
  it('only to an admitted patient; a GST invoice on her stay bill; a return lowers the bill', async () => {
    const sup = await supplier();
    const m = await medicine({ name: 'Oxytocin 5 IU', form: 'injection', unit: 'ampoule', gstRate: 5, hsn: '3004' });
    await purchase(sup, [{ medicineId: m.id, batch: 'OX1', expiry: '2027-06', qty: 20, ratePaise: 1000, mrpPaise: 2100 }]);
    const p = await register('Ward Mother');
    expect((await ph('post', '/invoices', { kind: 'issue', patientId: p.id, lines: [{ medicineId: m.id, qty: 2 }] })).body.error.message).toMatch(/not admitted/);
    await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour room', reason: 'In labour' });
    expect((await ph('get', '/inpatients')).body.inpatients.map((x) => x.patient.fullName)).toEqual(['Ward Mother']);
    const res = await ph('post', '/invoices', { kind: 'issue', patientId: p.id, lines: [{ medicineId: m.id, qty: 4 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.invoice;
    expect(inv).toMatchObject({ kind: 'issue', netPaise: 8400, taxablePaise: 8000, cgstPaise: 200, sgstPaise: 200 });
    const [stayBill] = (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
    expect(stayBill.kind).toBe('ipd');
    await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 1 }], reason: 'Not used' });
    const bill = (await (await as('reception')).get(`/api/billing/bills/${stayBill.id}`)).body.bill;
    expect(bill.lines.find((l) => l.group === 'medicine')).toMatchObject({ amountPaise: 6300 });
  });
});

describe('reports and the export', () => {
  it('sales and GST by rate after returns, purchases by supplier, the H1 register, the export (admin only)', async () => {
    const sup = await supplier();
    const a = await medicine({ name: 'Rate Five', gstRate: 5 });
    const b = await medicine({ name: 'Rate Eighteen H1', gstRate: 18, schedule: 'H1' });
    await purchase(sup, [
      { medicineId: a.id, batch: 'A', expiry: '2027-12', qty: 50, ratePaise: 50, mrpPaise: 105 },
      { medicineId: b.id, batch: 'B', expiry: '2027-12', qty: 50, ratePaise: 50, mrpPaise: 118 },
    ]);
    const p = await register('Report Mother');
    const sale = await sell({ patientId: p.id, rxSeen: true, doctor: { name: 'Dr. Outside' }, lines: [{ medicineId: a.id, qty: 10 }, { medicineId: b.id, qty: 10 }] });
    await ph('post', `/invoices/${sale.body.invoice.id}/returns`, { items: [{ lineId: sale.body.invoice.lines[1].id, qty: 5 }], reason: 'Not opened' });
    const sales = (await ph('get', '/reports/sales?from=2026-09-01&to=2026-09-30')).body;
    expect(sales.gst).toEqual([
      { rate: 5, taxablePaise: 1000, cgstPaise: 25, sgstPaise: 25, amountPaise: 1050 },
      { rate: 18, taxablePaise: 500, cgstPaise: 45, sgstPaise: 45, amountPaise: 590 },
    ]);
    expect(sales.byDay).toEqual([{ date: '2026-09-28', salePaise: 2230, issuePaise: 0, returnedPaise: 590, invoices: 1 }]);
    // (since 4 Oct 2026 also what went back to each supplier – tests/pharmacyExtras.test.js)
    expect((await ph('get', '/reports/purchases?from=2026-09-01&to=2026-09-30')).body.bySupplier).toEqual([{ supplier: 'Sample Distributors', invoices: 1, totalPaise: 5000, returns: 0, returnedPaise: 0, netPaise: 5000 }]);
    const h1 = (await ph('get', '/reports/register?type=H1&from=2026-09-01&to=2026-09-30')).body;
    expect(h1.pages.map((x) => [x.medicine.name, x.rows.map((r) => [r.kind, r.out, r.in])])).toEqual([['Rate Eighteen H1', [['sale', 10, 0], ['return', 0, 5]]]]);
    expect((await ph('get', '/export?from=2026-09-01&to=2026-09-30&what=sales')).status).toBe(403);
    const csv = await ph('get', '/export?from=2026-09-01&to=2026-09-30&what=sales', undefined, 'admin');
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(csv.text).toContain('Report Mother');
  });
});

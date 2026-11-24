// Pharmacy → Settlement (24 Nov 2026, after the earlier software's Pharmacy Settlement window): a patient found by
// UHID or name, her Paid and Credit bills, and the credit bills chosen settled in full with advance, a discount
// (a concession – not money received) and money received; then the Sales collection as the Pharmacy Daily Collection,
// and the Sales bill's list for a period. Sample data only.
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { PharmacyInvoice } from '../src/models/Pharmacy.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const DAY = '2026-09-28';

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
  const hospital = await createTenant('Settlement Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries({ pharm: 'pharmacist', reception: 'receptionist', drA: 'doctor', admin: 'admin' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);

async function inStock() {
  const m = (await ph('post', '/medicines', { name: 'Folvite 5', generic: 'Folic acid', strength: '5 mg', form: 'tablet', unit: 'tablet', gstRate: 5 })).body.medicine;
  const sup = (await ph('post', '/suppliers', { name: 'Sample Distributors' })).body.supplier;
  const bought = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'INV-9', invoiceDate: '2026-09-27', lines: [{ medicineId: m.id, batch: 'B1', expiry: '2028-06', qty: 50, ratePaise: 100, mrpPaise: 200 }] });
  expect(bought.status, JSON.stringify(bought.body)).toBe(201);
  return m;
}
const newPatient = async (fullName) => (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName, assignedDoctor: people.drA._id.toString() }))).body.patient;

// A patient with an advance of ₹3, two credit bills (₹6 and ₹4) and one paid bill (₹2)
async function patientWithCredit() {
  const m = await inStock();
  const p = await newPatient('Sample Settlement Mother');
  expect((await ph('post', `/patients/${p.id}/advance`, { amountPaise: 300, mode: 'cash' })).status).toBe(201);
  const credit = { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07' };
  const a = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice; // 600
  const b = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 2 }] })).body.invoice; // 400
  const c = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, payments: [{ mode: 'cash', amountPaise: 200 }], lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice; // paid
  return { m, p, a, b, c };
}

describe('Settlement', () => {
  it('finds the patient by UHID or name, with what she owes; External lists walk-in bills only', async () => {
    const { p } = await patientWithCredit();
    const byMrn = await ph('get', `/settlement?type=opd&search=${encodeURIComponent(p.mrn)}`);
    expect(byMrn.status, JSON.stringify(byMrn.body)).toBe(200);
    expect(byMrn.body.patients).toEqual([expect.objectContaining({ id: p.id, mrn: p.mrn, type: 'opd', billCount: 3, creditPaise: 1000 })]);
    // IP is "admitted now": not her by name – but a UHID typed in full finds her whatever is chosen
    expect((await ph('get', '/settlement?type=ipd&search=Settlement')).body.patients).toEqual([]);
    expect((await ph('get', `/settlement?type=ipd&search=${encodeURIComponent(p.mrn)}`)).body.patients.map((x) => x.id)).toEqual([p.id]);
    expect((await ph('get', '/settlement?type=opd&search=S')).body.patients).toEqual([]); // two letters at least
    // Nothing typed (24 Nov 2026): today's OP bills, every patient's, with what each owes and her advance
    const today = (await ph('get', '/settlement?type=opd')).body;
    expect(today).toMatchObject({ list: true, day: DAY, totalCreditPaise: 1000 });
    expect(today.creditBills.map((x) => [x.patientId, x.balancePaise])).toEqual([[p.id, 400], [p.id, 600]]);
    expect(today.paidBills).toHaveLength(1);
    expect(today.patients).toEqual([expect.objectContaining({ id: p.id, mrn: p.mrn, type: 'opd', billCount: 3, creditPaise: 1000, advancePaise: 300 })]);
    expect((await ph('get', '/settlement?type=ipd')).body).toMatchObject({ list: true, creditBills: [], paidBills: [], patients: [] }); // nobody admitted
    expect((await ph('get', '/settlement?type=opd&from=2026-09-01&to=2026-09-01')).body.creditBills).toEqual([]); // another day
    expect((await ph('get', '/settlement?type=external')).body.externalBills).toEqual([]);
    // The counter's, not the reception's or the admin's
    expect((await ph('get', `/settlement?type=opd&search=${encodeURIComponent(p.mrn)}`, undefined, 'reception')).status).toBe(403);
    expect((await ph('get', `/settlement?patientId=${p.id}`, undefined, 'admin')).status).toBe(403);
  });

  it('settles the credit bills chosen with advance, a discount and two ways of paying – oldest bill first', async () => {
    const { p, a, b, c } = await patientWithCredit();
    const before = (await ph('get', `/settlement?patientId=${p.id}`)).body;
    expect(before.creditBills.map((x) => [x.number, x.balancePaise])).toEqual([[b.number, 400], [a.number, 600]]);
    expect(before.paidBills.map((x) => x.number)).toEqual([c.number]);
    expect(before).toMatchObject({ totalCreditPaise: 1000, advance: { balancePaise: 300 }, patient: { id: p.id, mrn: p.mrn } });

    const body = { patientId: p.id, invoiceIds: [b.id, a.id], advancePaise: 300, concessionPaise: 100, concessionReason: 'Sample reason', payments: [{ mode: 'cash', amountPaise: 400 }, { mode: 'upi', amountPaise: 200, reference: 'UPI-1' }] };
    expect((await ph('post', '/settlement', { ...body, payments: [{ mode: 'cash', amountPaise: 399 }, body.payments[1]] })).status).toBe(400); // ₹0.01 short
    expect((await ph('post', '/settlement', { ...body, concessionReason: '' })).status).toBe(400); // a discount needs a reason
    expect((await ph('post', '/settlement', { ...body, invoiceIds: [c.id] })).status).toBe(400); // nothing left on it
    expect((await ph('post', '/settlement', body, 'reception')).status).toBe(403);

    const res = await ph('post', '/settlement', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ duePaise: 1000, concessionPaise: 100, advancePaise: 300, receivedPaise: 600, creditBills: [], totalCreditPaise: 0, advance: { balancePaise: 0 } });
    expect(res.body.invoices).toEqual([
      { invoiceId: a.id, number: a.number, concessionPaise: 100, advancePaise: 300, receivedPaise: 200 },
      { invoiceId: b.id, number: b.number, concessionPaise: 0, advancePaise: 0, receivedPaise: 400 },
    ]);
    const settledA = res.body.paidBills.find((x) => x.number === a.number);
    expect(settledA).toMatchObject({ billAmountPaise: 600, concessionPaise: 100, netPayablePaise: 500, paidPaise: 500, balancePaise: 0 });
    expect((await ph('get', `/patients/${p.id}/dues`)).body.duePaise).toBe(0);
    // The bill itself: the discount is not a payment
    const shown = (await ph('get', `/invoices/${a.id}`)).body.invoice;
    expect(shown.payments.map((x) => [x.mode, x.amountPaise])).toEqual([['advance', 300], ['cash', 200]]);
    expect(shown.concessions).toEqual([expect.objectContaining({ amountPaise: 100, reason: 'Sample reason' })]);
    expect((await ph('post', '/settlement', body)).status).toBe(400); // nothing left to settle

    // The Daily Collection: settled on the day of sale, so Cash Sales; the discount in no money column
    const col = (await ph('get', `/reports/mis?report=collection&from=${DAY}&to=${DAY}`)).body;
    const cash = col.daily.sections.find((s) => s.key === 'cash-sales');
    expect(cash.rows.map((r) => [r.saleNumber, r.netPaise, r.cashPaise, r.upiPaise, r.advancePaise])).toEqual([
      [a.number, 500, 200, 0, 300],
      [b.number, 400, 200, 200, 0],
      [c.number, 200, 200, 0, 0],
    ]);
    expect(col.daily.sections.find((s) => s.key === 'credit-sale').rows).toEqual([]);
    expect(col.daily.modes.find((x) => x.mode === 'cash')).toMatchObject({ salesPaise: 600, advancePaise: 300, netPaise: 900 });
    expect(col.daily.summary).toMatchObject({ netCollectionPaise: 1100, advanceUsedPaise: 300 });
  });

  it('a bill saved before 24 Nov 2026 (no discounts kept on it yet) settles too', async () => {
    const { p, a } = await patientWithCredit();
    await PharmacyInvoice.collection.updateOne({ _id: new mongoose.Types.ObjectId(a.id) }, { $unset: { concessions: '' } });
    expect(await PharmacyInvoice.collection.countDocuments({ _id: new mongoose.Types.ObjectId(a.id), concessions: { $exists: false } })).toBe(1);
    const res = await ph('post', '/settlement', { patientId: p.id, invoiceIds: [a.id], concessionPaise: 50, concessionReason: 'Sample reason', payments: [{ mode: 'cash', amountPaise: 550 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.creditBills.map((x) => x.number)).not.toContain(a.number);
  });

  it('a bill on the hospital bill, or another patient’s, is not settled here', async () => {
    const { m, p, a } = await patientWithCredit();
    const q = await newPatient('Sample Other Mother');
    const hers = (await ph('post', '/invoices', { kind: 'sale', patientId: q.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    const onBill = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    const pay = (ids) => ph('post', '/settlement', { patientId: p.id, invoiceIds: ids, payments: [{ mode: 'cash', amountPaise: 800 }] });
    expect((await pay([a.id, hers.id])).status).toBe(400);
    expect((await pay([onBill.id])).status).toBe(400);
    expect((await ph('get', `/settlement?patientId=${p.id}`)).body.creditBills.map((x) => x.number)).not.toContain(onBill.number);
  });
});

describe('Sales bill: the bills of the dates chosen (24 Nov 2026)', () => {
  it('today when nothing is chosen, a period when it is', async () => {
    const { a } = await patientWithCredit();
    expect((await ph('get', '/invoices')).body).toMatchObject({ from: DAY, to: DAY, more: false });
    const month = (await ph('get', '/invoices?from=2026-09-01&to=2026-09-30')).body;
    expect(month).toMatchObject({ from: '2026-09-01', to: '2026-09-30', more: false });
    expect(month.invoices.map((v) => v.number)).toContain(a.number);
    expect((await ph('get', '/invoices?from=2026-08-01&to=2026-08-31')).body.invoices).toEqual([]);
    expect((await ph('get', '/invoices?from=2026-09-30&to=2026-09-01')).status).toBe(400);
    expect((await ph('get', '/invoices?from=2024-01-01&to=2026-09-30')).status).toBe(400); // at most a year
  });
});

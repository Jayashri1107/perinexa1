// The pharmacy counter as the store's earlier software (7 Nov 2026): the medicine search gives the MRP sold next, the
// batch list says where each batch was bought, and the Payment window – the bill's exact figures before it is made
// (nothing taken from stock), and a walk-in's bill paid in parts that must make it up exactly. A registered patient
// still pays at the billing desk.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
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
  const hospital = await createTenant('Counter Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries({ pharm: 'pharmacist', reception: 'receptionist', drA: 'doctor' })) {
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
  const bought = await ph('post', '/purchases', {
    supplierId: sup.id,
    invoiceNo: 'INV-7',
    invoiceDate: '2026-09-27',
    lines: [
      { medicineId: m.id, batch: 'LATE', expiry: '2028-06', qty: 10, ratePaise: 100, mrpPaise: 250 },
      { medicineId: m.id, batch: 'EARLY', expiry: '2027-01', qty: 10, ratePaise: 100, mrpPaise: 200 },
    ],
  });
  expect(bought.status, JSON.stringify(bought.body)).toBe(201);
  return m;
}
const walkIn = (m, extra = {}) => ({ kind: 'sale', customer: { name: 'Sample Walk In', phone: '' }, lines: [{ medicineId: m.id, qty: 3 }], ...extra });

describe('the counter’s lists', () => {
  it('a search from one letter gives the MRP of the batch sold next', async () => {
    const m = await inStock();
    const found = (await ph('get', '/medicines?search=F&active=1')).body.medicines;
    expect(found.find((x) => x.id === m.id)).toMatchObject({ inStock: 20, mrpPaise: 200 });
  });

  it('each batch says the supplier, its bill number and date, and the pack', async () => {
    const m = await inStock();
    const batches = (await ph('get', `/medicines/${m.id}/batches`)).body.batches;
    expect(batches.map((b) => b.batch)).toEqual(['EARLY', 'LATE']);
    expect(batches[0]).toMatchObject({ supplier: 'Sample Distributors', billNo: 'INV-7', billDate: '2026-09-27', qtyLeft: 10, costPaise: 100, mrpPaise: 200, conv: 1, packMrpPaise: 200 });
  });
});

describe('the Payment window', () => {
  it('the bill’s figures come before it is made, and nothing leaves the stock', async () => {
    const m = await inStock();
    const quote = await ph('post', '/invoices/quote', walkIn(m, { discountPercent: 10, discountReason: 'Staff family' }));
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.quote.atMrpPaise).toBe(600);
    expect(quote.body.quote.totalPaise).toBe(540);
    expect((await ph('get', `/medicines/${m.id}/batches`)).body.batches[0].qtyLeft).toBe(10);
    // No invoice number was used up: the first invoice is still PH-…1
    const made = await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'cash', amountPaise: 600 }] }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.invoice.number).toMatch(/1$/);
  });

  it('a walk-in pays in parts that make up the bill, with the cheque and card details', async () => {
    const m = await inStock();
    const res = await ph(
      'post',
      '/invoices',
      walkIn(m, {
        payments: [
          { mode: 'cash', amountPaise: 100 },
          { mode: 'cheque', amountPaise: 300, reference: '000123', bank: 'Sample Bank', on: '2026-09-28', authorisedBy: 'Sample Manager', narration: 'Post-dated' },
          { mode: 'card', amountPaise: 200, reference: '4242', bank: 'Sample Bank' },
        ],
        paymentRemarks: 'Paid in three parts',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const v = res.body.invoice;
    expect(v.paymentRemarks).toBe('Paid in three parts');
    expect(v.payments.map((p) => [p.mode, p.amountPaise])).toEqual([['cash', 100], ['cheque', 300], ['card', 200]]);
    expect(v.payments[1]).toMatchObject({ reference: '000123', bank: 'Sample Bank', on: '2026-09-28', authorisedBy: 'Sample Manager', narration: 'Post-dated' });
  });

  it('parts that do not make up the bill sell nothing', async () => {
    const m = await inStock();
    const res = await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'cash', amountPaise: 500 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('₹6.00');
    expect((await ph('get', `/medicines/${m.id}/batches`)).body.batches[0].qtyLeft).toBe(10);
  });

  it('takes only the last 4 digits of a card', async () => {
    const m = await inStock();
    const res = await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'card', amountPaise: 600, reference: '4111111111111111' }] }));
    expect(res.status).toBe(400);
  });

  // Until 13 Nov 2026 a registered patient always paid at the billing desk; now she may pay here too (tested below)
  it('a registered patient’s bill is quoted like any other', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Counter Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await ph('post', '/invoices/quote', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 1 }] })).body.quote.totalPaise).toBe(200);
  });
});

describe('a registered patient’s bill: the hospital bill, or paid here (13 Nov 2026)', () => {
  it('paid here stays off the hospital bill and is refunded here; the hospital bill as before; never both', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Paying Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const sale = (extra) => ph('post', '/invoices', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 3 }], ...extra });

    const paid = await sale({ payments: [{ mode: 'upi', amountPaise: 600, reference: 'UPI-77' }] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.invoice).toMatchObject({ billId: null, paidPaise: 600, balancePaise: 0 });
    // Short payment is refused, as for a walk-in
    expect((await sale({ payments: [{ mode: 'cash', amountPaise: 100 }] })).status).toBe(400);

    const onBill = await sale({ onHospitalBill: true });
    expect(onBill.status).toBe(201);
    expect(onBill.body.invoice.billId).toBeTruthy();
    expect(onBill.body.invoice.paidPaise).toBeNull();

    expect((await sale({ onHospitalBill: true, payment: { mode: 'cash' } })).status).toBe(400);
    expect((await ph('post', '/invoices', walkIn(m, { onHospitalBill: true }))).status).toBe(400);

    // A return of the bill paid here gives the money back here: how is asked
    const line = paid.body.invoice.lines[0];
    expect((await ph('post', `/invoices/${paid.body.invoice.id}/returns`, { items: [{ lineId: line.id, qty: 1 }], reason: 'Not needed' })).status).toBe(400);
    const back = await ph('post', `/invoices/${paid.body.invoice.id}/returns`, { items: [{ lineId: line.id, qty: 1 }], reason: 'Not needed', refund: { mode: 'cash' } });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
  });
});

describe('a bill with no payment chosen goes on credit (13 Nov 2026)', () => {
  it('a walk-in owes it and pays later at the counter, never more than is due; a patient’s goes on her hospital bill', async () => {
    const m = await inStock();
    const owed = await ph('post', '/invoices', walkIn(m, { onCredit: true }));
    expect(owed.status, JSON.stringify(owed.body)).toBe(201);
    const inv = owed.body.invoice;
    expect(inv).toMatchObject({ billId: null, paidPaise: 0, balancePaise: 600 });
    // Credit with a payment, or a patient on "credit", is refused
    expect((await ph('post', '/invoices', walkIn(m, { onCredit: true, payment: { mode: 'cash' } }))).status).toBe(400);
    // Paid later in two parts; not more than is due
    expect((await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 700 }] })).status).toBe(400);
    const part = await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'upi', amountPaise: 400, reference: 'UPI-9' }] });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body.invoice).toMatchObject({ paidPaise: 400, balancePaise: 200 });
    const rest = await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 200 }] });
    expect(rest.body.invoice.balancePaise).toBe(0);
    expect((await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 1 }] })).status).toBe(400);

    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Credit Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, lines: [{ medicineId: m.id, qty: 1 }] })).status).toBe(400);
    const onBill = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    // A bill on the hospital bill is paid at the billing desk, not here
    expect((await ph('post', `/invoices/${onBill.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 100 }] })).status).toBe(400);
  });
});

describe('Search patient, as the earlier software (13 Nov 2026)', () => {
  it('finds by first, middle and last name, by mobile, and narrows the bills to the dates', async () => {
    const ok = (res, status = 200) => {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      return res.body;
    };
    const m = await inStock();
    const reg = async (fullName, phone) => (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName, phone, assignedDoctor: people.drA._id.toString() }))).body.patient;
    const asha = await reg('Sample Asha Rani Kale', '9876500011');
    await reg('Sample Asha Patil', '9876500022');
    ok(await ph('post', '/invoices', { kind: 'sale', patientId: asha.id, onHospitalBill: true, doctor: { name: 'Dr Sample Bill', reg: '' }, rxSeen: true, lines: [{ medicineId: m.id, qty: 1 }] }), 201);
    const find = async (q) => ok(await ph('get', `/invoices/people?${new URLSearchParams(q)}`)).people.filter((x) => x.mrn).map((x) => x.name);
    expect(await find({ first: 'asha', last: 'kale' })).toEqual(['Sample Asha Rani Kale']);
    expect((await find({ first: 'asha' })).sort()).toEqual(['Sample Asha Patil', 'Sample Asha Rani Kale']);
    expect(await find({ middle: 'rani' })).toEqual(['Sample Asha Rani Kale']);
    expect(await find({ phone: '98765 00022' })).toEqual(['Sample Asha Patil']);
    // 14 Nov 2026: someone billed carries the latest bill's doctor; someone never billed only name and number
    const found = ok(await ph('get', `/invoices/people?${new URLSearchParams({ first: 'asha' })}`)).people;
    expect(found.find((x) => x.name === 'Sample Asha Rani Kale').doctor).toBe('Dr Sample Bill');
    expect(found.find((x) => x.name === 'Sample Asha Patil')).not.toHaveProperty('doctor');
    // The dates narrow to people with bills on those days
    expect(await find({ first: 'asha', from: '2026-09-28', to: '2026-09-28' })).toEqual(['Sample Asha Rani Kale']);
    expect(await find({ first: 'asha', from: '2026-09-01', to: '2026-09-02' })).toEqual([]);
    expect((await ph('get', '/invoices/people?from=2026-09-28&to=2026-09-01')).status).toBe(400);
  });
});

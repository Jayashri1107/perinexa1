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

  it('a registered patient pays at the billing desk, never here', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Counter Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const res = await ph('post', '/invoices', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 200 }] });
    expect(res.status).toBe(400);
    expect((await ph('post', '/invoices/quote', { kind: 'sale', patientId: p.id, lines: [{ medicineId: m.id, qty: 1 }] })).body.quote.totalPaise).toBe(200);
  });
});

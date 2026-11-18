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
    // Paid in part (15 Nov 2026): the rest stays due on the bill, not on the hospital bill; never more than the bill
    const part = await sale({ discountPercent: 10, discountReason: 'Staff family', payments: [{ mode: 'cash', amountPaise: 300 }] });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body.invoice).toMatchObject({ billId: null, paidPaise: 300, balancePaise: 240 });
    expect((await sale({ payments: [{ mode: 'cash', amountPaise: 700 }] })).status).toBe(400);

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

describe('a bill with no payment chosen goes on credit – OPD and IPD patients only (15 Nov 2026)', () => {
  it('a patient owes it and pays later at the counter, never more than is due; a walk-in cannot take credit', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Credit Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const owed = await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', lines: [{ medicineId: m.id, qty: 3 }] });
    expect(owed.status, JSON.stringify(owed.body)).toBe(201);
    const inv = owed.body.invoice;
    expect(inv).toMatchObject({ billId: null, paidPaise: 0, balancePaise: 600, creditAuthorisedBy: 'Sample Admin 07' });
    // 18 Nov 2026: an OPD bill on credit names who authorised it; its Remarks are kept
    const noAuth = await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, lines: [{ medicineId: m.id, qty: 1 }] });
    expect(noAuth.status).toBe(400);
    expect(noAuth.body.error.fields?.creditAuthorisedBy).toBeTruthy();
    const remarked = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', paymentRemarks: 'Pays on Friday', lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    expect(remarked.paymentRemarks).toBe('Pays on Friday');
    // A walk-in on credit, credit with a payment, or credit and the hospital bill together, is refused
    expect((await ph('post', '/invoices', walkIn(m, { onCredit: true }))).status).toBe(400);
    expect((await ph('post', '/invoices', walkIn(m))).status).toBe(400);
    expect((await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', payment: { mode: 'cash' }, lines: [{ medicineId: m.id, qty: 1 }] })).status).toBe(400);
    expect((await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] })).status).toBe(400);
    // Paid later in two parts; not more than is due
    expect((await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 700 }] })).status).toBe(400);
    const part = await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'upi', amountPaise: 400, reference: 'UPI-9' }] });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body.invoice).toMatchObject({ paidPaise: 400, balancePaise: 200 });
    const rest = await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 200 }] });
    expect(rest.body.invoice.balancePaise).toBe(0);
    expect((await ph('post', `/invoices/${inv.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 1 }] })).status).toBe(400);

    const onBill = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    // A bill on the hospital bill is paid at the billing desk, not here
    expect((await ph('post', `/invoices/${onBill.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 100 }] })).status).toBe(400);
  });

  it('the counter and the printed bill show what the patient still owes on earlier bills (18 Nov 2026)', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Dues Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await ph('get', `/patients/${p.id}/dues`)).body).toEqual({ duePaise: 0, bills: [], lastBill: null });
    const first = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice; // 600 due
    const second = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, payments: [{ mode: 'cash', amountPaise: 100 }], lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice; // 100 due
    await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] }); // not counted
    const dues = (await ph('get', `/patients/${p.id}/dues`)).body;
    expect(dues.duePaise).toBe(700);
    expect(dues.lastBill).toMatchObject({ type: 'Hospital bill', amountPaise: 200 }); // the last one made went on the hospital bill
    expect(dues.bills.map((b) => [b.number, b.balancePaise])).toEqual([[first.number, 600], [second.number, 100]]);
    // The second bill's print: its own balance, and the 600 still due on the first
    const printed = (await ph('get', `/invoices/${second.id}`)).body.invoice;
    expect(printed).toMatchObject({ balancePaise: 100, earlierDuePaise: 600 });
    await ph('post', `/invoices/${first.id}/payments`, { payments: [{ mode: 'cash', amountPaise: 600 }] });
    expect((await ph('get', `/invoices/${second.id}`)).body.invoice.earlierDuePaise).toBe(0);
    expect((await ph('get', `/patients/${p.id}/dues`)).body.duePaise).toBe(100);
    // Only the pharmacy desk asks
    expect((await ph('get', `/patients/${p.id}/dues`, undefined, 'reception')).status).toBe(403);
  });

  it('Settlement: one payment clears a patient’s credit bills, oldest first, never more than is due (18 Nov 2026)', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Settle Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const credit = { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07' };
    const a = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice; // 600
    const b = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 2 }] })).body.invoice; // 400
    expect((await ph('post', `/patients/${p.id}/settle`, { payments: [{ mode: 'cash', amountPaise: 1001 }] })).status).toBe(400);
    const part = await ph('post', `/patients/${p.id}/settle`, { payments: [{ mode: 'upi', amountPaise: 700, reference: 'UPI-1' }], remarks: 'Paid by husband' });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body).toMatchObject({ duePaise: 300, bills: [{ number: b.number, balancePaise: 300 }] });
    expect((await ph('get', `/invoices/${a.id}`)).body.invoice).toMatchObject({ balancePaise: 0, paymentRemarks: 'Paid by husband' });
    const rest = await ph('post', `/patients/${p.id}/settle`, { payments: [{ mode: 'cash', amountPaise: 300 }] });
    expect(rest.body.duePaise).toBe(0);
    expect((await ph('post', `/patients/${p.id}/settle`, { payments: [{ mode: 'cash', amountPaise: 1 }] })).status).toBe(400);
    expect((await ph('post', `/patients/${p.id}/settle`, { payments: [{ mode: 'cash', amountPaise: 1 }] }, 'reception')).status).toBe(403);
  });

  it('Search sale return: a credit-note number finds its bill (18 Nov 2026)', async () => {
    const m = await inStock();
    const sold = (await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'cash', amountPaise: 600 }] }))).body.invoice;
    const back = await ph('post', `/invoices/${sold.id}/returns`, { items: [{ lineId: sold.lines[0].id, qty: 1 }], reason: 'Not needed', refund: { mode: 'cash' } });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const cn = back.body.creditNote;
    const found = (await ph('get', `/invoices?search=${encodeURIComponent(cn)}`)).body.invoices;
    expect(found.map((v) => v.number)).toEqual([sold.number]);
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
    // 14 Nov 2026: someone billed carries the latest bill's doctor; someone never billed the doctor assigned at registration
    const found = ok(await ph('get', `/invoices/people?${new URLSearchParams({ first: 'asha' })}`)).people;
    expect(found.find((x) => x.name === 'Sample Asha Rani Kale').doctor).toBe('Dr Sample Bill');
    expect(found.find((x) => x.name === 'Sample Asha Patil').doctor).toMatch(/drA/);
    // The dates narrow to people with bills on those days
    expect(await find({ first: 'asha', from: '2026-09-28', to: '2026-09-28' })).toEqual(['Sample Asha Rani Kale']);
    expect(await find({ first: 'asha', from: '2026-09-01', to: '2026-09-02' })).toEqual([]);
    expect((await ph('get', '/invoices/people?from=2026-09-28&to=2026-09-01')).status).toBe(400);
  });
});

describe('MRP adjustment (18 Nov 2026)', () => {
  it('sets a batch’s MRP again with a reason; the next sale takes it, a bill already made keeps its price', async () => {
    const m = await inStock();
    const before = (await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'cash', amountPaise: 600 }] }))).body.invoice; // EARLY at 2.00
    const early = (await ph('get', `/stock/${m.id}`)).body.batches.find((b) => b.batch === 'EARLY');
    expect((await ph('post', `/batches/${early.id}/mrp`, { mrpPaise: 180 })).status).toBe(400); // no reason
    expect((await ph('post', `/batches/${early.id}/mrp`, { mrpPaise: 200, reason: 'Checked the pack' })).status).toBe(400); // the same
    expect((await ph('post', `/batches/${early.id}/mrp`, { mrpPaise: 180, reason: 'Wrong MRP typed on the bill' }, 'reception')).status).toBe(403);
    const changed = await ph('post', `/batches/${early.id}/mrp`, { mrpPaise: 180, reason: 'Wrong MRP typed on the bill' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.batch.mrpPaise).toBe(180);
    const after = (await ph('post', '/invoices', walkIn(m, { payments: [{ mode: 'cash', amountPaise: 540 }] }))).body.invoice;
    expect(after.totalPaise).toBe(540);
    expect((await ph('get', `/invoices/${before.id}`)).body.invoice.totalPaise).toBe(600);
  });
});

describe('item-wise discount, landing amount and profit (18 Nov 2026)', () => {
  it('a line’s Disc % replaces the bill’s for that line and needs the reason; the quote gives cost and profit', async () => {
    const m = await inStock(); // EARLY: MRP 2.00, cost 1.00 a unit
    const q = (await ph('post', '/invoices/quote', walkIn(m))).body.quote;
    expect(q).toMatchObject({ totalPaise: 600, landingPaise: 300, profitPaise: 300 });
    const lineOff = { ...walkIn(m), lines: [{ medicineId: m.id, qty: 3, discountPercent: 10 }] };
    expect((await ph('post', '/invoices/quote', lineOff)).status).toBe(400); // no reason
    const priced = (await ph('post', '/invoices/quote', { ...lineOff, discountReason: 'Staff family' })).body.quote;
    expect(priced).toMatchObject({ totalPaise: 540, profitPaise: 240 });
    // the bill's 50 % goes on lines without their own
    const made = await ph('post', '/invoices', { ...walkIn(m), lines: [{ medicineId: m.id, qty: 1, discountPercent: 0 }, { medicineId: m.id, qty: 1 }], discountPercent: 50, discountReason: 'Staff family', payments: [{ mode: 'cash', amountPaise: 300 }] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.invoice.lines.map((l) => [l.discountPercent, l.amountPaise])).toEqual([[0, 200], [null, 100]]);
  });
});

describe('pharmacy advance (18 Nov 2026)', () => {
  it('a deposit is used on her bills due, oldest first; the rest is refunded; the collection counts the money once', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Advance Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await ph('post', `/patients/${p.id}/advance`, { amountPaise: 1000, mode: 'cash' }, 'reception')).status).toBe(403);
    const dep = await ph('post', `/patients/${p.id}/advance`, { amountPaise: 1000, mode: 'cash' });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    expect(dep.body).toMatchObject({ number: 'PA-000001', balancePaise: 1000 });
    const credit = { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07' };
    const a = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice; // 600
    const b = (await ph('post', '/invoices', { ...credit, lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice; // 600
    const used = await ph('post', `/patients/${p.id}/advance/use`, {});
    expect(used.status, JSON.stringify(used.body)).toBe(200);
    expect(used.body.paid.map((x) => [x.number, x.amountPaise])).toEqual([[a.number, 600], [b.number, 400]]);
    expect(used.body).toMatchObject({ balancePaise: 0, dues: { duePaise: 200 } });
    expect((await ph('post', `/patients/${p.id}/advance/use`, {})).status).toBe(400); // nothing left
    await ph('post', `/patients/${p.id}/advance`, { amountPaise: 500, mode: 'upi', reference: 'UPI-77' });
    expect((await ph('post', `/patients/${p.id}/advance/refund`, { amountPaise: 600, mode: 'cash', reason: 'Going home' })).status).toBe(400); // more than left
    const back = await ph('post', `/patients/${p.id}/advance/refund`, { amountPaise: 500, mode: 'cash', reason: 'Going home' });
    expect(back.body.balancePaise).toBe(0);
    // Collection: the deposits and the refund, not the bills paid from the advance
    const day = '2026-09-28';
    const col = (await ph('get', `/reports/mis?report=collection&from=${day}&to=${day}`)).body;
    expect(col.rows.map((r) => [r.mode, r.received, r.refunded])).toEqual([['Cash', 1000, 0], ['UPI', 500, 0], ['Cash', 0, 500]]);
    const adv = (await ph('get', `/reports/mis?report=advance&from=${day}&to=${day}`)).body;
    expect(adv.total).toMatchObject({ deposit: 1500, used: 1000, refund: 500 });
  });
});

describe('insurance / cashless patients report (18 Nov 2026)', () => {
  it('lists pharmacy bills on a hospital bill that has insurance', async () => {
    const m = await inStock();
    const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Insured Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const q = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Uninsured Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const covered = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] })).body.invoice;
    await ph('post', '/invoices', { kind: 'sale', patientId: q.id, onHospitalBill: true, lines: [{ medicineId: m.id, qty: 1 }] });
    const set = await (await as('reception')).put(`/api/billing/bills/${covered.billId}/insurance`).send({ insurer: 'Sample Insurance Co', tpa: 'Sample TPA' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const r = (await ph('get', '/reports/mis?report=insurance&from=2026-09-28&to=2026-09-28')).body;
    expect(r.rows.map((x) => [x.bill, x.name, x.insurer, x.tpa, x.net])).toEqual([[covered.number, 'Sample Insured Mother', 'Sample Insurance Co', 'Sample TPA', 200]]);
  });
});

describe('discharge clearance at the pharmacy (18 Nov 2026)', () => {
  it('is the pharmacist’s list; empty with no one discharged', async () => {
    expect((await ph('get', '/discharge-clearance')).body).toEqual({ stays: [] });
    expect((await ph('get', '/discharge-clearance', undefined, 'reception')).status).toBe(403);
  });
});

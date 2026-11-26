// Pharmacy → Sale return patient-wise (24 Nov 2026, after the earlier software's Sales Return window): a patient found
// by UHID or first name, her medicines from all her bills, and quantities taken back from several bills at once – each
// bill its own credit note; money back only for what was paid, the rest off what she owes. Sample data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
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
  const hospital = await createTenant('Return Hospital');
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

// A patient with a bill paid at the counter (2 × ₹2) and one on credit (3 × ₹2)
async function patientWithBills() {
  const m = await inStock();
  const p = await newPatient('Sample Return Mother');
  const paid = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, payments: [{ mode: 'cash', amountPaise: 400 }], lines: [{ medicineId: m.id, qty: 2 }] })).body.invoice;
  const owed = (await ph('post', '/invoices', { kind: 'sale', patientId: p.id, onCredit: true, creditAuthorisedBy: 'Sample Admin 07', lines: [{ medicineId: m.id, qty: 3 }] })).body.invoice;
  return { m, p, paid, owed };
}

describe('Sale return patient-wise', () => {
  it('finds her by UHID or first name, with her medicines from every bill', async () => {
    const { p, paid, owed } = await patientWithBills();
    const found = await ph('get', `/patient-return?type=opd&mrn=${encodeURIComponent(p.mrn)}`);
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.patients).toEqual([{ id: p.id, fullName: p.fullName, mrn: p.mrn }]);
    expect((await ph('get', '/patient-return?type=opd&first=Sample')).body.patients.map((x) => x.id)).toContain(p.id);
    expect((await ph('get', '/patient-return?type=ipd&first=Sample')).body.patients).toEqual([]); // no ward issues
    expect((await ph('get', '/patient-return?type=opd&first=S')).status).toBe(400);
    // Nothing typed (24 Nov 2026): OPD – those billed today; IPD – those admitted now with ward issues
    expect((await ph('get', '/patient-return?type=opd')).body).toMatchObject({ list: true, patients: [{ id: p.id, fullName: p.fullName, mrn: p.mrn }] });
    expect((await ph('get', '/patient-return?type=ipd')).body.patients).toEqual([]);
    const mine = (await ph('get', `/patient-return?type=opd&patientId=${p.id}`)).body;
    expect(mine.lines.map((l) => [l.number, l.canReturnQty])).toEqual([[owed.number, 3], [paid.number, 2]]);
    expect(mine.bills.find((b) => b.number === owed.number)).toMatchObject({ balancePaise: 600, paidPaise: 0 });
    // the counter's, not the reception's or the admin's
    expect((await ph('get', `/patient-return?type=opd&patientId=${p.id}`, undefined, 'reception')).status).toBe(403);
    expect((await ph('get', `/patient-return?type=opd&patientId=${p.id}`, undefined, 'admin')).status).toBe(403);
  });

  it('takes back from two bills at once: money back from the paid one, off the credit of the other', async () => {
    const { m, p, paid, owed } = await patientWithBills();
    const lines = (await ph('get', `/patient-return?type=opd&patientId=${p.id}`)).body.lines;
    const of = (inv) => lines.find((l) => l.invoiceId === inv.id);
    const body = { patientId: p.id, type: 'opd', reason: 'Sample: not opened', refund: { mode: 'cash' }, items: [{ invoiceId: paid.id, lineId: of(paid).lineId, qty: 1 }, { invoiceId: owed.id, lineId: of(owed).lineId, qty: 2 }] };
    expect((await ph('post', '/patient-return', { ...body, items: [{ ...body.items[0], qty: 3 }] })).status).toBe(400); // more than sold
    expect((await ph('post', '/patient-return', { ...body, reason: '' })).status).toBe(400);
    expect((await ph('post', '/patient-return', body, 'reception')).status).toBe(403);

    const res = await ph('post', '/patient-return', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.creditNotes.map((c) => [c.number, c.amountPaise, c.refundPaise, c.creditPaise])).toEqual([[paid.number, 200, 200, 0], [owed.number, 400, 0, 400]]);
    expect(res.body.totals).toMatchObject({ amountPaise: 600, refundPaise: 200, creditPaise: 400 });
    // the Tax box (25 Nov 2026): the credit notes' GST, adding up to what was taken back
    expect(res.body.totals.taxablePaise + res.body.totals.cgstPaise + res.body.totals.sgstPaise).toBe(600);
    // The bills: a credit note each; cash given back only on the paid one
    const a = (await ph('get', `/invoices/${paid.id}`)).body.invoice;
    const b = (await ph('get', `/invoices/${owed.id}`)).body.invoice;
    expect(a.returns).toHaveLength(1);
    expect(a.payments.filter((x) => x.kind === 'refund').map((x) => [x.mode, x.amountPaise])).toEqual([['cash', 200]]);
    expect(b.payments.filter((x) => x.kind === 'refund')).toEqual([]);
    expect(b.balancePaise).toBe(200);
    // 26 Nov 2026 (the pharmacy's request): each bill as it was made – the money taken for it, the refund not taken off
    // (it is on the return's own bill), and still a cash bill and a credit bill
    expect(a).toMatchObject({ receivedPaise: 400, madeAs: 'cash', totalPaise: 400 });
    expect(b).toMatchObject({ receivedPaise: 0, madeAs: 'credit', totalPaise: 600 });
    expect(a.payments.find((x) => x.kind === 'refund').creditNote).toBe(a.returns[0].number);
    const after = (await ph('get', `/patient-return?type=opd&patientId=${p.id}`)).body.bills;
    expect(after.map((x) => [x.number, x.madeAs])).toEqual(expect.arrayContaining([[paid.number, 'cash'], [owed.number, 'credit']]));
    expect((await ph('get', `/patients/${p.id}/dues`)).body.duePaise).toBe(200);
    // The stock is back on the batch: 50 bought, 5 sold, 3 back
    expect((await ph('get', `/medicines/${m.id}/batches`)).body.batches[0].qtyLeft).toBe(48);
    // The Daily Collection shows the money given back, not the credit taken off
    const col = (await ph('get', `/reports/mis?report=collection&from=${DAY}&to=${DAY}`)).body;
    expect(col.daily.sections.find((s) => s.key === 'cash-sales-return').rows.map((r) => [r.netPaise, r.cashPaise])).toEqual([[200, 200]]);
    // What is left to take back
    expect(res.body.lines.map((l) => [l.number, l.canReturnQty])).toEqual([[owed.number, 1], [paid.number, 1]]);
  });
});

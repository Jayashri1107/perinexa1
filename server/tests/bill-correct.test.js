// Correcting a payment (owner, 19 Oct 2026 – docs/BILL_CORRECTIONS_PLAN.md): e.g. the UPI payment failed and she paid
// in cash. Reception corrects on the day until that day's cash handover is confirmed; then only the hospital admin. A
// reason always; the original is kept; the cash handover follows. All fake sample data.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital (India)
const ROLES = { drA: 'doctor', reception: 'receptionist', admin: 'admin' };
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
  app = createApp();
  hospital = await createTenant('Correction Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

/** A fake patient's bill of ₹500 paid by UPI at the desk: { bill, payment }. */
async function paidByUpi() {
  const p = (await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Paying Patient', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const b = (await (await as('reception')).post('/api/billing/bills').send({ patientId: p.id })).body.bill;
  const other = (await (await as('reception')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
  await (await as('reception')).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 50000, name: 'Certificate' });
  const paid = await (await as('reception')).post(`/api/billing/bills/${b.id}/payments`).send({ mode: 'upi', amountPaise: 50000, reference: 'UPI-FAILED-1' });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  return { bill: paid.body.bill, payment: paid.body.payment };
}
const correct = async (who, bill, payment, body) => (await as(who)).post(`/api/billing/bills/${bill.id}/payments/${payment.id}/correct`).send(body);

describe('correcting a payment', () => {
  it('reception corrects UPI to cash on the day with a reason; the original is kept; audit; the handover follows', async () => {
    const { bill, payment } = await paidByUpi();
    expect((await correct('reception', bill, payment, { mode: 'cash', amountPaise: 50000 })).body.error.fields).toHaveProperty('reason');
    // Handed over (not confirmed yet): the counted cash is 0 – UPI only
    const handed = await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 0 });
    expect(handed.body.handover.cashPaise).toBe(0);

    const res = await correct('reception', bill, payment, { mode: 'cash', amountPaise: 50000, time: '11:20', reason: 'UPI failed, paid in cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payment).toMatchObject({ receipt: payment.receipt, mode: 'cash', amountPaise: 50000, reference: '' });
    expect(res.body.payment.corrections).toEqual([
      expect.objectContaining({ reason: 'UPI failed, paid in cash', byName: 'Sample reception', before: expect.objectContaining({ mode: 'upi', amountPaise: 50000, reference: 'UPI-FAILED-1' }) }),
    ]);
    expect(res.body.bill.balance).toBe(0);
    // The handover now counts the cash; what was handed (₹0) shows the difference
    const mine = (await (await as('reception')).get('/api/cash-handover')).body.mine;
    expect(mine.cashPaise).toBe(50000);
    expect(mine.handover).toMatchObject({ cashPaise: 50000, handedPaise: 0, differencePaise: -50000 });
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'PAYMENT_CORRECTED' }).lean();
    expect(entry.details).toMatchObject({ receipt: payment.receipt, before: { mode: 'upi', amountPaise: 50000 }, after: { mode: 'cash', amountPaise: 50000 }, timeChanged: true });
    expect(JSON.stringify(entry.details)).not.toContain('Paying Patient');
    // Nothing changed / more than the bill / a time later than now: refused
    expect((await correct('reception', bill, res.body.payment, { mode: 'cash', amountPaise: 50000, time: '11:20', reason: 'again' })).status).toBe(400);
    expect((await correct('reception', bill, res.body.payment, { mode: 'cash', amountPaise: 60000, reason: 'typo' })).status).toBe(400);
    expect((await correct('reception', bill, res.body.payment, { mode: 'cash', amountPaise: 40000, time: '12:00', reason: 'typo' })).status).toBe(400);
    // A smaller amount: the balance follows
    const less = await correct('reception', bill, res.body.payment, { mode: 'cash', amountPaise: 40000, reason: 'Counted again: ₹400' });
    expect(less.body.bill.balance).toBe(10000);
    expect(less.body.payment.corrections).toHaveLength(2);
  });

  it('after the handover is confirmed, or on a later day, only the hospital admin; the confirmed handover shows it', async () => {
    const { bill, payment } = await paidByUpi();
    const h = (await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 0 })).body.handover;
    expect((await (await as('drA')).post(`/api/cash-handover/${h.id}/confirm`).send({ receivedPaise: 0 })).status).toBe(200);
    const body = { mode: 'card', amountPaise: 50000, reference: 'CARD-77', reason: 'Paid by card, not UPI' };
    const refused = await correct('reception', bill, payment, body);
    expect(refused.status).toBe(403);
    expect((await (await as('reception')).get(`/api/billing/bills/${bill.id}/corrections`)).body.correctableBy[payment.id]).toBe('admin');
    const ok = await correct('admin', bill, payment, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const handover = (await (await as('drA')).get('/api/cash-handover')).body.handovers[0];
    expect(handover.cashPaise).toBe(0); // the confirmed handover is not changed …
    expect(handover.correctedAfter).toEqual([expect.objectContaining({ receipt: payment.receipt, beforeMode: 'upi', afterMode: 'card', byName: 'Sample admin' })]); // … it shows the correction

    // The next day: reception may not, the admin may
    vi.setSystemTime(new Date('2026-09-29T06:00:00Z'));
    sessions = {};
    const p2 = (await Bill.findOne({ tenantId: hospital._id, _id: bill.id }).lean()).payments[0];
    expect((await correct('reception', bill, { id: String(p2._id) }, { mode: 'cash', amountPaise: 50000, reason: 'Was cash after all' })).status).toBe(403);
    expect((await correct('admin', bill, { id: String(p2._id) }, { mode: 'cash', amountPaise: 50000, reason: 'Was cash after all' })).status).toBe(200);
  });
});

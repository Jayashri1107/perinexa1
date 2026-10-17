// The eLabAssist-style lab flow (owner, 17 Oct 2026): the payment taken when the lab registers a walk-in (with a receipt,
// on the order's bill, handed over at the day's end), and the sample received in the lab as its own step. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-17T05:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', lab: 'lab', admin: 'admin' };
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
  hospital = await createTenant('Flow Hospital');
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
async function walkInPatient() {
  const res = await (await as('lab')).post('/api/patients').send(samplePatient({ fullName: 'Flow Patient', phone: '98765 66666' }));
  return res.body.patient;
}
const walkIn = async (p, body = {}) => (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }, { key: 'tsh' }], prescription: 'Self', ...body });
const lab = (path) => `/api/lab/orders/${path}`;

describe('payment at walk-in registration', () => {
  it('the lab takes it on the order\'s bill with a receipt; never more than is due; the lab hands the cash over', async () => {
    // Prices: Hb ₹150, TSH ₹350 (the admin's price list)
    await (await as('admin')).get('/api/billing/prices');
    await PriceItem.updateOne({ tenantId: hospital._id, key: 'lab:hb' }, { $set: { pricePaise: 15000 } });
    await PriceItem.updateOne({ tenantId: hospital._id, key: 'lab:tsh' }, { $set: { pricePaise: 35000 } });
    const p = await walkInPatient();
    const tooMuch = await walkIn(p, { payment: { mode: 'cash', amountPaise: 60000 } });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.fields['payment.amountPaise']).toMatch(/500\.00/);
    const p2 = await walkInPatient();
    const ok = await walkIn(p2, { payment: { mode: 'cash', amountPaise: 50000 } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.payment).toMatchObject({ receipt: expect.stringMatching(/^R-\d{6}$/), mode: 'cash', amountPaise: 50000, duePaise: 0 });
    const bill = await Bill.findOne({ tenantId: hospital._id, patientId: p2.id }).lean();
    expect(bill.payments).toHaveLength(1);
    expect((await AuditLog.findOne({ action: 'PAYMENT_RECEIVED' }).lean()).details).toMatchObject({ amountPaise: 50000, mode: 'cash' });
    // The lab's cash handover counts it
    const day = (await (await as('lab')).get('/api/cash-handover')).body;
    expect(day.mine).toMatchObject({ cashPaise: 50000, payments: 1 });
    expect((await (await as('lab')).post('/api/cash-handover').send({ handedPaise: 50000 })).status).toBe(201);
  });
});

describe('the sample received in the lab', () => {
  it('taken by the lab: received at once; taken on a ward: to receive, by scanning its label', async () => {
    const p = await walkInPatient();
    const counter = (await walkIn(p)).body.order;
    const atCounter = (await (await as('lab')).post(lab(`${counter.id}/collect`)).send({ rev: counter.rev })).body.order;
    expect(atCounter.received).toMatchObject({ byName: 'Sample lab' });

    const ward = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName: 'Ward Patient', assignedDoctor: people.drA._id.toString() }));
    const o = (await (await as('drA')).post(`/api/patients/${ward.body.patient.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] })).body.order;
    const taken = (await (await as('nurse')).post(lab(`${o.id}/collect`)).send({ rev: o.rev })).body.order;
    expect(taken.received).toBeNull();
    const lists = (await (await as('lab')).get('/api/lab/worklist?list=receive')).body;
    expect(lists.counts).toMatchObject({ receive: 1, report: 1 });
    expect(lists.orders.map((x) => x.id)).toEqual([o.id]);
    expect((await (await as('nurse')).post('/api/lab/receive').send({ code: taken.sampleNo })).status).toBe(403);
    expect((await (await as('lab')).post('/api/lab/receive').send({ code: 'nonsense' })).status).toBe(400);
    const got = await (await as('lab')).post('/api/lab/receive').send({ code: `${taken.sampleNo}-1` }); // a label's barcode
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.order).toMatchObject({ id: o.id, received: { byName: 'Sample lab' }, patient: { fullName: 'Ward Patient' } });
    expect((await (await as('lab')).post('/api/lab/receive').send({ code: taken.sampleNo })).body.error.code).toBe('ALREADY_RECEIVED');
    expect((await (await as('lab')).get('/api/lab/worklist?list=report')).body.counts).toMatchObject({ receive: 0, report: 2 });
    expect(await AuditLog.countDocuments({ action: 'LAB_SAMPLE_RECEIVED' })).toBe(1);
  });
});

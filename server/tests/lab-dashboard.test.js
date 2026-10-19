// The lab's dashboard and registration on one screen (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md): the day's
// numbers by department (no patient, no test names), a discount and "sample taken now" at the lab's counter. Fake data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Bill } from '../src/models/Bill.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-19T05:00:00Z');
const ROLES = { drA: 'doctor', lab: 'lab', admin: 'admin', reception: 'receptionist' };
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
  hospital = await createTenant('Dashboard Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
  await (await as('admin')).get('/api/billing/prices');
  await PriceItem.updateOne({ tenantId: hospital._id, key: 'lab:hb' }, { $set: { pricePaise: 15000 } });
  await PriceItem.updateOne({ tenantId: hospital._id, key: 'lab:tsh' }, { $set: { pricePaise: 35000 } });
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const patient = async (fullName = 'Dash Patient') => (await (await as('lab')).post('/api/patients').send(samplePatient({ fullName }))).body.patient;
const walkIn = async (p, body = {}) => (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }, { key: 'tsh' }], prescription: 'Self', ...body });

describe('registration on one screen', () => {
  it('a discount, the sample taken now and the payment, in one step', async () => {
    const p = await patient();
    const res = await walkIn(p, { discount: { mode: 'percent', value: 10, reason: 'Staff family' }, collectNow: true, payment: { mode: 'upi', amountPaise: 45000, reference: 'UPI-1' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'collected', received: expect.objectContaining({ byName: 'Sample lab' }), sampleNo: expect.any(String) });
    expect(res.body.payment).toMatchObject({ amountPaise: 45000, duePaise: 0 });
    const bill = await Bill.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    expect(bill.discount).toMatchObject({ mode: 'percent', value: 10, paise: 5000, reason: 'Staff family' });
    // A discount needs a reason; more than 100 per cent is refused
    expect((await walkIn(await patient('Second'), { discount: { mode: 'amount', value: 1000, reason: '' } })).status).toBe(400);
    expect((await walkIn(await patient('Third'), { discount: { mode: 'percent', value: 120, reason: 'Too much' } })).status).toBe(400);
  });

  it('with other charges on her bill today, the discount belongs to the billing desk', async () => {
    const p = await patient('Busy Patient');
    const b = (await (await as('reception')).post('/api/billing/bills').send({ patientId: p.id })).body.bill;
    const other = (await (await as('reception')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    await (await as('reception')).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 20000, name: 'Dressing' });
    const res = await walkIn(p, { discount: { mode: 'amount', value: 1000, reason: 'Hardship' } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields['discount.value']).toMatch(/billing desk/);
  });
});

describe('the lab dashboard', () => {
  it('the day in numbers by department, what waits now; for the lab only', async () => {
    await walkIn(await patient('One'), { collectNow: true });
    await walkIn(await patient('Two'));
    const d = (await (await as('lab')).get('/api/lab/dashboard')).body;
    expect(d.from).toBe('2026-10-19');
    expect(d.registered).toMatchObject({ orders: 2, patients: 2, walkIn: 2, tests: 4 });
    expect(d.chargedPaise).toBe(100000);
    expect(d.byDepartment.reduce((n, x) => n + x.tests, 0)).toBe(4);
    expect(d.byDepartment.reduce((n, x) => n + x.chargedPaise, 0)).toBe(100000);
    expect(d.waiting).toMatchObject({ collect: 1, report: 1 });
    expect(JSON.stringify(d)).not.toMatch(/One|Two|Haemoglobin|TSH/);
    expect((await (await as('drA')).get('/api/lab/dashboard')).status).toBe(403);
    expect((await (await as('lab')).get('/api/lab/dashboard?from=2026-10-19&to=2026-10-01')).status).toBe(400);
    // Another day: nothing registered
    expect((await (await as('lab')).get('/api/lab/dashboard?from=2026-10-18&to=2026-10-18')).body.registered.orders).toBe(0);
  });
});

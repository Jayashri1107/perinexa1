// Lab → Admitted patients (12 Nov 2026): who is in hospital now for the lab – name, patient number, ward, bed and her lab
// orders only. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const MIN = 60_000;
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', lab: 'lab', lab2: 'lab', admin: 'admin' };
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
  hospital = await createTenant('Lab Inpatients Hospital');
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
// Moves the clock; past the 30-minute inactivity logout everyone signs in again
const later = (minutes) => {
  vi.setSystemTime(new Date(Date.now() + minutes * MIN));
  if (minutes >= 25) sessions = {};
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
/** An antenatal patient whose pregnancy is `weeks` + `days` on NOW's day (EDD = NOW + 280 - GA days). */
async function mother({ weeks = 20, days = 0, edd = true, name = 'Lab Four Mother' } = {}) {
  const pregnancy = edd ? { scanEdd: addDays(NOW, 280 - (weeks * 7 + days)) } : {};
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: name, ageYears: 28, assignedDoctor: people.drA._id.toString(), pregnancy }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const order = async (p, tests = [{ key: 'hb' }], who = 'drA') => {
  const res = await (await as(who)).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order;
};
const lab = (path) => `/api/lab/orders/${path}`;
const hb = (value) => [{ key: 'hb', values: [{ key: 'hb', value }] }];
const report = async (o, value, extra = {}, who = 'lab') => (await as(who)).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: hb(value), report: true, ...extra });
const collect = async (o) => {
  const res = await (await as('lab')).post(lab(`${o.id}/collect`)).send({ rev: o.rev });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.order;
};
/** The hospital's Hb settings (DRAFT – the numbers are the tests' own, not clinical advice). */
async function hbSettings(range) {
  const list = (await (await as('lab')).get('/api/lab-setup/tests')).body.tests;
  const version = list.find((t) => t.key === 'hb').version;
  const res = await (await as('lab')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: range }, version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
const CALL = { toldName: 'Dr Sample A', toldRole: 'Doctor', how: 'phone', readBack: true };

describe("the lab's admitted patients", () => {
  it('name, number, ward, bed and her lab orders – nothing else; only the lab; a confidential test by its neutral name', async () => {
    const p = await mother({ name: 'Sample Ward Mother' });
    const res = await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', ward: 'Labour room', reason: 'In labour' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await order(p, [{ key: 'hb' }, { key: 'hiv' }]);
    const home = await mother({ name: 'Sample Home Mother' }); // not admitted
    await order(home);
    const list = (await (await as('lab')).get('/api/lab/inpatients')).body.inpatients;
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(['bed', 'orders', 'patient', 'ward']);
    expect(Object.keys(list[0].patient).sort()).toEqual(['fullName', 'id', 'mrn']);
    expect(list[0]).toMatchObject({ ward: 'Labour room', patient: { fullName: 'Sample Ward Mother' } });
    expect(list[0].orders[0]).toMatchObject({ status: 'ordered' });
    expect(list[0].orders[0].tests).toHaveLength(2);
    expect(list[0].orders[0].tests).not.toContain('HIV 1 and 2');
    for (const who of ['drA', 'rmo']) expect((await (await as(who)).get('/api/lab/inpatients')).status, who).toBe(403);
  });
});

describe('Lab → New: what is already due on her bill today', () => {
  it("a new patient's registration fee is listed for the lab and can be paid with the tests; not for a doctor", async () => {
    const { PriceItem } = await import('../src/models/PriceItem.js');
    await (await as('admin')).get('/api/billing/prices'); // the built-in price list
    await PriceItem.updateOne({ tenantId: hospital._id, key: 'registration' }, { $set: { pricePaise: 30000, active: true } });
    const res = await (await as('lab')).post('/api/patients').send({ careType: 'gynaecology', fullName: 'Sample Lab New Walkin', ageYears: 31, phone: '90000 33344' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = res.body.patient;
    const due = (await (await as('lab')).get(`/api/lab/walk-in/bill?patientId=${p.id}`)).body;
    expect(due).toMatchObject({ admitted: false, duePaise: 30000, items: [{ name: 'Registration fee (new patient)', amountPaise: 30000 }] });
    expect((await (await as('drA')).get(`/api/lab/walk-in/bill?patientId=${p.id}`)).status).toBe(403);
    const walk = await (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }], prescription: 'Self', payment: { mode: 'cash', amountPaise: 30000, reference: '' } });
    expect(walk.status, JSON.stringify(walk.body)).toBe(201);
    expect(walk.body.payment).toMatchObject({ amountPaise: 30000, duePaise: 0 });
  });
});

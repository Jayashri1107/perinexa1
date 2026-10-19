// The full lab system (docs/LAB_LIMS_PLAN.md): sample numbers and rejection, the hospital's test list and ranges for
// a group, the check before the report, turnaround times and Find, outside labs, the printed report and the register.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', lab2: 'lab' };
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
  hospital = await createTenant('Lims Hospital');
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
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Lims Mother', ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const order = async (p, body = {}, who = 'drA') => {
  const res = await (await as(who)).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }, { key: 'hiv' }], ...body });
  return res;
};
const lab = (path) => `/api/lab/orders/${path}`;
const cbcHiv = (hb = '9.5') => [
  { key: 'cbc', values: [{ key: 'hb', value: hb }, { key: 'tlc', value: '8000' }, { key: 'platelets', value: '2.1' }] },
  { key: 'hiv', values: [{ key: 'hiv', value: 'Non-reactive' }] },
];
const post = async (who, path, body) => (await as(who)).post(path).send(body);
const actions = async (re) => (await AuditLog.find({ action: re }).sort({ _id: 1 }).lean()).map((e) => e.action);

describe('sample numbers, labels and rejected samples', () => {
  it('every order gets a sample number; labels are recorded; the lab rejects a sample and a new one is needed', async () => {
    const p = await register();
    const o1 = (await order(p)).body.order;
    const o2 = (await order(p, { tests: [{ key: 'tsh' }] })).body.order;
    expect(o1.sampleNo).toBe('261001-0001');
    expect(o2.sampleNo).toBe('261001-0002');

    expect((await post('reception', lab(`${o1.id}/labels-printed`), {})).status).toBe(403);
    expect((await post('nurse', lab(`${o1.id}/labels-printed`), {})).status).toBe(200);

    const collected = (await post('lab', lab(`${o1.id}/collect`), { rev: o1.rev })).body.order;
    expect(collected.access).toMatchObject({ canReject: true, canLabel: true });
    expect((await post('nurse', lab(`${o1.id}/reject`), { rev: collected.rev, reason: 'haemolysed' })).status).toBe(403);
    expect((await post('lab', lab(`${o1.id}/reject`), { rev: collected.rev, reason: 'other' })).body.error.fields).toHaveProperty('note');
    const rejected = await post('lab', lab(`${o1.id}/reject`), { rev: collected.rev, reason: 'haemolysed', note: 'Pink plasma' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.order).toMatchObject({ status: 'ordered', collected: null, sampleNo: '261001-0001' });
    expect(rejected.body.order.rejections).toEqual([{ byName: 'Sample lab', at: expect.any(String), reason: 'haemolysed', reasonText: 'Haemolysed', note: 'Pink plasma' }]);
    // Not before the sample is taken
    expect((await post('lab', lab(`${o1.id}/reject`), { rev: rejected.body.order.rev, reason: 'clotted' })).status).toBe(409);

    const entry = await AuditLog.findOne({ action: 'LAB_SAMPLE_REJECTED' }).lean();
    expect(entry.details).toMatchObject({ orderId: o1.id, reason: 'haemolysed' });
    expect(JSON.stringify(entry.details)).not.toMatch(/Pink/);
    expect(await actions(/^LAB_LABELS_PRINTED$/)).toHaveLength(1);
  });
});

describe("the hospital's test list", () => {
  const newTest = (extra = {}) => ({
    who: 'adult',
    name: 'Serum vitamin D (25-OH)',
    group: 'chemistry',
    sample: 'Blood (plain)',
    department: 'immunoassay',
    fields: [{ name: 'Vitamin D', type: 'number', unit: 'ng/mL', low: 30, high: 100 }],
    ...extra,
  });

  it('the lab adds a test (a DRAFT, priced ₹0); it is ordered, reported with its own range; a doctor approves it', async () => {
    expect((await post('nurse', '/api/lab-setup/tests', newTest())).status).toBe(403);
    expect((await post('lab', '/api/lab-setup/tests', newTest({ fields: [] }))).status).toBe(400);
    const made = await post('lab', '/api/lab-setup/tests', newTest());
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const t = made.body.tests.find((x) => x.key === made.body.key);
    expect(t).toMatchObject({ custom: true, status: 'draft', version: 1, department: 'immunoassay', tatHours: 24, urgentTatHours: 4, pricePaise: 0 });
    expect(t.fields[0]).toMatchObject({ key: 'v1', name: 'Vitamin D', low: 30 });
    expect(await PriceItem.findOne({ tenantId: hospital._id, key: `lab:${t.key}` }).lean()).toMatchObject({ name: 'Serum vitamin D (25-OH)', group: 'lab', pricePaise: 0 });
    expect((await post('lab', '/api/lab-setup/tests', newTest())).body.error.fields).toHaveProperty('name'); // same name

    const p = await register();
    const o = (await order(p, { tests: [{ key: t.key }] })).body.order;
    expect(o.tests[0]).toMatchObject({ key: t.key, name: 'Serum vitamin D (25-OH)', department: 'immunoassay' });
    const res = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: t.key, values: [{ key: 'v1', value: '18' }] }], report: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.tests[0].values[0]).toEqual({ key: 'v1', value: '18', flag: 'low', name: 'Vitamin D', unit: 'ng/mL', range: '30–100 ng/mL' });

    // Only a doctor approves; the department is not clinical (stays approved), a range is (a new draft)
    expect((await post('lab', `/api/lab-setup/tests/${t.key}/approve`, { confirm: true, version: 1 })).status).toBe(403);
    const ok = await post('drA', `/api/lab-setup/tests/${t.key}/approve`, { confirm: true, version: 1 });
    expect(ok.body.tests.find((x) => x.key === t.key)).toMatchObject({ status: 'approved', approvedVersion: 1, approvedByName: 'Sample drA' });
    const body = { ...newTest(), fields: [{ key: 'v1', name: 'Vitamin D', type: 'number', unit: 'ng/mL', low: 30, high: 100 }] };
    const moved = await (await as('lab')).put(`/api/lab-setup/tests/${t.key}`).send({ ...body, department: 'biochemistry', version: 1 });
    expect(moved.body.tests.find((x) => x.key === t.key)).toMatchObject({ status: 'approved', version: 1, department: 'biochemistry' });
    const ranged = await (await as('lab')).put(`/api/lab-setup/tests/${t.key}`).send({ ...body, fields: [{ ...body.fields[0], low: 20 }], version: 1 });
    expect(ranged.body.tests.find((x) => x.key === t.key)).toMatchObject({ status: 'draft', version: 2 });
    expect((await (await as('lab')).put(`/api/lab-setup/tests/${t.key}`).send({ ...body, version: 1 })).status).toBe(409);

    // Not offered: refused when ordering
    await (await as('lab')).put(`/api/lab-setup/tests/${t.key}`).send({ ...body, fields: [{ ...body.fields[0], low: 20 }], active: false, version: 2 });
    const refused = await order(p, { tests: [{ key: t.key }] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields['tests.0.key']).toMatch(/not offered/);
    expect(await actions(/^LAB_TEST_/)).toEqual(['LAB_TEST_CREATED', 'LAB_TEST_APPROVED', 'LAB_TEST_UPDATED', 'LAB_TEST_UPDATED', 'LAB_TEST_UPDATED']);
  });

  it('a range for pregnant women applies to an antenatal patient and is saved with her result; others get the usual one', async () => {
    const band = { pregnant: 'yes', low: 10.5, high: 14, range: '' };
    const daysOnAdult = await (await as('drA')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { bands: [{ ...band, ageUnit: 'days', fromAge: 0, toAge: 7 }] } }, version: 1 });
    expect(daysOnAdult.status).toBe(400); // days of life are only for a baby's test (a range for men is allowed: report templates)
    const noWho = await (await as('drA')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { bands: [{ low: 10 }] } }, version: 1 });
    expect(noWho.status).toBe(400);
    const set = await (await as('lab')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { bands: [band] } }, version: 1 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.tests.find((x) => x.key === 'hb')).toMatchObject({ status: 'draft', changed: true });

    const mother = await register();
    const gyn = await register({ careType: 'gynaecology', fullName: 'Lims Gyn', pregnancy: undefined });
    const report = async (p) => {
      const o = (await order(p, { tests: [{ key: 'hb' }] })).body.order;
      const view = (await (await as('lab')).get(lab(o.id))).body;
      const res = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '10.8' }] }], report: true });
      return { field: view.catalogue.tests.find((x) => x.key === 'hb').fields[0], value: res.body.order.tests[0].values[0] };
    };
    const m = await report(mother);
    expect(m.field).toMatchObject({ low: 10.5, high: 14, band: 'Pregnant' });
    expect(m.value).toMatchObject({ value: '10.8', flag: 'normal', range: '10.5–14 g/dL (pregnant)' });
    const g = await report(gyn);
    expect(g.field).toMatchObject({ low: 11, high: 16 });
    expect(g.value).toMatchObject({ flag: 'low', range: '11–16 g/dL (below 11 in pregnancy is anaemia)' });
  });
});

describe('the check before the report', () => {
  it('a doctor turns it on; results entered by one person are checked by another, or sent back', async () => {
    expect((await (await as('lab')).put('/api/lab-setup/settings').send({ verify: true })).status).toBe(403);
    const on = await (await as('drA')).put('/api/lab-setup/settings').send({ verify: true, verifierIds: [] });
    expect(on.body).toMatchObject({ verify: true, verifierIds: [], canEdit: true });
    expect(on.body.staff.map((s) => s.name)).toEqual(expect.arrayContaining(['Sample lab', 'Sample lab2', 'Sample rmo']));
    expect(on.body.staff.map((s) => s.name)).not.toContain('Sample nurse');

    const p = await register();
    let o = (await order(p)).body.order;
    const entered = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: cbcHiv(), report: true });
    expect(entered.body.order).toMatchObject({ status: 'entered', entered: { byName: 'Sample lab' }, reported: null });
    o = entered.body.order;
    expect(o.access.canVerify).toBe(false); // not their own
    expect((await post('lab', lab(`${o.id}/verify`), { rev: o.rev })).status).toBe(403);
    expect((await (await as('drA')).get('/api/lab/to-review')).body.orders).toEqual([]); // not to the doctor yet
    const list = (await (await as('lab2')).get('/api/lab/worklist?list=verify')).body;
    expect(list.counts.verify).toBe(1);
    expect(list.orders[0].access.canVerify).toBe(true);

    // Sent back, entered again, then checked
    expect((await post('lab2', lab(`${o.id}/send-back`), { rev: o.rev, reason: 'x' })).status).toBe(400);
    const back = await post('lab2', lab(`${o.id}/send-back`), { rev: o.rev, reason: 'Platelets look wrong' });
    expect(back.body.order).toMatchObject({ status: 'collected', entered: null, sentBack: [{ byName: 'Sample lab2', reason: 'Platelets look wrong' }] });
    o = (await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: back.body.order.rev, tests: cbcHiv(), report: true })).body.order;
    const checked = await post('lab2', lab(`${o.id}/verify`), { rev: o.rev });
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    expect(checked.body.order).toMatchObject({ status: 'reported', verified: { byName: 'Sample lab2' }, reported: { byName: 'Sample lab2' }, entered: { byName: 'Sample lab' } });
    expect((await (await as('drA')).get('/api/lab/to-review')).body.orders.map((x) => x.id)).toEqual([o.id]);

    // Chosen checkers only
    await (await as('drA')).put('/api/lab-setup/settings').send({ verify: true, verifierIds: [people.drB._id.toString()] });
    let o2 = (await order(p)).body.order;
    o2 = (await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: o2.rev, tests: cbcHiv(), report: true })).body.order;
    expect((await post('lab2', lab(`${o2.id}/verify`), { rev: o2.rev })).status).toBe(403);
    expect((await (await as('drA')).put('/api/lab-setup/settings').send({ verify: true, verifierIds: [people.reception._id.toString()] })).status).toBe(400);
    expect(await actions(/^LAB_RESULTS_(ENTERED|VERIFIED|SENT_BACK)$/)).toEqual(['LAB_RESULTS_ENTERED', 'LAB_RESULTS_SENT_BACK', 'LAB_RESULTS_ENTERED', 'LAB_RESULTS_VERIFIED', 'LAB_RESULTS_ENTERED']);
  });
});

describe('turnaround times, departments and Find', () => {
  it('an order is due after its tests\' times (shorter when urgent) and is late after that', async () => {
    const p = await register();
    const routine = (await order(p)).body.order;
    const urgent = (await order(p, { urgent: true, tests: [{ key: 'urineCulture' }, { key: 'hb' }] })).body.order;
    expect(new Date(routine.dueAt).getTime() - NOW.getTime()).toBe(24 * 3600 * 1000);
    expect(new Date(urgent.dueAt).getTime() - NOW.getTime()).toBe(72 * 3600 * 1000); // a culture takes days
    expect(routine.late).toBe(false);
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3600 * 1000));
    const view = (await (await as('lab')).get(lab(routine.id))).body.order;
    expect(view.late).toBe(true);
    const late = (await (await as('lab')).get('/api/lab/search?status=late')).body.orders;
    expect(late.map((o) => o.id)).toEqual([routine.id]);
  });

  it('the worklist by department; Find by sample number (also a label\'s), patient number or name; audited without the words', async () => {
    const p = await register();
    const other = await register({ fullName: 'Other Person', careType: 'gynaecology', pregnancy: undefined });
    const o1 = (await order(p, { tests: [{ key: 'urine' }] })).body.order;
    const o2 = (await order(other, { tests: [{ key: 'cbc' }] })).body.order;
    const clinical = (await (await as('lab')).get('/api/lab/worklist?list=collect&department=clinical')).body;
    expect(clinical.orders.map((o) => o.id)).toEqual([o1.id]);
    expect(clinical.counts.collect).toBe(1);
    expect((await (await as('lab')).get('/api/lab/worklist?department=nowhere')).status).toBe(400);

    const find = async (q, who = 'lab') => (await (await as(who)).get(`/api/lab/search?q=${encodeURIComponent(q)}`)).body;
    expect((await (await as('lab')).get('/api/lab/search')).status).toBe(400);
    expect((await find(o2.sampleNo)).orders.map((o) => o.id)).toEqual([o2.id]);
    expect((await find(`${o2.sampleNo}-2`)).orders.map((o) => o.id)).toEqual([o2.id]);
    expect((await find(p.mrn)).orders.map((o) => o.id)).toEqual([o1.id]);
    expect((await find('other per')).orders.map((o) => o.id)).toEqual([o2.id]);
    expect((await (await as('reception')).get('/api/lab/search?q=x')).status).toBe(403);
    const entry = await AuditLog.findOne({ action: 'LAB_ORDERS_SEARCHED' }).sort({ _id: -1 }).lean();
    expect(entry.details).toEqual({ results: 1 });
  });
});

describe('outside labs, the printed report and the register', () => {
  it('tests sent to an outside lab are listed until they come back', async () => {
    const p = await register();
    const o = (await order(p, { tests: [{ key: 'cbc' }, { key: 'tsh' }] })).body.order;
    expect((await post('nurse', lab(`${o.id}/outside`), { rev: o.rev, tests: [1], labName: 'Sample Town Lab (practice)' })).status).toBe(403);
    expect((await post('lab', lab(`${o.id}/outside`), { rev: o.rev, tests: [1], labName: '' })).status).toBe(400);
    const sent = await post('lab', lab(`${o.id}/outside`), { rev: o.rev, tests: [1], labName: 'Sample Town Lab (practice)', ref: 'ST-1' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.order.tests[1].outside).toMatchObject({ labName: 'Sample Town Lab (practice)', ref: 'ST-1', sent: { byName: 'Sample lab' }, received: null });
    expect(sent.body.order.tests[0].outside).toBeNull();
    expect((await post('lab', lab(`${o.id}/outside`), { rev: sent.body.order.rev, tests: [1], labName: 'Again' })).body.error.fields).toHaveProperty('tests');
    const outside = (await (await as('lab')).get('/api/lab/worklist?list=outside')).body;
    expect(outside.counts.outside).toBe(1);
    expect(outside.orders.map((x) => x.id)).toEqual([o.id]);
    const back = await post('lab', lab(`${o.id}/outside/received`), { rev: sent.body.order.rev, tests: [1] });
    expect(back.body.order.tests[1].outside.received).toMatchObject({ byName: 'Sample lab' });
    expect((await (await as('lab')).get('/api/lab/worklist?list=outside')).body.counts.outside).toBe(0);
    expect(await actions(/^LAB_(SENT_OUTSIDE|OUTSIDE_RECEIVED)$/)).toEqual(['LAB_SENT_OUTSIDE', 'LAB_OUTSIDE_RECEIVED']);
  });

  it('the report is printed once reported (recorded, with whether the confidential test was on it)', async () => {
    const p = await register();
    const o = (await order(p)).body.order;
    expect((await post('lab', lab(`${o.id}/report-printed`), {})).status).toBe(409);
    await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: cbcHiv(), report: true });
    expect((await post('reception', lab(`${o.id}/report-printed`), {})).status).toBe(403);
    expect((await post('lab', lab(`${o.id}/report-printed`), { confidential: true })).status).toBe(200);
    expect((await post('drA', lab(`${o.id}/report-printed`), {})).status).toBe(200);
    const entries = await AuditLog.find({ action: 'LAB_REPORT_PRINTED' }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => e.details.confidential ?? false)).toEqual([true, false]);
  });

  it('the register counts the orders of the days; the confidential test has its neutral name; at most 62 days', async () => {
    const p = await register();
    const a = (await order(p)).body.order;
    const b = (await order(p, { urgent: true, tests: [{ key: 'tsh' }] })).body.order;
    await post('drA', lab(`${b.id}/cancel`), { rev: b.rev, reason: 'Ordered twice' });
    await (await as('lab')).put(lab(`${a.id}/results`)).send({ rev: a.rev, tests: cbcHiv(), report: true });
    const reg = await (await as('lab')).get('/api/lab/register?from=2026-10-01&to=2026-10-01');
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(reg.body.summary).toMatchObject({ orders: 2, tests: 3, reported: 1, cancelled: 1, abnormal: 1, urgent: 1, waiting: 0 });
    expect(reg.body.orders[0].tests.map((t) => t.name)).toEqual(['Complete blood count (CBC)', 'Lab test (confidential)']);
    expect(JSON.stringify(reg.body)).not.toMatch(/HIV|Non-reactive/);
    expect(reg.body.byDepartment).toEqual({ haematology: 1, serology: 1, immunoassay: 1 });
    expect((await (await as('lab')).get('/api/lab/register?from=2026-08-01&to=2026-10-31')).status).toBe(400);
    expect((await (await as('reception')).get('/api/lab/register?from=2026-10-01&to=2026-10-01')).status).toBe(403);
    expect((await AuditLog.findOne({ action: 'LAB_REGISTER_VIEWED' }).lean()).details).toEqual({ from: '2026-10-01', to: '2026-10-01', results: 2 });
  });
});

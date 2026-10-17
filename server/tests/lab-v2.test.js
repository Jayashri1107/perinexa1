// Lab version 2 (docs/LAB_V2_PLAN.md): walk-in and referred patients, trends and delta checks, the report's QR code,
// quality control with the Westgard rules, the lab's stock and cost per test, home collection, and USG / radiology.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { westgard } from '../src/lab/qc.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-17T05:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', lab2: 'lab', admin: 'admin' };
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
  hospital = await createTenant('Lab Two Hospital');
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
async function walkInPatient(name = 'Walk In') {
  const res = await (await as('lab')).post('/api/patients').send(samplePatient({ fullName: name, phone: '98765 44444' }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function referrer() {
  const res = await (await as('lab')).post('/api/lab-setup/referrers').send({ kind: 'doctor', name: 'Dr Sample Outside', qualification: 'MBBS', phone: '98765 55555' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.referrer;
}
const walkIn = async (p, body = {}) => (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }], ...body });
const lab = (path) => `/api/lab/orders/${path}`;
const report = async (o, hb, extra = {}) => (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: hb }] }], report: true, ...extra });

describe('walk-in and referred patients', () => {
  it('the lab registers her and orders from the prescription; not for the doctors\' review; the WhatsApp offer once reported', async () => {
    const p = await walkInPatient();
    const r = await referrer();
    expect((await walkIn(p)).body.error.fields).toHaveProperty('prescription'); // a referrer or a written prescription
    expect((await (await as('nurse')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }], prescription: 'Self' })).status).toBe(403);
    const made = await walkIn(p, { referrerId: r.id, prescription: 'Prescription of 16 Oct' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.order).toMatchObject({ source: 'walk_in', referrer: { name: 'Dr Sample Outside', kind: 'doctor' }, prescription: 'Prescription of 16 Oct', sampleNo: '261017-0001' });
    const self = await walkIn(p, { prescription: 'Self – no prescription (she asked for Hb)' });
    expect(self.status).toBe(201);
    const done = (await report(made.body.order, '12.5')).body.order;
    expect(done.status).toBe('reported');
    expect(done.access.canReview).toBe(false);
    expect((await (await as('drA')).get('/api/lab/to-review')).body.orders).toEqual([]);
    expect((await (await as('drA')).post(lab(`${done.id}/review`)).send({ rev: done.rev })).status).toBe(409); // a walk-in order is not reviewed here
    expect((await AuditLog.findOne({ action: 'LAB_ORDER_CREATED' }).lean()).details).toMatchObject({ walkIn: true });
    const list = (await (await as('lab')).get('/api/lab-setup/referrers')).body;
    expect(list.referrers.map((x) => x.name)).toEqual(['Dr Sample Outside']);
  });
});

describe('trends and delta checks', () => {
  it('earlier results come with the order; a change past the hospital\'s limit is flagged "Big change"', async () => {
    const p = await walkInPatient();
    const first = (await walkIn(p, { prescription: 'Self' })).body.order;
    await report(first, '12.0');
    // The hospital's limit for Hb: 20 % (DRAFT, set in the test list)
    expect((await (await as('lab')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { deltaPercent: 20 } }, version: 1 })).status).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    const made2 = await walkIn(p, { prescription: 'Self' });
    expect(made2.status, JSON.stringify(made2.body)).toBe(201);
    const second = made2.body.order;
    const page = (await (await as('lab')).get(lab(second.id))).body;
    expect(page.previous.hb.hb[0]).toMatchObject({ value: '12.0', flag: 'normal' });
    const out = (await report(second, '9.0')).body.order;
    expect(out.tests[0].values[0]).toMatchObject({ value: '9.0', deltaPercent: -25, bigChange: true });
  });
});

describe("the report's QR code", () => {
  it('a reported order gets a secret code; the public page confirms it without values or names', async () => {
    const p = await walkInPatient('Sita Devi Sample');
    const o = (await walkIn(p, { prescription: 'Self', tests: [{ key: 'hb' }, { key: 'hiv' }] })).body.order;
    expect(o.verifyToken).toBeNull();
    const done = (await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '11.2' }] }, { key: 'hiv', values: [{ key: 'hiv', value: 'Non-reactive' }] }], report: true })).body.order;
    expect(done.verifyToken).toMatch(new RegExp(`^${hospital._id}\\.[a-f0-9]{24}$`));
    const check = await request(app).get(`/api/verify/lab/${done.verifyToken}`);
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body).toMatchObject({ genuine: true, hospital: 'Lab Two Hospital', sampleNo: done.sampleNo, patientInitials: 'S. D. S.', tests: ['Haemoglobin (Hb)', 'Lab test (confidential)'] });
    expect(JSON.stringify(check.body)).not.toMatch(/11\.2|Sita|HIV|Non-reactive/);
    expect((await request(app).get(`/api/verify/lab/${hospital._id}.000000000000000000000000`)).status).toBe(404);
    expect((await request(app).get('/api/verify/lab/not-a-code')).status).toBe(404);
  });
});

describe('quality control', () => {
  it('the Westgard rules', () => {
    expect(westgard(1.5, [])).toEqual({ violations: [], status: 'accepted' });
    expect(westgard(2.5, [])).toEqual({ violations: ['1-2s'], status: 'warning' });
    expect(westgard(3.2, []).status).toBe('rejected');
    expect(westgard(2.3, [2.1]).violations).toContain('2-2s');
    expect(westgard(-2.3, [2.1]).violations).toContain('R-4s');
    expect(westgard(1.2, [1.1, 1.3, 1.5]).violations).toContain('4-1s');
    expect(westgard(0.2, [0.1, 0.3, 0.5, 0.2, 0.4, 0.1, 0.6, 0.2, 0.3]).violations).toContain('10x');
  });

  it('a rejected run today makes reporting the test need a reason until a corrective action is written', async () => {
    const lot = await (await as('lab')).post('/api/lab-qc/lots').send({ testKey: 'hb', fieldKey: 'hb', level: 1, lotNo: 'QC-001', mean: 12, sd: 0.3 });
    expect(lot.status, JSON.stringify(lot.body)).toBe(201);
    expect((await (await as('lab')).post('/api/lab-qc/lots').send({ testKey: 'hiv', fieldKey: 'hiv', level: 1, lotNo: 'X', mean: 1, sd: 1 })).status).toBe(400); // not a number value
    const ok = await (await as('lab')).post(`/api/lab-qc/lots/${lot.body.lot.id}/runs`).send({ value: 12.2 });
    expect(ok.body.run).toMatchObject({ status: 'accepted', z: 0.67 });
    const bad = await (await as('lab')).post(`/api/lab-qc/lots/${lot.body.lot.id}/runs`).send({ value: 13.2 });
    expect(bad.body.run).toMatchObject({ status: 'rejected', violations: ['1-3s'] });

    const p = await walkInPatient();
    const o = (await walkIn(p, { prescription: 'Self' })).body.order;
    expect((await (await as('lab')).get(lab(o.id))).body.qcRejected).toEqual(['hb']);
    const refused = await report(o, '11.9');
    expect(refused.body.error.fields).toHaveProperty('qcReason');
    const withReason = await report(o, '11.9', { qcReason: 'Urgent sample, repeat control pending' });
    expect(withReason.body.order.qcOverride).toMatchObject({ reason: 'Urgent sample, repeat control pending', byName: 'Sample lab' });

    expect((await (await as('lab')).post(`/api/lab-qc/runs/${bad.body.run.id}/action`).send({ text: 'Recalibrated; control repeated' })).body.run.action).toMatchObject({ byName: 'Sample lab' });
    const o2 = (await walkIn(p, { prescription: 'Self' })).body.order;
    expect((await (await as('lab')).get(lab(o2.id))).body.qcRejected).toEqual([]);
    const chart = (await (await as('drA')).get(`/api/lab-qc/lots/${lot.body.lot.id}/runs`)).body;
    expect(chart.runs.map((r) => r.status)).toEqual(['accepted', 'rejected']);
    expect((await (await as('reception')).get('/api/lab-qc')).status).toBe(403);
  });
});

describe('the lab stock and the cost per test', () => {
  it('a reported test takes its reagent from the earliest-expiring batch; low stock, write-offs and the month\'s costs', async () => {
    const add = await (await as('lab')).post('/api/lab-stock/items').send({ name: 'Hb reagent', unit: 'test', reorderLevel: 5, perTest: [{ testKey: 'hb', qty: 1 }] });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const item = add.body.items[0];
    await (await as('lab')).post(`/api/lab-stock/items/${item.id}/batches`).send({ batchNo: 'LATE', expiresOn: '2027-06-30', qty: 10, unitCostPaise: 3000 });
    const r = await (await as('lab')).post(`/api/lab-stock/items/${item.id}/batches`).send({ batchNo: 'SOON', expiresOn: '2026-11-01', qty: 2, unitCostPaise: 2000 });
    expect(r.body.items[0]).toMatchObject({ stock: 12, low: false });
    expect(r.body.items[0].batches.find((b) => b.batchNo === 'SOON').expiring).toBe(true);
    expect((await (await as('nurse')).post(`/api/lab-stock/items/${item.id}/batches`).send({ batchNo: 'X', qty: 1 })).status).toBe(403);

    const p = await walkInPatient();
    for (let i = 0; i < 3; i += 1) {
      const o = (await walkIn(p, { prescription: 'Self' })).body.order;
      await report(o, '12.0');
    }
    const after = (await (await as('lab')).get('/api/lab-stock')).body.items[0];
    expect(after.stock).toBe(9); // SOON (2) used first, then 1 of LATE
    expect(after.batches.map((b) => [b.batchNo, b.qty])).toEqual([['LATE', 9]]);
    const late = after.batches[0];
    const off = await (await as('lab')).post(`/api/lab-stock/batches/${late.id}/adjust`).send({ kind: 'written_off', qty: 5, reason: 'Spilt' });
    expect(off.body.items[0]).toMatchObject({ stock: 4, low: true });

    const costs = (await (await as('admin')).get('/api/lab-stock/costs?month=2026-10')).body;
    expect(costs.rows[0]).toMatchObject({ key: 'hb', count: 3, reagentCostPaise: 2000 + 2000 + 3000 });
    expect(costs.totals).toMatchObject({ count: 3, writtenOffPaise: 15000 });
  });
});

describe('home collection', () => {
  it('scheduled with a collector; on the way; collected takes the sample; could not collect needs why', async () => {
    const p = await walkInPatient();
    const made = await walkIn(p, { prescription: 'Self', home: { address: '12 Sample Road, Pune', on: '2026-10-17', time: '11:30', collectorId: people.lab2._id.toString() } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.order.home).toMatchObject({ status: 'scheduled', collectorName: 'Sample lab2', time: '11:30' });
    const day = (await (await as('lab2')).get('/api/lab/home?mine=1')).body;
    expect(day.orders.map((o) => o.id)).toEqual([made.body.order.id]);
    let o = made.body.order;
    o = (await (await as('lab2')).post(lab(`${o.id}/home/status`)).send({ rev: o.rev, status: 'on_the_way' })).body.order;
    expect((await (await as('lab2')).post(lab(`${o.id}/home/status`)).send({ rev: o.rev, status: 'failed' })).status).toBe(400);
    o = (await (await as('lab2')).post(lab(`${o.id}/home/status`)).send({ rev: o.rev, status: 'collected' })).body.order;
    expect(o).toMatchObject({ status: 'collected', home: { status: 'collected' }, collected: { byName: 'Sample lab2' } });
    expect((await (await as('lab')).post('/api/lab/walk-in').send({ clientRequestId: randomUUID(), patientId: p.id, tests: [{ key: 'hb' }], prescription: 'Self', home: { address: '12 Sample Road', on: '2026-10-17', time: '11:30', collectorId: people.nurse._id.toString() } })).status).toBe(400); // a collector from the lab
  });
});

describe('USG and radiology', () => {
  async function antenatal() {
    const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Scan Mother', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' } }));
    return res.body.patient;
  }
  it('her doctor orders; reception schedules and marks done; a doctor reports and signs; no fetal sex anywhere', async () => {
    const p = await antenatal();
    expect((await (await as('reception')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study: 'usg_nt' })).status).toBe(403);
    const made = await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study: 'usg_nt', indication: 'Screening at 12 weeks' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    let s = made.body.study;
    const desk = (await (await as('reception')).get('/api/imaging/worklist?list=ordered')).body.studies[0];
    expect(desk).toMatchObject({ studyName: 'USG – NT scan (11–13+6 weeks)', patient: { fullName: 'Scan Mother' } });
    expect(desk.indication).toBeUndefined();
    s = (await (await as('reception')).post(`/api/imaging/${s.id}/schedule`).send({ rev: s.rev, scheduledFor: '2026-10-18T05:30:00.000Z' })).body.study;
    s = (await (await as('reception')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).body.study;
    expect((await (await as('reception')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, findings: 'x' })).status).toBe(403);
    const sex = await (await as('drA')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values: { ductus: 'Normal, it is a boy' }, impression: 'Normal' });
    expect(sex.status).toBe(400);
    const saved = await (await as('drA')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values: { crl: '62', nt: '1.4', nasal: 'Present', fhr: '156' }, findings: 'Single live intrauterine fetus.', impression: 'Low-risk NT for gestation.' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.study.report.values).toMatchObject({ crl: 62, nt: 1.4, nasal: 'Present' });
    s = saved.body.study;
    expect((await (await as('rmo')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).status).toBe(403);
    s = (await (await as('drA')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).body.study;
    expect(s).toMatchObject({ status: 'signed', signed: { byName: 'Sample drA' } });
    const changed = await (await as('drA')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, findings: 'Single live intrauterine fetus.', impression: 'Low-risk NT.', reason: 'Wording corrected' });
    expect(changed.body.study).toMatchObject({ status: 'done', amendments: [{ reason: 'Wording corrected' }] });
    expect((await AuditLog.find({ action: /^IMAGING_/ }).lean()).every((e) => !JSON.stringify(e.details).includes('Scan Mother'))).toBe(true);
    const studies = (await (await as('nurse')).get('/api/imaging/studies')).body.studies;
    expect(JSON.stringify(studies)).not.toMatch(/\bsex\b|gender/i);
  });
});

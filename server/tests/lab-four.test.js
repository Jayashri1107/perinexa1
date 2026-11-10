// The lab's four features of 10 Nov 2026 (docs/LAB_BUILD_NOTE.md): P4 usual ranges that fit the patient (weeks of
// pregnancy, after delivery, judged at the sample's time), P5 critical results with a record of the call, P6 a second
// look at a big change, P9 time taken (the first report's time, Analytics → Lab times). The clinical numbers here are
// made up for the tests – the owner sets the real ones (section 7). All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { bandFits, fieldFor, rangeContext } from '../src/lab/labSetup.js';
import { orderTimes, summariseLab } from '../src/analytics/labTimes.js';
import { WAIT_MIN_N } from '../src/analytics/waitingTimes.js';
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
  hospital = await createTenant('Lab Four Hospital');
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

// ---------- P9 ----------

describe('P9 – time taken', () => {
  it('an amended order keeps the time of its first report', async () => {
    const p = await mother();
    const o = await order(p);
    later(30);
    const first = (await report(o, '11.5')).body.order;
    later(60);
    const changed = await (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: first.rev, tests: hb('11.8'), reason: 'Typing error corrected' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const saved = await LabOrder.findOne({ _id: o.id, tenantId: hospital._id }).lean();
    expect(saved.firstReported.at.getTime()).toBe(NOW.getTime() + 30 * MIN);
    expect(saved.reported.at.getTime()).toBe(NOW.getTime() + 90 * MIN);
    expect(orderTimes(saved).stages.whole).toBe(30);
  });

  it('a sample time stamped by the report is left out of the two sample stages; old orders fall back carefully', () => {
    const at = (m) => new Date(NOW.getTime() + m * MIN);
    const base = { ordered: { at: at(0) }, tests: [{ key: 'hb', department: 'haematology' }], dueAt: at(60) };
    const known = orderTimes({ ...base, collected: { at: at(10) }, reported: { at: at(50) }, firstReported: { at: at(50) } });
    expect(known.stages).toMatchObject({ toSample: 10, sampleToReport: 40, whole: 50 });
    expect(known.late).toBe(false);
    const stamped = orderTimes({ ...base, collected: { at: at(80) }, collectedAtReport: true, reported: { at: at(80) }, firstReported: { at: at(80) } });
    expect(stamped.stages).toMatchObject({ toSample: null, sampleToReport: null, whole: 80 });
    expect(stamped.late).toBe(true);
    // Before 10 Nov 2026: no firstReported – `reported` when never amended, else unknown
    expect(orderTimes({ ...base, reported: { at: at(40) } }).stages.whole).toBe(40);
    expect(orderTimes({ ...base, reported: { at: at(40) }, amendments: [{}] }).stages.whole).toBeNull();
  });

  it('hospital admins: no time below the minimum number of orders, counts rounded; RMOs and the lab get 403', async () => {
    const row = (whole) => ({ orderedAt: NOW.getTime(), urgent: false, departments: ['haematology'], late: false, stages: { toSample: null, sampleToReport: null, reportToReview: null, whole, reportToCall: null, reportToAck: null } });
    const few = summariseLab(Array.from({ length: WAIT_MIN_N - 1 }, () => row(30)), 'admin');
    expect(few.stages.find((s) => s.key === 'whole')).toMatchObject({ median: null, tooFew: true });
    expect(few.late).toMatchObject({ late: null, tooFew: true });
    const enough = summariseLab(Array.from({ length: WAIT_MIN_N }, () => row(30)), 'admin');
    expect(enough.stages.find((s) => s.key === 'whole')).toMatchObject({ median: 30, tooFew: false });
    expect(enough.orders % 5).toBe(0);
    const exact = summariseLab([row(30)], 'doctor');
    expect(exact.stages.find((s) => s.key === 'whole')).toMatchObject({ n: 1, median: 30 });
    for (const who of ['rmo', 'lab']) expect((await (await as(who)).get('/api/analytics/lab-times')).status).toBe(403);
  });

  it("doctors see this month's orders of their patients; another hospital's orders never count", async () => {
    const p = await mother();
    const o = await order(p);
    later(45);
    await report(o, '12.0');
    // Another hospital with its own order
    const other = await createTenant('Other Hospital');
    const drX = await createUser({ name: 'Sample drX' });
    await addMember(drX, other, 'doctor');
    const xs = await loginAs(drX, { app });
    const res = await (await as('drA')).get('/api/analytics/lab-times?period=month');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.orders).toBe(1);
    expect(res.body.stages.find((s) => s.key === 'whole')).toMatchObject({ n: 1, median: 45 });
    const theirs = await xs.get('/api/analytics/lab-times?period=month');
    expect(theirs.status).toBe(200);
    expect(theirs.body.orders).toBe(0);
    const admin = await (await as('admin')).get('/api/analytics/lab-times?period=month');
    expect(admin.body.period.key).toBe('last'); // whole finished months only
  });
});

// ---------- P5 ----------

describe('P5 – critical results with a record of the call', () => {
  it('a critical value cannot be reported without the call; the call is kept and audited with ids only', async () => {
    await hbSettings({ criticalLow: 6 });
    const p = await mother();
    const o = await order(p);
    const ask = await report(o, '5.8');
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('CRITICAL_CALL');
    expect(ask.body.error.details.values).toEqual([{ testKey: 'hb', valueKey: 'hb', name: 'Haemoglobin', value: '5.8', unit: 'g/dL' }]);
    const noReadBack = await report(o, '5.8', { criticalCall: { ...CALL, readBack: false } });
    expect(noReadBack.status).toBe(400);
    expect(noReadBack.body.error.fields).toHaveProperty(['criticalCall.readBack']);
    const done = await report(o, '5.8', { criticalCall: CALL });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.order.tests[0].values[0]).toMatchObject({ value: '5.8', critical: true });
    expect(done.body.order.critical).toMatchObject({ open: false, acknowledged: null, calls: [{ toldName: 'Dr Sample A', toldRole: 'Doctor', how: 'phone', readBack: true, byName: 'Sample lab' }] });
    const entry = await AuditLog.findOne({ action: 'LAB_CRITICAL_CALL_NOTED' }).lean();
    expect(safeAuditDetails(entry.action, entry.details)).toEqual({ patientId: p.id, orderId: o.id, mrn: p.mrn, values: 1 });
    // A value not at the limit needs no call
    const o2 = await order(p);
    expect((await report(o2, '6.1')).status).toBe(200);
  });

  it('nobody reached: reported, first in the lab\'s list until a call is noted', async () => {
    await hbSettings({ criticalLow: 6 });
    const p = await mother();
    const o = await order(p);
    const done = (await report(o, '5.5', { criticalNotReached: { triedName: 'Dr Sample A (phone, twice)' } })).body.order;
    expect(done.status).toBe('reported');
    expect(done.critical).toMatchObject({ open: true, notReached: [{ triedName: 'Dr Sample A (phone, twice)' }] });
    const list = (await (await as('lab')).get('/api/lab/worklist?list=critical')).body;
    expect(list.orders.map((x) => x.id)).toEqual([o.id]);
    expect(list.counts.critical).toBe(1);
    const call = await (await as('lab')).post(lab(`${o.id}/critical-call`)).send({ rev: done.rev, criticalCall: { ...CALL, how: 'in_person' } });
    expect(call.status, JSON.stringify(call.body)).toBe(200);
    expect(call.body.order.critical.open).toBe(false);
    expect((await (await as('lab')).get('/api/lab/worklist?list=critical')).body.orders).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'LAB_CRITICAL_NOT_REACHED' })).toBe(1);
  });

  it('only a doctor who may review acknowledges; critical results come first on Today; reviewing acknowledges too', async () => {
    await hbSettings({ criticalLow: 6 });
    const p = await mother();
    const plain = await order(p);
    later(5);
    await report(plain, '9.0'); // abnormal, not critical – reported first
    const o = await order(p);
    later(5);
    const done = (await report(o, '5.5', { criticalCall: CALL })).body.order;
    expect(done.access.canAcknowledge).toBe(false); // the lab
    const today = (await (await as('drA')).get('/api/lab/to-review')).body.orders;
    expect(today.map((x) => x.id)).toEqual([o.id, plain.id]);
    expect((await (await as('drB')).post(lab(`${o.id}/acknowledge`)).send({ rev: done.rev })).status).toBe(403);
    expect((await (await as('rmo')).post(lab(`${o.id}/acknowledge`)).send({ rev: done.rev })).status).toBe(403);
    const ack = await (await as('drA')).post(lab(`${o.id}/acknowledge`)).send({ rev: done.rev });
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.order.critical.acknowledged).toMatchObject({ byName: 'Sample drA' });
    expect((await (await as('drA')).post(lab(`${o.id}/acknowledge`)).send({ rev: ack.body.order.rev })).status).toBe(409);
    // A second critical order acknowledged by the review itself
    const o3 = await order(p);
    const d3 = (await report(o3, '5.0', { criticalCall: CALL })).body.order;
    const rev = await (await as('drA')).post(lab(`${o3.id}/review`)).send({ rev: d3.rev, comment: 'Admitted for transfusion' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.order.critical.acknowledged).toMatchObject({ byName: 'Sample drA' });
  });

  it('an amendment that makes a value critical asks again and needs a new acknowledgement; the hospital check asks the checker', async () => {
    await hbSettings({ criticalLow: 6 });
    const p = await mother();
    const o = await order(p);
    const first = (await report(o, '7.0')).body.order;
    const amend = (value, extra = {}) => as('lab').then((s) => s.put(lab(`${o.id}/results`)).send({ rev: first.rev, tests: hb(value), reason: 'Rechecked on the analyser', ...extra }));
    expect((await amend('5.9')).body.error.code).toBe('CRITICAL_CALL');
    const ok = await amend('5.9', { criticalCall: CALL });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.order.critical.calls).toHaveLength(1);

    // With the hospital's check on, the checker notes the call when the results go to the doctor
    expect((await (await as('drA')).put('/api/lab-setup/settings').send({ verify: true, verifierIds: [] })).status).toBe(200);
    const o2 = await order(p);
    const entered = (await report(o2, '5.2')).body.order;
    expect(entered.status).toBe('entered');
    expect((await (await as('lab2')).post(lab(`${o2.id}/verify`)).send({ rev: entered.rev })).body.error.code).toBe('CRITICAL_CALL');
    const checked = await (await as('lab2')).post(lab(`${o2.id}/verify`)).send({ rev: entered.rev, criticalCall: CALL });
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    expect(checked.body.order).toMatchObject({ status: 'reported', critical: { open: false } });
  });

  it('critical limits are clinical: a change makes a DRAFT; the low limit must be below the high one', async () => {
    const list = (await (await as('lab')).get('/api/lab-setup/tests')).body.tests;
    const t = list.find((x) => x.key === 'hb');
    const bad = await (await as('lab')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { criticalLow: 20, criticalHigh: 6 } }, version: t.version });
    expect(bad.status).toBe(400);
    await hbSettings({ criticalLow: 6, criticalHigh: 20 });
    const after = (await (await as('lab')).get('/api/lab-setup/tests')).body.tests.find((x) => x.key === 'hb');
    expect(after.status).toBe('draft');
    expect(after.fields[0]).toMatchObject({ criticalLow: 6, criticalHigh: 20 });
  });
});

// ---------- P6 ----------

describe('P6 – a second look at a big change', () => {
  it('asks once before the report with her last value; the confirmation is kept and audited', async () => {
    await hbSettings({ deltaPercent: 20 });
    const p = await mother();
    const o1 = await order(p);
    await report(o1, '11.8');
    later(60);
    const o2 = await order(p);
    const ask = await report(o2, '7.1');
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('DELTA_CHECK');
    expect(ask.body.error.details.values[0]).toMatchObject({ testKey: 'hb', valueKey: 'hb', value: '7.1', previous: '11.8', unit: 'g/dL' });
    // Saving for later does not ask
    expect((await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: o2.rev, tests: hb('7.1') })).status).toBe(200);
    const saved = await LabOrder.findOne({ _id: o2.id, tenantId: hospital._id }).lean();
    const done = await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: saved.rev, tests: hb('7.1'), report: true, deltaConfirmed: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.order.deltaChecks).toEqual([{ byName: 'Sample lab', at: expect.any(String), values: [{ testKey: 'hb', valueKey: 'hb', value: '7.1' }] }]);
    expect(await AuditLog.countDocuments({ action: 'LAB_DELTA_CONFIRMED' })).toBe(1);
    // A change of another kind after the report does not ask again about the same value
    const again = await (await as('lab')).put(lab(`${o2.id}/results`)).send({ rev: done.body.order.rev, tests: hb('7.1'), labNote: 'Sample rechecked', reason: 'Remark added' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });
});

// ---------- P4 ----------

describe('P4 – usual ranges that fit the patient', () => {
  const field = {
    type: 'number',
    unit: 'g/dL',
    low: 11,
    high: 16,
    range: '11–16 g/dL',
    bands: [
      { pregnant: 'yes', fromWeeks: 14, toWeeks: 27, low: 10.5, high: null, range: '' },
      { pregnant: 'postnatal', low: 10, high: null, range: '' },
      { pregnant: 'yes', low: 11, high: null, range: '' },
    ],
  };
  const ctx = (patient, at = NOW) => rangeContext({ ageYears: 28, ...patient }, at);

  it('weeks from the EDD on the sample day pick the range; 13+6 and 14+0; no EDD falls to the general pregnancy range', () => {
    const edd13w6 = addDays(NOW, 280 - 97);
    const p = { careType: 'antenatal', pregnancy: { scanEdd: edd13w6 } };
    expect(ctx(p).weeks).toBe(13);
    expect(fieldFor(field, ctx(p))).toMatchObject({ low: 11, band: 'Pregnant' });
    const nextDay = new Date(NOW.getTime() + 86400000);
    expect(ctx(p, nextDay).weeks).toBe(14);
    expect(fieldFor(field, ctx(p, nextDay))).toMatchObject({ low: 10.5, band: 'Pregnant, 14–27 weeks', range: '10.5 g/dL or more (pregnant)' });
    const noEdd = ctx({ careType: 'antenatal' });
    expect(noEdd.weeks).toBeNull();
    expect(bandFits(field.bands[0], noEdd)).toBe(false);
    expect(fieldFor(field, noEdd).low).toBe(11);
    expect(fieldFor(field, ctx({ careType: 'postnatal' }))).toMatchObject({ low: 10, band: 'After delivery' });
    expect(fieldFor(field, ctx({ careType: 'gynaecology' })).low).toBe(11);
  });

  it("judged at the sample's time, kept with the value; the lab never sees her weeks", async () => {
    await hbSettings({ bands: [{ pregnant: 'yes', fromWeeks: 14, toWeeks: 27, low: 10.5 }] });
    const p = await mother({ weeks: 13, days: 6 });
    const o = await collect(await order(p)); // the sample at 13+6
    later(24 * 60); // typed the next day, at 14+0
    const done = (await report(o, '10.7')).body.order;
    expect(done.tests[0].values[0]).toMatchObject({ value: '10.7', flag: 'low' });
    expect(done.tests[0].values[0].rangeWho).toBeUndefined(); // the lab's answer
    // A sample taken at 14+0 is judged by the second-trimester range
    const o2 = await order(p);
    const d2 = (await report(o2, '10.7')).body.order;
    expect(d2.tests[0].values[0]).toMatchObject({ flag: 'normal' });
    expect(d2.tests[0].values[0].range).not.toMatch(/week/);
    const page = (await (await as('lab')).get(lab(o2.id))).body;
    expect(JSON.stringify(page)).not.toMatch(/14–27 weeks/);
    // The doctor sees whom the range was for
    const theirs = (await (await as('drA')).get(`/api/patients/${p.id}/lab-orders`)).body.orders.find((x) => x.id === o2.id);
    expect(theirs.tests[0].values[0].rangeWho).toBe('Pregnant, 14–27 weeks');
    // A later change of the range does not re-judge the stored result
    await hbSettings({ bands: [] });
    const again = (await (await as('drA')).get(`/api/patients/${p.id}/lab-orders`)).body.orders.find((x) => x.id === o2.id);
    expect(again.tests[0].values[0]).toMatchObject({ flag: 'normal', rangeWho: 'Pregnant, 14–27 weeks' });
  });

  it('weeks only with "pregnant"; after delivery is not for a baby\'s test', async () => {
    const list = (await (await as('lab')).get('/api/lab-setup/tests')).body.tests;
    const t = list.find((x) => x.key === 'hb');
    const bad = await (await as('lab')).put('/api/lab-setup/tests/hb').send({ fieldRanges: { hb: { bands: [{ pregnant: 'no', fromWeeks: 10, low: 11 }] } }, version: t.version });
    expect(bad.status).toBe(400);
    expect(Object.values(bad.body.error.fields).join(' ')).toMatch(/Weeks of pregnancy/);
  });
});

// The lab's owner-set parts of 12 Nov 2026 (docs/LAB_BUILD_NOTE.md section 7): critical choices, the red-flag rules
// beside the ranges, and whether an RMO acknowledges a critical result. The choices here are made up for the tests –
// the owner sets the real ones. All fake sample data.
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
  hospital = await createTenant('Lab Owner Values Hospital');
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

async function setChoices(key, field, criticalOptions, who = 'lab') {
  const list = (await (await as(who)).get('/api/lab-setup/tests')).body.tests;
  const version = list.find((t) => t.key === key).version;
  return (await as(who)).put(`/api/lab-setup/tests/${key}`).send({ fieldRanges: { [field]: { criticalOptions } }, version });
}
const reportIct = async (o, value, extra = {}) => (await as('lab')).put(lab(`${o.id}/results`)).send({ rev: o.rev, tests: [{ key: 'ict', values: [{ key: 'ict', value }] }], report: true, ...extra });

describe('critical choices (a result option the lab must call about)', () => {
  it('none until the hospital lists one; a listed option needs the call; the list is a DRAFT; never on the HIV test', async () => {
    const p = await mother();
    const o1 = await order(p, [{ key: 'ict' }]);
    expect((await reportIct(o1, 'Positive')).status).toBe(200); // nothing listed yet
    const set = await setChoices('ict', 'ict', ['Positive']);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const t = (await (await as('drA')).get('/api/lab-setup/tests')).body.tests.find((x) => x.key === 'ict');
    expect(t.status).toBe('draft');
    expect(t.fields[0].criticalOptions).toEqual(['Positive']);
    const o2 = await order(p, [{ key: 'ict' }]);
    const ask = await reportIct(o2, 'Positive');
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('CRITICAL_CALL');
    const done = await reportIct(o2, 'Positive', { criticalCall: CALL });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.order.tests[0].values[0]).toMatchObject({ value: 'Positive', critical: true });
    const o3 = await order(p, [{ key: 'ict' }]);
    expect((await reportIct(o3, 'Negative')).status).toBe(200);
    // Not an option of the value; the HIV test (its own confidential path)
    expect((await setChoices('ict', 'ict', ['Maybe'])).status).toBe(400);
    expect((await setChoices('hiv', 'hiv', ['Reactive'])).status).toBe(400);
  });
});

describe('the red-flag rules beside the ranges', () => {
  it('a doctor sees the rules that read each lab value; the lab sees none', async () => {
    await (await as('drA')).get('/api/red-flag-rules'); // the built-in DRAFT rule set
    const forDoctor = (await (await as('drA')).get('/api/lab-setup/tests')).body.tests.find((x) => x.key === 'hb');
    expect(forDoctor.redFlags.hb.map((r) => r.key)).toEqual(expect.arrayContaining(['lab_hb_severe', 'hb_severe']));
    expect(forDoctor.redFlags.hb.find((r) => r.key === 'lab_hb_severe')).toMatchObject({ level: 'urgent', text: expect.stringMatching(/under 7/) });
    const forLab = (await (await as('lab')).get('/api/lab-setup/tests')).body.tests.find((x) => x.key === 'hb');
    expect(forLab.redFlags).toBeUndefined();
    expect(forLab.redFlagStatus).toBeUndefined();
    expect(JSON.stringify(forLab)).not.toMatch(/lab_hb_severe|Severe anaemia/);
  });
});

describe("an RMO acknowledging a critical result – the hospital's choice", () => {
  it('off by default; a doctor turns it on; then an RMO acknowledges; the lab cannot change it', async () => {
    await hbSettings({ criticalLow: 6 });
    const p = await mother();
    const o = await order(p);
    const done = (await report(o, '5.5', { criticalCall: CALL })).body.order;
    expect((await (await as('rmo')).post(lab(`${o.id}/acknowledge`)).send({ rev: done.rev })).status).toBe(403);
    expect((await (await as('lab')).put('/api/lab-setup/settings').send({ verify: false, rmoAcknowledges: true })).status).toBe(403);
    const on = await (await as('drA')).put('/api/lab-setup/settings').send({ verify: false, rmoAcknowledges: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.rmoAcknowledges).toBe(true);
    const seen = (await (await as('rmo')).get(lab(o.id))).body.order;
    expect(seen.access.canAcknowledge).toBe(true);
    const ack = await (await as('rmo')).post(lab(`${o.id}/acknowledge`)).send({ rev: seen.rev });
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.order.critical.acknowledged).toMatchObject({ byName: 'Sample rmo' });
    expect(await AuditLog.countDocuments({ action: 'LAB_SETTINGS_CHANGED', 'details.rmoAcknowledges': true })).toBe(1);
  });
});

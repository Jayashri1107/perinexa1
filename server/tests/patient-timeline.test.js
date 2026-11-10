// Patient timeline and waiting times (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md). Fake data only.
// Time is pinned and moved forward by hand: a Tuesday, 10 Nov 2026, from 10:00 in India (04:30 UTC).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { WAIT_MIN_N, summarise } from '../src/analytics/waitingTimes.js';
import { clearUsualTimes, momentsOf, spread, stagesOf } from '../src/visits/flow.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const START = new Date('2026-11-10T04:30:00Z'); // 10:00 IST
const at = (min) => new Date(START.getTime() + min * 60_000);
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };

let app;
let hospital;
let other;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  await resetTestDb();
  resetApprovalBackfill();
  clearUsualTimes();
  app = createApp();
  hospital = await createTenant('Timeline Hospital');
  other = await createTenant('Other Timeline Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const url = (p, path = '') => `/api/patients/${p.id}/visits${path}`;

async function register(who = 'reception', extra = {}) {
  const res = await (await as(who)).post('/api/patients').send(samplePatient({ fullName: 'Timeline Mother', ageYears: 28, assignedDoctor: people.drA._id.toString(), ...extra }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

// A day: registered at 10:00 after 5 minutes on the form, vitals 10:10, RMO 10:25, doctor 10:50, printed 11:05
async function aDay() {
  const p = await register('reception', { registrationSeconds: 300 });
  vi.setSystemTime(at(5));
  const v = (await (await as('nurse')).post(url(p)).send({ clientRequestId: randomUUID() })).body.visit;
  vi.setSystemTime(at(10));
  const saved = await (await as('nurse')).patch(url(p, `/${v.id}`)).send({ vitals: { rev: 0, weightKg: 58, bpSystolic: 110, bpDiastolic: 70 } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  vi.setSystemTime(at(25));
  expect((await (await as('rmo')).get(url(p, `/${v.id}`))).status).toBe(200);
  vi.setSystemTime(at(50));
  expect((await (await as('drA')).get(url(p, `/${v.id}`))).status).toBe(200);
  vi.setSystemTime(at(52));
  await (await as('drA')).get(url(p, `/${v.id}`)); // a second look changes nothing
  vi.setSystemTime(at(60));
  const rx = await (await as('drA')).put(url(p, `/${v.id}/prescription`)).send({ rev: 0, items: [{ drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' }] });
  expect(rx.status, JSON.stringify(rx.body)).toBe(200);
  vi.setSystemTime(at(65));
  expect((await (await as('drA')).post(url(p, `/${v.id}/printed`)).send({})).status).toBe(200);
  sessions = {}; // the day took over 30 minutes: everyone signs in afresh (the inactivity logout)
  return { p, v };
}
// Records read in a test always name the hospital (the app refuses a query without it)
const visitDoc = (id) => Visit.findOne({ _id: id, tenantId: hospital._id }).lean();
const patientDoc = (id) => Patient.findOne({ _id: id, tenantId: hospital._id }).lean();

describe('the moments are noted by themselves, once each', () => {
  it('registration start, vitals, the RMO, the doctor and the finish – with the role, never the person', async () => {
    const { p, v } = await aDay();
    const saved = await visitDoc(v.id);
    expect(saved.flow).toEqual({ startedRole: 'nurse', vitalsFirstAt: at(10), rmoFirstAt: at(25), doctorFirstAt: at(50), finishedAt: at(65) });
    const patient = await patientDoc(p.id);
    expect(patient.registrationStartedAt).toEqual(new Date(START.getTime() - 300_000));
  });

  it('a form left open more than an hour is not kept; a visit opened on another day is not "starts seeing her"', async () => {
    const p = await register('reception', { registrationSeconds: 7200 });
    expect((await patientDoc(p.id)).registrationStartedAt).toBeNull();
    const v = (await (await as('nurse')).post(url(p)).send({ clientRequestId: randomUUID() })).body.visit;
    vi.setSystemTime(new Date('2026-11-11T05:00:00Z'));
    sessions = {};
    expect((await (await as('drA')).get(url(p, `/${v.id}`))).status).toBe(200);
    expect((await visitDoc(v.id)).flow.doctorFirstAt).toBeNull();
  });
});

describe('Time in hospital: one visit, for her doctor only', () => {
  it('her doctor sees the moments and the minutes of each stage, and the look is in the audit log', async () => {
    const { p, v } = await aDay();
    const res = await (await as('drA')).get(url(p, `/${v.id}/timeline`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moments.arrived).toBe(new Date(START.getTime() - 300_000).toISOString()); // no "Mark arrived": the registration start
    const minutes = Object.fromEntries(res.body.stages.map((s) => [s.key, s.minutes]));
    expect(minutes).toMatchObject({ registration: 5, toRmo: 25, rmoToDoctor: 25, toDoctor: null, vitals: 15, withDoctor: 15, whole: 70 });
    expect(res.body.stages.every((s) => s.longer === false && s.usualLimit === null)).toBe(true); // too few visits for "usual"
    expect(JSON.stringify(res.body)).not.toMatch(/Sample (nurse|rmo|drA)/); // never who
    expect(await AuditLog.countDocuments({ action: 'VISIT_TIMELINE_VIEWED', 'details.visitId': v.id })).toBe(1);
  });

  it('RMOs, nurses, reception and the hospital admin get 403; another hospital cannot reach the visit', async () => {
    const { p, v } = await aDay();
    for (const who of ['rmo', 'nurse', 'reception', 'admin']) expect((await (await as(who)).get(url(p, `/${v.id}/timeline`))).status, who).toBe(403);
    expect([403, 404]).toContain((await (await as('outsider')).get(url(p, `/${v.id}/timeline`))).status);
  });

  it('a super admin working inside the hospital never sees one patient’s timeline (numbers only, always)', async () => {
    const { p, v } = await aDay();
    const root = await loginAs(await createSuperAdmin(), { app });
    const opened = await root.agent.post('/api/auth/open-hospital').send({ tenantId: hospital._id.toString() });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    root.activeTenantId = opened.body.activeTenantId;
    expect((await root.get(url(p, `/${v.id}/timeline`))).status).toBe(403);
  });
});

describe('the stages', () => {
  const visit = { visitOn: new Date('2026-11-10T00:00:00Z'), flow: {} };
  it('a stage with a missing end or times in the wrong order is not known – never guessed', () => {
    const m = momentsOf({ visit: { ...visit, flow: { doctorFirstAt: at(30), finishedAt: at(20) } }, arrival: { at: at(0) }, patient: null, paidAt: null, soldAt: null, labs: [] });
    const s = stagesOf(m);
    expect(s.withDoctor).toBeNull();
    expect(s.toDoctor).toBe(30); // no RMO: reception straight to the doctor
    expect(s.rmoToDoctor).toBeNull();
  });
  it('left is the last of finished, paid and medicines sold', () => {
    const m = momentsOf({ visit: { ...visit, flow: { finishedAt: at(40) } }, arrival: { at: at(0) }, patient: null, paidAt: at(45), soldAt: at(55), labs: [] });
    expect(stagesOf(m)).toMatchObject({ billing: 5, pharmacy: 15, whole: 55, wholeWithSale: 55 });
  });
  it('the usual and the slow time', () => {
    expect(spread([5, 1, 3, 2, 4, null])).toEqual({ n: 5, median: 3, p90: 5 });
    expect(spread([])).toEqual({ n: 0, median: null, p90: null });
  });
});

describe('Waiting times in Analytics', () => {
  it('doctors get exact numbers for the patients they may see; RMOs and nurses get 403', async () => {
    await aDay();
    const res = await (await as('drA')).get('/api/analytics/waiting-times?period=month');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.visits).toBe(1);
    expect(res.body.stages.find((s) => s.key === 'toRmo')).toMatchObject({ n: 1, median: 25, tooFew: false });
    for (const who of ['rmo', 'nurse', 'reception']) expect((await (await as(who)).get('/api/analytics/waiting-times')).status).toBe(403);
  });

  it('the hospital admin gets whole finished months only, and no time below the minimum number of visits', async () => {
    await aDay();
    const res = await (await as('admin')).get('/api/analytics/waiting-times?period=month');
    expect(res.status).toBe(200);
    expect(res.body.period.key).toBe('last'); // "this month" is for doctors
    const rows = Array.from({ length: WAIT_MIN_N - 1 }, () => ({ moments: { arrived: null }, stages: { toRmo: 20 }, visitOn: new Date('2026-10-01T00:00:00Z') }));
    const few = summarise(rows, 'admin').stages.find((s) => s.key === 'toRmo');
    expect(few).toMatchObject({ median: null, p90: null, tooFew: true, n: null });
    const enough = summarise([...rows, ...rows], 'admin');
    expect(enough.stages.find((s) => s.key === 'toRmo')).toMatchObject({ median: 20, tooFew: false });
    expect(enough.visits % 5).toBe(0); // counts rounded for admins
  });

  it('the super admin gets numbers only, per hospital – no patient, no name of a patient, no list', async () => {
    await aDay();
    const root = await loginAs(await createSuperAdmin(), { app });
    const res = await root.agent.get('/api/platform/analytics/waiting-times?period=last');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hospitals.map((h) => h.name)).toContain('Timeline Hospital');
    expect(JSON.stringify(res.body)).not.toMatch(/Timeline Mother|P-0000|patientId|visitId/);
  });
});

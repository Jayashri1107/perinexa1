// Clinical Requirements Group B, item 15 (PX-OBG-12): the PPH chart – DRAFT steps and bands from published guidance
// until the manual page OBG-F-07 replaces them. Blood loss added up and banded, shock index worked out, every step
// with its time, medicines with the dose typed (never given by Perinexa), closed with how it ended. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/inpatient/pphRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { PPH_STEPS, lossBand, shockIndex, totalLoss } from '../src/clinical/pph.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PphChart } from '../src/models/PphChart.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
let app;
let hospital;
let other;
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
  hospital = await createTenant('PPH Hospital');
  other = await createTenant('Other PPH Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: 'Sample other doctor' });
  await addMember(people.otherDr, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function admitted() {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Pph Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const a = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-10T01:00:00.000Z', ward: 'Labour ward', bed: '2', reason: 'In labour' })).body.admission;
  return { p, a };
}
const start = async (who, p, a, over = {}) => (await as(who)).post('/api/pph').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, recognisedAt: '2026-11-10T04:00:00.000Z', ...over });
const line = async (who, chart, body) => (await as(who)).post(`/api/pph/${chart.id}/lines`).send(body);
const T = (min) => new Date(Date.UTC(2026, 10, 10, 4, min)).toISOString();

describe('the PPH rules (DRAFT)', () => {
  it('bands the blood loss (RCOG 52) and the shock index (Nathan 2015)', () => {
    expect([lossBand(400).band, lossBand(500).band, lossBand(1000).band, lossBand(1001).band, lossBand(2001).words]).toEqual(['normal', 'yellow', 'yellow', 'red', 'Major PPH – severe (over 2000 mL)']);
    expect(shockIndex(90, 120)).toEqual({ value: 0.75, band: 'normal' });
    expect(shockIndex(108, 120)).toEqual({ value: 0.9, band: 'yellow' });
    expect(shockIndex(140, 100)).toEqual({ value: 1.4, band: 'red' });
    expect(shockIndex(100, null)).toBeNull();
    expect(totalLoss([{ ml: 600 }, { ml: 300, cancelled: { reason: 'x' } }, { ml: 450 }])).toBe(1050);
  });

  it('the website has the same steps, bands and shock index', () => {
    expect(website.PPH_STEPS).toEqual(PPH_STEPS);
    for (const ml of [0, 499, 500, 1000, 1001, 2000, 2001]) expect(website.lossBand(ml)).toEqual(lossBand(ml));
    for (const [hr, sbp] of [[90, 120], [108, 120], [140, 100]]) expect(website.shockIndex(hr, sbp)).toEqual(shockIndex(hr, sbp));
  });
});

describe('the PPH chart of a stay', () => {
  it('adds up the blood loss, keeps each step with its time, works out the shock index, and closes with the outcome', async () => {
    const { p, a } = await admitted();
    const started = await start('nurse', p, a, { causes: ['tone'] });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    let c = started.body.chart;
    expect(c).toMatchObject({ status: 'open', totalLossMl: 0, causes: ['tone'], createdByName: 'Sample nurse' });

    expect((await line('nurse', c, { type: 'step', at: T(2), key: 'oxytocin' })).body.error.fields.dose).toBe('Write the dose given');
    await line('nurse', c, { type: 'step', at: T(1), key: 'help' });
    await line('nurse', c, { type: 'step', at: T(2), key: 'oxytocin', dose: 'as per protocol (sample)', route: 'IV' });
    await line('nurse', c, { type: 'loss', at: T(3), ml: 700, method: 'measured' });
    c = (await line('nurse', c, { type: 'loss', at: T(10), ml: 450, method: 'estimated' })).body.chart;
    expect(c).toMatchObject({ totalLossMl: 1150, loss: { band: 'red', words: 'Major PPH – moderate (1001 to 2000 mL)' } });
    c = (await line('nurse', c, { type: 'obs', at: T(12), hr: 124, sbp: 92, dbp: 58, spo2: 96 })).body.chart;
    expect(c.shock).toEqual({ value: 1.35, band: 'yellow' });
    expect(c.steps.map((s) => [s.key, s.byName])).toEqual([['help', 'Sample nurse'], ['oxytocin', 'Sample nurse']]);
    expect(c.steps[1]).toMatchObject({ dose: 'as per protocol (sample)', route: 'IV', at: T(2) });

    const wrong = c.losses[1];
    c = (await (await as('nurse')).post(`/api/pph/${c.id}/lines/${wrong.id}/cancel`).send({ reason: 'Counted twice' })).body.chart;
    expect(c.totalLossMl).toBe(700);
    expect(c.losses[1].cancelled).toMatchObject({ reason: 'Counted twice' });

    expect((await (await as('nurse')).post(`/api/pph/${c.id}/close`).send({ result: 'controlled', at: T(30) })).status).toBe(403); // her doctor or an RMO
    const closed = await (await as('drA')).post(`/api/pph/${c.id}/close`).send({ result: 'controlled', at: T(30), note: 'Uterus well contracted' });
    expect(closed.body.chart).toMatchObject({ status: 'closed', outcome: { result: 'controlled', byName: 'Sample drA' } });
    expect((await line('nurse', closed.body.chart, { type: 'loss', at: T(31), ml: 100, method: 'measured' })).status).toBe(409);

    const audited = await AuditLog.find({ tenantId: hospital._id, action: /^PPH_CHART/ }).lean();
    expect(audited.map((x) => x.action)).toEqual(expect.arrayContaining(['PPH_CHART_STARTED', 'PPH_CHART_LINE_ADDED', 'PPH_CHART_LINE_CANCELLED', 'PPH_CHART_CLOSED']));
    // ids only: no amount, dose or reading among the details (record ids are random, so no number is looked for in them)
    for (const x of audited) expect(Object.keys(x.details).filter((k) => ['ml', 'dose', 'route', 'hr', 'sbp', 'dbp', 'spo2', 'note'].includes(k))).toEqual([]);
    expect(JSON.stringify(audited)).not.toMatch(/protocol/);
  });

  it('checks the times and the readings', async () => {
    const { p, a } = await admitted();
    expect((await start('nurse', p, a, { recognisedAt: '2026-11-10T07:00:00.000Z' })).body.error.fields.recognisedAt).toMatch(/future/);
    expect((await start('nurse', p, a, { recognisedAt: '2026-11-09T07:00:00.000Z' })).body.error.fields.recognisedAt).toMatch(/before she was admitted/);
    const c = (await start('nurse', p, a)).body.chart;
    expect((await line('nurse', c, { type: 'loss', at: '2026-11-10T03:00:00.000Z', ml: 200, method: 'measured' })).body.error.fields.at).toMatch(/before the bleeding/);
    expect((await line('nurse', c, { type: 'obs', at: T(5) })).body.error.fields.hr).toMatch(/at least one/);
    expect((await line('nurse', c, { type: 'obs', at: T(5), sbp: 100 })).body.error.fields.sbp).toMatch(/both/);
    expect((await line('nurse', c, { type: 'step', at: T(5), key: 'other' })).body.error.fields.note).toMatch(/what was done/);
    const set = await (await as('nurse')).post(`/api/pph/${c.id}/causes`).send({ causes: ['tone', 'trauma'] });
    expect(set.body.chart.causes).toEqual(['tone', 'trauma']);
  });

  it('a chart started by mistake is marked entered in error; reception, another hospital and a baby have none', async () => {
    const { p, a } = await admitted();
    const c = (await start('rmo', p, a)).body.chart;
    const x = await (await as('rmo')).post(`/api/pph/${c.id}/cancel`).send({ reason: 'Wrong patient' });
    expect(x.body.chart.cancelled).toMatchObject({ reason: 'Wrong patient' });
    expect(await PphChart.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect((await (await as('reception')).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`)).status).toBe(403);
    expect((await (await as('otherDr')).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`)).status).toBe(404);
    const list = await (await as('drA')).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`);
    expect(list.body.charts).toHaveLength(1);
    expect(list.body.rules.source).toMatch(/RCOG Green-top Guideline 52/);
  });
});

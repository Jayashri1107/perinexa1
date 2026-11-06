// Clinical Requirements Group B, item 8 (PX-OBG-11): the MEOWS chart – DRAFT rules from the published CEMACH chart
// until the manual page OBG-F-05 replaces them. One red or two yellow readings is a trigger and needs whom you told.
// Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/inpatient/meowsRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { MEOWS_PARAMETERS, MEOWS_SOURCE, bandOf, meowsResult, toCelsius } from '../src/clinical/meows.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { MeowsEntry } from '../src/models/MeowsEntry.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('MEOWS Hospital');
  other = await createTenant('Other MEOWS Hospital');
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
async function admitted(careType = 'postnatal') {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType, fullName: 'Meows Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const a = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-10T01:00:00.000Z', ward: 'Postnatal ward', bed: '3', reason: 'After delivery' })).body.admission;
  return { p, a };
}
const record = async (who, p, a, over = {}) => (await as(who)).post('/api/meows').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-10T05:30:00.000Z', ...over });
const NORMAL = { rr: 16, spo2: 98, temp: 36.8, sbp: 118, dbp: 76, hr: 84, avpu: 'A' };

describe('the MEOWS rules (DRAFT)', () => {
  it('puts each reading in its band, with the edges where the published chart puts them', () => {
    expect([bandOf('rr', 9), bandOf('rr', 10), bandOf('rr', 20), bandOf('rr', 21), bandOf('rr', 30), bandOf('rr', 31)]).toEqual(['red', 'normal', 'normal', 'yellow', 'yellow', 'red']);
    expect([bandOf('spo2', 94), bandOf('spo2', 95)]).toEqual(['red', 'normal']);
    expect([bandOf('tempC', 34.9), bandOf('tempC', 35), bandOf('tempC', 35.9), bandOf('tempC', 36), bandOf('tempC', 37.9), bandOf('tempC', 38)]).toEqual(['red', 'yellow', 'yellow', 'normal', 'normal', 'red']);
    expect([bandOf('sbp', 89), bandOf('sbp', 90), bandOf('sbp', 100), bandOf('sbp', 150), bandOf('sbp', 160)]).toEqual(['red', 'yellow', 'normal', 'yellow', 'red']);
    expect([bandOf('dbp', 89), bandOf('dbp', 90), bandOf('dbp', 100)]).toEqual(['normal', 'yellow', 'red']);
    expect([bandOf('hr', 39), bandOf('hr', 40), bandOf('hr', 50), bandOf('hr', 100), bandOf('hr', 120)]).toEqual(['red', 'yellow', 'normal', 'yellow', 'red']);
    expect([bandOf('avpu', 'A'), bandOf('avpu', 'V'), bandOf('avpu', 'P'), bandOf('avpu', 'U'), bandOf('avpu', null)]).toEqual(['normal', 'yellow', 'red', 'red', null]);
    expect(toCelsius(100.4)).toBe(38);
    expect(MEOWS_SOURCE).toMatch(/CEMACH/);
  });

  it('one red or two yellow is a trigger; one yellow is watch', () => {
    expect(meowsResult({ rr: 16, hr: 84 }).level).toBe('normal');
    expect(meowsResult({ rr: 22, hr: 84 }).level).toBe('watch');
    expect(meowsResult({ rr: 22, hr: 105 }).level).toBe('trigger');
    expect(meowsResult({ spo2: 93 }).level).toBe('trigger');
    expect(meowsResult({ rr: 16 }).missing).toEqual(['spo2', 'tempC', 'sbp', 'dbp', 'hr', 'avpu']);
  });

  it('the website colours the readings with the same table', () => {
    expect(website.MEOWS_PARAMETERS).toEqual(MEOWS_PARAMETERS);
    for (const v of [{ rr: 22, hr: 105 }, { spo2: 93 }, { tempC: 35.5 }, { sbp: 155, dbp: 95 }, { avpu: 'V' }, {}]) expect(website.meowsResult(v), JSON.stringify(v)).toEqual(meowsResult(v));
  });
});

describe('the MEOWS chart of a stay', () => {
  it('a nurse records observations; the server works out the bands and the level', async () => {
    const { p, a } = await admitted();
    const saved = await record('nurse', p, a, NORMAL);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.entry).toMatchObject({ level: 'normal', byName: 'Sample nurse', values: { tempC: 36.8 } });
    const f = await record('nurse', p, a, { rr: 22, temp: 99, tempUnit: 'F', at: '2026-11-10T05:40:00.000Z' });
    expect(f.body.entry).toMatchObject({ level: 'watch', values: { tempC: 37.2 }, bands: { rr: 'yellow', tempC: 'normal' } });
    const chart = await (await as('drA')).get(`/api/meows?patientId=${p.id}&admissionId=${a.id}`);
    expect(chart.body.entries.map((e) => e.level)).toEqual(['watch', 'normal']); // newest first
    expect(chart.body.latest.level).toBe('watch');
  });

  it('a trigger needs whom you told; the audit log has the level, never the readings', async () => {
    const { p, a } = await admitted();
    const refused = await record('nurse', p, a, { ...NORMAL, sbp: 165, dbp: 105 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.escalatedTo).toMatch(/tell the doctor now/);
    const ok = await record('nurse', p, a, { ...NORMAL, sbp: 165, dbp: 105, escalatedTo: 'Dr Sample (on call)' });
    expect(ok.body.entry).toMatchObject({ level: 'trigger', escalatedTo: 'Dr Sample (on call)', bands: { sbp: 'red', dbp: 'red' } });
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'MEOWS_RECORDED' }).lean();
    expect(entry.details).toMatchObject({ patientId: p.id, level: 'trigger' });
    expect(Object.keys(entry.details).sort()).toEqual(['admissionId', 'entryId', 'level', 'mrn', 'patientId']); // never the readings
  });

  it('checks the readings and the time; a mistake is marked entered in error, never deleted', async () => {
    const { p, a } = await admitted();
    expect((await record('nurse', p, a, {})).body.error.fields.rr).toMatch(/at least one/);
    expect((await record('nurse', p, a, { sbp: 120 })).body.error.fields.sbp).toMatch(/both/);
    expect((await record('nurse', p, a, { temp: 37, tempUnit: 'F' })).body.error.fields.temp).toMatch(/°C/);
    expect((await record('nurse', p, a, { ...NORMAL, at: '2026-11-10T07:00:00.000Z' })).body.error.fields.at).toMatch(/future/);
    expect((await record('nurse', p, a, { ...NORMAL, at: '2026-11-09T07:00:00.000Z' })).body.error.fields.at).toMatch(/before she was admitted/);
    const e = (await record('nurse', p, a, NORMAL)).body.entry;
    const c = await (await as('nurse')).post(`/api/meows/${e.id}/cancel`).send({ reason: 'Wrong patient' });
    expect(c.body.entry.cancelled).toMatchObject({ reason: 'Wrong patient', byName: 'Sample nurse' });
    expect(await MeowsEntry.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect((await (await as('drA')).get(`/api/meows?patientId=${p.id}&admissionId=${a.id}`)).body.latest).toBeNull();
  });

  it('reception and the admin have no chart; another hospital never finds the stay; not on a baby', async () => {
    const { p, a } = await admitted();
    for (const who of ['reception', 'admin']) expect((await (await as(who)).get(`/api/meows?patientId=${p.id}&admissionId=${a.id}`)).status, who).toBe(403);
    expect((await (await as('otherDr')).get(`/api/meows?patientId=${p.id}&admissionId=${a.id}`)).status).toBe(404);
    const baby = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'Baby Meows', ageYears: undefined, assignedDoctor: people.drA._id.toString(), newborn: { birthAt: '2026-11-09T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } }))).body.patient;
    expect((await (await as('drA')).get(`/api/meows?patientId=${baby.id}&admissionId=${a.id}`)).status).toBe(400);
  });
});

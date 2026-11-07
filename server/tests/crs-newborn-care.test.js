// Clinical Requirements Group B, items 12 and 13 (PX-NEO-01, 02, 04, 16): the newborn at birth and on the ward, the
// bilirubin readings with hours of age, the CCHD rule, and the NICU / SNCU admission and outcome register. DRAFT.
// Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/newborn/newbornCareRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { BIRTH_CHECKS, EXAM_ITEMS, cchdResult, coldAtAdmission } from '../src/clinical/newbornCare.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('Newborn Care Hospital');
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
const baby = async () => (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'Baby Care', ageYears: undefined, assignedDoctor: people.drA._id.toString(), newborn: { birthAt: '2026-11-09T06:00:00.000Z', birthWeightGrams: 2100, sex: 'female' } }))).body.patient;
const allYes = () => Object.fromEntries(BIRTH_CHECKS.map((c) => [c.key, 'yes']));
const allNormal = () => Object.fromEntries(EXAM_ITEMS.map((i) => [i.key, 'normal']));

describe('the newborn rules (DRAFT)', () => {
  it('CCHD (AAP 2020): pass, repeat once, refer', () => {
    expect([cchdResult(97, 96), cchdResult(95, 91), cchdResult(93, 94), cchdResult(93, 94, 2), cchdResult(88, 89), cchdResult(null, 96)]).toEqual(['pass', 'repeat', 'repeat', 'refer', 'refer', null]);
    expect([coldAtAdmission(36.4), coldAtAdmission(36.5), coldAtAdmission(null)]).toEqual([true, false, false]);
  });
  it('the website uses the same lists and CCHD rule', () => {
    expect([website.BIRTH_CHECKS, website.EXAM_ITEMS]).toEqual([BIRTH_CHECKS, EXAM_ITEMS]);
    for (const [h, f, a] of [[97, 96, 1], [95, 91, 1], [93, 94, 2], [88, 89, 1]]) expect(website.cchdResult(h, f, a)).toBe(cchdResult(h, f, a));
  });
});

describe("a baby's care", () => {
  it('the record at birth once; an examination with every part; bilirubin with hours of age', async () => {
    const b = await baby();
    const nurse = await as('nurse');
    expect((await nurse.post('/api/newborn-care/birth').send({ patientId: b.id, criedAtBirth: 'yes', resuscitation: 'none', cordClamping: 'delayed', checks: { ...allYes(), vitaminK: 'na' } })).body.error.fields['checks.vitaminK']).toBe('Answer yes or no');
    expect((await nurse.post('/api/newborn-care/birth').send({ patientId: b.id, criedAtBirth: 'yes', resuscitation: 'none', cordClamping: 'delayed', checks: { ...allYes(), eyeCare: 'no' } })).body.error.fields.note).toMatch(/why a step/);
    expect((await nurse.post('/api/newborn-care/birth').send({ patientId: b.id, criedAtBirth: 'yes', resuscitation: 'stimulation', cordClamping: 'delayed', checks: allYes(), temperatureC: 36.8 })).body.error.fields['witness.email']).toMatch(/second person/);
    expect((await nurse.post('/api/newborn-care/birth').send({ patientId: b.id, criedAtBirth: 'yes', resuscitation: 'stimulation', cordClamping: 'delayed', checks: allYes(), temperatureC: 36.8, witness: { email: people.drA.email, password: PASSWORD } })).status).toBe(201);
    expect((await nurse.post('/api/newborn-care/birth').send({ patientId: b.id, criedAtBirth: 'yes', resuscitation: 'none', cordClamping: 'delayed', checks: allYes() })).status).toBe(409);

    const ex = await (await as('drA')).post('/api/newborn-care/exam').send({ patientId: b.id, examinedAt: '2026-11-10T04:00:00.000Z', weightGrams: 2050, findings: { ...allNormal(), hips: 'abnormal' } });
    expect(ex.body.error.fields['notes.hips']).toBe('Write what was found');
    expect((await (await as('drA')).post('/api/newborn-care/exam').send({ patientId: b.id, examinedAt: '2026-11-10T04:00:00.000Z', findings: { general: 'normal' } })).body.error.fields['findings.eyes']).toMatch(/normal/);
    expect((await (await as('drA')).post('/api/newborn-care/exam').send({ patientId: b.id, examinedAt: '2026-11-10T04:00:00.000Z', weightGrams: 2050, findings: { ...allNormal(), hips: 'abnormal' }, notes: { hips: 'Clicky left hip – ultrasound (sample)' }, ready: { feeding: 'yes', urine: 'yes', stool: 'yes', temperature: 'yes' } })).status).toBe(201);

    await nurse.post('/api/newborn-care/bilirubin').send({ patientId: b.id, at: '2026-11-10T00:00:00.000Z', mgdl: 8.5, method: 'skin' });
    expect((await nurse.post('/api/newborn-care/bilirubin').send({ patientId: b.id, at: '2026-11-09T05:00:00.000Z', mgdl: 4, method: 'serum' })).body.error.fields.at).toMatch(/before the baby was born/);
    const all = await (await as('drA')).get(`/api/newborn-care?patientId=${b.id}`);
    expect(all.body.birth[0]).toMatchObject({ resuscitation: 'stimulation', temperatureC: 36.8, byName: 'Sample nurse', idBandWitness: { byName: 'Sample drA', role: 'Doctor' } });
    expect(all.body.exams[0]).toMatchObject({ weightGrams: 2050, findings: { hips: 'abnormal' } });
    expect(all.body.bilirubin).toEqual([expect.objectContaining({ hours: 18, mgdl: 8.5, method: 'skin' })]);
  });

  it('a NICU admission with its register number; one open at a time; the outcome by a doctor; the month register', async () => {
    const b = await baby();
    const admit = async (over = {}) => (await as('nurse')).post('/api/newborn-care/nicu').send({ clientRequestId: randomUUID(), patientId: b.id, unit: 'sncu', source: 'inborn', admittedAt: '2026-11-09T07:00:00.000Z', reasons: ['lbw', 'hypothermia'], weightGrams: 2100, temperatureC: 35.9, gestationWeeks: 35, ...over });
    expect((await admit({ reasons: [] })).body.error.fields.reasons).toMatch(/why/);
    const a = await admit();
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.admission).toMatchObject({ serial: 1, cold: true, ageHours: 1, outcome: null });
    expect((await admit()).status).toBe(409);
    expect((await (await as('nurse')).post(`/api/newborn-care/nicu/${a.body.admission.id}/outcome`).send({ result: 'discharged', at: '2026-11-10T05:00:00.000Z' })).status).toBe(403);
    const closed = await (await as('drA')).post(`/api/newborn-care/nicu/${a.body.admission.id}/outcome`).send({ result: 'discharged', at: '2026-11-10T05:00:00.000Z' });
    expect(closed.body.admission).toMatchObject({ outcome: { result: 'discharged', byName: 'Sample drA' }, stayDays: 1 });
    const reg = await (await as('drA')).get('/api/newborn-care/register?month=2026-11');
    expect(reg.body.totals).toMatchObject({ admissions: 1, inborn: 1, cold: 1, stillAdmitted: 0, outcomes: { discharged: 1, died: 0 } });
    expect(reg.body.rows[0]).toMatchObject({ serial: 1, baby: { fullName: 'Baby Care' } });
    const dash = await (await as('drA')).get('/api/dashboards?department=newborn&month=2026-11');
    expect(dash.body.rows.find((r) => r.key === 'nicuAdmissions').value).toBe(1);
    expect((await (await as('admin')).get('/api/dashboards?department=newborn&month=2026-11')).body.rows.map((r) => r.key)).not.toContain('nicuDeaths');
  });

  it('only on a baby’s record; reception has none; a mistake is marked entered in error', async () => {
    const b = await baby();
    const mother = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await (await as('drA')).get(`/api/newborn-care?patientId=${mother.id}`)).status).toBe(400);
    expect((await (await as('reception')).get(`/api/newborn-care?patientId=${b.id}`)).status).toBe(403);
    const r = await (await as('nurse')).post('/api/newborn-care/bilirubin').send({ patientId: b.id, at: '2026-11-10T00:00:00.000Z', mgdl: 9, method: 'serum' });
    expect((await (await as('nurse')).post(`/api/newborn-care/bilirubin/${r.body.id}/cancel`).send({ reason: 'Wrong baby' })).status).toBe(200);
    expect((await (await as('drA')).get(`/api/newborn-care?patientId=${b.id}`)).body.bilirubin[0].cancelled).toMatchObject({ reason: 'Wrong baby' });
  });
});

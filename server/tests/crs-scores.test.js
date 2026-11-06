// Clinical Requirements Group A, item 5 (PX-OBG-19, PX-OBG-17 score and advice): the EPDS from the ten answers' scores
// (never the questions) and the VTE risk score (RCOG 37a) with its advice and no dose. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/scores/scoreRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { VTE_FACTORS, epdsResult, vteConflict, vteResult } from '../src/clinical/scores.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist' };
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
  hospital = await createTenant('Score Hospital');
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
async function registered(careType = 'postnatal') {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType, fullName: 'Score Mother', assignedDoctor: people.drA._id.toString(), ...(careType === 'antenatal' ? { pregnancy: { scanEdd: '2027-03-01' } } : {}) }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const add = async (who, body) => (await as(who)).post('/api/clinical-scores').send({ clientRequestId: randomUUID(), on: '2026-11-10', ...body });

describe('the EPDS', () => {
  it('adds up the ten scores; 10–12 possible, 13 or more likely; any score on question 10 means assess today', () => {
    expect(epdsResult([1, 1, 1, 1, 1, 1, 1, 1, 1, 0])).toMatchObject({ total: 9, band: 'unlikely', selfHarm: false });
    expect(epdsResult([1, 1, 1, 1, 1, 1, 1, 1, 2, 0])).toMatchObject({ total: 10, band: 'possible' });
    expect(epdsResult([2, 2, 2, 2, 2, 1, 1, 1, 0, 0])).toMatchObject({ total: 13, band: 'likely' });
    const harm = epdsResult([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(harm).toMatchObject({ total: 1, band: 'unlikely', selfHarm: true });
    expect(harm.advice[0]).toMatch(/self-harm today/);
  });

  it('is recorded from the paper form and shown without the questions', async () => {
    const p = await registered();
    expect((await add('nurse', { patientId: p.id, kind: 'epds', phase: 'postnatal', epdsScores: [1, 2, 3] })).body.error.fields.epdsScores).toMatch(/all ten/);
    expect((await add('nurse', { patientId: p.id, kind: 'epds', phase: 'postnatal', epdsScores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 4] })).status).toBe(400);
    const saved = await add('nurse', { patientId: p.id, kind: 'epds', phase: 'postnatal', epdsScores: [2, 2, 2, 2, 2, 1, 1, 1, 0, 1] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.score).toMatchObject({ kind: 'epds', total: 14, band: 'likely', selfHarm: true, byName: 'Sample nurse' });
    const list = await (await as('drA')).get(`/api/clinical-scores?patientId=${p.id}`);
    expect(list.body.scores).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/laugh|blamed|anxious|harming myself/i); // no EPDS question text
    const entries = await AuditLog.find({ tenantId: hospital._id, action: 'CLINICAL_SCORE_ADDED' }).lean();
    expect(entries[0].details).toEqual({ patientId: p.id, mrn: p.mrn, scoreId: saved.body.score.id, kind: 'epds' });
  });
});

describe('the VTE risk score (RCOG 37a)', () => {
  it('antenatal: 4 or more from the first trimester, 3 from 28 weeks; never a dose', () => {
    expect(vteResult('antenatal', ['age_over_35', 'bmi_30', 'smoker'])).toMatchObject({ total: 3, band: 'intermediate' });
    expect(vteResult('antenatal', ['previous_vte'])).toMatchObject({ total: 4, band: 'high' });
    expect(vteResult('antenatal', ['smoker']).band).toBe('low');
    expect(vteResult('antenatal', ['cs_in_labour']).total).toBe(0); // a delivery factor is not counted before birth
    expect(vteResult('antenatal', ['previous_vte']).advice[1]).toMatch(/verified row of the formulary/);
  });

  it('postnatal: 2 or more – 10 days; previous VTE, high-risk thrombophilia or LMWH before birth – 6 weeks', () => {
    expect(vteResult('postnatal', ['cs_in_labour'])).toMatchObject({ total: 2, band: 'intermediate' });
    expect(vteResult('postnatal', ['smoker']).band).toBe('low');
    expect(vteResult('postnatal', ['thrombophilia_high']).band).toBe('high');
    expect(vteResult('postnatal', [], { antenatalLmwh: true }).band).toBe('high');
    expect(vteConflict(['bmi_30', 'bmi_40'])).toBe('Choose one BMI band');
    expect(vteConflict(['cs_elective', 'cs_in_labour'])).toBe('Choose one kind of caesarean');
  });

  it('the website ticks the same factors with the same scores and gives the same result', () => {
    expect(website.VTE_FACTORS).toEqual(VTE_FACTORS);
    for (const [phase, keys] of [['antenatal', ['age_over_35', 'bmi_30', 'smoker']], ['postnatal', ['cs_in_labour', 'pph']], ['postnatal', ['previous_vte']], ['antenatal', []]]) {
      expect(website.vteResult(phase, keys), `${phase} ${keys}`).toEqual(vteResult(phase, keys));
    }
    expect(website.epdsResult([2, 2, 2, 2, 2, 1, 1, 1, 0, 1])).toEqual(epdsResult([2, 2, 2, 2, 2, 1, 1, 1, 0, 1]));
  });

  it('is saved with its advice; a factor of the other phase is refused; a mistake is marked entered in error', async () => {
    const p = await registered('antenatal');
    expect((await add('drA', { patientId: p.id, kind: 'vte', phase: 'antenatal', vteFactors: ['cs_in_labour'] })).body.error.fields.vteFactors).toMatch(/not counted before birth/);
    const saved = await add('drA', { patientId: p.id, kind: 'vte', phase: 'antenatal', vteFactors: ['age_over_35', 'bmi_30', 'smoker'] });
    expect(saved.body.score).toMatchObject({ total: 3, band: 'intermediate', advice: ['Score 3: consider thromboprophylaxis from 28 weeks.', expect.stringMatching(/formulary/)] });
    const cancelled = await (await as('drA')).post(`/api/clinical-scores/${saved.body.score.id}/cancel`).send({ reason: 'Wrong patient' });
    expect(cancelled.body.score.cancelled).toMatchObject({ reason: 'Wrong patient', byName: 'Sample drA' });
    expect((await (await as('reception')).get(`/api/clinical-scores?patientId=${p.id}`)).status).toBe(403);
    const gynae = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', assignedDoctor: people.drA._id.toString() }));
    expect((await add('drA', { patientId: gynae.body.patient.id, kind: 'vte', phase: 'antenatal', vteFactors: [] })).status).toBe(400);
  });
});

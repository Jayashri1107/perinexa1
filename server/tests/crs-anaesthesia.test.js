// Clinical Requirements Group B, items 9 and 10 (PX-ANA-01, PX-ANA-03): the pre-anaesthesia check-up (ASA, airway,
// fasting, fitness – signed by a doctor or RMO) and the pain chart (score, POSS sedation). DRAFT. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/anaesthesia/anaesthesiaRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { ASA, fastingHours, pacMissing, painBand, sedationBand } from '../src/clinical/anaesthesia.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
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
  hospital = await createTenant('Anaesthesia Hospital');
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
const registered = async () => (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName: 'Pac Patient', assignedDoctor: people.drA._id.toString() }))).body.patient;
const PAC = { assessedAt: '2026-11-10T04:00:00.000Z', procedure: 'Laparoscopy', asa: '2', airwayMallampati: '2', plannedAnaesthesia: 'general', risksExplained: true, fitness: 'fit', lastSolidAt: '2026-11-09T20:00:00.000Z', lastClearAt: '2026-11-10T01:00:00.000Z' };

describe('the anaesthesia rules (DRAFT)', () => {
  it('a check-up needs ASA, airway, plan, fitness and risks explained; conditions need their words', () => {
    expect(pacMissing(PAC)).toEqual({});
    expect(Object.keys(pacMissing({}))).toEqual(['asa', 'airwayMallampati', 'plannedAnaesthesia', 'fitness', 'risksExplained']);
    expect(pacMissing({ ...PAC, fitness: 'conditions' }).fitnessNote).toMatch(/conditions/);
    expect(fastingHours('2026-11-10T04:00:00Z', '2026-11-09T20:00:00Z', '2026-11-10T03:00:00Z')).toEqual({ solid: 8, clear: 1, solidOk: true, clearOk: false });
    expect([painBand(0).words, painBand(3).band, painBand(5).band, painBand(8).band]).toEqual(['No pain', 'normal', 'yellow', 'red']);
    expect([sedationBand(2).band, sedationBand(3).band]).toEqual(['normal', 'red']);
    expect(Object.keys(ASA)).toEqual(['1', '2', '3', '4', '5']);
  });
  it('the website has the same lists and rules', () => {
    expect(website.ASA).toEqual(ASA);
    expect(website.pacMissing({ fitness: 'defer' })).toEqual(pacMissing({ fitness: 'defer' }));
    for (const s of [0, 3, 4, 7, 10]) expect(website.painBand(s)).toEqual(painBand(s));
  });
});

describe('the pre-anaesthesia check-up', () => {
  it('signed in one go by a doctor or RMO; nurses read it; shown on her theatre case', async () => {
    const p = await registered();
    const post = async (who, body) => (await as(who)).post('/api/anaesthesia/pac').send({ clientRequestId: randomUUID(), patientId: p.id, ...body });
    expect((await post('nurse', PAC)).status).toBe(403);
    const refused = await post('drA', { ...PAC, fitness: 'conditions' });
    expect(refused.body.error.fields.fitnessNote).toMatch(/conditions/);
    expect((await post('drA', { ...PAC, lastSolidAt: '2026-11-10T05:00:00.000Z' })).body.error.fields.lastSolidAt).toMatch(/after the check-up/);
    const ok = await post('drA', PAC);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.assessment).toMatchObject({ asa: '2', fitness: 'fit', byName: 'Sample drA', role: 'Doctor', fasting: { solid: 8, clear: 3, solidOk: true, clearOk: true } });
    expect((await (await as('nurse')).get(`/api/anaesthesia/pac?patientId=${p.id}`)).body.assessments).toHaveLength(1);
    const c = (await (await as('drA')).post('/api/theatre').send({ clientRequestId: randomUUID(), patientNo: p.mrn, listDate: '2026-11-10', procedure: 'Laparoscopy' })).body.case;
    expect((await (await as('nurse')).get(`/api/theatre/${c.id}`)).body.pac).toMatchObject({ asa: '2', fitness: 'fit', byName: 'Sample drA' });
    await (await as('drA')).post(`/api/anaesthesia/pac/${ok.body.assessment.id}/cancel`).send({ reason: 'Wrong patient' });
    expect((await (await as('nurse')).get(`/api/theatre/${c.id}`)).body.pac).toBeNull();
    expect((await (await as('reception')).get(`/api/anaesthesia/pac?patientId=${p.id}`)).status).toBe(403);
  });
});

describe('the pain chart', () => {
  it('scores with bands; too much sedation needs whom you told; severe pain needs what was done', async () => {
    const p = await registered();
    const a = (await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt: '2026-11-10T01:00:00.000Z', ward: 'Ward', bed: '5', reason: 'Surgery' })).body.admission;
    const post = async (body) => (await as('nurse')).post('/api/anaesthesia/pain').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-10T05:00:00.000Z', ...body });
    expect((await post({ score: 5, poss: '3' })).body.error.fields.escalatedTo).toMatch(/hold opioids/);
    expect((await post({ score: 8 })).body.error.fields.action).toMatch(/what was done/);
    const ok = await post({ score: 5, poss: '2', nausea: 'nausea' });
    expect(ok.body.entry).toMatchObject({ score: 5, pain: { band: 'yellow' }, sedation: { band: 'normal' }, byName: 'Sample nurse' });
    await post({ score: 8, action: 'Analgesia as charted (sample)', at: '2026-11-10T05:30:00.000Z' });
    const chart = await (await as('drA')).get(`/api/anaesthesia/pain?patientId=${p.id}&admissionId=${a.id}`);
    expect(chart.body.entries.map((e) => e.score)).toEqual([8, 5]);
    expect((await post({ score: 2, at: '2026-11-10T07:00:00.000Z' })).body.error.fields.at).toMatch(/future/);
  });
});

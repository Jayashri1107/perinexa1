// Clinical Requirements Group B, item 17 (PX-X-09, PX-OBG-32, PX-NEO-18, PX-ANA-08): monthly dashboards worked out from
// what Perinexa records, with the hospital's targets and a doctor's sign-off of a finished month. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { INDICATORS, againstTarget, rate } from '../src/clinical/dashboards.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', lead: 'quality', admin: 'admin' };
let app;
let hospital;
let other;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T06:00:00Z'));
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Dashboard Hospital');
  other = await createTenant('Other Dashboard Hospital');
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
const live = (over) => ({ outcome: 'live', sex: 'female', weightGrams: 3000, apgar1: 8, apgar5: 9, breastfedWithinHour: 'yes', nicu: 'no', ...over });
const BASE = { gestationWeeks: 39, labourOnset: 'spontaneous', parity: 'nullipara', presentation: 'cephalic', bloodLossMl: 300 };
async function delivered(content) {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Dash Mother', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-25' } }))).body.patient;
  const base = `/api/patients/${p.id}/admissions`;
  const a = (await (await as('rmo')).post(base).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-18T01:00:00.000Z', ward: 'Labour', bed: '1', reason: 'In labour' })).body.admission;
  const d = (await (await as('rmo')).post(`${base}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
  const s = (await (await as('rmo')).put(`${base}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content })).body.document;
  const signed = await (await as('drA')).post(`${base}/${a.id}/documents/${d.id}/sign`).send({ rev: s.rev });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return { p, a };
}
const dash = async (who, department, month = '2026-11') => (await as(who)).get(`/api/dashboards?department=${department}&month=${month}`);
const row = (res, key) => res.body.rows.find((r) => r.key === key);

describe('the dashboard rules (DRAFT)', () => {
  it('rates and targets', () => {
    expect(rate(1, 4)).toEqual({ value: 25, numerator: 1, denominator: 4 });
    expect(rate(1, 3, 'per1000')).toEqual({ value: 333.3, numerator: 1, denominator: 3 });
    expect(rate(0, 0).value).toBeNull();
    const cs = INDICATORS.find((i) => i.key === 'csRate');
    expect([againstTarget(cs, 20, 25), againstTarget(cs, 30, 25), againstTarget(cs, 30, null)]).toEqual(['met', 'missed', null]);
    expect(INDICATORS.every((i) => i.definition && i.label)).toBe(true);
  });
});

describe('the monthly dashboards', () => {
  it('obstetrics and newborn rows from the month’s confirmed delivery notes, MEOWS and scores', async () => {
    const { p, a } = await delivered({ ...BASE, deliveredAt: '2026-11-18T05:00:00.000Z', mode: 'normal', babies: [live({ weightGrams: 2300, apgar5: 6 })] });
    await delivered({ ...BASE, deliveredAt: '2026-11-18T06:00:00.000Z', mode: 'lscs', indication: 'Fetal distress', csCategory: '1', decisionAt: '2026-11-18T05:20:00.000Z', bloodLossMl: 1200, pph: 'yes', babies: [live({ breastfedWithinHour: 'not_applicable', nicu: 'yes' })] });
    await (await as('nurse')).post('/api/meows').send({ clientRequestId: randomUUID(), patientId: p.id, admissionId: a.id, at: '2026-11-18T07:00:00.000Z', spo2: 92, escalatedTo: 'Dr Sample' });
    const pn = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Dash Postnatal', assignedDoctor: people.drA._id.toString() }))).body.patient;
    await (await as('nurse')).post('/api/clinical-scores').send({ clientRequestId: randomUUID(), patientId: pn.id, kind: 'epds', on: '2026-11-19', phase: 'postnatal', epdsScores: [2, 2, 2, 2, 2, 1, 1, 1, 0, 0] });

    const obs = await dash('drA', 'obstetrics');
    expect(obs.status).toBe(200);
    expect(row(obs, 'deliveries').value).toBe(2);
    expect(row(obs, 'csRate')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(row(obs, 'csRobson1')).toMatchObject({ value: 50, denominator: 2 });
    expect(row(obs, 'cat1In30')).toMatchObject({ value: 0, numerator: 0, denominator: 1 }); // 40 minutes
    expect(row(obs, 'pphRate').value).toBe(50);
    expect(row(obs, 'majorPph').value).toBe(1);
    expect(row(obs, 'meowsTriggers').value).toBe(1);
    expect([row(obs, 'epdsScreened').value, row(obs, 'epdsLikely').value]).toEqual([1, 1]);
    expect(row(obs, 'stillbirths')).toMatchObject({ value: 0, denominator: 2 });

    const nb = await dash('drA', 'newborn');
    expect(row(nb, 'liveBirths').value).toBe(2);
    expect(row(nb, 'lbw')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(row(nb, 'bf1h')).toMatchObject({ value: 100, denominator: 1 }); // "not applicable" is left out
    expect(row(nb, 'apgarLow').value).toBe(50);
    expect(row(nb, 'nicu').value).toBe(50);
    expect(row(await dash('drA', 'obstetrics', '2026-10'), 'deliveries').value).toBe(0);
    expect(JSON.stringify(obs.body)).not.toMatch(/Dash Mother/); // numbers only
  });

  it('theatre and safety rows; targets set by a doctor or the quality lead', async () => {
    const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName: 'Dash Gynae', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const c = (await (await as('drA')).post('/api/theatre').send({ clientRequestId: randomUUID(), patientNo: p.mrn, listDate: '2026-11-20', procedure: 'Hysteroscopy', urgency: 'emergency', anaesthesia: 'general' })).body.case;
    const yes = (phase, items, extra = {}) => ({ answers: Object.fromEntries(items.map((k) => [k, ['allergy', 'airway', 'bloodLoss', 'equipment'].includes(k) ? 'no' : 'yes'])), notes: {}, ...extra });
    await (await as('drA')).post(`/api/theatre/${c.id}/checklist/signIn/confirm`).send(yes('signIn', ['identity', 'siteMarked', 'anaesthesiaCheck', 'oximeter', 'allergy', 'airway', 'bloodLoss']));
    await (await as('drA')).post(`/api/theatre/${c.id}/checklist/timeOut/confirm`).send(yes('timeOut', ['team', 'confirm', 'antibiotic', 'surgeonReview', 'anaesthetistReview', 'nursingReview', 'imaging']));
    await (await as('drA')).post(`/api/theatre/${c.id}/checklist/signOut/confirm`).send({ answers: { procedureRecorded: 'yes', counts: 'no', specimen: 'na', equipment: 'no', recovery: 'yes' }, notes: { counts: 'Swab found, recounted' }, witness: { email: people.nurse.email, password: PASSWORD } });
    await (await as('nurse')).post('/api/incidents').send({ clientRequestId: randomUUID(), occurredAt: '2026-11-19T03:00:00.000Z', kind: 'fall', severity: 'moderate', description: 'Sample fall.' });

    const th = await dash('drA', 'theatre');
    expect([row(th, 'operations').value, row(th, 'whoComplete').value, row(th, 'emergencyOps').value, row(th, 'countsWrong').value, row(th, 'gaRate').value]).toEqual([1, 100, 100, 1, 100]);
    const sf = await dash('lead', 'safety');
    expect([row(sf, 'incidents').value, row(sf, 'incidentsHarm').value, row(sf, 'incidentsClosed').value]).toEqual([1, 1, 0]);

    expect((await (await as('nurse')).put('/api/dashboards/targets').send({ key: 'whoComplete', target: 100 })).status).toBe(403);
    expect((await (await as('lead')).put('/api/dashboards/targets').send({ key: 'operations', target: 10 })).body.error.fields.target).toMatch(/counted, not judged/);
    expect((await (await as('lead')).put('/api/dashboards/targets').send({ key: 'whoComplete', target: 101 })).body.error.fields.target).toMatch(/at most 100/);
    await (await as('lead')).put('/api/dashboards/targets').send({ key: 'whoComplete', target: 100 });
    await (await as('drA')).put('/api/dashboards/targets').send({ key: 'countsWrong', target: 0 });
    const th2 = await dash('drA', 'theatre');
    expect(row(th2, 'whoComplete')).toMatchObject({ target: 100, status: 'met', targetSetBy: 'Sample lead' });
    expect(row(th2, 'countsWrong')).toMatchObject({ target: 0, status: 'missed' });
  });

  it('a doctor signs off a finished month once; the rows are kept as they were; the admin sees no sensitive rows', async () => {
    await delivered({ ...BASE, deliveredAt: '2026-11-18T05:00:00.000Z', mode: 'normal', babies: [live()] });
    expect((await (await as('drA')).post('/api/dashboards/signoff').send({ department: 'obstetrics', month: '2026-11' })).body.error.fields.month).toMatch(/once it is over/);
    vi.setSystemTime(new Date('2026-12-02T06:00:00Z'));
    sessions = {};
    expect((await dash('drA', 'obstetrics')).body.access.signOff).toBe(true);
    expect((await (await as('lead')).post('/api/dashboards/signoff').send({ department: 'obstetrics', month: '2026-11' })).status).toBe(403);
    const s = await (await as('drA')).post('/api/dashboards/signoff').send({ department: 'obstetrics', month: '2026-11', comment: 'Reviewed at the monthly meeting.' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect((await (await as('drA')).post('/api/dashboards/signoff').send({ department: 'obstetrics', month: '2026-11' })).status).toBe(409);
    await delivered({ ...BASE, deliveredAt: '2026-11-25T05:00:00.000Z', mode: 'normal', babies: [live()] }); // typed in later
    const after = await dash('drA', 'obstetrics');
    expect(row(after, 'deliveries').value).toBe(2);
    expect(after.body.signoff.rows.find((r) => r.key === 'deliveries').value).toBe(1);
    expect(after.body.signoff).toMatchObject({ byName: 'Sample drA', comment: 'Reviewed at the monthly meeting.' });

    const admin = await dash('admin', 'obstetrics');
    expect(admin.body.rows.map((r) => r.key)).not.toContain('stillbirths');
    expect(admin.body.rows.map((r) => r.key)).not.toContain('epdsLikely');
    expect((await (await as('nurse')).get('/api/dashboards?department=obstetrics&month=2026-11')).status).toBe(403);
    expect(row(await dash('otherDr', 'obstetrics'), 'deliveries').value).toBe(0);
  });
});

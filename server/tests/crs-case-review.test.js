// Clinical Requirements Group C: the maternal death and near-miss review (PX-OBG-30, DRAFT lists) with corrections and
// sealing (PX-X-05). A doctor seals a finished review; it never changes again – a correction is added on top. Doctors,
// RMOs and the quality lead only; kept out of her record. Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { CAUSES, NEAR_MISS_CRITERIA, REVIEW_SOURCE } from '../src/clinical/caseReview.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CaseReview } from '../src/models/CaseReview.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', quality: 'quality', nurse: 'nurse', admin: 'admin' };
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
  hospital = await createTenant('Review Hospital');
  other = await createTenant('Other Review Hospital');
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
async function mother(over = {}) {
  return (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Review Mother', assignedDoctor: people.drA._id.toString(), ...over }))).body.patient;
}
const start = async (who, p, over = {}) => (await as(who)).post('/api/case-reviews').send({ mrn: p.mrn, kind: 'near_miss', eventAt: '2026-11-08T22:00:00.000Z', ...over });
const FULL = {
  summary: 'PPH after vaginal birth, 2.5 L, four units transfused, hysterectomy.',
  criteria: ['hysterectomy', 'shock'],
  cause: 'haemorrhage',
  delays: { delay1: { answer: 'no' }, delay2: { answer: 'no' }, delay3: { answer: 'yes', note: 'Blood took 50 minutes' } },
  avoidable: 'possibly',
  lessons: 'Keep two units cross-matched for women with a previous PPH.',
  actions: [{ text: 'Blood bank drill', owner: 'Sister in charge', dueOn: '2026-12-01' }],
  meetingOn: '2026-11-10',
  members: 'Dr A, Dr B, Sister in charge',
};

describe('the review lists (DRAFT)', () => {
  it('are marked DRAFT with their sources', () => {
    expect(REVIEW_SOURCE).toMatch(/^DRAFT.*near-miss.*ICD-MM.*MDSR/);
    expect(NEAR_MISS_CRITERIA.length).toBeGreaterThan(15);
    expect(Object.keys(CAUSES)).toContain('haemorrhage');
  });
});

describe('maternal death and near-miss reviews', () => {
  it('a review is started, filled in, sealed by a doctor, and then only corrected', async () => {
    const p = await mother();
    const s = await start('quality', p);
    expect(s.status).toBe(201);
    const id = s.body.review.id;
    expect(s.body.review).toMatchObject({ serial: 1, kind: 'near_miss', status: 'draft', patient: { mrn: p.mrn } });

    // not finished: sealing names what is missing
    let seal = await (await as('drA')).post(`/api/case-reviews/${id}/seal`).send({});
    expect(seal.status).toBe(400);
    expect(Object.keys(seal.body.error.fields)).toEqual(expect.arrayContaining(['summary', 'criteria', 'cause', 'delays.delay1', 'avoidable', 'meetingOn']));

    const saved = await (await as('rmo')).patch(`/api/case-reviews/${id}`).send(FULL);
    expect(saved.status).toBe(200);
    expect(saved.body.review.delays.delay3).toEqual({ answer: 'yes', note: 'Blood took 50 minutes' });

    // only a doctor seals
    expect((await (await as('quality')).post(`/api/case-reviews/${id}/seal`).send({})).status).toBe(403);
    seal = await (await as('drA')).post(`/api/case-reviews/${id}/seal`).send({});
    expect(seal.status).toBe(200);
    expect(seal.body.review).toMatchObject({ status: 'sealed', sealed: { byName: 'Sample drA' }, access: { edit: false, correct: true } });

    // sealed: no change, a correction instead – the sealed text stays as signed
    expect((await (await as('drA')).patch(`/api/case-reviews/${id}`).send({ summary: 'Changed' })).status).toBe(409);
    const c = await (await as('quality')).post(`/api/case-reviews/${id}/corrections`).send({ part: 'summary', should: 'Five units transfused, not four.', reason: 'Blood bank register checked' });
    expect(c.status).toBe(201);
    expect(c.body.review.summary).toBe(FULL.summary);
    expect(c.body.review.corrections).toEqual([expect.objectContaining({ part: 'summary', should: 'Five units transfused, not four.', byName: 'Sample quality' })]);

    // the model refuses a change to a sealed review whatever the path
    const doc = await CaseReview.findOne({ _id: id, tenantId: hospital._id });
    doc.summary = 'Edited behind the scenes';
    await expect(doc.save()).rejects.toThrow(/sealed review cannot be changed/);

    const log = await AuditLog.find({ action: /^CASE_REVIEW/ }).lean();
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['CASE_REVIEW_STARTED', 'CASE_REVIEW_SAVED', 'CASE_REVIEW_SEALED', 'CASE_REVIEW_CORRECTED']));
    expect(JSON.stringify(log)).not.toContain('PPH after');
  });

  it('a correction needs a sealed review, a part, what it should say and why', async () => {
    const p = await mother();
    const id = (await start('drA', p)).body.review.id;
    expect((await (await as('drA')).post(`/api/case-reviews/${id}/corrections`).send({ part: 'summary', should: 'x y', reason: 'Because' })).status).toBe(409);
    await (await as('drA')).patch(`/api/case-reviews/${id}`).send(FULL);
    await (await as('drA')).post(`/api/case-reviews/${id}/seal`).send({});
    const bad = await (await as('drA')).post(`/api/case-reviews/${id}/corrections`).send({ part: 'summary', should: '', reason: '' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['should', 'reason']));
  });

  it('lists the deaths of mothers in the last year that have no review; one death review per mother', async () => {
    const p = await mother();
    await Patient.updateOne({ _id: p.id, tenantId: hospital._id }, { $set: { death: { on: new Date('2026-11-09T00:00:00Z'), byName: 'Sample drA' } } });
    let list = (await (await as('quality')).get('/api/case-reviews')).body;
    expect(list.awaiting).toEqual([expect.objectContaining({ mrn: p.mrn })]);
    expect(list.rules.source).toMatch(/^DRAFT/);
    expect((await start('drA', p, { kind: 'maternal_death' })).status).toBe(201);
    expect((await start('drA', p, { kind: 'maternal_death' })).status).toBe(409);
    list = (await (await as('quality')).get('/api/case-reviews')).body;
    expect(list.awaiting).toEqual([]);
    expect(list.reviews).toHaveLength(1);
  });

  it('nurses, the hospital admin and another hospital cannot see them; a baby or a future time is refused', async () => {
    const p = await mother();
    const id = (await start('drA', p)).body.review.id;
    expect((await (await as('nurse')).get('/api/case-reviews')).status).toBe(403);
    expect((await (await as('admin')).get(`/api/case-reviews/${id}`)).status).toBe(403);
    expect((await (await as('otherDr')).get(`/api/case-reviews/${id}`)).status).toBe(404);
    expect((await start('drA', p, { eventAt: '2026-11-11T06:00:00.000Z' })).status).toBe(400);
    expect((await start('drA', { mrn: 'P-999999' })).status).toBe(400);
    const baby = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'Review Baby', assignedDoctor: people.drA._id.toString() }))).body.patient;
    if (baby?.mrn) expect((await start('drA', baby)).status).toBe(400);
  });

  it('nothing of the review is shown on her record', async () => {
    const p = await mother();
    const id = (await start('drA', p)).body.review.id;
    await (await as('drA')).patch(`/api/case-reviews/${id}`).send(FULL);
    const rec = await (await as('drA')).get(`/api/patients/${p.id}`);
    expect(JSON.stringify(rec.body)).not.toContain('PPH after vaginal birth');
  });
});

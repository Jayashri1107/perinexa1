// Doctor ideas (owner, 16 Oct 2026 – docs/IDEAS_FOR_LATER.md): the server parts of Same as last visit (#2), typing
// shortcuts (#3), nothing gets lost (#4), the pregnancy timeline (#7), your day so far (#9) and the keepsake card (#10).
// Fake data only. 28 Sep 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { VisitDraft } from '../src/models/VisitDraft.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', nurse: 'nurse', reception: 'receptionist' };
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
  hospital = await createTenant('Ideas Hospital');
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
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Ideas Mother', ageYears: 28, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const url = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
async function newVisit(who, p) {
  const res = await (await as(who)).post(url(p)).send({ clientRequestId: randomUUID() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.visit;
}

describe('typing shortcuts (#3)', () => {
  it("are each person's own; a baby's sex is never kept", async () => {
    const a = await as('drA');
    expect((await a.put('/api/me/shortcuts').send({ key: '.FU2', text: 'Follow up after 2 weeks with CBC report' })).body.shortcut).toMatchObject({ key: 'fu2' });
    expect((await a.put('/api/me/shortcuts').send({ key: 'fu2', text: 'Follow up after 2 weeks' })).status).toBe(200); // changed
    expect((await a.put('/api/me/shortcuts').send({ key: 'x y', text: 'a' })).status).toBe(400);
    expect((await a.put('/api/me/shortcuts').send({ key: 'sx', text: 'Male fetus seen' })).status).toBe(400);
    expect((await a.get('/api/me/shortcuts')).body.shortcuts).toEqual([expect.objectContaining({ key: 'fu2', text: 'Follow up after 2 weeks' })]);
    expect((await (await as('drB')).get('/api/me/shortcuts')).body.shortcuts).toEqual([]);
    const id = (await a.get('/api/me/shortcuts')).body.shortcuts[0].id;
    expect((await (await as('drB')).delete(`/api/me/shortcuts/${id}`)).status).toBe(404);
    expect((await a.delete(`/api/me/shortcuts/${id}`)).status).toBe(204);
  });
});

describe('nothing gets lost (#4) and same as last visit (#2)', () => {
  it("keeps the author's unsaved typing, only for them; never a baby's sex; Today lists it", async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const a = await as('drA');
    expect((await a.get(url(p, `/${v.id}/draft`))).body.draft).toBeNull();
    const put = await a.put(url(p, `/${v.id}/draft`)).send({ part: 'details', data: { details: { complaints: 'Mild back pain' }, vitals: {}, ticked: [] } });
    expect(put.body).toMatchObject({ kept: true });
    await a.put(url(p, `/${v.id}/draft`)).send({ part: 'rx', data: { rows: [{ drug: 'Sample Iron' }], notes: '' } });
    expect((await a.get(url(p, `/${v.id}/draft`))).body.draft).toMatchObject({ details: { details: { complaints: 'Mild back pain' } }, rx: { rows: [{ drug: 'Sample Iron' }] } });
    // Another doctor sees nothing of it
    expect((await (await as('drB')).get(url(p, `/${v.id}/draft`))).body.draft).toBeNull();
    // Today: Continue her visit
    expect((await a.get('/api/visit-drafts')).body.drafts).toEqual([expect.objectContaining({ visitId: v.id, patient: expect.objectContaining({ fullName: 'Ideas Mother' }), parts: ['details', 'rx'] })]);
    // A baby's sex is never kept
    const sex = await a.put(url(p, `/${v.id}/draft`)).send({ part: 'details', data: { details: { advice: 'It is a boy' } } });
    expect(sex.body).toEqual({ kept: false });
    expect((await a.get(url(p, `/${v.id}/draft`))).body.draft.details).toBeNull();
    // Saving clears the part (the form sends nothing unsaved); both empty: gone
    await a.put(url(p, `/${v.id}/draft`)).send({ part: 'rx', data: null });
    expect(await VisitDraft.countDocuments({ tenantId: hospital._id })).toBe(0);
    // Reception (no visits) may not keep one
    expect((await (await as('reception')).put(url(p, `/${v.id}/draft`)).send({ part: 'rx', data: { rows: [] } })).status).toBe(403);
  });

  it("offers the last visit's medicines, instructions and advice", async () => {
    const p = await register();
    const v1 = await newVisit('drA', p);
    const a = await as('drA');
    expect((await a.patch(url(p, `/${v1.id}`)).send({ details: { rev: 0, advice: 'Rest and fluids' } })).status).toBe(200);
    expect((await a.put(url(p, `/${v1.id}/prescription`)).send({ rev: 0, items: [{ drug: 'Sample Iron', form: 'tab', frequency: '1-0-0' }], notes: 'After food' })).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-12T06:00:00Z'));
    sessions = {};
    const v2 = await newVisit('drA', p);
    const page = (await (await as('drA')).get(url(p, `/${v2.id}`))).body;
    expect(page.previousPrescription).toMatchObject({ items: [expect.objectContaining({ drug: 'Sample Iron' })], notes: 'After food', advice: 'Rest and fluids' });
  });
});

describe('the pregnancy timeline (#7), your day (#9), the keepsake card (#10)', () => {
  it('gives the visit days and the plan items of this pregnancy', async () => {
    const p = await register();
    await newVisit('drA', p);
    const t = (await (await as('drA')).get(`/api/patients/${p.id}/timeline`)).body;
    expect(t.edd).toBe('2027-03-01T00:00:00.000Z');
    expect(t.visits).toHaveLength(1);
    expect(t.items.length).toBeGreaterThan(0);
    expect(t.items[0]).toEqual(expect.objectContaining({ kind: expect.any(String), name: expect.any(String), dueBy: expect.any(String) }));
    // Reception does not see the pregnancy
    expect((await (await as('reception')).get(`/api/patients/${p.id}/timeline`)).status).toBe(403);
  });

  it("counts a doctor's own day: seen, not signed, lab reports to review", async () => {
    const p = await register();
    await newVisit('drA', p);
    await LabOrder.create({ tenantId: hospital._id, patientId: p.id, clientRequestId: randomUUID(), status: 'reported', ordered: { by: people.drA._id, byName: 'Sample drA', at: NOW }, tests: [{ key: 'hb', name: 'Haemoglobin (Hb)' }] });
    expect((await (await as('drA')).get('/api/my-day')).body.day).toEqual({ seen: 1, notSigned: 1, labToReview: 1, missedHighRisk: 0, cashToConfirm: 0 });
    expect((await (await as('drB')).get('/api/my-day')).body.day).toEqual({ seen: 0, notSigned: 0, labToReview: 0, missedHighRisk: 0, cashToConfirm: 0 });
    expect((await (await as('reception')).get('/api/my-day')).body.day).toBeNull();
  });

  it("records each keepsake card printed – only for a baby's own record", async () => {
    const mother = await register();
    const baby = await register({ careType: 'newborn', fullName: 'Baby of Ideas Mother', ageYears: undefined, pregnancy: undefined, newborn: { birthAt: '2026-09-27T04:30:00Z', birthWeightGrams: 3100, sex: 'female', mother: mother.id } });
    expect((await (await as('drA')).post(`/api/patients/${mother.id}/keepsake-printed`)).status).toBe(403);
    expect((await (await as('drA')).post(`/api/patients/${baby.id}/keepsake-printed`)).status).toBe(200);
    const entry = await AuditLog.findOne({ action: 'KEEPSAKE_CARD_PRINTED' }).lean();
    expect(entry.details).toEqual({ patientId: baby.id, mrn: baby.mrn });
  });
});

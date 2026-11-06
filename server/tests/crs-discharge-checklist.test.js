// Clinical Requirements Group B, item 14 (PX-OBG-18, PX-COM-03): the postnatal discharge checklist with danger-sign
// teaching and teach-back – DRAFT from WHO 2022 and MoHFW until OBG-F-11 and OBG-P-03 replace it. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/inpatient/postnatalRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { DANGER_SIGNS_BABY, DANGER_SIGNS_MOTHER, DANGER_SIGN_KEYS, DISCHARGE_ITEMS, missingToComplete } from '../src/clinical/postnatalDischarge.js';
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
  hospital = await createTenant('Discharge Hospital');
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
async function admitted(careType = 'postnatal') {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType, fullName: 'Discharge Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
  const a = (await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-08T01:00:00.000Z', ward: 'Postnatal ward', bed: '4', reason: 'After delivery' })).body.admission;
  return { p, a };
}
const allYes = () => Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, 'yes']));
const FULL = { items: allYes(), dangerSigns: DANGER_SIGN_KEYS, teachBack: { done: true, by: 'mother', language: 'mr' }, followUpOn: '2026-11-13' };
const save = async (who, p, a, rev, body) => (await as(who)).put('/api/discharge-checklist').send({ patientId: p.id, admissionId: a.id, rev, ...body });

describe('the checklist rules (DRAFT)', () => {
  it('needs every check answered, every danger sign explained, teach-back done, and the next visit date', () => {
    expect(missingToComplete(FULL)).toEqual({});
    const m = missingToComplete({});
    expect(Object.keys(m)).toEqual([...DISCHARGE_ITEMS.map((i) => `items.${i.key}`), 'dangerSigns', 'teachBack.done']);
    expect(missingToComplete({ ...FULL, items: { ...allYes(), vitals: 'na' } })['items.vitals']).toBe('Answer yes or no');
    expect(missingToComplete({ ...FULL, items: { ...allYes(), antiD: 'na' } })).toEqual({}); // anti-D may not apply
    expect(missingToComplete({ ...FULL, dangerSigns: DANGER_SIGN_KEYS.slice(1) }).dangerSigns).toMatch(/every danger sign/);
    expect(missingToComplete({ ...FULL, teachBack: { done: true, by: '' } })['teachBack.by']).toBe('Who said them back');
    expect(missingToComplete({ ...FULL, followUpOn: null }).followUpOn).toMatch(/date/);
    expect([DANGER_SIGNS_MOTHER.length, DANGER_SIGNS_BABY.length]).toEqual([10, 8]);
  });

  it('the website lists the same checks and danger signs', () => {
    expect(website.DISCHARGE_ITEMS).toEqual(DISCHARGE_ITEMS);
    expect([website.DANGER_SIGNS_MOTHER, website.DANGER_SIGNS_BABY]).toEqual([DANGER_SIGNS_MOTHER, DANGER_SIGNS_BABY]);
    expect(website.missingToComplete({ ...FULL, followUpOn: null })).toEqual(missingToComplete({ ...FULL, followUpOn: null }));
  });
});

describe('the checklist of a stay', () => {
  it('saved as a draft, refused as complete while something is missing, then completed and locked', async () => {
    const { p, a } = await admitted();
    expect((await (await as('nurse')).get(`/api/discharge-checklist?patientId=${p.id}&admissionId=${a.id}`)).body.checklist).toBeNull();
    let c = (await save('nurse', p, a, -1, { items: { vitals: 'yes' } })).body.checklist;
    expect(c).toMatchObject({ status: 'draft', rev: 0, savedByName: 'Sample nurse' });
    expect(c.missing['items.uterus']).toBe('Answer this');
    expect((await save('nurse', p, a, -1, {})).status).toBe(409); // one per stay
    const early = await (await as('nurse')).post(`/api/discharge-checklist/${c.id}/complete`).send({ rev: c.rev });
    expect(early.status).toBe(400);
    expect(early.body.error.fields['teachBack.done']).toMatch(/say the danger signs back/);
    c = (await save('nurse', p, a, 0, FULL)).body.checklist;
    expect(c.missing).toEqual({});
    expect((await save('drA', p, a, 0, FULL)).status).toBe(409); // an older version
    const done = await (await as('nurse')).post(`/api/discharge-checklist/${c.id}/complete`).send({ rev: c.rev });
    expect(done.body.checklist).toMatchObject({ status: 'complete', completed: { byName: 'Sample nurse' }, followUpOn: '2026-11-13', teachBack: { done: true, by: 'mother', language: 'mr' } });
    expect((await save('nurse', p, a, c.rev, FULL)).body.error.message).toMatch(/locked/);
    const audited = await AuditLog.find({ tenantId: hospital._id, action: /^DISCHARGE_CHECKLIST/ }).lean();
    expect(audited.map((x) => x.action)).toEqual(expect.arrayContaining(['DISCHARGE_CHECKLIST_SAVED', 'DISCHARGE_CHECKLIST_COMPLETED']));
  });

  it('one filled in by mistake is marked entered in error and a new one can be started; not applicable only where allowed', async () => {
    const { p, a } = await admitted();
    expect((await save('nurse', p, a, -1, { items: { vitals: 'na' } })).body.error.fields['items.vitals']).toBe('Answer yes or no');
    const c = (await save('nurse', p, a, -1, { items: { antiD: 'na' } })).body.checklist;
    expect(c.items.antiD).toBe('na');
    const x = await (await as('nurse')).post(`/api/discharge-checklist/${c.id}/cancel`).send({ reason: 'Wrong mother' });
    expect(x.body.checklist.cancelled).toMatchObject({ reason: 'Wrong mother' });
    expect((await save('nurse', p, a, -1, {})).status).toBe(200);
    const list = await (await as('drA')).get(`/api/discharge-checklist?patientId=${p.id}&admissionId=${a.id}`);
    expect(list.body.earlier).toHaveLength(1);
    expect(list.body.checklist.status).toBe('draft');
  });

  it('reception has none; not for a gynaecology patient', async () => {
    const { p, a } = await admitted();
    expect((await (await as('reception')).get(`/api/discharge-checklist?patientId=${p.id}&admissionId=${a.id}`)).status).toBe(403);
    const g = await admitted('gynaecology');
    expect((await (await as('drA')).get(`/api/discharge-checklist?patientId=${g.p.id}&admissionId=${g.a.id}`)).status).toBe(400);
  });
});

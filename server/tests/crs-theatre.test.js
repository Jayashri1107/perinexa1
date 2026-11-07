// Clinical Requirements Group B, item 16 (PX-OT-01, PX-OT-02): the theatre list and the WHO Surgical Safety Checklist –
// sign in, time out, sign out, in order, each confirmed once and then locked. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/theatre/whoRules.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { PHASES, missingInPhase } from '../src/clinical/whoChecklist.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', admin: 'admin' };
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
  hospital = await createTenant('Theatre Hospital');
  other = await createTenant('Other Theatre Hospital');
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
const registered = async (over = {}) => (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName: 'Theatre Patient', assignedDoctor: people.drA._id.toString(), ...over }))).body.patient;
const add = async (who, p, over = {}) => (await as(who)).post('/api/theatre').send({ clientRequestId: randomUUID(), patientNo: p.mrn, listDate: '2026-11-10', theatre: 'Theatre 1', order: 1, procedure: 'Laparoscopic cystectomy', site: 'Right ovary', urgency: 'elective', surgeon: 'Dr Sample', anaesthetist: 'Dr Sample Anaesthetist', anaesthesia: 'general', ...over });
const allYes = (phase, over = {}) => ({ answers: { ...Object.fromEntries(PHASES[phase].items.map((i) => [i.key, i.kind === 'question' ? 'no' : 'yes'])), ...over }, notes: {} });
const confirm = async (who, c, phase, body) => (await as(who)).post(`/api/theatre/${c.id}/checklist/${phase}/confirm`).send(body);

describe('the WHO checklist rules', () => {
  it('checks must be done (or not applicable where allowed); a yes to a question needs its note; wrong counts need a note', () => {
    expect(missingInPhase('signIn', allYes('signIn').answers)).toEqual({});
    expect(missingInPhase('signIn', {})['answers.identity']).toBe('Answer this');
    expect(missingInPhase('signIn', allYes('signIn', { oximeter: 'no' }).answers)['answers.oximeter']).toMatch(/must be done/);
    expect(missingInPhase('signIn', allYes('signIn', { siteMarked: 'na' }).answers)).toEqual({});
    expect(missingInPhase('signIn', allYes('signIn', { identity: 'na' }).answers)['answers.identity']).toBe('Answer yes');
    expect(missingInPhase('signIn', allYes('signIn', { allergy: 'yes' }).answers)['notes.allergy']).toBe('Which allergy');
    expect(missingInPhase('signIn', allYes('signIn', { allergy: 'yes' }).answers, { allergy: 'Penicillin' })).toEqual({});
    expect(missingInPhase('signOut', allYes('signOut', { counts: 'no' }).answers)['notes.counts']).toMatch(/report an incident/);
    expect(Object.values(PHASES).map((p) => p.items.length)).toEqual([7, 7, 5]);
  });

  it('the website uses the same checklist', () => {
    expect(website.PHASES).toEqual(PHASES);
    expect(website.missingInPhase('signOut', { counts: 'no' })).toEqual(missingInPhase('signOut', { counts: 'no' }));
  });
});

describe('the theatre list', () => {
  it('a case goes on the day’s list; sign in, time out and sign out are confirmed in order and locked; the status follows', async () => {
    const p = await registered();
    const added = await add('nurse', p);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const c = added.body.case;
    expect(c).toMatchObject({ status: 'planned', patient: { fullName: 'Theatre Patient' }, progress: { signIn: null, timeOut: null, signOut: null } });
    expect((await add('nurse', p, { patientNo: 'P-999999' })).body.error.fields.patientNo).toMatch(/No patient/);

    const list = await (await as('drA')).get('/api/theatre?date=2026-11-10');
    expect(list.body.cases.map((x) => x.procedure)).toEqual(['Laparoscopic cystectomy']);
    expect((await (await as('drA')).get('/api/theatre?date=2026-11-11')).body.cases).toEqual([]);

    expect((await confirm('nurse', c, 'timeOut', allYes('timeOut'))).body.error.message).toMatch(/sign in first/);
    const saved = await (await as('nurse')).put(`/api/theatre/${c.id}/checklist/signIn`).send({ answers: { identity: 'yes' }, notes: {} });
    expect(saved.body.case.checklist.signIn.answers.identity).toBe('yes');
    const refused = await confirm('nurse', c, 'signIn', { answers: { identity: 'yes' }, notes: {} });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields['answers.oximeter']).toBe('Answer this');
    const signIn = await confirm('nurse', c, 'signIn', allYes('signIn', { allergy: 'yes' }));
    expect(signIn.body.error.fields['notes.allergy']).toBe('Which allergy');
    const ok = await confirm('nurse', c, 'signIn', { ...allYes('signIn', { allergy: 'yes' }), notes: { allergy: 'Penicillin' } });
    expect(ok.body.case).toMatchObject({ status: 'in_theatre', progress: { signIn: { byName: 'Sample nurse', role: 'Nurse' } } });
    expect((await confirm('drA', c, 'signIn', allYes('signIn'))).status).toBe(409); // locked
    await confirm('drA', c, 'timeOut', allYes('timeOut', { imaging: 'na' }));
    const noWitness = await confirm('nurse', c, 'signOut', allYes('signOut', { specimen: 'na' }));
    expect(noWitness.body.error.fields['witness.email']).toMatch(/second person/);
    const done = await confirm('nurse', c, 'signOut', { ...allYes('signOut', { specimen: 'na' }), witness: { email: people.drA.email, password: PASSWORD } });
    expect(done.body.case).toMatchObject({ status: 'done', progress: { timeOut: { byName: 'Sample drA', role: 'Doctor' }, signOut: { byName: 'Sample nurse' } }, checklist: { signOut: { witness: { byName: 'Sample drA', role: 'Doctor' } } } });
    expect((await (await as('nurse')).post(`/api/theatre/${c.id}/cancel`).send({ reason: 'Not needed now' })).status).toBe(409);

    const audited = await AuditLog.find({ tenantId: hospital._id, action: 'THEATRE_CHECKLIST_CONFIRMED' }).lean();
    expect(audited.map((x) => x.details.phase)).toEqual(['signIn', 'timeOut', 'signOut']);
    expect(JSON.stringify(audited)).not.toMatch(/Penicillin/);
  });

  it('a case taken off the list keeps its reason; reception, the admin and another hospital see nothing; a sensitive record only in full', async () => {
    const p = await registered();
    const c = (await add('drA', p)).body.case;
    const x = await (await as('drA')).post(`/api/theatre/${c.id}/cancel`).send({ reason: 'Patient unwell today' });
    expect(x.body.case).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Patient unwell today' } });
    expect((await (await as('drA')).put(`/api/theatre/${c.id}/checklist/signIn`).send({ answers: {}, notes: {} })).status).toBe(409);
    for (const who of ['reception', 'admin']) expect((await (await as(who)).get('/api/theatre?date=2026-11-10')).status, who).toBe(403);
    expect((await (await as('otherDr')).get(`/api/theatre/${c.id}`)).status).toBe(404);

    const secret = await registered({ fullName: 'Sensitive Theatre Patient', careType: 'infertility' });
    await add('drA', secret, { procedure: 'Hysteroscopy', order: 2 });
    const names = async (who) => (await (await as(who)).get('/api/theatre?date=2026-11-10')).body.cases.map((k) => k.patient.fullName);
    expect(await names('drA')).toContain('Sensitive Theatre Patient');
    expect(await names('nurse')).not.toContain('Sensitive Theatre Patient');
  });
});

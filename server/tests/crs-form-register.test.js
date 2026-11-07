// Clinical Requirements Group C (PX-X-02, PX-X-03): the document register – each controlled form's versions, recorded by
// the quality lead, approved by a doctor, in force from a day until the next approved version; the version in force on
// a record's day goes on its printout. Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { FORM_REGISTER_SOURCE, FORM_SCREENS } from '../src/clinical/formRegister.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', quality: 'quality', admin: 'admin', reception: 'receptionist' };
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
  app = createApp();
  hospital = await createTenant('Register Hospital');
  other = await createTenant('Other Register Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherQ = await createUser({ name: 'Sample other quality' });
  await addMember(people.otherQ, other, 'quality');
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const record = async (who, over = {}) => (await as(who)).post('/api/forms').send({ screen: 'who_checklist', code: 'obg-f-16', title: 'Surgical safety checklist', version: '1.0', effectiveFrom: '2026-10-01', reviewDue: '2027-10-01', ...over });
const inForce = async (who, q) => (await (await as(who)).get('/api/forms/in-force').query(q)).body.form;

describe('the document register', () => {
  it('lists the screens as DRAFT with the codes known', () => {
    expect(FORM_REGISTER_SOURCE).toMatch(/^DRAFT/);
    expect(FORM_SCREENS.who_checklist.code).toBe('OBG-F-16');
  });

  it('a version is recorded, approved by a doctor and then in force; a later one supersedes it from its day', async () => {
    const v1 = (await record('quality')).body.version;
    expect(v1).toMatchObject({ code: 'OBG-F-16', state: 'draft', recorded: { byName: 'Sample quality' } });
    expect(await inForce('reception', { screen: 'who_checklist' })).toBeNull();

    expect((await (await as('quality')).post(`/api/forms/${v1.id}/approve`).send({})).status).toBe(403);
    const ok = await (await as('drA')).post(`/api/forms/${v1.id}/approve`).send({});
    expect(ok.body.version.approved.byName).toBe('Sample drA');
    expect((await (await as('drA')).post(`/api/forms/${v1.id}/approve`).send({})).status).toBe(409);

    const v2 = (await record('admin', { version: '2.0', effectiveFrom: '2026-12-01', reviewDue: '' })).body.version;
    await (await as('drA')).post(`/api/forms/${v2.id}/approve`).send({});

    // what goes on a printout: the version in force on the record's day – everyone in the hospital may ask
    expect(await inForce('reception', { screen: 'who_checklist', on: '2026-11-05' })).toMatchObject({ code: 'OBG-F-16', version: '1.0' });
    expect(await inForce('nurse', { screen: 'who_checklist', on: '2026-12-02' })).toMatchObject({ version: '2.0' });
    expect(await inForce('nurse', { screen: 'who_checklist', on: '2026-09-30' })).toBeNull();

    const reg = (await (await as('nurse')).get('/api/forms')).body;
    expect(reg.versions.map((v) => [v.version, v.state])).toEqual([
      ['2.0', 'future'],
      ['1.0', 'in_force'],
    ]);
    expect(reg.access).toEqual({ record: false, approve: false });
    expect(await AuditLog.countDocuments({ action: /^FORM_VERSION_/ })).toBe(4);
  });

  it('refuses a duplicate version, a review before the start, a reader recording; a draft is withdrawn with a reason', async () => {
    const v = (await record('quality')).body.version;
    expect((await record('quality')).body.error.fields.version).toMatch(/already/);
    expect((await record('quality', { version: '1.1', reviewDue: '2026-09-01' })).body.error.fields.reviewDue).toMatch(/after/);
    expect((await record('drA', { version: '3.0' })).status).toBe(403);
    expect((await (await as('reception')).get('/api/forms')).status).toBe(403);
    const w = await (await as('quality')).post(`/api/forms/${v.id}/withdraw`).send({ reason: 'Wrong code typed' });
    expect(w.body.version).toMatchObject({ state: 'withdrawn', withdrawn: { reason: 'Wrong code typed' } });
    expect((await (await as('drA')).post(`/api/forms/${v.id}/approve`).send({})).status).toBe(409);
    expect((await record('quality')).status).toBe(201); // the same version again once the mistaken one is withdrawn
  });

  it('another hospital has its own register', async () => {
    const v = (await record('quality')).body.version;
    await (await as('drA')).post(`/api/forms/${v.id}/approve`).send({});
    expect(await inForce('otherQ', { screen: 'who_checklist', on: '2026-11-05' })).toBeNull();
    expect((await (await as('otherQ')).post(`/api/forms/${v.id}/withdraw`).send({ reason: 'Not mine' })).status).toBe(404);
  });
});

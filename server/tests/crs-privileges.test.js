// Clinical Requirements Group C (PX-X-07): clinical privileges – DRAFT list. The hospital admin or the quality lead
// grants them to named staff (until a day) and ends them with a reason; doctors, RMOs and nurses read the register; the
// theatre case shows whether the surgeon and the anaesthetist hold the privilege. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { PRIVILEGES, PRIVILEGE_SOURCE } from '../src/clinical/privileges.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', quality: 'quality', admin: 'admin', reception: 'receptionist' };
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
  hospital = await createTenant('Privilege Hospital');
  other = await createTenant('Other Privilege Hospital');
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
const grant = async (who, user, key, over = {}) => (await as(who)).post('/api/privileges').send({ userId: people[user]._id.toString(), key, ...over });

describe('the privileges list (DRAFT)', () => {
  it('is marked DRAFT and every privilege has words', () => {
    expect(PRIVILEGE_SOURCE).toMatch(/^DRAFT/);
    for (const p of Object.values(PRIVILEGES)) expect(p.label.length).toBeGreaterThan(5);
    expect(PRIVILEGES.mtp_surgical.law).toMatch(/MTP Act/);
  });
});

describe('the privileges register', () => {
  it('the quality lead grants and ends a privilege; doctors read the register', async () => {
    const g = await grant('quality', 'drA', 'caesarean', { validUntil: '2027-11-09' });
    expect(g.status).toBe(201);
    expect(g.body.privilege).toMatchObject({ key: 'caesarean', state: 'in_force', validUntil: '2027-11-09', byName: 'Sample quality' });
    expect((await grant('admin', 'drA', 'caesarean')).status).toBe(409);

    const reg = (await (await as('drB')).get('/api/privileges')).body;
    const a = reg.staff.find((s) => s.name === 'Sample drA');
    expect(a.privileges).toEqual([expect.objectContaining({ label: 'Caesarean section', state: 'in_force' })]);
    expect(reg.staff.map((s) => s.name)).not.toContain('Sample reception');
    expect(reg.access.keep).toBe(false);

    const end = await (await as('admin')).post(`/api/privileges/${g.body.privilege.id}/end`).send({ reason: 'Left the hospital' });
    expect(end.status).toBe(200);
    expect(end.body.privilege).toMatchObject({ state: 'ended', ended: { reason: 'Left the hospital', byName: 'Sample admin' } });
    expect((await grant('admin', 'drA', 'caesarean')).status).toBe(201);
    expect(await AuditLog.countDocuments({ action: { $in: ['PRIVILEGE_GRANTED', 'PRIVILEGE_ENDED'] } })).toBe(3);
  });

  it('refuses the wrong person, role, day or keeper', async () => {
    expect((await grant('drA', 'drB', 'caesarean')).status).toBe(403);
    expect((await grant('quality', 'nurse', 'caesarean')).body.error.fields.key).toMatch(/for a doctor/);
    expect((await grant('quality', 'nurse', 'newborn_resuscitation')).status).toBe(201);
    expect((await grant('quality', 'reception', 'newborn_resuscitation')).status).toBe(400);
    expect((await grant('quality', 'otherDr', 'caesarean')).status).toBe(400);
    expect((await grant('quality', 'drA', 'hysterectomy', { validUntil: '2026-11-01' })).body.error.fields.validUntil).toMatch(/passed/);
    expect((await (await as('reception')).get('/api/privileges')).status).toBe(403);
  });

  it('a privilege past its last day has lapsed', async () => {
    await grant('quality', 'drA', 'laparoscopy', { validUntil: '2026-11-12' });
    vi.setSystemTime(new Date('2026-11-14T06:00:00Z'));
    sessions = {};
    const reg = (await (await as('quality')).get('/api/privileges')).body;
    expect(reg.staff.find((s) => s.name === 'Sample drA').privileges[0].state).toBe('lapsed');
  });

  it('the theatre case shows the surgeon and anaesthetist checks', async () => {
    const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Theatre Mother', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const add = (over) => as('drA').then((s) => s.post('/api/theatre').send({ clientRequestId: randomUUID(), patientNo: p.mrn, listDate: '2026-11-11', procedure: 'Lower segment caesarean section', anaesthesia: 'spinal', ...over }));
    await grant('quality', 'drA', 'caesarean');
    const c1 = (await add({ surgeon: 'Dr Sample drA', anaesthetist: 'Sample drB', privilegeKey: 'caesarean' })).body.case;
    let view = (await (await as('nurse')).get(`/api/theatre/${c1.id}`)).body;
    expect(view.privileges.surgeon).toMatchObject({ state: 'in_force', label: 'Caesarean section' });
    expect(view.privileges.anaesthetist).toMatchObject({ state: 'none', label: 'Spinal and epidural anaesthesia' });
    expect(view.rules.privileges.caesarean).toBe('Caesarean section');

    const c2 = (await add({ surgeon: 'Visiting surgeon', anaesthesia: '' })).body.case;
    view = (await (await as('nurse')).get(`/api/theatre/${c2.id}`)).body;
    expect(view.privileges.surgeon.state).toBe('not_set');
    expect(view.privileges.anaesthetist.state).toBe('not_set');
    const c3 = (await add({ surgeon: 'Visiting surgeon', privilegeKey: 'caesarean' })).body.case;
    expect((await (await as('nurse')).get(`/api/theatre/${c3.id}`)).body.privileges.surgeon.state).toBe('not_staff');
  });
});

// Super admin: managing hospitals and user accounts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AUDIT_CATEGORIES, AuditLog } from '../src/models/AuditLog.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import {
  PASSWORD,
  addMember,
  connectTestDb,
  createSuperAdmin,
  createTenant,
  createUser,
  disconnectTestDb,
  loginAs,
  resetTestDb,
  samplePatient,
} from './helpers.js';

const app = createApp();
let root;
let s; // logged-in super admin session

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  root = await createSuperAdmin({ name: 'Root Admin', email: 'root@example.com' });
  s = await loginAs(root, { app });
});
afterAll(disconnectTestDb);

const noSecrets = (body) => expect(JSON.stringify(body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);

describe('access control', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/platform/tenants')).status).toBe(401);
    expect((await request(app).get('/api/platform/users')).status).toBe(401);
  });

  it('blocks everyone except super admins, including hospital admins', async () => {
    const tenant = await createTenant();
    const hospitalAdmin = await createUser();
    await addMember(hospitalAdmin, tenant, 'admin');
    const h = await loginAs(hospitalAdmin, { app });
    for (const url of ['/api/platform/tenants', '/api/platform/users', '/api/platform/audit-logs']) {
      expect((await h.get(url)).status).toBe(403);
    }
    expect((await h.post('/api/platform/tenants').send({ name: 'Sneaky' })).status).toBe(403);
  });
});

describe('hospitals', () => {
  it('creates a hospital and lists it with member counts', async () => {
    const res = await s.agent.post('/api/platform/tenants').send({ name: 'Riverside Hospital' });
    expect(res.status).toBe(201);
    expect(res.body.tenant).toMatchObject({ name: 'Riverside Hospital', isActive: true, members: 0, admins: 0 });
    expect(await AuditLog.countDocuments({ action: 'TENANT_CREATED' })).toBe(1);

    const list = await s.agent.get('/api/platform/tenants');
    expect(list.body.total).toBe(1);
    expect(list.body.tenants[0].name).toBe('Riverside Hospital');
  });

  it('rejects duplicate (case-insensitive) and invalid names', async () => {
    await s.agent.post('/api/platform/tenants').send({ name: 'Riverside Hospital' });
    const dup = await s.agent.post('/api/platform/tenants').send({ name: 'riverside hospital' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toHaveProperty('name');
    expect((await s.agent.post('/api/platform/tenants').send({ name: '' })).status).toBe(400);
  });

  it('renames and deactivates a hospital', async () => {
    const t = await createTenant('Old Name');
    const renamed = await s.agent.patch(`/api/platform/tenants/${t._id}`).send({ name: 'New Name' });
    expect(renamed.body.tenant.name).toBe('New Name');
    const off = await s.agent.patch(`/api/platform/tenants/${t._id}/status`).send({ isActive: false });
    expect(off.body.tenant.isActive).toBe(false);
    expect(await AuditLog.countDocuments({ action: 'TENANT_DEACTIVATED', tenantId: t._id })).toBe(1);
  });

  it('adds the first admin to a new hospital (creating their account)', async () => {
    const t = await createTenant();
    const res = await s.agent.post(`/api/platform/tenants/${t._id}/members`).send({ name: 'Hana Admin', email: 'hana@example.com', roles: ['admin'] });
    expect(res.status).toBe(201);
    expect(res.body.existingUser).toBe(false);
    expect(res.body.temporaryPassword).toMatch(/^\S{4}-\S{4}-\S{4}$/);
    noSecrets(res.body.member);

    const login = await request(app).post('/api/auth/login').send({ email: 'hana@example.com', password: res.body.temporaryPassword });
    expect(login.body.activeTenantId).toBe(t._id.toString());
    expect(login.body.memberships[0].roles).toEqual(['admin']);

    const detail = await s.agent.get(`/api/platform/tenants/${t._id}`);
    expect(detail.body.tenant).toMatchObject({ members: 1, admins: 1 });
  });

  it('returns 404 for an unknown hospital', async () => {
    expect((await s.agent.get('/api/platform/tenants/64b000000000000000000000')).status).toBe(404);
    expect((await s.agent.get('/api/platform/tenants/64b000000000000000000000/members')).status).toBe(404);
  });

  it("never sends the hospital's own settings: letterhead, pharmacy, ABDM ids or the waiting-room screen address", async () => {
    const displayKey = 'abcdef0123456789abcdef0123456789';
    const t = await createTenant('Sample Settings Hospital');
    await Tenant.updateOne(
      { _id: t._id },
      {
        letterhead: { name: 'Sample Printed Name', address: '12 Sample Lane, Demo City', phone: '0000000000', registrationNumber: 'SAMPLE-REG-001', footer: 'Sample footer' },
        pharmacy: { name: 'Sample Pharmacy', gstin: '27ABCDE1234F1Z5', licence20: 'SAMPLE-20-001', licence21: 'SAMPLE-21-001', rmi: 'SAMPLE-RMI-1', pharmacistName: 'Sample Pharmacist' },
        abdm: { hfrId: 'IN0000SAMPLE', hipId: 'IN0000SAMPLE', counterCode: 'SAMPLE01' },
        messaging: { remindersEnabled: true, portalEnabled: true, displayKey },
      },
    );
    const answers = [
      (await s.agent.get('/api/platform/tenants')).body.tenants[0],
      (await s.agent.get(`/api/platform/tenants/${t._id}`)).body.tenant,
      (await s.agent.patch(`/api/platform/tenants/${t._id}`).send({ name: 'Sample Settings Clinic' })).body.tenant,
      (await s.agent.patch(`/api/platform/tenants/${t._id}/status`).send({ isActive: true })).body.tenant,
      (await s.agent.get('/api/platform/stats')).body.tenantsWithoutAdmin[0], // the Overview's "no admin yet" list
    ];
    for (const tenant of answers) {
      expect(Object.keys(tenant)).toEqual(expect.arrayContaining(['id', 'name', 'isActive', 'createdAt']));
      for (const key of ['letterhead', 'pharmacy', 'abdm', 'messaging', 'createdBy', 'nameKey']) expect(tenant).not.toHaveProperty(key);
      const text = JSON.stringify(tenant);
      for (const secret of [displayKey, '27ABCDE1234F1Z5', 'SAMPLE-20-001', '12 Sample Lane', 'SAMPLE-REG-001', 'IN0000SAMPLE', 'Sample Pharmacy']) {
        expect(text).not.toContain(secret);
      }
    }
    // Only what the hospital pages show
    expect(Object.keys(answers[1]).sort()).toEqual(['admins', 'createdAt', 'id', 'isActive', 'members', 'name']);
    expect(Object.keys(answers[4]).sort()).toEqual(['createdAt', 'id', 'isActive', 'name']);
    // The hospital's settings themselves are untouched
    expect((await Tenant.findById(t._id).lean()).messaging.displayKey).toBe(displayKey);
  });
});

describe('user accounts', () => {
  it('creates a user and shows their hospitals', async () => {
    const t = await createTenant('Hospital One');
    const res = await s.agent.post('/api/platform/users').send({ name: 'Pat Person', email: 'pat@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.user.isSuperAdmin).toBe(false);
    await s.agent.post(`/api/platform/tenants/${t._id}/members`).send({ email: 'pat@example.com', roles: ['nurse'] });

    const detail = await s.agent.get(`/api/platform/users/${res.body.user.id}`);
    expect(detail.body.user.hospitals).toEqual([
      expect.objectContaining({ tenantName: 'Hospital One', roles: ['nurse'], isActive: true }),
    ]);
    noSecrets(detail.body);
  });

  it('searches users', async () => {
    await createUser({ name: 'Findable Person' });
    await createUser();
    expect((await s.agent.get('/api/platform/users?search=findable')).body.total).toBe(1);
    expect((await s.agent.get('/api/platform/users?type=superadmin')).body.total).toBe(1);
  });

  it('protects its own account and the last super admin', async () => {
    expect((await s.agent.patch(`/api/platform/users/${root._id}/status`).send({ isActive: false })).status).toBe(400);
    expect((await s.agent.patch(`/api/platform/users/${root._id}/super-admin`).send({ isSuperAdmin: false })).status).toBe(400);
    expect((await s.agent.post(`/api/platform/users/${root._id}/reset-password`)).status).toBe(400);

    // Two super admins: one can remove the other, then the survivor is protected.
    const second = await createSuperAdmin();
    const s2 = await loginAs(second, { app });
    expect((await s2.agent.patch(`/api/platform/users/${root._id}/super-admin`).send({ isSuperAdmin: false })).status).toBe(200);
    expect(await User.countDocuments({ isSuperAdmin: true, isActive: true })).toBe(1);
  });

  it('keeps super admins separate from hospital staff', async () => {
    const t = await createTenant();
    const staff = await createUser();
    await addMember(staff, t);
    const grant = await s.agent.patch(`/api/platform/users/${staff._id}/super-admin`).send({ isSuperAdmin: true });
    expect(grant.status).toBe(400);
    expect(grant.body.error.code).toBe('HAS_MEMBERSHIPS');

    const add = await s.agent.post(`/api/platform/tenants/${t._id}/members`).send({ email: root.email, roles: ['admin'] });
    expect(add.status).toBe(400);
  });

  it('deactivates an account everywhere and ends their session', async () => {
    const t = await createTenant();
    const staff = await createUser();
    await addMember(staff, t);
    const st = await loginAs(staff, { app });
    expect((await s.agent.patch(`/api/platform/users/${staff._id}/status`).send({ isActive: false })).status).toBe(200);
    expect((await st.agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: staff.email, password: PASSWORD })).status).toBe(401);
  });

  it('resets a password and forces a change at next login', async () => {
    const staff = await createUser();
    const res = await s.agent.post(`/api/platform/users/${staff._id}/reset-password`);
    expect(res.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: staff.email, password: PASSWORD })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: staff.email, password: res.body.temporaryPassword });
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('edits name and email', async () => {
    const staff = await createUser();
    const res = await s.agent.patch(`/api/platform/users/${staff._id}`).send({ name: 'Renamed', email: 'renamed@example.com' });
    expect(res.body.user).toMatchObject({ name: 'Renamed', email: 'renamed@example.com' });
    const taken = await s.agent.patch(`/api/platform/users/${staff._id}`).send({ email: root.email });
    expect(taken.status).toBe(409);
  });
});

describe('platform audit log', () => {
  it('shows all hospitals and can filter by one', async () => {
    const [a, b] = [await createTenant('A Hospital'), await createTenant('B Hospital')];
    await s.agent.post(`/api/platform/tenants/${a._id}/members`).send({ name: 'X', email: 'x@example.com', roles: ['admin'] });
    await s.agent.post(`/api/platform/tenants/${b._id}/members`).send({ name: 'Y', email: 'y@example.com', roles: ['admin'] });
    const all = await s.agent.get('/api/platform/audit-logs?action=MEMBER_ADDED');
    expect(all.body.total).toBe(2);
    const onlyA = await s.agent.get(`/api/platform/audit-logs?action=MEMBER_ADDED&tenantId=${a._id}`);
    expect(onlyA.body.entries.map((e) => e.tenantName)).toEqual(['A Hospital']);
  });

  it('never shows which patient an entry was about (record numbers, ids, type of care, care plan, typed reasons)', async () => {
    const hospital = await createTenant('Patient Hospital');
    const [doctor, admin] = [await createUser({ name: 'Dr. Sample' }), await createUser({ name: 'Hospital Admin' })];
    await addMember(doctor, hospital, 'doctor');
    await addMember(admin, hospital, 'admin');
    const d = await loginAs(doctor, { app });
    const lmp = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const p = (await d.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp } }))).body.patient;
    const plant = (action, details) =>
      AuditLog.create({ tenantId: hospital._id, actor: doctor._id, actorEmail: doctor.email, action, details: { patientId: p.id, mrn: p.mrn, ...details } });
    // Older-style entries holding the id of a visit, plan item, consent, note or doctor (fake ids).
    const ids = { visitId: 'a1a1a1a1a1a1a1a1a1a1a1a1', itemId: 'b2b2b2b2b2b2b2b2b2b2b2b2', consentId: 'c3c3c3c3c3c3c3c3c3c3c3c3', noteId: 'd4d4d4d4d4d4d4d4d4d4d4d4' };
    const doctorIds = { from: 'e5e5e5e5e5e5e5e5e5e5e5e5', to: 'f6f6f6f6f6f6f6f6f6f6f6f6' };
    await plant('VISIT_CREATED', { visitId: ids.visitId });
    await plant('VISIT_UPDATED', { visitId: ids.visitId, sections: ['vitals'] });
    await plant('CARE_PLAN_CHANGED', { planId: 'plan1', itemId: ids.itemId, visitId: ids.visitId, change: 'item_done' });
    await plant('CONSENT_FORM_PRINTED', { consentId: ids.consentId });
    await plant('PATIENT_ASSIGNED', doctorIds);
    await d.get(`/api/patients/${p.id}`);
    await d.patch(`/api/patients/${p.id}`).send({ phone: '+91 11111 11111' });
    // An older or future entry holding a list of patient ids is trimmed the same way.
    const planted = await plant('PATIENT_VIEWED', { patientIds: [p.id], careType: 'antenatal', planId: 'plan1', access: 'full' });
    // A reason a doctor typed can hold a name or a record number (fake text). Created last, so it is among the
    // 8 newest entries shown in Recent activity.
    const reason = `Asha Patil (${p.mrn}) bleeding at 30 w`;
    const note = await plant('EMERGENCY_NOTE_ADDED', { noteId: ids.noteId, reason });

    const allowed = ['access', 'fields', 'sections', 'change', 'copy', 'via', 'sensitive'];
    const patientEvents = (entries) => entries.filter((e) => AUDIT_CATEGORIES.patients.includes(e.action));
    const log = await s.agent.get('/api/platform/audit-logs?category=patients&limit=100');
    expect(log.status).toBe(200);
    expect(log.body.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['PATIENT_CREATED', 'PATIENT_VIEWED', 'PATIENT_UPDATED', 'CARE_PLAN_CREATED', 'VISIT_CREATED', 'CARE_PLAN_CHANGED', 'CONSENT_FORM_PRINTED', 'PATIENT_ASSIGNED', 'EMERGENCY_NOTE_ADDED']),
    );
    const stats = await s.agent.get('/api/platform/stats');
    expect(stats.status).toBe(200);
    // The checks below must run against real patient events, including the planted entries with every patient key.
    const recentIds = stats.body.recentActivity.map((e) => e.id);
    expect(recentIds).toEqual(expect.arrayContaining([planted.id, note.id]));
    expect(stats.body.recentActivity.map((e) => e.action)).toEqual(expect.arrayContaining(['PATIENT_VIEWED', 'PATIENT_UPDATED']));

    for (const entries of [log.body.entries, stats.body.recentActivity]) {
      for (const e of patientEvents(entries)) {
        for (const key of Object.keys(e.details ?? {})) expect(allowed).toContain(key);
        expect(JSON.stringify(e.details ?? {})).not.toMatch(/[0-9a-f]{24}/);
      }
      const json = JSON.stringify(entries);
      expect(json).not.toMatch(/P-\d{6}/);
      expect(json).not.toContain(p.id);
      expect(json).not.toContain('Asha Patil');
      expect(json).not.toContain('bleeding');
      for (const id of [...Object.values(ids), ...Object.values(doctorIds)]) expect(json).not.toContain(id);
    }
    // What is left still says what happened: the access level and which details or parts changed.
    const platformDetails = (action) => log.body.entries.find((e) => e.action === action).details;
    expect(platformDetails('PATIENT_UPDATED')).toEqual({ fields: ['phone'] });
    expect(platformDetails('VISIT_UPDATED')).toEqual({ sections: ['vitals'] });
    expect(platformDetails('CARE_PLAN_CHANGED')).toEqual({ change: 'item_done' });
    expect(platformDetails('EMERGENCY_NOTE_ADDED')).toEqual({});
    expect(stats.body.recentActivity.find((e) => e.id === planted.id).details).toEqual({ access: 'full' });

    // The hospital's own admin still sees the record numbers, ids and the reason in the hospital's audit log.
    const a = await loginAs(admin, { app });
    const tenantLog = await a.get('/api/tenant/audit-logs?category=patients&limit=100');
    expect(tenantLog.status).toBe(200);
    const tenantDetails = (action) => tenantLog.body.entries.find((e) => e.action === action).details;
    expect(tenantDetails('PATIENT_CREATED')).toMatchObject({ mrn: p.mrn, patientId: p.id, careType: 'antenatal' });
    expect(tenantLog.body.entries.some((e) => e.details?.patientIds)).toBe(true);
    expect(tenantDetails('EMERGENCY_NOTE_ADDED')).toMatchObject({ noteId: ids.noteId, reason: expect.stringContaining('Asha Patil') });
    expect(tenantDetails('VISIT_CREATED')).toMatchObject({ visitId: ids.visitId });
  });

  it('keeps only plain words from any patient event, even keys added later', () => {
    const allowed = ['access', 'fields', 'sections', 'change', 'copy', 'via', 'sensitive'];
    for (const action of AUDIT_CATEGORIES.patients.filter((a) => a !== 'RISK_RECALCULATED')) {
      const shown = safeAuditDetails(action, { babyId: 'x', motherId: 'y', patientId: 'z', reason: 'typed text', access: 'full' }, { scope: 'platform' });
      for (const key of Object.keys(shown)) expect(allowed).toContain(key);
    }
    // Template-level counts, never a patient.
    const recalc = safeAuditDetails('RISK_RECALCULATED', { templateId: 't1', name: 'Standard ANC', version: 2, checked: 5, changed: 1, skipped: 0, patientIds: ['x'] }, { scope: 'platform' });
    expect(recalc).toEqual({ templateId: 't1', name: 'Standard ANC', version: 2, checked: 5, changed: 1, skipped: 0 });
    // A failed sign-in keeps its reason code; other events lose patient ids as a second guard.
    expect(safeAuditDetails('LOGIN_FAILED', { email: 'x@example.com', reason: 'wrong_password' }, { scope: 'platform' })).toEqual({ email: 'x@example.com', reason: 'wrong_password' });
    expect(safeAuditDetails('TEMPLATE_UPDATED', { name: 'T', patientId: 'z', visitId: 'v' }, { scope: 'platform' })).toEqual({ name: 'T' });
  });
});

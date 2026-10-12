// The most important checks: each hospital only ever sees and changes its own data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { Patient } from '../src/models/Patient.js';
import {
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
let alpha;
let beta;
let doctor; // works in both hospitals

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  alpha = await createTenant('Alpha Hospital');
  beta = await createTenant('Beta Hospital');
  doctor = await createUser({ name: 'Dr. Both', lastTenantId: alpha._id });
  await addMember(doctor, alpha, 'doctor');
  await addMember(doctor, beta, 'doctor');
});
afterAll(disconnectTestDb);

describe('patients belong to the selected hospital', () => {
  it('creates patients in whichever hospital is selected, and lists only that hospital', async () => {
    const s = await loginAs(doctor, { app });
    expect(s.activeTenantId).toBe(alpha._id.toString());

    const a = await s.post('/api/patients').send(samplePatient({ fullName: 'Alice' }));
    expect(a.status).toBe(201);
    expect(a.body.patient.tenantId).toBe(alpha._id.toString());
    expect(a.body.patient.mrn).toBe('P-000001');

    expect((await s.switchTo(beta)).status).toBe(200);
    const listB = await s.get('/api/patients');
    expect(listB.body.total).toBe(0);

    const b = await s.post('/api/patients').send(samplePatient({ fullName: 'Bob' }));
    expect(b.body.patient.tenantId).toBe(beta._id.toString());
    expect(b.body.patient.mrn).toBe('P-000001'); // numbering is per hospital

    await s.switchTo(alpha);
    const listA = await s.get('/api/patients');
    expect(listA.body.patients.map((p) => p.fullName)).toEqual(['Alice']);
  });

  it('treats a patient from another hospital as not found', async () => {
    const s = await loginAs(doctor, { app });
    const a = await s.post('/api/patients').send(samplePatient());
    await s.switchTo(beta);
    expect((await s.get(`/api/patients/${a.body.patient.id}`)).status).toBe(404);
    await s.switchTo(alpha);
    expect((await s.get(`/api/patients/${a.body.patient.id}`)).status).toBe(200);
  });

  it('ignores a tenantId sent by the browser', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send(samplePatient({ tenantId: beta._id.toString() }));
    expect(res.status).toBe(201);
    expect(res.body.patient.tenantId).toBe(alpha._id.toString());
  });

  it('refuses requests when the browser and session disagree about the hospital', async () => {
    const s = await loginAs(doctor, { app });
    // e.g. the person switched hospital in another tab: this tab still says Alpha.
    await s.agent.post('/api/auth/switch-tenant').send({ tenantId: beta._id.toString() });
    const stale = await s.post('/api/patients').send(samplePatient());
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('TENANT_MISMATCH');
    const missing = await s.agent.post('/api/patients').send(samplePatient());
    expect(missing.status).toBe(409);
    expect(await Patient.countDocuments({ tenantId: alpha._id })).toBe(0);
    expect(await Patient.countDocuments({ tenantId: beta._id })).toBe(0);
  });

  it('validates patient details', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send({ careType: 'x', fullName: '', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['ageYears', 'careType', 'fullName', 'phone']);
  });

  it('sorts patients within the hospital', async () => {
    const s = await loginAs(doctor, { app });
    for (const fullName of ['Brown', 'Adams', 'Clark']) await s.post('/api/patients').send(samplePatient({ fullName }));
    const res = await s.get('/api/patients?sort=fullName');
    expect(res.body.patients.map((p) => p.fullName)).toEqual(['Adams', 'Brown', 'Clark']);
    expect((await s.get('/api/patients?sort=-mrn')).body.patients[0].mrn).toBe('P-000003');
    expect((await s.get('/api/patients?sort=notes')).status).toBe(400);
  });

  it('searches by name or record number', async () => {
    const s = await loginAs(doctor, { app });
    await s.post('/api/patients').send(samplePatient({ fullName: 'Zed Unique' }));
    await s.post('/api/patients').send(samplePatient({ fullName: 'Other' }));
    expect((await s.get('/api/patients?search=uniq')).body.total).toBe(1);
    expect((await s.get('/api/patients?search=P-000002')).body.total).toBe(1);
  });

  it('records patient creation and viewing in that hospital\'s audit log, without personal details', async () => {
    const s = await loginAs(doctor, { app });
    const a = await s.post('/api/patients').send(samplePatient({ fullName: 'Private Person' }));
    await s.get(`/api/patients/${a.body.patient.id}`);
    const entries = await AuditLog.find({ action: { $in: ['PATIENT_CREATED', 'PATIENT_VIEWED'] } });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.tenantId.toString()).toBe(alpha._id.toString());
      expect(JSON.stringify(e.details)).not.toMatch(/Private/);
    }
  });
});

describe('switching hospitals', () => {
  it('only allows hospitals the person is tagged to', async () => {
    const other = await createTenant('Gamma Hospital');
    const s = await loginAs(doctor, { app });
    expect((await s.switchTo(other)).status).toBe(403);
    expect((await s.agent.post('/api/auth/switch-tenant').send({ tenantId: 'bad' })).status).toBe(400);
  });

  it('remembers the choice for next login and logs the switch', async () => {
    const s = await loginAs(doctor, { app });
    await s.switchTo(beta);
    expect(await AuditLog.countDocuments({ action: 'TENANT_SWITCHED', tenantId: beta._id })).toBe(1);
    const again = await loginAs(doctor, { app });
    expect(again.activeTenantId).toBe(beta._id.toString());
  });

  it('ends access right away when the membership is deactivated', async () => {
    const s = await loginAs(doctor, { app });
    await Membership.updateOne({ userId: doctor._id, tenantId: alpha._id }, { isActive: false });
    const res = await s.get('/api/patients');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_TENANT');
    // Asking "who am I" moves the person to a hospital they still have access to.
    const me = await s.agent.get('/api/auth/me');
    expect(me.body.activeTenantId).toBe(beta._id.toString());
  });

  it('ends access right away when the hospital is deactivated', async () => {
    const s = await loginAs(doctor, { app });
    alpha.isActive = false;
    await alpha.save();
    expect((await s.get('/api/patients')).status).toBe(403);
  });
});

describe('super admins and hospital data', () => {
  it('cannot open patient data (they manage the platform, not patients)', async () => {
    const admin = await createSuperAdmin();
    const s = await loginAs(admin, { app });
    const res = await s.agent.get('/api/patients').set('X-Tenant-Id', alpha._id.toString());
    expect(res.status).toBe(403);
    expect((await s.agent.post('/api/auth/switch-tenant').send({ tenantId: alpha._id.toString() })).status).toBe(403);
  });
});

describe('database safety net', () => {
  it('refuses patient queries that do not name a hospital', async () => {
    await expect(Patient.find({})).rejects.toThrow(/without a tenantId/);
    await expect(Patient.countDocuments({ lastName: 'x' })).rejects.toThrow(/without a tenantId/);
    await expect(Patient.aggregate([{ $match: {} }])).rejects.toThrow(/without a leading tenantId/);
    await expect(Patient.find({ tenantId: alpha._id })).resolves.toEqual([]);
  });
});

// Health check H3 (owner's decision of 17 Nov 2026): Perinexa's own staff open a hospital's patient records only while
// that hospital's admin allows support access – for a reason and a few hours. All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Tenant } from '../src/models/Tenant.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let hospital;
let other;
let admin;
let doctor;
let superAdmin;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  hospital = await createTenant('Alpha Hospital');
  other = await createTenant('Beta Hospital');
  admin = await createUser({ name: 'Alpha Admin' });
  await addMember(admin, hospital, 'admin');
  doctor = await createUser({ name: 'Dr. Alpha' });
  await addMember(doctor, hospital, 'doctor');
  const betaDoctor = await createUser({ name: 'Dr. Beta' });
  await addMember(betaDoctor, other, 'doctor');
  superAdmin = await createSuperAdmin({ name: 'Super' });
  await (await loginAs(doctor, { app })).post('/api/patients').send(samplePatient({ fullName: 'Asha' }));
  await (await loginAs(betaDoctor, { app })).post('/api/patients').send(samplePatient({ fullName: 'Bina' }));
});
afterAll(disconnectTestDb);

async function openHospital(session, tenant) {
  const res = await session.agent.post('/api/auth/open-hospital').send({ tenantId: tenant._id.toString() });
  session.activeTenantId = res.body.activeTenantId;
  return res;
}
const patientUrls = ['/api/patients', '/api/billing/bills', '/api/pharmacy/medicines', '/api/today', '/api/calendar'];

describe('support access', () => {
  it("is closed by default: a super admin reaches the hospital's setup and staff, never its patients", async () => {
    const s = await loginAs(superAdmin, { app });
    await openHospital(s, hospital);
    expect((await s.get('/api/tenant/members')).status).toBe(200);
    expect((await s.get('/api/tenant/settings/letterhead')).status).toBe(200);
    for (const url of patientUrls) {
      const res = await s.get(url);
      expect(res.status, url).toBe(403);
      expect(res.body.error.code, url).toBe('NO_SUPPORT_ACCESS');
    }
    // Nor across hospitals: the platform's patient list and one hospital's patients
    const list = await s.agent.get('/api/platform/patients');
    expect(list.status).toBe(200);
    expect(list.body.patients).toEqual([]);
    expect(list.body.hospitals).toEqual([]);
    expect((await s.agent.get(`/api/platform/hospital-view/${hospital._id}/patients`)).status).toBe(403);
    // It sees that access is closed, and cannot open it itself
    const view = await s.get('/api/tenant/settings/support-access');
    expect(view.body).toMatchObject({ access: { open: false }, canChange: false });
    expect((await s.put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Looking around' })).status).toBe(403);
  });

  it('the hospital admin allows it for a reason and a few hours; then ends it early – all in the audit log', async () => {
    const a = await loginAs(admin, { app });
    expect((await a.put('/api/tenant/settings/support-access').send({ hours: 5, reason: 'Wrong bill' })).status).toBe(400); // not one of the choices
    expect((await a.put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'abc' })).status).toBe(400); // no real reason
    const granted = await a.put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Wrong bill total for one patient' });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body.access).toMatchObject({ open: true, reason: 'Wrong bill total for one patient', grantedByName: 'Alpha Admin' });
    expect(await AuditLog.exists({ action: 'SUPPORT_ACCESS_GRANTED', tenantId: hospital._id, actor: admin._id, 'details.hours': 2 })).toBeTruthy();

    // Now the super admin works in it like its staff; every record opened is in the hospital's audit log
    const s = await loginAs(superAdmin, { app });
    await openHospital(s, hospital);
    for (const url of patientUrls) expect((await s.get(url)).status, url).toBe(200);
    const asha = (await s.get('/api/patients')).body.patients[0];
    expect((await s.get(`/api/patients/${asha.id}`)).status).toBe(200);
    expect(await AuditLog.exists({ action: 'PATIENT_VIEWED', tenantId: hospital._id, actor: superAdmin._id })).toBeTruthy();
    // The platform's patient list shows this hospital only – never Beta, which allowed nothing
    const list = (await s.agent.get('/api/platform/patients')).body;
    expect(list.patients.map((p) => p.fullName)).toEqual(['Asha']);
    expect(list.hospitals.map((h) => h.name)).toEqual(['Alpha Hospital']);
    // A platform admin reads, never changes
    const viewer = await loginAs(await createUser({ name: 'Viewer', isPlatformAdmin: true, platformPermissions: ['hospitalSetup'] }), { app });
    await openHospital(viewer, hospital);
    expect((await viewer.get('/api/patients')).status).toBe(200);
    expect((await viewer.post('/api/patients').send(samplePatient({ fullName: 'Nope' }))).body.error.code).toBe('VIEW_ONLY');

    // Ended early by the hospital admin: closed again at once
    const ended = await a.delete('/api/tenant/settings/support-access');
    expect(ended.body.access.open).toBe(false);
    expect((await s.get('/api/patients')).body.error.code).toBe('NO_SUPPORT_ACCESS');
    expect(await AuditLog.exists({ action: 'SUPPORT_ACCESS_ENDED', tenantId: hospital._id })).toBeTruthy();
  });

  it('ends by itself when the time is up', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { platformAccess: { until: new Date(Date.now() - 1000), reason: 'Old', grantedByName: 'Alpha Admin', grantedAt: new Date(Date.now() - 3 * 3600 * 1000) } });
    const s = await loginAs(superAdmin, { app });
    await openHospital(s, hospital);
    expect((await s.get('/api/patients')).body.error.code).toBe('NO_SUPPORT_ACCESS');
  });

  it("only the hospital's own admin changes it; its staff never see it", async () => {
    const d = await loginAs(doctor, { app });
    expect((await d.get('/api/tenant/settings/support-access')).status).toBe(403);
    expect((await d.put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Wrong bill total' })).status).toBe(403);
  });
});

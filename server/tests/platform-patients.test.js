// The super admin's Patients page (owner, 24 Oct 2026): every hospital's patients, identity only, with the hospital
// and who added her. Fake sample data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let root;
let north;
let south;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  root = await loginAs(await createSuperAdmin({ name: 'Root Admin' }), { app });
  north = await createTenant('North Sample Hospital');
  south = await createTenant('South Sample Hospital');
});

async function register(tenant, name, fullName, extra = {}) {
  const doctor = await createUser({ name });
  await addMember(doctor, tenant, 'doctor');
  const s = await loginAs(doctor, { app });
  const res = await s.post('/api/patients').send(samplePatient({ fullName, phone: '98765 43210', address: '1 Sample Road', ...extra }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

describe('GET /api/platform/patients', () => {
  it('lists every hospital with the hospital and who added her – never phone, address, age or medical details', async () => {
    await register(north, 'Dr North Sample', 'Asha Sample', { careType: 'antenatal' });
    await register(south, 'Dr South Sample', 'Meena Sample', { careType: 'gynaecology' });
    const res = await root.agent.get('/api/platform/patients');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.patients.map((p) => [p.fullName, p.hospital, p.addedBy]).sort()).toEqual([
      ['Asha Sample', 'North Sample Hospital', 'Dr North Sample'],
      ['Meena Sample', 'South Sample Hospital', 'Dr South Sample'],
    ]);
    expect(Object.keys(res.body.patients[0]).sort()).toEqual(['addedBy', 'careType', 'createdAt', 'fullName', 'hospital', 'id', 'mrn', 'tenantId']);
    expect(JSON.stringify(res.body)).not.toMatch(/98765|Sample Road|pregnancy|ageYears/);
    expect(res.body.hospitals.map((h) => h.name)).toEqual(['North Sample Hospital', 'South Sample Hospital']);
  });

  it('filters by hospital, type of care and a search of name or patient number', async () => {
    const asha = await register(north, 'Dr North Sample', 'Asha Sample', { careType: 'antenatal' });
    await register(north, 'Dr North Two', 'Kavita Sample', { careType: 'gynaecology' });
    await register(south, 'Dr South Sample', 'Asha Other', { careType: 'antenatal' });
    const names = async (query) => (await root.agent.get('/api/platform/patients').query(query)).body.patients.map((p) => p.fullName).sort();
    expect(await names({ tenantId: String(north._id) })).toEqual(['Asha Sample', 'Kavita Sample']);
    expect(await names({ careType: 'antenatal' })).toEqual(['Asha Other', 'Asha Sample']);
    expect(await names({ search: 'asha' })).toEqual(['Asha Other', 'Asha Sample']);
    expect(await names({ search: asha.mrn, tenantId: String(north._id) })).toEqual(['Asha Sample']);
  });

  it('each list shown is in the audit log of every hospital in it (how many, never who)', async () => {
    await register(north, 'Dr North Sample', 'Asha Sample');
    await register(south, 'Dr South Sample', 'Meena Sample');
    await root.agent.get('/api/platform/patients');
    const entries = await AuditLog.find({ action: 'PLATFORM_PATIENTS_LISTED' }).lean();
    expect(entries.map((e) => String(e.tenantId)).sort()).toEqual([String(north._id), String(south._id)].sort());
    expect(entries.every((e) => e.details.count === 1)).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/Asha|Meena/);
  });

  it('super admins only: not platform admins, not hospital staff', async () => {
    const viewer = await loginAs(await createUser({ isPlatformAdmin: true, platformPermissions: ['hospitals', 'users'] }), { app });
    expect((await viewer.agent.get('/api/platform/patients')).status).toBe(403);
    const admin = await createUser();
    await addMember(admin, north, 'admin');
    expect((await (await loginAs(admin, { app })).agent.get('/api/platform/patients')).status).toBe(403);
    const doctor = await createUser();
    await addMember(doctor, north, 'doctor');
    expect((await (await loginAs(doctor, { app })).agent.get('/api/platform/patients')).status).toBe(403);
  });
});

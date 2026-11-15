// One hospital, everything, for the super admin (docs/USER_GROUPS_PLAN.md Part A): departments' numbers, staff by
// department, patients by department (identity only, super admins only) and the Activity filter by department or role.
// Fake sample data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hospitalToday } from '../src/careplans/dates.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let root;
let north;
let south;
let doctor;
let doctorSession;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  root = await loginAs(await createSuperAdmin({ name: 'Root Admin' }), { app });
  north = await createTenant('North Sample Hospital');
  south = await createTenant('South Sample Hospital');
  doctor = await createUser({ name: 'Dr North Sample' });
  await addMember(doctor, north, 'doctor', { department: 'Obgy', departments: ['Obgy'] });
  doctorSession = await loginAs(doctor, { app });
});

async function register(session, fullName, department) {
  const res = await session.post('/api/patients').send(samplePatient({ fullName, department, phone: '98765 43210', address: '1 Sample Road' }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

async function southPatient(fullName, department) {
  const d = await createUser({ name: 'Dr South Sample' });
  await addMember(d, south, 'doctor');
  return register(await loginAs(d, { app }), fullName, department);
}

const base = (tenant) => `/api/platform/hospital-view/${tenant._id}`;

describe('GET /api/platform/hospital-view/:tenantId/departments', () => {
  it("counts this hospital's patients and today's appointments per department – never another hospital's", async () => {
    const asha = await register(doctorSession, 'Asha Sample', 'Obgy');
    await register(doctorSession, 'Kavita Sample', 'Obgy');
    await southPatient('Meena Sample', 'Obgy');
    await southPatient('Rita Sample', 'Pediatric');
    await Appointment.create({ tenantId: north._id, patientId: asha.id, doctorId: doctor._id, on: hospitalToday(), kind: 'token', source: 'walk_in', created: { by: doctor._id, byName: doctor.name, at: new Date() } });

    const res = await root.agent.get(`${base(north)}/departments`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const obgy = res.body.departments.find((d) => d.key === 'Obgy');
    expect(obgy).toMatchObject({ patients: 2, newToday: 2, appointmentsToday: 1 });
    expect(res.body.departments.find((d) => d.key === 'Pediatric').patients).toBe(0);
    expect(res.body.departments.at(-1)).toMatchObject({ key: 'none', label: 'No department' });
    expect(res.body.services).toMatchObject({ registrationsToday: 2, appointmentsToday: 1, collectedTodayPaise: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/Asha|Kavita|98765/);
  });

  it('is open to platform admins (numbers only) and 404s for an unknown hospital', async () => {
    const viewer = await loginAs(await createUser({ isPlatformAdmin: true, platformPermissions: [] }), { app });
    expect((await viewer.agent.get(`${base(north)}/departments`)).status).toBe(200);
    expect((await root.agent.get('/api/platform/hospital-view/0123456789abcdef01234567/departments')).status).toBe(404);
    expect((await doctorSession.agent.get(`${base(north)}/departments`)).status).toBe(403);
  });
});

describe('GET /api/platform/hospital-view/:tenantId/staff', () => {
  it('groups the staff by department; people without one by their role; only this hospital', async () => {
    const nurse = await createUser({ name: 'Nurse North Sample' });
    await addMember(nurse, north, 'nurse');
    await addMember(await createUser({ name: 'Dr South Only' }), south, 'doctor');
    const res = await root.agent.get(`${base(north)}/staff`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.groups.map((g) => [g.key, g.role])).toEqual([
      ['Obgy', null],
      ['role:nurse', 'nurse'],
    ]);
    expect(res.body.groups[0].people).toHaveLength(1);
    expect(res.body.groups[0].people[0]).toMatchObject({ roles: ['doctor'], departments: ['Obgy'], active: true });
    expect(res.body.groups[0].people[0].name).toMatch(/North Sample/);
    expect(res.body.groups[1].people.map((p) => p.name)).toEqual(['Nurse North Sample']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|South Only/);
  });
});

describe('GET /api/platform/hospital-view/:tenantId/patients', () => {
  it("lists one department's patients, identity only, and writes the list to the hospital's audit log", async () => {
    await register(doctorSession, 'Asha Sample', 'Obgy');
    await register(doctorSession, 'Nodept Sample', '');
    await southPatient('Meena Sample', 'Obgy');
    const res = await root.agent.get(`${base(north)}/patients`).query({ department: 'Obgy' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.patients.map((p) => p.fullName)).toEqual(['Asha Sample']);
    expect(Object.keys(res.body.patients[0]).sort()).toEqual(['careType', 'createdAt', 'department', 'doctor', 'fullName', 'id', 'mrn']);
    expect(JSON.stringify(res.body)).not.toMatch(/98765|Sample Road|ageYears|pregnancy/);
    const none = await root.agent.get(`${base(north)}/patients`).query({ department: 'none' });
    expect(none.body.patients.map((p) => p.fullName)).toEqual(['Nodept Sample']);
    const logged = await AuditLog.find({ action: 'PLATFORM_PATIENTS_LISTED', tenantId: north._id }).lean();
    expect(logged.map((e) => e.details.count)).toEqual([1, 1]);
    expect(await AuditLog.countDocuments({ action: 'PLATFORM_PATIENTS_LISTED', tenantId: south._id })).toBe(0);
  });

  it('is for super admins only – not platform admins', async () => {
    const viewer = await loginAs(await createUser({ isPlatformAdmin: true, platformPermissions: ['hospitals', 'users'] }), { app });
    expect((await viewer.agent.get(`${base(north)}/patients`)).status).toBe(403);
  });
});

describe('Activity filter by department or role', () => {
  it("shows only what that department's or role's staff did, in the chosen hospital", async () => {
    const nurse = await createUser({ name: 'Nurse North Sample' });
    await addMember(nurse, north, 'nurse');
    await AuditLog.create([
      { action: 'PATIENT_VIEWED', tenantId: north._id, actor: doctor._id, actorEmail: doctor.email },
      { action: 'PATIENT_VIEWED', tenantId: north._id, actor: nurse._id, actorEmail: nurse.email },
    ]);
    const emails = async (query) =>
      (await root.agent.get('/api/platform/audit-logs').query({ tenantId: String(north._id), action: 'PATIENT_VIEWED', ...query })).body.entries.map((e) => e.actorEmail);
    expect(await emails({ department: 'Obgy' })).toEqual([doctor.email]);
    expect(await emails({ department: 'none' })).toEqual([nurse.email]);
    expect(await emails({ role: 'nurse' })).toEqual([nurse.email]);
    expect((await root.agent.get('/api/platform/audit-logs').query({ department: 'Obgy' })).status).toBe(400);
  });
});

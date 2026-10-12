// Super admins and platform admins (owner's request, 12 Oct 2026):
//  - a super admin sees and changes everything on the platform, and can open any hospital's setup (Hospital admin
//    pages) – never its patients, bills or pharmacy;
//  - a platform admin sees the same, view only, and changes only the areas a super admin ticked;
//  - only a super admin hands out super admin or platform admin rights;
//  - "Switch to your doctor account": a linked hospital account, whose password is still asked.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let hospital;
let superAdmin;
let doctor;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  hospital = await createTenant('Alpha Hospital');
  superAdmin = await createSuperAdmin({ name: 'Super' });
  doctor = await createUser({ name: 'Dr. Alpha' });
  await addMember(doctor, hospital, ['doctor', 'admin']);
});
afterAll(disconnectTestDb);

const platformAdmin = (permissions = []) => createUser({ name: 'Viewer', isPlatformAdmin: true, platformPermissions: permissions });

/** Opens a hospital's setup and returns helpers that send its header. */
async function openHospital(session, tenant) {
  const res = await session.agent.post('/api/auth/open-hospital').send({ tenantId: tenant._id.toString() });
  session.activeTenantId = res.body.activeTenantId;
  return res;
}

describe('platform pages', () => {
  it('a platform admin reads everything but changes nothing without a right', async () => {
    const s = await loginAs(await platformAdmin(), { app });
    expect(s.body.platform).toMatchObject({ role: 'platformadmin', permissions: [], hospital: null });
    expect((await s.agent.get('/api/platform/tenants')).status).toBe(200);
    expect((await s.agent.get('/api/platform/users')).status).toBe(200);
    expect((await s.agent.get('/api/platform/audit-logs')).status).toBe(200);
    const created = await s.agent.post('/api/platform/tenants').send({ name: 'New Hospital' });
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('VIEW_ONLY');
  });

  it('a platform admin given "hospitals" may create a hospital, but still not change user accounts', async () => {
    const s = await loginAs(await platformAdmin(['hospitals']), { app });
    expect((await s.agent.post('/api/platform/tenants').send({ name: 'New Hospital' })).status).toBe(201);
    expect((await s.agent.post('/api/platform/users').send({ name: 'Someone', email: 'someone@example.com' })).status).toBe(403);
  });

  it('a platform admin given "users" manages staff accounts, never super admins or platform admins', async () => {
    const viewer = await platformAdmin(['users']);
    const s = await loginAs(viewer, { app });
    expect((await s.agent.post('/api/platform/users').send({ name: 'Staff', email: 'staff@example.com' })).status).toBe(201);
    expect((await s.agent.post('/api/platform/users').send({ name: 'Boss', email: 'boss@example.com', isSuperAdmin: true })).status).toBe(403);
    expect((await s.agent.patch(`/api/platform/users/${doctor.id}/super-admin`).send({ isSuperAdmin: true })).status).toBe(403);
    expect((await s.agent.post(`/api/platform/users/${superAdmin.id}/reset-password`)).status).toBe(403);
    expect((await s.agent.patch(`/api/platform/users/${superAdmin.id}/status`).send({ isActive: false })).status).toBe(403);
    const other = await platformAdmin();
    expect((await s.agent.patch(`/api/platform/users/${other.id}/platform-admin`).send({ isPlatformAdmin: true, permissions: ['users'] })).status).toBe(403);
    // A staff account that is not a hospital admin (a hospital admin's needs "Hospital admins' access" too)
    const nurse = await createUser({ name: 'Nurse Asha' });
    await addMember(nurse, hospital, 'nurse');
    expect((await s.agent.patch(`/api/platform/users/${nurse.id}`).send({ name: 'Nurse Renamed' })).status).toBe(200);
    expect((await s.agent.patch(`/api/platform/users/${doctor.id}`).send({ name: 'Dr. Renamed' })).body.error.code).toBe('HOSPITAL_ADMIN_RIGHT');
  });

  it('a hospital member is not a platform user', async () => {
    const s = await loginAs(doctor, { app });
    expect(s.body.platform).toBeUndefined();
    expect((await s.agent.get('/api/platform/tenants')).status).toBe(403);
  });
});

describe('giving platform admin rights', () => {
  it('a super admin makes someone a platform admin with chosen areas; their sessions start afresh', async () => {
    const person = await createUser({ name: 'New Viewer' });
    const s = await loginAs(superAdmin, { app });
    const res = await s.agent.patch(`/api/platform/users/${person.id}/platform-admin`).send({ isPlatformAdmin: true, permissions: ['users', 'hospitals'] });
    expect(res.status).toBe(200);
    const saved = await User.findById(person._id);
    expect(saved.isPlatformAdmin).toBe(true);
    expect([...saved.platformPermissions]).toEqual(['hospitals', 'users']);
    expect(saved.tokenVersion).toBe(1);
    expect(await AuditLog.exists({ action: 'PLATFORM_ADMIN_CHANGED', target: person._id })).toBeTruthy();
    expect((await s.agent.get('/api/platform/users?type=platformadmin')).body.users.map((u) => u.id)).toEqual([person.id]);
  });

  it('refuses someone who works in a hospital, and a super admin', async () => {
    const s = await loginAs(superAdmin, { app });
    const asDoctor = await s.agent.patch(`/api/platform/users/${doctor.id}/platform-admin`).send({ isPlatformAdmin: true });
    expect(asDoctor.body.error.code).toBe('HAS_MEMBERSHIPS');
    const other = await createSuperAdmin();
    expect((await s.agent.patch(`/api/platform/users/${other.id}/platform-admin`).send({ isPlatformAdmin: true })).body.error.code).toBe('IS_SUPER_ADMIN');
  });

  it('a platform admin cannot be added to a hospital', async () => {
    const viewer = await platformAdmin();
    const s = await loginAs(superAdmin, { app });
    const res = await s.agent.post(`/api/platform/tenants/${hospital.id}/members`).send({ email: viewer.email, name: viewer.name, roles: ['doctor'] });
    expect(res.status).toBe(400);
  });
});

describe("a hospital's setup", () => {
  it('a super admin opens a hospital fully, like its own staff; every patient record opened is in its audit log', async () => {
    const doc = await loginAs(doctor, { app });
    expect((await doc.post('/api/patients').send(samplePatient({ fullName: 'Asha' }))).status).toBe(201);

    const s = await loginAs(superAdmin, { app });
    const opened = await openHospital(s, hospital);
    expect(opened.status).toBe(200);
    expect(opened.body.platform.hospital).toMatchObject({ tenantId: hospital.id, tenantName: 'Alpha Hospital', readOnly: false });
    expect((await s.get('/api/tenant/members')).status).toBe(200);
    expect((await s.get('/api/tenant/settings/letterhead')).status).toBe(200);
    expect((await s.put('/api/tenant/settings/letterhead').send({ name: 'Alpha Hospital Pvt Ltd' })).status).toBe(200);
    // Owner's decision (12 Oct 2026, as in the earlier Perinexa1): patients, bills, pharmacy – everything
    for (const url of ['/api/patients', '/api/billing/bills', '/api/pharmacy/medicines', '/api/today', '/api/calendar']) {
      const res = await s.get(url);
      expect(res.status, url).toBe(200);
    }
    const list = (await s.get('/api/patients')).body.patients;
    expect(list.map((p) => p.fullName)).toEqual(['Asha']);
    expect((await s.get(`/api/patients/${list[0].id}`)).status).toBe(200);
    expect(await AuditLog.exists({ action: 'PATIENT_VIEWED', tenantId: hospital._id, actor: superAdmin._id })).toBeTruthy();
    // The hospital's own audit log records that the super admin opened its setup
    expect(await AuditLog.exists({ action: 'TENANT_SWITCHED', tenantId: hospital._id, actor: superAdmin._id })).toBeTruthy();
  });

  it("the hospital's audit log never shows a platform user which patient an entry was about", async () => {
    const doc = await loginAs(doctor, { app });
    const p = await doc.post('/api/patients').send(samplePatient({ fullName: 'Asha' }));
    await doc.get(`/api/patients/${p.body.patient.id}`);
    const s = await loginAs(superAdmin, { app });
    await openHospital(s, hospital);
    const log = await s.get('/api/tenant/audit-logs?limit=100');
    expect(log.status).toBe(200);
    expect(JSON.stringify(log.body.entries)).not.toContain(p.body.patient.mrn);
    expect(JSON.stringify(log.body.entries)).not.toContain(p.body.patient.id);
  });

  it('a platform admin without "hospitalSetup" looks only; with it, changes the setup', async () => {
    const viewer = await loginAs(await platformAdmin(), { app });
    expect((await openHospital(viewer, hospital)).body.platform.hospital.readOnly).toBe(true);
    expect((await viewer.get('/api/tenant/settings/letterhead')).status).toBe(200);
    const refused = await viewer.put('/api/tenant/settings/letterhead').send({ name: 'Changed' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('VIEW_ONLY');

    const editor = await loginAs(await platformAdmin(['hospitalSetup']), { app });
    await openHospital(editor, hospital);
    expect((await editor.put('/api/tenant/settings/letterhead').send({ name: 'Changed' })).status).toBe(200);
    // A platform admin looks at the patients but never changes them
    expect((await editor.get('/api/patients')).status).toBe(200);
    const noPatient = await editor.post('/api/patients').send(samplePatient({ fullName: 'Nope' }));
    expect(noPatient.status).toBe(403);
    expect(noPatient.body.error.code).toBe('VIEW_ONLY');
  });

  it('closing the setup goes back to the platform; hospital members cannot use this', async () => {
    const s = await loginAs(superAdmin, { app });
    await openHospital(s, hospital);
    const closed = await s.agent.post('/api/auth/open-hospital').send({ tenantId: null });
    expect(closed.body.activeTenantId).toBeNull();
    expect(closed.body.platform.hospital).toBeNull();
    const doc = await loginAs(doctor, { app });
    expect((await doc.agent.post('/api/auth/open-hospital').send({ tenantId: hospital.id })).status).toBe(403);
    // The normal switch stays closed to platform users
    expect((await s.agent.post('/api/auth/switch-tenant').send({ tenantId: hospital.id })).status).toBe(403);
  });
});

describe('"Switch to your doctor account"', () => {
  it("a super admin links a platform user's own hospital account; the session tells its email, never more", async () => {
    const owner = await createSuperAdmin({ name: 'Owner' });
    const s = await loginAs(superAdmin, { app });
    expect((await s.agent.patch(`/api/platform/users/${owner.id}/linked-account`).send({ email: doctor.email })).status).toBe(200);
    expect(await AuditLog.exists({ action: 'LINKED_ACCOUNT_CHANGED', target: owner._id })).toBeTruthy();

    const o = await loginAs(owner, { app });
    expect(o.body.platform.linkedAccount).toEqual({ email: doctor.email, name: 'Dr. Alpha' });
    // Switching still needs the doctor's password: a wrong one is refused
    expect((await request(app).post('/api/auth/login').send({ email: doctor.email, password: 'not-the-password-1' })).status).toBe(401);
  });

  it('refuses linking to a super admin or platform admin, and only a super admin may link', async () => {
    const owner = await createSuperAdmin();
    const s = await loginAs(superAdmin, { app });
    const viewer = await platformAdmin(['users']);
    expect((await s.agent.patch(`/api/platform/users/${owner.id}/linked-account`).send({ email: viewer.email })).body.error.code).toBe('NOT_HOSPITAL_ACCOUNT');
    expect((await s.agent.patch(`/api/platform/users/${doctor.id}/linked-account`).send({ email: owner.email })).body.error.code).toBe('NOT_PLATFORM');
    const v = await loginAs(viewer, { app });
    expect((await v.agent.patch(`/api/platform/users/${owner.id}/linked-account`).send({ email: doctor.email })).status).toBe(403);
  });
});

describe("hospital admins' access (owner's request, 12 Oct 2026)", () => {
  async function setupStaff() {
    const nurse = await createUser({ name: 'Nurse Asha' });
    await addMember(nurse, hospital, 'nurse');
    const secondAdmin = await createUser({ name: 'Admin Two' });
    await addMember(secondAdmin, hospital, 'admin');
    return { nurse, secondAdmin };
  }
  const memberOf = async (s, user) => (await s.get('/api/tenant/members?limit=100')).body.members.find((m) => m.user.id === user.id);

  it("a platform admin with \"User accounts\" but without the right cannot touch a hospital admin", async () => {
    const { nurse, secondAdmin } = await setupStaff();
    const s = await loginAs(await platformAdmin(['users']), { app });
    await openHospital(s, hospital);
    const admin = await memberOf(s, secondAdmin);
    for (const res of [
      await s.patch(`/api/tenant/members/${admin.id}/roles`).send({ roles: ['doctor'] }),
      await s.patch(`/api/tenant/members/${admin.id}/status`).send({ isActive: false }),
      await s.post(`/api/tenant/members/${admin.id}/reset-password`),
      await s.post('/api/tenant/members').send({ email: 'new.admin@example.com', name: 'New Admin', roles: ['admin'] }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('HOSPITAL_ADMIN_RIGHT');
    }
    // Making the nurse an admin is a hospital admin's access too; other staff stay theirs to change
    const n = await memberOf(s, nurse);
    expect((await s.patch(`/api/tenant/members/${n.id}/roles`).send({ roles: ['nurse', 'admin'] })).body.error.code).toBe('HOSPITAL_ADMIN_RIGHT');
    expect((await s.patch(`/api/tenant/members/${n.id}/roles`).send({ roles: ['nurse', 'receptionist'] })).status).toBe(200);
  });

  it('with the right given, a platform admin changes a hospital admin; a super admin always may', async () => {
    const { secondAdmin } = await setupStaff();
    const s = await loginAs(await platformAdmin(['users', 'hospitalAdmins']), { app });
    await openHospital(s, hospital);
    const admin = await memberOf(s, secondAdmin);
    expect((await s.patch(`/api/tenant/members/${admin.id}/roles`).send({ roles: ['admin', 'doctor'] })).status).toBe(200);
    const sa = await loginAs(superAdmin, { app });
    await openHospital(sa, hospital);
    expect((await sa.patch(`/api/tenant/members/${admin.id}/roles`).send({ roles: ['admin'] })).status).toBe(200);
  });

  it("on the platform's Users pages too: a hospital admin's account needs the right", async () => {
    const { secondAdmin, nurse } = await setupStaff();
    const s = await loginAs(await platformAdmin(['users']), { app });
    expect((await s.agent.post(`/api/platform/users/${secondAdmin.id}/reset-password`)).body.error.code).toBe('HOSPITAL_ADMIN_RIGHT');
    expect((await s.agent.post(`/api/platform/users/${nurse.id}/reset-password`)).status).toBe(200);
  });
});

describe('staff by role', () => {
  it('counts each role once per person across active hospitals, and lists them', async () => {
    const beta = await createTenant('Beta Hospital');
    await addMember(doctor, beta, 'doctor'); // the same doctor at two hospitals is one doctor
    const reception = await createUser({ name: 'Reception Ravi' });
    await addMember(reception, beta, 'receptionist');
    const s = await loginAs(await platformAdmin(), { app });
    const all = await s.agent.get('/api/platform/users/role-counts');
    expect(all.status).toBe(200);
    expect(all.body.counts).toMatchObject({ doctor: 1, admin: 1, receptionist: 1, pharmacist: 0, lab: 0, billing: 0 });
    expect((await s.agent.get(`/api/platform/users/role-counts?tenantId=${hospital.id}`)).body.counts.receptionist).toBe(0);
    const list = await s.agent.get('/api/platform/users?role=receptionist');
    expect(list.body.users.map((u) => u.name)).toEqual(['Reception Ravi']);
  });
});

describe("a hospital's staff need \"User accounts\"", () => {
  it('a platform admin with only the hospital setup may change the letterhead but not the staff', async () => {
    const nurse = await createUser({ name: 'Nurse Bina' });
    await addMember(nurse, hospital, 'nurse');
    const s = await loginAs(await platformAdmin(['hospitalSetup']), { app });
    await openHospital(s, hospital);
    expect((await s.put('/api/tenant/settings/letterhead').send({ name: 'Alpha' })).status).toBe(200);
    const member = (await s.get('/api/tenant/members?limit=100')).body.members.find((m) => m.user.id === nurse.id);
    expect((await s.patch(`/api/tenant/members/${member.id}/roles`).send({ roles: ['receptionist'] })).body.error.code).toBe('VIEW_ONLY');
    expect((await s.agent.post(`/api/platform/tenants/${hospital.id}/members`).send({ email: 'new@example.com', name: 'New', roles: ['nurse'] })).status).toBe(403);
  });
});

describe('the first super admin (first start)', () => {
  it('is made on the sign-in page while there is none, and only then', async () => {
    await resetTestDb();
    expect((await request(app).get('/api/auth/setup-status')).body).toEqual({ needsSetup: true });
    const weak = await request(app).post('/api/auth/setup').send({ name: 'Owner', email: 'owner@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    const made = await request(app).post('/api/auth/setup').send({ name: 'Owner', email: 'Owner@Example.com', password: 'OwnerPassw0rd!' });
    expect(made.status).toBe(201);
    const owner = await User.findOne({ email: 'owner@example.com' });
    expect(owner.isSuperAdmin).toBe(true);
    expect(owner.mustChangePassword).toBe(false);
    expect((await request(app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'OwnerPassw0rd!' })).status).toBe(200);
    // Once there is a super admin, nobody can make another one this way
    expect((await request(app).get('/api/auth/setup-status')).body).toEqual({ needsSetup: false });
    const again = await request(app).post('/api/auth/setup').send({ name: 'Intruder', email: 'intruder@example.com', password: 'IntruderPassw0rd!' });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ALREADY_SET_UP');
    expect(await User.exists({ email: 'intruder@example.com' })).toBeFalsy();
  });
});

describe('a new account with its hospital and roles in one step (as in the earlier Perinexa1)', () => {
  it('a super admin makes a receptionist of a hospital in one go', async () => {
    const s = await loginAs(superAdmin, { app });
    const res = await s.agent.post('/api/platform/users').send({ accountType: 'staff', name: 'Rita', email: 'rita@example.com', tenantId: hospital.id, roles: ['receptionist'] });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeTruthy();
    expect(res.body.user.hospitals).toEqual([expect.objectContaining({ tenantId: hospital.id, roles: ['receptionist'], isActive: true })]);
    expect(await AuditLog.exists({ action: 'MEMBER_ADDED', tenantId: hospital._id })).toBeTruthy();
    // Roles are needed with a hospital
    expect((await s.agent.post('/api/platform/users').send({ accountType: 'staff', name: 'X', email: 'x@example.com', tenantId: hospital.id, roles: [] })).status).toBe(400);
  });

  it('a platform admin with "User accounts" makes staff, but a hospital admin only with that right, and never a super admin', async () => {
    const s = await loginAs(await platformAdmin(['users']), { app });
    expect((await s.agent.post('/api/platform/users').send({ name: 'Lab', email: 'lab1@example.com', tenantId: hospital.id, roles: ['lab'] })).status).toBe(201);
    const admin = await s.agent.post('/api/platform/users').send({ name: 'Boss', email: 'boss1@example.com', tenantId: hospital.id, roles: ['admin'] });
    expect(admin.body.error.code).toBe('HOSPITAL_ADMIN_RIGHT');
    expect(await User.exists({ email: 'boss1@example.com' })).toBeFalsy(); // nothing made half-way
    expect((await s.agent.post('/api/platform/users').send({ accountType: 'superAdmin', name: 'S', email: 's1@example.com' })).status).toBe(403);
    expect((await s.agent.post('/api/platform/users').send({ accountType: 'platformAdmin', name: 'P', email: 'p1@example.com' })).status).toBe(403);
    const viewer = await loginAs(await platformAdmin(), { app });
    expect((await viewer.agent.post('/api/platform/users').send({ name: 'No', email: 'no@example.com', tenantId: hospital.id, roles: ['lab'] })).status).toBe(403);
  });

  it('a super admin makes a platform admin account directly (view only to start)', async () => {
    const s = await loginAs(superAdmin, { app });
    const res = await s.agent.post('/api/platform/users').send({ accountType: 'platformAdmin', name: 'Viewer Two', email: 'viewer2@example.com' });
    expect(res.status).toBe(201);
    const made = await User.findOne({ email: 'viewer2@example.com' });
    expect(made.isPlatformAdmin).toBe(true);
    expect([...made.platformPermissions]).toEqual([]);
  });
});

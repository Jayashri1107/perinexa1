// Admin or clinical work, one at a time (22 Oct 2026): a doctor whom the super admin also made the hospital's admin
// works as a doctor (patients, no admin pages) or – after "Switch to admin" with their password – as the admin (admin
// pages, no patient records); back to clinical work needs no password. And "Add people": a hospital admin the super
// admin allows adds staff – never another admin; only the super admin makes or removes admins.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { PASSWORD, addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

const use = (session, body) => {
  session.activeTenantId = body.activeTenantId ?? session.activeTenantId;
  return body;
};

describe('a doctor who is also the hospital admin', () => {
  it('starts in clinical work; switches to admin with the password, and back without', async () => {
    const home = await createTenant('Mode Hospital');
    const both = await createUser({ name: 'Dr Both' });
    await addMember(both, home, ['doctor', 'admin'], { adminRights: ['resetPassword'] });
    const s = await loginAs(both);
    expect(s.body.memberships[0]).toMatchObject({ roles: ['doctor'], adminSwitch: true, clinicalRoles: ['doctor'], adminRights: [] });
    expect(s.body.roleMode).toBeUndefined();
    expect((await s.get('/api/patients')).status).toBe(200);
    expect((await s.get('/api/tenant/members')).status).toBe(403); // no admin pages in clinical work

    const wrong = await s.post('/api/auth/switch-to-admin').send({ password: 'not-my-password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.password).toBe('That is not your password.');
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILED', 'details.reason': 'wrong_password_switch_to_admin' })).toBe(1);

    const admin = use(s, (await s.post('/api/auth/switch-to-admin').send({ password: PASSWORD })).body);
    expect(admin.roleMode).toBe('admin');
    expect(admin.memberships[0]).toMatchObject({ roles: ['admin'], adminSwitch: true, adminRights: ['resetPassword'] });
    expect((await s.get('/api/tenant/members')).status).toBe(200);
    expect((await s.get('/api/patients')).status).not.toBe(200); // the admin sees no patient records
    expect((await s.get('/api/auth/me')).body.roleMode).toBe('admin'); // kept as the session is renewed
    expect((await s.post('/api/auth/switch-to-admin').send({ password: PASSWORD })).body.error.code).toBe('ALREADY_ADMIN');

    const back = use(s, (await s.post('/api/auth/switch-to-clinical').send({})).body);
    expect(back.roleMode).toBeUndefined();
    expect(back.memberships[0].roles).toEqual(['doctor']);
    expect((await s.get('/api/patients')).status).toBe(200);
    expect((await s.post('/api/auth/switch-to-clinical').send({})).body.error.code).toBe('NOT_ADMIN_MODE');

    expect((await AuditLog.find({ action: 'ROLE_MODE_SWITCHED' }).sort({ createdAt: 1 }).lean()).map((e) => e.details.to)).toEqual(['admin', 'clinical']);
    // The stored roles never change
    expect((await Membership.findOne({ userId: both._id })).roles).toEqual(['admin', 'doctor']);
  });

  it('only someone who is both an admin and clinical staff here can switch', async () => {
    const home = await createTenant('Mode Hospital');
    const doctor = await createUser();
    await addMember(doctor, home, 'doctor');
    const adminOnly = await createUser();
    await addMember(adminOnly, home, 'admin');
    for (const who of [doctor, adminOnly]) {
      const res = await (await loginAs(who)).post('/api/auth/switch-to-admin').send({ password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ADMIN_ROLE');
    }
    const a = await loginAs(adminOnly);
    expect(a.body.memberships[0]).toMatchObject({ roles: ['admin'], adminSwitch: false });
    expect((await a.get('/api/tenant/members')).status).toBe(200); // an admin-only person is always the admin
  });

  it("a super admin in their own doctor account, also made an admin, types the super admin password", async () => {
    const home = await createTenant('Mode Hospital');
    const sa = await createSuperAdmin();
    const s = await loginAs(sa);
    await s.post('/api/auth/me/doctor-account').send({ tenantId: home._id.toString() });
    const doctorUserId = (await Membership.findOne({ tenantId: home._id })).userId;
    await Membership.updateOne({ tenantId: home._id, userId: doctorUserId }, { $set: { roles: ['admin', 'doctor'] } });
    use(s, (await s.post('/api/auth/switch-to-doctor').send({})).body);
    const res = await s.post('/api/auth/switch-to-admin').send({ password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ roleMode: 'admin', switchBack: true });
  });
});

describe('Add people: a hospital admin the super admin allows', () => {
  let n = 0;
  async function setup(rights) {
    n += 1;
    const home = await createTenant(`People Hospital ${n}`);
    const admin = await createUser({ name: 'Hospital Admin' });
    await addMember(admin, home, 'admin', { adminRights: rights });
    return { home, admin, s: await loginAs(admin) };
  }

  it('without the permission is told to ask the super admin; with it adds staff, never an admin', async () => {
    const without = await setup([]);
    const refused = await without.s.post('/api/tenant/members').send({ name: 'New Nurse', email: 'nurse.one@example.com', roles: ['nurse'] });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/super admin's permission to add people/);

    const { s } = await setup(['addPeople']);
    const added = await s.post('/api/tenant/members').send({ name: 'new nurse', email: 'nurse.two@example.com', roles: ['nurse'] });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.temporaryPassword).toEqual(expect.any(String));
    expect(added.body.member.name ?? added.body.member.user?.name).toBe('New Nurse');

    for (const roles of [['admin'], ['doctor', 'admin']]) {
      const res = await s.post('/api/tenant/members').send({ name: 'Would Be Admin', email: `admin.${roles.length}@example.com`, roles });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ADMIN_ROLE_SUPER_ADMIN_ONLY');
    }
  });

  it('"Change roles" never makes or removes an admin; the super admin can', async () => {
    const { home, s } = await setup(['roles']);
    const doctor = await createUser();
    const m = await addMember(doctor, home, 'doctor');
    const up = await s.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['doctor', 'admin'] });
    expect(up.status).toBe(403);
    expect(up.body.error.code).toBe('ADMIN_ROLE_SUPER_ADMIN_ONLY');
    expect((await s.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['doctor', 'rmo'] })).status).toBe(200);

    const root = await loginAs(await createSuperAdmin());
    const byRoot = await root.agent.patch(`/api/platform/tenants/${home._id}/members/${m._id}/roles`).send({ roles: ['doctor', 'admin'] });
    expect(byRoot.status, JSON.stringify(byRoot.body)).toBe(200);
  });

  it('the super admin gives "Add people" on Admin permissions; the list shows it', async () => {
    const { home, admin } = await setup([]);
    const root = await loginAs(await createSuperAdmin());
    const m = await Membership.findOne({ userId: admin._id });
    const res = await root.agent.patch(`/api/platform/tenants/${home._id}/members/${m._id}/admin-rights`).send({ rights: ['addPeople', 'resetPassword'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = (await root.agent.get('/api/platform/users/hospital-admins')).body.admins;
    expect(list.find((a) => a.memberId === String(m._id)).adminRights).toEqual(['addPeople', 'resetPassword']);
    // The hospital admin's own session tells the website what they may do
    expect((await loginAs(admin)).body.memberships[0].adminRights).toEqual(['addPeople', 'resetPassword']);
  });
});

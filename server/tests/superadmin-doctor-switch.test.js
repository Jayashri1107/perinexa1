// A super admin who is also a doctor (21 Oct 2026): one login. Their own doctor account (their email with "+doctor")
// is made for them; "Switch to your doctor account" needs no password, "Switch back to super admin" asks theirs. Only
// their OWN account is entered without a password – never someone else's login.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { User } from '../src/models/User.js';
import { PASSWORD, addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

const use = (session, body) => {
  session.activeTenantId = body.activeTenantId ?? null;
  return body;
};

describe('a super admin who is also a doctor – one login', () => {
  it('makes their own doctor account (no second email), tagged as a doctor in each hospital chosen', async () => {
    const a = await createTenant('Switch Hospital A');
    const b = await createTenant('Switch Hospital B');
    const sa = await createSuperAdmin({ email: 'asha.owner@example.com', name: 'Dr Asha Owner', professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-1', council: 'MMC' } });
    const s = await loginAs(sa);

    const first = await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.platform.linkedAccount).toEqual({ email: 'asha.owner+doctor@example.com', name: 'Dr Asha Owner', own: true });
    expect(first.body.hospitals.map((h) => [h.tenantName, h.roles])).toEqual([['Switch Hospital A', ['doctor']]]);
    const doctor = await User.findOne({ email: 'asha.owner+doctor@example.com' });
    expect(doctor.ownedBy.equals(sa._id)).toBe(true);
    expect(doctor.isSuperAdmin).toBe(false);
    expect(doctor.professional.registrationNumber).toBe('MMC-1');

    // Again for the same hospital: nothing new; another hospital: tagged there too
    expect((await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() })).status).toBe(200);
    const both = await s.post('/api/auth/me/doctor-account').send({ tenantId: b._id.toString() });
    expect(both.body.hospitals.map((h) => h.tenantName)).toEqual(['Switch Hospital A', 'Switch Hospital B']);
    expect(await User.countDocuments({ ownedBy: sa._id })).toBe(1);
    expect(await Membership.countDocuments({ userId: doctor._id })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'MEMBER_ADDED', 'details.ownDoctorAccount': true })).toBe(2);
  });

  it('switches to the doctor without a password and back with the super admin password', async () => {
    const a = await createTenant('Switch Hospital A');
    const sa = await createSuperAdmin({ email: 'ravi.sa@example.com' });
    const s = await loginAs(sa);
    await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() });

    const down = await s.post('/api/auth/switch-to-doctor').send({});
    expect(down.status, JSON.stringify(down.body)).toBe(200);
    use(s, down.body);
    expect(down.body).toMatchObject({ user: { email: 'ravi.sa+doctor@example.com', isSuperAdmin: false }, activeTenantId: a._id.toString(), switchBack: true });
    expect(down.body.platform).toBeUndefined();
    // Works as a doctor of that hospital – and only that
    expect((await s.get('/api/patients')).status).toBe(200);
    expect((await s.get('/api/platform/tenants')).status).toBe(403);
    expect((await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() })).status).toBe(403);
    // The session keeps "switch back" as it is renewed
    expect((await s.get('/api/auth/me')).body.switchBack).toBe(true);

    // Going up asks the super admin password
    const wrong = await s.post('/api/auth/switch-to-super-admin').send({ password: 'not-my-password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.password).toMatch(/not your super admin password/);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILED', 'details.reason': 'wrong_password_switch_back' })).toBe(1);
    expect((await s.get('/api/patients')).status).toBe(200); // still the doctor

    const up = await s.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    use(s, up.body);
    expect(up.body).toMatchObject({ user: { email: 'ravi.sa@example.com', isSuperAdmin: true }, activeTenantId: null });
    expect(up.body.switchBack).toBeUndefined();
    expect(up.body.platform.linkedAccount.own).toBe(true);
    expect((await s.get('/api/platform/tenants')).status).toBe(200);
    expect((await s.get('/api/auth/me')).body.switchBack).toBeUndefined();

    const switches = await AuditLog.find({ action: 'ACCOUNT_SWITCHED' }).sort({ createdAt: 1 }).lean();
    expect(switches.map((e) => e.details.to)).toEqual(['doctor', 'superadmin']);
    expect(switches.every((e) => e.actor.equals(sa._id))).toBe(true);
  });

  it('keeps "switch back" when the doctor changes hospital', async () => {
    const a = await createTenant('Switch Hospital A');
    const b = await createTenant('Switch Hospital B');
    const sa = await createSuperAdmin();
    const s = await loginAs(sa);
    await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() });
    await s.post('/api/auth/me/doctor-account').send({ tenantId: b._id.toString() });
    use(s, (await s.post('/api/auth/switch-to-doctor').send({})).body);
    const other = s.activeTenantId === a._id.toString() ? b : a;
    const moved = await s.switchTo(other);
    expect(moved.status).toBe(200);
    expect(moved.body.switchBack).toBe(true);
    expect((await s.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD })).status).toBe(200);
  });

  it("never enters someone else's login without its password", async () => {
    const a = await createTenant('Switch Hospital A');
    const sa = await createSuperAdmin();
    const realDoctor = await createUser({ email: 'real.doctor@example.com' });
    await addMember(realDoctor, a, 'doctor');
    const s = await loginAs(sa);
    // Linked by email (the older way): the switch still asks that account's own password
    expect((await s.patch(`/api/platform/users/${sa._id}/linked-account`).send({ email: 'real.doctor@example.com' })).status).toBe(200);
    expect((await s.get('/api/auth/me')).body.platform.linkedAccount.own).toBe(false);
    const refused = await s.post('/api/auth/switch-to-doctor').send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NO_OWN_DOCTOR_ACCOUNT');
    expect((await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() })).body.error.code).toBe('LINKED_ELSEWHERE');

    // An account marked as another super admin's is not theirs either
    const other = await createSuperAdmin();
    const theirs = await createUser({ ownedBy: other._id });
    await addMember(theirs, a, 'doctor');
    await User.updateOne({ _id: sa._id }, { $set: { linkedAccountId: theirs._id } });
    expect((await s.post('/api/auth/switch-to-doctor').send({})).status).toBe(409);
  });

  it('is for super admins only; going up needs a switched session that is still valid', async () => {
    const a = await createTenant('Switch Hospital A');
    const platformAdmin = await createUser({ isPlatformAdmin: true });
    const p = await loginAs(platformAdmin);
    expect((await p.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() })).status).toBe(403);
    expect((await p.post('/api/auth/switch-to-doctor').send({})).status).toBe(403);

    const doctor = await createUser();
    await addMember(doctor, a, 'doctor');
    const d = await loginAs(doctor);
    const notSwitched = await d.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD });
    expect(notSwitched.status).toBe(403);
    expect(notSwitched.body.error.code).toBe('NOT_SWITCHED');

    // The super admin signs out elsewhere (their sessions end): the switched doctor session can no longer go up
    const sa = await createSuperAdmin();
    const s = await loginAs(sa);
    await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() });
    use(s, (await s.post('/api/auth/switch-to-doctor').send({})).body);
    await User.updateOne({ _id: sa._id }, { $inc: { tokenVersion: 1 } });
    const ended = await s.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD });
    expect(ended.status).toBe(403);
    expect(ended.body.error.code).toBe('SWITCH_ENDED');
  });

  it('a doctor login linked by email shows "switch back" however it is reached, and goes up only with the super admin password (22 Oct 2026)', async () => {
    const a = await createTenant('Switch Hospital A');
    const sa = await createSuperAdmin({ email: 'linked.sa@example.com' });
    const doctor = await createUser({ email: 'linked.doctor@example.com' });
    await addMember(doctor, a, 'doctor');
    const root = await loginAs(sa);
    expect((await root.patch(`/api/platform/users/${sa._id}/linked-account`).send({ email: 'linked.doctor@example.com' })).status).toBe(200);

    // Signed in to the doctor account with its own password (the older switch, or directly)
    const d = await loginAs(doctor);
    expect(d.body.switchBack).toBe(true);
    expect((await d.get('/api/auth/me')).body.switchBack).toBe(true);
    const wrong = await d.post('/api/auth/switch-to-super-admin').send({ password: 'the-doctors-own-password-is-not-it' });
    expect(wrong.status).toBe(400);
    const up = await d.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.user).toMatchObject({ email: 'linked.sa@example.com', isSuperAdmin: true });

    // A doctor no super admin linked never sees it
    const plain = await createUser();
    await addMember(plain, a, 'doctor');
    const p = await loginAs(plain);
    expect(p.body.switchBack).toBeUndefined();
    expect((await p.post('/api/auth/switch-to-super-admin').send({ password: PASSWORD })).body.error.code).toBe('NOT_SWITCHED');
  });

  it('cannot sign in to the doctor account with a password nobody knows', async () => {
    const a = await createTenant('Switch Hospital A');
    const sa = await createSuperAdmin({ email: 'meera.sa@example.com' });
    const s = await loginAs(sa);
    await s.post('/api/auth/me/doctor-account').send({ tenantId: a._id.toString() });
    await expect(loginAs({ email: 'meera.sa+doctor@example.com' })).rejects.toThrow(/Login failed/);
    await expect(loginAs({ email: 'meera.sa+doctor@example.com' }, { password: PASSWORD })).rejects.toThrow(/Login failed/);
  });
});

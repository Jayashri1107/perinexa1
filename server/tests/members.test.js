// Hospital admins managing the people in their own hospital.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
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
} from './helpers.js';

const app = createApp();
let home;
let other;
let admin;
let s; // the hospital admin's session (working in "home")
let root; // a super admin's session: new people are added by the super admin (owner, 12 Oct 2026)
const add = (body) => root.agent.post(`/api/platform/tenants/${home._id}/members`).send(body);

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  home = await createTenant('Home Hospital');
  other = await createTenant('Other Hospital');
  admin = await createUser({ name: 'Home Admin' });
  await addMember(admin, home, 'admin');
  s = await loginAs(admin, { app });
  root = await loginAs(await createSuperAdmin({ name: 'Root' }), { app });
});
afterAll(disconnectTestDb);

describe('access', () => {
  it('is only for admins of the selected hospital', async () => {
    const nurse = await createUser();
    await addMember(nurse, home, 'nurse');
    const n = await loginAs(nurse, { app });
    expect((await n.get('/api/tenant/members')).status).toBe(403);
    expect((await n.get('/api/tenant/audit-logs')).status).toBe(403);
  });

  it('being admin in one hospital gives no admin rights in another', async () => {
    await addMember(admin, other, 'receptionist');
    await s.switchTo(other);
    expect((await s.get('/api/tenant/members')).status).toBe(403);
  });
});

describe('listing members', () => {
  it('shows only people tagged to this hospital', async () => {
    const outsider = await createUser({ name: 'Outsider' });
    await addMember(outsider, other, 'doctor');
    const res = await s.get('/api/tenant/members');
    expect(res.body.members.map((m) => m.user.name)).toEqual(['Home Admin']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it('marks people who also work at another hospital', async () => {
    const shared = await createUser({ name: 'Shared Person' });
    await addMember(shared, home, 'doctor');
    await addMember(shared, other, 'doctor');
    const res = await s.get('/api/tenant/members?search=shared');
    expect(res.body.members[0].sharedAccount).toBe(true);
  });
});

describe('adding people', () => {
  it("a hospital's own admin no longer adds people – the super admin does", async () => {
    const res = await s.post('/api/tenant/members').send({ name: 'New Nurse', email: 'nurse.x@example.com', roles: ['nurse'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADD_PEOPLE_RIGHT');
  });

  it('creates a new account with a temporary password', async () => {
    const res = await add({ name: 'New Nurse', email: 'New.Nurse@example.com', roles: ['nurse'] });
    expect(res.status).toBe(201);
    expect(res.body.existingUser).toBe(false);
    expect(res.body.member).toMatchObject({ roles: ['nurse'], user: { email: 'new.nurse@example.com', mustChangePassword: true } });
    const entry = await AuditLog.findOne({ action: 'MEMBER_ADDED' });
    expect(entry.tenantId.toString()).toBe(home._id.toString());
  });

  it('links an existing account from another hospital without changing its password', async () => {
    const doc = await createUser({ email: 'doc@example.com' });
    await addMember(doc, other, 'doctor');
    const res = await add({ email: 'doc@example.com', roles: ['doctor'] });
    expect(res.status).toBe(201);
    expect(res.body.existingUser).toBe(true);
    expect(res.body.temporaryPassword).toBeNull();
    const login = await request(app).post('/api/auth/login').send({ email: 'doc@example.com', password: PASSWORD });
    expect(login.body.memberships.map((m) => m.tenantName)).toEqual(['Home Hospital', 'Other Hospital']);
  });

  it('rejects duplicates, super admins and missing names', async () => {
    const dup = await add({ email: admin.email, roles: ['nurse'] });
    expect(dup.status).toBe(409);
    const root = await createSuperAdmin();
    expect((await add({ email: root.email, roles: ['admin'] })).status).toBe(400);
    const noName = await add({ email: 'someone.new@example.com', roles: ['nurse'] });
    expect(noName.status).toBe(400);
    expect(noName.body.error.fields).toHaveProperty('name');
    expect((await add({ name: 'X', email: 'x@example.com', roles: ['surgeon'] })).status).toBe(400);
  });
});

describe('roles and status', () => {
  it('changes a role and deactivates a member of this hospital only', async () => {
    const shared = await createUser();
    const m = await addMember(shared, home, 'nurse');
    await addMember(shared, other, 'nurse');

    const role = await s.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['doctor'] });
    expect(role.body.member.roles).toEqual(['doctor']);
    const off = await s.patch(`/api/tenant/members/${m._id}/status`).send({ isActive: false });
    expect(off.body.member.isActive).toBe(false);

    // Still works at the other hospital.
    const login = await request(app).post('/api/auth/login').send({ email: shared.email, password: PASSWORD });
    expect(login.body.memberships.map((x) => x.tenantName)).toEqual(['Other Hospital']);
    expect(await AuditLog.countDocuments({ action: 'MEMBER_DEACTIVATED', tenantId: home._id })).toBe(1);
  });

  it('protects the admin themselves and the last admin', async () => {
    const mine = await Membership.findOne({ userId: admin._id, tenantId: home._id });
    expect((await s.patch(`/api/tenant/members/${mine._id}/roles`).send({ roles: ['nurse'] })).status).toBe(400);
    expect((await s.patch(`/api/tenant/members/${mine._id}/status`).send({ isActive: false })).status).toBe(400);

    // A second admin can remove the first; the survivor is then the last admin and is protected.
    const second = await createUser();
    await addMember(second, home, 'admin');
    const s2 = await loginAs(second, { app });
    expect((await s2.patch(`/api/tenant/members/${mine._id}/roles`).send({ roles: ['doctor'] })).status).toBe(200);
    expect(await Membership.countDocuments({ tenantId: home._id, roles: 'admin', isActive: true })).toBe(1);
  });

  it('cannot touch memberships of another hospital (not found)', async () => {
    const outsider = await createUser();
    const foreign = await addMember(outsider, other, 'nurse');
    expect((await s.patch(`/api/tenant/members/${foreign._id}/roles`).send({ roles: ['admin'] })).status).toBe(404);
    expect((await s.patch(`/api/tenant/members/${foreign._id}/status`).send({ isActive: false })).status).toBe(404);
    expect((await s.post(`/api/tenant/members/${foreign._id}/reset-password`)).status).toBe(404);
  });
});

describe('several roles per person', () => {
  it('gives one person several roles, including the new RMO and lab roles', async () => {
    const res = await add({ name: 'Dr. Multi', email: 'multi@example.com', roles: ['doctor', 'admin', 'doctor'] });
    expect(res.status).toBe(201);
    expect(res.body.member.roles).toEqual(['admin', 'doctor']); // duplicates removed, fixed order
    const rmo = await add({ name: 'Resident', email: 'rmo@example.com', roles: ['rmo'] });
    expect(rmo.body.member.roles).toEqual(['rmo']);
    const lab = await add({ name: 'Lab Person', email: 'lab@example.com', roles: ['lab'] });
    expect(lab.body.member.roles).toEqual(['lab']);
    expect((await add({ name: 'None', email: 'none@example.com', roles: [] })).status).toBe(400);
  });

  it('a doctor who is also admin can manage staff', async () => {
    const both = await createUser();
    await addMember(both, home, ['doctor', 'admin']);
    const b = await loginAs(both, { app });
    expect(b.body.memberships[0].roles).toEqual(['admin', 'doctor']);
    expect((await b.get('/api/tenant/members')).status).toBe(200);
  });

  it('keeps the last admin when roles change and records old and new roles', async () => {
    const m = await Membership.findOne({ userId: admin._id });
    const second = await createUser();
    await addMember(second, home, ['admin', 'doctor']);
    const s2 = await loginAs(second, { app });
    const res = await s2.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['doctor', 'rmo'] });
    expect(res.body.member.roles).toEqual(['doctor', 'rmo']);
    const entry = await AuditLog.findOne({ action: 'MEMBER_ROLE_CHANGED' });
    expect(entry.details).toEqual({ from: ['admin'], to: ['doctor', 'rmo'] });
    // second is now the only admin and can't drop their own admin role
    const own = await Membership.findOne({ userId: second._id });
    expect((await s2.patch(`/api/tenant/members/${own._id}/roles`).send({ roles: ['doctor'] })).status).toBe(400);
  });
});

describe('account changes by a hospital admin', () => {
  it('can reset the password of someone who only works here', async () => {
    const local = await createUser();
    const m = await addMember(local, home, 'nurse');
    const res = await s.post(`/api/tenant/members/${m._id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toBeTruthy();
    const edit = await s.patch(`/api/tenant/members/${m._id}`).send({ name: 'Edited Name' });
    expect(edit.body.member.user.name).toBe('Edited Name');
  });

  it('cannot reset or edit someone who also works at another hospital', async () => {
    const shared = await createUser();
    const m = await addMember(shared, home, 'nurse');
    await addMember(shared, other, 'nurse');
    const res = await s.post(`/api/tenant/members/${m._id}/reset-password`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHARED_ACCOUNT');
    expect((await s.patch(`/api/tenant/members/${m._id}`).send({ name: 'Hijack' })).status).toBe(403);
  });
});

describe('hospital audit log', () => {
  it('shows only this hospital\'s entries', async () => {
    await add({ name: 'Here', email: 'here@example.com', roles: ['nurse'] });
    await AuditLog.create({ action: 'MEMBER_ADDED', tenantId: other._id, actorEmail: 'someone@else.com' });
    const res = await s.get('/api/tenant/audit-logs');
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries.every((e) => e.tenantId === home._id.toString())).toBe(true);
    // Trying to ask for another hospital's entries is ignored.
    const sneaky = await s.get(`/api/tenant/audit-logs?tenantId=${other._id}`);
    expect(sneaky.body.entries.every((e) => e.tenantId === home._id.toString())).toBe(true);
  });
});

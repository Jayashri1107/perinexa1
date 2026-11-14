// User groups and page access (docs/USER_GROUPS_PLAN.md Part B): the super admin's groups, moving the old roles into
// groups, adding a person with a group, a person's own page access, and the server refusing a request from a menu item
// that is None (or a change from a View one). Fake sample data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { UserGroup } from '../src/models/UserGroup.js';
import { moveToUserGroups } from '../src/users/userGroups.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let root;
let tenant;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  await UserGroup.deleteMany({});
  root = await loginAs(await createSuperAdmin({ name: 'Root Admin' }), { app });
  tenant = await createTenant('North Sample Hospital');
});

const groupsUrl = '/api/platform/user-groups';
const membersUrl = () => `/api/platform/tenants/${tenant._id}/members`;

describe('moving the old roles into groups', () => {
  it('makes the 13 groups, a group for each mix of roles, and moves everyone once', async () => {
    const doc = await addMember(await createUser({ name: 'Sample Doctor' }), tenant, 'doctor');
    const both = await addMember(await createUser({ name: 'Sample Doctor Admin' }), tenant, ['doctor', 'admin']);
    const first = await moveToUserGroups();
    expect(first).toEqual({ groupsMade: 14, membersMoved: 2 });
    const groups = await UserGroup.find({}).lean();
    expect(groups.filter((g) => g.system)).toHaveLength(13);
    const mix = groups.find((g) => !g.system);
    expect(mix).toMatchObject({ name: 'Doctor + Hospital admin', roles: ['admin', 'doctor'] });
    expect(String((await Membership.findById(doc._id)).groupId)).toBe(String(groups.find((g) => g.name === 'Doctor')._id));
    expect(String((await Membership.findById(both._id)).groupId)).toBe(String(mix._id));
    expect(await moveToUserGroups()).toEqual({ groupsMade: 0, membersMoved: 0 });
    expect(await AuditLog.countDocuments({ action: 'MEMBER_GROUP_CHANGED' })).toBe(2);
  });
});

describe('/api/platform/user-groups', () => {
  it('the super admin makes and changes a group; every change is audited', async () => {
    const made = await root.agent.post(groupsUrl).send({ name: 'Front desk (no billing)', roles: ['receptionist'], pages: { billing: 'none', patients: 'view', today: 'edit' } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.group).toMatchObject({ name: 'Front desk (no billing)', roles: ['receptionist'], pages: { billing: 'none', patients: 'view' }, system: false });
    const id = made.body.group.id;
    const changed = await root.agent.patch(`${groupsUrl}/${id}`).send({ pages: { billing: 'view' } });
    expect(changed.body.group.pages).toEqual({ billing: 'view' });
    const dup = await root.agent.post(groupsUrl).send({ name: 'front desk (NO billing)', roles: ['receptionist'] });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.name).toMatch(/already exists/);
    const list = await root.agent.get(groupsUrl);
    expect(list.body.pages.map((p) => p.key)).toContain('pharmacy');
    expect(await AuditLog.countDocuments({ action: { $in: ['USER_GROUP_CREATED', 'USER_GROUP_CHANGED'] } })).toBe(2);
  });

  it("never changes a system group's roles, nor the roles of a group people are in", async () => {
    await moveToUserGroups();
    const doctorGroup = await UserGroup.findOne({ name: 'Doctor' });
    expect((await root.agent.patch(`${groupsUrl}/${doctorGroup._id}`).send({ roles: ['doctor', 'admin'] })).body.error.code).toBe('SYSTEM_GROUP');
    const made = (await root.agent.post(groupsUrl).send({ name: 'Ward team', roles: ['nurse'] })).body.group;
    await addMember(await createUser(), tenant, 'nurse', { groupId: made.id });
    expect((await root.agent.patch(`${groupsUrl}/${made.id}`).send({ roles: ['rmo'] })).body.error.code).toBe('GROUP_IN_USE');
    expect((await root.agent.patch(`${groupsUrl}/${made.id}/status`).send({ isActive: false })).body.error.code).toBe('GROUP_IN_USE');
  });

  it('platform admins only read; hospital staff never reach it', async () => {
    const viewer = await loginAs(await createUser({ isPlatformAdmin: true, platformPermissions: ['hospitals', 'users'] }), { app });
    expect((await viewer.agent.get(groupsUrl)).status).toBe(200);
    expect((await viewer.agent.post(groupsUrl).send({ name: 'Nope', roles: ['nurse'] })).status).toBe(403);
    const admin = await createUser();
    await addMember(admin, tenant, 'admin', { adminRights: ['addPeople', 'roles'] });
    expect((await (await loginAs(admin, { app })).agent.get(groupsUrl)).status).toBe(403);
  });
});

describe('adding a person with a group, and their own page access', () => {
  it("takes the roles from the group; a hospital's own admin cannot give an admin group", async () => {
    await moveToUserGroups();
    const pharmacy = await UserGroup.findOne({ name: 'Pharmacist' });
    const res = await root.agent.post(membersUrl()).send({ email: 'new.pharma@example.com', name: 'New Pharma', groupId: String(pharmacy._id) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.member).toMatchObject({ roles: ['pharmacist'], groupId: String(pharmacy._id) });

    const admin = await createUser();
    await addMember(admin, tenant, 'admin', { adminRights: ['addPeople', 'roles'] });
    const s = await loginAs(admin, { app });
    const adminGroup = await UserGroup.findOne({ name: 'Hospital admin' });
    const refused = await s.post('/api/tenant/members').send({ email: 'x@example.com', name: 'X Sample', groupId: String(adminGroup._id) });
    expect(refused.body.error.code).toBe('ADMIN_ROLE_SUPER_ADMIN_ONLY');
    const groups = await s.get('/api/tenant/members/groups');
    expect(groups.body.groups.map((g) => g.name)).toContain('Pharmacist');
  });

  it("moves a person to another group, and sets their own page access – never one's own", async () => {
    await moveToUserGroups();
    const nurse = await addMember(await createUser(), tenant, 'nurse');
    await moveToUserGroups();
    const rmo = await UserGroup.findOne({ name: 'RMO' });
    const moved = await root.agent.patch(`${membersUrl()}/${nurse._id}/group`).send({ groupId: String(rmo._id) });
    expect(moved.body.member).toMatchObject({ roles: ['rmo'], groupId: String(rmo._id) });
    const pages = await root.agent.patch(`${membersUrl()}/${nurse._id}/pages`).send({ pages: { billing: 'none', beds: 'view' } });
    expect(pages.body.member.pageOverrides).toEqual({ billing: 'none', beds: 'view' });
    const back = await root.agent.patch(`${membersUrl()}/${nurse._id}/pages`).send({ pages: { billing: 'group' } });
    expect(back.body.member.pageOverrides).toEqual({ beds: 'view' });
    expect(await AuditLog.countDocuments({ action: 'MEMBER_PAGES_CHANGED' })).toBe(2);
  });
});

describe('page access on the server', () => {
  it('refuses a request from a None menu item and a change from a View one; a person’s own Edit opens it again', async () => {
    const group = await UserGroup.create({ name: 'Desk without billing', roles: ['receptionist'], pages: { billing: 'none', patients: 'view' } });
    const user = await createUser();
    const m = await addMember(user, tenant, 'receptionist', { groupId: group._id });
    const s = await loginAs(user, { app });
    const from = (req, page) => req.set('X-Perinexa-Page', page);

    expect((await from(s.get('/api/patients'), 'patients')).status).toBe(200);
    const viewOnly = await from(s.post('/api/patients'), 'patients').send(samplePatient());
    expect(viewOnly.status).toBe(403);
    expect(viewOnly.body.error.code).toBe('PAGE_VIEW_ONLY');
    expect((await from(s.get('/api/billing/bills'), 'billing')).body.error?.code).toBe('PAGE_HIDDEN');
    // Another menu item (Today) still registers – page access is about the page, the roles decide the rest
    expect((await from(s.post('/api/patients'), 'today').send(samplePatient())).status).toBe(201);

    m.pageOverrides = new Map([['billing', 'edit']]);
    await m.save();
    expect((await from(s.get('/api/billing/bills'), 'billing')).body.error?.code).not.toBe('PAGE_HIDDEN');

    const me = await s.agent.get('/api/auth/me');
    expect(me.body.memberships[0]).toMatchObject({ groupName: 'Desk without billing', pages: { patients: 'view' } });
  });

  it('never widens: Edit on a menu item does not give what the roles do not', async () => {
    const group = await UserGroup.create({ name: 'Pharmacy all edit', roles: ['pharmacist'], pages: {} });
    const user = await createUser();
    await addMember(user, tenant, 'pharmacist', { groupId: group._id });
    const s = await loginAs(user, { app });
    expect((await s.get('/api/tenant/members').set('X-Perinexa-Page', 'hospital-admin')).status).toBe(403);
  });
});

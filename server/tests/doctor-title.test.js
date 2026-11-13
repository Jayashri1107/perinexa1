// "Dr." in front of a doctor's name (13 Nov 2026 – utils/doctorTitle.js): given with the doctor role, kept when the name
// is edited, and given at start-up to doctors from before (users/doctorTitles.js). Other roles keep their name.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Membership } from '../src/models/Membership.js';
import { User } from '../src/models/User.js';
import { addDoctorTitles } from '../src/users/doctorTitles.js';
import { hasDoctorTitle, withDoctorTitle } from '../src/utils/doctorTitle.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
let home;
let root;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  home = await createTenant('Home Hospital');
  root = await loginAs(await createSuperAdmin({ name: 'Root' }), { app });
});
afterAll(disconnectTestDb);

describe('withDoctorTitle', () => {
  it('writes the title one way and never twice', () => {
    expect(withDoctorTitle('Asha Rao')).toBe('Dr. Asha Rao');
    expect(withDoctorTitle('Dr. Asha Rao')).toBe('Dr. Asha Rao');
    expect(withDoctorTitle('dr asha rao')).toBe('Dr. asha rao');
    expect(withDoctorTitle('DR.Asha Rao')).toBe('Dr. Asha Rao');
    expect(withDoctorTitle('  Dr   Asha Rao ')).toBe('Dr. Asha Rao');
    expect(withDoctorTitle('Drew Patil')).toBe('Dr. Drew Patil'); // "Drew" is a name, not the title
    expect(withDoctorTitle('')).toBe('');
    expect(withDoctorTitle('x'.repeat(100))).toHaveLength(100); // still fits the name's 100 characters
    expect(hasDoctorTitle('Dr. Asha Rao')).toBe(true);
    expect(hasDoctorTitle('Dr Asha Rao')).toBe(false);
  });
});

describe('the doctor role gives the title', () => {
  it('a new doctor added by the super admin is "Dr. …" at once; a new nurse is not', async () => {
    const doc = await root.agent.post(`/api/platform/tenants/${home._id}/members`).send({ name: 'Asha Rao', email: 'asha@example.test', roles: ['doctor'] });
    expect(doc.status).toBe(201);
    expect(doc.body.member.user.name).toBe('Dr. Asha Rao');
    expect((await User.findOne({ email: 'asha@example.test' })).name).toBe('Dr. Asha Rao');
    const nurse = await root.agent.post(`/api/platform/tenants/${home._id}/members`).send({ name: 'Neha Shah', email: 'neha@example.test', roles: ['nurse'] });
    expect(nurse.body.member.user.name).toBe('Neha Shah');
  });

  it('an RMO is not given the title (doctor role only)', async () => {
    const rmo = await createUser({ name: 'Ravi Kale' });
    await addMember(rmo, home, 'rmo');
    expect((await User.findById(rmo._id)).name).toBe('Ravi Kale');
  });

  it('giving the doctor role later adds it; the name stays when the role is taken away', async () => {
    const admin = await createUser({ name: 'Home Admin' });
    await addMember(admin, home, 'admin', { adminRights: ['roles', 'details'] });
    const s = await loginAs(admin, { app });
    const person = await createUser({ name: 'Meera Joshi' });
    const m = await addMember(person, home, 'nurse');
    const res = await s.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['doctor'] });
    expect(res.status).toBe(200);
    expect(res.body.member.user.name).toBe('Dr. Meera Joshi');
    await s.patch(`/api/tenant/members/${m._id}/roles`).send({ roles: ['nurse'] });
    expect((await User.findById(person._id)).name).toBe('Dr. Meera Joshi');
  });

  it("an edited doctor's name keeps the title, and the audit log shows the name as saved", async () => {
    const admin = await createUser({ name: 'Home Admin' });
    await addMember(admin, home, 'admin', { adminRights: ['details'] });
    const s = await loginAs(admin, { app });
    const doc = await createUser({ name: 'Asha Rao' });
    const m = await addMember(doc, home, 'doctor');
    const res = await s.patch(`/api/tenant/members/${m._id}`).send({ name: 'Asha Kulkarni' });
    expect(res.status).toBe(200);
    expect(res.body.member.user.name).toBe('Dr. Asha Kulkarni');
    const entry = await AuditLog.findOne({ action: 'USER_UPDATED', target: doc._id }).sort({ createdAt: -1 }).lean();
    expect(entry.details.changes.name).toEqual({ from: 'Asha Rao', to: 'Dr. Asha Kulkarni' }); // added by a test helper, without the title
    // Taking the title out of the name is not a change: it comes back and nothing is logged
    const before = await AuditLog.countDocuments({ action: 'USER_UPDATED', target: doc._id });
    await s.patch(`/api/tenant/members/${m._id}`).send({ name: 'Asha Kulkarni' });
    expect((await User.findById(doc._id)).name).toBe('Dr. Asha Kulkarni');
    expect(await AuditLog.countDocuments({ action: 'USER_UPDATED', target: doc._id })).toBe(before);
  });
});

describe('doctors from before get the title at start-up', () => {
  it('renames them once, with their stays, and logs each', async () => {
    const doc = await createUser({ name: 'Old Doctor' });
    const nurse = await createUser({ name: 'Old Nurse' });
    await Membership.collection.insertMany([
      { tenantId: home._id, userId: doc._id, roles: ['doctor'], isActive: true, adminRights: [], department: '', departments: [] },
      { tenantId: home._id, userId: nurse._id, roles: ['nurse'], isActive: true, adminRights: [], department: '', departments: [] },
    ]);
    await Admission.collection.insertOne({ tenantId: home._id, doctorId: doc._id, doctorName: 'Old Doctor', dischargeInfo: { type: 'normal', doctorId: doc._id, doctorName: 'Old Doctor' } });

    expect(await addDoctorTitles()).toBe(1);
    expect((await User.findById(doc._id)).name).toBe('Dr. Old Doctor');
    expect((await User.findById(nurse._id)).name).toBe('Old Nurse');
    const stay = await Admission.collection.findOne({ tenantId: home._id, doctorId: doc._id });
    expect(stay.doctorName).toBe('Dr. Old Doctor');
    expect(stay.dischargeInfo.doctorName).toBe('Dr. Old Doctor');
    const entry = await AuditLog.findOne({ action: 'USER_UPDATED', target: doc._id }).lean();
    expect(entry.details).toMatchObject({ by: 'doctor-title', changes: { name: { from: 'Old Doctor', to: 'Dr. Old Doctor' } } });

    expect(await addDoctorTitles()).toBe(0); // a second start finds nothing to do
  });

});


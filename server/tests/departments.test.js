// Departments (owner, 9 Nov 2026 – docs/DEPARTMENT_ACCESS_PLAN.md): a doctor sees only the patients of their
// departments – their own, their departments', those with none yet, those sent to their departments, and (read-only)
// the mothers of their departments' babies. Everyone else is "not found". RMOs, nurses and reception are not limited.
// All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Admission } from '../src/models/Admission.js';
import { Membership } from '../src/models/Membership.js';
import { Patient } from '../src/models/Patient.js';
import { moveDepartments } from '../src/patients/moveDepartments.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

let app;
let hospital;
let people;
let sessions;
const STAFF = {
  admin: ['admin', { adminRights: ['addPeople', 'roles'] }],
  obgy: ['doctor', { departments: ['Obgy'], department: 'Obgy' }],
  obgy2: ['doctor', { departments: ['Obgy'], department: 'Obgy' }],
  peds: ['doctor', { departments: ['Pediatric'], department: 'Pediatric' }],
  anes: ['doctor', { departments: ['Anesthesia'], department: 'Anesthesia' }],
  none: ['doctor', { departments: [], department: '' }],
  rmo: ['rmo', {}],
  nurse: ['nurse', {}],
  desk: ['receptionist', {}],
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  hospital = await createTenant('Department Hospital');
  people = {};
  sessions = {};
  for (const [key, [role, extra]] of Object.entries(STAFF)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role, extra);
  }
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function register(fields) {
  const res = await (await as('desk')).post('/api/patients').send(samplePatient(fields));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const listed = async (who, query = '') => ((await (await as(who)).get(`/api/patients?limit=100${query}`)).body.patients ?? []).map((p) => p.fullName);

describe('adding a doctor with departments', () => {
  it('the Add person form saves the doctor with their departments, in the list order; not for other roles', async () => {
    const admin = await as('admin');
    let res = await admin.post('/api/tenant/members').send({ email: 'new.doctor@example.test', name: 'New Doctor', roles: ['doctor'], departments: ['Surgery', 'Obgy'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.member).toMatchObject({ department: 'Obgy', departments: ['Obgy', 'Surgery'] });
    expect(await AuditLog.countDocuments({ action: 'MEMBER_ROLE_CHANGED', 'details.department.to': 'Obgy, Surgery' })).toBe(1);
    res = await admin.post('/api/tenant/members').send({ email: 'new.nurse@example.test', name: 'New Nurse', roles: ['nurse'], departments: ['Obgy'] });
    expect(res.status).toBe(201);
    expect(res.body.member.departments).toEqual([]);
    res = await admin.post('/api/tenant/members').send({ email: 'x@example.test', name: 'X', roles: ['doctor'], departments: ['Neurology'] });
    expect(res.status).toBe(400);
  });
});

describe('a doctor sees only their departments', () => {
  it('lists, opens and changes only their departments’ patients; others are "not found"', async () => {
    const mother = await register({ fullName: 'Obgy Mother', careType: 'gynaecology', department: 'Obgy' });
    const child = await register({ fullName: 'Pediatric Child', careType: 'gynaecology', department: 'Pediatric' });
    const old = await register({ fullName: 'No Department Yet', careType: 'gynaecology' });
    expect(mother.department).toBe('Obgy');
    expect(old.department).toBe('');

    expect(await listed('obgy')).toEqual(expect.arrayContaining(['Obgy Mother', 'No Department Yet']));
    expect(await listed('obgy')).not.toContain('Pediatric Child');
    expect(await listed('obgy', '&search=Pediatric')).toEqual([]);
    const obgy = await as('obgy');
    expect((await obgy.get(`/api/patients/${child.id}`)).status).toBe(404);
    expect((await obgy.patch(`/api/patients/${child.id}`).send({ phone: '+91 00000 11111' })).status).toBe(404);
    expect((await obgy.get(`/api/patients/${child.id}/timeline`)).status).toBe(404);
    expect((await obgy.get(`/api/patients/${mother.id}`)).status).toBe(200);

    // RMOs, nurses and reception: every patient, as before
    for (const who of ['rmo', 'nurse', 'desk']) expect(await listed(who)).toEqual(expect.arrayContaining(['Obgy Mother', 'Pediatric Child', 'No Department Yet']));
    expect((await (await as('rmo')).get(`/api/patients/${child.id}`)).status).toBe(200);
  });

  it('inside the department, another doctor’s patient is read-only as before', async () => {
    const p = await register({ fullName: 'Colleague Patient', careType: 'gynaecology', department: 'Obgy', assignedDoctor: people.obgy.id });
    const res = await (await as('obgy2')).get(`/api/patients/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.patient.access).toMatchObject({ level: 'read_only', canEditClinical: false, canAddEmergencyNote: true });
  });

  it('a doctor with no department sees only their own patients', async () => {
    await register({ fullName: 'Own Patient', careType: 'gynaecology', department: 'Obgy', assignedDoctor: people.none.id });
    await register({ fullName: 'Someone Else', careType: 'gynaecology', department: 'Obgy' });
    await register({ fullName: 'No Department Either', careType: 'gynaecology' });
    expect(await listed('none')).toEqual(['Own Patient']);
  });

  it('reception moves her to another department (recorded); "needs a department" lists those without one', async () => {
    const p = await register({ fullName: 'Moving Patient', careType: 'gynaecology' });
    expect(await listed('desk', '&department=none')).toEqual(['Moving Patient']);
    const res = await (await as('desk')).patch(`/api/patients/${p.id}`).send({ department: 'Pediatric' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED', 'details.fields': 'department' })).toBe(1);
    expect(await listed('obgy')).not.toContain('Moving Patient');
    expect(await listed('peds')).toContain('Moving Patient');
  });
});

describe('sending her to another department', () => {
  it('her doctor sends her to Anesthesia; its doctors can open her until the referral is closed', async () => {
    const p = await register({ fullName: 'Caesarean Patient', careType: 'gynaecology', department: 'Obgy', assignedDoctor: people.obgy.id });
    const anes = await as('anes');
    expect((await anes.get(`/api/patients/${p.id}`)).status).toBe(404);
    // only her doctor or an RMO sends her; nobody can send her to her own department
    expect((await (await as('obgy2')).post(`/api/patients/${p.id}/department-referrals`).send({ department: 'Anesthesia' })).status).toBe(403);
    expect((await (await as('obgy')).post(`/api/patients/${p.id}/department-referrals`).send({ department: 'Obgy' })).status).toBe(400);
    let res = await (await as('obgy')).post(`/api/patients/${p.id}/department-referrals`).send({ department: 'Anesthesia', reason: 'Pre-anaesthesia check' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await listed('anes')).toContain('Caesarean Patient');
    res = await anes.get(`/api/patients/${p.id}`);
    expect(res.status).toBe(200);
    const referral = res.body.patient.departmentReferrals[0];
    expect(referral).toMatchObject({ department: 'Anesthesia', reason: 'Pre-anaesthesia check', closedAt: null });
    // the Anesthesia doctor closes it when done: she is hidden again
    res = await anes.post(`/api/patients/${p.id}/department-referrals/${referral._id ?? referral.id}/close`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await anes.get(`/api/patients/${p.id}`)).status).toBe(404);
    expect(await listed('anes')).not.toContain('Caesarean Patient');
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED', 'details.fields': 'departmentReferrals' })).toBe(2);
  });
});

describe('a baby and her mother', () => {
  it('a baby goes to Pediatric; its doctors may read the mother’s record, never change it', async () => {
    const mother = await register({ fullName: 'Delivered Mother', careType: 'postnatal', department: 'Obgy', assignedDoctor: people.obgy.id });
    const peds = await as('peds');
    expect((await peds.get(`/api/patients/${mother.id}`)).status).toBe(404);
    const baby = await register({ fullName: 'Baby of Delivered Mother', careType: 'newborn', ageYears: undefined, newborn: { birthAt: new Date(Date.now() - 3600_000).toISOString(), mother: mother.id } });
    expect(baby.department).toBe('Pediatric');
    expect((await Patient.findOne({ _id: mother.id, tenantId: hospital._id }).lean()).babyDepartments).toEqual(['Pediatric']);
    const res = await peds.get(`/api/patients/${mother.id}`);
    expect(res.status).toBe(200);
    expect(res.body.patient.access).toMatchObject({ canEditClinical: false, canAddEmergencyNote: false, canEditIdentity: false });
    expect((await peds.patch(`/api/patients/${mother.id}`).send({ phone: '+91 00000 22222' })).status).toBe(403);
    // the Obgy doctor does not see the baby
    expect((await (await as('obgy2')).get(`/api/patients/${baby.id}`)).status).toBe(404);
  });
});

describe('moving the old departments', () => {
  it('old names move to the 9; patients get their doctor’s department; mothers their babies’', async () => {
    const doctor = await createUser({ name: 'Old Doctor' });
    await Membership.collection.insertOne({ tenantId: hospital._id, userId: doctor._id, roles: ['doctor'], isActive: true, department: 'Neonatology', departments: ['Neonatology', 'General Medicine', 'Paediatrics'], adminRights: [] });
    const other = await createUser({ name: 'Old Physician' });
    await Membership.collection.insertOne({ tenantId: hospital._id, userId: other._id, roles: ['doctor'], isActive: true, department: 'General Medicine', departments: ['General Medicine'], adminRights: [] });
    const p = await Patient.create({ tenantId: hospital._id, createdBy: doctor._id, mrn: 'P-OLD-1', careType: 'gynaecology', fullName: 'Old Record', assignedDoctor: doctor._id });
    const baby = await Patient.create({ tenantId: hospital._id, createdBy: doctor._id, mrn: 'P-OLD-2', careType: 'newborn', fullName: 'Old Baby', newborn: { birthAt: new Date('2026-10-01'), mother: p._id } });
    await Admission.collection.insertOne({ tenantId: hospital._id, patientId: p._id, careType: 'gynaecology', admittedAt: new Date(), status: 'discharged', department: 'Obstetrics & Gynaecology' });

    const moved = await moveDepartments();
    expect(moved).toMatchObject({ doctors: 2, stays: 1, patients: 2, mothers: 1 });
    expect(await Membership.findOne({ tenantId: hospital._id, userId: doctor._id }).lean()).toMatchObject({ department: 'Pediatric', departments: ['Pediatric'] });
    expect(await Membership.findOne({ tenantId: hospital._id, userId: other._id }).lean()).toMatchObject({ department: '', departments: [] });
    expect((await Patient.findOne({ _id: p._id, tenantId: hospital._id }).lean())).toMatchObject({ department: 'Pediatric', babyDepartments: ['Pediatric'] });
    expect((await Patient.findOne({ _id: baby._id, tenantId: hospital._id }).lean()).department).toBe('Pediatric');
    expect((await Admission.findOne({ tenantId: hospital._id, patientId: p._id }).lean()).department).toBe('Obgy');
    // a second run finds nothing to do
    expect(await moveDepartments()).toEqual({ doctors: 0, stays: 0, patients: 0, mothers: 0 });
  });
});

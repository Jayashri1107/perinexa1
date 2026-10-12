// Feature 4: "need to know" access to patient records.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PatientNote } from '../src/models/PatientNote.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
const DAY = 24 * 3600 * 1000;
const lmp = () => new Date(Date.now() - 70 * DAY).toISOString().slice(0, 10);

let hospital;
const people = {};
const sessions = {};
let ownPatient; // assigned to drA
let sensitivePatient; // infertility, assigned to drA

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  hospital = await createTenant('Access Hospital');
  for (const [key, roles] of Object.entries({
    drA: 'doctor',
    drB: 'doctor',
    rmo: 'rmo',
    nurse: 'nurse',
    reception: 'receptionist',
    lab: 'lab',
    admin: 'admin',
    adminDoctor: ['admin', 'doctor'],
  })) {
    people[key] = await createUser({ name: key });
    await addMember(people[key], hospital, roles);
    sessions[key] = await loginAs(people[key], { app });
  }
  const a = sessions.drA;
  ownPatient = (
    await a.post('/api/patients').send(
      samplePatient({ careType: 'antenatal', fullName: 'Pregnant Patient', pregnancy: { lmp: lmp() }, medical: { allergies: 'None known', bloodGroup: 'O+' }, notes: 'Doctor note', assignedDoctor: people.drA._id.toString() }),
    )
  ).body.patient;
  sensitivePatient = (
    await a.post('/api/patients').send(samplePatient({ careType: 'infertility', fullName: 'Sensitive Patient', medical: { allergies: 'None known', bloodGroup: 'A+' }, assignedDoctor: people.drA._id.toString() }))
  ).body.patient;
});
afterAll(disconnectTestDb);

const view = async (who, patient) => (await sessions[who].get(`/api/patients/${patient.id}`)).body.patient;

describe('what each role can see', () => {
  it("assigned doctor and RMO see everything and can edit", async () => {
    for (const who of ['drA', 'rmo']) {
      const p = await view(who, ownPatient);
      expect(p.pregnancy).toBeDefined();
      expect(p.notes).toBe('Doctor note');
      expect(p.access).toMatchObject({ level: 'full', canEditClinical: true });
    }
  });

  it("another doctor sees the record read-only and can add an emergency note", async () => {
    const p = await view('drB', ownPatient);
    expect(p.pregnancy).toBeDefined();
    expect(p.access).toMatchObject({ level: 'read_only', canEditClinical: false, canEditIdentity: false, canAddEmergencyNote: true });
    const edit = await sessions.drB.patch(`/api/patients/${ownPatient.id}`).send({ phone: '123' });
    expect(edit.status).toBe(403);
    expect(edit.body.error.message).toMatch(/emergency note/);
    expect((await sessions.drB.patch(`/api/patients/${ownPatient.id}/doctor`).send({ doctorId: people.drB._id.toString() })).status).toBe(403);
    const entry = await AuditLog.findOne({ action: 'PATIENT_VIEWED', actor: people.drB._id });
    expect(entry.details.access).toBe('read_only');
  });

  it('nurse sees medical details but not doctor notes, and cannot edit', async () => {
    const p = await view('nurse', ownPatient);
    expect(p.medical.bloodGroup).toBe('O+');
    expect(p.notes).toBeUndefined();
    expect(p.access.level).toBe('clinical');
    expect((await sessions.nurse.patch(`/api/patients/${ownPatient.id}`).send({ phone: '1' })).status).toBe(403);
  });

  it('reception sees identity only and can edit identity only', async () => {
    const p = await view('reception', ownPatient);
    expect(p).toMatchObject({ fullName: 'Pregnant Patient', phone: expect.any(String), address: expect.any(String) });
    expect(p.pregnancy).toBeUndefined();
    expect(p.medical).toBeUndefined();
    expect(p.notes).toBeUndefined();
    expect((await sessions.reception.patch(`/api/patients/${ownPatient.id}`).send({ phone: '+91 22222 22222' })).status).toBe(200);
    const denied = await sessions.reception.patch(`/api/patients/${ownPatient.id}`).send({ medical: { allergies: 'None known', bloodGroup: 'B+' } });
    expect(denied.status).toBe(403);
    // the list is filtered the same way
    const list = await sessions.reception.get('/api/patients');
    expect(list.body.patients.every((x) => x.pregnancy === undefined && x.medical === undefined)).toBe(true);
  });

  it('lab staff see name and patient number only', async () => {
    const p = await view('lab', ownPatient);
    expect(Object.keys(p).sort()).toEqual(['access', 'careType', 'fullName', 'id', 'mrn', 'tenantId']);
  });

  it('a hospital admin without a clinical role sees no patient data', async () => {
    expect((await sessions.admin.get('/api/patients')).status).toBe(403);
    expect((await sessions.admin.get(`/api/patients/${ownPatient.id}`)).status).toBe(403);
  });

  it('a person with two roles gets the combined access', async () => {
    const p = await view('adminDoctor', ownPatient);
    expect(p.access.level).toBe('read_only'); // doctor role, not their patient
  });
});

describe('sensitive records', () => {
  it('infertility patients are sensitive automatically', () => {
    expect(sensitivePatient.sensitive).toBe(true);
  });

  it('only the treating doctor and RMOs see the medical details', async () => {
    expect((await view('drA', sensitivePatient)).medical).toBeDefined();
    expect((await view('rmo', sensitivePatient)).medical).toBeDefined();
    for (const who of ['drB', 'nurse', 'reception']) {
      const p = await view(who, sensitivePatient);
      expect(p.medical).toBeUndefined();
      expect(p.fullName).toBe('Sensitive Patient');
    }
    expect((await sessions.drB.get(`/api/patients/${sensitivePatient.id}/notes`)).status).toBe(403);
  });

  it('the treating doctor can mark any record as sensitive; others cannot', async () => {
    expect((await sessions.drB.patch(`/api/patients/${ownPatient.id}/sensitive`).send({ sensitive: true })).status).toBe(403);
    const res = await sessions.drA.patch(`/api/patients/${ownPatient.id}/sensitive`).send({ sensitive: true });
    expect(res.body.patient.sensitive).toBe(true);
    expect((await view('nurse', ownPatient)).pregnancy).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: 'PATIENT_SENSITIVITY_CHANGED' })).toBe(1);
  });
});

describe('emergency notes', () => {
  it('another doctor adds an emergency note with a reason; it is audited and cannot be changed', async () => {
    const tooShort = await sessions.drB.post(`/api/patients/${ownPatient.id}/emergency-notes`).send({ reason: 'x', text: 'Gave fluids' });
    expect(tooShort.status).toBe(400);
    const res = await sessions.drB
      .post(`/api/patients/${ownPatient.id}/emergency-notes`)
      .send({ reason: 'Patient collapsed in OPD; Dr A not available', text: 'Gave IV fluids, monitored BP.' });
    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject({ kind: 'emergency', authorName: 'drB' });

    const notes = await sessions.drA.get(`/api/patients/${ownPatient.id}/notes`);
    expect(notes.body.notes).toHaveLength(1);
    const entry = await AuditLog.findOne({ action: 'EMERGENCY_NOTE_ADDED' });
    expect(entry.details.reason).toMatch(/collapsed/);
    await expect(PatientNote.deleteMany({ tenantId: hospital._id })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it('is only for doctors who are not already treating the patient', async () => {
    const body = { reason: 'Testing the emergency route', text: 'Some treatment' };
    expect((await sessions.drA.post(`/api/patients/${ownPatient.id}/emergency-notes`).send(body)).status).toBe(403);
    expect((await sessions.nurse.post(`/api/patients/${ownPatient.id}/emergency-notes`).send(body)).status).toBe(403);
    expect((await sessions.reception.post(`/api/patients/${ownPatient.id}/emergency-notes`).send(body)).status).toBe(403);
  });
});

describe('registering patients', () => {
  it('reception registers identity only; medical details are ignored', async () => {
    const res = await sessions.reception
      .post('/api/patients')
      .send(samplePatient({ careType: 'antenatal', fullName: 'Walk In', medical: { allergies: 'None known', bloodGroup: 'B+' } }));
    expect(res.status).toBe(201);
    const p = await view('drA', res.body.patient);
    expect(p.medical.bloodGroup).toBe('');
  });

  it('nurses and lab staff cannot register patients', async () => {
    expect((await sessions.nurse.post('/api/patients').send(samplePatient())).status).toBe(403);
    expect((await sessions.lab.post('/api/patients').send(samplePatient())).status).toBe(403);
  });

  it('unassigned patients can be edited by any doctor', async () => {
    const p = (await sessions.reception.post('/api/patients').send(samplePatient({ fullName: 'Unassigned' }))).body.patient;
    expect((await view('drB', p)).access.level).toBe('full');
  });
});

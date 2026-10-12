// Registration details added at the owner's request on 7 Oct 2026: the emergency contact and the ID proof seen
// (its type and only the last 4 characters of its number). Identity details: reception enters and sees them, the
// lab and the billing department do not.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { reception: 'receptionist', drA: 'doctor', lab: 'lab', billing: 'billing' };

let app;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  const hospital = await createTenant('Reception Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const CONTACT = { name: 'Sample Relative', relation: 'Husband', phone: '+91 00000 00001' };

describe('emergency contact and ID proof', () => {
  it('reception registers them, sees them and changes them; the audit log names the fields only', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient({ emergencyContact: CONTACT, idProof: { kind: 'aadhaar', last4: '1234' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.patient).toMatchObject({ emergencyContact: CONTACT, idProof: { kind: 'aadhaar', last4: '1234' } });

    const id = res.body.patient.id;
    const changed = await (await as('reception')).patch(`/api/patients/${id}`).send({ emergencyContact: { ...CONTACT, phone: '+91 00000 00002' } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.patient.emergencyContact.phone).toBe('+91 00000 00002');
    const entry = await AuditLog.findOne({ action: 'PATIENT_UPDATED' }).lean();
    expect(JSON.stringify(entry.details)).not.toContain('00002');
  });

  it('never takes a whole ID number, and needs the type with the last 4', async () => {
    const desk = await as('reception');
    const whole = await desk.post('/api/patients').send(samplePatient({ idProof: { kind: 'aadhaar', last4: '123412341234' } }));
    expect(whole.status).toBe(400);
    expect(whole.body.error.fields).toHaveProperty(['idProof.last4']);
    const noType = await desk.post('/api/patients').send(samplePatient({ idProof: { kind: '', last4: '1234' } }));
    expect(noType.status).toBe(400);
    expect(noType.body.error.fields).toHaveProperty(['idProof.kind']);
    const badPhone = await desk.post('/api/patients').send(samplePatient({ emergencyContact: { ...CONTACT, phone: 'call me' } }));
    expect(badPhone.status).toBe(400);
  });

  it('an older record without them still opens, with empty values', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient());
    expect(res.body.patient).toMatchObject({ emergencyContact: { name: '', relation: '', phone: '' }, idProof: { kind: '', last4: '' } });
  });

  it('the lab and the billing department do not see them', async () => {
    const res = await (await as('reception')).post('/api/patients').send(samplePatient({ emergencyContact: CONTACT, idProof: { kind: 'pan', last4: '9F2K' } }));
    for (const who of ['lab', 'billing']) {
      const seen = (await (await as(who)).get(`/api/patients/${res.body.patient.id}`)).body.patient;
      expect(seen.emergencyContact, who).toBeUndefined();
      expect(seen.idProof, who).toBeUndefined();
    }
  });
});

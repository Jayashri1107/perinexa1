// The patient list: More filters → Registered from / to (owner, 13 Oct 2026).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

let s;
let hospital;
beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const app = createApp();
  hospital = await createTenant('Registered Hospital');
  const reception = await createUser({ name: 'Sample Reception' });
  await addMember(reception, hospital, 'receptionist');
  s = await loginAs(reception, { app });
});

async function registeredOn(name, iso) {
  const res = await s.post('/api/patients').send(samplePatient({ fullName: name }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  // 10:00 in India on that day
  await Patient.collection.updateOne({ _id: Patient.castObject({ _id: res.body.patient.id })._id }, { $set: { createdAt: new Date(`${iso}T04:30:00Z`) } });
}

describe('registered from / to', () => {
  it('lists only the patients registered on those days (both days included)', async () => {
    await registeredOn('Early Sample', '2026-09-01');
    await registeredOn('Middle Sample', '2026-09-15');
    await registeredOn('Late Sample', '2026-09-30');
    const names = async (q) => (await s.get(`/api/patients?doctor=all${q}`)).body.patients.map((p) => p.fullName).sort();
    expect(await names('&registeredFrom=2026-09-15&registeredTo=2026-09-30')).toEqual(['Late Sample', 'Middle Sample']);
    expect(await names('&registeredTo=2026-09-01')).toEqual(['Early Sample']);
    expect(await names('&registeredFrom=2026-09-16')).toEqual(['Late Sample']);
    expect((await s.get('/api/patients?registeredFrom=yesterday')).status).toBe(400);
  });
});

// The patient list: More filters → Registered from / to (owner, 13 Oct 2026).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Appointment } from '../src/models/Appointment.js';
import { Patient } from '../src/models/Patient.js';
import { hospitalToday } from '../src/careplans/dates.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

let s;
let hospital;
let reception;
beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const app = createApp();
  hospital = await createTenant('Registered Hospital');
  reception = await createUser({ name: 'Sample Reception' });
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

// Today's patients (owner, 27 Oct 2026, like Docterz): the list staff start with
describe("today's patients", () => {
  const set = (name, fields) => Patient.collection.updateOne({ fullName: name }, { $set: fields });
  it('lists those registered today, booked for today, or – for clinical staff – seen today', async () => {
    const app = createApp();
    const rmo = await createUser({ name: 'Sample RMO' });
    await addMember(rmo, hospital, 'rmo');
    const r = await loginAs(rmo, { app });
    const doctor = await createUser({ name: 'Sample Doctor' });
    await addMember(doctor, hospital, 'doctor');
    for (const name of ['New Sample', 'Old Sample', 'Booked Sample', 'Seen Sample']) {
      expect((await s.post('/api/patients').send(samplePatient({ fullName: name }))).status).toBe(201);
    }
    const lastMonth = new Date(Date.now() - 30 * 86400000);
    for (const name of ['Old Sample', 'Booked Sample', 'Seen Sample']) await set(name, { createdAt: lastMonth, lastVisitOn: null });
    const today = hospitalToday();
    await set('Seen Sample', { lastVisitOn: today });
    const booked = await Patient.findOne({ tenantId: hospital._id, fullName: 'Booked Sample' });
    await Appointment.create({ tenantId: hospital._id, patientId: booked._id, doctorId: doctor._id, on: today, kind: 'token', token: 1, source: 'booked', created: { by: reception._id, byName: 'Sample Reception', at: new Date() } });
    const old = await Patient.findOne({ tenantId: hospital._id, fullName: 'Old Sample' });
    await Appointment.create({ tenantId: hospital._id, patientId: old._id, doctorId: doctor._id, on: today, kind: 'token', token: 2, source: 'booked', status: 'cancelled', created: { by: reception._id, byName: 'Sample Reception', at: new Date() } });

    const names = async (who, q) => (await who.get(`/api/patients?doctor=all${q}`)).body.patients.map((p) => p.fullName).sort();
    expect(await names(r, '&day=today')).toEqual(['Booked Sample', 'New Sample', 'Seen Sample']);
    // A visit is a clinical detail: reception's Today has the registered and the booked only
    expect(await names(s, '&day=today')).toEqual(['Booked Sample', 'New Sample']);
    // All patients, and a search, still find everyone
    expect(await names(s, '')).toEqual(['Booked Sample', 'New Sample', 'Old Sample', 'Seen Sample']);
    expect(await names(s, '&search=Old')).toEqual(['Old Sample']);
    expect((await s.get('/api/patients?day=yesterday')).status).toBe(400);
  });
});

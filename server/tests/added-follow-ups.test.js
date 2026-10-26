// Follow-ups added by hand (26 Oct 2026): "she will come back to Dr A to show her reports". Reception, doctors and RMOs
// add them (with which doctor and what for – a fixed purpose and a short note); when she checks in, the reason is
// marked, her follow-up is done, and her doctor is told why she came. Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { FollowUp } from '../src/models/FollowUp.js';
import { Notification } from '../src/models/Notification.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T06:00:00Z'));
  await resetTestDb();
  app = createApp();
  hospital = await createTenant('Follow-up Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const register = async (fullName) => {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName, assignedDoctor: people.drA._id.toString() }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
};
const add = async (who, body) => (await as(who)).post('/api/added-follow-ups').send(body);

describe('follow-ups added by hand', () => {
  it('reception adds one – doctor, what for, from which day; she checks in for it 4 days later and her doctor is told why', async () => {
    const p = await register('Asha Sample');
    const res = await add('reception', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'reports', note: 'Bring the blood report', from: '2026-10-26' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.followUp).toMatchObject({ patient: { id: p.id, fullName: 'Asha Sample' }, doctor: { name: 'Sample drA' }, purpose: 'reports', note: 'Bring the blood report', from: '2026-10-26', status: 'open', addedBy: 'Sample reception' });
    expect((await (await as('reception')).get(`/api/added-follow-ups?patientId=${p.id}`)).body.followUps).toHaveLength(1);

    // Four days later she comes back: reception checks her in for it
    vi.setSystemTime(new Date('2026-10-26T05:00:00Z'));
    sessions = {};
    const came = await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, purpose: { kind: 'reports', note: 'Bring the blood report' } });
    expect(came.status, JSON.stringify(came.body)).toBe(201);
    expect(came.body).toMatchObject({ arrival: { purpose: { kind: 'reports', note: 'Bring the blood report' } }, followUpsCame: 1 });
    expect((await FollowUp.findOne({ tenantId: hospital._id, patientId: p.id }).lean()).status).toBe('came');
    const told = await Notification.findOne({ tenantId: hospital._id, userId: people.drA._id }).lean();
    expect(told.text).toBe('Asha Sample has arrived. Came for: Show reports (Bring the blood report).');

    // Today: why she came
    const row = (await (await as('reception')).get('/api/today?scope=all')).body.patients.find((r) => r.patient.id === p.id);
    expect(row).toMatchObject({ purpose: { kind: 'reports', note: 'Bring the blood report' }, followUp: null });
    expect((await (await as('reception')).get('/api/added-follow-ups')).body.followUps).toEqual([]);
  });

  it('a follow-up from a later day stays open when she comes earlier; cancelled with an audit entry; who may', async () => {
    const p = await register('Meera Sample');
    const later = (await add('drA', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'consultation', from: '2026-11-05' })).body.followUp;
    await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, purpose: { kind: 'other' } });
    expect((await FollowUp.findOne({ tenantId: hospital._id, _id: later.id }).lean()).status).toBe('open');
    const row = (await (await as('reception')).get('/api/today?scope=all')).body.patients.find((r) => r.patient.id === p.id);
    expect(row.followUp).toMatchObject({ id: later.id, purpose: 'consultation', from: '2026-11-05' });

    expect((await (await as('rmo')).post(`/api/added-follow-ups/${later.id}/cancel`)).status).toBe(200);
    expect((await (await as('rmo')).post(`/api/added-follow-ups/${later.id}/cancel`)).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'FOLLOW_UP_ADDED' })).toBe(1);
    expect((await AuditLog.findOne({ action: 'FOLLOW_UP_CANCELLED' }).lean()).details).toEqual({ followUpId: later.id, patientId: p.id, mrn: p.mrn });

    // Nurses and lab staff do not add follow-ups; the purpose is from the list, the note short
    expect((await add('nurse', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'reports' })).status).toBe(403);
    expect((await add('lab', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'reports' })).status).toBe(403);
    expect((await add('reception', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'diagnosis' })).status).toBe(400);
    expect((await add('reception', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'other', note: 'x'.repeat(121) })).status).toBe(400);
    expect((await add('reception', { patientId: p.id, doctorId: people.reception._id.toString(), purpose: 'other' })).status).toBe(400); // not a doctor
  });

  it('a follow-up always has a day: none given means today (owner, 26 Oct 2026)', async () => {
    const p = await register('Today Sample');
    const res = await add('reception', { patientId: p.id, doctorId: people.drA._id.toString(), purpose: 'consultation' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.followUp.from).toBe('2026-10-22'); // the test's clock: 22 Oct 2026, 11:30 in the hospital
  });
});

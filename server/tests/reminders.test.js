// Smart features, step 3: what a follow-up reminder needs. Fake data only. Time is pinned: 28 Sep 2026, 11:30 in
// India; the sample patient's scan EDD is 1 Mar 2027, so she is 18 w 0 d today (booking items are due).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Reminder Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries({ drA: 'doctor', nurse: 'nurse', reception: 'receptionist', lab: 'lab' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Reminder Mother',
      phone: '9876543210',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
      ...overrides,
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

describe('/api/patients/:id/reminder', () => {
  it('gives the phone, the appointment set at the latest visit and the care-plan items due', async () => {
    const p = await register();
    const visit = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
    await (await as('drA')).patch(`/api/patients/${p.id}/visits/${visit.body.visit.id}`).send({ details: { rev: 0, nextVisitOn: '2026-10-19' } });

    const res = await (await as('nurse')).get(`/api/patients/${p.id}/reminder`);
    expect(res.status).toBe(200);
    expect(res.body.patient).toMatchObject({ fullName: 'Reminder Mother', phone: '9876543210', careType: 'antenatal' });
    expect(res.body.hospital.name).toBe('Reminder Hospital');
    expect(res.body.appointment).toBe('2026-10-19T00:00:00.000Z');
    expect(res.body.plan.due.length + res.body.plan.overdue.length).toBeGreaterThan(0);
    expect(res.body.plan.due[0]).toEqual(expect.objectContaining({ name: expect.any(String), patientText: expect.any(String) }));
    // Only tests, scans and vaccinations; at most 8
    const items = [...res.body.plan.overdue, ...res.body.plan.due];
    expect(items.every((it) => ['investigation', 'scan', 'vaccination'].includes(it.kind))).toBe(true);
    expect(items.length).toBeLessThanOrEqual(8);

    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'REMINDER_PREPARED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn });
  });

  it('is for clinical staff only', async () => {
    const p = await register();
    expect((await (await as('reception')).get(`/api/patients/${p.id}/reminder`)).status).toBe(403);
    expect((await (await as('lab')).get(`/api/patients/${p.id}/reminder`)).status).toBe(403);
  });

  it('works for other types of care, without a plan', async () => {
    const p = await register({ careType: 'gynaecology', pregnancy: undefined, obstetric: undefined });
    const res = await (await as('drA')).get(`/api/patients/${p.id}/reminder`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe(null);
    expect(res.body.appointment).toBe(null);
  });
});

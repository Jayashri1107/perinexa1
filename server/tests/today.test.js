// The Today page's lists (Feature 10): today's patients (booked, arrived) and reception's call lists.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // hospital today: 28 Sep 2026
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };

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
  hospital = await createTenant('Today Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const today = async (who, query = '') => (await as(who)).get(`/api/today${query}`);

async function register(name, { doctor = 'drA', scanEdd = '2027-03-01', careType = 'antenatal' } = {}) {
  const res = await (await as(doctor)).post('/api/patients').send(
    samplePatient({
      careType,
      fullName: name,
      ageYears: 28,
      assignedDoctor: people[doctor]._id.toString(),
      ...(careType === 'antenatal'
        ? {
            pregnancy: { scanEdd },
            obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
            medical: { bloodGroup: 'B+', allergies: 'None known', conditionsReviewed: true },
          }
        : {}),
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

async function visit(who, p, visitOn, nextVisitOn) {
  const created = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (nextVisitOn) {
    const res = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${created.body.visit.id}`).send({ details: { rev: 0, nextVisitOn } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return created.body.visit;
}

describe('today', () => {
  it('is for doctors, RMOs and reception', async () => {
    expect((await today('nurse')).status).toBe(403);
    expect((await today('lab')).status).toBe(403);
    expect((await today('reception')).status).toBe(200);
    expect((await today('rmo')).body.scope).toBe('all');
    expect((await today('drA')).body).toMatchObject({ scope: 'mine', canChooseScope: true, dueNow: null, overdue: null });
  });

  it("lists who is booked today, who has arrived and when, and who came without a booking", async () => {
    const booked = await register('Booked Mother');
    const walkIn = await register('Walk-in Mother');
    await visit('nurse', booked, '2026-09-14', '2026-09-28'); // booked for today

    let body = (await today('reception')).body;
    expect(body.patients).toEqual([
      {
        patient: { id: booked.id, fullName: 'Booked Mother', mrn: booked.mrn, phone: '+91 00000 00000', doctorName: 'Sample drA' },
        // The next visit booked itself (appointment booking); drA has no OPD timings, so it still needs a time
        appointment: expect.objectContaining({ kind: 'slot', start: null, needsTime: true, doctorName: 'Sample drA' }),
        booked: true,
        arrivedAt: null,
        arrivalMarked: false,
        visitStarted: false,
        queue: 'expected',
        emergency: false,
        leftMarked: false,
      },
    ]);

    vi.setSystemTime(new Date('2026-09-28T06:10:00Z'));
    await visit('nurse', walkIn);
    vi.setSystemTime(new Date('2026-09-28T06:20:00Z'));
    const came = await visit('nurse', booked);

    body = (await today('reception')).body;
    expect(body.patients.map((r) => [r.patient.fullName, r.booked, r.arrivedAt])).toEqual([
      ['Walk-in Mother', false, '2026-09-28T06:10:00.000Z'],
      ['Booked Mother', true, '2026-09-28T06:20:00.000Z'],
    ]);
    expect(body.patients.every((r) => !('visitId' in r))).toBe(true); // reception never gets visit ids
    const dr = (await today('drA')).body;
    expect(dr.patients.find((r) => r.patient.id === booked.id).visitId).toBe(came.id);
  });

  it("'My patients' are the doctor's own and unassigned ones", async () => {
    const mine = await register('Mine Mother');
    const theirs = await register('Theirs Mother', { doctor: 'drB' });
    await visit('nurse', mine);
    await visit('nurse', theirs);
    expect((await today('drA')).body.patients.map((r) => r.patient.fullName)).toEqual(['Mine Mother']);
    expect((await today('drA', '?scope=all')).body.patients.map((r) => r.patient.fullName).sort()).toEqual(['Mine Mother', 'Theirs Mother']);
  });

  it('reception call lists: a visit due now, a missed booking – with the first day only – and not those already coming', async () => {
    const due = await register('Due Mother');
    const plan = (await (await as('drA')).get(`/api/patients/${due.id}/care-plan`)).body.plan;
    const open = plan.items.find((i) => i.kind === 'visit' && ['due', 'overdue'].includes(i.status));
    expect(open, 'a care-plan visit is open at 28 Sep').toBeTruthy();

    const gyn = await register('Missed Patient', { careType: 'gynaecology' });
    await visit('nurse', gyn, '2026-09-10', '2026-09-21'); // booked for 21 Sep, never came

    let body = (await today('reception')).body;
    const listed = [...body.dueNow, ...body.overdue];
    const dueRow = listed.find((r) => r.patient.id === due.id);
    expect(dueRow.dueFrom).toBe(String(open.due.from).slice(0, 10));
    expect(Object.keys(dueRow).sort()).toEqual(open.status === 'due' ? ['dueFrom', 'patient'] : ['bookedFor', 'dueFrom', 'patient']);
    expect(body.overdue.find((r) => r.patient.id === gyn.id)).toMatchObject({ bookedFor: '2026-09-21', dueFrom: null });
    expect(JSON.stringify(body)).not.toMatch(/Antenatal visit|weeks|"to"/);

    // Booked for a later day, or seen today: no longer on a call list.
    await visit('nurse', due, '2026-09-20', '2026-10-05');
    await visit('nurse', gyn);
    body = (await today('reception')).body;
    expect([...body.dueNow, ...body.overdue].map((r) => r.patient.id)).not.toContain(due.id);
    expect([...body.dueNow, ...body.overdue].map((r) => r.patient.id)).not.toContain(gyn.id);
  });
});

describe('marking arrived', () => {
  it('reception marks a booked patient arrived; it shows on Today and the calendar, can be undone, and is audited', async () => {
    const booked = await register('Booked Mother');
    await visit('nurse', booked, '2026-09-14', '2026-09-28');
    vi.setSystemTime(new Date('2026-09-28T06:05:00Z'));
    const res = await (await as('reception')).post('/api/arrivals').send({ patientId: booked.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await (await as('reception')).post('/api/arrivals').send({ patientId: booked.id })).status).toBe(201); // twice: kept once

    const row = (await today('reception')).body.patients.find((r) => r.patient.id === booked.id);
    expect(row).toMatchObject({ booked: true, arrivedAt: '2026-09-28T06:05:00.000Z', arrivalMarked: true, visitStarted: false });
    const cal = await (await as('reception')).get('/api/calendar?view=day&date=2026-09-28');
    expect(cal.body.events.find((e) => e.type === 'booked' && e.patientId === booked.id)).toMatchObject({ state: 'arrived', arrivedAt: '2026-09-28T06:05:00.000Z' });

    // The nurse sees her waiting, until her visit is started
    const waiting = (await (await as('nurse')).get('/api/worklist')).body.waiting;
    expect(waiting.map((w) => w.patient.id)).toEqual([booked.id]);
    vi.setSystemTime(new Date('2026-09-28T06:15:00Z'));
    await visit('nurse', booked);
    expect((await (await as('nurse')).get('/api/worklist')).body.waiting).toEqual([]);
    expect((await today('reception')).body.patients.find((r) => r.patient.id === booked.id).arrivedAt).toBe('2026-09-28T06:05:00.000Z'); // the earlier time

    expect((await (await as('reception')).delete(`/api/arrivals/${booked.id}`)).body.undone).toBe(true);
    expect((await (await as('lab')).post('/api/arrivals').send({ patientId: booked.id })).status).toBe(403);
    const { AuditLog } = await import('../src/models/AuditLog.js');
    expect(await AuditLog.countDocuments({ action: 'PATIENT_ARRIVED' })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_ARRIVAL_UNDONE' })).toBe(1);
  });

  it('a patient marked arrived is not on the call lists', async () => {
    const gyn = await register('Missed Patient', { careType: 'gynaecology' });
    await visit('nurse', gyn, '2026-09-10', '2026-09-21');
    expect((await today('reception')).body.overdue.map((r) => r.patient.id)).toContain(gyn.id);
    await (await as('reception')).post('/api/arrivals').send({ patientId: gyn.id });
    const body = (await today('reception')).body;
    expect(body.overdue.map((r) => r.patient.id)).not.toContain(gyn.id);
    expect(body.patients.find((r) => r.patient.id === gyn.id)).toMatchObject({ booked: false, arrivalMarked: true });
  });
});

describe('details missing (reception)', () => {
  it('lists recent registrations with a detail missing – what is missing, never anything clinical – until it is filled in', async () => {
    const quick = await register('Quick Patient', { careType: 'gynaecology' }); // name, age, phone, address, doctor: no emergency contact
    const bare = (await (await as('reception')).post('/api/patients').send({ careType: 'gynaecology', fullName: 'Bare Patient', ageYears: 25, phone: '98765 43210', registerAnyway: true })).body.patient;
    expect(bare?.id).toBeTruthy();
    const full = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Full Patient', assignedDoctor: people.drA._id.toString(), emergencyContact: { name: 'Sample Relative', relation: 'Husband', phone: '90000 00001' } }))).body.patient;

    let body = (await today('reception')).body;
    const rows = Object.fromEntries(body.incomplete.map((r) => [r.patient.fullName, r.missing]));
    expect(rows).toEqual({ 'Quick Patient': ['emergencyContact'], 'Bare Patient': ['address', 'emergencyContact', 'doctor'] });
    expect(body.incomplete.find((r) => r.patient.id === bare.id)).toEqual({ patient: { id: bare.id, fullName: 'Bare Patient', mrn: bare.mrn, phone: '98765 43210', doctorName: null }, missing: ['address', 'emergencyContact', 'doctor'], registeredOn: '2026-09-28' });
    expect(full.id).toBeTruthy();
    expect(quick.id).toBeTruthy();

    // Filled in: off the list. Doctors get no such list.
    expect((await (await as('reception')).patch(`/api/patients/${quick.id}`).send({ emergencyContact: { name: 'Sample Relative', relation: 'Mother', phone: '90000 00002' } })).status).toBe(200);
    body = (await today('reception')).body;
    expect(body.incomplete.map((r) => r.patient.fullName)).toEqual(['Bare Patient']);
    expect((await today('drA')).body.incomplete).toBeNull();
  });
});

describe('the live queue (reception)', () => {
  it('expected → waiting → with the doctor → done; an emergency goes first on Today and in the doctor’s line; audited', async () => {
    const first = await register('First Mother');
    const urgent = await register('Urgent Mother');
    const later = await register('Later Mother');
    for (const p of [first, urgent, later]) await visit('nurse', p, '2026-09-14', '2026-09-28'); // all booked for today
    const row = async (p) => (await today('reception')).body.patients.find((r) => r.patient.id === p.id);
    expect(await row(first)).toMatchObject({ queue: 'expected', emergency: false });

    // Not arrived yet: no emergency, no "done"
    expect((await (await as('reception')).post(`/api/arrivals/${first.id}/emergency`).send({ emergency: true })).status).toBe(409);

    vi.setSystemTime(new Date('2026-09-28T06:05:00Z'));
    await (await as('reception')).post('/api/arrivals').send({ patientId: first.id });
    vi.setSystemTime(new Date('2026-09-28T06:06:00Z'));
    await (await as('reception')).post('/api/arrivals').send({ patientId: urgent.id });
    expect(await row(first)).toMatchObject({ queue: 'waiting' });

    // The emergency: first on Today and in the doctor's waiting line
    const set = await (await as('reception')).post(`/api/arrivals/${urgent.id}/emergency`).send({ emergency: true });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    let body = (await today('reception')).body;
    expect(body.patients.map((r) => [r.patient.fullName, r.queue, r.emergency])).toEqual([
      ['Urgent Mother', 'waiting', true],
      ['First Mother', 'waiting', false],
      ['Later Mother', 'expected', false],
    ]);
    const queue = (await (await as('reception')).get('/api/appointments/queue')).body.queues.find((q) => q.doctor.id === people.drA._id.toString());
    expect(queue.waiting.map((w) => [w.patient.fullName, w.emergency])).toEqual([
      ['Urgent Mother', true],
      ['First Mother', false],
    ]);

    // Her visit started: with the doctor; reception marks she left: done (and can undo it)
    await visit('nurse', first);
    expect(await row(first)).toMatchObject({ queue: 'with_doctor' });
    expect((await (await as('reception')).post(`/api/arrivals/${first.id}/left`).send({ left: true })).status).toBe(200);
    expect(await row(first)).toMatchObject({ queue: 'done' });
    expect((await (await as('reception')).post(`/api/arrivals/${first.id}/left`).send({ left: false })).status).toBe(200);
    expect(await row(first)).toMatchObject({ queue: 'with_doctor' });

    // Only those who mark arrivals; a wrong body is refused
    expect((await (await as('lab')).post(`/api/arrivals/${urgent.id}/emergency`).send({ emergency: false })).status).toBe(403);
    expect((await (await as('reception')).post(`/api/arrivals/${urgent.id}/emergency`).send({ emergency: 'yes' })).status).toBe(400);

    const { AuditLog } = await import('../src/models/AuditLog.js');
    const entry = await AuditLog.findOne({ action: 'ARRIVAL_EMERGENCY_CHANGED' }).lean();
    expect(entry.details).toEqual({ patientId: urgent.id, mrn: urgent.mrn, emergency: true });
    expect(await AuditLog.countDocuments({ action: 'PATIENT_LEFT_MARKED' })).toBe(2);
  });
});

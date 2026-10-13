// Appointment booking (docs/APPOINTMENTS_PLAN.md): OPD timings, time slots, quick bookings, the next visit booking
// itself, walk-in tokens, the waiting order, the calendar and Today, messages, and who may do what.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitingOrder } from '../src/appointments/slots.js';
import { convertNextVisits } from '../src/appointments/appointmentService.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { Visit } from '../src/models/Visit.js';
import { runReminders } from '../src/reminders/reminderService.js';
import { TEST_SENDER, setTestSender, testSent } from '../src/reminders/sender.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital (India)
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }] }));

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
  setTestSender(null);
  testSent().length = 0;
  app = createApp();
  hospital = await createTenant('Appointment Hospital');
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
  setTestSender(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const id = (who) => people[who]._id.toString();
const timings = async (who, doctor, body) => (await as(who)).put(`/api/appointments/timings/${id(doctor)}`).send(body);
const setWeek = (doctor = 'drA', leave = []) => timings(doctor, doctor, { week: WEEKDAYS, leave });
const book = async (who, body) => (await as(who)).post('/api/appointments').send(body);
const day = async (who, doctor, date) => (await as(who)).get(`/api/appointments/day?doctorId=${id(doctor)}&date=${date}`);

async function register(name, { doctor = 'drA', phone = '+91 98765 43210' } = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, phone, assignedDoctor: id(doctor) }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

async function visitWithNext(p, nextVisitOn, { who = 'drA', visitOn } = {}) {
  const created = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const res = await (await as(who)).patch(`/api/patients/${p.id}/visits/${created.body.visit.id}`).send({ details: { rev: 0, nextVisitOn } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

describe('OPD timings', () => {
  it('each doctor sets their own (or the hospital admin); others may only look', async () => {
    expect((await setWeek('drA')).status).toBe(200);
    expect((await timings('drB', 'drA', { week: [], leave: [] })).status).toBe(403);
    expect((await timings('reception', 'drA', { week: [], leave: [] })).status).toBe(403);
    expect((await timings('admin', 'drB', { week: WEEKDAYS.slice(0, 2), leave: [] })).status).toBe(200);
    const seen = await (await as('reception')).get(`/api/appointments/timings/${id('drA')}`);
    expect(seen.body.canEdit).toBe(false);
    expect(seen.body.timings.week[1].sessions).toEqual([{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }]);
    expect(seen.body.timings.week[0].sessions).toEqual([]); // Sunday off
    expect((await (await as('lab')).get(`/api/appointments/timings/${id('drA')}`)).status).toBe(403);
    const doctors = (await (await as('reception')).get('/api/appointments/doctors')).body;
    expect(doctors.canBook).toBe(true);
    expect(doctors.doctors.map((d) => [d.name, d.hasTimings])).toEqual([['Sample drA', true], ['Sample drB', true]]);
    expect(await AuditLog.countDocuments({ action: 'OPD_TIMINGS_CHANGED' })).toBe(2);
  });

  it('refuses sessions that overlap, are off the 10-minute grid or end before they start', async () => {
    const overlap = await timings('drA', 'drA', { week: [{ day: 1, sessions: [{ from: '10:00', to: '13:00' }, { from: '12:00', to: '14:00' }] }], leave: [] });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.message).toMatch(/overlap/);
    expect((await timings('drA', 'drA', { week: [{ day: 1, sessions: [{ from: '10:05', to: '13:00' }] }], leave: [] })).body.error.message).toMatch(/grid/);
    expect((await timings('drA', 'drA', { week: [{ day: 1, sessions: [{ from: '13:00', to: '10:00' }] }], leave: [] })).status).toBe(400);
    expect((await timings('drA', 'drA', { week: [], leave: [{ from: '2026-10-05', to: '2026-10-01' }] })).status).toBe(400);
  });

  it('lists bookings that no longer fit after a change (e.g. new leave), for reception to move', async () => {
    await setWeek();
    const p = await register('Leave Mother');
    await book('reception', { doctorId: id('drA'), date: '2026-10-02', start: '10:30', patientId: p.id });
    const res = await setWeek('drA', [{ from: '2026-10-01', to: '2026-10-03', note: 'Conference' }]);
    expect(res.body.affected.map((a) => [a.date, a.start, a.patient.fullName])).toEqual([['2026-10-02', '10:30', 'Leave Mother']]);
  });
});

describe('booking a time slot', () => {
  it('reception and doctors book; RMOs, nurses and lab staff cannot', async () => {
    await setWeek();
    const p = await register('Booked Mother');
    const body = { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id, visitType: 'scan' };
    for (const who of ['rmo', 'nurse', 'lab', 'admin']) expect((await book(who, body)).status).toBe(403);
    const res = await book('reception', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.appointment).toMatchObject({
      date: '2026-09-29',
      kind: 'slot',
      start: '10:00',
      visitType: 'scan',
      status: 'booked',
      doctor: { id: id('drA'), name: 'Sample drA' },
      patient: { id: p.id, fullName: 'Booked Mother', mrn: p.mrn },
      bookedBy: 'Sample reception',
    });
    expect((await book('drB', { ...body, start: '10:10', confirm: true })).status).toBe(201);
    const audit = await AuditLog.findOne({ action: 'APPOINTMENT_BOOKED', 'details.start': '10:00' }).lean();
    expect(audit.details).toMatchObject({ patientId: p.id, doctorId: id('drA'), date: '2026-09-29', start: '10:00' });
  });

  it("refuses times outside the doctor's OPD, on leave, already past today, or before timings are set", async () => {
    const p = await register('Careful Mother');
    const at = (date, start) => book('reception', { doctorId: id('drA'), date, start, patientId: p.id });
    expect((await at('2026-09-29', '10:00')).body.error.code).toBe('NO_TIMINGS');
    await setWeek('drA', [{ from: '2026-10-05', to: '2026-10-06' }]);
    expect((await at('2026-10-04', '10:00')).body.error.code).toBe('NO_OPD'); // Sunday
    expect((await at('2026-10-05', '10:00')).body.error.code).toBe('ON_LEAVE');
    expect((await at('2026-09-29', '14:00')).body.error.code).toBe('OUTSIDE_OPD');
    expect((await at('2026-09-29', '10:05')).body.error.code).toBe('OUTSIDE_OPD');
    expect((await at('2026-09-28', '11:00')).body.error.code).toBe('TIME_PASSED'); // 11:30 now
    expect((await at('2026-09-27', '11:00')).body.error.code).toBe('DAY_PASSED');
    expect((await at('2026-09-28', '12:00')).status).toBe(201);
    expect((await book('reception', { doctorId: id('rmo'), date: '2026-09-29', start: '10:00', patientId: p.id })).body.error.code).toBe('NOT_A_DOCTOR');
  });

  it('warns before double booking a slot or a second appointment that day, and books after "Book anyway"', async () => {
    await setWeek();
    const first = await register('First Mother');
    const second = await register('Second Mother');
    const slot = { doctorId: id('drA'), date: '2026-09-29', start: '10:00' };
    await book('reception', { ...slot, patientId: first.id });
    const taken = await book('reception', { ...slot, patientId: second.id });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(taken.body.error.message).toMatch(/10:00 AM is already booked for First Mother/);
    expect((await book('reception', { ...slot, patientId: second.id, confirm: true })).status).toBe(201);
    const again = await book('reception', { ...slot, start: '11:00', patientId: first.id });
    expect(again.body.error.code).toBe('ALREADY_BOOKED');
    const view = (await day('reception', 'drA', '2026-09-29')).body;
    expect(view.slots.find((s) => s.start === '10:00').appointments.map((a) => a.patient.fullName)).toEqual(['First Mother', 'Second Mother']);
    expect(view.slots).toHaveLength(36); // 3 h + 3 h of 10-minute slots
  });

  it('a quick booking (name and phone) joins her record once she is registered', async () => {
    await setWeek();
    const res = await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '17:00', guest: { name: 'Phone Caller', phone: '98765 00000' }, visitType: 'new' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.appointment).toMatchObject({ patient: null, guest: { name: 'Phone Caller', phone: '98765 00000' }, visitType: 'new' });
    expect((await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '17:10' })).status).toBe(400); // neither patient nor name
    const p = await register('Phone Caller');
    const linked = await (await as('reception')).post(`/api/appointments/${res.body.appointment.id}/link`).send({ patientId: p.id });
    expect(linked.body.appointment.patient).toMatchObject({ id: p.id, fullName: 'Phone Caller' });
    expect((await (await as('reception')).post(`/api/appointments/${res.body.appointment.id}/link`).send({ patientId: p.id })).status).toBe(409);
    const mine = (await (await as('reception')).get(`/api/appointments/patient/${p.id}`)).body;
    expect(mine.upcoming.map((a) => [a.date, a.start])).toEqual([['2026-09-29', '17:00']]);
  });

  it('moves and cancels; a cancelled, past or already-arrived appointment stays as it is', async () => {
    await setWeek();
    const p = await register('Moving Mother');
    const appt = (await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id })).body.appointment;
    const moved = await (await as('drA')).post(`/api/appointments/${appt.id}/move`).send({ date: '2026-09-30', start: '18:00' });
    expect(moved.body.appointment).toMatchObject({ date: '2026-09-30', start: '18:00', movedByHand: true });
    expect((await (await as('nurse')).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'patient_asked' })).status).toBe(403);
    const cancelled = await (await as('reception')).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'patient_asked' });
    expect(cancelled.body.appointment).toMatchObject({ status: 'cancelled', cancelled: { reason: 'patient_asked', byName: 'Sample reception' } });
    expect((await (await as('reception')).post(`/api/appointments/${appt.id}/move`).send({ date: '2026-10-01', start: '10:00' })).status).toBe(409);

    const today = (await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '12:00', patientId: p.id })).body.appointment;
    await (await as('reception')).post('/api/arrivals').send({ patientId: p.id });
    const refused = await (await as('reception')).post(`/api/appointments/${today.id}/cancel`).send({ reason: 'other' });
    expect(refused.body.error.message).toMatch(/arrived/);
  });

  it("another hospital's doctors and appointments are out of reach", async () => {
    await setWeek();
    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Outside Doctor' });
    await addMember(outsider, other, ['doctor', 'receptionist']);
    const p = await register('Home Mother');
    const appt = (await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id })).body.appointment;
    const them = await loginAs(outsider, { app });
    expect((await them.post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'other' })).status).toBe(404);
    expect((await them.post('/api/appointments').send({ doctorId: id('drA'), date: '2026-09-29', start: '10:10', patientId: p.id })).body.error.code).toBe('NOT_A_DOCTOR');
    expect((await them.get(`/api/appointments/patient/${p.id}`)).status).toBe(404);
  });
});

describe("a visit's next visit books itself", () => {
  it('takes the first free slot that day with her doctor and shows it on the visit page', async () => {
    await setWeek();
    const other = await register('Early Bird');
    await book('reception', { doctorId: id('drA'), date: '2026-10-12', start: '10:00', patientId: other.id });
    const p = await register('Next Mother');
    const page = await visitWithNext(p, '2026-10-12');
    expect(page.booking).toMatchObject({ date: '2026-10-12', start: '10:10', needsTime: false, doctorName: 'Sample drA', movedByHand: false });
    const appt = await Appointment.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    expect(appt).toMatchObject({ source: 'next_visit', visitType: 'follow_up', kind: 'slot' });

    // Changing the date moves it; clearing it cancels it
    const v = await Visit.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    const moved = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v._id}`).send({ details: { rev: 1, nextVisitOn: '2026-10-13' } });
    expect(moved.body.booking).toMatchObject({ date: '2026-10-13', start: '10:00' });
    await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v._id}`).send({ details: { rev: 2, nextVisitOn: null } });
    expect(await Appointment.countDocuments({ tenantId: hospital._id, patientId: p.id, status: 'booked' })).toBe(0);
  });

  it('needs a time when the doctor is on leave or has no OPD that day; reception gives it one', async () => {
    await setWeek('drA', [{ from: '2026-10-12', to: '2026-10-12' }]);
    const p = await register('Leave Mother');
    const page = await visitWithNext(p, '2026-10-12');
    expect(page.booking).toMatchObject({ date: '2026-10-12', start: null, needsTime: true });
    const list = (await (await as('reception')).get('/api/appointments/needs-time')).body.appointments;
    expect(list.map((a) => [a.patient.fullName, a.date, a.needsTime, a.fromVisit])).toEqual([['Leave Mother', '2026-10-12', true, true]]);
    const given = await (await as('reception')).post(`/api/appointments/${list[0].id}/move`).send({ date: '2026-10-13', start: '17:30' });
    expect(given.body.appointment).toMatchObject({ date: '2026-10-13', start: '17:30', needsTime: false, movedByHand: true });
    expect((await (await as('reception')).get('/api/appointments/needs-time')).body.appointments).toEqual([]);

    // Moved by hand: a later change of the next-visit date leaves it alone
    const v = await Visit.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    const again = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v._id}`).send({ details: { rev: 1, nextVisitOn: '2026-10-20' } });
    expect(again.status).toBe(200);
    expect(await Appointment.find({ tenantId: hospital._id, patientId: p.id, status: 'booked' }).lean()).toMatchObject([{ start: '17:30' }]);
  });

  it('when the doctor sets OPD timings, next visits waiting for a time get the first free slot', async () => {
    const p = await register('Waiting Mother');
    const page = await visitWithNext(p, '2026-10-12');
    expect(page.booking).toMatchObject({ needsTime: true }); // no timings yet
    const res = await setWeek();
    expect(res.body.placed).toBe(1);
    expect(await Appointment.findOne({ tenantId: hospital._id, patientId: p.id }).lean()).toMatchObject({ start: '10:00', movedByHand: false });
  });

  it('a cancelled visit takes its booking with it', async () => {
    await setWeek();
    const p = await register('Cancel Mother');
    await visitWithNext(p, '2026-10-12');
    const v = await Visit.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    expect((await (await as('drA')).post(`/api/patients/${p.id}/visits/${v._id}/cancel`).send({ reason: 'Entered for the wrong patient' })).status).toBe(200);
    expect(await Appointment.findOne({ tenantId: hospital._id, patientId: p.id }).lean()).toMatchObject({ status: 'cancelled', cancelled: { reason: 'visit_cancelled' } });
  });

  it('next-visit dates from before appointment booking are turned into appointments once', async () => {
    await setWeek();
    const p = await register('Old Booking');
    await Visit.create({ tenantId: hospital._id, patientId: p.id, visitOn: new Date('2026-09-20T00:00:00Z'), careType: 'gynaecology', clientRequestId: randomUUID(), details: { nextVisitOn: new Date('2026-10-12T00:00:00Z') }, createdBy: people.drA._id, createdByName: 'Sample drA' });
    expect(await convertNextVisits(hospital._id, NOW)).toBe(1);
    expect(await convertNextVisits(hospital._id, NOW)).toBe(0);
    expect(await Appointment.findOne({ tenantId: hospital._id, patientId: p.id }).lean()).toMatchObject({ start: '10:00', source: 'next_visit' });
  });
});

describe('walk-ins, tokens and the waiting order', () => {
  it('gives each doctor their own token numbers for the day; an undo cancels the token, never reusing its number', async () => {
    await setWeek();
    const [a, b, c] = [await register('Walk A'), await register('Walk B'), await register('Walk C', { doctor: 'drB' })];
    const arrive = async (p, doctor) => (await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, ...(doctor ? { doctorId: id(doctor) } : {}) })).body;
    expect((await arrive(a, 'drA')).appointment).toMatchObject({ kind: 'token', token: 1, status: 'arrived', doctor: { name: 'Sample drA' } });
    expect((await arrive(b, 'drA')).appointment.token).toBe(2);
    expect((await arrive(c, 'drB')).appointment.token).toBe(1);
    await (await as('reception')).delete(`/api/arrivals/${b.id}`);
    expect(await Appointment.findOne({ tenantId: hospital._id, patientId: b.id }).lean()).toMatchObject({ status: 'cancelled', cancelled: { reason: 'arrival_undone' } });
    expect((await arrive(b, 'drA')).appointment.token).toBe(3);
    expect((await arrive(a)).appointment.token).toBe(1); // marked again: same token
  });

  it('a booked patient who arrives keeps her slot; no token', async () => {
    await setWeek();
    const p = await register('Booked Arrival');
    await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '12:00', patientId: p.id });
    const res = await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, doctorId: id('drA') });
    expect(res.body.appointment).toMatchObject({ kind: 'slot', start: '12:00', status: 'arrived' });
    expect(await Appointment.countDocuments({ tenantId: hospital._id, kind: 'token' })).toBe(0);
  });

  it('booked patients go in at their time, walk-ins fill the gaps in token order', () => {
    const order = waitingOrder(
      [
        { name: 'early booked', kind: 'slot', start: '12:00', arrivedAt: '2026-09-28T05:00:00Z' },
        { name: 'token 2', kind: 'token', token: 2 },
        { name: 'due 11:20', kind: 'slot', start: '11:20', arrivedAt: '2026-09-28T05:55:00Z' },
        { name: 'token 1', kind: 'token', token: 1 },
        { name: 'due 11:00', kind: 'slot', start: '11:00', arrivedAt: '2026-09-28T05:50:00Z' },
      ],
      11 * 60 + 30,
    );
    expect(order.map((e) => e.name)).toEqual(['due 11:00', 'due 11:20', 'token 1', 'token 2', 'early booked']);
  });

  it("each doctor's waiting list for doctors, RMOs, nurses and reception – not lab staff", async () => {
    await setWeek();
    const booked = await register('Due Mother');
    const walkIn = await register('Walk Mother');
    const expected = await register('Expected Mother');
    vi.setSystemTime(new Date('2026-09-28T05:00:00Z')); // 10:30
    await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '11:00', patientId: booked.id });
    await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '12:30', patientId: expected.id });
    await (await as('reception')).post('/api/arrivals').send({ patientId: walkIn.id, doctorId: id('drA') });
    await (await as('reception')).post('/api/arrivals').send({ patientId: booked.id });
    vi.setSystemTime(NOW); // 11:30: the 11:00 booking goes before the walk-in
    expect((await (await as('lab')).get('/api/appointments/queue')).status).toBe(403);
    const q = (await (await as('nurse')).get('/api/appointments/queue')).body;
    expect(q.queues).toHaveLength(1);
    expect(q.queues[0].waiting.map((w) => w.patient.fullName)).toEqual(['Due Mother', 'Walk Mother']);
    expect(q.queues[0].expected.map((w) => w.patient.fullName)).toEqual(['Expected Mother']);

    // Seen once her visit is started
    await (await as('drA')).post(`/api/patients/${booked.id}/visits`).send({ clientRequestId: randomUUID() });
    const after = (await (await as('drA')).get('/api/appointments/queue')).body.queues[0];
    expect(after.waiting.map((w) => w.patient.fullName)).toEqual(['Walk Mother']);
    expect(after.seen).toBe(1);
  });
});

describe('the calendar, Today and the call lists', () => {
  it('the calendar shows each booking with its time and doctor; reception ids hold nothing clinical', async () => {
    await setWeek();
    const p = await register('Calendar Mother');
    await visitWithNext(p, '2026-10-12');
    const res = await (await as('reception')).get('/api/calendar?view=day&date=2026-10-12');
    expect(res.body.events).toEqual([
      expect.objectContaining({ type: 'booked', date: '2026-10-12', patientId: p.id, state: 'booked', start: '10:00', doctorName: 'Sample drA', needsTime: false }),
    ]);
    expect(res.body.events[0].id).toMatch(/^appt:/);
    expect(res.body.events[0].visitId).toBeUndefined();
    const dr = await (await as('drA')).get('/api/calendar?view=day&date=2026-10-12');
    expect(dr.body.events).toHaveLength(1); // not twice (the visit's own next-visit date is not shown again)
    expect(dr.body.events[0]).toMatchObject({ start: '10:00', visitId: expect.any(String) });
  });

  it('Today shows the time or token and the doctor, and the quick bookings of the day', async () => {
    await setWeek();
    const p = await register('Today Mother');
    await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '12:10', patientId: p.id });
    await book('reception', { doctorId: id('drA'), date: '2026-09-28', start: '12:20', guest: { name: 'New Caller', phone: '90000 11111' } });
    const body = (await (await as('reception')).get('/api/today')).body;
    expect(body.patients.find((r) => r.patient.id === p.id).appointment).toMatchObject({ kind: 'slot', start: '12:10', doctorName: 'Sample drA' });
    expect(body.guests).toEqual([expect.objectContaining({ start: '12:20', guest: { name: 'New Caller', phone: '90000 11111' } })]);
  });

  it('a booking nobody came to is "did not come" and goes on the overdue call list; a cancelled one does not hold her back', async () => {
    await setWeek();
    const p = await register('Missed Mother');
    await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id });
    vi.setSystemTime(new Date('2026-09-30T06:00:00Z'));
    sessions = {}; // two days later: log in again
    const res = await (await as('reception')).get(`/api/appointments/patient/${p.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.past.map((a) => a.status)).toEqual(['no_show']);
    const today = (await (await as('reception')).get('/api/today')).body;
    expect(today.overdue.map((r) => [r.patient.fullName, r.bookedFor])).toEqual([['Missed Mother', '2026-09-29']]);
  });
});

describe('the patient card', () => {
  it('reception, doctors, RMOs and nurses record a printout (ids only); lab staff cannot', async () => {
    const p = await register('Card Mother');
    expect((await (await as('lab')).post(`/api/appointments/patient/${p.id}/card-printed`)).status).toBe(403);
    expect((await (await as('admin')).post(`/api/appointments/patient/${p.id}/card-printed`)).status).toBe(403);
    for (const who of ['reception', 'drA', 'rmo', 'nurse']) expect((await (await as(who)).post(`/api/appointments/patient/${p.id}/card-printed`)).status).toBe(200);
    const entry = await AuditLog.findOne({ action: 'PATIENT_CARD_PRINTED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn });
  });
});

describe('messages to the patient', () => {
  const switchOn = async () => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: false });
  const consent = async (p) => (await as('reception')).put(`/api/patients/${p.id}/reminder-consent`).send({ consent: true, channel: 'sms', language: 'en' });

  it('booking, moving and cancelling each queue one message – only when switched on and she agreed', async () => {
    await setWeek();
    const p = await register('Message Mother');
    const quiet = await register('Quiet Mother', { phone: '+91 91234 56789' });
    await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id });
    expect(await ReminderMessage.countDocuments({ tenantId: hospital._id })).toBe(0); // switched off
    await switchOn();
    await consent(p);
    const appt = (await book('reception', { doctorId: id('drA'), date: '2026-09-30', start: '17:30', patientId: p.id })).body.appointment;
    await book('reception', { doctorId: id('drA'), date: '2026-09-30', start: '17:40', patientId: quiet.id }); // no agreement
    await book('reception', { doctorId: id('drA'), date: '2026-09-30', start: '17:50', guest: { name: 'Caller', phone: '98765 43210' } }); // not registered
    await (await as('reception')).post(`/api/appointments/${appt.id}/move`).send({ date: '2026-10-01', start: '10:20' });
    await (await as('reception')).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'patient_asked' });
    const messages = await ReminderMessage.find({ tenantId: hospital._id }).sort({ createdAt: 1, _id: 1 }).lean();
    // A change that has not gone out yet is replaced by the newer one: only the cancellation will be sent
    expect(messages.map((m) => [m.kind, m.status])).toEqual([
      ['booked', 'cancelled'],
      ['moved', 'cancelled'],
      ['cancelled', 'queued'],
    ]);
    expect(messages[0].text).toBe('Appointment Hospital: your appointment is booked for 30 Sep 2026 at 5:30 PM with Sample drA. Reply STOP to stop these messages.');
    expect(messages[1].text).toMatch(/has moved to 1 Oct 2026 at 10:20 AM with Sample drA/);
    expect(messages[2].text).toMatch(/your appointment on 1 Oct 2026 at 10:20 AM is cancelled/);
    expect(messages.every((m) => !m.text.includes('Message Mother'))).toBe(true); // never her name
  });

  it('the day-before reminder gives the time and the doctor', async () => {
    await setWeek();
    const p = await register('Tomorrow Mother');
    await switchOn();
    await consent(p);
    setTestSender(TEST_SENDER);
    await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:40', patientId: p.id });
    await runReminders(NOW);
    expect(testSent().map((m) => m.text)).toEqual([
      'Appointment Hospital: your appointment is booked for 29 Sep 2026 at 10:40 AM with Sample drA. Reply STOP to stop these messages.',
      'Appointment Hospital: your appointment is on 29 Sep 2026 at 10:40 AM with Sample drA. Reply STOP to stop these messages.',
    ]);
  });
});

describe('length of a visit by type', () => {
  const LENGTHS = { new: 30, follow_up: 10, scan: 20, other: 10 };
  const setLengths = (doctor = 'drA') => timings(doctor, doctor, { week: WEEKDAYS, leave: [], lengths: LENGTHS });

  it('the doctor chooses the length of each type; only the lengths offered are accepted', async () => {
    const res = await setLengths();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.timings.lengths).toEqual(LENGTHS);
    expect((await timings('drA', 'drA', { week: WEEKDAYS, leave: [], lengths: { ...LENGTHS, new: 25 } })).status).toBe(400);
    // Saving the week without lengths keeps them
    expect((await setWeek('drA')).body.timings.lengths).toEqual(LENGTHS);
    // A doctor who chose nothing: one slot each
    expect((await setWeek('drB')).body.timings.lengths).toEqual({ new: 10, follow_up: 10, scan: 10, other: 10 });
  });

  it('a longer visit takes the slots that follow; they are not free for others', async () => {
    await setLengths();
    const p = await register('Long Mother');
    const q = await register('Next Mother');
    const first = await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id, visitType: 'new' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.appointment.minutes).toBe(30);
    const d = (await day('reception', 'drA', '2026-09-29')).body;
    expect(d.lengths).toEqual(LENGTHS);
    expect(d.slots.slice(0, 4).map((s) => [s.start, s.appointments.length, s.busyWith?.start ?? null])).toEqual([
      ['10:00', 1, null],
      ['10:10', 0, '10:00'],
      ['10:20', 0, '10:00'],
      ['10:30', 0, null],
    ]);
    // A follow-up at 10:20 runs into her visit: warned, then booked after "Book anyway"
    const clash = await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:20', patientId: q.id, visitType: 'follow_up' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    // A scan (20 minutes) at 9:50 is outside; at 12:50 it does not fit before the session ends
    const late = await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '12:50', patientId: q.id, visitType: 'scan' });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('TOO_LONG');
    // A scan at 9:50... the slot before a long visit: 10:30 is free
    const ok = await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:30', patientId: q.id, visitType: 'scan' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.appointment.minutes).toBe(20);
  });

  it('a next visit takes the first time that is free for its whole length; moving keeps the length of its type', async () => {
    await timings('drA', 'drA', { week: WEEKDAYS, leave: [], lengths: { new: 30, follow_up: 20, scan: 10, other: 10 } });
    const p = await register('First Mother');
    const q = await register('Second Mother');
    // 10:10 is taken, so a 20-minute follow-up cannot start at 10:00: the first time free for 20 minutes is 10:20
    expect((await book('reception', { doctorId: id('drA'), date: '2026-10-05', start: '10:10', patientId: p.id, visitType: 'other' })).status).toBe(201);
    const saved = await visitWithNext(q, '2026-10-05');
    expect(saved.booking).toMatchObject({ date: '2026-10-05', start: '10:20' });
    const appt = await Appointment.findOne({ tenantId: hospital._id, patientId: q.id });
    expect(appt.minutes).toBe(20);
    const moved = await (await as('reception')).post(`/api/appointments/${appt._id}/move`).send({ date: '2026-10-06', start: '11:00', visitType: 'new' });
    expect(moved.body.appointment).toMatchObject({ start: '11:00', minutes: 30, visitType: 'new' });
  });
});

describe('the consultation fee taken when booking', () => {
  const setPrice = async (key, pricePaise) => {
    const item = (await (await as('admin')).get('/api/billing/prices')).body.items.find((i) => i.key === key);
    expect((await (await as('admin')).patch(`/api/billing/prices/${item.id}`).send({ pricePaise })).status).toBe(200);
  };
  const billsOf = async (p) => (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
  const fullBill = async (b) => (await (await as('reception')).get(`/api/billing/bills/${b.id}`)).body.bill;
  const takeFee = async (who, apptId, body = { mode: 'cash' }) => (await as(who)).post(`/api/appointments/${apptId}/fee`).send(body);

  it('reception takes it in advance: on her bill of that day, paid, with a receipt; her visit adds no second consultation', async () => {
    await setWeek();
    await setPrice('consult_follow', 40000);
    await setPrice('consult_new', 60000);
    const p = await register('Fee Mother');
    const appt = (await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id, visitType: 'follow_up' })).body.appointment;
    expect(appt.fee).toBeNull();
    const offer = await (await as('reception')).get(`/api/appointments/${appt.id}/fee`);
    expect(offer.body).toMatchObject({ name: 'Consultation – follow-up', amountPaise: 40000 });

    expect((await takeFee('drA', appt.id)).status).toBe(403); // doctors have no billing
    expect((await takeFee('reception', appt.id, { mode: 'insurance' })).status).toBe(400); // needs the scheme
    const taken = await takeFee('reception', appt.id, { mode: 'upi', reference: 'UPI-1' });
    expect(taken.status, JSON.stringify(taken.body)).toBe(201);
    expect(taken.body.appointment.fee).toMatchObject({ amountPaise: 40000 });
    expect(taken.body.receipt).toBe('R-000001');
    expect((await takeFee('reception', appt.id)).status).toBe(409); // only once

    const [b] = await billsOf(p);
    expect(b).toMatchObject({ date: '2026-09-29', status: 'paid' });
    const full = await fullBill(b);
    expect(full.lines.map((l) => [l.name, l.amountPaise, l.from])).toEqual([['Consultation – follow-up', 40000, 'appointment']]);
    expect(full.payments.map((x) => [x.receipt, x.mode, x.amountPaise])).toEqual([['R-000001', 'upi', 40000]]);

    // The day comes: her visit is started – no second consultation on the bill
    vi.setSystemTime(new Date('2026-09-29T05:00:00Z'));
    sessions = {};
    const v = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
    expect(v.status).toBe(201);
    const after = await fullBill((await billsOf(p))[0]);
    expect(after.lines.filter((l) => !l.removed)).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: 'PAYMENT_RECEIVED', 'details.appointmentId': appt.id })).toBe(1);
  });

  it('cancelling the appointment takes the charge off: the money shows as due back', async () => {
    await setWeek();
    await setPrice('consult_new', 60000);
    const p = await register('Refund Mother');
    const appt = (await book('reception', { doctorId: id('drA'), date: '2026-09-30', start: '11:00', patientId: p.id, visitType: 'new' })).body.appointment;
    expect((await takeFee('reception', appt.id)).status).toBe(201);
    expect((await (await as('reception')).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'patient_asked' })).status).toBe(200);
    const [b] = await billsOf(p);
    expect(b).toMatchObject({ status: 'refund_due', balance: -60000 });
    const full = await fullBill(b);
    expect(full.lines[0].removed).toMatchObject({ reason: 'Appointment cancelled' });
  });

  it('not for a quick booking, a scan, or before the price is set', async () => {
    await setWeek();
    const p = await register('No Price Mother');
    const noPrice = (await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:00', patientId: p.id, visitType: 'follow_up' })).body.appointment;
    expect((await takeFee('reception', noPrice.id)).body.error.code).toBe('PRICE_NOT_SET');
    await setPrice('consult_follow', 40000);
    const scan = (await book('reception', { doctorId: id('drA'), date: '2026-09-30', start: '10:00', patientId: p.id, visitType: 'scan' })).body.appointment;
    expect((await takeFee('reception', scan.id)).body.error.code).toBe('NOT_A_CONSULTATION');
    const quick = (await book('reception', { doctorId: id('drA'), date: '2026-09-29', start: '10:30', guest: { name: 'New Lady', phone: '98200 00000' }, visitType: 'new' })).body.appointment;
    expect((await takeFee('reception', quick.id)).body.error.code).toBe('NOT_REGISTERED');
  });
});

describe("a doctor's month (the slot calendar, 13 Oct 2026)", () => {
  const month = async (who, doctor, m) => (await as(who)).get(`/api/appointments/month?doctorId=${id(doctor)}&month=${m}`);

  it('each day: the sessions with free and taken slots, leave days, and counts – never a name', async () => {
    await setWeek('drA', [{ from: '2026-10-06', to: '2026-10-06', note: 'Conference' }]);
    const p = await register('Month Mother');
    const q = await register('Second Month Mother');
    expect((await book('reception', { doctorId: id('drA'), date: '2026-10-05', start: '10:00', patientId: p.id })).status).toBe(201);
    const second = await book('reception', { doctorId: id('drA'), date: '2026-10-05', start: '10:30', patientId: q.id });
    expect(second.status).toBe(201);
    expect((await (await as('reception')).post(`/api/appointments/${second.body.appointment.id}/cancel`).send({ reason: 'patient_asked' })).status).toBe(200);

    const res = await month('reception', 'drA', '2026-10');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ month: '2026-10', hasTimings: true, slotMinutes: 10 });
    expect(res.body.days).toHaveLength(31);
    const oct5 = res.body.days.find((d) => d.date === '2026-10-05'); // a Monday
    expect(oct5.sessions).toEqual([
      { from: '10:00', to: '13:00', slots: 18, taken: 1 },
      { from: '17:00', to: '20:00', slots: 18, taken: 0 },
    ]);
    expect(oct5.counts).toMatchObject({ booked: 1, cancelled: 1, seen: 0 });
    expect(res.body.days.find((d) => d.date === '2026-10-06')).toMatchObject({ leave: true, sessions: [] });
    expect(res.body.days.find((d) => d.date === '2026-10-04').sessions).toEqual([]); // Sunday: no OPD
    expect(JSON.stringify(res.body.days)).not.toContain('Month Mother');
  });

  it('for hospital staff only; a month must be YYYY-MM', async () => {
    await setWeek('drA');
    expect((await month('lab', 'drA', '2026-10')).status).toBe(403);
    expect((await month('reception', 'drA', '2026-13')).status).toBe(400);
    expect((await month('nurse', 'drA', '2026-10')).status).toBe(200);
  });
});

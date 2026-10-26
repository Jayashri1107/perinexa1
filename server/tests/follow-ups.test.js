// Reception's Follow-ups page (26 Oct 2026): GET /api/follow-ups – who is booked for the coming week, the call lists
// of the Today page, and babies whose vaccinations are overdue or due soon, in general words only. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const D = (s) => new Date(`${s}T00:00:00Z`);
const noon = (s) => new Date(`${s}T06:00:00Z`); // 11:30 in India
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(noon('2026-10-01'));
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Follow-up Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const on = (day) => {
  vi.setSystemTime(noon(day));
  sessions = {};
};
const followUps = async (who = 'reception') => (await as(who)).get('/api/follow-ups');
const names = (rows) => rows.map((r) => r.patient.fullName);
const plan = async (p) => (await (await as('rmo')).get(`/api/patients/${p.id}/care-plan`)).body.plan;

async function register(fullName, extra = {}) {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName, ageYears: 30, assignedDoctor: people.drA._id.toString(), ...extra }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function baby(fullName) {
  const p = await register(fullName, { careType: 'newborn', ageYears: undefined, phone: '98765 43210', newborn: { birthAt: '2026-10-01T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female' } });
  expect((await plan(p)).careType).toBe('newborn');
  return p;
}
async function visitWithNext(p, nextVisitOn, note = '') {
  const created = await (await as('nurse')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const res = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${created.body.visit.id}`).send({ details: { rev: 0, nextVisitOn, nextVisitNote: note } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
const book = (p, day, extra = {}) =>
  Appointment.create({ tenantId: hospital._id, patientId: p.id, doctorId: people.drA._id, on: D(day), kind: 'slot', start: '10:30', minutes: 10, source: 'booked', created: { by: people.reception._id, byName: 'Sample reception', at: new Date() }, ...extra });

describe('follow-ups', () => {
  it('is for reception only', async () => {
    expect((await followUps('drA')).status).toBe(403);
    expect((await followUps('rmo')).status).toBe(403);
    expect((await followUps('nurse')).status).toBe(403);
    const res = await followUps();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ today: '2026-10-01', days: 7, comingUp: [], dueNow: [], overdue: [], babiesDue: [], babiesSoon: [] });
  });

  it('coming up: the next 7 days, booked or written by the doctor, with New or Follow-up – never the reason', async () => {
    const followUp = await register('Follow Patient');
    const newOne = await register('New Patient');
    const later = await register('Later Patient');
    await visitWithNext(followUp, '2026-10-04', 'Review the pap smear report');
    await book(newOne, '2026-10-02', { visitType: 'new' });
    await book(later, '2026-10-12');

    on('2026-10-01');
    const body = (await followUps()).body;
    expect(names(body.comingUp)).toEqual(['New Patient', 'Follow Patient']);
    expect(body.comingUp[0]).toEqual({
      patient: { id: newOne.id, fullName: 'New Patient', mrn: newOne.mrn, phone: expect.any(String), doctorName: 'Sample drA', setting: 'opd' },
      date: '2026-10-02',
      start: '10:30',
      needsTime: false,
      doctorName: 'Sample drA',
      visitType: 'new',
      arrived: false,
      fromNextVisit: false,
    });
    // The doctor's next visit booked itself (no OPD timings: it still needs a time), as a follow-up
    expect(body.comingUp[1]).toMatchObject({ date: '2026-10-04', visitType: 'follow_up', needsTime: true });
    expect(JSON.stringify(body)).not.toMatch(/pap smear|visitId|note/i);
  });

  it('each patient says OPD, IPD or Day care: her latest stay, still going or ended in the last 90 days', async () => {
    const opd = await register('Opd Patient');
    const ipd = await register('Ipd Patient');
    const day = await register('Day Patient');
    const old = await register('Old Stay Patient');
    for (const p of [opd, ipd, day, old]) await book(p, '2026-10-03');
    const stay = (p, extra) => Admission.create({ tenantId: hospital._id, patientId: p.id, careType: 'gynaecology', admittedAt: new Date('2026-09-20T06:00:00Z'), admittedBy: people.reception._id, admittedByName: 'Sample reception', clientRequestId: randomUUID(), status: 'discharged', dischargedAt: new Date('2026-09-22T06:00:00Z'), ...extra });
    await stay(ipd, { admissionType: 'planned' });
    await stay(day, { admissionType: 'day_care', dischargedAt: new Date('2026-09-20T12:00:00Z') });
    await stay(old, { admittedAt: new Date('2026-05-01T06:00:00Z'), dischargedAt: new Date('2026-05-04T06:00:00Z') });
    const body = (await followUps()).body;
    expect(Object.fromEntries(body.comingUp.map((r) => [r.patient.fullName, r.patient.setting]))).toEqual({ 'Day Patient': 'day_care', 'Ipd Patient': 'ipd', 'Old Stay Patient': 'opd', 'Opd Patient': 'opd' });
  });

  it('babies due soon: the window opens within 7 days, nothing booked – in general words, never the vaccine', async () => {
    const b = await baby('Baby Soon');
    let body = (await followUps()).body;
    // Birth doses due from the day of birth until 7 Oct: due now, not overdue yet
    expect(body.babiesSoon).toEqual([{ patient: expect.objectContaining({ id: b.id, fullName: 'Baby Soon' }), dueFrom: '2026-10-01', draft: true }]);
    expect(body.babiesDue).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/BCG|OPV|Hepatitis|Pentavalent|vacc/i);

    // Overdue from 8 Oct: on the overdue list, not also "due soon"
    on('2026-10-09');
    body = (await followUps()).body;
    expect(names(body.babiesDue)).toEqual(['Baby Soon']);
    expect(body.babiesSoon).toEqual([]);

    // Birth doses given; the 6-week doses open on 12 Nov – listed from 5 Nov, not on 4 Nov
    const item = (await plan(b)).items.find((i) => i.key === 'nb_vacc_birth');
    expect((await (await as('rmo')).patch(`/api/patients/${b.id}/care-plan/items/${item.id}`).send({ rev: item.rev, action: 'done', on: '2026-10-02' })).status).toBe(200);
    on('2026-11-04');
    expect((await followUps()).body.babiesSoon).toEqual([]);
    on('2026-11-08');
    body = (await followUps()).body;
    expect(body.babiesSoon.map((r) => [r.patient.fullName, r.dueFrom])).toEqual([['Baby Soon', '2026-11-12']]);

    // Booked: no longer to call (and shown under coming up)
    await book(b, '2026-11-12');
    body = (await followUps()).body;
    expect(body.babiesSoon).toEqual([]);
    expect(names(body.comingUp)).toEqual(['Baby Soon']);
  });
});

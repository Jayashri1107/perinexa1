// "Vaccinations overdue" (4 Oct 2026): the daily list of babies whose vaccinations are overdue – with the vaccines
// by name for doctors, RMOs and nurses (the worklist), in general words for reception (the Today page's call list).
// A baby is listed while a vaccination became overdue in the last six weeks; a list cut short keeps the newest.
// Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { babyVaccinations, overduePlanItems } from '../src/careplans/overdue.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const D = (s) => new Date(`${s}T00:00:00Z`);
const noon = (s) => new Date(`${s}T06:00:00Z`); // 11:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
const BIRTH_DOSES = 'Birth doses: BCG, OPV-0, Hepatitis B (birth dose)';
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
  hospital = await createTenant('Vaccination Hospital');
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
const plan = async (p, who = 'rmo') => (await (await as(who)).get(`/api/patients/${p.id}/care-plan`)).body.plan;
// A baby born on 1 Oct 2026 (the birth doses are due until 7 Oct); the plan starts when the record is first opened.
async function baby(fullName, { doctor = 'drA', phone = '98765 43210', assigned = true, birthAt = '2026-10-01T03:00:00.000Z', mother = undefined } = {}) {
  const res = await (await as(doctor)).post('/api/patients').send(
    samplePatient({ careType: 'newborn', fullName, ageYears: undefined, phone, ...(assigned ? { assignedDoctor: people[doctor]._id.toString() } : {}), newborn: { birthAt, birthWeightGrams: 3000, sex: 'female', ...(mother ? { mother } : {}) } }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect((await plan(res.body.patient)).careType).toBe('newborn');
  return res.body.patient;
}
const worklist = async (who, query = '') => (await as(who)).get(`/api/worklist${query}`);
const today = async (who) => (await as(who)).get('/api/today');
const names = (rows) => rows.map((r) => r.patient.fullName).sort();
const book = (p, day) =>
  Appointment.create({ tenantId: hospital._id, patientId: p.id, doctorId: people.drA._id, on: D(day), kind: 'slot', start: '10:30', minutes: 10, source: 'booked', created: { by: people.reception._id, byName: 'Sample reception', at: new Date() } });

describe('vaccinations overdue – doctors, RMOs and nurses (the worklist)', () => {
  it('lists the babies with the vaccines by name, the phone on the baby’s record and the day booked', async () => {
    const mine = await baby('Baby Mine');
    const free = await baby('Baby Unassigned', { assigned: false, phone: '90000 00002' });
    const theirs = await baby('Baby Theirs', { doctor: 'drB', phone: '90000 00003' });
    expect((await worklist('drA')).body.vaccinationsOverdue).toEqual([]); // still due on the day of birth

    on('2026-10-09');
    await book(theirs, '2026-10-12');
    const res = await worklist('drA');
    expect(res.status).toBe(200);
    expect(names(res.body.vaccinationsOverdue)).toEqual(['Baby Mine', 'Baby Unassigned']); // "My patients": own and unassigned
    const row = res.body.vaccinationsOverdue.find((r) => r.patient.id === mine.id);
    expect(row).toEqual({
      patient: { id: mine.id, fullName: 'Baby Mine', mrn: mine.mrn, careType: 'newborn', gestationalAge: null, risk: null, assignedDoctorName: 'Sample drA' },
      phone: '98765 43210',
      items: [{ itemId: expect.any(String), name: BIRTH_DOSES, dueBy: '2026-10-07T00:00:00.000Z' }],
      draft: true, // the newborn schedule is the built-in draft: no doctor has approved it yet
      bookedFor: null,
    });
    const all = (await worklist('drA', '?scope=all')).body.vaccinationsOverdue;
    expect(names(all)).toEqual(['Baby Mine', 'Baby Theirs', 'Baby Unassigned']);
    expect(all.find((r) => r.patient.id === theirs.id)).toMatchObject({ bookedFor: '2026-10-12', patient: { assignedDoctorName: 'Sample drB' } });
    expect(names((await worklist('nurse')).body.vaccinationsOverdue)).toEqual(['Baby Mine', 'Baby Theirs', 'Baby Unassigned']);
    expect(names((await worklist('rmo')).body.vaccinationsOverdue)).toHaveLength(3);
    expect(free.id).toBeTruthy();

    // Reception and lab staff have no worklist
    expect((await worklist('reception')).status).toBe(403);
    expect((await worklist('lab')).status).toBe(403);

    // Once a doctor approves the newborn schedule, the rows are no longer marked as a draft
    const t = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard', careType: 'newborn' }).lean();
    expect((await (await as('drA')).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version })).status).toBe(200);
    expect((await worklist('rmo')).body.vaccinationsOverdue.map((r) => r.draft)).toEqual([false, false, false]);

    // The audit log gets a count only; the platform's readers see the count too, never a patient
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'WORKLIST_VIEWED', 'details.scope': 'mine', 'details.vaccinations': 2 }).lean();
    expect(entry).toBeTruthy();
    expect(entry.details).toEqual({ scope: 'mine', redFlags: 0, carePlan: 0, seenToday: 0, vaccinations: 2 });
    expect(safeAuditDetails('WORKLIST_VIEWED', entry.details, { scope: 'platform' })).toEqual(entry.details);
  });

  it('only vaccinations that are really overdue: not one given, not one a doctor set aside, not a closed plan', async () => {
    const given = await baby('Baby Given', { phone: '90000 00001' });
    const notNeeded = await baby('Baby Elsewhere', { phone: '90000 00002' });
    const closed = await baby('Baby Closed', { phone: '90000 00003' });
    const late = await baby('Baby Late', { phone: '90000 00004' });
    on('2026-10-09');
    expect(names((await worklist('rmo')).body.vaccinationsOverdue)).toEqual(['Baby Closed', 'Baby Elsewhere', 'Baby Given', 'Baby Late']);
    const act = async (p, body) => {
      const item = (await plan(p)).items.find((i) => i.key === 'nb_vacc_birth');
      expect((await (await as('rmo')).patch(`/api/patients/${p.id}/care-plan/items/${item.id}`).send({ rev: item.rev, ...body })).status).toBe(200);
    };
    await act(given, { action: 'done', on: '2026-10-02' });
    await act(notNeeded, { action: 'not_needed', reasonCode: 'covered', reason: '' });
    expect((await (await as('rmo')).post(`/api/patients/${closed.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    const rows = (await worklist('rmo')).body.vaccinationsOverdue;
    expect(names(rows)).toEqual(['Baby Late']);
    // The other overdue items of a baby (the newborn examination, the heel-prick test) are not on this list
    expect(rows[0].items.map((i) => i.name)).toEqual([BIRTH_DOSES]);
    expect(late.id).toBe(rows[0].patient.id);

    // Later the 6-week vaccines are overdue as well: both are listed for her, the oldest first
    on('2026-11-26');
    const later = (await worklist('rmo')).body.vaccinationsOverdue;
    expect(later.map((r) => [r.patient.fullName, r.items.length])).toEqual([['Baby Elsewhere', 1], ['Baby Given', 1], ['Baby Late', 2]]);
    expect(later[2].items.map((i) => i.dueBy)).toEqual(['2026-10-07T00:00:00.000Z', '2026-11-25T00:00:00.000Z']);
  });

  it('a baby is listed while a vaccination became overdue in the last six weeks – not for ever', async () => {
    const late = await baby('Baby Late');
    on('2026-11-18'); // the birth doses became overdue on 8 Oct: exactly six weeks ago
    expect(names((await worklist('rmo')).body.vaccinationsOverdue)).toEqual(['Baby Late']);
    expect((await today('reception')).body.babiesDue.map((r) => r.patient.fullName)).toEqual(['Baby Late']);
    on('2026-11-20'); // longer than six weeks ago, and the 6-week vaccines are still due (until 25 Nov): off the daily lists
    expect((await worklist('rmo')).body.vaccinationsOverdue).toEqual([]);
    expect((await today('reception')).body.babiesDue).toEqual([]);
    // … but still overdue on the baby's own care plan
    expect((await plan(late)).items.find((i) => i.key === 'nb_vacc_birth').status).toBe('overdue');
    on('2026-11-26'); // the 6-week vaccines are overdue now: listed again, with the older one too
    const rows = (await worklist('rmo')).body.vaccinationsOverdue;
    expect(rows.map((r) => [r.patient.fullName, r.items.length])).toEqual([['Baby Late', 2]]);
    expect((await today('reception')).body.babiesDue.map((r) => [r.patient.fullName, r.dueFrom])).toEqual([['Baby Late', '2026-10-01']]);
  });

  it('a list that is cut short keeps the babies whose vaccination became overdue most recently', async () => {
    const oldest = await baby('Baby Oldest', { phone: '90000 00001', birthAt: '2026-09-27T03:00:00.000Z' });
    const newest = await baby('Baby Newest', { phone: '90000 00002', birthAt: '2026-10-01T03:00:00.000Z' });
    const middle = await baby('Baby Middle', { phone: '90000 00003', birthAt: '2026-09-29T03:00:00.000Z' });
    const at = noon('2026-10-20');
    const all = await overduePlanItems(hospital._id, { now: at, kindsFor: babyVaccinations, careTypes: ['newborn'], limit: 5 });
    expect(all.cut).toBe(false);
    expect(all.rows.map((r) => r.patient.fullName)).toEqual(['Baby Newest', 'Baby Middle', 'Baby Oldest']);
    const two = await overduePlanItems(hospital._id, { now: at, kindsFor: babyVaccinations, careTypes: ['newborn'], limit: 2 });
    expect(two.cut).toBe(true);
    expect(two.rows.map((r) => r.patient.fullName)).toEqual(['Baby Newest', 'Baby Middle']);
    expect([oldest.id, newest.id, middle.id]).toHaveLength(3);
  });

  it("another doctor's sensitive baby record is left out for doctors and nurses; RMOs see it", async () => {
    const hidden = await baby('Baby Private', { doctor: 'drB' });
    expect((await (await as('drB')).patch(`/api/patients/${hidden.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    on('2026-10-09');
    expect((await worklist('drA', '?scope=all')).body.vaccinationsOverdue).toEqual([]);
    expect((await worklist('nurse')).body.vaccinationsOverdue).toEqual([]);
    expect(names((await worklist('drB')).body.vaccinationsOverdue)).toEqual(['Baby Private']);
    expect(names((await worklist('rmo')).body.vaccinationsOverdue)).toEqual(['Baby Private']);
  });
});

describe('babies due – reception (the Today page)', () => {
  it('reception sees who to call and from which day – never the vaccine; doctors get the list above instead', async () => {
    const due = await baby('Baby Due');
    const booked = await baby('Baby Booked', { phone: '90000 00002' });
    const here = await baby('Baby Here', { phone: '90000 00003' });
    const hidden = await baby('Baby Private', { phone: '90000 00004' });
    expect((await (await as('drA')).patch(`/api/patients/${hidden.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await today('reception')).body.babiesDue).toEqual([]);

    on('2026-10-09');
    await book(booked, '2026-10-10');
    expect((await (await as('nurse')).post(`/api/patients/${here.id}/visits`).send({ clientRequestId: randomUUID() })).status).toBe(201);
    const res = await today('reception');
    expect(res.status).toBe(200);
    // draft: the newborn schedule is the built-in draft – no doctor has approved it yet, and reception is told so
    expect(res.body.babiesDue).toEqual([{ patient: { id: due.id, fullName: 'Baby Due', mrn: due.mrn, phone: '98765 43210', doctorName: 'Sample drA' }, dueFrom: '2026-10-01', draft: true }]);
    expect(JSON.stringify(res.body)).not.toMatch(/BCG|OPV|Hepatitis|vaccin|dose|dueBy|itemId/i);
    const t = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard', careType: 'newborn' }).lean();
    expect((await (await as('drA')).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version })).status).toBe(200);
    expect((await today('reception')).body.babiesDue.map((r) => [r.patient.fullName, r.draft])).toEqual([['Baby Due', false]]);
    // Doctors and RMOs: the clinical list is on the worklist; nurses and lab staff have no Today lists of reception
    expect((await today('drA')).body.babiesDue).toBeNull();
    expect((await today('rmo')).body.babiesDue).toBeNull();
    expect((await today('nurse')).status).toBe(403);
    expect((await today('lab')).status).toBe(403);
  });

  it('a baby still in hospital, or whose mother is, is not on the call list (the parents are in the ward)', async () => {
    const home = await baby('Baby Home');
    const nursery = await baby('Baby In Nursery', { phone: '90000 00002' });
    const mum = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Mother Sample', phone: '90000 00009', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const withMum = await baby('Baby With Mother', { phone: '90000 00003', mother: mum.id });
    on('2026-10-09');
    for (const p of [nursery, mum]) {
      expect((await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: new Date().toISOString(), reason: 'Sample reason' })).status).toBe(201);
    }
    expect((await today('reception')).body.babiesDue.map((r) => r.patient.fullName)).toEqual(['Baby Home']);
    // Doctors, RMOs and nurses still see all three (a birth dose not given in the nursery is theirs to act on)
    expect(names((await worklist('rmo')).body.vaccinationsOverdue)).toEqual(['Baby Home', 'Baby In Nursery', 'Baby With Mother']);
    expect([home.id, withMum.id]).toHaveLength(2);
  });

  it("another hospital's staff see none of these babies", async () => {
    await baby('Baby Due');
    const other = await createTenant('Other Hospital');
    const outsiders = {};
    for (const role of ['rmo', 'receptionist']) {
      outsiders[role] = await createUser({ name: `Sample outside ${role}` });
      await addMember(outsiders[role], other, role);
    }
    await ensureStandardTemplates(other._id);
    on('2026-10-09');
    expect((await worklist('rmo')).body.vaccinationsOverdue).toHaveLength(1);
    expect((await (await loginAs(outsiders.rmo, { app })).get('/api/worklist')).body.vaccinationsOverdue).toEqual([]);
    expect((await (await loginAs(outsiders.receptionist, { app })).get('/api/today')).body.babiesDue).toEqual([]);
  });
});

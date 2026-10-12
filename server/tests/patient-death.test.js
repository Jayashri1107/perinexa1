// Recording a death on a record (5 Oct 2026): a doctor of the record only, after a confirmation, with an audit entry
// (ids and counts only). The record is then CLOSED: it takes nothing new, gets no message of any kind, and is left out
// of the worklists, Today, the calendar and the overdue lists – but stays in the Patients list and every search.
// Reception sees only that it is closed. A doctor can undo a death recorded in error, with a reason. Fake data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { Arrival } from '../src/models/Arrival.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { NursingEntry } from '../src/models/NursingEntry.js';
import { Patient } from '../src/models/Patient.js';
import { PortalAccess } from '../src/models/PortalAccess.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { WorkDone } from '../src/models/WorkDone.js';
import * as website from '../../client/src/pages/patients/deathFormat.js';
import { DEATH_PLACES, DEATH_TIMINGS, ageInDays, isClosed } from '../src/patients/deathRules.js';
import { queueMissedAppointments } from '../src/reminders/generalReminders.js';
import { queueAppointmentReminders, sendDueReminders } from '../src/reminders/reminderService.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-09T06:00:00Z'); // Friday 9 Oct 2026, 11:30 in the hospital (India)
const TODAY = '2026-10-09';
const ROLES = { drA: 'doctor', drB: 'doctor', drRmo: ['doctor', 'rmo'], rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharmacist: 'pharmacist', admin: 'admin' };
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }] }));
const UNDO_REASON = 'Recorded on the wrong record by mistake';

let app;
let hospital;
let other;
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
  hospital = await createTenant('Closing Hospital');
  other = await createTenant('Other Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: 'Sample other doctor' });
  await addMember(people.otherDr, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const id = (who) => people[who]._id.toString();
const one = (Model, docId) => Model.findOne({ _id: docId, tenantId: hospital._id });
async function registered(who, overrides = {}) {
  const res = await (await as(who)).post('/api/patients').send(samplePatient(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const antenatal = (overrides = {}) => ({
  careType: 'antenatal',
  fullName: 'Asha Sample',
  ageYears: 28,
  phone: '+91 98765 43210',
  assignedDoctor: id('drA'),
  pregnancy: { scanEdd: '2026-11-20' },
  obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
  medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
  ...overrides,
});
const newborn = ({ mother = null, birthAt = '2026-10-01T03:00:00.000Z', ...overrides } = {}) => ({
  careType: 'newborn',
  fullName: 'Baby Sample',
  ageYears: undefined,
  phone: '+91 98765 43210',
  assignedDoctor: id('drA'),
  newborn: { birthAt, birthWeightGrams: 3000, sex: 'female', ...(mother ? { mother } : {}) },
  ...overrides,
});
const record = async (who, p, body) => (await as(who)).put(`/api/patients/${p.id}/death`).send(body);
const closeNow = async (p, body = { on: TODAY, timing: 'pregnancy' }) => {
  const res = await record('drA', p, { confirmed: true, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const undo = async (who, p, reason = UNDO_REASON) => (await as(who)).post(`/api/patients/${p.id}/death/undo`).send({ reason });
const view = async (who, p) => (await as(who)).get(`/api/patients/${p.id}`);
const list = async (who, query = '') => (await as(who)).get(`/api/patients?doctor=all${query}`);
const startVisit = async (p, who = 'drA', visitOn = undefined) => {
  const res = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.visit;
};
const setWeek = async () => expect((await (await as('drA')).put(`/api/appointments/timings/${id('drA')}`).send({ week: WEEKDAYS, leave: [] })).status).toBe(200);
const book = async (p, date, start = '10:30', who = 'reception') => (await as(who)).post('/api/appointments').send({ doctorId: id('drA'), date, start, patientId: p.id });
const switchOn = async (settings = {}) =>
  expect((await (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: true, portalBooking: false, ...settings })).status).toBe(200);
const agree = async (p) => expect((await (await as('reception')).put(`/api/patients/${p.id}/reminder-consent`).send({ consent: true, channel: 'sms', language: 'en' })).status).toBe(200);
const message = (p, extra = {}) =>
  ReminderMessage.create({ tenantId: hospital._id, patientId: p.id, kind: 'care_due', dueOn: '2026-10-12', sendOn: TODAY, channel: 'sms', language: 'en', to: '+919876543210', text: 'A check-up or test is due.', ...extra });

describe('the rules', () => {
  it("a baby's age at death in completed days, from the day of birth (day 0 = the day of birth)", () => {
    expect(ageInDays(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))).toBe(0);
    expect(ageInDays(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-29T00:00:00Z'))).toBe(28);
    expect(ageInDays(new Date('2026-10-05T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))).toBeNull();
    expect(ageInDays(null, new Date('2026-10-01T00:00:00Z'))).toBeNull();
    expect(isClosed({ death: { on: new Date() } })).toBe(true);
    expect(isClosed({ death: null })).toBe(false);
    expect(isClosed({})).toBe(false); // every record from before this field
  });

  it('the website asks with the same choices and words', () => {
    expect([website.DEATH_PLACES, website.DEATH_TIMINGS]).toEqual([DEATH_PLACES, DEATH_TIMINGS]);
    expect(website.ageAtDeathDays('2026-10-01T06:00:00.000Z', '2026-10-29')).toBe(ageInDays(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-29T00:00:00Z')));
  });
});

describe('recording a death', () => {
  it('only a doctor of the record, after a confirmation; everyone else is refused; another hospital gets "not found"', async () => {
    const p = await registered('drA', antenatal());
    const body = { on: TODAY, timing: 'delivery', confirmed: true };
    for (const who of ['rmo', 'nurse', 'reception', 'lab', 'pharmacist', 'admin']) expect((await record(who, p, body)).status, who).toBe(403);
    expect((await record('rmo', p, body)).body.error.message).toBe('Only a doctor can record a death, or undo one recorded in error.');
    const theirs = await record('drB', p, body);
    expect([theirs.status, theirs.body.error.message]).toEqual([403, "This is another doctor's patient: ask that doctor to record the death, or to undo it. (Reception or an RMO can change the doctor of the record.)"]);
    // a doctor who is also an RMO gets no wider right from the RMO role
    expect((await record('drRmo', p, body)).status).toBe(403);
    expect((await record('otherDr', p, body)).status).toBe(404);
    const unconfirmed = await record('drA', p, { on: TODAY, timing: 'delivery' });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error.fields).toHaveProperty('confirmed');
    expect(await Patient.countDocuments({ tenantId: hospital._id, 'death.on': { $ne: null } })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_RECORD_CLOSED' })).toBe(0);

    const res = await record('drA', p, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      closed: true,
      death: { on: '2026-10-09T00:00:00.000Z', place: null, timing: 'delivery', ageDays: null, byName: 'Sample drA', at: NOW.toISOString() },
      appointmentsCancelled: 0,
      messagesCancelled: 0,
      portalEnded: 0,
      inHospital: false,
      babies: [],
    });
    expect(String((await one(Patient, p.id)).death.by)).toBe(id('drA'));
    // The audit entry: ids and counts only – never the date, the timing or why the record was closed
    const entries = await AuditLog.find({ tenantId: hospital._id, action: 'PATIENT_RECORD_CLOSED' }).lean();
    expect(entries.map((e) => e.details)).toEqual([{ patientId: p.id, mrn: p.mrn, appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 }]);
    expect(safeAuditDetails('PATIENT_RECORD_CLOSED', entries[0].details, { scope: 'platform' })).toEqual({ appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 });
    // The hospital admin's log never says which record: closing has one reason only (a death), and Analytics keeps
    // even the count of deaths from hospital admins
    expect(safeAuditDetails('PATIENT_RECORD_CLOSED', { ...entries[0].details, on: TODAY, timing: 'delivery' })).toEqual({ appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 });
    const adminLog = (await (await as('admin')).get('/api/tenant/audit-logs?action=PATIENT_RECORD_CLOSED')).body.entries;
    expect(adminLog.map((e) => e.details)).toEqual([{ appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 }]);
    expect(JSON.stringify(adminLog)).not.toContain(p.mrn);
    expect(JSON.stringify(adminLog)).not.toContain(p.id);

    // Pressed again with the same details (the first answer was lost): nothing is recorded twice
    expect((await record('drA', p, body)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_RECORD_CLOSED' })).toBe(1);
    // Other details: refused – it is undone first
    const changed = await record('drA', p, { ...body, timing: 'postpartum' });
    expect([changed.status, changed.body.error.code, changed.body.error.message]).toEqual([409, 'RECORD_CLOSED', 'A death is already recorded on this record. If it was recorded in error, undo it first.']);
  });

  it('any doctor may record it for a patient with no doctor assigned', async () => {
    const p = await registered('reception', antenatal({ assignedDoctor: null, pregnancy: undefined, obstetric: undefined, medical: undefined }));
    expect((await record('drB', p, { on: TODAY, timing: 'other', confirmed: true })).status).toBe(200);
  });

  it('checks the details: not in the future, not before a visit or an admission on the record; when it was is chosen; there is no cause-of-death field', async () => {
    const p = await registered('drA', antenatal());
    const error = async (body) => (await record('drA', p, { confirmed: true, ...body })).body.error;
    expect((await error({ on: '2026-10-10', timing: 'pregnancy' })).fields).toEqual({ on: 'The date cannot be in the future.' });
    expect((await error({ on: TODAY })).fields).toHaveProperty('timing');
    expect((await error({ on: TODAY, timing: 'sometime' })).fields).toHaveProperty('timing');
    expect((await record('drA', p, { on: TODAY, timing: 'pregnancy', cause: 'Sample', confirmed: true })).status).toBe(400);
    expect((await record('drA', p, { on: TODAY, place: 'here', confirmed: true })).status).toBe(400); // the place is for a baby's record
    await startVisit(p, 'drA', '2026-10-07');
    expect((await error({ on: '2026-10-06', timing: 'pregnancy' })).fields.on).toBe(
      'A visit is recorded on 7 Oct 2026, after this date. Check the date – or, if that visit is on the wrong record, mark it as entered in error first.',
    );
    expect((await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-08T04:00:00.000Z', reason: 'Observation' })).status).toBe(201);
    expect((await error({ on: '2026-10-07', timing: 'pregnancy' })).fields.on).toBe('She was admitted on 8 Oct 2026, after this date. Please check the date.');
    expect((await one(Patient, p.id)).death).toBeNull();
    expect((await record('drA', p, { on: '2026-10-08', timing: 'delivery', confirmed: true })).status).toBe(200);
  });

  it("a baby's record: where the baby died, and the age in completed days worked out from the day of birth", async () => {
    const mother = await registered('drA', antenatal());
    const baby = await registered('drA', newborn({ mother: mother.id, birthAt: '2026-10-05T20:00:00.000Z' })); // 6 Oct, 01:30 in India
    const error = async (body) => (await record('drA', baby, { confirmed: true, ...body })).body.error;
    expect((await error({ on: '2026-10-05', place: 'here' })).fields.on).toBe('The date cannot be before the day of birth (6 Oct 2026).');
    expect((await error({ on: '2026-10-08' })).fields).toHaveProperty('place');
    expect((await record('drA', baby, { on: '2026-10-08', timing: 'delivery', confirmed: true })).status).toBe(400); // the timing is for every other record
    const res = await record('drA', baby, { on: '2026-10-08', place: 'here', confirmed: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.death).toMatchObject({ on: '2026-10-08T00:00:00.000Z', place: 'here', timing: null, ageDays: 2 });
    // On the mother's record the baby's record is marked closed – nothing about why (reception sees the babies too)
    for (const who of ['reception', 'drA']) {
      expect((await view(who, mother)).body.patient.babies, who).toEqual([{ id: baby.id, fullName: 'Baby Sample', mrn: baby.mrn, birthAt: '2026-10-05T20:00:00.000Z', closed: true }]);
    }
    // The mother's record is not touched
    expect((await view('drA', mother)).body.patient).not.toHaveProperty('closed');
  });

  it("a baby's age at death follows the time of birth: entered or corrected later, it is worked out again; a birth after the day of death is refused", async () => {
    const b = await registered('reception', newborn());
    // An older record with no time of birth (registration asks for it today)
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(b.id) }, { $set: { 'newborn.birthAt': null } });
    await closeNow(b, { on: '2026-10-08', place: 'here' });
    expect((await one(Patient, b.id)).death.ageDays).toBeNull(); // no time of birth yet: "age not known"
    const reception = await as('reception');
    const edit = (birthAt) => reception.patch(`/api/patients/${b.id}`).send({ newborn: { birthAt } });
    // Reception enters the time of birth afterwards: the age at death is worked out
    expect((await edit('2026-10-05T20:00:00.000Z')).status).toBe(200); // 6 Oct in India
    expect((await one(Patient, b.id)).death.ageDays).toBe(2);
    // Corrected by a month: a late newborn death becomes an early one, and the other way round
    expect((await edit('2026-09-05T20:00:00.000Z')).status).toBe(200);
    expect((await one(Patient, b.id)).death.ageDays).toBe(32);
    expect((await (await as('drA')).get(`/api/patients/${b.id}`)).body.patient.death.ageDays).toBe(32);
    // A birth after the recorded day of death: refused, without saying why the record is closed (reception reads it)
    const late = await edit('2026-10-08T20:00:00.000Z'); // 9 Oct in India
    expect([late.status, late.body.error.fields]).toEqual([400, { 'newborn.birthAt': "This date is after a date already recorded on this closed record. Check it with the baby's doctor." }]);
    expect(JSON.stringify(late.body)).not.toMatch(/death|died/i);
    expect((await one(Patient, b.id)).death.ageDays).toBe(32);
  });

  it('is refused for a day before vital signs or a medicine on her nursing chart (a note is fine): the death may be on the wrong record', async () => {
    const p = await registered('drA', antenatal());
    const stay = (await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-07T04:00:00.000Z', reason: 'In labour' })).body.admission;
    const chart = async (kind, at, extra) => {
      const res = await (await as('nurse')).post(`/api/patients/${p.id}/admissions/${stay.id}/nursing`).send({ clientRequestId: randomUUID(), kind, at, ...extra });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return NursingEntry.findOne({ tenantId: hospital._id, patientId: p.id, kind }).sort({ _id: -1 }).lean();
    };
    await chart('note', '2026-10-09T03:00:00.000Z', { note: 'Sample note' });
    expect((await record('drA', p, { on: '2026-10-08', timing: 'delivery', confirmed: true })).status).toBe(200); // a note after it is fine
    expect((await undo('drA', p)).status).toBe(200);
    const vitals = await chart('vitals', '2026-10-09T04:00:00.000Z', { vitals: { pulse: 88 } });
    const refused = await record('drA', p, { on: '2026-10-08', timing: 'delivery', confirmed: true });
    expect([refused.status, refused.body.error.fields.on]).toEqual([
      400,
      'Vital signs on 9 Oct 2026 are on the nursing chart of this record, after this date. Check the date and that this is the right record – or, if that entry is on the wrong record, mark it as entered in error first.',
    ]);
    // Once that entry is marked as entered in error, the day can be recorded
    expect((await (await as('nurse')).post(`/api/patients/${p.id}/admissions/${stay.id}/nursing/${vitals._id}/cancel`).send({ reason: 'Charted on the wrong patient' })).status).toBe(200);
    expect((await record('drA', p, { on: '2026-10-08', timing: 'delivery', confirmed: true })).status).toBe(200);
  });

  it("a mother's record: the answer names her babies' records that stay in use, and whether she is still in hospital", async () => {
    const mother = await registered('drA', antenatal());
    const baby = await registered('drA', newborn({ mother: mother.id }));
    expect((await (await as('drA')).post(`/api/patients/${mother.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-08T04:00:00.000Z', reason: 'In labour' })).status).toBe(201);
    const res = await closeNow(mother, { on: TODAY, timing: 'delivery' });
    expect(res).toMatchObject({ inHospital: true, babies: [{ id: baby.id, mrn: baby.mrn }] });
    // The stay is not ended by itself: the discharge card ends it
    expect((await Admission.findOne({ tenantId: hospital._id, patientId: mother.id })).status).toBe('admitted');
  });

  it('is never recorded on a record marked as a duplicate (it is recorded on the main record)', async () => {
    const main = await registered('drA', antenatal({ fullName: 'Asha Sample' }));
    const dup = await registered('drA', antenatal({ fullName: 'Asha S' }));
    expect((await (await as('drA')).put(`/api/patients/${dup.id}/duplicate-of`).send({ mainId: main.id, reason: 'Registered twice at the desk' })).status).toBe(200);
    const res = await record('drA', dup, { on: TODAY, timing: 'pregnancy', confirmed: true });
    expect([res.status, res.body.error.code, res.body.error.message]).toEqual([409, 'DUPLICATE_RECORD', `This record is marked as a duplicate of ${main.mrn}. Record the death on ${main.mrn}.`]);
    expect((await view('drA', dup)).body.patient.access.canRecordDeath).toBe(false);
  });
});

describe('who sees what', () => {
  it('reception and the pharmacist see only that the record is closed, lab staff not even that (name and number only); doctors, RMOs and nurses see the date', async () => {
    const p = await registered('drA', antenatal({ fullName: 'Closed Sample' }));
    expect((await view('drA', p)).body.patient.access).toMatchObject({ canRecordDeath: true, canUndoDeath: false });
    expect((await view('rmo', p)).body.patient.access).toMatchObject({ canRecordDeath: false, canUndoDeath: false });
    expect((await view('drB', p)).body.patient.access).toMatchObject({ canRecordDeath: false, canUndoDeath: false });
    await closeNow(p);
    const lab = (await view('lab', p)).body.patient;
    expect(Object.keys(lab).filter((k) => k !== 'access').sort()).toEqual(['careType', 'fullName', 'id', 'mrn', 'tenantId']);
    for (const who of ['reception', 'pharmacist']) {
      const seen = (await view(who, p)).body.patient;
      expect(seen.closed, who).toBe(true);
      expect(seen, who).not.toHaveProperty('death');
      expect(seen, who).not.toHaveProperty('deathHistory');
      expect(seen.access, who).toMatchObject({ canRecordDeath: false, canUndoDeath: false });
    }
    // The pharmacy's page says it is closed (a counter sale is refused) – never why
    const rx = (await (await as('pharmacist')).get(`/api/pharmacy/patients/${p.id}/prescriptions`)).body.patient;
    expect(rx.closed).toBe(true);
    expect(rx).not.toHaveProperty('death');
    for (const who of ['drA', 'drB', 'rmo', 'nurse']) {
      const seen = (await view(who, p)).body.patient;
      expect(seen.closed, who).toBe(true);
      expect(seen.death, who).toEqual({ on: '2026-10-09T00:00:00.000Z', place: null, timing: 'pregnancy', ageDays: null, byName: 'Sample drA', at: NOW.toISOString() });
    }
    expect((await view('drA', p)).body.patient.access).toMatchObject({ canRecordDeath: false, canUndoDeath: true });
    // No red flags are worked out for a closed record that is not in hospital
    expect((await view('drA', p)).body.patient).not.toHaveProperty('redFlags');
    expect((await list('drA', '&search=Closed')).body.patients[0].redFlags).toBeNull();
    // It stays in the Patients list and in every search, marked closed
    const listed = (await list('reception', '&search=Closed')).body.patients;
    expect(listed.map((x) => [x.id, x.closed, 'death' in x])).toEqual([[p.id, true, false]]);
    expect((await list('drA', '&search=Closed')).body.patients[0]).toMatchObject({ closed: true, death: { timing: 'pregnancy' } });
    expect((await list('drA')).body.patients.map((x) => x.id)).toContain(p.id);
  });

  it('the newborn record keeps its own access: a baby record closed shows the age at death to clinical staff only', async () => {
    const baby = await registered('drA', newborn());
    await closeNow(baby, { on: '2026-10-03', place: 'elsewhere' });
    expect((await view('nurse', baby)).body.patient.death).toMatchObject({ place: 'elsewhere', ageDays: 2 });
    expect((await view('reception', baby)).body.patient).toMatchObject({ closed: true });
    expect((await view('reception', baby)).body.patient).not.toHaveProperty('death');
  });
});

describe('a closed record', () => {
  it('takes nothing new: visits, a next visit, appointments, arrivals, lab orders, admissions, scans, a counter sale, portal codes, reminders – and the screens are told', async () => {
    await switchOn();
    await setWeek();
    await (await as('admin')).get('/api/billing/prices'); // the price list (with the scans and procedures)
    const p = await registered('drA', antenatal());
    await agree(p);
    const code = (await (await as('reception')).post(`/api/patients/${p.id}/portal-access`)).body.code;
    expect(code).toBeTruthy();
    expect((await book(p, '2026-10-12')).status).toBe(201);
    const booked = await Appointment.findOne({ tenantId: hospital._id, patientId: p.id });
    expect(await ReminderMessage.countDocuments({ tenantId: hospital._id, patientId: p.id, status: 'queued' })).toBe(1); // "your appointment is booked"
    const visit = await startVisit(p); // today's visit, still open
    const drA = await as('drA');
    const reception = await as('reception');
    const scan = (await drA.get(`/api/patients/${p.id}/work-done`)).body.items[0];
    expect(scan?.id).toBeTruthy();

    const closed = await closeNow(p);
    expect(closed).toMatchObject({ appointmentsCancelled: 1, messagesCancelled: 1, portalEnded: 1 });
    // Her appointment is cancelled with no message to the family; the waiting message is cancelled; the portal ends
    expect((await one(Appointment, booked._id)).toObject()).toMatchObject({ status: 'cancelled', cancelled: { reason: 'record_closed' } });
    expect(await ReminderMessage.countDocuments({ tenantId: hospital._id, patientId: p.id, kind: 'cancelled' })).toBe(0);
    expect((await ReminderMessage.findOne({ tenantId: hospital._id, patientId: p.id })).toObject()).toMatchObject({ status: 'cancelled', error: 'Record closed' });
    expect(await PortalAccess.countDocuments({ tenantId: hospital._id, patientId: p.id, revoked: null })).toBe(0);
    expect((await request.agent(app).post('/api/portal/login').send({ code, digits: '3210' })).status).toBe(401);
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'PATIENT_RECORD_CLOSED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, appointmentsCancelled: 1, messagesCancelled: 1, portalEnded: 1 });

    const countAll = async () => Promise.all([Visit, LabOrder, Admission, WorkDone, Arrival].map((M) => M.countDocuments({ tenantId: hospital._id })));
    const before = await countAll();
    const refused = {
      visit: [await drA.post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 'new visits'],
      lab: [await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }] }), 'new lab orders'],
      admission: [await drA.post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), reason: 'Observation' }), 'new admissions'],
      appointment: [await book(p, '2026-10-13'), 'new appointments'],
      arrival: [await reception.post('/api/arrivals').send({ patientId: p.id, doctorId: id('drA') }), 'new arrivals'],
      scan: [await drA.post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: scan.id }), 'new scans or procedures'],
      portal: [await reception.post(`/api/patients/${p.id}/portal-access`), 'patient portal access'],
      reminder: [await drA.get(`/api/patients/${p.id}/reminder`), 'reminders or messages'],
      consent: [await reception.put(`/api/patients/${p.id}/reminder-consent`).send({ consent: true, channel: 'whatsapp', language: 'en' }), 'reminders or messages'],
      sale: [
        await (await as('pharmacist')).post('/api/pharmacy/invoices').send({ kind: 'sale', patientId: p.id, lines: [{ medicineId: new mongoose.Types.ObjectId().toString(), qty: 1 }] }),
        'new pharmacy sales',
      ],
    };
    for (const [what, [res, words]] of Object.entries(refused)) {
      expect([res.status, res.body.error?.code, res.body.error?.message], what).toEqual([409, 'RECORD_CLOSED', `This record is closed, so it takes no ${words}.`]);
    }
    expect(await countAll()).toEqual(before);
    expect(await Appointment.countDocuments({ tenantId: hospital._id, status: 'booked' })).toBe(0);
    // Reminders can still be switched off
    expect((await reception.put(`/api/patients/${p.id}/reminder-consent`).send({ consent: false, channel: 'sms', language: 'en' })).status).toBe(200);

    // The visit already started can be finished – but no next visit is set on it
    const nextVisit = await drA.patch(`/api/patients/${p.id}/visits/${visit.id}`).send({ details: { rev: 0, diagnosis: 'Sample note', nextVisitOn: '2026-10-20' } });
    expect([nextVisit.status, nextVisit.body.error.fields]).toEqual([400, { 'details.nextVisitOn': 'This record is closed, so no next visit is set. Leave the next visit empty.' }]);
    const finished = await drA.patch(`/api/patients/${p.id}/visits/${visit.id}`).send({ details: { rev: 0, diagnosis: 'Sample note' } });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    expect(await Appointment.countDocuments({ tenantId: hospital._id })).toBe(1);

    // The screens are told not to offer them
    expect((await drA.get(`/api/patients/${p.id}/visits`)).body.canCreate).toBe(false);
    expect((await drA.get(`/api/patients/${p.id}/lab-orders`)).body.canOrder).toBe(false);
    expect((await drA.get(`/api/patients/${p.id}/admissions`)).body.canAdmit).toBe(false);
    expect((await drA.get(`/api/patients/${p.id}/work-done`)).body.canRecord).toBe(false);
    expect((await reception.get(`/api/appointments/patient/${p.id}`)).body.canBook).toBe(false);
    expect((await drA.get(`/api/patients/${p.id}/visits/${visit.id}/whatsapp`)).body).toMatchObject({ available: false, reason: 'record_closed' });
    // Nothing is taken away: the record and its visits can still be read
    for (const path of ['visits', 'lab-orders', 'admissions', 'work-done', 'care-plan', 'consents']) expect((await drA.get(`/api/patients/${p.id}/${path}`)).status, path).toBe(200);
  });

  it('is left out of the worklist, Today, the calendar and the vaccination lists – and back after an undo', async () => {
    // A baby born on 1 Oct and registered that day (the birth doses were due until 7 Oct): overdue today
    vi.setSystemTime(new Date('2026-10-01T06:00:00Z'));
    sessions = {};
    const baby = await registered('drA', newborn({ fullName: 'Baby Closed', phone: '+91 90000 00001' }));
    expect((await (await as('rmo')).get(`/api/patients/${baby.id}/care-plan`)).body.plan.careType).toBe('newborn'); // the plan starts when it is first opened
    vi.setSystemTime(NOW);
    sessions = {};
    const mother = await registered('drA', antenatal());
    await startVisit(mother);
    const drA = await as('drA');
    const edd = async () => (await drA.get('/api/calendar?view=week&date=2026-11-20&types=edd&scope=all')).body.events.map((e) => e.patientId);
    const seen = async () => (await drA.get('/api/worklist?scope=all')).body.seenToday.map((s) => s.patient.id);
    const vaccinations = async () => (await drA.get('/api/worklist?scope=all')).body.vaccinationsOverdue.map((r) => r.patient.id);
    const today = async () => (await (await as('reception')).get('/api/today?scope=all')).body;
    const shown = async () => {
      const t = await today();
      return [await edd(), await seen(), await vaccinations(), t.patients.map((x) => x.patient.id), t.babiesDue.map((r) => r.patient.id)];
    };
    expect(await shown()).toEqual([[mother.id], [mother.id], [baby.id], [mother.id], [baby.id]]);
    await closeNow(mother);
    await closeNow(baby, { on: TODAY, place: 'elsewhere' });
    expect(await shown()).toEqual([[], [], [], [], []]);
    // …but both are still in the Patients list
    expect((await list('reception')).body.patients.map((x) => x.id).sort()).toEqual([mother.id, baby.id].sort());
    expect((await undo('drA', mother)).status).toBe(200);
    expect((await undo('drA', baby)).status).toBe(200);
    expect(await shown()).toEqual([[mother.id], [mother.id], [baby.id], [mother.id], [baby.id]]);
  });

  it('gets no reminder of any kind: none is queued, a waiting one is cancelled, and none is recorded as sent by hand', async () => {
    await switchOn({ portalEnabled: false });
    const tenant = await Tenant.findById(hospital._id);
    const closed = await registered('drA', antenatal({ fullName: 'Closed Sample', phone: '+91 90000 00011' }));
    const open = await registered('drA', antenatal({ fullName: 'Open Sample', phone: '+91 90000 00012' }));
    const closedMissed = await registered('drA', antenatal({ fullName: 'Closed Missed', phone: '+91 90000 00013' }));
    const openMissed = await registered('drA', antenatal({ fullName: 'Open Missed', phone: '+91 90000 00014' }));
    for (const p of [closed, open]) {
      await agree(p);
      // A next-visit date for tomorrow from before appointment booking (the visit made no appointment)
      const v = await startVisit(p, 'drA', '2026-10-02');
      await Visit.updateOne({ _id: v.id, tenantId: hospital._id }, { $set: { 'details.nextVisitOn': new Date('2026-10-10T00:00:00Z') } });
    }
    for (const p of [closedMissed, openMissed]) {
      await agree(p);
      // A booked appointment yesterday that nobody came to ("we missed you")
      await Appointment.create({ tenantId: hospital._id, patientId: p.id, doctorId: people.drA._id, on: new Date('2026-10-08T00:00:00Z'), kind: 'slot', start: '10:30', minutes: 10, source: 'booked', created: { byName: 'Sample reception', at: NOW } });
    }
    const toSend = await message(closed, { status: 'to_send' });
    await closeNow(closed);
    await closeNow(closedMissed);
    expect((await one(ReminderMessage, toSend._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record closed' });

    expect(await queueAppointmentReminders(tenant, NOW)).toBe(1);
    expect(await queueMissedAppointments(tenant, NOW)).toBe(1);
    const queued = await ReminderMessage.find({ tenantId: hospital._id, status: 'queued' }).lean();
    expect([...new Set(queued.map((m) => String(m.patientId)))].sort()).toEqual([open.id, openMissed.id].sort());

    // A message for the closed record that got into the queue some other way is cancelled instead of sent
    const stray = await message(closed, { kind: 'appointment', ref: 'x', dueOn: '2026-10-10' });
    await sendDueReminders(tenant, NOW);
    expect((await one(ReminderMessage, stray._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record closed' });

    // Closed while the outbox was open: "Mark as sent" is refused and the message cancelled
    const late = await message(closed, { status: 'to_send', kind: 'appointment', ref: 'y', dueOn: '2026-10-10' });
    const res = await (await as('reception')).post(`/api/reminders/${late._id}/sent-by-hand`);
    expect([res.status, res.body.error.code]).toEqual([409, 'RECORD_CLOSED']);
    expect((await one(ReminderMessage, late._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record closed' });
  });

  it('stays on the In hospital list while the stay is open – marked closed, its red flags still worked out (a death recorded on the wrong record must not hide a living patient\'s flags) – and the discharge card can still be written', async () => {
    const p = await registered('drA', antenatal());
    const stay = (await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-08T04:00:00.000Z', reason: 'In labour' })).body.admission;
    // A very high blood pressure on her nursing chart this morning
    expect((await (await as('nurse')).post(`/api/patients/${p.id}/admissions/${stay.id}/nursing`).send({ clientRequestId: randomUUID(), kind: 'vitals', at: '2026-10-09T02:00:00.000Z', vitals: { bpSystolic: 170, bpDiastolic: 115 } })).status).toBe(201);
    const flagsNow = async () => (await (await as('drA')).get('/api/inpatients')).body.admitted.map((r) => [r.patient.id, Boolean(r.patient.closed), r.redFlags.length > 0, r.redFlagsChecked]);
    expect(await flagsNow()).toEqual([[p.id, false, true, true]]);
    await closeNow(p, { on: TODAY, timing: 'delivery' });
    expect(await flagsNow()).toEqual([[p.id, true, true, true]]);
    // …on her page and in the Patients list too, while the stay is open
    expect((await view('drA', p)).body.patient.redFlags.flags.length).toBeGreaterThan(0);
    expect((await list('drA')).body.patients.find((x) => x.id === p.id).redFlags.count).toBeGreaterThan(0);
    const card = await (await as('drA')).post(`/api/patients/${p.id}/admissions/${stay.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'discharge' });
    expect(card.status, JSON.stringify(card.body)).toBe(201);
  });
});

describe('undoing a death recorded in error', () => {
  it('a doctor of the record undoes it with a reason; the record is in use again; the cancelled appointments are listed to book again', async () => {
    await setWeek();
    const p = await registered('drA', antenatal());
    expect((await book(p, '2026-10-12', '11:00')).status).toBe(201);
    await closeNow(p);
    for (const who of ['rmo', 'nurse', 'reception', 'drB']) expect((await undo(who, p)).status, who).toBe(403);
    expect((await undo('otherDr', p)).status).toBe(404);
    expect((await undo('drA', p, 'oops')).body.error.fields.reason).toBe('Please write why this was recorded in error (at least 5 characters)');
    // The reason is free text about her: checked for words about the baby's sex
    expect((await undo('drA', p, 'She is carrying a boy, wrong record')).body.error.fields.reason).toMatch(/PCPNDT/);
    expect(isClosed(await one(Patient, p.id))).toBe(true);

    const res = await undo('drA', p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ undone: true, appointmentsToRebook: [{ date: '2026-10-12', start: '11:00', doctorName: 'Sample drA' }] });
    // Nothing comes back by itself: the appointment stays cancelled until reception books it again
    expect(await Appointment.countDocuments({ tenantId: hospital._id, status: 'booked' })).toBe(0);
    const seen = (await view('drA', p)).body.patient;
    expect(seen).not.toHaveProperty('closed');
    expect(seen).not.toHaveProperty('death');
    expect(seen.deathHistory).toEqual([
      { on: '2026-10-09T00:00:00.000Z', place: null, timing: 'pregnancy', byName: 'Sample drA', at: NOW.toISOString(), undoneReason: UNDO_REASON, undoneByName: 'Sample drA', undoneAt: NOW.toISOString() },
    ]);
    expect(seen.access).toMatchObject({ canRecordDeath: true, canUndoDeath: false });
    expect((await view('reception', p)).body.patient).not.toHaveProperty('deathHistory');
    // The audit entry has the ids only – never the reason
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'PATIENT_RECORD_REOPENED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn });
    expect(safeAuditDetails('PATIENT_RECORD_REOPENED', entry.details, { scope: 'platform' })).toEqual({});
    expect(safeAuditDetails('PATIENT_RECORD_REOPENED', entry.details)).toEqual({}); // the hospital admin's log too
    // In use again: she can be booked
    expect((await book(p, '2026-10-12', '11:00')).status).toBe(201);
    // Pressed again: nothing to undo
    expect((await undo('drA', p)).body).toEqual({ undone: false, appointmentsToRebook: [] });
  });
});

describe('undoing a second death recorded in error', () => {
  it('lists only the appointments cancelled by this closing – never one of an earlier closing that was undone and booked again', async () => {
    await setWeek();
    const p = await registered('drA', antenatal());
    expect((await book(p, '2026-10-12', '11:00')).status).toBe(201);
    await closeNow(p);
    expect((await undo('drA', p)).body.appointmentsToRebook).toEqual([{ date: '2026-10-12', start: '11:00', doctorName: 'Sample drA' }]);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    expect((await book(p, '2026-10-13', '10:30')).status).toBe(201); // reception books it again, on another day
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    await closeNow(p); // recorded in error a second time
    vi.setSystemTime(new Date(NOW.getTime() + 180_000));
    expect((await undo('drA', p)).body.appointmentsToRebook).toEqual([{ date: '2026-10-13', start: '10:30', doctorName: 'Sample drA' }]);
  });
});

describe('closed records and duplicates', () => {
  it('a closed record is not hidden behind one still in use; a duplicate of a closed main record has its appointments cancelled, not moved', async () => {
    await setWeek();
    const main = await registered('drA', antenatal({ fullName: 'Asha Sample' }));
    const dup = await registered('drA', antenatal({ fullName: 'Asha S' }));
    const mark = async (d, m) => (await as('drA')).put(`/api/patients/${d.id}/duplicate-of`).send({ mainId: m.id, reason: 'Registered twice at the desk' });
    await closeNow(dup);
    const refused = await mark(dup, main);
    expect([refused.status, refused.body.error.fields.mainId]).toEqual([400, `This record is closed and ${main.mrn} is not. Close ${main.mrn} in the same way first, or reopen this record – then mark it as a duplicate.`]);
    expect((await undo('drA', dup)).status).toBe(200);

    // The main record is closed; the duplicate (still in use) has an appointment ahead
    expect((await book(dup, '2026-10-12')).status).toBe(201);
    await closeNow(main);
    const res = await mark(dup, main);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.appointmentsMoved).toBe(0);
    const appt = await Appointment.findOne({ tenantId: hospital._id, status: { $in: ['booked', 'cancelled'] }, on: new Date('2026-10-12T00:00:00Z') });
    expect([String(appt.patientId), appt.status, appt.cancelled?.reason]).toEqual([dup.id, 'cancelled', 'record_closed']);
  });
});

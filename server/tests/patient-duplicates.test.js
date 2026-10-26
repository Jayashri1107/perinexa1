// "She may already be registered" at registration, and marking a record as a duplicate of another (4 Oct 2026):
// who may do what, another hospital is "not found", the audit entries (ids only), and the edge cases. Fake data only.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHospital, underMainRecord } from '../src/analytics/load.js';
import { createApp } from '../src/app.js';
import { hospitalToday } from '../src/careplans/dates.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { Arrival } from '../src/models/Arrival.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { ScanShare } from '../src/models/ScanShare.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { WorkDone } from '../src/models/WorkDone.js';
import { convertNextVisits } from '../src/appointments/appointmentService.js';
import { allergyStatus, detailsOnlyOn } from '../src/patients/duplicateCompare.js';
import { cannotBeDuplicate, lastFourDigits, matchedOn, nameKey, namePattern, phoneKey, phoneKeys, phonePattern } from '../src/patients/duplicateRules.js';
import { markDuplicate } from '../src/patients/duplicateService.js';
import { cancelStaleGeneral, queueCareDue, queueMissedAppointments } from '../src/reminders/generalReminders.js';
import { queueAppointmentReminders, sendDueReminders } from '../src/reminders/reminderService.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital (India)
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharmacist: 'pharmacist', admin: 'admin' };
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }] }));
const REASON = 'Registered twice at the desk by mistake';

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
  hospital = await createTenant('Duplicate Hospital');
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
// One stored document of this hospital (every query names the hospital)
const one = (Model, docId, tenant = hospital) => Model.findOne({ _id: docId, tenantId: tenant._id });
const id = (who) => people[who]._id.toString();
// A registration as the form first sends it: without "register anyway"
const register = async (who, overrides = {}) => (await as(who)).post('/api/patients').send(samplePatient({ registerAnyway: false, ...overrides }));
async function registered(who, overrides = {}) {
  const res = await register(who, { registerAnyway: true, ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const mark = async (who, dup, main, reason = REASON) => (await as(who)).put(`/api/patients/${dup.id}/duplicate-of`).send({ mainId: main.id, reason });
const undo = async (who, dup) => (await as(who)).delete(`/api/patients/${dup.id}/duplicate-of`);
const view = async (who, p) => (await as(who)).get(`/api/patients/${p.id}`);
const list = async (who, query = '') => (await as(who)).get(`/api/patients?doctor=all${query}`);
const idsOf = (res) => res.body.patients.map((p) => p.id);
const antenatal = (overrides = {}) => ({
  careType: 'antenatal',
  ageYears: 28,
  assignedDoctor: id('drA'),
  pregnancy: { scanEdd: '2027-03-01' },
  obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
  medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
  ...overrides,
});
/** Two records of one woman, both Dr A's: the main one (P-000001) and the one to mark (P-000002). */
async function pair(overrides = {}) {
  const main = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '+91 98765 43210', ...overrides }));
  const dup = await registered('drA', antenatal({ fullName: 'Asha S', phone: '98765 43210', ...overrides }));
  return { main, dup };
}
const YESTERDAY = '2026-09-27';
const startVisit = async (p, who = 'drA', visitOn = undefined) => {
  const res = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.visit;
};
/** Today's visit, written and signed by Dr A (a record whose visit of today is still open cannot be marked). */
async function signedVisit(p, details = { diagnosis: 'Routine check' }) {
  const visit = await startVisit(p);
  const drA = await as('drA');
  const saved = await drA.patch(`/api/patients/${p.id}/visits/${visit.id}`).send({ details: { rev: 0, ...details } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const v = saved.body.visit;
  const signed = await drA.post(`/api/patients/${p.id}/visits/${visit.id}/sign`).send({ revs: { vitals: v.vitals.rev, details: v.details.rev, prescription: v.prescription.rev } });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return visit;
}
const setWeek = async () => expect((await (await as('drA')).put(`/api/appointments/timings/${id('drA')}`).send({ week: WEEKDAYS, leave: [] })).status).toBe(200);
const book = async (p, date, start = '10:30', who = 'reception') => (await as(who)).post('/api/appointments').send({ doctorId: id('drA'), date, start, patientId: p.id });

describe('the words that are compared', () => {
  it('phone numbers: digits only, with or without +91 or a leading 0; a placeholder is no number', () => {
    for (const phone of ['+91 98765 43210', '098765-43210', '9876543210', '(91) 98765 43210', '0091 9876543210']) expect(phoneKey(phone), phone).toBe('9876543210');
    expect(phoneKey('020 2567 1234')).toBe('2025671234');
    // +91 with a 0 after it, and 0 in front of 91
    for (const phone of ['+91 098765 43210', '091 98765 43210', '+91-0-98765-43210']) expect(phoneKey(phone), phone).toBe('9876543210');
    // Two numbers typed into the one field: each counts
    expect(phoneKeys('98765 43210 91234 56789')).toEqual(['9876543210', '9123456789']);
    expect(phoneKeys('+919876543210 +919123456789')).toEqual(['9876543210', '9123456789']);
    expect(phoneKeys('919876543210 919123456789')).toEqual(['9876543210', '9123456789']);
    expect(phoneKeys('098765 43210 091234 56789')).toEqual(['9876543210', '9123456789']);
    expect(phoneKeys('98765 43210 98765 43210')).toEqual(['9876543210']); // the same number twice
    expect(phoneKeys('0000000000 0000000000')).toEqual([]);
    expect(phoneKeys('')).toEqual([]);
    for (const none of ['', null, '12345', '0000000000', '+91 00000 00000', '99999 99999']) expect(phoneKey(none), String(none)).toBe('');
    expect(lastFourDigits('+91 98765 43210')).toBe('3210');
    expect(lastFourDigits('123')).toBe('');
  });

  it('names: capitals, spaces and dots make no difference', () => {
    for (const name of ['Asha Sample', 'ASHA SAMPLE', ' asha  sample ', 'Asha.Sample', 'A.sha Sample', 'ashasample']) expect(nameKey(name), name).toBe('ashasample');
    expect(nameKey('Asha Sampel')).not.toBe('ashasample');
    expect(nameKey('A')).toBe('');
    // The database patterns only narrow the search; a record is compared again exactly
    expect(namePattern(nameKey('Asha (Sample)')).test('asha (sample)')).toBe(true);
    expect(namePattern('ashasample').test('Asha Sampleton')).toBe(false);
    expect(phonePattern('9876543210').test('+91 98765-43210')).toBe(true);
    expect(phonePattern('9876543210').test('98765 43210 91234 56789')).toBe(true); // the first of two numbers
    expect(matchedOn({ phone: '5559876543210', fullName: 'Asha Sampleton' }, { phones: ['9876543210'], name: 'ashasample' })).toEqual([]);
    expect(matchedOn({ phone: '098765 43210', fullName: 'ASHA  SAMPLE' }, { phones: ['9876543210'], name: 'ashasample' })).toEqual(['phone', 'name']);
    expect(matchedOn({ phone: '91234 56789 98765 43210', fullName: 'Someone' }, { phones: ['9876543210'], name: 'ashasample' })).toEqual(['phone']);
    expect(matchedOn({ phone: '98765 43210', fullName: 'Someone' }, { phones: [], name: '' })).toEqual([]);
    // A character that cannot be seen never reaches the database pattern
    expect(nameKey('Asha\u0000Sample')).toBe('ashasample');
    expect(namePattern(nameKey('Asha\u0000 Sample\t')).source).not.toMatch(/[\u0000-\u001f]/);
  });

  it('what cannot be joined: itself, a duplicate of a duplicate, a main record, a baby and an adult', () => {
    const rec = (n, careType = 'antenatal', duplicateOf = null) => ({ _id: `id${n}`, mrn: `P-00000${n}`, careType, duplicateOf });
    expect(cannotBeDuplicate(rec(2), rec(1))).toBeNull();
    expect(cannotBeDuplicate(rec(2, 'postnatal'), rec(1, 'gynaecology'))).toBeNull(); // any two adult types of care
    expect(cannotBeDuplicate(rec(2, 'newborn'), rec(1, 'newborn'))).toBeNull();
    expect(cannotBeDuplicate(rec(1), rec(1))).toMatch(/duplicate of itself/);
    expect(cannotBeDuplicate(rec(2, 'antenatal', { patient: 'id3', mrn: 'P-000003' }), rec(1))).toMatch(/already marked as a duplicate of P-000003/);
    expect(cannotBeDuplicate(rec(2), rec(1, 'antenatal', { patient: 'id3', mrn: 'P-000003' }))).toMatch(/P-000001 is itself marked as a duplicate of P-000003\. Choose P-000003/);
    expect(cannotBeDuplicate(rec(2), rec(1), [rec(4)])).toMatch(/main record of P-000004/);
    expect(cannotBeDuplicate(rec(2, 'newborn'), rec(1))).toMatch(/baby's record and an adult's record/);
    expect(cannotBeDuplicate(rec(2), rec(1, 'newborn'))).toMatch(/baby's record and an adult's record/);
  });
});

describe('"She may already be registered" at registration', () => {
  it('the same phone number in any way of writing it: nothing is saved, the matching record is shown', async () => {
    const first = await registered('reception', { fullName: 'Asha Sample', phone: '+91 98765 43210', ageYears: 28, assignedDoctor: id('drA') });
    for (const phone of ['9876543210', '098765-43210', '91 98765 43210']) {
      const res = await register('reception', { fullName: 'Someone Else', phone });
      expect(res.status, phone).toBe(409);
      expect(res.body.error.code).toBe('POSSIBLE_MATCHES');
      expect(res.body.error.message).toBe('She may already be registered. Check the record shown before you register a new patient.');
      expect(res.body.error.total).toBe(1);
      expect(res.body.error.matches).toEqual([{ id: first.id, mrn: 'P-000001', fullName: 'Asha Sample', matchedOn: ['phone'], baby: false, age: 28, doctorName: 'Sample drA', phoneEnd: '3210' }]);
    }
    expect(await Patient.countDocuments({ tenantId: hospital._id })).toBe(1);
    // Another number and another name: registered straight away
    expect((await register('reception', { fullName: 'Someone Else', phone: '98765 43211' })).status).toBe(201);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_REGISTERED_ANYWAY' })).toBe(0);
  });

  it('the same name, whatever the capitals, spaces and dots', async () => {
    const first = await registered('reception', { fullName: 'Asha Sample', phone: '98765 43210' });
    for (const fullName of ['ASHA SAMPLE', 'asha  sample', 'Asha.Sample', 'ashasample']) {
      const res = await register('drA', { fullName, phone: '91234 56789' });
      expect(res.status, fullName).toBe(409);
      expect(res.body.error.matches.map((m) => [m.id, m.matchedOn])).toEqual([[first.id, ['name']]]);
    }
    const both = await register('drA', { fullName: 'asha sample', phone: '098765 43210' });
    expect(both.body.error.matches[0].matchedOn).toEqual(['phone', 'name']);
    expect((await register('drA', { fullName: 'Asha Sampel', phone: '91234 56789' })).status).toBe(201); // another name
  });

  it('"Register as a new patient anyway" saves her; the audit log names the records by id only', async () => {
    const first = await registered('reception', { fullName: 'Asha Sample', phone: '98765 43210' });
    const res = await register('reception', { fullName: 'Asha Sample', phone: '9876543210', registerAnyway: true });
    expect(res.status).toBe(201);
    expect(res.body.patient.mrn).toBe('P-000002');
    const entries = await AuditLog.find({ action: 'PATIENT_REGISTERED_ANYWAY' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ patientId: res.body.patient.id, mrn: 'P-000002', matches: 1, matchIds: [first.id] });
    expect(entries[0].actor.toString()).toBe(id('reception'));
    expect(JSON.stringify(entries[0].details)).not.toMatch(/Asha|98765/);
    // The super admin's audit log gets the count only – never which records
    expect(safeAuditDetails('PATIENT_REGISTERED_ANYWAY', entries[0].details, { scope: 'platform' })).toEqual({ matches: 1 });
    // The flag with nothing to confirm writes no such entry
    await registered('reception', { fullName: 'Nobody Like Her', phone: '91111 22222' });
    expect(await AuditLog.countDocuments({ action: 'PATIENT_REGISTERED_ANYWAY' })).toBe(1);
    expect((await register('reception', { fullName: 'Third', registerAnyway: 'yes' })).status).toBe(400);
  });

  it('a baby is matched only against babies – never against the mother – and an adult never against a baby', async () => {
    const mother = await registered('reception', { careType: 'postnatal', fullName: 'Meera Sample', phone: '98765 00001' });
    const birthAt = '2026-09-27T10:00:00.000Z';
    const baby = await register('reception', { careType: 'newborn', fullName: 'Baby of Meera Sample', phone: '98765 00001', newborn: { birthAt, mother: mother.id } });
    expect(baby.status, JSON.stringify(baby.body)).toBe(201); // the mother's phone number is no match
    const twin = await register('reception', { careType: 'newborn', fullName: 'baby of meera sample', phone: '098765 00001', newborn: { birthAt, mother: mother.id } });
    expect(twin.status).toBe(409);
    expect(twin.body.error.message).toMatch(/^This baby may already be registered/);
    expect(twin.body.error.matches).toEqual([{ id: baby.body.patient.id, mrn: 'P-000002', fullName: 'Baby of Meera Sample', matchedOn: ['phone', 'name'], baby: true, birthAt, doctorName: null, phoneEnd: '0001' }]);
    // An adult with the family's phone number: the mother is shown, never the baby
    const adult = await register('reception', { fullName: 'Another Woman', phone: '+91 98765 00001' });
    expect(adult.body.error.matches.map((m) => m.mrn)).toEqual(['P-000001']);
    // An adult with the baby's name is no match at all
    expect((await register('reception', { fullName: 'Baby of Meera Sample', phone: '91234 00000' })).status).toBe(201);
  });

  it("another hospital's records are never looked at", async () => {
    await Patient.create({ tenantId: other._id, mrn: 'P-000001', careType: 'gynaecology', fullName: 'Asha Sample', phone: '98765 43210', ageYears: 30, createdBy: people.otherDr._id });
    expect((await register('reception', { fullName: 'Asha Sample', phone: '98765 43210' })).status).toBe(201);
    const here = await register('reception', { fullName: 'Asha Sample', phone: '98765 43210' });
    expect(here.body.error.matches.map((m) => m.mrn)).toEqual(['P-000001']);
    expect(here.body.error.matches[0].id).not.toBe(String((await Patient.findOne({ tenantId: other._id }))._id));
  });

  it('shows only what the person registering may see – never a clinical detail, the type of care or "sensitive"', async () => {
    const sensitive = await registered('drA', { careType: 'infertility', fullName: 'Private Sample', phone: '98765 11111', ageYears: 33, assignedDoctor: id('drA'), medical: { allergies: 'Penicillin', bloodGroup: 'O+' }, notes: 'IVF cycle' });
    expect((await view('drA', sensitive)).body.patient.sensitive).toBe(true);
    // The lab registers walk-ins too (owner, 17 Oct 2026): the same safe list as reception
    for (const who of ['reception', 'drB', 'rmo']) {
      const res = await register(who, { fullName: 'Private Sample', phone: '98765 11111' });
      expect(res.status, who).toBe(409);
      expect(res.body.error.matches).toEqual([{ id: sensitive.id, mrn: 'P-000001', fullName: 'Private Sample', matchedOn: ['phone', 'name'], baby: false, age: 33, doctorName: 'Sample drA', phoneEnd: '1111' }]);
      expect(JSON.stringify(res.body)).not.toMatch(/infertility|Penicillin|IVF|sensitive|98765 11111/i);
    }
    // The lab sees an even shorter list (its need-to-know): never the phone, the age or the doctor
    const forLab = await register('lab', { fullName: 'Private Sample', phone: '98765 11111' });
    expect(forLab.status).toBe(409);
    expect(forLab.body.error.matches[0]).toMatchObject({ id: sensitive.id, mrn: 'P-000001', fullName: 'Private Sample' });
    expect(JSON.stringify(forLab.body)).not.toMatch(/infertility|Penicillin|IVF|sensitive|98765 11111|1111/i);
    // Nurses do not register patients at all
    for (const who of ['nurse']) expect((await register(who, { fullName: 'Private Sample', phone: '98765 11111' })).status, who).toBe(403);
  });

  it('a placeholder number is no match; mistakes in the form are said first; at most five records are shown', async () => {
    await registered('reception', { fullName: 'First Sample', phone: '0000000000' });
    expect((await register('reception', { fullName: 'Second Sample', phone: '+91 00000 00000' })).status).toBe(201);
    const bad = await register('reception', { fullName: 'First Sample', ageYears: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty('ageYears');
    for (let i = 0; i < 6; i += 1) await registered('reception', { fullName: `Sister ${i}`, phone: '98765 22222' });
    const many = await register('reception', { fullName: 'Sister 3', phone: '9876522222' });
    expect(many.body.error.total).toBe(6);
    expect(many.body.error.matches).toHaveLength(5);
    expect(many.body.error.matches[0]).toMatchObject({ fullName: 'Sister 3', matchedOn: ['phone', 'name'] }); // the closest first
    expect(many.body.error.message).toMatch(/Check the records shown/);
  });

  it('finds her when two numbers were typed into the phone field, and with +91 0 in front', async () => {
    const two = await registered('reception', { fullName: 'Two Numbers', phone: '98765 43210 91234 56789' });
    const one = await registered('reception', { fullName: 'One Number', phone: '+91 098765 11111' });
    for (const phone of ['9876543210', '+91 91234 56789', '91234 56789 99887 76655']) {
      const res = await register('reception', { fullName: 'Someone Else', phone });
      expect([res.status, res.body.error?.matches?.map((m) => m.id)], phone).toEqual([409, [two.id]]);
    }
    const res = await register('reception', { fullName: 'Someone Else', phone: '98765 11111' });
    expect(res.body.error.matches.map((m) => [m.id, m.phoneEnd])).toEqual([[one.id, '1111']]);
    expect((await register('reception', { fullName: 'Someone Else', phone: '43210 91234' })).status).toBe(201); // digits across the two numbers are no number
  });

  it('a name with a character that cannot be seen is refused with a field message – never a server error', async () => {
    await registered('reception', { fullName: 'Asha Sample', phone: '98765 43210' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fullName of ['Asha\u0000Sample', 'Asha\tSample', 'Asha\u0007 Sample']) {
      const res = await register('reception', { fullName, phone: '91234 56789' });
      expect([res.status, res.body.error.fields?.fullName], JSON.stringify(fullName)).toEqual([400, 'Full name has a character that cannot be saved. Please type the name again.']);
    }
    expect(logged).not.toHaveBeenCalled(); // nothing about the name went to the server's log
    expect(await Patient.countDocuments({ tenantId: hospital._id })).toBe(1);
    // An edit is checked the same way
    const p = await registered('reception', { fullName: 'Bela Sample', phone: '91234 00000' });
    expect((await (await as('reception')).patch(`/api/patients/${p.id}`).send({ fullName: 'Bela\u0000Sample' })).status).toBe(400);
  });

  it('a match that is itself marked as a duplicate is answered with its main record', async () => {
    const { main, dup } = await pair();
    expect((await mark('drA', dup, main)).status).toBe(200);
    const res = await register('reception', { fullName: 'Asha S', phone: '91234 56789' }); // the duplicate's name only
    expect(res.status).toBe(409);
    expect(res.body.error.matches.map((m) => [m.mrn, m.fullName, m.matchedOn])).toEqual([['P-000001', 'Asha Sample', ['name']]]);
    const byPhone = await register('reception', { fullName: 'Third Name', phone: '9876543210' });
    expect(byPhone.body.error.matches.map((m) => m.mrn)).toEqual(['P-000001']); // once, not twice
    expect(byPhone.body.error.total).toBe(1);
  });
});

describe('marking a record as a duplicate: who may, and what cannot be joined', () => {
  it("the patient's doctor or an RMO, who may change both records; a reason is needed", async () => {
    const { main, dup } = await pair();
    for (const who of ['reception', 'nurse', 'lab', 'pharmacist']) {
      const res = await mark(who, dup, main);
      expect(res.status, who).toBe(403);
    }
    expect((await mark('admin', dup, main)).status).toBe(403); // a hospital admin has no patient records at all
    const notMine = await mark('drB', dup, main);
    expect(notMine.status).toBe(403);
    expect(notMine.body.error.message).toMatch(/another doctor's patient/);
    // Dr A may change the duplicate, but the main record is Dr B's: both are needed
    const drBs = await registered('drB', antenatal({ fullName: 'Asha Sample B', phone: '98765 43210', assignedDoctor: id('drB') }));
    const oneOnly = await mark('drA', dup, drBs);
    expect(oneOnly.status).toBe(403);
    expect(oneOnly.body.error.message).toBe("You must be allowed to change both records. P-000003 is another doctor's patient: ask that doctor or an RMO.");
    expect((await mark('drA', dup, main, 'x')).body.error.fields.reason).toMatch(/at least 5 characters/);
    expect((await mark('drA', dup, main, 'She is carrying a boy, same woman')).body.error.fields.reason).toMatch(/PCPNDT/);
    expect((await (await as('drA')).put(`/api/patients/${dup.id}/duplicate-of`).send({ mainId: main.id, reason: REASON, extra: 1 })).status).toBe(400);
    expect((await one(Patient, dup.id)).duplicateOf).toBeNull();

    const done = await mark('drA', dup, main);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // (nothing about her bills: the doctor or RMO who marks does not see billing)
    expect(done.body).toEqual({ appointmentsMoved: 0, arrivedToday: false, details: [], visits: { here: 0, main: 0 }, abhaHere: false, remindersHere: false, main: { id: main.id, mrn: 'P-000001' } });
    // An RMO may join any two records (also another doctor's)
    const second = await registered('drB', antenatal({ fullName: 'Asha Sample B', phone: '98765 43210', assignedDoctor: id('drB') }));
    expect((await mark('rmo', second, drBs)).status).toBe(200);
  });

  it('an unassigned record counts as the doctor\'s own; a baby\'s reason may name the baby\'s sex', async () => {
    const main = await registered('reception', { fullName: 'Walk In', phone: '98765 33333' });
    const dup = await registered('reception', { fullName: 'Walk In', phone: '98765 33333' });
    expect((await mark('drB', dup, main)).status).toBe(200);
    const mother = await registered('drA', { careType: 'postnatal', fullName: 'Meera Sample', assignedDoctor: id('drA') });
    const newborn = { birthAt: '2026-09-27T10:00:00Z', sex: 'female', mother: mother.id };
    const b1 = await registered('drA', { careType: 'newborn', fullName: 'Baby of Meera Sample', assignedDoctor: id('drA'), newborn });
    const b2 = await registered('drA', { careType: 'newborn', fullName: 'Baby of Meera Sample', assignedDoctor: id('drA'), newborn });
    expect((await mark('drA', b2, b1, 'The same baby girl, registered twice')).status).toBe(200);
    // The mother's Babies card lists the baby once
    expect((await view('drA', mother)).body.patient.babies.map((b) => b.mrn)).toEqual([b1.mrn]);
  });

  it('another hospital is "not found" – as the main record, and from another hospital\'s login', async () => {
    const { main, dup } = await pair();
    const foreign = await Patient.create({ tenantId: other._id, mrn: 'P-000001', careType: 'antenatal', fullName: 'Asha Sample', phone: '98765 43210', ageYears: 28, createdBy: people.otherDr._id });
    const res = await mark('drA', dup, { id: String(foreign._id) });
    expect(res.status).toBe(404);
    expect((await mark('rmo', dup, { id: '0123456789abcdef01234567' })).status).toBe(404);
    const otherDr = await loginAs(people.otherDr, { app });
    expect((await otherDr.put(`/api/patients/${dup.id}/duplicate-of`).send({ mainId: main.id, reason: REASON })).status).toBe(404);
    expect((await otherDr.delete(`/api/patients/${dup.id}/duplicate-of`)).status).toBe(404);
    expect((await otherDr.put(`/api/patients/${foreign._id}/duplicate-of`).send({ mainId: main.id, reason: REASON })).status).toBe(404);
    expect((await one(Patient, dup.id)).duplicateOf).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'PATIENT_MARKED_DUPLICATE' })).toBe(0);
  });

  it('not itself, not a duplicate of a duplicate, not a main record, not a baby and an adult, not while she is admitted', async () => {
    const { main, dup } = await pair();
    const third = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210' }));
    const itself = await mark('drA', dup, dup);
    expect(itself.status).toBe(400);
    expect(itself.body.error.message).toMatch(/duplicate of itself/);
    expect((await mark('drA', dup, main)).status).toBe(200);
    const again = await mark('drA', dup, third);
    expect([again.status, again.body.error.message]).toEqual([400, 'This record is already marked as a duplicate of P-000001. Undo that first.']);
    const chain = await mark('drA', third, dup);
    expect([chain.status, chain.body.error.message]).toEqual([400, 'P-000002 is itself marked as a duplicate of P-000001. Choose P-000001 as the main record.']);
    const mainOfOne = await mark('drA', main, third);
    expect([mainOfOne.status, mainOfOne.body.error.message]).toEqual([400, 'This record is the main record of P-000002. Mark the other record as the duplicate, or undo that first.']);
    const baby = await registered('drA', { careType: 'newborn', fullName: 'Baby of Asha Sample', assignedDoctor: id('drA'), newborn: { birthAt: '2026-09-27T10:00:00Z' } });
    for (const [a, b] of [[baby, main], [third, baby]]) {
      const res = await mark('drA', a, b);
      expect([res.status, res.body.error.message]).toEqual([400, "A baby's record and an adult's record cannot be the same person."]);
    }
    // In hospital on the record: the ward works on it
    const admit = await (await as('drA')).post(`/api/patients/${third.id}/admissions`).send({ clientRequestId: randomUUID(), reason: 'Observation' });
    expect(admit.status, JSON.stringify(admit.body)).toBe(201);
    const admitted = await mark('drA', third, main);
    expect([admitted.status, admitted.body.error.code]).toEqual([409, 'ADMITTED']);
    expect(admitted.body.error.message).toMatch(/in hospital on this record now\. Mark P-000001 as the duplicate of this record instead/);
    expect(await Patient.countDocuments({ tenantId: hospital._id, 'duplicateOf.patient': { $ne: null } })).toBe(1);
  });
});

describe('a record marked as a duplicate', () => {
  it('shows where the main record is; the main record shows the earlier one; the audit log has ids only', async () => {
    const { main, dup } = await pair();
    expect((await mark('drA', dup, main)).status).toBe(200);
    const d = (await view('drA', dup)).body.patient;
    expect(d.duplicateOf).toEqual({ id: main.id, mrn: 'P-000001', byName: 'Sample drA', at: NOW.toISOString() });
    expect(d.duplicateReason).toBe(REASON);
    expect(d.access).toMatchObject({ canMarkDuplicate: false, canUndoDuplicate: true });
    const m = (await view('drA', main)).body.patient;
    expect(m.earlierRecords).toEqual([{ id: dup.id, mrn: 'P-000002' }]);
    expect(m.duplicateOf).toBeUndefined();
    expect(m.access).toMatchObject({ canMarkDuplicate: true, canUndoDuplicate: false });
    // Everyone who may open the record sees that it is a duplicate; the reason goes with the medical details only
    for (const who of ['reception', 'lab', 'pharmacist', 'drB', 'nurse', 'rmo']) {
      const seen = (await view(who, dup)).body.patient;
      expect(seen.duplicateOf?.mrn, who).toBe('P-000001');
      expect(seen.duplicateReason, who).toBe(['drB', 'nurse', 'rmo'].includes(who) ? REASON : undefined);
      expect((await view(who, main)).body.patient.earlierRecords, who).toEqual([{ id: dup.id, mrn: 'P-000002' }]);
      expect(seen.access.canMarkDuplicate || (seen.access.canUndoDuplicate && who !== 'rmo'), who).toBe(false);
    }
    const entries = await AuditLog.find({ action: 'PATIENT_MARKED_DUPLICATE' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ patientId: dup.id, mrn: 'P-000002', mainPatientId: main.id, mainMrn: 'P-000001', appointmentsMoved: 0 });
    expect(JSON.stringify(entries[0].details)).not.toMatch(/Asha|98765|mistake/);
    expect(safeAuditDetails('PATIENT_MARKED_DUPLICATE', { ...entries[0].details, reason: 'x', fullName: 'y' })).toEqual(entries[0].details);
    expect(safeAuditDetails('PATIENT_MARKED_DUPLICATE', entries[0].details, { scope: 'platform' })).toEqual({ appointmentsMoved: 0 });
  });

  it('takes no new visits, prescriptions, lab orders, admissions, appointments, arrivals, scans or bills – and says where to go', async () => {
    const { main, dup } = await pair();
    await setWeek();
    await (await as('admin')).get('/api/billing/prices'); // the price list (with the scans and procedures)
    const visit = await startVisit(dup, 'drA', YESTERDAY); // an earlier visit that was never signed
    const drA = await as('drA');
    const reception = await as('reception');
    const scan = (await drA.get(`/api/patients/${main.id}/work-done`)).body.items[0];
    expect(scan?.id).toBeTruthy();
    const linkable = await Appointment.create({ tenantId: hospital._id, patientId: null, guest: { name: 'Asha S', phone: '98765 43210' }, doctorId: people.drA._id, on: new Date('2026-09-30T00:00:00Z'), kind: 'slot', start: '11:30', minutes: 10, source: 'booked', created: { byName: 'Sample reception', at: NOW } });
    const countAll = async () => Promise.all([Visit, LabOrder, Admission, WorkDone, Bill, Arrival].map((M) => M.countDocuments({ tenantId: hospital._id })));
    const before = await countAll();
    expect((await mark('drA', dup, main)).status).toBe(200);
    const refused = {
      visit: await drA.post(`/api/patients/${dup.id}/visits`).send({ clientRequestId: randomUUID() }),
      vitals: await drA.patch(`/api/patients/${dup.id}/visits/${visit.id}`).send({ vitals: { rev: 0, weightKg: 61 } }),
      nextVisit: await drA.patch(`/api/patients/${dup.id}/visits/${visit.id}`).send({ details: { rev: 0, nextVisitOn: '2026-10-05' } }),
      prescription: await drA.put(`/api/patients/${dup.id}/visits/${visit.id}/prescription`).send({ rev: 0, items: [], notes: '', warningReasons: [] }),
      lab: await drA.post(`/api/patients/${dup.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }] }),
      admission: await drA.post(`/api/patients/${dup.id}/admissions`).send({ clientRequestId: randomUUID(), reason: 'Observation' }),
      appointment: await book(dup, '2026-09-30'),
      arrival: await reception.post('/api/arrivals').send({ patientId: dup.id, doctorId: id('drA') }),
      scan: await drA.post(`/api/patients/${dup.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: scan.id }),
      bill: await reception.post('/api/billing/bills').send({ patientId: dup.id }),
      // A quick booking (by phone, no record yet) is not joined to a duplicate record
      link: await reception.post(`/api/appointments/${linkable._id}/link`).send({ patientId: dup.id }),
    };
    for (const [what, res] of Object.entries(refused)) {
      expect([res.status, res.body.error?.code], what).toEqual([409, 'DUPLICATE_RECORD']);
      expect(res.body.error.message, what).toMatch(/^This record is marked as a duplicate of P-000001, so it takes no .+\. Open P-000001 instead\.$/);
    }
    expect(refused.lab.body.error.message).toBe('This record is marked as a duplicate of P-000001, so it takes no new lab orders. Open P-000001 instead.');
    // Nothing was made: no visit, lab order, admission, scan, bill or arrival; the quick booking is still nobody's
    expect(await countAll()).toEqual(before);
    expect(before).toEqual([1, 0, 0, 0, 1, 0]); // the earlier visit and its bill
    expect(await Appointment.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect((await one(Appointment, linkable._id)).patientId).toBeNull();
    expect((await one(Visit, visit.id)).details?.nextVisitOn ?? null).toBeNull();
    // The screens are told not to offer them
    expect((await drA.get(`/api/patients/${dup.id}/visits`)).body.canCreate).toBe(false);
    expect((await drA.get(`/api/patients/${dup.id}/lab-orders`)).body.canOrder).toBe(false);
    expect((await drA.get(`/api/patients/${dup.id}/admissions`)).body.canAdmit).toBe(false);
    expect((await drA.get(`/api/patients/${dup.id}/work-done`)).body.canRecord).toBe(false);
    expect((await reception.get(`/api/appointments/patient/${dup.id}`)).body.canBook).toBe(false);
    // The same things still work on the main record
    expect((await drA.post(`/api/patients/${main.id}/visits`).send({ clientRequestId: randomUUID() })).status).toBe(201);
    expect((await book(main, '2026-09-30')).status).toBe(201);
    expect((await drA.get(`/api/patients/${main.id}/visits`)).body.canCreate).toBe(true);
    expect((await drA.post(`/api/patients/${main.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: scan.id })).status).toBe(201);
    expect((await reception.post(`/api/appointments/${linkable._id}/link`).send({ patientId: main.id })).status).toBe(200);
  });

  it('stays fully readable: the record, its visits (which can still be signed or marked entered in error) and its lists', async () => {
    const { main, dup } = await pair();
    const visit = await startVisit(dup, 'drA', YESTERDAY);
    const drA = await as('drA');
    expect((await drA.patch(`/api/patients/${dup.id}/visits/${visit.id}`).send({ vitals: { rev: 0, weightKg: 61 } })).status).toBe(200);
    expect((await mark('drA', dup, main)).status).toBe(200);
    const rec = await view('nurse', dup);
    expect(rec.status).toBe(200);
    expect(rec.body.patient.medical.bloodGroup).toBe('B+');
    const page = await drA.get(`/api/patients/${dup.id}/visits/${visit.id}`);
    expect(page.status).toBe(200);
    expect(page.body.visit.vitals.weightKg).toBe(61);
    expect(page.body.access).toMatchObject({ canEdit: false, canRecordVitals: false, canSign: true, canCancel: true });
    for (const path of ['visits', 'lab-orders', 'admissions', 'work-done', 'care-plan', 'consents']) expect((await drA.get(`/api/patients/${dup.id}/${path}`)).status, path).toBe(200);
    const cancel = await drA.post(`/api/patients/${dup.id}/visits/${visit.id}/cancel`).send({ reason: 'Written on the duplicate record by mistake' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
  });

  it('is left out of the Patients list and every search – except a search for its own patient number', async () => {
    const { main, dup } = await pair();
    expect(idsOf(await list('drA')).sort()).toEqual([main.id, dup.id].sort());
    expect((await mark('drA', dup, main)).status).toBe(200);
    const all = await list('drA');
    expect(idsOf(all)).toEqual([main.id]);
    expect(all.body.total).toBe(1);
    for (const who of ['reception', 'nurse', 'lab', 'rmo']) expect(idsOf(await list(who)), who).toEqual([main.id]);
    expect(idsOf(await list('reception', '&search=Asha'))).toEqual([main.id]);
    expect(idsOf(await list('reception', '&search=43210'))).toEqual([main.id]);
    expect(idsOf(await list('reception', '&search=P-00000'))).toEqual([main.id]);
    // The number on her old card still finds the record, which points to the main one
    const byNumber = await list('reception', '&search=p-000002');
    expect(byNumber.body.patients.map((p) => [p.id, p.duplicateOf?.mrn])).toEqual([[dup.id, 'P-000001']]);
    // "Show duplicates" for doctors and RMOs only
    for (const who of ['drA', 'drB', 'rmo']) {
      expect(idsOf(await list(who, '&duplicates=include&sort=mrn')), who).toEqual([main.id, dup.id]);
      const only = await list(who, '&duplicates=only');
      expect(only.body.patients.map((p) => [p.id, p.duplicateOf?.mrn]), who).toEqual([[dup.id, 'P-000001']]);
    }
    for (const who of ['reception', 'nurse', 'lab']) {
      const res = await list(who, '&duplicates=include');
      expect([res.status, res.body.error.message], who).toEqual([403, 'Only doctors and RMOs can list the records marked as duplicates.']);
    }
    // A pharmacist has no patient list at all (owner, 26 Oct 2026: the pharmacy's daily register instead)
    const pharm = await list('pharmacist', '&duplicates=include');
    expect([pharm.status, pharm.body.error.message]).toEqual([403, 'The pharmacy finds patients from its daily register.']);
    expect((await list('drA', '&duplicates=yes')).status).toBe(400);
  });

  it('is left out of the calendar, the worklist, the Today page, Analytics and the monthly report', async () => {
    const { main, dup } = await pair();
    await signedVisit(dup);
    await startVisit(main);
    const drA = await as('drA');
    const edd = async () => (await drA.get('/api/calendar?view=week&date=2027-03-01&types=edd&scope=all')).body.events.map((e) => e.patientId).sort();
    const seen = async () => (await drA.get('/api/worklist?scope=all')).body.seenToday.map((s) => s.patient.id).sort();
    const today = async () => (await (await as('reception')).get('/api/today?scope=all')).body.patients.map((p) => p.patient.id).sort();
    const counted = async () => {
      const day = hospitalToday(NOW);
      const data = await loadHospital(hospital._id, { now: NOW, today: day, windowFrom: day, periodFrom: day, periodTo: day, needs: ['patients'] });
      return data.patients.map((p) => String(p._id)).sort();
    };
    const registeredInMonth = async () => (await drA.get('/api/analytics/report/monthly?month=2026-09')).body.sections.flatMap((s) => s.rows).find((r) => r.key === 'registered').value;
    const both = [main.id, dup.id].sort();
    expect([await edd(), await seen(), await today(), await counted(), await registeredInMonth()]).toEqual([both, both, both, both, 2]);
    expect((await mark('drA', dup, main)).status).toBe(200);
    expect([await edd(), await seen(), await today(), await counted(), await registeredInMonth()]).toEqual([[main.id], [main.id], [main.id], [main.id], 1]);
    expect((await undo('drA', dup)).status).toBe(200);
    expect([await edd(), await seen(), await today(), await counted(), await registeredInMonth()]).toEqual([both, both, both, both, 2]);
  });

  it('gets no automatic reminders: a waiting one is cancelled, and none is queued', async () => {
    const { main, dup } = await pair();
    const agreed = { consent: true, channel: 'sms', language: 'en' };
    await Patient.updateMany({ tenantId: hospital._id }, { $set: { reminders: agreed } }, { timestamps: false });
    await setWeek();
    expect((await book(dup, '2026-09-29')).status).toBe(201); // tomorrow
    const waiting = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'care_due', dueOn: '2026-09-30', sendOn: '2026-09-28', channel: 'sms', language: 'en', to: '+919876543210', text: 'A check-up or test is due.' });
    const sent = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'appointment', dueOn: '2026-09-20', sendOn: '2026-09-19', channel: 'sms', language: 'en', to: '+919876543210', text: 'Earlier reminder', status: 'sent' });
    expect((await mark('drA', dup, main)).body.appointmentsMoved).toBe(1);
    expect((await one(ReminderMessage, waiting._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record marked as a duplicate' });
    expect((await one(ReminderMessage, sent._id)).status).toBe('sent'); // what was sent stays as the record of it
    const tenant = await Tenant.findById(hospital._id);
    expect(await queueAppointmentReminders(tenant, NOW)).toBe(1);
    const queued = await ReminderMessage.find({ tenantId: hospital._id, kind: 'appointment', status: 'queued' });
    expect(queued.map((m) => String(m.patientId))).toEqual([main.id]); // her appointment is on the main record now
    // A message queued for the duplicate some other way is cancelled instead of sent
    const stray = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'appointment', ref: 'x', dueOn: '2026-09-29', sendOn: '2026-09-28', channel: 'sms', language: 'en', to: '+919876543210', text: 'Reminder' });
    await sendDueReminders(tenant, NOW);
    expect((await one(ReminderMessage, stray._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record marked as a duplicate' });
  });
});

describe('her appointments and bills', () => {
  it('appointments from today on go to the main record and come back on undo; past ones stay', async () => {
    const { main, dup } = await pair();
    await setWeek();
    const past = await Appointment.create({ tenantId: hospital._id, patientId: dup.id, doctorId: people.drA._id, on: new Date('2026-09-21T00:00:00Z'), kind: 'slot', start: '10:00', minutes: 10, source: 'booked', created: { byName: 'Sample reception', at: NOW } });
    const today = (await book(dup, '2026-09-28', '12:30')).body.appointment;
    const later = (await book(dup, '2026-10-05', '10:30')).body.appointment;
    const cancelled = (await book(dup, '2026-10-06', '10:30')).body.appointment;
    expect((await (await as('reception')).post(`/api/appointments/${cancelled.id}/cancel`).send({ reason: 'patient_asked' })).status).toBe(200);
    const owner = async (a) => String((await one(Appointment, a.id ?? a._id)).patientId);

    const done = await mark('drA', dup, main);
    expect(done.body.appointmentsMoved).toBe(2);
    expect([await owner(past), await owner(today), await owner(later), await owner(cancelled)]).toEqual([dup.id, main.id, main.id, dup.id]);
    expect(String((await one(Appointment, later.id)).movedFromPatientId)).toBe(dup.id);
    const reception = await as('reception');
    expect((await reception.get(`/api/appointments/patient/${main.id}`)).body.upcoming.map((a) => a.date)).toEqual(['2026-09-28', '2026-10-05']);
    expect((await reception.get(`/api/appointments/patient/${dup.id}`)).body.upcoming).toEqual([]);
    expect((await AuditLog.findOne({ action: 'PATIENT_MARKED_DUPLICATE' })).details.appointmentsMoved).toBe(2);

    // On the calendar the bookings are hers on the main record (the duplicate has none)
    const week = (await (await as('drA')).get('/api/calendar?view=week&date=2026-10-05&types=booked&scope=all')).body;
    expect(week.events.filter((e) => e.type === 'booked').map((e) => [e.patientId, e.date])).toEqual([[main.id, '2026-10-05']]);

    // One booked on the main record afterwards is hers there, whatever happens to the duplicate
    const own = (await book(main, '2026-10-07', '10:30')).body.appointment;
    const back = await undo('drA', dup);
    expect(back.body).toEqual({ undone: true, appointmentsMoved: 2, arrivedOnMain: false, main: { id: main.id, mrn: 'P-000001' } });
    expect([await owner(today), await owner(later), await owner(own)]).toEqual([dup.id, dup.id, main.id]);
    expect((await one(Appointment, later.id)).movedFromPatientId).toBeNull();
    expect((await AuditLog.findOne({ action: 'PATIENT_DUPLICATE_UNDONE' })).details).toEqual({ patientId: dup.id, mrn: 'P-000002', mainPatientId: main.id, mainMrn: 'P-000001', appointmentsMoved: 2 });
  });

  it("a next visit booked from the duplicate's visit goes to the main record too, and stays hers there", async () => {
    const { main, dup } = await pair();
    await setWeek();
    const visit = await signedVisit(dup, { diagnosis: 'Routine check', nextVisitOn: '2026-10-05' });
    const drA = await as('drA');
    const appt = await Appointment.findOne({ tenantId: hospital._id, visitId: visit.id });
    expect(String(appt.patientId)).toBe(dup.id);
    expect((await mark('drA', dup, main)).body.appointmentsMoved).toBe(1);
    // On the calendar it is the main record's booking, with no link to a visit of the other record
    const week = (await drA.get('/api/calendar?view=week&date=2026-10-05&types=booked&scope=all')).body;
    expect(week.events.filter((e) => e.type === 'booked').map((e) => [e.patientId, e.date, e.visitId])).toEqual([[main.id, '2026-10-05', null]]);
    // The visit on the duplicate is marked entered in error: the booking is hers on the main record, and stays
    const cancel = await drA.post(`/api/patients/${dup.id}/visits/${visit.id}/cancel`).send({ reason: 'Written on the duplicate record by mistake' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await one(Appointment, appt._id)).toObject()).toMatchObject({ status: 'booked', patientId: (await one(Patient, main.id))._id });
  });

  it("today's appointment stays where her visit was already started; an arrival without a visit is pointed out", async () => {
    const { main, dup } = await pair();
    await setWeek();
    const seenAppt = (await book(dup, '2026-09-28', '12:30')).body.appointment;
    await signedVisit(dup);
    const done = await mark('drA', dup, main);
    expect(done.body).toMatchObject({ appointmentsMoved: 0, arrivedToday: false });
    expect(String((await one(Appointment, seenAppt.id)).patientId)).toBe(dup.id);

    // Another pair: marked as arrived (a walk-in token), no visit yet
    const main2 = await registered('drA', antenatal({ fullName: 'Bela Sample', phone: '98765 44444' }));
    const dup2 = await registered('drA', antenatal({ fullName: 'Bela Sample', phone: '98765 44444' }));
    const arrived = await (await as('reception')).post('/api/arrivals').send({ patientId: dup2.id, doctorId: id('drA') });
    expect(arrived.body.appointment.token).toBe(1);
    const done2 = await mark('drA', dup2, main2);
    expect(done2.body).toMatchObject({ appointmentsMoved: 1, arrivedToday: true });
    // Marked as arrived on the main record, she keeps her token
    const again = await (await as('reception')).post('/api/arrivals').send({ patientId: main2.id, doctorId: id('drA') });
    expect(again.status).toBe(201);
    expect(again.body.appointment).toMatchObject({ token: 1, kind: 'token' });
    expect(await Arrival.countDocuments({ tenantId: hospital._id, patientId: dup2.id })).toBe(1); // nothing was deleted
  });

  it('in the patient portal she sees the appointment that went to her main record – never another one of that record – and cannot book online for the duplicate', async () => {
    const { main, dup } = await pair();
    await setWeek();
    expect((await (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: true, portalBooking: true })).status).toBe(200);
    const { code } = (await (await as('reception')).post(`/api/patients/${dup.id}/portal-access`)).body;
    expect((await book(dup, '2026-10-05', '10:30')).status).toBe(201);
    const agent = request.agent(app);
    expect((await agent.post('/api/portal/login').send({ code, digits: '3210' })).status).toBe(200);
    expect((await agent.get('/api/portal/booking')).body).toMatchObject({ enabled: true, upcoming: { date: '2026-10-05', start: '10:30' } });

    // The main record has an appointment of its own, earlier than hers
    expect((await book(main, '2026-10-01', '11:30')).status).toBe(201);
    expect((await mark('drA', dup, main)).body.appointmentsMoved).toBe(1);
    const lastView = async () => (await AuditLog.find({ action: 'PORTAL_VIEWED' }).sort({ _id: -1 }).limit(1))[0].details;
    const me = (await agent.get('/api/portal/me')).body;
    expect(me.appointment).toBe('2026-10-05T00:00:00.000Z'); // still hers: it is on the main record now
    expect(me.appointmentTime).toBe('10:30');
    // The audit entry names the record whose appointment was shown (ids only)
    expect(await lastView()).toEqual({ patientId: dup.id, mainPatientId: main.id });
    expect(safeAuditDetails('PORTAL_VIEWED', await lastView(), { scope: 'platform' })).toEqual({}); // never to the super admin
    const booking = (await agent.get('/api/portal/booking')).body;
    expect(booking).toMatchObject({ enabled: false, upcoming: { date: '2026-10-05', start: '10:30', canCancel: false } });
    const tried = await agent.post('/api/portal/booking').send({ date: '2026-10-07', start: '10:30' });
    expect([tried.status, tried.body.error.message]).toEqual([409, 'Online booking is not available. Please call the hospital.']);
    expect(await Appointment.countDocuments({ tenantId: hospital._id })).toBe(2);
    // Her own appointment is cancelled by reception: the main record's own appointment (1 Oct) is never shown here –
    // the code and the phone digits prove this record only, and a marking can be wrong
    const moved = await Appointment.findOne({ tenantId: hospital._id, movedFromPatientId: dup.id });
    expect((await (await as('reception')).post(`/api/appointments/${moved._id}/cancel`).send({ reason: 'patient_asked' })).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body).toMatchObject({ appointment: null, appointmentTime: null });
    expect((await agent.get('/api/portal/booking')).body).toMatchObject({ enabled: false, upcoming: null });
    expect(await lastView()).toEqual({ patientId: dup.id });
  });

  it('an open bill stays on the duplicate, with a note reception sees, and can still be paid; no new bill', async () => {
    const { main, dup } = await pair();
    const admin = await as('admin');
    const reception = await as('reception');
    const prices = (await admin.get('/api/billing/prices')).body.items;
    const consult = prices.find((i) => i.key === 'consult_new');
    expect((await admin.patch(`/api/billing/prices/${consult.id}`).send({ pricePaise: 50000 })).status).toBe(200);
    await signedVisit(dup); // the consultation goes on her bill of today
    const before = (await reception.get(`/api/billing/patient/${dup.id}`)).body;
    expect(before.bills).toHaveLength(1);
    expect(before.duplicateOf).toBeNull();
    expect(before.bills[0].patient.duplicateOf).toBeNull();

    const done = await mark('drA', dup, main);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // The doctor who marks is told nothing about her bills (billing is for reception and the hospital admin)
    expect(JSON.stringify(done.body)).not.toMatch(/bill|owed|paise/i);
    // Reception, on the main record's Bills tab: money is still owed on her earlier record
    expect((await reception.get(`/api/billing/patient/${main.id}`)).body).toMatchObject({ bills: [], owed: 0, duplicateOf: null, earlierOwed: [{ id: dup.id, mrn: 'P-000002', bills: 1, owed: 50000 }] });
    expect((await (await as('drA')).get(`/api/billing/patient/${main.id}`)).status).toBe(403);
    const after = (await reception.get(`/api/billing/patient/${dup.id}`)).body;
    expect(after.duplicateOf).toEqual({ id: main.id, mrn: 'P-000001' });
    expect(after.bills.map((b) => [b.id, b.balance])).toEqual([[before.bills[0].id, 50000]]); // where it was
    const bill = (await reception.get(`/api/billing/bills/${before.bills[0].id}`)).body.bill;
    expect(bill.patient).toMatchObject({ mrn: 'P-000002', duplicateOf: { id: main.id, mrn: 'P-000001' } });
    expect(String((await one(Bill, bill.id)).patientId)).toBe(dup.id);
    const paid = await reception.post(`/api/billing/bills/${bill.id}/payments`).send({ mode: 'cash', amountPaise: 50000 });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await reception.post('/api/billing/bills').send({ patientId: dup.id })).body.error.code).toBe('DUPLICATE_RECORD');
    // Paid: nothing is owed on the earlier record any more
    expect((await reception.get(`/api/billing/patient/${main.id}`)).body).toMatchObject({ bills: [], duplicateOf: null, earlierOwed: [] });
  });
});

describe('undo', () => {
  it('a doctor or RMO who may change both records restores it; the marking stays in its history', async () => {
    const { main, dup } = await pair();
    expect((await mark('drA', dup, main)).status).toBe(200);
    for (const who of ['reception', 'nurse', 'lab', 'drB']) expect((await undo(who, dup)).status, who).toBe(403);
    // The main record went to another doctor meanwhile: Dr A may no longer change both
    expect((await (await as('rmo')).patch(`/api/patients/${main.id}/doctor`).send({ doctorId: id('drB') })).status).toBe(200);
    const oneOnly = await undo('drA', dup);
    expect([oneOnly.status, oneOnly.body.error.message]).toEqual([403, "You must be allowed to change both records. P-000001 is another doctor's patient: ask that doctor or an RMO."]);
    vi.setSystemTime(new Date('2026-09-28T07:00:00Z'));
    sessions = {}; // an hour later: log in again
    const res = await undo('rmo', dup);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ undone: true, appointmentsMoved: 0, arrivedOnMain: false, main: { id: main.id, mrn: 'P-000001' } });

    const d = (await view('drA', dup)).body.patient;
    expect(d.duplicateOf).toBeUndefined();
    expect(d.duplicateReason).toBeUndefined();
    expect(d.duplicateHistory).toEqual([{ mrn: 'P-000001', reason: REASON, byName: 'Sample drA', at: NOW.toISOString(), undoneByName: 'Sample rmo', undoneAt: '2026-09-28T07:00:00.000Z' }]);
    expect((await view('reception', dup)).body.patient.duplicateHistory).toBeUndefined(); // typed by a clinician
    expect((await view('rmo', main)).body.patient.earlierRecords).toBeUndefined();
    expect(idsOf(await list('reception')).sort()).toEqual([main.id, dup.id].sort());
    expect((await (await as('drA')).post(`/api/patients/${dup.id}/visits`).send({ clientRequestId: randomUUID() })).status).toBe(201);
    const entries = await AuditLog.find({ action: 'PATIENT_DUPLICATE_UNDONE' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ patientId: dup.id, mrn: 'P-000002', mainPatientId: main.id, mainMrn: 'P-000001', appointmentsMoved: 0 });
    expect(entries[0].actor.toString()).toBe(id('rmo'));
    // Undoing a record that is not marked changes nothing and writes nothing
    expect((await undo('rmo', dup)).body).toEqual({ undone: false, appointmentsMoved: 0 });
    expect(await AuditLog.countDocuments({ action: 'PATIENT_DUPLICATE_UNDONE' })).toBe(1);
    // It can be marked again (the other way round, too)
    expect((await mark('rmo', main, dup)).status).toBe(200);
  });
});

describe('mothers and babies', () => {
  it("a baby is not linked to a mother's duplicate record; the main record lists the babies of her earlier record", async () => {
    const main = await registered('drA', { careType: 'postnatal', fullName: 'Meera Sample', phone: '98765 00001', assignedDoctor: id('drA') });
    const dup = await registered('drA', { careType: 'postnatal', fullName: 'Meera Sample', phone: '98765 00001', assignedDoctor: id('drA') });
    const newborn = (mother) => ({ careType: 'newborn', fullName: 'Baby of Meera Sample', newborn: { birthAt: '2026-09-27T10:00:00Z', mother: mother.id } });
    const first = await registered('reception', newborn(dup));
    expect((await mark('drA', dup, main)).status).toBe(200);
    const refused = await register('reception', { ...newborn(dup), fullName: 'Second baby of Meera Sample' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields['newborn.mother']).toBe('This record of the mother is marked as a duplicate of P-000001. Choose P-000001 as the mother.');
    // Nothing was moved: the first baby is still linked to the earlier record, and the main record lists it too
    expect(String((await one(Patient, first.id)).newborn.mother)).toBe(dup.id);
    // The first baby's details can still be saved with the mother as she is; a baby cannot be newly linked to the duplicate
    const reception = await as('reception');
    const saved = await reception.patch(`/api/patients/${first.id}`).send({ fullName: 'Baby of Meera S', newborn: { birthAt: '2026-09-27T10:00:00Z', birthWeightGrams: 3100, mother: dup.id } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const other2 = await registered('reception', { careType: 'newborn', fullName: 'Baby of Someone Else', newborn: { birthAt: '2026-09-27T11:00:00Z' } });
    const relink = await reception.patch(`/api/patients/${other2.id}`).send({ newborn: { birthAt: '2026-09-27T11:00:00Z', mother: dup.id } });
    expect([relink.status, relink.body.error.fields['newborn.mother']]).toEqual([400, 'This record of the mother is marked as a duplicate of P-000001. Choose P-000001 as the mother.']);
    expect((await view('reception', main)).body.patient.babies.map((b) => b.id)).toEqual([first.id]);
    expect((await view('reception', dup)).body.patient.babies.map((b) => b.id)).toEqual([first.id]);
  });
});

describe('before a record is marked', () => {
  it("a record whose visit of today is still open cannot be marked: the visit would be frozen and she would be on no list", async () => {
    const { main, dup } = await pair();
    const drA = await as('drA');
    const visit = await startVisit(dup);
    expect((await (await as('nurse')).patch(`/api/patients/${dup.id}/visits/${visit.id}`).send({ vitals: { rev: 0, weightKg: 61 } })).status).toBe(200);
    const refused = await mark('drA', dup, main);
    expect([refused.status, refused.body.error.code]).toEqual([409, 'VISIT_OPEN']);
    expect(refused.body.error.message).toBe("Today's visit on this record is still open. Sign it or mark it entered in error first – or mark P-000001 as the duplicate of this record instead.");
    expect((await one(Patient, dup.id)).duplicateOf).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'PATIENT_MARKED_DUPLICATE' })).toBe(0);
    // The check says so before the doctor confirms
    expect((await drA.get(`/api/patients/${dup.id}/duplicate-of/check?mainId=${main.id}`)).body.problem).toMatch(/^Today's visit on this record is still open/);
    // She is still on today's lists, and the visit can still be written in
    expect((await drA.get('/api/worklist?scope=all')).body.seenToday.map((x) => x.patient.id)).toEqual([dup.id]);
    expect((await drA.patch(`/api/patients/${dup.id}/visits/${visit.id}`).send({ details: { rev: 0, diagnosis: 'Routine check' } })).status).toBe(200);
    // The other way round is offered, and works (the record with today's visit is kept)
    expect((await mark('drA', main, dup)).status).toBe(200);
    expect((await undo('drA', main)).status).toBe(200);
    // Signed (or marked entered in error): it can be marked
    const v = (await drA.get(`/api/patients/${dup.id}/visits/${visit.id}`)).body.visit;
    expect((await drA.post(`/api/patients/${dup.id}/visits/${visit.id}/sign`).send({ revs: { vitals: v.vitals.rev, details: v.details.rev, prescription: v.prescription.rev } })).status).toBe(200);
    expect((await mark('drA', dup, main)).status).toBe(200);
    // An unsigned visit of an earlier day does not stop it
    const main2 = await registered('drA', antenatal({ fullName: 'Bela Sample', phone: '98765 44444' }));
    const dup2 = await registered('drA', antenatal({ fullName: 'Bela Sample', phone: '98765 44444' }));
    await startVisit(dup2, 'drA', YESTERDAY);
    expect((await mark('drA', dup2, main2)).status).toBe(200);
  });

  it('tells what only this record has – an allergy, a blood group, pregnancy dates, a care plan, visits – and never stops the marking', async () => {
    // The older record with her history, and the bare record made at the desk today
    const old = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210', obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, pastComplications: ['pph'], complicationsReviewed: true }, medical: { allergies: 'Penicillin – rash', bloodGroup: 'O-', heightCm: 160, weightKg: 60, conditions: ['asthma'], conditionsReviewed: true, otherConditions: 'Migraine' } }));
    const fresh = await registered('drA', { careType: 'gynaecology', fullName: 'Asha Sample', phone: '98765 43210', ageYears: 28, assignedDoctor: id('drA'), medical: { allergies: 'None known' } });
    await startVisit(old, 'drA', YESTERDAY);
    expect((await view('drA', old)).body.patient.risk.level).toBe('high');
    const drA = await as('drA');
    const checkUrl = (a, b) => `/api/patients/${a.id}/duplicate-of/check?mainId=${b.id}`;

    const check = await drA.get(checkUrl(old, fresh));
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    const details = [
      { key: 'allergy', text: 'Penicillin – rash', onMain: 'none' },
      { key: 'bloodGroup', value: 'O-', onMain: '' },
      { key: 'conditions', values: ['asthma'] },
      { key: 'otherConditions', text: 'Migraine' },
      { key: 'previousCaesareans', value: 1 },
      { key: 'pastComplications', values: ['pph'] },
      { key: 'pregnancyDates', edd: '2027-03-01', onMain: null },
      { key: 'risk', level: 'high', onMain: null },
      { key: 'carePlan' },
    ];
    expect(check.body).toEqual({ main: { id: fresh.id, mrn: 'P-000002' }, problem: null, details, visits: { here: 1, main: 0 }, abhaHere: false, remindersHere: false });
    // Reading the other record's medical details is a view of that record (ids only)
    const viewed = await AuditLog.find({ action: 'PATIENT_VIEWED', 'details.patientId': fresh.id }).sort({ _id: -1 }).limit(1);
    expect(viewed[0].details).toEqual({ patientId: fresh.id, mrn: 'P-000002', access: 'full' });
    // The other way round there is nothing to tell
    expect((await drA.get(checkUrl(fresh, old))).body).toMatchObject({ problem: null, details: [], visits: { here: 0, main: 1 } });
    // Only the doctor or RMO who may change both records; another hospital's record is "not found"; nothing is changed
    for (const who of ['reception', 'nurse', 'lab', 'pharmacist', 'admin', 'drB']) expect((await (await as(who)).get(checkUrl(old, fresh))).status, who).toBe(403);
    expect((await (await as('rmo')).get(checkUrl(old, fresh))).status).toBe(200);
    const foreign = await Patient.create({ tenantId: other._id, mrn: 'P-000001', careType: 'antenatal', fullName: 'Asha Sample', ageYears: 28, createdBy: people.otherDr._id });
    expect((await drA.get(`/api/patients/${old.id}/duplicate-of/check?mainId=${foreign._id}`)).status).toBe(404);
    expect((await drA.get(`/api/patients/${old.id}/duplicate-of/check?mainId=${old.id}`)).status).toBe(400);
    expect((await drA.get(`/api/patients/${old.id}/duplicate-of/check`)).status).toBe(400);
    expect((await one(Patient, old.id)).duplicateOf).toBeNull();

    // It never stops the marking: the answer says it again, and the main record keeps saying it
    const done = await mark('drA', old, fresh);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ details, visits: { here: 1, main: 0 } });
    const m = (await view('drA', fresh)).body.patient;
    expect(m.earlierRecordDetails).toEqual([{ id: old.id, mrn: 'P-000001', details }]);
    // Only for those who may see the medical details of BOTH records
    expect((await view('nurse', fresh)).body.patient.earlierRecordDetails).toEqual([{ id: old.id, mrn: 'P-000001', details }]);
    for (const who of ['reception', 'lab', 'pharmacist']) {
      const seen = (await view(who, fresh)).body.patient;
      expect(seen.earlierRecords, who).toEqual([{ id: old.id, mrn: 'P-000001' }]);
      expect(seen.earlierRecordDetails, who).toBeUndefined();
      expect(JSON.stringify(seen), who).not.toMatch(/Penicillin|Migraine|asthma/);
    }
    expect((await drA.patch(`/api/patients/${old.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await view('nurse', fresh)).body.patient.earlierRecordDetails).toBeUndefined(); // the earlier record is sensitive now
    expect((await view('rmo', fresh)).body.patient.earlierRecordDetails).toHaveLength(1);
    // Copied to the main record: no longer said
    expect((await drA.patch(`/api/patients/${fresh.id}`).send({ medical: { allergies: 'penicillin – rash', bloodGroup: 'O-', conditions: ['asthma'], conditionsReviewed: true, otherConditions: 'Migraine' } })).status).toBe(200);
    expect((await view('drA', fresh)).body.patient.earlierRecordDetails[0].details.map((d) => d.key)).toEqual(['previousCaesareans', 'pastComplications', 'pregnancyDates', 'risk', 'carePlan']);
  });

  it('the comparison itself: only what the other record lacks', () => {
    for (const none of ['None known', 'NKDA', 'nil', 'No known drug allergies.']) expect(allergyStatus(none), none).toBe('none');
    expect([allergyStatus(''), allergyStatus(null), allergyStatus('Sulfa')]).toEqual(['not_asked', 'not_asked', 'recorded']);
    const rec = (over = {}) => ({ careType: 'gynaecology', medical: {}, obstetric: {}, pregnancy: {}, ...over });
    expect(detailsOnlyOn(rec(), rec())).toEqual([]);
    expect(detailsOnlyOn(rec({ medical: { allergies: 'Sulfa' } }), rec({ medical: { allergies: ' sulfa ' } }))).toEqual([]);
    expect(detailsOnlyOn(rec({ medical: { allergies: 'Sulfa' } }), rec({ medical: { allergies: 'Latex' } }))).toEqual([{ key: 'allergy', text: 'Sulfa', onMain: 'recorded' }]);
    expect(detailsOnlyOn(rec({ medical: { allergies: 'Sulfa' } }), rec())).toEqual([{ key: 'allergy', text: 'Sulfa', onMain: 'not_asked' }]);
    expect(detailsOnlyOn(rec({ medical: { allergies: 'None known' } }), rec())).toEqual([]); // "none known" is nothing to copy
    expect(detailsOnlyOn(rec({ medical: { bloodGroup: 'A+' } }), rec({ medical: { bloodGroup: 'B+' } }))).toEqual([{ key: 'bloodGroup', value: 'A+', onMain: 'B+' }]);
    expect(detailsOnlyOn(rec({ medical: { conditions: ['asthma', 'thyroid'] } }), rec({ medical: { conditions: ['thyroid'] } }))).toEqual([{ key: 'conditions', values: ['asthma'] }]);
    // A baby's record has no allergy question; its blood group counts
    expect(detailsOnlyOn(rec({ careType: 'newborn', medical: { allergies: 'x', bloodGroup: 'O+' } }), rec({ careType: 'newborn' }))).toEqual([{ key: 'bloodGroup', value: 'O+', onMain: '' }]);
    // Pregnancy dates: other dates on the main record are said too; the same dates are not
    const preg = (scanEdd, over = {}) => rec({ careType: 'antenatal', pregnancy: { lmp: null, scanEdd: new Date(`${scanEdd}T00:00:00Z`) }, ...over });
    expect(detailsOnlyOn(preg('2027-03-01'), preg('2027-03-01'), NOW)).toEqual([]);
    expect(detailsOnlyOn(preg('2027-03-01'), preg('2027-03-20'), NOW)).toEqual([{ key: 'pregnancyDates', edd: '2027-03-01', onMain: '2027-03-20' }]);
    expect(detailsOnlyOn(preg('2027-03-01', { risk: { level: 'moderate' } }), preg('2027-03-01', { risk: { level: 'low' } }), NOW)).toEqual([{ key: 'risk', level: 'moderate', onMain: 'low' }]);
    expect(detailsOnlyOn(preg('2027-03-01', { risk: { level: 'moderate' } }), preg('2027-03-01', { risk: { level: 'high' } }), NOW)).toEqual([]);
  });

  it('pressed again after a marking that was cut off: the rest is done, nothing twice, and the audit entry is there', async () => {
    const { main, dup } = await pair();
    await setWeek();
    const first = (await book(dup, '2026-10-05', '10:30')).body.appointment;
    const second = (await book(dup, '2026-10-06', '10:30')).body.appointment;
    await Patient.updateOne({ tenantId: hospital._id, _id: dup.id }, { $set: { reminders: { consent: true, channel: 'sms', language: 'en' } } }, { timestamps: false });
    // The step after the appointments fails once (as a database hiccup would)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ReminderMessage, 'updateMany').mockRejectedValueOnce(new Error('database hiccup'));
    const cut = await mark('drA', dup, main);
    expect(cut.status).toBe(500);
    expect(logged).toHaveBeenCalled();
    const marked = await one(Patient, dup.id);
    expect(marked.duplicateOf.mrn).toBe('P-000001'); // the record IS marked …
    let entries = await AuditLog.find({ action: 'PATIENT_MARKED_DUPLICATE' });
    expect(entries.map((e) => e.details)).toEqual([{ patientId: dup.id, mrn: 'P-000002', mainPatientId: main.id, mainMrn: 'P-000001', appointmentsMoved: 2 }]); // … and the audit log says so

    // Pressed again: finished, with 200 – not "already marked … Undo that first"
    await Appointment.updateOne({ tenantId: hospital._id, _id: second.id }, { $set: { patientId: dup.id, movedFromPatientId: null } }); // one that had not moved yet
    vi.setSystemTime(new Date('2026-09-28T06:10:00Z'));
    const again = await mark('drA', dup, main, 'Another reason typed the second time');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ appointmentsMoved: 1, remindersHere: true, main: { id: main.id, mrn: 'P-000001' } });
    for (const a of [first, second]) expect(String((await one(Appointment, a.id)).patientId)).toBe(main.id);
    const kept = (await one(Patient, dup.id)).duplicateOf;
    expect([kept.reason, kept.at.toISOString()]).toEqual([REASON, NOW.toISOString()]); // the first marking stands
    entries = await AuditLog.find({ action: 'PATIENT_MARKED_DUPLICATE' }).sort({ _id: 1 });
    expect(entries.map((e) => e.details.appointmentsMoved)).toEqual([2, 1]);
    // Only for the same main record, and only by someone who may change both
    const third = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210' }));
    expect((await mark('drA', dup, third)).body.error.message).toBe('This record is already marked as a duplicate of P-000001. Undo that first.');
    expect((await mark('drB', dup, main)).status).toBe(403);
    expect((await mark('reception', dup, main)).status).toBe(403);
  });

  it('two markings at the same moment never leave a duplicate of a duplicate', async () => {
    const a = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210' }));
    const b = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210' }));
    const c = await registered('drA', antenatal({ fullName: 'Asha Sample', phone: '98765 43210' }));
    const chains = async () => {
      const marked = await Patient.find({ tenantId: hospital._id, 'duplicateOf.patient': { $ne: null } }, { duplicateOf: 1 }).lean();
      const dupIds = new Set(marked.map((p) => String(p._id)));
      return marked.filter((p) => dupIds.has(String(p.duplicateOf.patient))).length; // a record that points to a duplicate
    };
    const reqOf = { tenantId: hospital._id, now: NOW, user: { _id: people.drA._id, name: 'Sample drA' } };
    const doc = (p) => one(Patient, p.id);

    // The second look after saving (duplicateService.markDuplicate), with the copies each request read BEFORE the
    // other one saved: A→B was saved first; B→A and C→A are taken back; B→C too (B is the main record of A).
    expect((await mark('drA', a, b)).status).toBe(200);
    const stale = { a: await doc(a), b: await doc(b), c: await doc(c) };
    stale.a.duplicateOf = null; // as the other request saw it
    for (const [dup, main] of [[stale.b, stale.a], [stale.c, stale.a]]) {
      await expect(markDuplicate(reqOf, dup, main, REASON)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
      expect((await doc({ id: String(dup._id) })).duplicateOf).toBeNull();
    }
    await expect(markDuplicate(reqOf, await doc(b), stale.c, REASON)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect((await doc(b)).duplicateOf).toBeNull();
    expect(await chains()).toBe(0);
    expect((await undo('drA', a)).status).toBe(200);

    // And really at the same moment, a few times: A→B with B→A, then C→A with A→B
    for (let round = 0; round < 3; round += 1) {
      const both = await Promise.all([mark('drA', a, b), mark('drA', b, a)]);
      expect(both.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
      for (const r of both) expect([200, 400, 409]).toContain(r.status);
      expect(await chains()).toBe(0);
      await undo('drA', a);
      await undo('drA', b);
      const two = await Promise.all([mark('drA', c, a), mark('drA', a, b)]);
      for (const r of two) expect([200, 400, 409]).toContain(r.status);
      expect(await chains()).toBe(0);
      await undo('drA', c);
      await undo('drA', a);
    }
    expect(await Patient.countDocuments({ tenantId: hospital._id, 'duplicateOf.patient': { $ne: null } })).toBe(0);
  });
});

describe('undo: what the marking changed is put back, and said', () => {
  it('her reminders that were cancelled by the marking wait again; one whose day has passed stays cancelled', async () => {
    const { main, dup } = await pair();
    await Patient.updateOne({ tenantId: hospital._id, _id: dup.id }, { $set: { reminders: { consent: true, channel: 'sms', language: 'en' } } }, { timestamps: false });
    await setWeek();
    expect((await book(dup, '2026-09-29')).status).toBe(201); // tomorrow
    const tenant = await Tenant.findById(hospital._id);
    expect(await queueAppointmentReminders(tenant, NOW)).toBe(1); // the day-before reminder is waiting
    const old = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'care_due', dueOn: '2026-09-27', sendOn: '2026-09-25', channel: 'sms', language: 'en', to: '+919876543210', text: 'A check-up or test is due.' });
    const offByHer = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'appointment', ref: 'y', dueOn: '2026-09-30', sendOn: '2026-09-29', channel: 'sms', language: 'en', to: '+919876543210', text: 'Reminder', status: 'cancelled', error: 'Reminders switched off for this patient' });

    const done = await mark('drA', dup, main);
    // She agreed on this record only: said, so that somebody asks her again on the main record
    expect(done.body).toMatchObject({ appointmentsMoved: 1, remindersHere: true });
    expect((await ReminderMessage.find({ tenantId: hospital._id, patientId: dup.id }).lean()).map((m) => m.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(await queueAppointmentReminders(tenant, NOW)).toBe(0); // the main record has no agreement: nothing is sent

    expect((await undo('drA', dup)).body).toMatchObject({ undone: true, appointmentsMoved: 1, arrivedOnMain: false });
    const reminder = await ReminderMessage.findOne({ tenantId: hospital._id, patientId: dup.id, kind: 'appointment', ref: '' }).lean();
    expect(reminder).toMatchObject({ status: 'queued', error: '' }); // waits again: she gets her reminder for tomorrow
    expect(await queueAppointmentReminders(tenant, NOW)).toBe(0); // (not queued a second time)
    expect((await one(ReminderMessage, old._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record marked as a duplicate' }); // its day has passed
    expect((await one(ReminderMessage, offByHer._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Reminders switched off for this patient' }); // cancelled for another reason
    await sendDueReminders(tenant, NOW);
    expect((await one(ReminderMessage, reminder._id)).status).toBe('to_send'); // no provider here: left for staff to send by hand
  });

  it("an arrival left on the main record is pointed out when today's appointment comes back", async () => {
    const { main, dup } = await pair();
    await setWeek();
    const appt = (await book(dup, '2026-09-28', '12:30')).body.appointment;
    expect((await mark('drA', dup, main)).body).toMatchObject({ appointmentsMoved: 1, arrivedToday: false });
    expect((await (await as('reception')).post('/api/arrivals').send({ patientId: main.id, doctorId: id('drA') })).status).toBe(201);
    const back = await undo('drA', dup);
    expect(back.body).toEqual({ undone: true, appointmentsMoved: 1, arrivedOnMain: true, main: { id: main.id, mrn: 'P-000001' } });
    expect(String((await one(Appointment, appt.id)).patientId)).toBe(dup.id);
    expect(await Arrival.countDocuments({ tenantId: hospital._id, patientId: main.id })).toBe(1); // nothing was deleted
  });
});

describe('the general reminders, the old next-visit dates and the AI search leave a duplicate out', () => {
  it('no "we missed you" and no "a check-up or test is due" for a duplicate; a waiting one is cancelled; back after undo', async () => {
    for (const t of await CarePlanTemplate.find({ tenantId: hospital._id, kind: 'standard', careType: 'antenatal' }).lean()) {
      expect((await (await as('drA')).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version })).status).toBe(200);
    }
    expect((await (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: false })).status).toBe(200);
    const { main, dup } = await pair();
    await Patient.updateOne({ tenantId: hospital._id, _id: dup.id }, { $set: { reminders: { consent: true, channel: 'sms', language: 'en' } } }, { timestamps: false });
    // An appointment two days ago that nobody came to (it stays on the duplicate: only appointments from today on move)
    await Appointment.create({ tenantId: hospital._id, patientId: dup.id, doctorId: people.drA._id, on: new Date('2026-09-26T00:00:00Z'), kind: 'slot', start: '10:30', minutes: 10, source: 'booked', created: { byName: 'Sample reception', at: new Date('2026-09-20T06:00:00Z') } });
    expect((await mark('drA', dup, main)).status).toBe(200);
    const tenant = await Tenant.findById(hospital._id);
    const later = new Date('2026-10-21T06:00:00Z'); // her booking tests are overdue by then
    expect(await queueMissedAppointments(tenant, NOW)).toBe(0);
    expect(await queueCareDue(tenant, later)).toEqual({ added: 0, heldBack: 0 });
    // One queued for the duplicate some other way is cancelled before anyone sends it
    const stray = await ReminderMessage.create({ tenantId: hospital._id, patientId: dup.id, kind: 'care_due', dueOn: '2026-10-25', sendOn: '2026-10-21', channel: 'sms', language: 'en', to: '+919876543210', text: 'A check-up or test is due.' });
    await cancelStaleGeneral(tenant, later);
    expect((await one(ReminderMessage, stray._id)).toObject()).toMatchObject({ status: 'cancelled', error: 'Record marked as a duplicate' });
    await ReminderMessage.deleteMany({ tenantId: hospital._id }); // (test only: a clean outbox for the second half)

    // The same record after "Undo": both messages are queued – it was the marking that held them back
    expect((await undo('drA', dup)).status).toBe(200);
    expect(await queueMissedAppointments(tenant, NOW)).toBe(1);
    expect((await ReminderMessage.find({ tenantId: hospital._id }).lean()).map((m) => [String(m.patientId), m.kind])).toEqual([[dup.id, 'missed']]);
    await ReminderMessage.deleteMany({ tenantId: hospital._id });
    expect(await queueCareDue(tenant, later)).toMatchObject({ added: 1 });
  });

  it('a next-visit date from before appointment booking is not turned into an appointment on a duplicate', async () => {
    const { main, dup } = await pair();
    await setWeek();
    const visit = await signedVisit(dup, { diagnosis: 'Routine check', nextVisitOn: '2026-10-05' });
    await Appointment.deleteMany({ tenantId: hospital._id, visitId: visit.id }); // as on a visit from before appointment booking
    expect((await mark('drA', dup, main)).status).toBe(200);
    expect(await convertNextVisits(hospital._id, NOW)).toBe(0);
    expect(await Appointment.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect((await undo('drA', dup)).status).toBe(200);
    expect(await convertNextVisits(hospital._id, NOW)).toBe(1);
    expect(String((await Appointment.findOne({ tenantId: hospital._id })).patientId)).toBe(dup.id);
  });

  it('"Ask your records" never answers with a duplicate', async () => {
    const { main, dup } = await pair();
    expect((await mark('drA', dup, main)).status).toBe(200);
    process.env.OPENAI_API_KEY = 'sk-test-not-real'; // a stand-in answers below: nothing leaves the computer
    try {
      const none = { careTypes: [], weeksFrom: null, weeksTo: null, eddFrom: null, eddTo: null, riskLevels: [], redFlags: null, carePlan: [], carePlanItem: null, conditions: [], pastComplications: [], rhNegative: null, previousCaesareansAtLeast: null, ageFrom: null, ageTo: null, seenFrom: null, seenTo: null, notSeenForDays: null, mine: false };
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ model: 'gpt-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...none, understood: 'All antenatal patients.', unsupported: '', careTypes: ['antenatal'] }), refusal: null } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      const res = await (await as('drA')).post('/api/ai/ask').send({ question: 'all antenatal patients' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.results.map((r) => r.mrn)).toEqual(['P-000001']);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe('money, medicines and the consultation type', () => {
  it("no fee is taken in advance for an appointment on a duplicate; her next visit on the main record is a follow-up", async () => {
    const { main, dup } = await pair();
    await setWeek();
    const admin = await as('admin');
    const reception = await as('reception');
    const prices = (await admin.get('/api/billing/prices')).body.items;
    for (const [key, pricePaise] of [['consult_new', 50000], ['consult_follow', 30000]]) expect((await admin.patch(`/api/billing/prices/${prices.find((i) => i.key === key).id}`).send({ pricePaise })).status).toBe(200);
    const appt = (await book(dup, '2026-09-28', '12:30')).body.appointment;
    await signedVisit(dup); // her first visit: a new-patient consultation on the duplicate's bill; today's appointment stays with it
    expect((await mark('drA', dup, main)).body.appointmentsMoved).toBe(0);
    const fee = await reception.post(`/api/appointments/${appt.id}/fee`).send({ mode: 'cash' });
    expect([fee.status, fee.body.error.code]).toEqual([409, 'DUPLICATE_RECORD']);
    expect(await Bill.countDocuments({ tenantId: hospital._id })).toBe(1);
    // Tomorrow, on the main record: she is not a new patient (her earlier visit is on her earlier record)
    vi.setSystemTime(new Date('2026-09-29T06:00:00Z'));
    sessions = {};
    await startVisit(main);
    const bills = (await (await as('reception')).get(`/api/billing/patient/${main.id}`)).body.bills;
    const bill = (await (await as('reception')).get(`/api/billing/bills/${bills[0].id}`)).body.bill;
    expect(bill.lines.map((l) => [l.group, l.amountPaise])).toEqual([['consultation', 30000]]);
  });

  it('the pharmacy sells on the main record – also against a prescription written on the earlier record – and never on the duplicate', async () => {
    const { main, dup } = await pair();
    const ph = async (method, path, body) => (await as('pharmacist'))[method](`/api/pharmacy${path}`).send(body);
    const med = (await ph('post', '/medicines', { name: 'Folvite 5', generic: 'Folic acid', strength: '5 mg', form: 'tablet', unit: 'tablet', gstRate: 5 })).body.medicine;
    const sup = (await ph('post', '/suppliers', { name: 'Sample Distributors', gstin: '27ABCDE1234F1Z5' })).body.supplier;
    expect((await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'INV-1', invoiceDate: '2026-09-27', lines: [{ medicineId: med.id, batch: 'B1', expiry: '2028-01', qty: 50, ratePaise: 100, mrpPaise: 224 }] })).status).toBe(201);
    // A prescription written on the record that is then marked as the duplicate (the visit is signed first)
    const drA = await as('drA');
    const visit = await startVisit(dup);
    const rx = await drA.put(`/api/patients/${dup.id}/visits/${visit.id}/prescription`).send({ rev: 0, items: [{ drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', durationValue: 10, durationUnit: 'days' }] });
    expect(rx.status, JSON.stringify(rx.body)).toBe(200);
    const v = rx.body.visit;
    expect((await drA.post(`/api/patients/${dup.id}/visits/${visit.id}/sign`).send({ revs: { vitals: v.vitals.rev, details: v.details.rev, prescription: v.prescription.rev } })).status).toBe(200);
    const stranger = await registered('drA', antenatal({ fullName: 'Someone Else', phone: '91234 56789' }));
    const strangersVisit = await startVisit(stranger);
    expect((await mark('drA', dup, main)).status).toBe(200);
    const billsBefore = await Bill.countDocuments({ tenantId: hospital._id });

    // On the duplicate: refused, with the main record named – no invoice, no new bill, no stock taken
    const refused = await ph('post', '/invoices', { kind: 'sale', patientId: dup.id, visitId: visit.id, lines: [{ medicineId: med.id, qty: 10 }] });
    expect([refused.status, refused.body.error.code, refused.body.error.message]).toEqual([409, 'DUPLICATE_RECORD', 'This record is marked as a duplicate of P-000001, so it takes no new pharmacy sales. Open P-000001 instead.']);
    expect(await Bill.countDocuments({ tenantId: hospital._id })).toBe(billsBefore);
    expect((await ph('get', '/stock')).body.medicines.find((x) => x.id === med.id).qty).toBe(50);
    expect((await ph('get', `/patients/${dup.id}/prescriptions`)).body.patient.duplicateOf).toEqual({ id: main.id, mrn: 'P-000001' });

    // On the main record: the prescription written on her earlier record is listed (and says where it is from)
    const list = (await ph('get', `/patients/${main.id}/prescriptions`)).body;
    expect(list.patient).toMatchObject({ mrn: 'P-000001', duplicateOf: null });
    expect(list.prescriptions.map((x) => [x.visitId, x.fromRecord])).toEqual([[visit.id, 'P-000002']]);
    const sold = await ph('post', '/invoices', { kind: 'sale', patientId: main.id, visitId: visit.id, lines: [{ medicineId: med.id, qty: 10 }] });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    expect(sold.body.invoice).toMatchObject({ fromPrescription: true, doctor: { name: 'Sample drA' } });
    const bills = (await (await as('reception')).get(`/api/billing/patient/${main.id}`)).body.bills;
    expect(bills).toHaveLength(1); // on the main record's bill
    // Never a stranger's prescription
    const wrong = await ph('post', '/invoices', { kind: 'sale', patientId: main.id, visitId: strangersVisit.id, lines: [{ medicineId: med.id, qty: 1 }] });
    expect([wrong.status, wrong.body.error.message]).toEqual([400, 'That prescription is not this patient’s.']);
  });
});

describe('Analytics and the monthly report count her visits once, under her main record', () => {
  it('a visit made on a duplicate still counts – for her main record – on both pages', async () => {
    const { main, dup } = await pair();
    await startVisit(dup, 'drA', YESTERDAY);
    await signedVisit(dup);
    const lone = await registered('drA', antenatal({ fullName: 'Bela Sample', phone: '98765 44444' }));
    await startVisit(lone);
    const day = hospitalToday(NOW);
    const load = () => loadHospital(hospital._id, { now: NOW, today: day, windowFrom: new Date('2026-09-01T00:00:00Z'), periodFrom: new Date('2026-09-01T00:00:00Z'), periodTo: day, needs: ['patients', 'visitSummary', 'windowVisits', 'cancelled'] });
    const shape = (data) => ({
      patients: data.patients.map((p) => String(p._id)).sort(),
      visitsBy: data.windowVisits.map((v) => String(v.patientId)).sort(),
      summary: data.visitSummary.map((r) => [String(r._id), r.antenatalVisits, r.firstOn.toISOString().slice(0, 10), r.lastOn.toISOString().slice(0, 10)]).sort(),
    });
    const monthly = async () => {
      const rows = (await (await as('drA')).get('/api/analytics/report/monthly?month=2026-09')).body.sections.flatMap((x) => x.rows);
      return Object.fromEntries(['registered', 'visits', 'visits_new', 'visits_follow'].map((k) => [k, rows.find((r) => r.key === k).value]));
    };
    const before = shape(await load());
    expect(before.visitsBy).toEqual([dup.id, dup.id, lone.id].sort());
    expect(await monthly()).toEqual({ registered: 3, visits: 3, visits_new: 2, visits_follow: 1 });

    expect((await mark('drA', dup, main)).status).toBe(200);
    // On the main record tomorrow: one more visit of the same woman
    const after = shape(await load());
    expect(after.patients).toEqual([main.id, lone.id].sort()); // one person counts once …
    expect(after.visitsBy).toEqual([main.id, main.id, lone.id].sort()); // … and every visit that took place is counted, as hers
    expect(after.summary).toEqual([[main.id, 2, YESTERDAY, '2026-09-28'], [lone.id, 1, '2026-09-28', '2026-09-28']].sort());
    expect(await monthly()).toEqual({ registered: 2, visits: 3, visits_new: 2, visits_follow: 1 }); // the two pages agree
    await startVisit(main);
    expect(await monthly()).toEqual({ registered: 2, visits: 4, visits_new: 2, visits_follow: 2 }); // not a "first visit" again
    expect(shape(await load()).summary).toContainEqual([main.id, 3, YESTERDAY, '2026-09-28']);

    expect((await undo('drA', dup)).status).toBe(200);
    expect(shape(await load()).visitsBy).toEqual([dup.id, dup.id, main.id, lone.id].sort());
  });

  it('joining the rows of two records: the first and the latest visit of both', () => {
    const d = (s) => new Date(`${s}T00:00:00Z`);
    const row = (id, firstOn, lastOn, extra = {}) => ({ _id: id, firstId: `${id}-first`, firstOn: d(firstOn), firstCareType: 'antenatal', lastOn: d(lastOn), lastNextVisitOn: null, firstAntenatalOn: d(firstOn), antenatalVisits: 2, ...extra });
    const [mainId, dupId, loneId] = ['64b000000000000000000001', '64b000000000000000000002', '64b000000000000000000003'];
    const data = {
      windowVisits: [{ _id: 'v1', patientId: dupId }, { _id: 'v2', patientId: loneId }],
      cancelledVisits: [{ _id: 'v3', patientId: dupId }],
      visitSummary: [row(dupId, '2026-08-01', '2026-09-10', { lastNextVisitOn: d('2026-10-01') }), row(mainId, '2026-09-01', '2026-09-05', { firstAntenatalOn: null, antenatalVisits: 0, firstCareType: 'gynaecology' }), row(loneId, '2026-09-02', '2026-09-02')],
    };
    underMainRecord(data, new Map([[dupId, mainId]]));
    expect(data.windowVisits.map((v) => String(v.patientId))).toEqual([mainId, loneId]);
    expect(data.cancelledVisits.map((v) => String(v.patientId))).toEqual([mainId]);
    const joined = data.visitSummary.find((r) => String(r._id) === mainId);
    expect(joined).toMatchObject({ firstId: `${dupId}-first`, firstOn: d('2026-08-01'), firstCareType: 'antenatal', lastOn: d('2026-09-10'), lastNextVisitOn: d('2026-10-01'), firstAntenatalOn: d('2026-08-01'), antenatalVisits: 2 });
    expect(data.visitSummary.map((r) => String(r._id)).sort()).toEqual([mainId, loneId]);
    // A duplicate with visits whose main record has none: its row becomes the main record's
    const only = { windowVisits: [], cancelledVisits: [], visitSummary: [row(dupId, '2026-08-01', '2026-09-10')] };
    underMainRecord(only, new Map([[dupId, mainId]]));
    expect(only.visitSummary.map((r) => [String(r._id), r.antenatalVisits])).toEqual([[mainId, 2]]);
  });
});

describe('ABHA and Scan & Share', () => {
  it('an ABHA on the earlier record: the desk is pointed to the main record and told plainly what to do', async () => {
    const { main, dup } = await pair();
    const abha = { number: '91-1234-5678-9012', address: 'asha.sample@abdm', nameOnAbha: 'Asha Sample', method: 'verified', consent: true, byName: 'Sample reception', at: NOW };
    await Patient.updateOne({ tenantId: hospital._id, _id: dup.id }, { $set: { abha } }, { timestamps: false });
    const share = await ScanShare.create({ tenantId: hospital._id, on: hospitalToday(NOW), token: 1, source: 'practice', profile: { abhaNumber: abha.number, abhaAddress: abha.address, name: 'Asha Sample', yearOfBirth: 1998, mobile: '9876543210' } });
    const reception = await as('reception');
    const known = async () => (await reception.get('/api/abdm/scan-share')).body.shares[0].knownPatient;
    expect(await known()).toEqual({ id: dup.id, fullName: 'Asha S', mrn: 'P-000002', abhaOn: null });

    const done = await mark('drA', dup, main);
    expect(done.body).toMatchObject({ abhaHere: true }); // said to the doctor who marks
    expect(await known()).toEqual({ id: main.id, fullName: 'Asha Sample', mrn: 'P-000001', abhaOn: { id: dup.id, mrn: 'P-000002' } });
    const link = await reception.post(`/api/abdm/scan-share/${share._id}/link`).send({ patientId: main.id });
    expect([link.status, link.body.error.code, link.body.error.message]).toEqual([409, 'ABHA_ON_EARLIER_RECORD', 'Her ABHA is on her earlier record P-000002. Unlink it there first (ABHA tab of P-000002), then link it here.']);
    // A stranger's ABHA is still said as before
    const stranger = await registered('reception', { fullName: 'Someone Else', phone: '91234 56789' });
    expect((await reception.post(`/api/abdm/scan-share/${share._id}/link`).send({ patientId: stranger.id })).body.error.code).toBe('ABHA_IN_USE');
    // Unlinked on the earlier record, then linked on the main one: nothing moved by itself
    expect((await reception.post(`/api/abdm/patients/${dup.id}/unlink`).send({ reason: 'Moved to her main record' })).status).toBe(200);
    expect((await reception.post(`/api/abdm/scan-share/${share._id}/link`).send({ patientId: main.id })).status).toBe(200);
    expect((await one(Patient, main.id)).abha.number).toBe(abha.number);
  });
});

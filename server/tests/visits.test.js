// Feature 8: visits (vital signs, the doctor's details, care-plan items done at the visit), prescriptions, and
// each prescriber's print design. Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India; the sample
// patient's scan EDD is 1 Mar 2027, so she is 18 w 0 d today (the anomaly scan and the booking items are due).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { Visit } from '../src/models/Visit.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { PCPNDT_MESSAGE } from '../src/utils/pcpndt.js';
import * as rx from '../src/visits/rxCodes.js';
import * as website from '../../client/src/pages/visits/rxFormat.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };

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
  hospital = await createTenant('Visits Hospital');
  other = await createTenant('Other Visits Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}`, professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: `REG-${key}`, council: 'Sample Council' } });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
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
      fullName: 'Visit Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
      ...overrides,
    }),
  );
  expect(res.status).toBe(201);
  return res.body.patient;
}

const url = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
async function newVisit(who, p, body = {}) {
  const res = await (await as(who)).post(url(p)).send({ clientRequestId: randomUUID(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.visit;
}
const patch = async (who, p, v, body) => (await as(who)).patch(url(p, `/${v.id}`)).send(body);
const putRx = async (who, p, v, body) => (await as(who)).put(url(p, `/${v.id}/prescription`)).send(body);
const getVisit = async (who, p, v) => (await as(who)).get(url(p, `/${v.id}`));

const VITALS = { weightKg: 58, bpSystolic: 110, bpDiastolic: 70, pulse: 82, temperatureF: 98.6, urineAlbumin: 'nil' };
const DETAILS = { complaints: 'Mild nausea', diagnosis: 'Normal pregnancy', advice: 'Rest well', privateNote: 'Watch the BP', nextVisitOn: '2026-10-19' };
const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };

describe('a visit', () => {
  it('a nurse starts it and records the vital signs; the doctor writes the details', async () => {
    const p = await register();
    const clientRequestId = randomUUID();
    const created = await (await as('nurse')).post(url(p)).send({ clientRequestId });
    expect(created.status).toBe(201);
    const v = created.body.visit;
    expect(v).toMatchObject({ visitOn: '2026-09-28T00:00:00.000Z', careType: 'antenatal', status: 'active', createdByName: 'Sample nurse' });
    expect(v.vitals.rev).toBe(0);
    // the same request again: the same visit
    const again = await (await as('nurse')).post(url(p)).send({ clientRequestId });
    expect(again.status).toBe(200);
    expect(again.body.visit.id).toBe(v.id);

    const vitals = await patch('nurse', p, v, { vitals: { rev: 0, ...VITALS } });
    expect(vitals.status, JSON.stringify(vitals.body)).toBe(200);
    expect(vitals.body.visit.vitals).toMatchObject({ ...VITALS, urineSugar: '', rev: 1, byName: 'Sample nurse' });
    expect((await patch('nurse', p, v, { details: { rev: 0, ...DETAILS } })).status).toBe(403);

    const details = await patch('drA', p, v, { details: { rev: 0, ...DETAILS } });
    expect(details.status, JSON.stringify(details.body)).toBe(200);
    expect(details.body.visit.details).toMatchObject({ complaints: 'Mild nausea', privateNote: 'Watch the BP', nextVisitOn: '2026-10-19T00:00:00.000Z', rev: 1 });

    // the private note: not for nurses
    expect((await getVisit('nurse', p, v)).body.visit.details.privateNote).toBeUndefined();
    expect((await getVisit('drB', p, v)).body.visit.details.privateNote).toBe('Watch the BP'); // read-only doctor
    const list = await (await as('nurse')).get(url(p));
    expect(list.body).toMatchObject({ canCreate: true, canEdit: false });
    expect(list.body.visits[0]).toMatchObject({ bp: '110/70', weightKg: 58, diagnosis: 'Normal pregnancy', medicineCount: 0 });
    expect(list.body.visits[0].hasPrivateNote).toBeUndefined();

    const entries = await AuditLog.find({ action: { $in: ['VISIT_CREATED', 'VISIT_UPDATED'] } }).sort({ createdAt: 1 });
    expect(entries.map((e) => [e.action, e.details.sections ?? null])).toEqual([
      ['VISIT_CREATED', null],
      ['VISIT_UPDATED', ['vitals']],
      ['VISIT_UPDATED', ['details']],
    ]);
    expect(entries[2].details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, sections: ['details'] });
    expect(safeAuditDetails('VISIT_UPDATED', { ...entries[2].details, advice: 'x' })).toEqual(entries[2].details);
  });

  it('saves different parts side by side, but refuses a part saved meanwhile', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    expect((await patch('nurse', p, v, { vitals: { rev: 0, weightKg: 58 } })).status).toBe(200);
    const stale = await patch('rmo', p, v, { vitals: { rev: 0, weightKg: 59 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/Sample nurse saved the vital signs at 11:30/);
    expect((await patch('drA', p, v, { details: { rev: 0, diagnosis: 'G1 at 18 weeks' } })).status).toBe(200);
    expect((await Visit.findOne({ _id: v.id, tenantId: hospital._id })).vitals.weightKg).toBe(58);
  });

  it('checks the values, the dates and the words', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const bp = await patch('drA', p, v, { vitals: { rev: 0, bpSystolic: 120 } });
    expect(bp.body.error.fields['vitals.bpDiastolic']).toMatch(/both numbers/);
    expect((await patch('drA', p, v, { vitals: { rev: 0, bpSystolic: 80, bpDiastolic: 90 } })).body.error.fields['vitals.bpDiastolic']).toMatch(/below the upper/);
    expect((await patch('drA', p, v, { vitals: { rev: 0, temperatureF: 120 } })).body.error.fields['vitals.temperatureF']).toMatch(/too high/);
    const next = await patch('drA', p, v, { details: { rev: 0, nextVisitOn: '2026-09-28' } });
    expect(next.body.error.fields['details.nextVisitOn']).toMatch(/after this visit/);
    expect((await patch('drA', p, v, { details: { rev: 0, fetalSex: 'x' } })).status).toBe(400);
    const sex = await patch('drA', p, v, { details: { rev: 0, advice: 'Parents asked if it is a boy' } });
    expect(sex.body.error.fields['details.advice']).toBe(PCPNDT_MESSAGE);
    expect((await patch('drA', p, v, {})).status).toBe(400);
    const future = await (await as('drA')).post(url(p)).send({ clientRequestId: randomUUID(), visitOn: '2026-09-29' });
    expect(future.body.error.fields.visitOn).toMatch(/future/);
    const past = await newVisit('drA', p, { visitOn: '2026-09-01' });
    expect(past.visitOn).toBe('2026-09-01T00:00:00.000Z');
  });

  it('allows the words for a newborn (her sex is recorded after birth)', async () => {
    const mother = await register();
    const baby = (
      await (await as('drA')).post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Visit Mother', newborn: { birthAt: '2026-09-27T10:00:00Z', birthWeightGrams: 3000, sex: 'female', mother: mother.id } })
    ).body.patient;
    const v = await newVisit('drA', baby);
    expect((await patch('drA', baby, v, { details: { rev: 0, examination: 'Healthy female newborn, active' } })).status).toBe(200);
  });

  it('follows the patient access rules', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    for (const who of ['reception', 'lab', 'admin']) expect((await (await as(who)).get(url(p))).status, who).toBe(403);
    expect((await (await as('drB')).get(url(p))).body).toMatchObject({ canCreate: false, canEdit: false });
    expect((await (await as('drB')).post(url(p)).send({ clientRequestId: randomUUID() })).status).toBe(403);
    expect((await patch('drB', p, v, { vitals: { rev: 0, weightKg: 60 } })).status).toBe(403);
    expect((await (await as('outsider')).get(url(p))).status).toBe(404);
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await (await as('nurse')).get(url(p))).status).toBe(403);
    expect((await (await as('nurse')).post(url(p)).send({ clientRequestId: randomUUID() })).status).toBe(403);
    const record = await (await as('drA')).get(`/api/patients/${p.id}`);
    expect(record.body.patient.access).toMatchObject({ canViewVisits: true, canRecordVitals: true, canEditVisits: true, canViewVisitNotes: true });
  });

  it('can be marked as entered in error, and is then kept but no longer changed', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    expect((await (await as('nurse')).post(url(p, `/${v.id}/cancel`)).send({ reason: 'Wrong patient' })).status).toBe(403);
    expect((await (await as('drA')).post(url(p, `/${v.id}/cancel`)).send({ reason: 'no' })).status).toBe(400);
    const res = await (await as('drA')).post(url(p, `/${v.id}/cancel`)).send({ reason: 'Wrong patient' });
    expect(res.status).toBe(200);
    expect(res.body.visit).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Wrong patient', byName: 'Sample drA' } });
    expect((await patch('drA', p, v, { vitals: { rev: 0, weightKg: 60 } })).status).toBe(409);
    expect((await putRx('drA', p, v, { rev: 0, items: [FOLIC] })).status).toBe(409);
    expect((await (await as('drA')).post(url(p, `/${v.id}/printed`)).send({})).status).toBe(409);
    expect((await (await as('drA')).get(url(p))).body.visits[0]).toMatchObject({ status: 'cancelled', cancelledReason: 'Wrong patient' });
  });
});

describe('the prescription', () => {
  it('is written by the treating doctor or an RMO, and prints in the prescriber’s design', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    const res = await putRx('drA', p, v, { rev: 0, items: [FOLIC, { drug: 'Calcium carbonate + vitamin D3', frequency: '1-0-1', durationUnit: 'till_delivery' }], notes: 'Take iron and calcium 2 hours apart' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.visit.prescription).toMatchObject({ rev: 1, byName: 'Sample drA', notes: 'Take iron and calcium 2 hours apart' });
    expect(res.body.visit.prescription.items).toHaveLength(2);
    expect(res.body.visit.prescription.items[0]).toMatchObject({ ...FOLIC, frequencyText: '', route: '', instructions: '' });
    expect(res.body.visit.prescription.items[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.visit.prescription.items[1]).toMatchObject({ form: 'tab', dose: '', durationValue: null, durationUnit: 'till_delivery' });
    expect(res.body.prescriber).toMatchObject({
      name: 'Sample drA',
      professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'REG-drA', council: 'Sample Council' },
      design: { design: 'classic', accent: 'indigo', language: 'mr', paper: 'A4', saved: false },
    });

    for (const who of ['nurse', 'drB']) expect((await putRx(who, p, v, { rev: 1, items: [FOLIC] })).status, who).toBe(403);
    const byRmo = await putRx('rmo', p, v, { rev: 1, items: [FOLIC] });
    expect(byRmo.status).toBe(200);
    expect(byRmo.body.prescriber.name).toBe('Sample rmo');
    expect((await putRx('drA', p, v, { rev: 1, items: [] })).status).toBe(409); // the RMO saved meanwhile

    const entry = await AuditLog.findOne({ action: 'PRESCRIPTION_UPDATED' });
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id });
    // printing: anyone who can see the visit
    expect((await (await as('nurse')).post(url(p, `/${v.id}/printed`)).send({})).status).toBe(200);
    expect((await AuditLog.findOne({ action: 'PRESCRIPTION_PRINTED' })).details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, access: 'clinical' });
  });

  it('is signed by the doctor who wrote it: the prescription, else the doctor’s notes – nobody before', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    expect((await patch('nurse', p, v, { vitals: { rev: 0, weightKg: 58 } })).status).toBe(200);
    expect((await getVisit('nurse', p, v)).body.prescriber).toBeNull();
    expect((await patch('rmo', p, v, { details: { rev: 0, advice: 'Rest on the left side' } })).status).toBe(200);
    expect((await getVisit('nurse', p, v)).body.prescriber).toMatchObject({ id: people.rmo._id.toString(), name: 'Sample rmo' });
    expect((await putRx('drA', p, v, { rev: 0, items: [FOLIC] })).status).toBe(200);
    expect((await getVisit('nurse', p, v)).body.prescriber).toMatchObject({ id: people.drA._id.toString(), name: 'Sample drA' });
  });

  it('records each printout and PDF: the prescription, or the visit summary when no medicines were given', async () => {
    const p = await register();
    const v = await newVisit('nurse', p);
    const printed = async (who, body) => (await as(who)).post(url(p, `/${v.id}/printed`)).send(body);
    expect((await patch('nurse', p, v, { vitals: { rev: 0, weightKg: 58 } })).status).toBe(200);
    const nothing = await printed('nurse', { copy: 'summary' });
    expect(nothing.status).toBe(409); // nobody has written anything to sign yet
    expect(nothing.body.error.message).toMatch(/Nothing to print yet/);
    expect((await patch('drA', p, v, { details: { rev: 0, advice: 'Rest on the left side' } })).status).toBe(200);
    const noMedicines = await printed('drA', {}); // the prescription, on paper
    expect(noMedicines.status).toBe(400);
    expect(noMedicines.body.error.message).toMatch(/visit summary/);
    expect((await printed('drA', { copy: 'summary' })).status).toBe(200);
    expect((await printed('nurse', { copy: 'summary', as: 'pdf' })).status).toBe(200);
    expect((await putRx('drA', p, v, { rev: 0, items: [FOLIC] })).status).toBe(200);
    expect((await printed('drA', { as: 'pdf' })).status).toBe(200);
    expect((await printed('drA', { as: 'whatsapp' })).status).toBe(200);
    expect((await printed('drA', { copy: 'letter' })).status).toBe(400);
    expect((await printed('drA', { copy: 'summary', to: 'reception' })).status).toBe(400); // unknown field
    const entries = await AuditLog.find({ action: /_PRINTED$|_PDF_SAVED$/ }).sort({ _id: 1 });
    expect(entries.map((e) => e.action)).toEqual(['VISIT_SUMMARY_PRINTED', 'VISIT_SUMMARY_PDF_SAVED', 'PRESCRIPTION_PDF_SAVED', 'PRESCRIPTION_PDF_SAVED']);
    expect(entries[1].details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, access: 'clinical' });
    expect(safeAuditDetails('VISIT_SUMMARY_PDF_SAVED', { ...entries[1].details, advice: 'Rest' })).toEqual(entries[1].details);
    // saved to send on WhatsApp: said so – never with the phone number
    expect(entries[3].details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, access: expect.any(String), via: 'whatsapp' });
  });

  it('checks every medicine', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const bad = await putRx('drA', p, v, {
      rev: 0,
      items: [
        { drug: '', frequency: '1-0-0' },
        { drug: 'Paracetamol', frequency: 'custom' },
        { drug: 'Iron', frequency: '1-0-0', durationValue: 30 },
        { drug: 'Iron', frequency: '1-0-0', durationUnit: 'days' },
        { drug: 'Iron', frequency: 'hourly' },
        { drug: 'Iron', frequency: '1-0-0', brand: 'x' },
      ],
    });
    expect(bad.status).toBe(400);
    const f = bad.body.error.fields;
    expect(f['items.0.drug']).toMatch(/Enter the medicine/);
    expect(f['items.1.frequencyText']).toMatch(/how often/);
    expect(f['items.2.durationUnit']).toMatch(/days, weeks or months/);
    expect(f['items.3.durationValue']).toMatch(/how many/);
    expect(f['items.4.frequency']).toMatch(/how often/);
    expect(f.items?.[5] ?? f['items.5']).toBeTruthy();
    const sex = await putRx('drA', p, v, { rev: 0, items: [{ ...FOLIC, instructions: 'for the girl child' }] });
    expect(sex.body.error.fields['items.0.instructions']).toBe(PCPNDT_MESSAGE);
  });

  it('offers the latest earlier prescription to copy', async () => {
    const p = await register();
    const first = await newVisit('drA', p, { visitOn: '2026-09-01' });
    await putRx('drA', p, first, { rev: 0, items: [FOLIC], notes: 'Continue' });
    const second = await newVisit('drA', p);
    const page = await getVisit('drA', p, second);
    expect(page.body.previousPrescription).toMatchObject({ visitOn: '2026-09-01T00:00:00.000Z', notes: 'Continue' });
    expect(page.body.previousPrescription.items[0]).toMatchObject(FOLIC);
    expect((await getVisit('drA', p, first)).body.previousPrescription).toBeNull();
  });
});

describe('the care plan at a visit', () => {
  it('ticks items done at the visit, on its date, and records which visit', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const page = (await getVisit('drA', p, v)).body;
    const plan = page.carePlan;
    expect(plan).toMatchObject({ canTick: true, label: 'Draft – not approved for clinical use', doneHere: [] });
    const booking = plan.dueNow.find((i) => i.kind === 'visit');
    const anomaly = plan.dueNow.find((i) => i.name.startsWith('Anomaly scan'));
    expect(booking).toBeTruthy();
    expect(anomaly).toMatchObject({ status: 'due' });
    expect(plan.nextVisits[0].kind).toBe('visit');
    expect(plan.upcoming.every((i) => !['visit', 'advice'].includes(i.kind))).toBe(true);
    expect(plan.upcoming.length).toBeGreaterThan(0);

    expect((await patch('nurse', p, v, { doneItems: [{ id: booking.id, rev: booking.rev }] })).status).toBe(403);
    const res = await patch('drA', p, v, { doneItems: [{ id: booking.id, rev: booking.rev }, { id: anomaly.id, rev: anomaly.rev }], details: { rev: 0, diagnosis: 'Normal' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.carePlan.doneHere.map((i) => i.id).sort()).toEqual([booking.id, anomaly.id].sort());
    const stored = await CarePlan.findOne({ tenantId: hospital._id, patientId: p.id, current: true });
    const item = stored.items.find((i) => String(i._id) === anomaly.id);
    expect(item.state).toBe('done');
    expect(item.done).toMatchObject({ via: 'visit', byName: 'Sample drA' });
    expect(String(item.done.visitId)).toBe(v.id);
    expect(item.done.on.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    const entry = await AuditLog.findOne({ action: 'CARE_PLAN_CHANGED', 'details.change': 'items_done_at_visit' });
    expect(entry.details).toMatchObject({ patientId: p.id, mrn: p.mrn, visitId: v.id });
    expect(entry.details.itemId).toBeUndefined();
  });

  it('saves nothing when an item changed meanwhile', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const anomaly = (await getVisit('drA', p, v)).body.carePlan.dueNow.find((i) => i.name.startsWith('Anomaly scan'));
    const res = await patch('drA', p, v, { doneItems: [{ id: anomaly.id, rev: anomaly.rev + 1 }], details: { rev: 0, diagnosis: 'Normal' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_CONFLICT');
    expect((await Visit.findOne({ _id: v.id, tenantId: hospital._id })).details.diagnosis).toBe('');
  });

  it('lists for the printout only what is still to come; overdue items are only counted', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const anomaly = (await getVisit('drA', p, v)).body.carePlan.dueNow.find((i) => i.name.startsWith('Anomaly scan'));
    expect(anomaly).toMatchObject({ status: 'due' });
    // Six weeks on (24 weeks) the anomaly scan is overdue. A fresh login: sessions end after 30 idle minutes.
    vi.setSystemTime(new Date(NOW.getTime() + 42 * 86_400_000));
    sessions = {};
    const plan = (await getVisit('drA', p, await newVisit('drA', p))).body.carePlan;
    expect(plan.dueNow.find((i) => i.id === anomaly.id)).toMatchObject({ status: 'overdue' });
    expect(plan.upcoming.some((i) => i.id === anomaly.id)).toBe(false);
    expect(plan.upcoming.every((i) => ['due', 'upcoming'].includes(i.status))).toBe(true);
    expect(plan.overdue).toBeGreaterThan(0);
  });

  it('is left out for patients without an antenatal plan', async () => {
    const gyn = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Gyn Visit' }))).body.patient;
    const v = await newVisit('drA', gyn);
    expect((await getVisit('drA', gyn, v)).body.carePlan).toBeNull();
  });
});

describe('the print design', () => {
  const DESIGN = {
    design: 'dose_chart',
    accent: 'teal',
    textSize: 'large',
    paper: 'A4',
    language: 'hi',
    capitals: false,
    show: Object.fromEntries(rx.RX_SHOW.map((k) => [k, k !== 'complaints'])),
    specialities: 'Obstetrics & Gynaecology · Infertility',
    timings: 'Mon–Sat 10:00–14:00',
    footerNote: 'Bring this prescription to every visit.',
    marginTopMm: 50,
    marginBottomMm: 25,
  };

  it('is each prescriber’s own, per hospital', async () => {
    const d = await as('drA');
    expect((await d.get('/api/prescription-design')).body.design).toMatchObject({ design: 'classic', saved: false, language: 'mr' });
    const saved = await d.put('/api/prescription-design').send(DESIGN);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.design).toMatchObject({ ...DESIGN, saved: true });
    expect((await d.get('/api/prescription-design')).body.design.accent).toBe('teal');
    expect((await (await as('rmo')).get('/api/prescription-design')).body.design.saved).toBe(false);
    for (const who of ['nurse', 'reception']) expect((await (await as(who)).get('/api/prescription-design')).status, who).toBe(403);
    const half = await d.put('/api/prescription-design').send({ ...DESIGN, design: 'half_page', paper: 'A4' });
    expect(half.body.design.paper).toBe('A5');
    expect((await d.put('/api/prescription-design').send({ ...DESIGN, design: 'fancy' })).status).toBe(400);
    expect((await d.put('/api/prescription-design').send({ ...DESIGN, marginTopMm: 500 })).status).toBe(400);
    // a visit prints in the prescriber's design
    const p = await register();
    const v = await newVisit('drA', p);
    const res = await putRx('drA', p, v, { rev: 0, items: [FOLIC] });
    expect(res.body.prescriber.design).toMatchObject({ design: 'half_page', accent: 'teal', saved: true });
  });

  it('keeps the fine-tuning: font, sizes in points, line spacing, side margins and own section titles', async () => {
    const d = await as('drA');
    const fine = { font: 'serif', bodyPt: 11.5, medicinePt: 13, doctorPt: 20, lineSpacing: 'relaxed', marginSideMm: 18, titles: { medicines: 'Rx', instructions: '', tests: 'Investigations', advice: 'Diet & advice', nextVisit: 'Review' } };
    const saved = await d.put('/api/prescription-design').send({ ...DESIGN, ...fine });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.design).toMatchObject(fine);
    // left out: as the design prints it
    const plain = await d.put('/api/prescription-design').send(DESIGN);
    expect(plain.body.design).toMatchObject({ font: 'standard', bodyPt: null, lineSpacing: 'standard', marginSideMm: null, titles: { tests: '' } });
    for (const bad of [{ bodyPt: 40 }, { font: 'comic' }, { marginSideMm: 5.5 }, { titles: { ...fine.titles, advice: 'x'.repeat(41) } }, { titles: { other: 'x' } }]) {
      expect((await d.put('/api/prescription-design').send({ ...DESIGN, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("offers the prescriber's own recent medicines, as they last wrote them", async () => {
    const p = await register();
    const a = await newVisit('drA', p, { visitOn: '2026-09-01' });
    await putRx('drA', p, a, { rev: 0, items: [{ ...FOLIC, durationValue: 15 }, { drug: 'Doxylamine + pyridoxine', frequency: '0-0-1' }] });
    const b = await newVisit('drA', p);
    await putRx('drA', p, b, { rev: 0, items: [FOLIC] });
    const res = await (await as('drA')).get('/api/prescription-design/recent-medicines');
    expect(res.status).toBe(200);
    expect(res.body.medicines[0]).toMatchObject({ ...FOLIC, count: 2 }); // the latest way: 30 days
    expect(res.body.medicines.map((m) => m.drug)).toContain('Doxylamine + pyridoxine');
    expect((await (await as('rmo')).get('/api/prescription-design/recent-medicines')).body.medicines).toEqual([]);
  });
});

describe('the website uses the same codes', () => {
  it('for forms, how often, when, how long, measurements and designs', () => {
    expect(website.RX_FORMS).toEqual(rx.RX_FORMS);
    expect(website.RX_FREQUENCIES).toEqual(rx.RX_FREQUENCIES);
    expect(website.RX_TIMINGS).toEqual(rx.RX_TIMINGS);
    expect(website.RX_ROUTES).toEqual(rx.RX_ROUTES);
    expect(website.RX_DURATION_UNITS).toEqual(rx.RX_DURATION_UNITS);
    expect(website.URINE_GRADES).toEqual(rx.URINE_GRADES);
    expect(website.PRESENTATIONS).toEqual(rx.PRESENTATIONS);
    expect(website.FETAL_MOVEMENTS).toEqual(rx.FETAL_MOVEMENTS);
    expect(website.OEDEMA_GRADES).toEqual(rx.OEDEMA_GRADES);
    expect(website.RX_DESIGNS).toEqual(rx.RX_DESIGNS);
    expect(website.RX_ACCENTS).toEqual(rx.RX_ACCENTS);
    expect(website.RX_SHOW).toEqual(rx.RX_SHOW);
    expect(website.RX_FONTS).toEqual(rx.RX_FONTS);
    expect(website.RX_LINE_SPACINGS).toEqual(rx.RX_LINE_SPACINGS);
    expect(website.RX_TITLES).toEqual(rx.RX_TITLES);
  });
});

describe('signing and finishing a visit', () => {
  const sign = async (who, p, v, revs) => (await as(who)).post(url(p, `/${v.id}/sign`)).send({ revs });
  const add = async (who, p, v, text) => (await as(who)).post(url(p, `/${v.id}/additions`)).send({ text });
  const revsOf = (visit) => ({ vitals: visit.vitals.rev, details: visit.details.rev, prescription: visit.prescription.rev });

  async function writtenVisit() {
    const p = await register();
    const v = await newVisit('nurse', p);
    await patch('nurse', p, v, { vitals: { rev: 0, ...VITALS } });
    await patch('drA', p, v, { details: { rev: 0, ...DETAILS } });
    const res = await putRx('drA', p, v, { rev: 0, items: [FOLIC], notes: '' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { p, v: res.body.visit, page: res.body };
  }

  it('the treating doctor signs: the visit is locked for everyone', async () => {
    const { p, v, page } = await writtenVisit();
    expect(page.access).toMatchObject({ canEdit: true, canSign: true, canAddAddition: false });
    const res = await sign('drA', p, v, revsOf(v));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.visit.signed).toMatchObject({ byName: 'Sample drA', role: 'doctor', at: NOW.toISOString() });
    expect(res.body.access).toMatchObject({ canEdit: false, canRecordVitals: false, canSign: false, canAddAddition: true, canCancel: true });

    const vitals = await patch('nurse', p, v, { vitals: { rev: 1, weightKg: 60 } });
    expect(vitals.status).toBe(409);
    expect(vitals.body.error.code).toBe('VISIT_SIGNED');
    expect((await patch('drA', p, v, { details: { rev: 1, diagnosis: 'Changed' } })).status).toBe(409);
    expect((await putRx('rmo', p, v, { rev: 1, items: [], notes: '' })).status).toBe(409);
    expect((await sign('rmo', p, v, revsOf(v))).status).toBe(409); // signed once only

    const saved = await Visit.findOne({ _id: v.id, tenantId: hospital._id });
    expect(saved.details.diagnosis).toBe('Normal pregnancy');
    expect(saved.prescription.items).toHaveLength(1);
    expect(saved.signed.revs).toMatchObject({ vitals: 1, details: 1, prescription: 1 });
    expect((await (await as('nurse')).get(url(p))).body.visits[0].signed).toMatchObject({ byName: 'Sample drA' });
  });

  it('signs only the version the doctor saw, and only once something is written', async () => {
    const p = await register();
    const empty = await newVisit('nurse', p);
    const nothing = await sign('drA', p, empty, revsOf(empty));
    expect(nothing.status).toBe(409);
    expect(nothing.body.error.code).toBe('NOTHING_TO_SIGN');

    const written = await writtenVisit();
    await patch('nurse', written.p, written.v, { vitals: { rev: 1, weightKg: 61 } }); // saved after the doctor opened it
    const stale = await sign('drA', written.p, written.v, revsOf(written.v));
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/Sample nurse saved the vital signs/);
    expect((await Visit.findOne({ _id: written.v.id, tenantId: hospital._id })).signed).toBeNull();
  });

  it('nurses, reception and read-only doctors cannot sign; an RMO can', async () => {
    const { p, v } = await writtenVisit();
    expect((await sign('nurse', p, v, revsOf(v))).status).toBe(403);
    expect((await sign('reception', p, v, revsOf(v))).status).toBe(403);
    expect((await sign('drB', p, v, revsOf(v))).status).toBe(403);
    const res = await sign('rmo', p, v, revsOf(v));
    expect(res.status).toBe(200);
    expect(res.body.visit.signed.role).toBe('rmo');
  });

  it('corrections are added below a signed visit and kept, with who and when', async () => {
    const { p, v } = await writtenVisit();
    expect((await add('drA', p, v, 'BP was 120/80')).body.error.code).toBe('NOT_SIGNED');
    await sign('drA', p, v, revsOf(v));
    const first = await add('nurse', p, v, 'Weight re-checked: 58.5 kg');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await add('drA', p, v, 'Correction: advice also includes iron-rich food');
    expect(second.body.visit.additions.map((x) => [x.text, x.byName])).toEqual([
      ['Weight re-checked: 58.5 kg', 'Sample nurse'],
      ['Correction: advice also includes iron-rich food', 'Sample drA'],
    ]);
    expect((await add('drB', p, v, 'Not allowed')).status).toBe(403);
    expect((await add('drA', p, v, '  ')).status).toBe(400);
    expect((await add('drA', p, v, 'The baby is a boy')).status).toBe(400); // PCPNDT
  });

  it('a signed visit can still be printed and marked entered in error', async () => {
    const { p, v } = await writtenVisit();
    await sign('drA', p, v, revsOf(v));
    expect((await (await as('drA')).post(url(p, `/${v.id}/printed`)).send({ copy: 'prescription', as: 'paper' })).status).toBe(200);
    const cancel = await (await as('drA')).post(url(p, `/${v.id}/cancel`)).send({ reason: 'Wrong patient selected' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.access.canAddAddition).toBe(false);
  });

  it('the history lists who saved, signed, corrected and printed – never what was written', async () => {
    const { p, v } = await writtenVisit();
    await sign('drA', p, v, revsOf(v));
    await add('nurse', p, v, 'Weight re-checked: 58.5 kg');
    await getVisit('drB', p, v); // views are not listed
    const res = await (await as('nurse')).get(url(p, `/${v.id}/history`));
    expect(res.status).toBe(200);
    expect(res.body.history.map((h) => [h.action, h.byName, h.sections ?? null])).toEqual([
      ['VISIT_CREATED', 'Sample nurse', null],
      ['VISIT_UPDATED', 'Sample nurse', ['vitals']],
      ['VISIT_UPDATED', 'Sample drA', ['details']],
      ['PRESCRIPTION_UPDATED', 'Sample drA', null],
      ['VISIT_SIGNED', 'Sample drA', null],
      ['VISIT_ADDITION_ADDED', 'Sample nurse', null],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/58\.5|Folic|nausea/);
    expect((await (await as('reception')).get(url(p, `/${v.id}/history`))).status).toBe(403);
  });
});

describe("the patient record's today's visit", () => {
  it('names the visit started today for those who see visits – never for reception', async () => {
    const p = await register();
    const record = async (who) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
    expect((await record('drA')).todayVisitId).toBeNull();
    await newVisit('nurse', p, { visitOn: '2026-09-20' }); // another day
    expect((await record('drA')).todayVisitId).toBeNull();
    const v = await newVisit('nurse', p);
    expect((await record('drA')).todayVisitId).toBe(v.id);
    expect((await record('nurse')).todayVisitId).toBe(v.id);
    expect('todayVisitId' in (await record('reception'))).toBe(false);
  });
});

describe('going ahead despite a medicine warning', () => {
  it('keeps the warning and the reason with the prescription; the audit log gets the count only', async () => {
    const p = await register();
    const v = await newVisit('drA', p);
    const reason = { key: 'allergy:amoxicillin', level: 'allergy', title: 'Allergy recorded: “Penicillin”', medicines: ['Amoxicillin'], reason: 'Tolerated before, test dose given' };
    const res = await putRx('drA', p, v, { rev: 0, items: [{ ...FOLIC, drug: 'Amoxicillin' }], notes: '', warningReasons: [reason] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.visit.prescription.warningReasons).toEqual([reason]);
    const entry = await AuditLog.findOne({ action: 'PRESCRIPTION_UPDATED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, warningsOverridden: 1 });

    const empty = await putRx('drA', p, v, { rev: 1, items: [FOLIC], notes: '', warningReasons: [{ ...reason, reason: ' ' }] });
    expect(empty.status).toBe(400);
    expect((await putRx('drA', p, v, { rev: 1, items: [FOLIC], notes: '', warningReasons: [{ ...reason, level: 'caution' }] })).status).toBe(400);
    const none = await putRx('drA', p, v, { rev: 1, items: [FOLIC], notes: '' });
    expect(none.body.visit.prescription.warningReasons).toEqual([]);
  });
});

describe("the patient record's last visit", () => {
  it('sums up the latest visit for those who see visits – never the private note, never for reception', async () => {
    const p = await register();
    const record = async (who) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
    expect((await record('drA')).lastVisit).toBeNull();
    await newVisit('nurse', p, { visitOn: '2026-09-01' });
    const v = await newVisit('nurse', p, { visitOn: '2026-09-20' });
    await patch('nurse', p, v, { vitals: { rev: 0, ...VITALS, hb: 10.2 } });
    await patch('drA', p, v, { details: { rev: 0, ...DETAILS } });
    await putRx('drA', p, v, { rev: 0, items: [FOLIC], notes: '' });
    const last = (await record('drA')).lastVisit;
    expect(last).toMatchObject({ id: v.id, visitOn: '2026-09-20T00:00:00.000Z', bp: '110/70', weightKg: 58, hb: 10.2, diagnosis: 'Normal pregnancy', medicines: ['Folic acid'], signed: null });
    expect(JSON.stringify(last)).not.toMatch(/Watch the BP|hasPrivateNote/);
    expect('lastVisit' in (await record('reception'))).toBe(false);
  });
});

describe('the patients list', () => {
  it('shows the last visit and red flags to those who see visits – not to reception', async () => {
    const p = await register();
    const v = await newVisit('nurse', p, { visitOn: '2026-09-20' });
    await patch('nurse', p, v, { vitals: { rev: 0, bpSystolic: 165, bpDiastolic: 112 } });
    const list = async (who) => (await (await as(who)).get('/api/patients?doctor=all')).body.patients.find((x) => x.id === p.id);
    const dr = await list('drA');
    expect(dr.lastVisitOn).toBe('2026-09-20T00:00:00.000Z');
    expect(dr.redFlags.count).toBeGreaterThan(0);
    expect(dr.redFlags.urgent).toBeGreaterThan(0);
    const rec = await list('reception');
    expect('lastVisitOn' in rec).toBe(false);
    expect('redFlags' in rec).toBe(false);
  });
});

describe('sorting the patients list by the last visit', () => {
  it('keeps each patient’s last visit day, also after a visit is cancelled, and sorts by it', async () => {
    const { Patient } = await import('../src/models/Patient.js');
    const a = await register({ fullName: 'Seen Earlier' });
    const b = await register({ fullName: 'Seen Later' });
    const c = await register({ fullName: 'Never Seen' });
    await newVisit('nurse', a, { visitOn: '2026-09-10' });
    const vb = await newVisit('nurse', b, { visitOn: '2026-09-20' });
    const list = async () => (await (await as('drA')).get('/api/patients?doctor=all&sort=-lastVisitOn')).body.patients.map((p) => p.fullName);
    expect(await list()).toEqual(['Seen Later', 'Seen Earlier', 'Never Seen']);

    await (await as('drA')).post(url(b, `/${vb.id}/cancel`)).send({ reason: 'Wrong patient selected' });
    expect((await Patient.findOne({ _id: b.id, tenantId: hospital._id }).lean()).lastVisitOn).toBeNull();
    expect((await list())[0]).toBe('Seen Earlier'); // her only visit was cancelled: Seen Later has no last visit now

    // A record saved before the field existed is filled in when the list is sorted by it
    await Patient.collection.updateOne({ _id: new (await import('mongoose')).default.Types.ObjectId(a.id) }, { $unset: { lastVisitOn: '' } });
    expect((await list())[0]).toBe('Seen Earlier');
    expect((await Patient.findOne({ _id: a.id, tenantId: hospital._id }).lean()).lastVisitOn.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(c.id).toBeTruthy();
  });
});

describe('sending the printout to the patient on WhatsApp in one click', () => {
  const PDF = Buffer.from(`%PDF-1.4\n${'sample page '.repeat(20)}\n%%EOF`).toString('base64');
  const settings = async (whatsappDocuments) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: false, whatsappDocuments });
  const agree = async (p, channel = 'whatsapp') => (await as('reception')).put(`/api/patients/${p.id}/reminder-consent`).send({ consent: true, channel, language: 'en' });
  const offer = async (who, p, v) => (await (await as(who)).get(url(p, `/${v.id}/whatsapp`))).body;
  const send = async (who, p, v, body = { copy: 'prescription', pdf: PDF }) => (await as(who)).post(url(p, `/${v.id}/whatsapp`)).send(body);
  let config;
  let sender;
  beforeEach(async () => {
    ({ config } = await import('../src/config.js'));
    sender = await import('../src/visits/whatsappSender.js');
    sender.practiceSent().length = 0;
    config.WHATSAPP_MODE = '';
  });
  afterEach(() => {
    config.WHATSAPP_MODE = '';
    vi.unstubAllGlobals();
  });

  async function visitWithRx(overrides) {
    const p = await register({ phone: '98765 43210', ...overrides });
    const v = await newVisit('drA', p);
    expect((await putRx('drA', p, v, { rev: 0, items: [FOLIC] })).status).toBe(200);
    return { p, v };
  }

  it('is off until it is set up on the server, switched on by the admin, and she agreed to WhatsApp messages', async () => {
    const { p, v } = await visitWithRx();
    expect(await offer('drA', p, v)).toEqual({ available: false, reason: 'not_set_up', practice: false });
    expect((await send('drA', p, v)).body.error.code).toBe('WHATSAPP_UNAVAILABLE');
    config.WHATSAPP_MODE = 'practice';
    expect((await offer('drA', p, v)).reason).toBe('switched_off');
    await settings(true);
    expect((await offer('drA', p, v)).reason).toBe('no_agreement');
    await agree(p, 'sms'); // agreed to SMS only: still not on WhatsApp
    expect((await offer('drA', p, v)).reason).toBe('no_agreement');
    await agree(p);
    expect(await offer('drA', p, v)).toEqual({ available: true, reason: null, practice: true });
    expect(sender.practiceSent()).toHaveLength(0);
  });

  it('practice mode: goes only to the number on her record, as a PDF named by patient number; recorded without the number', async () => {
    config.WHATSAPP_MODE = 'practice';
    await settings(true);
    const { p, v } = await visitWithRx();
    await agree(p);
    expect((await send('drA', p, v, { copy: 'prescription', pdf: PDF, to: '+911111111111' })).status).toBe(400); // the browser never chooses the number
    expect((await send('drA', p, v, { copy: 'prescription', pdf: Buffer.from('not a pdf at all, just some text that is long enough to pass the length check, and longer still').toString('base64') })).status).toBe(400);
    expect((await send('reception', p, v)).status).toBe(403);
    const res = await send('drA', p, v);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ sent: true, practice: true });
    expect(sender.practiceSent()).toEqual([{ to: '+919876543210', fileName: `Prescription-${p.mrn}-2026-09-28.pdf`, bytes: expect.any(Number), hospital: expect.any(String) }]);
    const entry = await AuditLog.findOne({ action: 'PRESCRIPTION_SENT_WHATSAPP' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, access: expect.any(String), practice: true });
    expect(JSON.stringify(entry)).not.toContain('9876543210');
    expect(safeAuditDetails('PRESCRIPTION_SENT_WHATSAPP', { ...entry.details, phone: '+919876543210' })).toEqual(entry.details);
  });

  it('live mode: uploads the PDF, then sends the approved template; a refusal is reported and nothing is recorded', async () => {
    Object.assign(config, { WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_ACCESS_TOKEN: 'sample-token', WHATSAPP_TEMPLATE: 'perinexa_document', WHATSAPP_TEMPLATE_LANG: 'en' });
    await settings(true);
    const { p, v } = await visitWithRx();
    await agree(p);
    const calls = [];
    let refuse = false;
    vi.stubGlobal('fetch', async (address, init) => {
      calls.push({ address: String(address), init });
      if (String(address).endsWith('/media')) return new Response(JSON.stringify({ id: 'MEDIA-1' }), { status: 200 });
      if (refuse) return new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    });
    const res = await send('drA', p, v);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ sent: true, practice: false });
    expect(calls.map((c) => c.address)).toEqual(['https://graph.facebook.com/v21.0/1234567890/media', 'https://graph.facebook.com/v21.0/1234567890/messages']);
    expect(calls[1].init.headers.Authorization).toBe('Bearer sample-token');
    const message = JSON.parse(calls[1].init.body);
    expect(message).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template', template: { name: 'perinexa_document', language: { code: 'en' } } });
    expect(message.template.components[0].parameters[0].document).toEqual({ id: 'MEDIA-1', filename: `Prescription-${p.mrn}-2026-09-28.pdf` });
    expect(JSON.stringify(message)).not.toContain('Visit Mother'); // her name is never in the message
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SENT_WHATSAPP' })).toBe(1);

    refuse = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await send('drA', p, v);
    errors.mockRestore();
    expect(failed.status).toBe(502);
    expect(failed.body.error.message).toMatch(/It was not sent/);
    expect(await AuditLog.countDocuments({ action: 'PRESCRIPTION_SENT_WHATSAPP' })).toBe(1);
  });
});

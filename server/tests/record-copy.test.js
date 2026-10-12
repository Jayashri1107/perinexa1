// A complete copy of one patient's record (More → "Copy of the whole record"): who may make it, what is in it,
// what is always left out, and the audit entries. Fake sample data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { ConsentForm } from '../src/models/ConsentForm.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { PatientConsent } from '../src/models/PatientConsent.js';
import { documentForCopy, labOrderForCopy, nursingEntryForCopy, patientForCopy, planForCopy, visitForCopy, workForCopy } from '../src/patients/recordCopyView.js';
import { COPY_LIMITS } from '../src/routes/recordCopy.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharmacist: 'pharmacist', admin: 'admin' };
const COPY_ACTIONS = ['PATIENT_RECORD_COPIED', 'PATIENT_RECORD_COPY_PRINTED', 'PATIENT_RECORD_COPY_PDF_SAVED'];

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
  app = createApp({ apiRateLimitMax: 100000 }); // the clock is frozen, so the minute never ends
  hospital = await createTenant('Copy Hospital');
  other = await createTenant('Other Copy Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
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
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Copy Mother',
      ageYears: 28,
      phone: '+91 98765 00001',
      address: '4 Sample Lane, Pune',
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'Penicillin', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditions: ['thyroid'], conditionsReviewed: true },
      notes: 'Record note: anxious about injections',
      ...overrides,
    }),
  );
  return ok(res, 201).patient;
}

const copyOf = async (who, p) => (await as(who)).get(`/api/patients/${p.id}/record-copy`);
const printed = async (who, p, body) => (await as(who)).post(`/api/patients/${p.id}/record-copy/printed`).send(body);
const copyEntries = () => AuditLog.find({ action: { $in: COPY_ACTIONS } }).sort({ createdAt: 1, _id: 1 });

const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };
const visits = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
const stays = (p, path = '') => `/api/patients/${p.id}/admissions${path}`;
const lab = (path) => `/api/lab/orders/${path}`;

/** A record with something of everything: visits, lab orders, a stay, consent forms, a scan, a note, a baby. */
async function fullRecord() {
  const p = await register();
  const drA = await as('drA');
  const nurse = await as('nurse');
  const rmo = await as('rmo');
  const labUser = await as('lab');

  // A visit two weeks ago: vital signs by the nurse, notes (with a private note) and a prescription by the doctor,
  // signed, then a correction below it
  const v1 = ok(await nurse.post(visits(p)).send({ clientRequestId: randomUUID(), visitOn: '2026-09-21' }), 201).visit;
  ok(await nurse.patch(visits(p, `/${v1.id}`)).send({ vitals: { rev: 0, weightKg: 58, bpSystolic: 110, bpDiastolic: 70, pulse: 82 } }));
  ok(
    await drA.patch(visits(p, `/${v1.id}`)).send({
      details: { rev: 0, complaints: 'Mild nausea', diagnosis: 'Normal pregnancy', advice: 'Rest well', privateNote: 'PRIVATE-NOTE-TEXT', fundalHeightCm: 16, nextVisitOn: '2026-10-19' },
    }),
  );
  ok(await drA.put(visits(p, `/${v1.id}/prescription`)).send({ rev: 0, items: [FOLIC], notes: 'Take after breakfast' }));
  ok(await drA.post(visits(p, `/${v1.id}/sign`)).send({ revs: { vitals: 1, details: 1, prescription: 1 } }));
  ok(await nurse.post(visits(p, `/${v1.id}/additions`)).send({ text: 'Weight re-checked: 58.5 kg' }));

  // A visit written on the wrong record: marked entered in error
  const v2 = ok(await drA.post(visits(p)).send({ clientRequestId: randomUUID() }), 201).visit;
  ok(await drA.patch(visits(p, `/${v2.id}`)).send({ details: { rev: 0, complaints: 'WRONG-PATIENT-COMPLAINT' } }));
  ok(await drA.post(visits(p, `/${v2.id}/cancel`)).send({ reason: 'Meant for Other Person ERROR-REASON-TEXT' }));

  // Lab: one order reported, reviewed, changed with a reason and reviewed again; one cancelled; one with a value
  // saved but not reported yet
  const cbc = (hb) => [{ key: 'cbc', values: [{ key: 'hb', value: hb }, { key: 'tlc', value: '8000' }, { key: 'platelets', value: '2.1' }] }];
  let o1 = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }], noteToLab: 'Fasting not needed' }), 201).order;
  o1 = ok(await labUser.post(lab(`${o1.id}/collect`)).send({ rev: o1.rev })).order;
  // (the sample was taken an hour before the report – the clock is frozen, and a sample time equal to the report's
  // means "stamped by the report")
  await LabOrder.updateOne({ tenantId: hospital._id, _id: o1.id }, { $set: { 'collected.at': new Date(NOW.getTime() - 60 * 60 * 1000) } });
  o1 = ok(await labUser.put(lab(`${o1.id}/results`)).send({ rev: o1.rev, tests: cbc('9.5'), labNote: 'Sample slightly haemolysed', report: true })).order;
  o1 = ok(await drA.post(lab(`${o1.id}/review`)).send({ rev: o1.rev, comment: 'Iron started' })).order;
  o1 = ok(await labUser.put(lab(`${o1.id}/results`)).send({ rev: o1.rev, tests: cbc('9.8'), labNote: 'Sample slightly haemolysed', reason: 'Typing mistake corrected' })).order;
  o1 = ok(await drA.post(lab(`${o1.id}/review`)).send({ rev: o1.rev, comment: 'Seen again' })).order;
  const o2 = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'other', name: 'CANCELLED-TEST-NAME' }] }), 201).order;
  ok(await drA.post(lab(`${o2.id}/cancel`)).send({ rev: o2.rev, reason: 'CANCEL-REASON-TEXT ordered for another patient' }));
  const o3 = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] }), 201).order;
  ok(await labUser.put(lab(`${o3.id}/results`)).send({ rev: o3.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '7.7' }] }] }));

  // An emergency treatment note by a doctor who is not her doctor
  ok(await (await as('drB')).post(`/api/patients/${p.id}/emergency-notes`).send({ reason: 'Fainted in the OPD, her doctor was in theatre', text: 'IV fluids given, observed for an hour' }), 201);

  // A stay: a signed admission note with a correction, a round note still a draft, an operation note entered in
  // error, and the nursing chart (one entry entered in error)
  const a = ok(await drA.post(stays(p)).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-04T02:00:00.000Z', ward: 'Ward 2', bed: '7', reason: 'Observation for vomiting' }), 201).admission;
  const doc = async (kind, content) => {
    const d = ok(await rmo.post(stays(p, `/${a.id}/documents`)).send({ clientRequestId: randomUUID(), kind }), 201).document;
    return ok(await rmo.put(stays(p, `/${a.id}/documents/${d.id}`)).send({ rev: d.rev, content })).document;
  };
  const admission = await doc('admission', { reason: 'Observation for vomiting', history: 'Vomiting for two days', provisionalDiagnosis: 'Hyperemesis', plan: 'IV fluids' });
  ok(await rmo.post(stays(p, `/${a.id}/documents/${admission.id}/sign`)).send({ rev: admission.rev }));
  ok(await nurse.post(stays(p, `/${a.id}/documents/${admission.id}/additions`)).send({ text: 'Urine ketones 2+ at admission' }));
  await doc('round', { at: '2026-10-05T03:00:00.000Z', assessment: 'DRAFT-ROUND-TEXT', plan: 'Continue' });
  const wrong = await doc('operation', { performedAt: '2026-10-04T05:00:00.000Z', procedure: 'CANCELLED-DOCUMENT-TEXT' });
  ok(await drA.post(stays(p, `/${a.id}/documents/${wrong.id}/cancel`)).send({ reason: 'DOCUMENT-ERROR-REASON wrong patient' }));
  const chart = async (body) => ok(await nurse.post(stays(p, `/${a.id}/nursing`)).send({ clientRequestId: randomUUID(), ...body }), 201);
  await chart({ kind: 'vitals', vitals: { bpSystolic: 118, bpDiastolic: 76, pulse: 90 } });
  await chart({ kind: 'note', note: 'Tolerating fluids' });
  const page = await chart({ kind: 'medicine', medicine: { drug: 'Inj WRONGDRUG', dose: '1 amp', route: 'IV' } });
  const entry = page.nursing.find((e) => e.kind === 'medicine');
  ok(await nurse.post(stays(p, `/${a.id}/nursing/${entry.id}/cancel`)).send({ reason: 'NURSING-ERROR-REASON wrong chart' }));

  // Consent forms: one printed and signed, an information sheet printed, and a printout of a form that Perinexa
  // no longer has (kept in the database, never listed)
  ok(await drA.get(`/api/patients/${p.id}/consents`)); // the library is created on first use
  const form = async (key) => {
    const f = await ConsentForm.findOne({ tenantId: hospital._id, key });
    return { formId: String(f._id), version: f.version };
  };
  const consent = ok(await drA.post(`/api/patients/${p.id}/consents`).send({ clientRequestId: randomUUID(), language: 'mr', ...(await form('procedure')), procedure: 'TYPED-PROCEDURE-TEXT', reason: 'TYPED-REASON-TEXT' }), 201).consent;
  ok(await nurse.post(`/api/patients/${p.id}/consents/${consent.id}/signed`).send({ signedOn: '2026-10-05', witness: 'WITNESS-NAME-TEXT', keptAt: 'Paper file' }));
  ok(await drA.post(`/api/patients/${p.id}/consents`).send({ clientRequestId: randomUUID(), language: 'en', ...(await form('info_anaemia')) }), 201);
  await PatientConsent.create({
    tenantId: hospital._id,
    patientId: p.id,
    formId: consent.formId,
    formKey: 'ultrasound_pregnancy',
    formVersion: 1,
    formApproved: false,
    title: 'RETIRED-FORM-TITLE',
    language: 'en',
    clientRequestId: randomUUID(),
    printedBy: people.drA._id,
    printedByName: 'Sample drA',
    printedAt: new Date('2026-09-01T05:00:00Z'),
  });

  // A scan done, and one recorded by mistake
  const work = ok(await drA.get(`/api/patients/${p.id}/work-done`));
  const [first, second] = work.items;
  ok(await drA.post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: first.id }), 201);
  const mistaken = ok(await drA.post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: second.id }), 201).work;
  ok(await drA.post(`/api/patients/${p.id}/work-done/${mistaken.id}/cancel`).send({ reason: 'WORK-ERROR-REASON' }));

  // Her baby, a patient of its own
  const baby = ok(
    await drA.post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Copy Mother', newborn: { birthAt: '2026-10-04T08:00:00.000Z', birthWeightGrams: 3050, sex: 'female', mother: p.id }, registerAnyway: true }),
    201,
  ).patient;
  return { p, baby, v1, v2, o1, a, workNames: [first.name, second.name] };
}

describe('who may make a copy of the whole record', () => {
  it("only her doctor or an RMO: never reception, nurses, the lab, the pharmacist, an admin or another doctor; another hospital's patient is not found", async () => {
    const p = await register();
    for (const who of ['drA', 'rmo']) {
      const res = await copyOf(who, p);
      expect(res.status, who).toBe(200);
      expect(res.body.copy.patient).toMatchObject({ mrn: p.mrn, fullName: 'Copy Mother' });
    }
    const refused = {};
    for (const who of ['drB', 'nurse', 'reception', 'lab', 'pharmacist', 'admin']) {
      const res = await copyOf(who, p);
      expect(res.status, who).toBe(403);
      expect(res.body.copy, who).toBeUndefined();
      refused[who] = res.body.error.message;
    }
    expect(refused.drB).toBe("This is another doctor's patient: ask that doctor or an RMO for a copy of the whole record.");
    expect(refused.nurse).toBe("Only the patient's doctor or an RMO can make a copy of the whole record.");
    expect(refused.reception).toBe(refused.nurse);
    const outside = await copyOf('outsider', p);
    expect(outside.status).toBe(404);
    expect(outside.body.error.message).toBe('Patient not found.');
    expect((await printed('outsider', p, { as: 'paper' })).status).toBe(404);

    // The page is told who may: the More menu shows "Copy of the whole record" only then
    const can = {};
    for (const who of ['drA', 'rmo', 'drB', 'nurse', 'reception', 'lab', 'pharmacist']) can[who] = (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient.access.canCopyRecord;
    expect(can).toEqual({ drA: true, rmo: true, drB: false, nurse: false, reception: false, lab: false, pharmacist: false });

    // Only the two copies that were made are in the audit log
    const entries = await copyEntries();
    expect(entries.map((e) => [e.action, String(e.actor)])).toEqual([
      ['PATIENT_RECORD_COPIED', String(people.drA._id)],
      ['PATIENT_RECORD_COPIED', String(people.rmo._id)],
    ]);
  });

  it('a patient with no doctor yet: any doctor; a sensitive record: only the treating doctor and RMOs', async () => {
    const unassigned = await register({ fullName: 'Copy Unassigned', assignedDoctor: null });
    expect((await copyOf('drB', unassigned)).status).toBe(200);
    expect((await copyOf('nurse', unassigned)).status).toBe(403);

    const p = await register({ fullName: 'Copy Sensitive' });
    ok(await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true }));
    const drB = await copyOf('drB', p);
    expect(drB.status).toBe(403);
    expect(drB.body.error.message).toBe('This is a sensitive record: only the treating doctor or an RMO can make a copy of the whole record.');
    expect((await printed('drB', p, { as: 'pdf' })).status).toBe(403);
    expect((await copyOf('nurse', p)).status).toBe(403);
    expect((await copyOf('rmo', p)).body.copy.patient.sensitive).toBe(true);
    expect((await copyOf('drA', p)).status).toBe(200);
    expect((await (await as('drB')).get(`/api/patients/${p.id}`)).body.patient.access.canCopyRecord).toBe(false);
  });
});

describe('the audit entries', () => {
  it('"Full record copied" on opening, and the printout or the PDF like the other printouts – ids only', async () => {
    const p = await register();
    ok(await copyOf('rmo', p));
    expect(ok(await printed('rmo', p, { as: 'paper' }))).toEqual({ printed: true });
    expect(ok(await printed('drA', p, { as: 'pdf' }))).toEqual({ printed: true });
    const entries = await copyEntries();
    expect(entries.map((e) => e.action)).toEqual(COPY_ACTIONS);
    for (const e of entries) {
      expect(e.details).toEqual({ patientId: p.id, mrn: p.mrn, access: 'full' });
      expect(String(e.tenantId)).toBe(String(hospital._id));
      // what the hospital admin's audit log shows, and the super admin's (never which patient)
      expect(safeAuditDetails(e.action, { ...e.details, fullName: 'x', visits: 3 })).toEqual(e.details);
      expect(safeAuditDetails(e.action, e.details, { scope: 'platform' })).toEqual({ access: 'full' });
    }
    expect(String(entries[1].actor)).toBe(String(people.rmo._id));
    expect(String(entries[2].actor)).toBe(String(people.drA._id));

    // the hospital admin can find them under patient records
    const log = await (await as('admin')).get('/api/tenant/audit-logs?category=patients&action=PATIENT_RECORD_COPIED');
    expect(log.status).toBe(200);
    expect(log.body.actions).toEqual(expect.arrayContaining(COPY_ACTIONS));
  });

  it('refuses a printout it cannot name, and records nothing for those who may not copy', async () => {
    const p = await register();
    expect((await printed('drA', p, {})).status).toBe(400);
    expect((await printed('drA', p, { as: 'whatsapp' })).status).toBe(400);
    expect((await printed('drA', p, { as: 'paper', note: 'x' })).status).toBe(400);
    for (const who of ['drB', 'nurse', 'reception', 'lab', 'pharmacist', 'admin']) expect((await printed(who, p, { as: 'paper' })).status, who).toBe(403);
    expect((await (await as('drA')).get('/api/patients/not-an-id/record-copy')).status).toBe(400);
    expect((await (await as('drA')).get(`/api/patients/${String(people.drA._id)}/record-copy`)).status).toBe(404);
    expect(await copyEntries()).toHaveLength(0);
  });
});

describe('what the copy holds', () => {
  it('everything in her record, oldest first – and never the private note, entered-in-error content, drafts, other patients, e-mail addresses or bills', async () => {
    const { p, baby, v1, v2, workNames } = await fullRecord();
    const res = await copyOf('drA', p);
    const copy = ok(res).copy;
    const all = JSON.stringify(copy);
    expect(copy.cut).toEqual([]);
    expect(copy.madeAt).toBe(NOW.toISOString());

    // Identity and contact; medical and obstetric background; pregnancy and risk
    expect(copy.patient).toMatchObject({
      mrn: p.mrn,
      careType: 'antenatal',
      fullName: 'Copy Mother',
      currentAge: 28,
      phone: '+91 98765 00001',
      address: '4 Sample Lane, Pune',
      assignedDoctorName: 'Sample drA',
      registeredByName: 'Sample drA',
      notes: 'Record note: anxious about injections',
      medical: { bloodGroup: 'B+', heightCm: 160, weightKg: 60, allergies: 'Penicillin', conditions: ['thyroid'], conditionsReviewed: true },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 0 },
      pregnancy: { scanEdd: '2027-03-01T00:00:00.000Z', effectiveEdd: '2027-03-01T00:00:00.000Z' },
      newborn: null,
      motherMrn: null,
      babyMrns: [baby.mrn],
      duplicateOf: null,
      earlierRecordMrns: [],
    });
    expect(copy.patient.gestationalAge).toEqual({ weeks: expect.any(Number), days: expect.any(Number) });
    expect(copy.patient.risk).toMatchObject({ level: expect.any(String), templateApproved: false, override: null });
    expect(copy.patient.risk.reasons.length).toBeGreaterThan(0); // the thyroid condition
    for (const key of ['id', 'tenantId', 'assignedDoctor', 'createdBy', 'access', 'babies', 'motherInfo', 'redFlags', 'carePlanSummary']) expect(copy.patient, key).not.toHaveProperty(key);

    // Visits: oldest first; the signed one whole, the one entered in error only listed
    expect(copy.visits.map((v) => [v.id, v.status])).toEqual([
      [v1.id, 'active'],
      [v2.id, 'cancelled'],
    ]);
    expect(copy.visits[0]).toMatchObject({
      visitOn: '2026-09-21T00:00:00.000Z',
      signed: { byName: 'Sample drA', role: 'doctor' },
      vitals: { weightKg: 58, bpSystolic: 110, bpDiastolic: 70, pulse: 82, byName: 'Sample nurse' },
      details: { complaints: 'Mild nausea', diagnosis: 'Normal pregnancy', advice: 'Rest well', fundalHeightCm: 16, byName: 'Sample drA' },
      prescription: { notes: 'Take after breakfast', byName: 'Sample drA' },
      additions: [{ text: 'Weight re-checked: 58.5 kg', byName: 'Sample nurse' }],
    });
    expect(copy.visits[0].prescription.items).toMatchObject([{ drug: 'Folic acid', strength: '5 mg', frequency: '1-0-0' }]);
    expect(copy.visits[0].details).not.toHaveProperty('privateNote');
    expect(copy.visits[0].prescription).not.toHaveProperty('warningReasons');
    expect(copy.visits[1]).toEqual({ id: v2.id, visitOn: '2026-10-05T00:00:00.000Z', status: 'cancelled', enteredInError: { byName: 'Sample drA', at: NOW.toISOString() } });

    // The care plan with its items
    expect(copy.carePlans).toHaveLength(1);
    expect(copy.carePlans[0]).toMatchObject({ careType: 'antenatal', status: 'active', template: { approved: false } });
    expect(copy.carePlans[0].items.length).toBeGreaterThan(10);
    expect(copy.carePlans[0].items[0]).toMatchObject({ name: expect.any(String), kind: expect.any(String), status: expect.any(String) });
    for (const key of ['log', 'canEdit', 'canClose', 'readOnly']) expect(copy.carePlans[0]).not.toHaveProperty(key);
    expect(copy.carePlans[0].items[0]).not.toHaveProperty('history');

    // Lab: results, the review and the change after the report; a cancelled order and an unreported value are not content
    expect(copy.labOrders.map((o) => o.status)).toEqual(['reviewed', 'cancelled', 'ordered']);
    expect(copy.labOrders[0]).toMatchObject({
      noteToLab: 'Fasting not needed',
      labNote: 'Sample slightly haemolysed',
      abnormal: true,
      ordered: { byName: 'Sample drA' },
      collected: { byName: 'Sample lab', at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() },
      reported: { byName: 'Sample lab' },
      reviewed: { byName: 'Sample drA', comment: 'Seen again' },
      files: 0,
    });
    expect(copy.labOrders[0].tests[0].values.find((x) => x.key === 'hb')).toEqual({ key: 'hb', value: '9.8', flag: 'low' });
    expect(copy.labOrders[0].amendments).toMatchObject([{ byName: 'Sample lab', reason: 'Typing mistake corrected', reviewedByName: 'Sample drA' }]);
    expect(copy.labOrders[0].amendments[0].tests[0].values.find((x) => x.key === 'hb').value).toBe('9.5');
    expect(Object.keys(copy.labOrders[1]).sort()).toEqual(['cancelled', 'id', 'ordered', 'status']);
    expect(copy.labOrders[1].cancelled).toEqual({ byName: 'Sample drA', at: NOW.toISOString() });
    expect(copy.labOrders[2]).toMatchObject({ status: 'ordered', reported: null, tests: [{ key: 'hb', name: 'Haemoglobin (Hb)', values: [], text: '' }] });
    expect(all).not.toContain('7.7');
    expect(copy.catalogue.tests.map((t) => t.key).sort()).toEqual(['cbc', 'hb']);
    expect(copy.catalogue.tests.find((t) => t.key === 'cbc').fields[0]).toEqual({ key: 'hb', name: 'Haemoglobin', type: 'number', unit: 'g/dL' });

    // Emergency treatment, scans and procedures
    expect(copy.emergencyNotes).toMatchObject([{ byName: 'Sample drB', reason: 'Fainted in the OPD, her doctor was in theatre', text: 'IV fluids given, observed for an hour' }]);
    expect(Object.keys(copy.emergencyNotes[0]).sort()).toEqual(['at', 'byName', 'id', 'reason', 'text']);
    expect(copy.workDone).toHaveLength(2);
    expect(copy.workDone.find((w) => !w.enteredInError)).toMatchObject({ name: workNames[0], doneByName: 'Sample drA', on: '2026-10-05' });
    expect(Object.keys(copy.workDone.find((w) => w.enteredInError)).sort()).toEqual(['enteredInError', 'group', 'id', 'on']);

    // The stay: the signed admission note with its correction; the draft and the one entered in error only listed;
    // the nursing chart oldest first
    expect(copy.stays).toHaveLength(1);
    const stay = copy.stays[0];
    expect(stay).toMatchObject({ ward: 'Ward 2', bed: '7', reason: 'Observation for vomiting', status: 'admitted', admittedAt: '2026-10-04T02:00:00.000Z', admittedByName: 'Sample drA' });
    expect(stay).not.toHaveProperty('patientId');
    const kinds = Object.fromEntries(stay.documents.map((d) => [d.kind, d]));
    expect(kinds.admission).toMatchObject({
      status: 'signed',
      content: { reason: 'Observation for vomiting', history: 'Vomiting for two days', provisionalDiagnosis: 'Hyperemesis', plan: 'IV fluids' },
      signed: { byName: 'Sample rmo', role: 'rmo' },
      additions: [{ text: 'Urine ketones 2+ at admission', byName: 'Sample nurse' }],
    });
    expect(Object.keys(kinds.round).sort()).toEqual(['at', 'createdByName', 'id', 'kind', 'status']);
    expect(kinds.round.status).toBe('draft');
    expect(Object.keys(kinds.operation).sort()).toEqual(['at', 'enteredInError', 'id', 'kind', 'status']);
    expect(kinds.operation).toMatchObject({ status: 'cancelled', enteredInError: { byName: 'Sample drA' } });
    expect(stay.nursing.map((e) => [e.kind, Boolean(e.enteredInError)])).toEqual([
      ['vitals', false],
      ['note', false],
      ['medicine', true],
    ]);
    expect(stay.nursing[0]).toMatchObject({ vitals: { bpSystolic: 118, bpDiastolic: 76, pulse: 90 }, byName: 'Sample nurse' });
    expect(Object.keys(stay.nursing[2]).sort()).toEqual(['at', 'enteredInError', 'id', 'kind']);

    // Consent forms and information given: titles and dates only; a form Perinexa no longer has is not listed
    expect(copy.consents.map((c) => [c.kind, c.title, c.signedOn])).toEqual([
      ['consent', 'Consent for an operation or procedure', '2026-10-05T00:00:00.000Z'],
      ['information', expect.stringMatching(/anaemia/i), null],
    ]);
    expect(Object.keys(copy.consents[0]).sort()).toEqual(['id', 'kind', 'printedAt', 'signedOn', 'title']);

    // Appointments: the next visit booked itself; the day, the doctor and the status only
    expect(copy.appointments).toMatchObject([{ date: '2026-10-19', visitType: 'follow_up', status: 'booked', doctorName: 'Sample drA' }]);
    expect(Object.keys(copy.appointments[0]).sort()).toEqual(['date', 'doctorName', 'id', 'kind', 'needsTime', 'start', 'status', 'token', 'visitType']);

    // Always left out
    for (const never of [
      'PRIVATE-NOTE-TEXT',
      'privateNote',
      'warningReasons',
      'WRONG-PATIENT-COMPLAINT',
      'ERROR-REASON-TEXT',
      'CANCELLED-TEST-NAME',
      'CANCEL-REASON-TEXT',
      'DRAFT-ROUND-TEXT',
      'CANCELLED-DOCUMENT-TEXT',
      'DOCUMENT-ERROR-REASON',
      'WRONGDRUG',
      'NURSING-ERROR-REASON',
      'WORK-ERROR-REASON',
      workNames[1], // the scan or procedure recorded by mistake
      'TYPED-PROCEDURE-TEXT',
      'TYPED-REASON-TEXT',
      'WITNESS-NAME-TEXT',
      'RETIRED-FORM-TITLE',
      'Baby of Copy Mother', // her baby: by patient number only
      '@example.com', // no staff e-mail address
      'amountPaise',
      'billId',
      String(people.drA._id), // no staff id
      String(people.nurse._id),
      String(hospital._id),
    ]) {
      expect(all, never).not.toContain(never);
    }
    expect(all).not.toMatch(/"fee"|"price|"bill/i);
  });

  it("a baby's copy has its birth details and the mother's patient number – not her name or her data; a duplicate points to the main record by number", async () => {
    const mother = await register();
    const drA = await as('drA');
    const baby = ok(
      await drA.post('/api/patients').send({
        careType: 'newborn',
        fullName: 'Baby Sample',
        assignedDoctor: people.drA._id.toString(),
        newborn: { birthAt: '2026-10-03T08:00:00.000Z', birthWeightGrams: 2900, sex: 'male', mother: mother.id },
        registerAnyway: true,
      }),
      201,
    ).patient;
    const copy = ok(await copyOf('drA', baby)).copy;
    expect(copy.patient).toMatchObject({
      careType: 'newborn',
      fullName: 'Baby Sample',
      newborn: { birthAt: '2026-10-03T08:00:00.000Z', birthWeightGrams: 2900, sex: 'male' },
      motherMrn: mother.mrn,
      babyMrns: [],
      obstetric: null,
      pregnancy: null,
      risk: null,
    });
    const all = JSON.stringify(copy);
    for (const never of ['Copy Mother', 'Penicillin', '98765 00001', 'Sample Lane', mother.id]) expect(all, never).not.toContain(never);

    // A second record of the mother, marked as a duplicate of the first: each copy names the other by number only
    const dup = await register({ fullName: 'Copy Mother', phone: '+91 98765 00002', medical: { allergies: 'Sulpha ONLY-ON-DUPLICATE', conditionsReviewed: true } });
    ok(await drA.put(`/api/patients/${dup.id}/duplicate-of`).send({ mainId: mother.id, reason: 'Registered twice at the desk' }));
    const dupCopy = ok(await copyOf('drA', dup)).copy;
    expect(dupCopy.patient.duplicateOf).toMatchObject({ mrn: mother.mrn, byName: 'Sample drA', reason: 'Registered twice at the desk' });
    expect(dupCopy.patient.duplicateOf).not.toHaveProperty('id');
    const mainCopy = ok(await copyOf('drA', mother)).copy;
    expect(mainCopy.patient.earlierRecordMrns).toEqual([dup.mrn]);
    expect(mainCopy.patient.babyMrns).toEqual([baby.mrn]);
    expect(JSON.stringify(mainCopy)).not.toContain('ONLY-ON-DUPLICATE'); // the earlier record's data stays on that record
  });

  it('an empty record still gives a copy; a record with more than the copy can hold says which part is not complete', async () => {
    const p = await register({ careType: 'gynaecology', fullName: 'Copy Gynae', pregnancy: undefined, obstetric: undefined });
    const empty = ok(await copyOf('rmo', p)).copy;
    expect(empty).toMatchObject({ visits: [], carePlans: [], labOrders: [], workDone: [], stays: [], consents: [], appointments: [], emergencyNotes: [], cut: [] });
    expect(empty.patient).toMatchObject({ careType: 'gynaecology', pregnancy: null, risk: null, abortion: null, lastDelivery: null });

    const nurse = await as('nurse');
    for (const visitOn of ['2026-09-01', '2026-09-08', '2026-09-15']) ok(await nurse.post(visits(p)).send({ clientRequestId: randomUUID(), visitOn }), 201);
    const before = COPY_LIMITS.visits;
    COPY_LIMITS.visits = 2;
    try {
      const copy = ok(await copyOf('rmo', p)).copy;
      expect(copy.cut).toEqual(['visits']);
      expect(copy.visits.map((v) => v.visitOn.slice(0, 10))).toEqual(['2026-09-08', '2026-09-15']); // the newest, oldest first
    } finally {
      COPY_LIMITS.visits = before;
    }
    expect(ok(await copyOf('rmo', p)).copy.visits).toHaveLength(3);
  });

  it('results the lab reported without marking the sample collected first: no sample time on the copy (it is not known)', async () => {
    const p = await register();
    const drA = await as('drA');
    const labUser = await as('lab');
    const order = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] }), 201).order;
    ok(await labUser.put(lab(`${order.id}/results`)).send({ rev: order.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '11.2' }] }], report: true }));
    const [copied] = ok(await copyOf('drA', p)).copy.labOrders;
    expect(copied).toMatchObject({ status: 'reported', collected: null, reported: { byName: 'Sample lab', at: NOW.toISOString() } });
    expect(copied.tests[0].values).toEqual([{ key: 'hb', value: '11.2', flag: 'normal' }]);

    // An order reported this way before 5 Oct 2026 has no flag: its sample time is the report's own time – still
    // not a sample time
    await LabOrder.updateOne({ tenantId: hospital._id, _id: order.id }, { $unset: { collectedAtReport: 1 } });
    const old = await LabOrder.findOne({ tenantId: hospital._id, _id: order.id }).lean();
    expect(old.collectedAtReport).toBeUndefined();
    expect(old.collected.at).toEqual(old.reported.at);
    expect(ok(await copyOf('drA', p)).copy.labOrders[0]).toMatchObject({ collected: null, reported: { byName: 'Sample lab', at: NOW.toISOString() } });

    // A sample marked collected before the report keeps its own time
    const later = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] }), 201).order;
    const collected = ok(await labUser.post(lab(`${later.id}/collect`)).send({ rev: later.rev })).order;
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // (the clock is frozen)
    await LabOrder.updateOne({ tenantId: hospital._id, _id: later.id }, { $set: { 'collected.at': twoHoursAgo } });
    ok(await labUser.put(lab(`${later.id}/results`)).send({ rev: collected.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '11.0' }] }], report: true }));
    expect(ok(await copyOf('drA', p)).copy.labOrders[1]).toMatchObject({ collected: { byName: 'Sample lab', at: twoHoursAgo.toISOString() }, reported: { at: NOW.toISOString() } });
  });

  it('pregnancy loss, a delivery and breastfeeding are in the copy of the record that has them', async () => {
    const loss = await register({
      careType: 'abortion',
      fullName: 'Copy Loss',
      pregnancy: undefined,
      abortion: { lossType: 'missed', lmp: '2026-07-20', presentedOn: '2026-10-01', management: { method: 'medical', on: '2026-10-02', outcome: 'complete' }, antiD: { status: 'not_needed' }, note: 'Follow-up in two weeks', findings: { os: 'closed', crlMm: '7.5' } },
    });
    const copy = ok(await copyOf('drA', loss)).copy;
    expect(copy.patient.abortion).toMatchObject({ lossType: 'missed', lmp: '2026-07-20T00:00:00.000Z', presentedOn: '2026-10-01T00:00:00.000Z', weeks: 10, management: { method: 'medical', outcome: 'complete' }, antiD: { status: 'not_needed' }, note: 'Follow-up in two weeks' });
    // The findings of the loss, with who recorded them and the hospital's day – never a staff id
    expect(copy.patient.abortion.findings.map((f) => [f.key, f.value, f.byName, f.current, String(f.on).slice(0, 10)])).toEqual([
      ['os', 'closed', 'Sample drA', true, '2026-10-05'],
      ['crlMm', 7.5, 'Sample drA', true, '2026-10-05'],
    ]);
    for (const f of copy.patient.abortion.findings) expect(Object.keys(f).sort()).toEqual(['at', 'byName', 'current', 'endedAt', 'endedByName', 'endedOn', 'key', 'on', 'value', 'via']);
    expect(copy.patient.pregnancy).toBeNull();

    const after = await register({ careType: 'postnatal', fullName: 'Copy After', pregnancy: undefined });
    ok(await (await as('drA')).patch(`/api/patients/${after.id}`).send({ delivery: { on: '2026-09-20', mode: 'normal' }, postnatal: { breastfeeding: 'yes' } }));
    const pn = ok(await copyOf('drA', after)).copy;
    expect(pn.patient).toMatchObject({ lastDelivery: { at: '2026-09-20T00:00:00.000Z', mode: 'normal', timeKnown: false }, postnatal: { breastfeeding: 'yes' } });
    expect(pn.patient.lastDelivery).not.toHaveProperty('documentId');
  });
});

describe('the care plans in the copy', () => {
  it('has every plan of the record, oldest first: the antenatal plan of the pregnancy and the plan after delivery', async () => {
    const p = await register({ pregnancy: { scanEdd: '2026-10-01' } });
    const drA = await as('drA');
    const first = ok(await copyOf('drA', p)).copy.carePlans;
    expect(first.map((c) => [c.careType, c.status])).toEqual([['antenatal', 'active']]);

    // She delivers elsewhere and comes back for postnatal care: the antenatal plan is paused, a postnatal plan starts
    ok(await drA.patch(`/api/patients/${p.id}`).send({ careType: 'postnatal' }));
    ok(await drA.patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-10-02', mode: 'normal' } }));
    const tab = ok(await drA.get(`/api/patients/${p.id}/care-plan`));
    expect(tab.plan).toMatchObject({ careType: 'postnatal', status: 'active' });
    const copy = ok(await copyOf('rmo', p)).copy;
    expect(copy.carePlans.map((c) => [c.careType, c.status])).toEqual([
      ['antenatal', 'paused'],
      ['postnatal', 'active'],
    ]);
    // the same plan, the same items and statuses as the Care plan tab shows
    const current = copy.carePlans[1];
    expect(current.id).toBe(tab.plan.id);
    expect(current.items.map((i) => [i.id, i.status])).toEqual(tab.plan.items.map((i) => [i.id, i.status]));
    expect(copy.patient.lastDelivery).toEqual({ at: '2026-10-02T00:00:00.000Z', mode: 'normal', timeKnown: false });
    // a copy changes nothing: no care-plan entry in the audit log beyond the tab's own view
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_VIEWED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CARE_PLAN_CHANGED' })).toBe(0);
  });

  it('oldest first even when the plan the tab shows is an older one (her paused antenatal plan, before a gynaecology plan is started)', async () => {
    const p = await register({ pregnancy: { scanEdd: '2026-10-01' } });
    const drA = await as('drA');
    const antenatal = ok(await drA.get(`/api/patients/${p.id}/care-plan`)).plan;
    // (made in January: the clock is frozen, so the date is set in the database)
    await CarePlan.collection.updateOne({ _id: new mongoose.Types.ObjectId(antenatal.id) }, { $set: { createdAt: new Date('2026-01-10T05:00:00Z') } });
    ok(await drA.patch(`/api/patients/${p.id}`).send({ careType: 'postnatal' }));
    ok(await drA.patch(`/api/patients/${p.id}`).send({ delivery: { on: '2026-10-02', mode: 'normal' } }));
    const postnatal = ok(await drA.get(`/api/patients/${p.id}/care-plan`)).plan; // made today
    expect(postnatal.careType).toBe('postnatal');
    // Later she comes for gynaecology care and no gynaecology plan has been started: the tab shows the antenatal plan
    ok(await drA.patch(`/api/patients/${p.id}`).send({ careType: 'gynaecology' }));
    expect(ok(await drA.get(`/api/patients/${p.id}/care-plan`)).plan).toMatchObject({ careType: 'antenatal' });
    const copy = ok(await copyOf('rmo', p)).copy;
    expect(copy.carePlans.map((c) => c.careType)).toEqual(['antenatal', 'postnatal']);
    expect(copy.carePlans[1].id).toBe(postnatal.id);
  });
});

describe('the views of the copy (no database)', () => {
  it('a visit: the private note and the warning reasons are dropped even if a view carried them', () => {
    const view = {
      id: 'v1',
      visitOn: '2026-10-01T00:00:00.000Z',
      careType: 'antenatal',
      status: 'active',
      cancelled: null,
      signed: null,
      additions: [],
      vitals: { weightKg: 60, rev: 1, byName: 'Sample Nurse', at: '2026-10-01T05:00:00.000Z' },
      details: { complaints: 'Headache', privateNote: 'SECRET', rev: 1, byName: 'Dr Sample', at: '2026-10-01T05:10:00.000Z' },
      prescription: { items: [{ id: 'i1', drug: 'Paracetamol' }], notes: '', warningReasons: [{ key: 'k', level: 'avoid', title: 'Avoid', medicines: ['x'], reason: 'SECRET-REASON' }], rev: 1, byName: 'Dr Sample', at: null },
      createdByName: 'Sample Nurse',
      createdAt: '2026-10-01T05:00:00.000Z',
    };
    const out = visitForCopy(view);
    expect(JSON.stringify(out)).not.toMatch(/SECRET|privateNote|warningReasons/);
    expect(out.details.complaints).toBe('Headache');
    expect(visitForCopy({ ...view, status: 'cancelled', cancelled: { reason: 'Wrong patient', byName: 'Dr Sample', at: '2026-10-01T06:00:00.000Z' } })).toEqual({
      id: 'v1',
      visitOn: '2026-10-01T00:00:00.000Z',
      status: 'cancelled',
      enteredInError: { byName: 'Dr Sample', at: '2026-10-01T06:00:00.000Z' },
    });
  });

  it('a lab order: values only once reported; a cancelled order without its tests; file names never', () => {
    const order = {
      id: 'o1',
      status: 'collected',
      urgent: true,
      tests: [{ key: 'hb', name: 'Haemoglobin (Hb)', values: [{ key: 'hb', value: '8.1', flag: 'low' }], text: 'saved text' }],
      noteToLab: 'Urgent',
      packages: [{ key: 'p', name: 'Booking tests', version: 1, approved: false }],
      labNote: 'not final',
      ordered: { byName: 'Dr Sample', at: 'a' },
      collected: { byName: 'Lab Sample', at: 'b' },
      reported: null,
      reviewed: null,
      cancelled: null,
      amendments: [],
      files: [{ id: 'f1', fileName: 'Asha Sample report.pdf' }],
      abnormal: true,
    };
    const open = labOrderForCopy(order);
    expect(open).toMatchObject({ status: 'collected', urgent: true, packages: ['Booking tests'], tests: [{ key: 'hb', name: 'Haemoglobin (Hb)', values: [], text: '' }], labNote: '', abnormal: false, files: 1 });
    expect(JSON.stringify(open)).not.toMatch(/8\.1|saved text|not final|Asha Sample/);
    const done = labOrderForCopy({ ...order, status: 'reported', reported: { byName: 'Lab Sample', at: 'c' } });
    expect(done.tests[0].values).toEqual([{ key: 'hb', value: '8.1', flag: 'low' }]);
    expect(done).toMatchObject({ labNote: 'not final', abnormal: true, reported: { byName: 'Lab Sample', at: 'c' } });
    // reported without "sample collected" first: the sample carries the report's stamp, so the copy has no sample time
    const stamped = labOrderForCopy({ ...order, status: 'reported', collected: { byName: 'Lab Sample', at: 'c' }, reported: { byName: 'Lab Sample', at: 'c' }, collectedAtReport: true });
    expect(stamped).toMatchObject({ collected: null, reported: { byName: 'Lab Sample', at: 'c' } });
    // an order from before the flag: the sample time is exactly the report's – stamped by the report too
    const sameTime = { byName: 'Lab Sample', at: '2026-10-01T08:35:00.000Z' };
    expect(labOrderForCopy({ ...order, status: 'reported', collected: sameTime, reported: { ...sameTime } }).collected).toBeNull();
    expect(labOrderForCopy({ ...order, status: 'reported', collected: sameTime, reported: { byName: 'Lab Sample', at: '2026-10-01T09:00:00.000Z' } }).collected).toEqual(sameTime);
    expect(labOrderForCopy({ ...order, collectedAtReport: true }).collected).toEqual({ byName: 'Lab Sample', at: 'b' }); // (not reported yet: as recorded)
    expect(labOrderForCopy({ ...order, status: 'cancelled', cancelled: { byName: 'Dr Sample', at: 'd', reason: 'Wrong patient' } })).toEqual({
      id: 'o1',
      status: 'cancelled',
      ordered: { byName: 'Dr Sample', at: 'a' },
      cancelled: { byName: 'Dr Sample', at: 'd' },
    });
  });

  it('documents, nursing entries and scans: signed content only; drafts and entries in error are listed without content', () => {
    const doc = { id: 'd1', admissionId: 'a1', kind: 'delivery', status: 'signed', content: { deliveredAt: '2026-10-01T05:30:00.000Z', mode: 'normal' }, rev: 2, createdByName: 'RMO Sample', createdAt: '2026-10-01T05:00:00.000Z', signed: { byName: 'Dr Sample', role: 'doctor', at: 's' }, cancelled: null, additions: [{ id: 'x', text: 'Added', byName: 'Nurse Sample', at: 't' }] };
    expect(documentForCopy(doc)).toEqual({
      id: 'd1',
      kind: 'delivery',
      status: 'signed',
      at: '2026-10-01T05:30:00.000Z', // the time of the delivery, not when the note was started
      content: doc.content,
      createdByName: 'RMO Sample',
      signed: { byName: 'Dr Sample', role: 'doctor', at: 's' },
      additions: [{ id: 'x', text: 'Added', byName: 'Nurse Sample', at: 't' }],
    });
    expect(documentForCopy({ ...doc, status: 'draft', signed: null })).toEqual({ id: 'd1', kind: 'delivery', status: 'draft', at: '2026-10-01T05:00:00.000Z', createdByName: 'RMO Sample' });
    expect(documentForCopy({ ...doc, status: 'cancelled', cancelled: { reason: 'Wrong patient', byName: 'Dr Sample', at: 'c' } })).toEqual({ id: 'd1', kind: 'delivery', status: 'cancelled', at: '2026-10-01T05:00:00.000Z', enteredInError: { byName: 'Dr Sample', at: 'c' } });

    const entry = { id: 'e1', kind: 'medicine', at: 'now', vitals: null, medicine: { drug: 'Oxytocin', dose: '10 IU', route: 'IM' }, note: '', byName: 'Nurse Sample', cancelled: null };
    expect(nursingEntryForCopy(entry)).toMatchObject({ medicine: { drug: 'Oxytocin' }, byName: 'Nurse Sample' });
    expect(nursingEntryForCopy({ ...entry, cancelled: { reason: 'Wrong chart', byName: 'Nurse Sample', at: 'c' } })).toEqual({ id: 'e1', kind: 'medicine', at: 'now', enteredInError: { byName: 'Nurse Sample', at: 'c' } });

    const work = { id: 'w1', name: 'Ultrasound – obstetric', group: 'scan', on: '2026-10-01', doneByName: 'Dr Sample', doneAt: 'x', cancelled: null };
    expect(workForCopy(work)).toEqual({ id: 'w1', group: 'scan', name: 'Ultrasound – obstetric', on: '2026-10-01', doneByName: 'Dr Sample' });
    expect(workForCopy({ ...work, cancelled: { byName: 'Dr Sample', at: 'c', reason: 'Wrong patient' } })).toEqual({ id: 'w1', group: 'scan', on: '2026-10-01', enteredInError: { byName: 'Dr Sample', at: 'c' } });
  });

  it("the patient's details: only what is listed – a field added to the record later stays out, and so do ids", () => {
    const projected = {
      id: 'p1',
      tenantId: 't1',
      mrn: 'P-000009',
      careType: 'antenatal',
      fullName: 'Asha Sample',
      currentAge: 30,
      phone: '+91 00000 00000',
      address: '1 Sample Road',
      assignedDoctor: 'u1',
      assignedDoctorName: 'Dr Sample',
      createdAt: '2026-01-01T00:00:00.000Z',
      abha: { linked: true, masked: '91-XXXX-XXXX-1234', method: 'verified', at: null },
      medical: { bloodGroup: 'O+', allergies: 'None known', conditions: [], conditionsReviewed: true },
      obstetric: { gravida: 1 },
      pregnancy: { lmp: '2026-06-01T00:00:00.000Z', findings: [{ key: 'gdm', byName: 'Dr Sample', at: 'a', via: 'record', endedAt: null, endedByName: null, current: true }], readings: null },
      gestationalAge: { weeks: 18, days: 0 },
      risk: { level: 'high', computedLevel: 'moderate', reasons: [{ key: 'k', label: 'GDM', level: 'high', detail: '' }], missing: [], templateId: 'tpl1', templateName: 'Standard', templateVersion: 3, templateApproved: true, override: { level: 'high', reason: 'Twins suspected', by: 'u1', byName: 'Dr Sample', at: 'o', computedLevelAtOverride: 'moderate', reasonKeysAtOverride: ['k'] } },
      riskOverrideHistory: [{ level: 'high', reason: 'Twins suspected', byName: 'Dr Sample', at: 'o', endedAt: null }],
      newborn: { birthAt: null, mother: null },
      motherInfo: { mrn: 'P-000001' },
      babies: [{ mrn: 'P-000010' }],
      earlierRecords: [{ mrn: 'P-000002' }],
      earlierRecordDetails: [{ mrn: 'P-000002', details: [{ key: 'allergies', text: 'SECRET-OTHER-RECORD' }] }],
      somethingAddedLater: 'SECRET-NEW-FIELD',
      access: { level: 'full' },
    };
    const out = patientForCopy(projected);
    const all = JSON.stringify(out);
    expect(all).not.toMatch(/SECRET|"id"|tenantId|"by"|templateId|reasonKeysAtOverride|"access"|u1|t1|tpl1/);
    expect(out).toMatchObject({
      mrn: 'P-000009',
      abha: { masked: '91-XXXX-XXXX-1234' },
      risk: { level: 'high', computedLevel: 'moderate', templateName: 'Standard', templateVersion: 3, templateApproved: true, override: { level: 'high', reason: 'Twins suspected', byName: 'Dr Sample' } },
      riskOverrideHistory: [{ level: 'high', reason: 'Twins suspected' }],
      pregnancy: { findings: [{ key: 'gdm', current: true }] },
      newborn: null,
      motherMrn: null, // not a baby's record
      babyMrns: ['P-000010'],
      earlierRecordMrns: ['P-000002'],
    });
    // A delivery: whether its time is known (from the delivery note a doctor confirmed) – never the note's id
    const delivered = patientForCopy({ ...projected, careType: 'postnatal', lastDelivery: { at: '2026-10-04T20:30:00.000Z', mode: 'normal', documentId: 'doc1' } });
    expect(delivered.lastDelivery).toEqual({ at: '2026-10-04T20:30:00.000Z', mode: 'normal', timeKnown: true });
    expect(patientForCopy({ ...projected, lastDelivery: { at: '2026-10-04T00:00:00.000Z', mode: 'lscs', documentId: null } }).lastDelivery).toEqual({ at: '2026-10-04T00:00:00.000Z', mode: 'lscs', timeKnown: false });
    expect(patientForCopy({ ...projected, careType: 'newborn', newborn: { birthAt: 'b', birthWeightGrams: 3000, sex: 'female', mother: 'p0' } })).toMatchObject({
      newborn: { birthAt: 'b', birthWeightGrams: 3000, sex: 'female' },
      motherMrn: 'P-000001',
      babyMrns: [],
      obstetric: null,
      risk: null,
      newbornCare: { nicu: { admitted: '', from: null, to: null }, feedingAtDischarge: '' }, // not recorded
      death: null,
      deathsUndone: [],
    });
    // A baby's care after birth, a recorded death, and one recorded in error and undone (without its date or reason)
    const closedBaby = patientForCopy({
      ...projected,
      careType: 'newborn',
      newbornCare: { nicu: { admitted: 'yes', from: 'f', to: null }, feedingAtDischarge: 'exclusive' },
      closed: true,
      death: { on: 'd', place: 'here', timing: null, ageDays: 3, byName: 'Dr Sample', at: 'r' },
      deathHistory: [{ on: 'SECRET-DAY', place: 'here', timing: null, byName: 'Dr Sample', at: 'a1', undoneReason: 'SECRET-REASON', undoneByName: 'Dr Other', undoneAt: 'a2' }],
    });
    expect(closedBaby).toMatchObject({
      newbornCare: { nicu: { admitted: 'yes', from: 'f', to: null }, feedingAtDischarge: 'exclusive' },
      death: { on: 'd', place: 'here', timing: null, ageDays: 3, byName: 'Dr Sample', at: 'r' },
      deathsUndone: [{ byName: 'Dr Sample', at: 'a1', undoneByName: 'Dr Other', undoneAt: 'a2' }],
    });
    expect(JSON.stringify(closedBaby)).not.toMatch(/SECRET/);
    expect(patientForCopy({ ...projected, newbornCare: { feedingAtDischarge: 'none' } }).newbornCare).toBeNull(); // never on a mother's copy
  });

  it('a care plan: without its log, the change history of its items and what the viewer may do', () => {
    const plan = planForCopy({ id: 'c1', status: 'active', log: [{ text: 'x' }], recentChanges: [], canEdit: true, canChangePlan: true, canClose: true, canReopen: false, readOnly: false, items: [{ id: 'i1', name: 'Booking visit', rev: 3, history: [{ action: 'done' }], done: null }] });
    expect(plan).toEqual({ id: 'c1', status: 'active', items: [{ id: 'i1', name: 'Booking visit', done: null }] });
  });
});

// ABDM milestone M3 – her records from other hospitals, fetched through ABDM with her consent (the hospital as a Health
// Information User), in practice mode and with a stand-in for ABDM's V3 APIs: reading FHIR documents (with the
// fetal-sex guard and the safe list of files), who may see and ask, her answer, the records arriving encrypted,
// deletion when her consent ends or is withdrawn, never copied or sent on, and the audit log. Made-up data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abdmClient, abdmIdle, setAbdmClientForTests } from '../src/abdm/abdmService.js';
import { consentNotify, expireAllDue, forgetKeysForTests } from '../src/abdm/fetchRecords.js';
import { checksumOf, encryptFor } from '../src/abdm/fidelius.js';
import { DOSE_IN_DOCUMENT, ENTERED_IN_ERROR, FETCH_HI_TYPES, NotReadable, dosageWords, guardText, narrativeLines, readDocument } from '../src/abdm/fhirReader.js';
import { practiceClient, practiceSent, resetPractice } from '../src/abdm/practiceClient.js';
import { PRACTICE_SEX_SENTENCE, practiceDocuments, practicePdf } from '../src/abdm/practiceHospitals.js';
import { ABDM_CHECKLIST_M3 } from '../src/abdm/v3Client.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { LEFT_OUT } from '../src/export/hospitalExport.js';
import { AbdmFetchRequest } from '../src/models/AbdmFetchRequest.js';
import { AbdmFetchedFile, AbdmFetchedRecord } from '../src/models/AbdmFetchedRecord.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { HttpError } from '../src/utils/httpError.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:30 in India
const DAY = 86_400_000;
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharm: 'pharmacist', admin: 'admin' };
const FETCH_ACTIONS = ['ABDM_FETCH_REQUESTED', 'ABDM_FETCH_ANSWERED', 'ABDM_RECORDS_FETCHED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_DELETED'];
// What the practice hospitals' documents say – it must never reach the audit log, and is gone once deleted
const CONTENT = ['mild anaemia', 'Ferrous sulphate', 'hyperemesis', 'Sample City Hospital', 'Sample Town Lab', 'Dr Practice', 'vaccine, dose 1', 'PRACTICE – made-up'];

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
  resetPractice();
  forgetKeysForTests();
  setAbdmClientForTests(null);
  app = createApp({ apiRateLimitMax: 100000 });
  hospital = await createTenant('ABDM Fetch Hospital');
  other = await createTenant('Other ABDM Fetch Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}`, ...(key === 'drA' ? { professional: { registrationNumber: 'MMC-SAMPLE-1234', council: 'Sample Medical Council' } } : {}) });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
});
afterEach(async () => {
  await abdmIdle();
  vi.useRealTimers();
  setAbdmClientForTests(null);
  config.ABDM_PUBLIC_URL = '';
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const post = async (who, path, body) => (await as(who)).post(`/api/abdm${path}`).send(body);
const get = async (who, path) => (await as(who)).get(`/api/abdm${path}`);
const page = (who, p) => get(who, `/patients/${p.id}/fetch`);
const ALL_TYPES = ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary', 'ImmunizationRecord'];
const ask = (who, p, body = {}) => post(who, `/patients/${p.id}/fetch`, { clientRequestId: randomUUID(), hiTypes: ALL_TYPES, from: '2025-10-05', to: '2026-10-05', days: 30, ...body });

async function register(name = 'Fetch Mother', extra = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: name, ageYears: 29, phone: '+91 98765 00002', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...extra }),
  );
  return ok(res, 201).patient;
}

/** Her ABHA verified with the practice OTP and linked (the made-up practice ABHA). */
async function linkAbha(p, value = '91-1111-2222-3333') {
  const r = ok(await post('reception', '/verify/request', { patientId: p.id, hint: 'abha-number', value }));
  ok(await post('reception', '/verify/confirm', { id: r.id, otp: '123456' }));
  ok(await post('reception', '/verify/link', { id: r.id, abhaNumber: value, consent: true }));
}

/** A patient with her ABHA, a request for every kind, and her practice answer "yes". */
async function fetched({ approve = true, body = {} } = {}) {
  const p = await register();
  await linkAbha(p);
  const { request: r } = ok(await ask('drA', p, body), 201);
  const answered = ok(await post('drA', `/fetch/${r.id}/practice/answer`, { approve }));
  return { p, requestId: r.id, answered };
}

// ---------- Reading a FHIR document ----------

const bundleOf = (resources, composition = {}) => {
  const all = [{ resourceType: 'Composition', id: 'c1', title: 'Sample note', date: '2026-09-01T05:00:00Z', section: [{ title: 'Notes', entry: resources.map((r) => ({ reference: `urn:uuid:${r.id}` })) }], ...composition }, ...resources];
  return { resourceType: 'Bundle', type: 'document', entry: all.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })) };
};

describe('reading a FHIR document (pure)', () => {
  const docs = (hipId, reference, hiTypes) => practiceDocuments(hipId, reference, { hiTypes, patientName: 'Sample Abha Mother', now: NOW }).map((d) => readDocument(JSON.parse(JSON.stringify(d.bundle))));

  it('the practice consultation: its type, date, hospital, doctor, vital signs, medicines with dose, advice; the PDF kept and the web page left out', () => {
    const [op, rx] = docs('PRACTICE-HIP-CITY', 'CITY-OPD-40', ['OPConsultation', 'Prescription']);
    expect(op).toMatchObject({ hiType: 'OPConsultation', title: 'Consultation report', hospital: 'Sample City Hospital (practice)', authors: ['Dr Practice Sample'], nameInDocument: 'Sample Abha Mother', withheld: 1, truncated: false });
    expect(op.date.toISOString()).toBe('2026-08-26T05:00:00.000Z');
    const text = (d) => d.sections.flatMap((s) => [`# ${s.title}`, ...s.lines.map((l) => l.text)]);
    expect(text(op)).toEqual(expect.arrayContaining(['# Physical examination', 'Blood pressure: Systolic blood pressure 112 mmHg, Diastolic blood pressure 72 mmHg', 'Fetal heart rate: 142 /min', 'Practice: mild anaemia in pregnancy', 'Next visit on 23 Sep 2026']));
    expect(text(op)).toContain('Tab. Ferrous sulphate 200 mg – Dose 1, 1-0-1 (twice a day), after food, for 30 days');
    // The sentence about the baby's sex is withheld (and counted on its line); the rest of the line stays
    const exam = op.sections.flatMap((s) => s.lines).find((l) => l.text.startsWith('Examination'));
    expect(exam).toEqual({ text: 'Examination: Pallor present. Ultrasound seen: single live fetus, growth normal.', withheld: 1, sub: false });
    expect(JSON.stringify(op)).not.toMatch(/Sex of the fetus/);
    expect(op.files).toEqual([expect.objectContaining({ title: 'Practice ultrasound report (made up).pdf', contentType: 'application/pdf' })]);
    expect(op.files[0].data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(op.filesLeftOut).toEqual([{ title: 'Practice web page', contentType: 'text/html', why: 'type' }]);
    expect(rx).toMatchObject({ hiType: 'Prescription', withheld: 0, files: [] });
  });

  it('lab results with units, Low marks and reference ranges; a vaccination; a discharge summary', () => {
    const [lab] = docs('PRACTICE-HIP-LAB', 'LAB-CBC-20', ['DiagnosticReport']);
    const lines = lab.sections[0].lines;
    expect(lines[0]).toEqual({ text: 'Complete blood count (CBC)', withheld: 0, sub: false });
    expect(lines[1]).toEqual({ text: 'Haemoglobin: 10.1 g/dL (Low) – reference 11–16 g/dL (below 11 in pregnancy is anaemia)', withheld: 0, sub: true });
    const [td] = docs('PRACTICE-HIP-LAB', 'LAB-TD-60', ['ImmunizationRecord']);
    expect(td).toMatchObject({ hiType: 'ImmunizationRecord', title: 'Immunization record' });
    expect(td.sections[0].lines[0].text).toBe('Td (tetanus and adult diphtheria) vaccine, dose 1');
    const [ds] = docs('PRACTICE-HIP-CITY', 'CITY-DS-100', ['DischargeSummary']);
    expect(ds.sections.map((s) => s.title)).toEqual(['Diagnosis', 'Course in hospital', 'Condition at discharge', 'Medications', 'Advice', 'Follow up']);
  });

  it('the fetal-sex guard: sentence by sentence; a title or a whole line; never for a baby', () => {
    expect(guardText('Growth normal. Baby is a boy. Liquor adequate.')).toEqual({ text: 'Growth normal. Liquor adequate.', withheld: 1 });
    expect(guardText('Karyotype 46,XY.')).toEqual({ text: '', withheld: 1 });
    expect(guardText('Baby is a boy.', false)).toEqual({ text: 'Baby is a boy.', withheld: 0 });
    const obs = { resourceType: 'Observation', id: 'o1', code: { text: 'Fetal sex' }, valueString: 'Female' };
    const out = readDocument(bundleOf([obs], { title: 'Scan – female fetus' }));
    expect(out).toMatchObject({ title: 'Health record', titleWithheld: true, withheld: 2 });
    expect(out.sections[0].lines).toEqual([{ text: '', withheld: 1, sub: false }]);
    expect(readDocument(bundleOf([obs]), { guard: false }).sections[0].lines[0].text).toBe('Fetal sex: Female');
  });

  it('a narrative is plain text (no HTML kept, scripts dropped); resources of many kinds; limits', () => {
    expect(narrativeLines('<div xmlns="http://www.w3.org/1999/xhtml"><p>Seen &amp; examined.</p><script>alert(1)</script><p>BP&#160;110/70 <b>stable</b></p><table><tr><td>Hb</td><td>11</td></tr></table></div>')).toEqual(['Seen & examined.', 'BP 110/70 stable', 'Hb · 11']);
    const s = { resourceType: 'Composition', id: 'c1', title: 'Note', date: '2026-09-01', section: [{ title: 'Story', text: { div: '<div><p>Came with pain<img src=x onerror=alert(1)></p></div>' } }] };
    const out = readDocument({ resourceType: 'Bundle', entry: [{ resource: s }] });
    expect(out.sections).toEqual([{ title: 'Story', lines: [{ text: 'Came with pain', withheld: 0, sub: false }] }]);
    const many = [
      { resourceType: 'AllergyIntolerance', id: 'a', code: { text: 'Penicillin' }, reaction: [{ manifestation: [{ text: 'Rash' }] }] },
      { resourceType: 'Procedure', id: 'p', code: { coding: [{ display: 'Lower segment caesarean section' }] }, performedDateTime: '2024-03-02' },
      { resourceType: 'Condition', id: 'c', code: { text: 'Hypothyroidism' }, note: [{ text: 'On treatment' }] },
      { resourceType: 'MedicationStatement', id: 'm', medicationReference: { reference: 'urn:uuid:med' }, dosage: [{ text: '50 mcg daily' }] },
      { resourceType: 'Medication', id: 'med', code: { text: 'Levothyroxine 50 mcg' } },
      { resourceType: 'FamilyMemberHistory', id: 'f', relationship: { text: 'Mother' }, condition: [{ code: { text: 'Diabetes' } }] },
    ];
    const lines = readDocument(bundleOf(many)).sections[0].lines.map((l) => l.text);
    expect(lines).toEqual(['Allergy: Penicillin – Rash', 'Lower segment caesarean section – 2 Mar 2024', 'Hypothyroidism', 'On treatment', 'Levothyroxine 50 mcg – 50 mcg daily', 'Family history (Mother): Diabetes']);
    const long = readDocument(bundleOf(Array.from({ length: 400 }, (_, i) => ({ resourceType: 'Condition', id: `x${i}`, code: { text: `Item ${i}` } }))));
    expect(long).toMatchObject({ truncated: true });
    expect(long.sections[0].lines).toHaveLength(300);
    // A hostile narrative (thousands of unclosed script tags) is read at once; a reference by its full address resolves
    const started = Date.now();
    expect(narrativeLines(`<div>Kept<script>${'<script x'.repeat(20000)}</div>`)).toEqual(['Kept']);
    expect(Date.now() - started).toBeLessThan(1000);
    const byAddress = readDocument(bundleOf([{ resourceType: 'Observation', id: 'o9', code: { text: 'Sample' }, valueString: 'one' }], { author: [{ reference: 'https://fhir.example.org/r4/Practitioner/pr1' }] }));
    expect(byAddress.authors).toEqual([]); // not in the document: nobody named
    const withAuthor = { ...bundleOf([]), entry: [...bundleOf([], { author: [{ reference: 'https://fhir.example.org/r4/Practitioner/pr1' }] }).entry, { resource: { resourceType: 'Practitioner', id: 'pr1', name: [{ given: ['Sample'], family: 'Author' }] } }] };
    expect(readDocument(withAuthor).authors).toEqual(['Sample Author']);
    expect(() => readDocument({ resourceType: 'Patient' })).toThrow(NotReadable);
    expect(() => readDocument(null)).toThrow(NotReadable);
  });

  it('attached files: only a real PDF, JPEG or PNG inside the document, at most 10 MB; a link is never fetched', () => {
    const pdf = practicePdf(['Sample']).toString('base64');
    const ref = (attachment, id) => ({ resourceType: 'DocumentReference', id, content: [{ attachment }] });
    const out = readDocument(
      bundleOf([
        ref({ contentType: 'application/pdf', data: pdf, title: 'Report' }, 'd1'),
        ref({ contentType: 'application/pdf', data: Buffer.from('<html>not a pdf</html>').toString('base64'), title: 'Fake' }, 'd2'),
        ref({ contentType: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64'), title: 'Drawing' }, 'd3'),
        ref({ contentType: 'application/pdf', url: 'https://files.example.org/report.pdf', title: 'Linked' }, 'd4'),
        ref({ contentType: 'image/png', data: Buffer.alloc(11 * 1024 * 1024).toString('base64'), title: 'Huge' }, 'd5'),
        { resourceType: 'Binary', id: 'b1', contentType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64') },
      ]),
    );
    expect(out.files.map((f) => [f.title, f.contentType])).toEqual([
      ['Report', 'application/pdf'],
      ['Attached file', 'image/png'],
    ]);
    expect(out.filesLeftOut.map((f) => [f.title, f.why])).toEqual([
      ['Fake', 'type'],
      ['Drawing', 'type'],
      ['Linked', 'link'],
      ['Huge', 'size'],
    ]);
    expect(FETCH_HI_TYPES).toEqual(['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary', 'ImmunizationRecord', 'HealthDocumentRecord', 'WellnessRecord']);
  });

  it('statuses are said: a medicine stopped, a diagnosis ruled out or resolved, a result preliminary; entered in error is marked not valid', () => {
    const cc = (code) => ({ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/sample', code }] });
    const lines = readDocument(
      bundleOf([
        { resourceType: 'MedicationRequest', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Tab. Sample A 10 mg' }, dosageInstruction: [{ text: '1-0-1' }] },
        { resourceType: 'MedicationRequest', id: 'm2', status: 'stopped', medicationCodeableConcept: { text: 'Labetalol 100 mg' }, dosageInstruction: [{ text: '1-1-1' }] },
        { resourceType: 'MedicationRequest', id: 'm3', status: 'cancelled', medicationCodeableConcept: { text: 'Tab. Sample C' } },
        { resourceType: 'MedicationRequest', id: 'm4', status: 'entered-in-error', medicationCodeableConcept: { text: 'Tab. Sample D' } },
        { resourceType: 'Condition', id: 'c1', clinicalStatus: cc('active'), verificationStatus: cc('confirmed'), code: { text: 'Hypothyroidism' } },
        { resourceType: 'Condition', id: 'c2', verificationStatus: cc('refuted'), code: { text: 'Gestational diabetes' } },
        { resourceType: 'Condition', id: 'c3', clinicalStatus: cc('resolved'), code: { text: 'Urinary infection' } },
        { resourceType: 'Condition', id: 'c4', verificationStatus: cc('entered-in-error'), code: { text: 'Sample wrong diagnosis' } },
        { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'Haemoglobin' }, valueQuantity: { value: 11, unit: 'g/dL' } },
        { resourceType: 'Observation', id: 'o2', status: 'preliminary', code: { text: 'Platelets' }, valueQuantity: { value: 1.2, unit: 'lakh/µL' } },
        { resourceType: 'Observation', id: 'o3', status: 'entered-in-error', code: { text: 'TSH' }, valueQuantity: { value: 9, unit: 'mIU/L' } },
        { resourceType: 'DiagnosticReport', id: 'r1', status: 'partial', code: { text: 'Culture' } },
        { resourceType: 'Procedure', id: 'p1', status: 'not-done', code: { text: 'Cervical cerclage' } },
        { resourceType: 'ServiceRequest', id: 's1', status: 'revoked', code: { text: 'Repeat scan' } },
      ]),
    ).sections[0].lines.map((l) => l.text);
    expect(lines).toEqual([
      'Tab. Sample A 10 mg – 1-0-1',
      'Labetalol 100 mg – 1-1-1 (stopped)',
      'Tab. Sample C (cancelled)',
      `${ENTERED_IN_ERROR}: Tab. Sample D`,
      'Hypothyroidism',
      'Gestational diabetes (ruled out)',
      'Urinary infection (resolved)',
      `${ENTERED_IN_ERROR}: Sample wrong diagnosis`,
      'Haemoglobin: 11 g/dL',
      'Platelets: 1.2 lakh/µL (preliminary result)',
      `${ENTERED_IN_ERROR}: TSH: 9 mIU/L`,
      'Culture (partial report)',
      'Cervical cerclage (not done)',
      'Advised: Repeat scan (cancelled)',
    ]);
    // The whole document's status, and its own date only (never when the bundle was put together)
    expect(readDocument(bundleOf([], { status: 'entered-in-error' })).status).toBe('entered-in-error');
    expect(readDocument(bundleOf([], { status: 'preliminary' })).status).toBe('preliminary');
    expect(readDocument(bundleOf([], { status: 'final' })).status).toBe('');
    expect(readDocument({ ...bundleOf([], { date: undefined }), timestamp: '2026-10-05T06:00:00Z' }).date).toBeNull();
  });

  it('a dose sent only as structured parts is put into words; what cannot be read is said to be in the document', () => {
    const metformin = { resourceType: 'MedicationRequest', id: 'm', status: 'active', medicationCodeableConcept: { text: 'Metformin 500 mg' }, dosageInstruction: [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } }, route: { text: 'Oral' }, doseAndRate: [{ doseQuantity: { value: 1, unit: 'tablet' } }] }] };
    expect(readDocument(bundleOf([metformin])).sections[0].lines[0].text).toBe('Metformin 500 mg – Dose 1 tablet, twice a day, Oral');
    expect(dosageWords({ doseAndRate: [{ doseRange: { low: { value: 1, unit: 'tablet' }, high: { value: 2, unit: 'tablet' } } }], timing: { repeat: { frequency: 1, period: 8, periodUnit: 'h', duration: 5, durationUnit: 'd' } }, asNeededBoolean: true })).toBe('Dose 1 tablet – 2 tablet, every 8 hours, for 5 days, when needed');
    expect(dosageWords({ timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd', when: ['HS'] } }, additionalInstruction: [{ text: 'With water' }] })).toBe('once a day, at bedtime, With water');
    expect(dosageWords({ timing: { repeat: { frequency: 1, period: 1, periodUnit: 'wk', dayOfWeek: ['mon'], boundsDuration: { value: 4, unit: 'weeks' } } } })).toBe('once a week, on Monday, for 4 weeks');
    expect(dosageWords({ asNeededCodeableConcept: { text: 'pain' }, method: { text: 'Chew' } })).toBe('when needed for pain, Chew');
    // Parts Perinexa cannot read are never dropped silently
    expect(dosageWords({ maxDosePerPeriod: { numerator: { value: 4 }, denominator: { value: 1, unit: 'd' } } })).toBe(DOSE_IN_DOCUMENT);
    expect(dosageWords({ doseAndRate: [{ doseQuantity: { value: 2, unit: 'puffs' } }], site: { text: 'Left arm' } })).toBe(`Dose 2 puffs, ${DOSE_IN_DOCUMENT}`);
    expect(dosageWords({ text: 'As directed', doseAndRate: [{ doseQuantity: { value: 5, unit: 'mL' } }] })).toBe('As directed'); // the text says it all
  });
});

// ---------- Who may see and ask ----------

describe('who may see her records from other hospitals, and ask for them', () => {
  it('her doctor and RMOs ask; another doctor reads; nobody else; another hospital: not found', async () => {
    const p = await register();
    await linkAbha(p);
    expect(ok(await page('drA', p))).toMatchObject({ mode: 'practice', canAsk: true, abhaLinked: true, requests: [], documents: [] });
    expect(ok(await page('rmo', p)).canAsk).toBe(true);
    expect(ok(await page('drB', p)).canAsk).toBe(false);
    expect((await ask('drB', p)).status).toBe(403);
    for (const who of ['nurse', 'reception', 'lab', 'pharm', 'admin']) {
      expect((await page(who, p)).status, who).toBe(403);
      expect((await ask(who, p)).status, who).toBe(403);
    }
    expect((await page('outsider', p)).status).toBe(404);
    expect((await ask('outsider', p)).status).toBe(404);
    ok(await ask('rmo', p), 201);
    // Another doctor's record marked sensitive: not even the list
    ok(await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true }));
    expect((await page('drB', p)).status).toBe(403);
    expect(ok(await page('drA', p)).requests).toHaveLength(1);
  });

  it('what is asked: her ABHA first; the kinds, dates and days checked; a double click asks once; a closed record asks nothing', async () => {
    const p = await register();
    expect((await ask('drA', p)).body.error).toMatchObject({ code: 'NOT_LINKED', message: 'Link her ABHA to her record first.' });
    await linkAbha(p);
    expect((await ask('drA', p, { hiTypes: [] })).status).toBe(400);
    expect((await ask('drA', p, { hiTypes: ['Sample'] })).status).toBe(400);
    expect((await ask('drA', p, { days: 3 })).status).toBe(400);
    expect((await ask('drA', p, { from: '2026-10-05', to: '2026-10-01' })).status).toBe(400);
    expect((await ask('drA', p, { to: '2026-10-06' })).body.error).toMatchObject({ fields: { to: 'Today at the latest.' } });
    const clientRequestId = randomUUID();
    const first = ok(await ask('drA', p, { clientRequestId }), 201).request;
    expect(ok(await ask('drA', p, { clientRequestId }), 201).request.id).toBe(first.id);
    expect(await AbdmFetchRequest.countDocuments({ tenantId: hospital._id })).toBe(1);
    // A double click at the same moment, while ABDM is slow to answer: one request, asked of ABDM once
    const slow = { ...practiceClient, consentRequestInit: vi.fn(async (body, extra) => new Promise((done) => setTimeout(() => done(practiceClient.consentRequestInit(body, extra)), 150))) };
    setAbdmClientForTests(slow);
    const twice = randomUUID();
    const [a, b] = await Promise.all([ask('drA', p, { clientRequestId: twice }), ask('drA', p, { clientRequestId: twice })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.request.id).toBe(b.body.request.id);
    expect(slow.consentRequestInit).toHaveBeenCalledTimes(1);
    expect(await AbdmFetchRequest.countDocuments({ tenantId: hospital._id })).toBe(2);
    // ABDM refuses: the doctor is told, and nothing is kept
    setAbdmClientForTests({
      ...practiceClient,
      consentRequestInit: async () => {
        throw new HttpError(502, 'ABDM did not accept the request (400): sample refusal.', 'ABDM');
      },
    });
    expect((await ask('drA', p)).status).toBe(502);
    expect(await AbdmFetchRequest.countDocuments({ tenantId: hospital._id })).toBe(2);
    setAbdmClientForTests(null);
    // A closed record (a death recorded) takes no new request
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { death: { on: new Date('2026-10-04T00:00:00Z'), by: people.drA._id, byName: 'Sample drA', at: NOW } } });
    expect((await ask('drA', p)).body.error.code).toBe('RECORD_CLOSED');
  });
});

// ---------- Practice: ask, she agrees, her records arrive ----------

describe('practice: ask, she agrees, the made-up hospitals send her records', () => {
  it('the request to her ABHA app: care management, the kinds, dates and how long; the doctor as the requester', async () => {
    const p = await register();
    await linkAbha(p);
    const { request: r } = ok(await ask('drA', p, { hiTypes: ['DiagnosticReport', 'OPConsultation'], days: 90 }), 201);
    expect(r.status).toBe('waiting');
    const sent = practiceSent().find((x) => x.call === 'consent-request-init').body;
    expect(sent.consent).toMatchObject({
      purpose: { code: 'CAREMGT', text: 'Care Management' },
      patient: { id: 'sample.abha.mother@sbx' },
      requester: { name: 'Sample drA', identifier: { type: 'REGNO', value: 'MMC-SAMPLE-1234' } },
      hiTypes: ['DiagnosticReport', 'OPConsultation'],
      permission: { accessMode: 'VIEW', dateRange: { from: '2025-10-04T18:30:00.000Z', to: '2026-10-05T18:29:59.999Z' }, dataEraseAt: new Date(NOW.getTime() + 90 * DAY).toISOString() },
    });
    const view = ok(await page('drA', p)).requests[0];
    expect(view).toMatchObject({ status: 'waiting', byName: 'Sample drA', purpose: 'Care management', hiTypes: ['DiagnosticReport', 'OPConsultation'], days: 90, practice: true, hospitals: [] });
    const asked = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_FETCH_REQUESTED' }).lean();
    expect(asked.details).toEqual({ patientId: p.id, mrn: p.mrn, requestId: r.id, types: 2, days: 90, practice: true });
  });

  it('she agrees: each hospital’s records are decrypted, read and kept read-only, the baby’s sex withheld; the files; the audit log', async () => {
    const { p, requestId } = await fetched();
    const view = ok(await page('drA', p));
    const r = view.requests[0];
    expect(r.status).toBe('granted');
    expect(r.hospitals.map((h) => [h.hipName, h.step, h.documents, h.files, h.filesLeftOut, h.withheld, h.failed])).toEqual([
      ['Sample City Hospital (practice)', 'received', 3, 1, 1, 1, 0],
      ['Sample Town Lab (practice)', 'received', 2, 0, 0, 0, 0],
    ]);
    expect(r.hospitals[0]).toMatchObject({ status: 'GRANTED', records: 2, canFetchAgain: false, expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString() });
    // The list: type, date, hospital – newest first
    expect(view.documents.map((d) => [d.hiType, d.title, d.hospital, d.date.slice(0, 10)])).toEqual([
      ['DiagnosticReport', 'Diagnostic report', 'Sample Town Lab (practice)', '2026-09-15'],
      ['OPConsultation', 'Consultation report', 'Sample City Hospital (practice)', '2026-08-26'],
      ['Prescription', 'Prescription', 'Sample City Hospital (practice)', '2026-08-26'],
      ['ImmunizationRecord', 'Immunization record', 'Sample Town Lab (practice)', '2026-08-06'],
      ['DischargeSummary', 'Discharge summary', 'Sample City Hospital (practice)', '2026-06-27'],
    ]);
    expect(view.documents.find((d) => d.hiType === 'OPConsultation')).toMatchObject({ withheld: 1, files: 1, filesLeftOut: 1, practice: true });

    // One document, read-only, as the doctor reads it
    const op = view.documents.find((d) => d.hiType === 'OPConsultation');
    const doc = ok(await get('drA', `/patients/${p.id}/fetched/${op.id}`)).document;
    // Made up, and said so: never her own name in a practice document
    expect(doc).toMatchObject({ title: 'Consultation report', hospital: 'Sample City Hospital (practice)', documentHospital: 'Sample City Hospital (practice)', authors: ['Dr Practice Sample'], nameInDocument: 'Practice patient (made up)', checksumOk: true, withheld: 1, practice: true, documentStatus: '' });
    expect(doc.sections.find((s) => s.title === 'Diagnosis').lines[0].text).toBe('Practice: mild anaemia in pregnancy');
    expect(doc.filesLeftOut).toEqual([{ title: 'Practice web page', contentType: 'text/html', why: 'type' }]);
    // The file: a download, named by its kind, never shown inside the page
    const file = await (await as('drA')).get(`/api/abdm/patients/${p.id}/fetched/${op.id}/files/${doc.files[0].id}`).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe('attachment; filename="record-from-another-hospital.pdf"');
    expect(file.headers['content-security-policy']).toMatch(/sandbox/);
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');

    // The sentence about the baby's sex was never stored anywhere
    const raw = (name) => mongoose.connection.db.collection(name).find({}).toArray();
    const stored = JSON.stringify([await raw('abdmfetchedrecords'), await raw('abdmfetchrequests')]);
    expect(stored).not.toContain(PRACTICE_SEX_SENTENCE);
    expect(stored).not.toMatch(/privateRaw|private/i); // no key is ever kept
    // ABDM was told what arrived; the key that went out is a public key only
    const asked = practiceSent().filter((x) => x.call === 'health-information-request').map((x) => x.body);
    expect(asked).toHaveLength(2);
    for (const a of asked) {
      expect(a.keyMaterial).toMatchObject({ cryptoAlg: 'ECDH', curve: 'Curve25519', dhPublicKey: { keyValue: expect.any(String) }, nonce: expect.any(String) });
      expect(Object.keys(a.keyMaterial)).not.toContain('privateRaw');
    }
    const told = practiceSent().filter((x) => x.call === 'hiu-health-information-notify').map((x) => x.body);
    expect(told.map((t) => t.sessionStatus)).toEqual(['TRANSFERRED', 'TRANSFERRED']);
    expect(told[0].statusResponses.every((s) => s.hiStatus === 'OK')).toBe(true);

    // The audit log: ids and counts only
    const entries = await AuditLog.find({ tenantId: hospital._id, action: { $in: FETCH_ACTIONS } }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(entries.map((e) => e.action)).toEqual(['ABDM_FETCH_REQUESTED', 'ABDM_FETCH_ANSWERED', 'ABDM_RECORDS_FETCHED', 'ABDM_RECORDS_FETCHED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_VIEWED']);
    expect(entries[1].details).toEqual({ patientId: p.id, mrn: p.mrn, requestId, status: 'GRANTED', hospitals: 2, practice: true });
    expect(entries[2].details).toMatchObject({ patientId: p.id, mrn: p.mrn, requestId, hospitals: 1, documents: 3, files: 1, filesLeftOut: 1, withheld: 1, failed: 0, practice: true });
    expect(entries.slice(4).map((e) => e.details)).toEqual([
      { patientId: p.id, mrn: p.mrn, documents: 5 },
      { patientId: p.id, mrn: p.mrn, recordId: op.id },
      { patientId: p.id, mrn: p.mrn, recordId: op.id, fileId: doc.files[0].id },
    ]);
    for (const word of CONTENT) expect(JSON.stringify(entries), word).not.toContain(word);

    // Another doctor of a record that is not sensitive reads them too; nobody else; another hospital: not found
    expect(ok(await get('drB', `/patients/${p.id}/fetched/${op.id}`)).document.title).toBe('Consultation report');
    for (const who of ['nurse', 'reception', 'lab', 'pharm', 'admin']) expect((await get(who, `/patients/${p.id}/fetched/${op.id}`)).status, who).toBe(403);
    expect((await get('outsider', `/patients/${p.id}/fetched/${op.id}`)).status).toBe(404);
    const otherPatient = await register('Second Fetch Mother');
    expect((await get('drA', `/patients/${otherPatient.id}/fetched/${op.id}`)).status).toBe(404); // not under another patient
  });

  it('only the kinds and dates asked for; she refuses: nothing comes', async () => {
    // Lab reports of the last 30 days: the lab's CBC of 20 days ago only
    const { p } = await fetched({ body: { hiTypes: ['DiagnosticReport', 'ImmunizationRecord'], from: '2026-09-05' } });
    const docs = ok(await page('drA', p)).documents;
    expect(docs.map((d) => d.hiType)).toEqual(['DiagnosticReport']);
    // She refuses
    const q = await register('Refusing Mother');
    await linkAbha(q, '91-4444-5555-6666');
    const { request: r } = ok(await ask('drA', q), 201);
    expect(ok(await post('drA', `/fetch/${r.id}/practice/answer`, { approve: false })).request.status).toBe('denied');
    expect(ok(await page('drA', q))).toMatchObject({ requests: [{ status: 'denied', hospitals: [] }], documents: [] });
    expect((await post('drA', `/fetch/${r.id}/practice/answer`, { approve: true })).body.error.code).toBe('ANSWERED');
    const answer = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_FETCH_ANSWERED', 'details.status': 'DENIED' }).lean();
    expect(answer.details).toMatchObject({ mrn: q.mrn, hospitals: 0 });
    // Another doctor cannot answer for her (practice), another hospital cannot see the request
    expect((await post('drB', `/fetch/${r.id}/practice/answer`, { approve: true })).status).toBe(403);
    expect((await post('outsider', `/fetch/${r.id}/practice/answer`, { approve: true })).status).toBe(404);
  });

  it('never copied into her own visits, lab results or documents, never in the copy of her record or the hospital export', async () => {
    const { p } = await fetched();
    expect(await Visit.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(await LabOrder.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(await ClinicalDocument.countDocuments({ tenantId: hospital._id })).toBe(0);
    const copy = ok(await (await as('drA')).get(`/api/patients/${p.id}/record-copy`));
    for (const word of CONTENT) expect(JSON.stringify(copy), word).not.toContain(word);
    expect(Object.keys(LEFT_OUT)).toEqual(expect.arrayContaining(['AbdmFetchedRecord', 'AbdmFetchedFile']));
    expect(LEFT_OUT.AbdmFetchedRecord).toMatch(/never sent on/);
  });
});

// ---------- Deleted when her consent ends ----------

describe('deleted when her consent ends or she withdraws it', () => {
  const counts = async () => [await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id }), await AbdmFetchedFile.countDocuments({ tenantId: hospital._id })];

  it('she withdraws it: every document and file deleted at once; the list says so; opening one: not found', async () => {
    const { p, requestId } = await fetched();
    const docId = ok(await page('drA', p)).documents[0].id;
    expect(await counts()).toEqual([5, 1]);
    expect(ok(await post('drA', `/fetch/${requestId}/practice/end`, { status: 'REVOKED' })).request.status).toBe('revoked');
    expect(await counts()).toEqual([0, 0]);
    const view = ok(await page('drA', p));
    expect(view.documents).toEqual([]);
    expect(view.requests[0].hospitals.map((h) => [h.status, h.step, h.deletedWhy])).toEqual([
      ['REVOKED', 'deleted', 'revoked'],
      ['REVOKED', 'deleted', 'revoked'],
    ]);
    expect((await get('drA', `/patients/${p.id}/fetched/${docId}`)).body.error.message).toMatch(/consent has ended, or it was withdrawn/);
    const deleted = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_FETCHED_DELETED' }).sort({ _id: 1 }).lean();
    expect(deleted.map((e) => [e.details.why, e.details.documents, e.details.files])).toEqual([
      ['revoked', 3, 1],
      ['revoked', 2, 0],
    ]);
    expect((await post('drA', `/fetch/${requestId}/practice/end`, { status: 'EXPIRED' })).body.error.code).toBe('NOT_GRANTED');
  });

  it('ABDM says it ended: deleted at once', async () => {
    const { p, requestId } = await fetched();
    expect(ok(await post('drA', `/fetch/${requestId}/practice/end`, { status: 'EXPIRED' })).request.status).toBe('expired');
    expect(await counts()).toEqual([0, 0]);
    expect(ok(await page('drA', p)).requests[0].hospitals.every((h) => h.deletedWhy === 'expired')).toBe(true);
  });

  it('its time passes: deleted by the round every 15 minutes, and before anything is shown; a request never answered expires', async () => {
    const { p } = await fetched({ body: { days: 7 } });
    const unanswered = await register('Silent Mother');
    await linkAbha(unanswered, '91-4444-5555-6666');
    ok(await ask('drA', unanswered, { days: 7 }), 201);
    vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY - 60_000));
    expect(await expireAllDue(new Date())).toBe(0);
    expect(await counts()).toEqual([5, 1]);
    vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY + 60_000));
    expect(await expireAllDue(new Date())).toBe(5);
    expect(await counts()).toEqual([0, 0]);
    const deleted = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_FETCHED_DELETED' }).lean();
    expect(deleted.map((e) => [e.actor, e.details.why, e.details.documents])).toEqual([
      [null, 'expired', 3],
      [null, 'expired', 2],
    ]);
    sessions = {}; // signed in again a week later
    const view = ok(await page('drA', p));
    expect(view.requests[0].status).toBe('expired');
    expect(view.requests[0].hospitals.map((h) => [h.status, h.step, h.deletedWhy])).toEqual([
      ['EXPIRED', 'deleted', 'expired'],
      ['EXPIRED', 'deleted', 'expired'],
    ]);
    expect(ok(await page('drA', unanswered)).requests[0]).toMatchObject({ status: 'expired', agreed: false });
  });

  it('she agreed but no hospital had records: the request ends when its time passes, and says she agreed', async () => {
    const { p } = await fetched({ body: { hiTypes: ['WellnessRecord'], days: 7 } }); // no practice hospital has one
    expect(ok(await page('drA', p)).requests[0]).toMatchObject({ status: 'granted', agreed: true, hospitals: [] });
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
    sessions = {};
    expect(ok(await page('drA', p)).requests[0]).toMatchObject({ status: 'expired', agreed: true, hospitals: [] });
  });

  it('opening her records after the time has passed deletes them first, even before the round', async () => {
    const { p } = await fetched({ body: { days: 7 } });
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
    sessions = {};
    expect(ok(await page('drA', p)).documents).toEqual([]);
    expect(await counts()).toEqual([0, 0]);
  });
});

// ---------- From ABDM (a stand-in for the sandbox: the same addresses ABDM calls, signed) ----------

describe('from ABDM (sandbox stand-in): her answer, the consent, the records pushed by the other hospital', () => {
  const HIU = 'IN2710000099';
  let calls;
  function sandbox() {
    calls = [];
    const record = (call, answer = undefined) => async (body) => {
      calls.push({ call, body });
      return answer;
    };
    setAbdmClientForTests({
      ...practiceClient,
      mode: 'sandbox',
      async verifyRequest(auth) {
        if (auth !== 'Bearer signed-by-abdm') throw new HttpError(401, 'Not signed by ABDM.', 'NOT_AUTHENTICATED');
      },
      consentRequestInit: record('init', {}),
      hiuOnNotify: record('on-notify'),
      fetchConsent: record('fetch', {}),
      requestHealthInfo: record('hi-request', {}),
      healthInfoNotifyHiu: record('notify'),
    });
  }
  const last = (call) => calls.filter((c) => c.call === call).at(-1)?.body;
  const fromAbdm = (path, body, { signed = true, hiu = HIU } = {}) => {
    const r = request(app).post(`/api/abdm/public/api/v3${path}`).set('REQUEST-ID', randomUUID());
    if (hiu) r.set('X-HIU-ID', hiu);
    if (signed) r.set('Authorization', 'Bearer signed-by-abdm');
    return r.send(body);
  };
  const push = (body, hiu = HIU) => request(app).post(`/api/abdm/public/api/v3/hiu/data/push/${hiu}`).send(body);
  const CONSENT = 'ca-sample-1';
  const detail = (extra = {}) => ({
    consentId: CONSENT,
    patient: { id: 'sample.abha.mother@sbx' },
    hip: { id: 'HIP-SAMPLE-OTHER', name: 'Sample Other Hospital' },
    hiu: { id: HIU },
    careContexts: [
      { patientReference: 'OTHER-1', careContextReference: 'CC-1' },
      { patientReference: 'OTHER-1', careContextReference: 'CC-2' },
    ],
    hiTypes: ['OPConsultation', 'DiagnosticReport'],
    permission: { accessMode: 'VIEW', dateRange: { from: '2025-10-04T18:30:00Z', to: '2026-10-05T18:29:59Z' }, dataEraseAt: '2026-10-20T00:00:00Z' },
    ...extra,
  });
  /** As the other hospital: a FHIR document encrypted for Perinexa's key of this request. */
  const entry = (keyMaterial, reference, hipId = 'PRACTICE-HIP-CITY', ref = 'CITY-OPD-40', hiType = 'OPConsultation') => {
    const [d] = practiceDocuments(hipId, ref, { hiTypes: [hiType], patientName: 'Sample Abha Mother', now: NOW });
    const text = JSON.stringify(d.bundle);
    const out = encryptFor({ text, requester: { publicKey: keyMaterial.dhPublicKey.keyValue, nonce: keyMaterial.nonce } });
    return { entry: { content: out.encryptedData, media: 'application/fhir+json', checksum: checksumOf(text), careContextReference: reference }, keyMaterial: out.keyMaterial };
  };

  /** Asked, her ABHA app said yes, the consent's details came and the records were asked for: { p, r, km, dataRequestId }. */
  async function upToTheRecords() {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIU } });
    config.ABDM_PUBLIC_URL = 'https://perinexa.example.in';
    const p = await register();
    await linkAbha(p);
    sandbox();
    const { request: r } = ok(await ask('drA', p), 201);
    expect(r.status).toBe('requested');
    const init = calls.find((c) => c.call === 'init').body;
    expect(init).toMatchObject({ hiuId: HIU, consent: { hiu: { id: HIU }, patient: { id: 'sample.abha.mother@sbx' } } });
    expect((await fromAbdm('/hiu/consent/request/on-init', { consentRequest: { id: 'cr-sample-1' }, response: { requestId: init.requestId } })).status).toBe(202);
    await abdmIdle();
    expect(ok(await page('drA', p)).requests[0].status).toBe('waiting');
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-sample-1', status: 'GRANTED', consentArtefacts: [{ id: CONSENT }] } });
    await abdmIdle();
    expect(last('on-notify')).toMatchObject({ hiuId: HIU, consentIds: [CONSENT] });
    const fetch = last('fetch');
    expect(fetch).toMatchObject({ hiuId: HIU, consentId: CONSENT });
    await fromAbdm('/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: detail() }, response: { requestId: fetch.requestId } }, { hiu: null }); // the HIU ID from the consent
    await abdmIdle();
    const hi = last('hi-request');
    expect(hi).toMatchObject({ hiuId: HIU, consentId: CONSENT, dataPushUrl: `https://perinexa.example.in/api/abdm/public/api/v3/hiu/data/push/${HIU}`, dateRange: { from: '2025-10-04T18:30:00.000Z' } });
    await fromAbdm('/hiu/health-information/on-request', { hiRequest: { transactionId: 'tx-sample-1', sessionStatus: 'REQUESTED' }, response: { requestId: hi.requestId } });
    await abdmIdle();
    return { p, r, km: hi.keyMaterial, dataRequestId: hi.requestId };
  }

  it('refuses unsigned messages and unknown hospitals; the records pushed page by page, only those in her consent; ABDM told', async () => {
    const { p, km } = await upToTheRecords();
    expect((await fromAbdm('/hiu/consent/request/notify', {}, { signed: false })).status).toBe(401);
    expect((await fromAbdm('/hiu/consent/request/notify', {}, { hiu: 'IN0000000000' })).status).toBe(404);
    const view = ok(await page('drA', p)).requests[0];
    expect(view.hospitals).toEqual([expect.objectContaining({ hipName: 'Sample Other Hospital', step: 'asked', records: 2, expiresAt: '2026-10-20T00:00:00.000Z' })]); // her app's end date: earlier than asked
    // Nobody is waiting for this transfer, or at this hospital
    expect((await push({ transactionId: 'tx-unknown', pageNumber: 1, pageCount: 1, entries: [] })).status).toBe(404);
    expect((await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 1, entries: [] }, 'IN0000000000')).status).toBe(404);
    // Page 1 of 2: the consultation
    const one = entry(km, 'CC-1');
    expect((await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 2, entries: [one.entry], keyMaterial: one.keyMaterial })).status).toBe(202);
    await abdmIdle();
    // The same page again: kept once
    await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 2, entries: [one.entry], keyMaterial: one.keyMaterial });
    await abdmIdle();
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect(last('notify')).toBeUndefined();
    // Page 2: the lab report, one record that is not in her consent, and one changed on the way (all with one key)
    const two = entry(km, 'CC-2', 'PRACTICE-HIP-LAB', 'LAB-CBC-20', 'DiagnosticReport');
    const stranger = { ...two.entry, careContextReference: 'CC-9' };
    const bytes = Buffer.from(two.entry.content, 'base64');
    bytes[3] ^= 1;
    const changed = { ...two.entry, content: bytes.toString('base64') };
    await push({ transactionId: 'tx-sample-1', pageNumber: 2, pageCount: 2, entries: [two.entry, stranger, changed], keyMaterial: two.keyMaterial });
    await abdmIdle();
    const docs = await AbdmFetchedRecord.find({ tenantId: hospital._id }).lean();
    expect(docs.map((d) => [d.careContextReference, d.hipName, d.checksumOk]).sort()).toEqual([
      ['CC-1', 'Sample Other Hospital', true],
      ['CC-2', 'Sample Other Hospital', true],
    ]);
    expect(last('notify')).toMatchObject({
      hiuId: HIU,
      consentId: CONSENT,
      transactionId: 'tx-sample-1',
      hipId: 'HIP-SAMPLE-OTHER',
      sessionStatus: 'TRANSFERRED',
      statusResponses: [
        { careContextReference: 'CC-1', hiStatus: 'OK', description: 'Received' },
        { careContextReference: 'CC-2', hiStatus: 'OK', description: 'Received' },
      ],
    });
    expect(ok(await page('drA', p)).requests[0].hospitals[0]).toMatchObject({ step: 'received', documents: 2, failed: 2 });
    const fetchedEntry = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_RECORDS_FETCHED' }).lean();
    expect(fetchedEntry).toMatchObject({ actor: null, details: { transactionId: 'tx-sample-1', consentId: CONSENT, documents: 2, failed: 2, practice: false } });
    // After it was received: no more pages
    expect((await push({ transactionId: 'tx-sample-1', pageNumber: 2, pageCount: 2, entries: [two.entry], keyMaterial: two.keyMaterial })).status).toBe(404);
    // ABDM: she withdrew it – deleted at once
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-sample-1', status: 'REVOKED', consentArtefacts: [{ id: CONSENT }] } });
    await abdmIdle();
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(ok(await page('drA', p)).requests[0]).toMatchObject({ status: 'revoked', hospitals: [expect.objectContaining({ step: 'deleted', deletedWhy: 'revoked' })] });
  });

  it('the key is gone (a restart): nothing can be read – "Fetch again" asks with a new key; a checksum that does not match is marked', async () => {
    const { p, r, km, dataRequestId } = await upToTheRecords();
    forgetKeysForTests();
    const one = entry(km, 'CC-1');
    await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 1, entries: [one.entry], keyMaterial: one.keyMaterial });
    await abdmIdle();
    let h = ok(await page('drA', p)).requests[0].hospitals[0];
    expect(h).toMatchObject({ step: 'failed', canFetchAgain: true, documents: 0 });
    expect(h.error).toMatch(/Fetch again/);
    expect(last('notify')).toMatchObject({ sessionStatus: 'FAILED' });
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    // Another doctor may read, but not ask again
    expect((await post('drB', `/fetch/${r.id}/hospitals/${CONSENT}/again`, {})).status).toBe(403);
    ok(await post('drA', `/fetch/${r.id}/hospitals/${CONSENT}/again`, {}));
    const again = last('hi-request');
    expect(again.requestId).not.toBe(dataRequestId);
    expect(again.keyMaterial.dhPublicKey.keyValue).not.toBe(km.dhPublicKey.keyValue);
    await fromAbdm('/hiu/health-information/on-request', { hiRequest: { transactionId: 'tx-sample-2', sessionStatus: 'REQUESTED' }, response: { requestId: again.requestId } });
    await abdmIdle();
    const fresh = entry(again.keyMaterial, 'CC-1');
    await push({ transactionId: 'tx-sample-2', pageNumber: 1, pageCount: 1, entries: [{ ...fresh.entry, checksum: 'not-the-checksum' }], keyMaterial: fresh.keyMaterial });
    await abdmIdle();
    h = ok(await page('drA', p)).requests[0].hospitals[0];
    expect(h).toMatchObject({ step: 'received', documents: 1, canFetchAgain: false });
    const [doc] = ok(await page('drA', p)).documents;
    expect(ok(await get('drA', `/patients/${p.id}/fetched/${doc.id}`)).document.checksumOk).toBe(false);
  });

  it('nothing came for 30 minutes: "Fetch again"; the same answer twice is one; records that come after the consent ended are not kept', async () => {
    const { p, r } = await upToTheRecords();
    // ABDM sends her answer again: nothing new is asked, nothing new in the audit log
    const before = calls.length;
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-sample-1', status: 'GRANTED', consentArtefacts: [{ id: CONSENT }] } });
    await abdmIdle();
    expect(calls.slice(before).map((c) => c.call)).toEqual(['on-notify']);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'ABDM_FETCH_ANSWERED' })).toBe(1);
    // Waiting for the records: "Fetch again" only after 30 minutes
    expect(ok(await page('drA', p)).requests[0].hospitals[0]).toMatchObject({ step: 'asked', canFetchAgain: false });
    expect((await post('drA', `/fetch/${r.id}/hospitals/${CONSENT}/again`, {})).body.error.code).toBe('NOT_NOW');
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    sessions = {};
    expect(ok(await page('drA', p)).requests[0].hospitals[0].canFetchAgain).toBe(true);
    ok(await post('drA', `/fetch/${r.id}/hospitals/${CONSENT}/again`, {}));
    const again = last('hi-request');
    await fromAbdm('/hiu/health-information/on-request', { hiRequest: { transactionId: 'tx-sample-3', sessionStatus: 'REQUESTED' }, response: { requestId: again.requestId } });
    await abdmIdle();
    // The earlier transfer is not waited for any more
    expect((await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 1, entries: [] })).status).toBe(404);
    // Her consent (her app: until 20 Oct) ends before the records come: nothing is kept
    vi.setSystemTime(new Date('2026-10-20T00:00:01Z'));
    const late = entry(again.keyMaterial, 'CC-1');
    expect((await push({ transactionId: 'tx-sample-3', pageNumber: 1, pageCount: 1, entries: [late.entry], keyMaterial: late.keyMaterial })).status).toBe(202);
    await abdmIdle();
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(last('notify')).toMatchObject({ transactionId: 'tx-sample-3', sessionStatus: 'FAILED' });
    sessions = {};
    const h = ok(await page('drA', p)).requests[0].hospitals[0];
    expect(h).toMatchObject({ step: 'deleted', status: 'EXPIRED', canFetchAgain: false });
  });

  it('a consent for another ABHA asks for nothing; a push in practice mode is refused; the admin sees the M3 checklist', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIU } });
    config.ABDM_PUBLIC_URL = 'https://perinexa.example.in';
    const p = await register();
    await linkAbha(p);
    sandbox();
    ok(await ask('drA', p), 201);
    const init = last('init');
    await fromAbdm('/hiu/consent/request/on-init', { consentRequest: { id: 'cr-sample-2' }, response: { requestId: init.requestId } });
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-sample-2', status: 'GRANTED', consentArtefacts: [{ id: CONSENT }] } });
    await abdmIdle();
    await fromAbdm('/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: detail({ patient: { id: 'someone.else@sbx' } }) }, response: { requestId: last('fetch').requestId } });
    await abdmIdle();
    expect(last('hi-request')).toBeUndefined();
    expect(ok(await page('drA', p)).requests[0].hospitals[0]).toMatchObject({ step: 'failed', error: 'The consent is for another ABHA: nothing was asked for.' });
    // Not set up: no HIP ID, or not on the internet
    config.ABDM_PUBLIC_URL = '';
    expect((await ask('drA', p)).body.error.code).toBe('NO_PUBLIC_URL');
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': '' } });
    expect((await ask('drA', p)).body.error.code).toBe('NO_HIP_ID');
    setAbdmClientForTests(null);
    expect((await push({ transactionId: 'x', pageNumber: 1, pageCount: 1, entries: [] })).status).toBe(404);
    const status = ok(await (await as('admin')).get('/api/abdm/status'));
    expect(status.checklistM3).toEqual(ABDM_CHECKLIST_M3);
    expect(status.callbacksM3).toEqual(expect.arrayContaining(['/api/v3/hiu/consent/request/notify', '/api/v3/hiu/data/push/<HIU ID>']));
    expect(ok(await (await as('drA')).get('/api/abdm/status')).checklistM3).toBeUndefined();
  });

  it('ABDM answering before its call returns still finds the request, and her "yes" then brings the records', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIU } });
    config.ABDM_PUBLIC_URL = 'https://perinexa.example.in';
    const p = await register();
    await linkAbha(p);
    sandbox();
    // ABDM's on-init arrives (and is handled) while Perinexa's consent request is still on its way
    setAbdmClientForTests({
      ...abdmClient(),
      consentRequestInit: async (body) => {
        calls.push({ call: 'init', body });
        await fromAbdm('/hiu/consent/request/on-init', { consentRequest: { id: 'cr-fast-1' }, response: { requestId: body.requestId } });
        await abdmIdle();
        return {};
      },
    });
    const { request: r } = ok(await ask('drA', p), 201);
    expect(r.status).toBe('waiting');
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-fast-1', status: 'GRANTED', consentArtefacts: [{ id: CONSENT }] } });
    await abdmIdle();
    expect(last('fetch')).toMatchObject({ consentId: CONSENT });
    expect(ok(await page('drA', p)).requests[0]).toMatchObject({ status: 'granted', hospitals: [expect.objectContaining({ consentId: CONSENT, step: 'details' })] });
  });

  it('the same "she agreed" twice at the same moment adds the hospital once and asks once', async () => {
    const { p } = await upToTheRecords();
    // A second consent for another hospital, sent twice at once
    const before = calls.filter((c) => c.call === 'fetch').length;
    const twice = { notification: { consentRequestId: 'cr-sample-1', status: 'GRANTED', consentArtefacts: [{ id: CONSENT }, { id: 'ca-sample-2' }] } };
    await Promise.all([fromAbdm('/hiu/consent/request/notify', twice), fromAbdm('/hiu/consent/request/notify', twice)]);
    await abdmIdle();
    expect(calls.filter((c) => c.call === 'fetch').slice(before).map((c) => c.body.consentId)).toEqual(['ca-sample-2']);
    expect(ok(await page('drA', p)).requests[0].hospitals.map((h) => h.consentId)).toEqual([CONSENT, 'ca-sample-2']);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'ABDM_FETCH_ANSWERED' })).toBe(2); // the first answer, and this one once
  });

  it('a page still being read when she withdraws her consent keeps nothing; a record left under an ended consent is never shown and is deleted', async () => {
    const { p, r, km } = await upToTheRecords();
    const tenant = await Tenant.findById(hospital._id).lean();
    const realSave = AbdmFetchedRecord.prototype.save;
    let first = true;
    // She withdraws her consent while the page is being read (between reading the page and saving the document)
    AbdmFetchedRecord.prototype.save = async function save(...args) {
      if (first) {
        first = false;
        await consentNotify({ tenantId: hospital._id, now: new Date() }, tenant, { notification: { consentRequestId: 'cr-sample-1', status: 'REVOKED', consentArtefacts: [{ id: CONSENT }] } });
      }
      return realSave.apply(this, args);
    };
    try {
      const one = entry(km, 'CC-1');
      expect((await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 2, entries: [one.entry], keyMaterial: one.keyMaterial })).status).toBe(202);
      await abdmIdle();
    } finally {
      delete AbdmFetchedRecord.prototype.save;
    }
    expect(first).toBe(false);
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(await AbdmFetchedFile.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect(ok(await page('drA', p)).requests[0].hospitals[0]).toMatchObject({ status: 'REVOKED', step: 'deleted', deletedWhy: 'revoked' });

    // A document somehow left under the withdrawn consent (e.g. the server stopped half-way): never shown, deleted
    const left = await AbdmFetchedRecord.create({ tenantId: hospital._id, patientId: p.id, requestId: r.id, consentId: CONSENT, transactionId: 'tx-sample-1', title: 'Sample left over', expiresAt: new Date(NOW.getTime() + 10 * DAY) });
    expect((await get('drA', `/patients/${p.id}/fetched/${left._id}`)).status).toBe(404);
    expect(ok(await page('drA', p)).documents).toEqual([]);
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    const deleted = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_FETCHED_DELETED' }).sort({ _id: 1 }).lean();
    expect(deleted.at(-1).details).toMatchObject({ consentId: CONSENT, why: 'revoked', documents: 1 });
  });

  it('more pages than Perinexa takes in one transfer: said plainly, ABDM told, nothing read', async () => {
    const { p, km } = await upToTheRecords();
    const one = entry(km, 'CC-1');
    await push({ transactionId: 'tx-sample-1', pageNumber: 1, pageCount: 501, entries: [one.entry], keyMaterial: one.keyMaterial });
    await abdmIdle();
    expect(await AbdmFetchedRecord.countDocuments({ tenantId: hospital._id })).toBe(0);
    const h = ok(await page('drA', p)).requests[0].hospitals[0];
    expect(h).toMatchObject({ step: 'failed', canFetchAgain: true });
    expect(h.error).toMatch(/more than 500 pages at once/);
    expect(last('notify')).toMatchObject({ transactionId: 'tx-sample-1', sessionStatus: 'FAILED' });
  });

  it('a push is refused before its body is read: in practice mode, and for an unknown HIU ID', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIU } });
    const notJson = (hiu) => request(app).post(`/api/abdm/public/api/v3/hiu/data/push/${hiu}`).set('Content-Type', 'application/json').send('{ not json');
    expect((await notJson(HIU)).status).toBe(404); // practice mode
    sandbox();
    expect((await notJson('IN0000000000')).status).toBe(404); // nobody here has this HIU ID
    expect((await notJson(HIU)).status).toBe(400); // this hospital: the body is read (and is not JSON)
  });

  it('a consent that does not name her ABHA or this hospital asks for nothing', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIU } });
    config.ABDM_PUBLIC_URL = 'https://perinexa.example.in';
    const p = await register();
    await linkAbha(p);
    sandbox();
    ok(await ask('drA', p), 201);
    await fromAbdm('/hiu/consent/request/on-init', { consentRequest: { id: 'cr-sample-3' }, response: { requestId: last('init').requestId } });
    await fromAbdm('/hiu/consent/request/notify', { notification: { consentRequestId: 'cr-sample-3', status: 'GRANTED', consentArtefacts: [{ id: 'ca-no-abha' }, { id: 'ca-other-hiu' }] } });
    await abdmIdle();
    const fetches = calls.filter((c) => c.call === 'fetch').map((c) => c.body);
    const noAbha = { ...detail({ patient: {} }), consentId: 'ca-no-abha' };
    const otherHiu = { ...detail({ hiu: { id: 'IN0000000077' } }), consentId: 'ca-other-hiu' };
    await fromAbdm('/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: noAbha }, response: { requestId: fetches.find((f) => f.consentId === 'ca-no-abha').requestId } });
    await fromAbdm('/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: otherHiu }, response: { requestId: fetches.find((f) => f.consentId === 'ca-other-hiu').requestId } });
    await abdmIdle();
    expect(last('hi-request')).toBeUndefined();
    expect(ok(await page('drA', p)).requests[0].hospitals.map((h) => [h.consentId, h.step, h.error])).toEqual([
      ['ca-no-abha', 'failed', 'The consent is for another ABHA: nothing was asked for.'],
      ['ca-other-hiu', 'failed', 'The consent is for another hospital: nothing was asked for.'],
    ]);
  });
});

// ---------- The audit log ----------

describe('the audit log', () => {
  it('ids and counts for the hospital; counts only for the platform', () => {
    const details = { patientId: 'p', mrn: 'P-000001', requestId: 'r', consentId: 'c', transactionId: 't', recordId: 'd', documents: 3, files: 1, withheld: 1, hospital: 'Sample City Hospital', title: 'x', why: 'expired', practice: true };
    expect(safeAuditDetails('ABDM_RECORDS_FETCHED', details)).toEqual({ patientId: 'p', mrn: 'P-000001', requestId: 'r', consentId: 'c', transactionId: 't', recordId: 'd', documents: 3, files: 1, withheld: 1, why: 'expired', practice: true });
    expect(safeAuditDetails('ABDM_FETCHED_DELETED', details, { scope: 'platform' })).toEqual({ documents: 3, files: 1, withheld: 1, why: 'expired', practice: true });
    expect(safeAuditDetails('ABDM_FETCHED_VIEWED', { patientId: 'p', mrn: 'P-1', fileId: 'f' }, { scope: 'platform' })).toEqual({});
  });

  it("the fetal-sex guard is for every patient who is not a baby: a baby's own records keep the words", async () => {
    const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'Baby of Fetch Mother', ageYears: undefined, newborn: { birthAt: '2026-09-30T04:00:00.000Z' }, assignedDoctor: people.drA._id.toString() }));
    const baby = ok(res, 201).patient;
    await linkAbha(baby);
    const { request: r } = ok(await ask('drA', baby, { hiTypes: ['OPConsultation'] }), 201);
    ok(await post('drA', `/fetch/${r.id}/practice/answer`, { approve: true }));
    const [doc] = ok(await page('drA', baby)).documents;
    expect(doc.withheld).toBe(0);
    const lines = ok(await get('drA', `/patients/${baby.id}/fetched/${doc.id}`)).document.sections.flatMap((x) => x.lines.map((l) => l.text));
    expect(lines.join(' ')).toContain(PRACTICE_SEX_SENTENCE);
  });
});

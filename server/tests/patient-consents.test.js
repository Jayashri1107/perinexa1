// Consent forms on a patient's record: the forms for her type of care, suggestions, and printing (recorded,
// audited with ids only). Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { consentFacts, suggestion } from '../src/consents/suggest.js';
import { consentRiskFactors, HIV_ON_CONSENT_MESSAGE, isHivReason, namesHiv, RISK_GROUPS, RISK_SECTION, RISK_WORDING_VERSION, typedHivFields } from '../src/consents/riskWording.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ConsentForm } from '../src/models/ConsentForm.js';
import { PatientConsent } from '../src/models/PatientConsent.js';
import { Tenant } from '../src/models/Tenant.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { PCPNDT_MESSAGE } from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };

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
  hospital = await createTenant('Consent Patients Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
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

// A fake antenatal patient of Dr A. Scan EDD 1 Mar 2027: 18 w 0 d today, so the anomaly scan and the booking
// tests (HIV among them) are due.
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Consent Mother',
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

const consents = async (who, p) => (await as(who)).get(`/api/patients/${p.id}/consents`);
const byKey = (body, key) => body.forms.find((f) => f.key === key);
async function formOf(key) {
  const f = await ConsentForm.findOne({ tenantId: hospital._id, key });
  return { id: String(f._id), version: f.version };
}
const print = async (who, p, body) => (await as(who)).post(`/api/patients/${p.id}/consents`).send({ clientRequestId: randomUUID(), language: 'mr', ...body });

describe('the forms for a patient', () => {
  it('lists the forms for her type of care with suggestions and what to fill in', async () => {
    const p = await register();
    const res = await consents('drA', p);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canPrint: true, defaultLanguage: 'mr', printed: [] });
    expect(byKey(res.body, 'ultrasound_pregnancy')).toBeUndefined(); // removed 2 Oct 2026
    expect(byKey(res.body, 'hiv_test').suggested).toEqual({ why: 'hiv_test_due', prefill: {} });
    expect(byKey(res.body, 'high_risk_pregnancy').suggested).toBeNull(); // low risk
    expect(byKey(res.body, 'caesarean').suggested).toBeNull(); // no previous caesarean
    expect(byKey(res.body, 'labour_delivery').suggested).toBeNull(); // 18 weeks
    expect(byKey(res.body, 'admission')).toMatchObject({ forThisCare: true, suggested: null }); // for every type of care
    expect(byKey(res.body, 'newborn_care')).toMatchObject({ forThisCare: false, suggested: null });
    const entry = await AuditLog.findOne({ action: 'CONSENTS_VIEWED' });
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, access: 'full', kind: 'consent' });
  });

  it('suggests the high-risk, caesarean and delivery forms from the record', async () => {
    const p = await register({
      ageYears: 38, // high risk: age over 35
      pregnancy: { scanEdd: '2026-10-19' }, // 37 w 0 d today
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
    });
    const { body } = await consents('rmo', p);
    const high = byKey(body, 'high_risk_pregnancy').suggested;
    expect(high.why).toBe('high_risk');
    expect(high.prefill.reason).toMatch(/Age over 35/);
    expect(high.prefill.reason).toMatch(/Previous caesarean/);
    expect(byKey(body, 'vbac').suggested.why).toBe('previous_caesarean');
    expect(byKey(body, 'caesarean').suggested.why).toBe('previous_caesarean');
    expect(byKey(body, 'labour_delivery').suggested.why).toBe('from_37_weeks');
    expect(byKey(body, 'induction').suggested).toBeNull(); // from 40 weeks
  });

  it('suggests the newborn form for a newborn and nothing pregnancy-related for gynaecology', async () => {
    const mother = await register();
    const baby = (
      await (await as('drA')).post('/api/patients').send({
        careType: 'newborn',
        fullName: 'Baby of Consent Mother',
        newborn: { birthAt: '2026-09-27T10:00:00Z', birthWeightGrams: 3000, sex: 'female', mother: mother.id },
      })
    ).body.patient;
    const nb = (await consents('drA', baby)).body;
    expect(byKey(nb, 'newborn_care')).toMatchObject({ forThisCare: true, suggested: { why: 'always' } });
    const gyn = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Gyn Consent' }))).body.patient;
    const g = (await consents('drA', gyn)).body;
    expect(g.forms.filter((f) => f.suggested)).toEqual([]);
    expect(byKey(g, 'hiv_test').forThisCare).toBe(true);
    expect(byKey(g, 'labour_delivery').forThisCare).toBe(false);
  });

  it('follows the patient access rules', async () => {
    const p = await register();
    expect((await consents('nurse', p)).body.canPrint).toBe(false);
    expect((await consents('drB', p)).body.canPrint).toBe(false); // another doctor's patient: read-only
    expect((await consents('rmo', p)).body.canPrint).toBe(true);
    for (const who of ['reception', 'lab', 'admin']) expect((await consents(who, p)).status, who).toBe(403);
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await consents('nurse', p)).status).toBe(403);
    expect((await consents('drB', p)).status).toBe(403);
    const record = await (await as('nurse')).get(`/api/patients/${p.id}`);
    expect(record.body.patient.access).toMatchObject({ canViewConsents: false, canPrintConsents: false });
    expect((await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient.access).toMatchObject({ canViewConsents: true, canPrintConsents: true });
  });

  it('hides forms that are not in use', async () => {
    const p = await register();
    await consents('drA', p);
    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'refusal' }, { $set: { isActive: false } });
    expect(byKey((await consents('drA', p)).body, 'refusal')).toBeUndefined();
  });
});

describe('printing a form for a patient', () => {
  it('records the printout and audits ids only', async () => {
    const p = await register();
    await consents('drA', p); // the library is created on first use
    const f = await formOf('anaesthesia');
    const res = await print('drA', p, { formId: f.id, version: f.version, procedure: 'Caesarean section', reason: 'not used by this form' });
    expect(res.status).toBe(201);
    expect(res.body.consent).toMatchObject({
      patientId: p.id,
      formId: f.id,
      formKey: 'anaesthesia',
      formVersion: 1,
      formApproved: false,
      title: 'Consent for anaesthesia',
      language: 'mr',
      procedure: 'Caesarean section',
      reason: '', // the form has no {reason}
      doctorName: 'Sample drA',
      printedByName: 'Sample drA',
    });
    expect(res.body.consent.printedBy).toBeUndefined();
    expect(res.body.consent.clientRequestId).toBeUndefined();
    const entry = await AuditLog.findOne({ action: 'CONSENT_FORM_PRINTED' });
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, consentId: res.body.consent.id, kind: 'consent' });
    expect(safeAuditDetails('CONSENT_FORM_PRINTED', { ...entry.details, title: 'x' })).toEqual(entry.details);
    // the history and the language used last
    const after = (await consents('drA', p)).body;
    expect(after.printed).toHaveLength(1);
    expect(after.printed[0].id).toBe(res.body.consent.id);
  });

  it('saves the same print once', async () => {
    const p = await register();
    const q = await register({ fullName: 'Other Mother' });
    await consents('drA', p);
    const f = await formOf('caesarean');
    const clientRequestId = randomUUID();
    const first = await print('drA', p, { clientRequestId, formId: f.id, version: f.version, reason: 'Breech' });
    const again = await print('drA', p, { clientRequestId, formId: f.id, version: f.version, reason: 'Breech' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.consent.id).toBe(first.body.consent.id);
    expect((await print('drA', q, { clientRequestId, formId: f.id, version: f.version })).status).toBe(409);
    expect(await PatientConsent.countDocuments({ tenantId: hospital._id })).toBe(1);
  });

  it('only the treating doctor and RMOs print', async () => {
    const p = await register();
    await consents('drA', p);
    const f = await formOf('admission');
    expect((await print('rmo', p, { formId: f.id, version: f.version, doctor: 'blank' })).body.consent.doctorName).toBeNull();
    for (const who of ['drB', 'nurse', 'reception', 'lab']) {
      expect((await print(who, p, { formId: f.id, version: f.version })).status, who).toBe(403);
    }
  });

  it('refuses a changed, retired or incomplete form, and words about the baby\'s sex', async () => {
    const p = await register();
    await consents('drA', p);
    const f = await formOf('induction');
    const stale = await print('drA', p, { formId: f.id, version: f.version + 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/now version 1/);

    const sex = await print('drA', p, { formId: f.id, version: f.version, reason: 'Parents asked about the baby sex' });
    expect(sex.status).toBe(400);
    expect(sex.body.error.fields.reason).toBe(PCPNDT_MESSAGE);

    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'induction' }, { $set: { 'title.hi': '' } });
    const hindi = await print('drA', p, { formId: f.id, version: f.version, language: 'hi' });
    expect(hindi.status).toBe(400);
    expect(hindi.body.error.fields.language).toMatch(/Hindi text is not complete/);
    expect((await print('drA', p, { formId: f.id, version: f.version, language: 'en' })).status).toBe(201);

    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'induction' }, { $set: { isActive: false } });
    expect((await print('drA', p, { formId: f.id, version: f.version })).status).toBe(409);
    expect((await print('drA', p, { formId: f.id, version: f.version, extra: 1 })).status).toBe(400);
  });

  it("offers the patient's last language, otherwise the hospital's", async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'letterhead.consentLanguage': 'hi' } });
    const p = await register();
    expect((await consents('drA', p)).body.defaultLanguage).toBe('hi');
    const f = await formOf('admission');
    await print('drA', p, { formId: f.id, version: f.version, language: 'mr' });
    expect((await consents('drA', p)).body.defaultLanguage).toBe('mr');
  });
});

describe('suggestion rules', () => {
  const form = (suggestWhen, careTypes = ['antenatal'], clause = 'I, {patient}, consent.') => ({ suggestWhen, careTypes, clauses: [{ en: clause }] });
  const facts = (patient, items = []) => consentFacts({ careType: 'antenatal', ...patient }, items, new Date('2026-09-28T00:00:00Z'));

  it('use only facts the record has', () => {
    const base = facts({ pregnancy: { effectiveEdd: new Date('2027-03-01T00:00:00Z') } });
    expect(base).toMatchObject({ antenatal: true, riskHigh: false, previousCaesareans: 0, weeks: 18, scanDue: false, dueScans: [], hivTestDue: false });
    expect(suggestion(form('always'), base)).toEqual({ why: 'always', prefill: {} });
    expect(suggestion(form('always', ['newborn']), base)).toBeNull();
    expect(suggestion(form('none'), base)).toBeNull();
    expect(suggestion(form('from_37_weeks'), base)).toBeNull();
    expect(suggestion(form('from_37_weeks'), { ...base, weeks: 37 })?.why).toBe('from_37_weeks');
    expect(suggestion(form('from_40_weeks'), { ...base, weeks: 39 })).toBeNull();
    const withItems = facts({ pregnancy: { effectiveEdd: new Date('2027-03-01T00:00:00Z') } }, [
      { kind: 'scan', name: 'Anomaly scan', status: 'due' },
      { kind: 'scan', name: 'Growth scan', status: 'upcoming' },
      { kind: 'investigation', name: 'HIV test (with counselling)', status: 'overdue' },
    ]);
    expect(suggestion(form('scan_due', ['antenatal'], 'Scan: {procedure}.'), withItems)).toEqual({ why: 'scan_due', prefill: { procedure: 'Anomaly scan' } });
    expect(suggestion(form('scan_due'), withItems)).toEqual({ why: 'scan_due', prefill: {} }); // no {procedure} to fill
    expect(suggestion(form('hiv_test_due'), withItems)?.why).toBe('hiv_test_due');
  });

  it('fill in the scan due now, or else only the one overdue last', () => {
    const edd = { pregnancy: { effectiveEdd: new Date('2027-03-01T00:00:00Z') } };
    const scan = (name, status, dueBy) => ({ kind: 'scan', name, status, dueBy: new Date(`${dueBy}T00:00:00Z`) });
    const usg = form('scan_due', ['antenatal'], 'Scan: {procedure}.');
    const overdueOnly = facts(edd, [scan('Dating scan', 'overdue', '2026-08-01'), scan('Anomaly scan', 'overdue', '2026-09-20'), scan('NT scan', 'overdue', '2026-09-01')]);
    expect(suggestion(usg, overdueOnly).prefill).toEqual({ procedure: 'Anomaly scan' });
    const mixed = facts(edd, [scan('NT scan', 'overdue', '2026-09-01'), scan('Growth scan', 'due', '2026-10-10')]);
    expect(suggestion(usg, mixed).prefill).toEqual({ procedure: 'Growth scan' });
  });

  it('never suggest pregnancy forms outside antenatal care', () => {
    const gyn = consentFacts({ careType: 'gynaecology', risk: { level: 'high', reasons: [] }, obstetric: { previousCaesareans: 2 } }, [], new Date());
    for (const rule of ['high_risk', 'previous_caesarean', 'scan_due', 'hiv_test_due', 'from_37_weeks']) {
      expect(suggestion(form(rule, []), gyn), rule).toBeNull();
    }
  });
});

describe('the signed copy', () => {
  it('is recorded once – date, witness, where it is kept – by the doctor, an RMO or a nurse', async () => {
    const p = await register();
    await consents('drA', p);
    const f = await formOf('admission');
    const printed = (await print('drA', p, { formId: f.id, version: f.version })).body.consent;
    expect(printed.signed).toBeNull();
    expect((await consents('nurse', p)).body.canRecordSigned).toBe(true);
    const signedUrl = `/api/patients/${p.id}/consents/${printed.id}/signed`;
    const post = async (who, body) => (await as(who)).post(signedUrl).send(body);

    expect((await post('reception', { signedOn: '2026-09-28' })).status).toBe(403);
    expect((await post('drB', { signedOn: '2026-09-28' })).status).toBe(403); // another doctor's patient: view only
    expect((await post('nurse', { signedOn: '2026-09-29' })).body.error.fields.signedOn).toMatch(/future/);
    expect((await post('nurse', { signedOn: '2026-09-27' })).body.error.fields.signedOn).toMatch(/before the form was printed/);
    expect((await post('nurse', { signedOn: '2026-09-28', witness: 'The baby is a girl' })).status).toBe(400); // PCPNDT

    const res = await post('nurse', { signedOn: '2026-09-28', witness: 'Husband, Sample Relative', keptAt: "Patient's paper file" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.consent.signed).toEqual({
      on: '2026-09-28T00:00:00.000Z',
      witness: 'Husband, Sample Relative',
      keptAt: "Patient's paper file",
      recordedByName: 'Sample nurse',
      recordedAt: NOW.toISOString(),
    });
    expect((await post('drA', { signedOn: '2026-09-28' })).status).toBe(409); // never changed
    expect((await consents('drA', p)).body.printed[0].signed.recordedByName).toBe('Sample nurse');
    const entry = await AuditLog.findOne({ action: 'CONSENT_SIGNED_RECORDED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, consentId: printed.id });
  });

  it('a scanned copy is attached after the signed copy is recorded (PDF or photo only, at most 3), and opened by those who see the forms', async () => {
    const p = await register();
    await consents('drA', p);
    const f = await formOf('admission');
    const printed = (await print('drA', p, { formId: f.id, version: f.version })).body.consent;
    const PDF = Buffer.from('%PDF-1.4\n% fake sample scan\n%%EOF\n').toString('base64');
    const scan = async (who, body = {}) => (await as(who)).post(`/api/patients/${p.id}/consents/${printed.id}/scans`).send({ fileName: 'consent scan.pdf', mediaType: 'application/pdf', data: PDF, ...body });
    expect((await scan('nurse')).status).toBe(409); // not recorded as signed yet
    await (await as('nurse')).post(`/api/patients/${p.id}/consents/${printed.id}/signed`).send({ signedOn: '2026-09-28' });
    expect((await scan('reception')).status).toBe(403);
    expect((await scan('nurse', { data: Buffer.from('MZ fake program').toString('base64') })).status).toBe(400);
    const res = await scan('nurse');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const file = res.body.consent.scans[0];
    expect(file).toMatchObject({ fileName: 'consent scan.pdf', mediaType: 'application/pdf', byName: 'Sample nurse' });
    await scan('nurse');
    await scan('nurse');
    expect((await scan('nurse')).status).toBe(409); // at most 3
    const opened = await (await as('drA')).get(`/api/patients/${p.id}/consents/${printed.id}/scans/${file.id}`).buffer(true);
    expect(opened.status).toBe(200);
    expect(opened.headers['content-type']).toBe('application/pdf');
    expect((await (await as('reception')).get(`/api/patients/${p.id}/consents/${printed.id}/scans/${file.id}`)).status).toBe(403);
    const entry = await AuditLog.findOne({ action: 'CONSENT_SCAN_OPENED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, consentId: printed.id, fileId: file.id });
  });
});

describe('information forms (condition explained, patient and relatives sign)', () => {
  const info = async (who, p) => (await as(who)).get(`/api/patients/${p.id}/consents?kind=information`);
  const due = async (who, p) => (await as(who)).get(`/api/patients/${p.id}/consents/information-due`);
  const keys = (body) => body.forms.map((f) => f.key);

  it('are a separate list from the consent forms, each complete in English, Marathi and Hindi', async () => {
    const p = await register();
    const consentList = await consents('drA', p);
    const infoList = await info('drA', p);
    expect(infoList.status).toBe(200);
    expect(infoList.body.kind).toBe('information');
    expect(keys(consentList.body).some((k) => k.startsWith('info_'))).toBe(false);
    expect(keys(infoList.body)).toEqual(expect.arrayContaining(['info_hypertension', 'info_gdm', 'info_hypothyroid', 'info_oligohydramnios', 'info_anaemia', 'info_condition']));
    expect(infoList.body.forms.every((f) => f.kind === 'information' && f.languages.length === 3)).toBe(true);
    expect(byKey(infoList.body, 'info_condition').blanks).toContain('condition');
    // Nothing on the record yet: nothing suggested, nothing due
    expect(infoList.body.forms.filter((f) => f.suggested)).toEqual([]);
    expect((await due('drA', p)).body).toEqual({ due: [] });
  });

  it('are suggested from ticked conditions and the blood group, and stay due until given in this pregnancy', async () => {
    const p = await register({ medical: { allergies: 'None known', bloodGroup: 'O-', heightCm: 160, weightKg: 60, conditions: ['thyroid', 'diabetes'] } });
    const { body } = await info('drA', p);
    expect(byKey(body, 'info_hypothyroid').suggested.why).toBe('thyroid');
    expect(byKey(body, 'info_gdm').suggested.why).toBe('diabetes');
    expect(byKey(body, 'info_rh_negative').suggested.why).toBe('rh_negative');
    expect(byKey(body, 'info_hypertension').suggested).toBeNull();
    expect((await due('nurse', p)).body.due.map((d) => d.why).sort()).toEqual(['diabetes', 'rh_negative', 'thyroid']);

    const thyroid = byKey(body, 'info_hypothyroid');
    const res = await print('drA', p, { formId: thyroid.id, version: thyroid.version });
    expect(res.status).toBe(201);
    expect(res.body.consent).toMatchObject({ kind: 'information', title: thyroid.title.en });
    expect((await due('drA', p)).body.due.map((d) => d.why).sort()).toEqual(['diabetes', 'rh_negative']);
    // Listed under the information forms only
    expect((await info('drA', p)).body.printed.map((c) => c.id)).toEqual([res.body.consent.id]);
    expect((await consents('drA', p)).body.printed).toEqual([]);
    const entry = await AuditLog.findOne({ action: 'CONSENT_FORM_PRINTED' });
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, consentId: res.body.consent.id, kind: 'information' });
  });

  it('suggest the blood-pressure sheet from the latest visit, and anaemia from a low haemoglobin', async () => {
    const p = await register();
    const visit = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
    expect(visit.status).toBe(201);
    const saved = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${visit.body.visit.id}`).send({ vitals: { rev: 0, bpSystolic: 150, bpDiastolic: 96, hb: 9.2 } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const { body } = await info('drA', p);
    expect(byKey(body, 'info_hypertension').suggested.why).toBe('blood_pressure');
    expect(byKey(body, 'info_anaemia').suggested.why).toBe('anaemia');
  });

  it('suggest the bad-obstetric-history sheet with the earlier problems filled in, and list cholestasis for the doctor to choose', async () => {
    const p = await register({
      obstetric: { gravida: 4, para: 1, living: 0, abortions: 2, previousCaesareans: 0, pastComplications: ['stillbirth_or_neonatal_death'], complicationsReviewed: true },
    });
    const { body } = await info('drA', p);
    expect(byKey(body, 'info_bad_obstetric_history').suggested).toEqual({
      why: 'bad_obstetric_history',
      prefill: { condition: 'stillbirth or newborn death; 2 miscarriages / abortions' },
    });
    expect(byKey(body, 'info_cholestasis')).toMatchObject({ forThisCare: true, suggested: null, languages: ['en', 'mr', 'hi'] });
  });

  it('cover complications from early pregnancy to after delivery, in the order of care, all complete in three languages', async () => {
    const p = await register({ ageYears: 38 });
    const { body } = await info('drA', p);
    const list = keys(body);
    for (const k of ['info_hyperemesis', 'info_ectopic', 'info_iufd', 'info_fetal_distress', 'info_pph', 'info_postnatal_depression']) expect(list).toContain(k);
    expect(list.indexOf('info_hyperemesis')).toBeLessThan(list.indexOf('info_hypertension'));
    expect(list.indexOf('info_fetal_distress')).toBeLessThan(list.indexOf('info_pph'));
    expect(body.forms.every((f) => f.languages.length === 3)).toBe(true);
    expect(byKey(body, 'info_older_mother').suggested.why).toBe('age_35_plus');
    expect(byKey(body, 'info_postnatal_depression').forThisCare).toBe(false); // after delivery only
    expect(list.some((k) => /hiv/.test(k))).toBe(false); // HIV status is never put on a sheet relatives sign
  });

  it('print the condition typed by the doctor in the general form, checked for words about the baby\'s sex', async () => {
    const p = await register();
    await info('drA', p); // sets up the hospital's forms
    const general = await formOf('info_condition');
    const ok = await print('drA', p, { formId: general.id, version: general.version, condition: 'Intrahepatic cholestasis of pregnancy' });
    expect(ok.status).toBe(201);
    expect(ok.body.consent).toMatchObject({ kind: 'information', condition: 'Intrahepatic cholestasis of pregnancy' });
    const bad = await print('drA', p, { formId: general.id, version: general.version, condition: 'It is a boy' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.condition).toBe(PCPNDT_MESSAGE);
  });

  it('can be added by a doctor as a new information form', async () => {
    const res = await (await as('drA')).post('/api/consent-forms').send({ kind: 'information' });
    expect(res.status).toBe(201);
    expect(res.body.form).toMatchObject({ kind: 'information', status: 'draft', blanks: expect.arrayContaining(['condition']) });
    const list = await (await as('nurse')).get('/api/consent-forms');
    expect(list.body.forms.find((f) => f.id === res.body.form.id).kind).toBe('information');
  });
});

describe('suggestion rules for information forms', () => {
  const form = (suggestWhen) => ({ suggestWhen, careTypes: ['antenatal'], clauses: [{ en: 'I, {patient}, was informed.' }] });
  const facts = (findings, medical = {}) => consentFacts({ careType: 'antenatal', medical }, [], new Date('2026-09-28T00:00:00Z'), findings);

  it('use the conditions, red flags and lab results', () => {
    expect(suggestion(form('blood_pressure'), facts({ flagKeys: ['pe_sys'] }))?.why).toBe('blood_pressure');
    expect(suggestion(form('blood_pressure'), facts({ flagKeys: ['fever'] }))).toBeNull();
    expect(suggestion(form('blood_pressure'), facts({}, { conditions: ['hypertension'] }))?.why).toBe('blood_pressure');
    expect(suggestion(form('diabetes'), facts({ ogttHigh: true }))?.why).toBe('diabetes');
    expect(suggestion(form('thyroid'), facts({ tshHigh: true }))?.why).toBe('thyroid');
    expect(suggestion(form('anaemia'), facts({ hbLow: true }))?.why).toBe('anaemia');
    expect(suggestion(form('anaemia'), facts({ flagKeys: ['hb_mild'] }))?.why).toBe('anaemia');
    expect(suggestion(form('rh_negative'), facts({}, { bloodGroup: 'A-' }))?.why).toBe('rh_negative');
    expect(suggestion(form('rh_negative'), facts({}, { bloodGroup: 'A+' }))).toBeNull();
    expect(suggestion(form('not_head_down'), facts({ flagKeys: ['malpresentation'] }))?.why).toBe('not_head_down');
    const boh = (obstetric) => suggestion(form('bad_obstetric_history'), consentFacts({ careType: 'antenatal', obstetric }, [], new Date('2026-09-28T00:00:00Z')));
    expect(boh({ pastComplications: ['pph'], abortions: 0 })?.why).toBe('bad_obstetric_history');
    expect(boh({ pastComplications: [], abortions: 1 })).toBeNull(); // one miscarriage is not enough
    expect(boh({ pastComplications: [], abortions: 2 })?.why).toBe('bad_obstetric_history');
    expect(suggestion(form('reduced_movements'), facts({ flagKeys: ['fm_reduced'] }))?.why).toBe('reduced_movements');
    expect(suggestion(form('heart_disease'), facts({}, { conditions: ['heart_disease'] }))?.why).toBe('heart_disease');
    expect(suggestion(form('epilepsy'), facts({}, { conditions: ['epilepsy'] }))?.why).toBe('epilepsy');
    expect(suggestion(form('hepatitis_b'), facts({ hbsagReactive: true }))?.why).toBe('hepatitis_b');
    expect(suggestion(form('hepatitis_b'), facts({}))).toBeNull();
    expect(suggestion(form('obesity'), facts({}, { heightCm: 160, weightKg: 80 }))?.why).toBe('obesity'); // BMI 31.3
    expect(suggestion(form('obesity'), facts({}, { heightCm: 160, weightKg: 70 }))).toBeNull(); // BMI 27.3
    const aged = (ageYears) => suggestion(form('age_35_plus'), consentFacts({ careType: 'antenatal', ageYears, ageRecordedOn: new Date('2026-09-28T00:00:00Z') }, [], new Date('2026-09-28T00:00:00Z')));
    expect(aged(36)?.why).toBe('age_35_plus');
    expect(aged(30)).toBeNull();
  });
});

describe("the patient's high-risk factors on consent forms", () => {
  // Age 38, a previous caesarean, diabetes, hepatitis B and HIV ticked (all high), BMI 31.3 (moderate).
  const highRisk = () =>
    register({
      ageYears: 38,
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 80, conditions: ['diabetes', 'hepatitis_b', 'hiv'] },
    });
  const ids = (body) => body.risk.factors.map((f) => f.id);

  it('are offered to those who print, high ones first, with the complications in three languages – never HIV', async () => {
    const p = await highRisk();
    const { body } = await consents('drA', p);
    expect(ids(body)).toEqual(['age_over_35', 'previous_caesarean', 'diabetes', 'hepatitis_b', 'obesity']);
    expect(body.risk.factors.map((f) => f.level)).toEqual(['high', 'high', 'high', 'high', 'moderate']);
    const caesarean = body.risk.factors[1];
    expect(caesarean.name).toEqual({ en: 'Previous caesarean section', mr: 'आधीची सिझेरियन शस्त्रक्रिया', hi: 'पहले हुआ सिज़ेरियन ऑपरेशन' });
    for (const lang of ['en', 'mr', 'hi']) expect(caesarean.complications[lang].length).toBeGreaterThan(40);
    expect(body.risk.factors.find((f) => f.id === 'hepatitis_b').private).toBe(true);
    expect(caesarean.private).toBe(false);
    expect(JSON.stringify(body.risk)).not.toMatch(/hiv|aids/i);
    expect(body.risk.section).toEqual(RISK_SECTION);
    expect(body.risk.wording).toEqual({ version: RISK_WORDING_VERSION, approved: false, approvedByName: null, approvedAt: null });
    // The form that names the reasons no longer fills in HIV either
    const reason = byKey(body, 'high_risk_pregnancy').suggested.prefill.reason;
    expect(reason).toMatch(/Hepatitis B/);
    expect(reason).not.toMatch(/HIV/i);
    // Those who only view get no list; information forms have none
    expect((await consents('nurse', p)).body.risk).toBeNull();
    expect((await consents('drB', p)).body.risk).toBeNull();
    expect((await (await as('drA')).get(`/api/patients/${p.id}/consents`).query({ kind: 'information' })).body.risk).toBeNull();
  });

  it('are printed on any consent form as the doctor chose, and kept with the printout', async () => {
    const p = await highRisk();
    await consents('drA', p);
    const f = await formOf('admission'); // a general form with no blank for a reason
    const res = await print('rmo', p, { formId: f.id, version: f.version, riskFactors: ['previous_caesarean', 'diabetes'], otherRisks: '  Fibroid in the lower uterus – more bleeding  ' });
    expect(res.status).toBe(201);
    expect(res.body.consent.riskFactors).toEqual([
      { id: 'previous_caesarean', name: 'Previous caesarean section', complications: RISK_GROUPS.find((g) => g.id === 'previous_caesarean').complications.en },
      { id: 'diabetes', name: 'Diabetes', complications: RISK_GROUPS.find((g) => g.id === 'diabetes').complications.en },
    ]);
    expect(res.body.consent).toMatchObject({ otherRisks: 'Fibroid in the lower uterus – more bleeding', riskWordingVersion: RISK_WORDING_VERSION, riskWordingApproved: false });
    // What her record showed then is kept too, ticked or not: "Print again" repeats the doctor's choice for those
    expect(res.body.consent.riskOffered).toEqual(['age_over_35', 'previous_caesarean', 'diabetes', 'hepatitis_b', 'obesity']);
    // The audit log still holds ids only
    const entry = await AuditLog.findOne({ action: 'CONSENT_FORM_PRINTED' });
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, consentId: res.body.consent.id, kind: 'consent' });
    // Nothing chosen: nothing printed, nothing to approve
    const plain = await print('drA', p, { formId: f.id, version: f.version });
    expect(plain.body.consent).toMatchObject({ riskFactors: [], otherRisks: '', riskWordingVersion: null, riskWordingApproved: null });
    expect(plain.body.consent.riskOffered).toHaveLength(5); // offered and left unticked: the next "Print again" leaves them unticked
    const shown = (await consents('nurse', p)).body.printed; // shown with the printouts, to those who see them
    expect(shown.map((c) => c.riskFactors.length).sort()).toEqual([0, 2]);
  });

  it('refuse a factor her record does not show (HIV among them) and words about the baby\'s sex', async () => {
    const p = await highRisk();
    await consents('drA', p);
    const f = await formOf('procedure');
    for (const id of ['cond_hiv', 'rule:cond_hiv', 'hiv', 'heart']) {
      const res = await print('drA', p, { formId: f.id, version: f.version, riskFactors: [id] });
      expect(res.status, id).toBe(409);
      expect(res.body.error.message, id).toMatch(/risk factors changed/);
    }
    const sex = await print('drA', p, { formId: f.id, version: f.version, otherRisks: 'Male baby, large' });
    expect(sex.status).toBe(400);
    expect(sex.body.error.fields.otherRisks).toBe(PCPNDT_MESSAGE);
    // HIV is not printed or kept through the typed line either – in any of its usual names
    for (const typed of ['HIV positive – infection of the baby', 'RVD reactive', 'PLHIV on treatment', 'Retroviral disease', 'एचआयव्ही पॉझिटिव्ह']) {
      const hiv = await print('drA', p, { formId: f.id, version: f.version, otherRisks: typed });
      expect(hiv.status, typed).toBe(400);
      expect(hiv.body.error.message, typed).toBe(HIV_ON_CONSENT_MESSAGE);
      expect(hiv.body.error.fields.otherRisks, typed).toBe(HIV_ON_CONSENT_MESSAGE);
    }
    expect(await PatientConsent.countDocuments({ tenantId: hospital._id })).toBe(0);
    // A line that only looks like it is printed
    const ok = await print('drA', p, { formId: f.id, version: f.version, otherRisks: 'Retroplacental clot at 30 weeks – more bleeding; hepatitis B with a high viral load' });
    expect(ok.status).toBe(201);
  });

  it('refuse HIV typed into a blank of any form too: the operation, the reason, and the condition of an information form', async () => {
    const p = await highRisk();
    await consents('drA', p); // the library is created on first use (consent and information forms)
    const refused = async (key, body, fields) => {
      const f = await formOf(key);
      const res = await print('drA', p, { formId: f.id, version: f.version, ...body });
      expect(res.status, key).toBe(400);
      expect(res.body.error.message, key).toBe(HIV_ON_CONSENT_MESSAGE);
      expect(res.body.error.fields, key).toEqual(Object.fromEntries(fields.map((k) => [k, HIV_ON_CONSENT_MESSAGE])));
    };
    await refused('caesarean', { reason: 'HIV positive mother – to lower the risk to the baby' }, ['reason']);
    await refused('procedure', { procedure: 'LSCS (RVD reactive)', reason: 'Breech' }, ['procedure']);
    await refused('procedure', { procedure: 'HIV test', reason: 'PLHIV' }, ['procedure', 'reason']); // the HIV test has its own consent form
    await refused('refusal', { procedure: 'Admission', reason: 'एचआयव्ही' }, ['reason']);
    await refused('info_condition', { condition: 'Retroviral disease' }, ['condition']);
    await refused('procedure', { procedure: 'AIDS', otherRisks: 'HIV' }, ['procedure', 'otherRisks']);
    expect(await PatientConsent.countDocuments({ tenantId: hospital._id })).toBe(0);
    // A box the form does not have is neither printed nor kept, so it is not looked at; ordinary words pass
    const f = await formOf('anaesthesia');
    const ok = await print('drA', p, { formId: f.id, version: f.version, procedure: 'Caesarean section – retroplacental clot', reason: 'HIV positive' });
    expect(ok.status).toBe(201);
    expect(ok.body.consent).toMatchObject({ procedure: 'Caesarean section – retroplacental clot', reason: '' });
    expect(typedHivFields({ procedure: 'D&C', reason: 'RVD', condition: '', otherRisks: undefined })).toEqual(['reason']);
    expect(typedHivFields(null)).toEqual([]);
    expect(HIV_ON_CONSENT_MESSAGE).toMatch(/never printed on a consent or information form or kept with it/);
  });

  it("never offers a rule of the hospital's own on HIV, whatever a doctor called it, and marks its own rule on a private condition", async () => {
    // Two rules a doctor added to the hospital's risk rules: one checks HIV under a name without the word, one hepatitis B
    await CarePlanTemplate.updateOne(
      { tenantId: hospital._id, careType: 'antenatal', kind: 'standard' },
      {
        $push: {
          riskRules: {
            $each: [
              { key: 'rule_own1', label: 'On ART', factor: 'condition', condition: 'hiv', level: 'high', source: '' },
              { key: 'rule_own2', label: 'HBsAg positive mother', factor: 'condition', condition: 'hepatitis_b', level: 'high', source: '' },
            ],
          },
        },
        // as when a doctor edits the rules: no longer the built-in set (which would be replaced by its newer version)
        $set: { builtInRulesVersion: null, updatedByName: 'Sample drA' },
      },
    );
    const p = await highRisk(); // registered after the rules changed: her reasons are worked out from them
    const { body } = await consents('drA', p);
    expect(JSON.stringify(body)).not.toMatch(/On ART/);
    expect(ids(body)).not.toContain('rule:rule_own1');
    expect(byKey(body, 'high_risk_pregnancy').suggested.prefill.reason).toMatch(/HBsAg positive mother/);
    const own = body.risk.factors.find((x) => x.id === 'rule:rule_own2');
    expect(own).toMatchObject({ level: 'high', name: { en: 'HBsAg positive mother', mr: '', hi: '' }, complications: null, private: true, labels: ['HBsAg positive mother'] });
    const f = await formOf('admission');
    expect((await print('drA', p, { formId: f.id, version: f.version, riskFactors: ['rule:rule_own1'] })).status).toBe(409);
    expect((await print('drA', p, { formId: f.id, version: f.version, riskFactors: ['rule:rule_own2'] })).status).toBe(201);
  });

  it('are left off information forms and are empty outside antenatal care', async () => {
    const p = await highRisk();
    await (await as('drA')).get(`/api/patients/${p.id}/consents?kind=information`);
    const sheet = await formOf('info_gdm');
    const res = await print('drA', p, { formId: sheet.id, version: sheet.version, riskFactors: ['diabetes'], otherRisks: 'typed' });
    expect(res.status).toBe(201);
    expect(res.body.consent).toMatchObject({ kind: 'information', riskFactors: [], riskOffered: [], otherRisks: '', riskWordingApproved: null });
    const g = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Gynae Sample', assignedDoctor: people.drA._id.toString() }))).body.patient;
    const list = (await consents('drA', g)).body;
    expect(list.risk.factors).toEqual([]);
    const f = await formOf('procedure');
    const typed = await print('drA', g, { formId: f.id, version: f.version, procedure: 'Hysterectomy', otherRisks: 'Diabetes – infection, slow healing' });
    expect(typed.body.consent).toMatchObject({ riskFactors: [], otherRisks: 'Diabetes – infection, slow healing', riskWordingApproved: false });
  });

  it('print without DRAFT once a doctor approved the wording', async () => {
    const p = await highRisk();
    await consents('drA', p);
    const approved = await (await as('drB')).post('/api/consent-forms/risk-wording/approve').send({ confirm: true, version: RISK_WORDING_VERSION });
    expect(approved.status).toBe(200);
    sessions = {}; // a new request reads the hospital again
    const { body } = await consents('drA', p);
    expect(body.risk.wording).toMatchObject({ approved: true, approvedByName: 'Sample drB' });
    const f = await formOf('caesarean');
    // A page loaded before the approval still shows DRAFT: its print is refused, so the record and the paper agree
    const stale = await print('drA', p, { formId: f.id, version: f.version, riskFactors: ['age_over_35'], riskWordingVersion: RISK_WORDING_VERSION, riskWordingApproved: false });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/approved or changed after you opened this page/);
    const res = await print('drA', p, { formId: f.id, version: f.version, riskFactors: ['age_over_35'], riskWordingVersion: RISK_WORDING_VERSION, riskWordingApproved: true });
    expect(res.status).toBe(201);
    expect(res.body.consent).toMatchObject({ riskWordingVersion: RISK_WORDING_VERSION, riskWordingApproved: true });
    // The approval is of exactly the text that was read: other words under the same number are a draft again,
    // and so is an approval of an earlier version
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'consentRiskWording.approvedHash': 'the fingerprint of another text' } });
    expect((await consents('drA', p)).body.risk.wording).toEqual({ version: RISK_WORDING_VERSION, approved: false, approvedByName: null, approvedAt: null });
    expect((await print('drA', p, { formId: f.id, version: f.version, riskFactors: ['age_over_35'] })).body.consent.riskWordingApproved).toBe(false);
    await (await as('drA')).post('/api/consent-forms/risk-wording/approve').send({ confirm: true, version: RISK_WORDING_VERSION });
    expect((await consents('drA', p)).body.risk.wording).toMatchObject({ approved: true, approvedByName: 'Sample drA' });
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'consentRiskWording.approvedVersion': RISK_WORDING_VERSION - 1 } });
    expect((await consents('drA', p)).body.risk.wording.approved).toBe(false);
  });
});

describe('the wording of the high-risk factors', () => {
  const patient = (reasons, careType = 'antenatal') => ({ careType, risk: { reasons } });
  const reason = (key, level = 'high', label = key) => ({ key, label, level, detail: '' });

  it('covers every built-in risk rule except HIV, complete in English, Marathi and Hindi', async () => {
    const template = await CarePlanTemplate.findOne({ tenantId: hospital._id, 'riskRules.0': { $exists: true } }).lean();
    const ruleKeys = template.riskRules.map((r) => r.key);
    expect(ruleKeys.length).toBeGreaterThan(40);
    const covered = new Set(RISK_GROUPS.flatMap((g) => g.keys));
    expect(ruleKeys.filter((k) => !covered.has(k))).toEqual(['cond_hiv']);
    expect([...covered].filter((k) => !ruleKeys.includes(k))).toEqual([]); // no entry for a rule that does not exist
    expect(new Set(RISK_GROUPS.map((g) => g.id)).size).toBe(RISK_GROUPS.length);
    for (const g of RISK_GROUPS) {
      for (const lang of ['en', 'mr', 'hi']) {
        expect(g.name[lang]?.trim(), `${g.id} name ${lang}`).toBeTruthy();
        expect(g.complications[lang]?.trim().length, `${g.id} complications ${lang}`).toBeGreaterThan(30);
      }
      expect(g.name.en.length).toBeLessThanOrEqual(200);
      expect(g.complications.en.length).toBeLessThanOrEqual(600);
      expect(/[\u0900-\u097F]/.test(g.name.mr) && /[\u0900-\u097F]/.test(g.complications.hi), g.id).toBe(true);
      expect(`${g.name.en} ${g.complications.en}`).not.toMatch(/\b(hiv|aids)\b/i);
    }
    for (const part of Object.values(RISK_SECTION)) for (const lang of ['en', 'mr', 'hi']) expect(part[lang]?.trim()).toBeTruthy();
    expect(RISK_GROUPS.filter((g) => g.private).map((g) => g.id).sort()).toEqual(['hepatitis_b', 'mental_health', 'syphilis']); // the owner's decision of 14 Nov 2026
    expect(RISK_GROUPS.flatMap((g) => g.keys).length).toBe(covered.size); // no rule in two factors
    const groupIds = new Set(RISK_GROUPS.map((g) => g.id));
    for (const g of RISK_GROUPS) for (const c of g.covers ?? []) expect(groupIds.has(c), `${g.id} covers ${c}`).toBe(true);
  });

  it('joins rules that mean the same factor, keeps the higher level, and prints a diagnosis instead of what it covers', () => {
    const idsOf = (reasons) => consentRiskFactors(patient(reasons)).map((f) => f.id);
    const list = consentRiskFactors(patient([reason('bmi_30_plus', 'moderate'), reason('bp_systolic_140'), reason('bp_diastolic_90'), reason('cond_hypertension'), reason('hb_under_7'), reason('hb_under_11', 'moderate')]));
    expect(list.map((f) => [f.id, f.level])).toEqual([
      ['high_bp', 'high'], // the ticked diagnosis stands for the single raised reading
      ['severe_anaemia', 'high'], // from the lowest Hb of the pregnancy …
      ['obesity', 'moderate'],
      ['anaemia', 'moderate'], // … so "Anaemia" stays on offer for a haemoglobin that has come up
    ]);
    expect(consentRiskFactors(patient([reason('bmi_30_plus', 'moderate'), reason('bmi_35_plus')]))).toMatchObject([{ id: 'obesity', level: 'high' }]);
    // One raised reading is not yet the diagnosis "High blood pressure"
    expect(consentRiskFactors(patient([reason('bp_systolic_140'), reason('bp_diastolic_90')]))).toMatchObject([{ id: 'bp_reading', level: 'high', name: { en: 'Raised blood pressure at the latest check' } }]);
    // Already sensitised: no "anti-D" line as well. Diabetes before pregnancy stands for gestational diabetes; alone it has its own line
    expect(idsOf([reason('rh_negative'), reason('hist_rh_iso')])).toEqual(['rh_sensitised']);
    expect(idsOf([reason('rh_negative')])).toEqual(['rh_negative']);
    expect(idsOf([reason('preg_gdm'), reason('cond_diabetes')])).toEqual(['diabetes']);
    expect(consentRiskFactors(patient([reason('preg_gdm')]))[0]).toMatchObject({ id: 'gdm', name: { en: 'Diabetes in this pregnancy (gestational diabetes)' } });
    expect(RISK_GROUPS.find((g) => g.id === 'gdm').complications.en).not.toMatch(/birth defect/);
  });

  it("uses our wording only while the hospital's rule still checks what the built-in rule checks", () => {
    const one = (reasons, rules) => consentRiskFactors(patient(reasons), rules)[0];
    const age = { key: 'age_over_35', label: 'Age over 35', factor: 'age', op: 'gt', value: 35, level: 'high' };
    // unchanged, or only renamed: our name and complications
    expect(one([reason('age_over_35')], [age])).toMatchObject({ id: 'age_over_35', name: { en: "Mother's age over 35 years" } });
    expect(one([reason('age_over_35', 'high', 'Elderly gravida')], [{ ...age, label: 'Elderly gravida' }])).toMatchObject({ id: 'age_over_35', labels: ['Elderly gravida'] });
    // another cut-off than our name states: the rule's own name, with our complications
    const from35 = one([reason('age_over_35', 'high', 'Age 35 or more')], [{ ...age, op: 'gte', label: 'Age 35 or more' }]);
    expect(from35).toMatchObject({ id: 'rule:age_over_35', name: { en: 'Age 35 or more', mr: '', hi: '' } });
    expect(from35.complications).toEqual(RISK_GROUPS.find((g) => g.id === 'age_over_35').complications);
    // a name without a number keeps: "Anaemia" for a haemoglobin under 10 instead of 11
    expect(one([reason('hb_under_11', 'moderate', 'Hb under 10')], [{ key: 'hb_under_11', label: 'Hb under 10', factor: 'lowestHb', op: 'lt', value: 10, level: 'moderate' }])).toMatchObject({ id: 'anaemia' });
    // the row now checks something else: the hospital's own rule – its name, a line to write on
    const reused = [{ key: 'weight_under_45', label: 'Lowest Hb under 9', factor: 'lowestHb', op: 'lt', value: 9, level: 'moderate' }];
    expect(one([reason('weight_under_45', 'moderate', 'Lowest Hb under 9')], reused)).toMatchObject({ id: 'rule:weight_under_45', name: { en: 'Lowest Hb under 9' }, complications: null });
    const turned = [{ key: 'bmi_30_plus', label: 'BMI under 17', factor: 'bmi', op: 'lt', value: 17, level: 'moderate' }];
    expect(one([reason('bmi_30_plus', 'moderate', 'BMI under 17')], turned)).toMatchObject({ id: 'rule:bmi_30_plus', complications: null });
    // a rule of the hospital's own on a private condition is marked private too
    expect(one([reason('rule_mh', 'high', 'Depression on treatment')], [{ key: 'rule_mh', factor: 'condition', condition: 'mental_health' }]).private).toBe(true);
    expect(one([reason('rule_tw', 'high', 'Triplets')], [{ key: 'rule_tw', factor: 'finding', finding: 'multiple' }]).private).toBe(false);
  });

  it("prints a rule of the hospital's own by its label, with no complications of ours", () => {
    const [own] = consentRiskFactors(patient([reason('rule_ab12', 'high', 'IVF pregnancy')]));
    expect(own).toEqual({ id: 'rule:rule_ab12', level: 'high', name: { en: 'IVF pregnancy', mr: '', hi: '' }, complications: null, private: false, labels: ['IVF pregnancy'] });
  });

  it('never offers HIV, whatever the rule is called, and nothing outside antenatal care', () => {
    expect(isHivReason(reason('cond_hiv', 'high', 'Condition 12'))).toBe(true);
    expect(isHivReason(reason('rule_x', 'high', 'HIV positive'))).toBe(true);
    expect(isHivReason(reason('rule_y', 'high', 'On treatment for AIDS'))).toBe(true);
    for (const label of ['RVD reactive', 'PLHIV', 'Retroviral disease', 'HIV1/2 reactive', 'On antiretroviral treatment', 'एचआयव्ही', 'एच.आई.वी. पॉज़िटिव']) expect(isHivReason(reason('rule_n', 'high', label)), label).toBe(true);
    expect(isHivReason(reason('rule_c', 'high', 'Registered at the ICTC'))).toBe(true); // a rule that is not known: the wider list of signs
    expect(isHivReason(reason('rule_z', 'high', 'Uses hearing aids at home'))).toBe(false);
    expect(isHivReason(reason('cond_thyroid', 'high', 'Thyroid disease'))).toBe(false);
    expect(isHivReason(reason('rule_q', 'high', 'Archive of scans missing'))).toBe(false); // "hiv" inside a word is not HIV
    expect(isHivReason(reason('rule_i', 'high', 'ART pregnancy (IVF)'))).toBe(false); // assisted reproduction
    // What the rule checks decides, whatever a doctor called it
    const hivRule = { key: 'rule_o', label: 'On ART', factor: 'condition', condition: 'hiv', level: 'high' };
    expect(isHivReason(reason('rule_o', 'high', 'On ART'), hivRule)).toBe(true);
    expect(consentRiskFactors(patient([reason('rule_o', 'high', 'On ART'), reason('rule_m', 'high', 'विशेष काळजी'), reason('cond_tb')]), [hivRule, { ...hivRule, key: 'rule_m', label: 'विशेष काळजी' }]).map((f) => f.id)).toEqual(['tuberculosis']);
    expect(consentFacts({ careType: 'antenatal', risk: { level: 'high', reasons: [reason('rule_o', 'high', 'On ART'), reason('cond_tb', 'high', 'Tuberculosis')] } }, [], new Date('2026-09-28T00:00:00Z'), {}, [hivRule]).highReasons).toEqual(['Tuberculosis']);
    // The words for a typed line: what plainly names HIV, and nothing a consent may need to say
    const REFUSED = [
      'HIV +ve', 'hiv-1', 'HIV negative', 'H.I.V. positive', 'H. I. V.', 'H I V', 'AIDS', 'RVD', 'R.V.D. reactive', 'retro positive', 'Retro +ve',
      'retro-pos mother', 'retro status known', 'Retro: positive', 'retro(+)', 'retro negative', 'Retro -ve', 'Retro: NR', 'retro non-reactive',
      'anti-retroviral therapy', 'Human immunodeficiency virus infection', 'acquired immune deficiency syndrome', 'CD4 count 210', 'on zidovudine',
      'on HAART', 'sent by the ICTC', 'PPTCT', 'PMTCT', 'attends the ART centre', 'Link ART centre', 'एड्स', 'एडस', 'एचआइवी', 'एच आय व्ही', 'एच्.आय.व्ही.',
    ];
    for (const typed of REFUSED) expect(namesHiv(typed), typed).toBe(true);
    // Ordinary words of a maternity or fertility consent stay writable – also those that look alike
    const WRITABLE = [
      '', null, 'Retroplacental clot', 'Retroverted uterus', 'Retroverted uterus, NST non-reactive', 'retrograde flow', 'retroposed', 'retrospective',
      'retro (verted) uterus', 'Rh -ve', 'VDRL NR', 'hearing aids', 'Hepatitis B, high viral load, on tenofovir', 'TLE on carbamazepine', 'NVP since 6 weeks',
      'primary immunodeficiency', 'acquired immunodeficiency after chemotherapy', 'ART pregnancy', 'ART conception', 'On ART', 'IVF conception at our ART clinic',
      'ICSI at ART centre', 'IVF pregnancy – conceived at an ART clinic', 'Referred to a state-of-the-art centre', 'with IV fluids', 'Rh IV',
      'PROM for 18 h. I.V. antibiotics started', 'Dr. R. V. Deshmukh', 'Dr. R. V. D’Souza', 'Previous LSCS', 'पीपीएच आयव्ही ऑक्सिटोसिन', 'कमी एएमएच आयव्हीएफ सल्ला',
    ];
    for (const typed of WRITABLE) expect(namesHiv(typed), String(typed)).toBe(false);
    expect(consentRiskFactors(patient([reason('cond_hiv'), reason('rule_x', 'high', 'HIV positive'), reason('cond_tb')])).map((f) => f.id)).toEqual(['tuberculosis']);
    expect(consentRiskFactors(patient([reason('cond_tb')], 'postnatal'))).toEqual([]);
    expect(consentRiskFactors({ careType: 'antenatal' })).toEqual([]);
  });
});

// Consent forms on a patient's record: the forms for her type of care, suggestions, and printing (recorded,
// audited with ids only). Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { consentFacts, suggestion } from '../src/consents/suggest.js';
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

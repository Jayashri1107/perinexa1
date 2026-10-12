// The ultrasound consent ("Consent and declaration for ultrasound in pregnancy") was removed at the owner's
// request on 2 Oct 2026, with the PC-PNDT Form F register. A hospital's stored copies and printouts stay in the
// database but are never offered, listed, opened or printed (consents/retiredForms.js). The fetal-sex protection
// stays. Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { BUILT_IN_FORMS } from '../src/consents/builtInForms.js';
import { ensureConsentForms } from '../src/consents/consentFormsService.js';
import { EN } from '../src/consents/forms/en.js';
import { HI } from '../src/consents/forms/hi.js';
import { MR } from '../src/consents/forms/mr.js';
import { RETIRED_FORM_KEYS, retiredFormIds } from '../src/consents/retiredForms.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ConsentForm } from '../src/models/ConsentForm.js';
import { PatientConsent } from '../src/models/PatientConsent.js';
import { StoredFile } from '../src/models/StoredFile.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse' };
const USG_TITLE = 'Consent and declaration for ultrasound in pregnancy';

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
  hospital = await createTenant('Retired Forms Hospital');
  other = await createTenant('Other Retired Forms Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Sample outsider' });
  await addMember(people.outsider, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const library = async (who = 'drA') => (await as(who)).get('/api/consent-forms');
const keysOf = (forms) => forms.map((f) => f.key);
const idsOf = (forms) => forms.map((f) => f.id);
const lang = (en) => ({ en, mr: `${en} (mr)`, hi: `${en} (hi)` });

const formDoc = (tenantId, overrides) => ({
  tenantId,
  origin: 'hospital',
  title: lang('A form'),
  description: '',
  careTypes: [],
  suggestWhen: 'none',
  clauses: [lang('I, {patient}, give consent.')],
  order: 1000,
  status: 'draft',
  version: 1,
  isActive: true,
  updatedByName: 'Sample drA',
  ...overrides,
});
// How the library recorded a copy (routes/consentForms.js POST / with copyFrom), before the form was retired.
const copied = (tenantId, form, from) =>
  AuditLog.create({ action: 'CONSENT_FORM_CREATED', tenantId, actorEmail: 'sample@example.com', details: { formId: String(form._id), title: form.title.en, version: 1, copiedFrom: String(from._id) } });

/** A hospital that used the ultrasound consent before it was removed: its copy, copies of it and its own forms. */
async function seedOldForms() {
  await ensureConsentForms(hospital._id);
  const usg = await ConsentForm.create(
    formDoc(hospital._id, {
      key: 'ultrasound_pregnancy',
      origin: 'built_in',
      builtInVersion: 0,
      title: lang(USG_TITLE),
      careTypes: ['antenatal'],
      suggestWhen: 'scan_due',
      clauses: [lang('I, {patient}, give consent for an ultrasound: {procedure}.'), lang('I will give the details needed for the record (Form F).')],
      order: 5,
      version: 3,
      updatedByName: 'Built-in draft',
    }),
  );
  // A copy, then a copy of the copy, both reworded so that they no longer say "Form F".
  const copy = await ConsentForm.create(formDoc(hospital._id, { key: 'form_aaaa1111', title: lang('Our scan consent'), careTypes: ['antenatal'], suggestWhen: 'scan_due', clauses: [lang('Scan: {procedure}.')] }));
  await copied(hospital._id, copy, usg);
  const copyOfCopy = await ConsentForm.create(formDoc(hospital._id, { key: 'form_aaaa2222', title: lang('Our scan consent 2'), clauses: [lang('Scan for {patient}.')] }));
  await copied(hospital._id, copyOfCopy, copy);
  // The hospital's own form that mentions Form F.
  const formF = await ConsentForm.create(formDoc(hospital._id, { key: 'form_aaaa3333', title: lang('Scan declaration'), clauses: [lang('The doctor completes the record (Form F).')] }));
  // The hospital's own form that only repeats the fetal-sex protection: part of what is kept.
  const keep = await ConsentForm.create(
    formDoc(hospital._id, {
      key: 'form_aaaa4444',
      title: lang('Sonography consent'),
      careTypes: ['antenatal'],
      suggestWhen: 'scan_due',
      clauses: [lang('Scan: {procedure}.'), lang('PC&PNDT Act – the sex of the foetus is not disclosed at this hospital.')],
    }),
  );
  // Both stored before the removal (2 Oct 2026): the Form F rule looks at wording stored before then.
  for (const f of [formF, keep]) await ConsentForm.collection.updateOne({ _id: f._id }, { $set: { updatedAt: new Date('2026-09-01T00:00:00Z') } });
  return { usg, copy, copyOfCopy, formF, keep };
}

// A fake antenatal patient of Dr A at 18 w 0 d: the anomaly scan is due.
async function register() {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Retired Consent Mother',
      ageYears: 28,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'B+', heightCm: 160, weightKg: 60, conditionsReviewed: true },
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

const printout = (patient, form, overrides = {}) =>
  PatientConsent.create({
    tenantId: hospital._id,
    patientId: patient.id,
    formId: form._id,
    formKey: form.key,
    formVersion: form.version,
    formApproved: false,
    title: form.title.en,
    language: 'mr',
    clientRequestId: randomUUID(),
    printedBy: people.drA._id,
    printedByName: 'Sample drA',
    printedAt: new Date('2026-09-01T06:00:00Z'),
    ...overrides,
  });
const PDF = Buffer.from('%PDF-1.4\n% fake sample scan\n%%EOF\n');

describe('the built-in forms', () => {
  it('no longer include the ultrasound consent', () => {
    expect(RETIRED_FORM_KEYS).toEqual(['ultrasound_pregnancy']);
    expect(BUILT_IN_FORMS.map((f) => f.key)).not.toContain('ultrasound_pregnancy');
    for (const words of [EN, MR, HI]) expect(Object.keys(words)).not.toContain('ultrasound_pregnancy');
    expect(JSON.stringify([BUILT_IN_FORMS, EN, MR, HI])).not.toMatch(/Form F|फॉर्म एफ|MTP/);
  });

  it('the Abortion type of care (pregnancy loss) gets the HIV test, anaesthesia and the early-loss sheets – never suggested automatically', () => {
    const forAbortion = BUILT_IN_FORMS.filter((f) => f.careTypes.includes('abortion')).map((f) => f.key);
    expect(forAbortion).toEqual(expect.arrayContaining(['hiv_test', 'anaesthesia', 'info_miscarriage', 'info_ectopic', 'info_molar']));
    // A threatened miscarriage is a continuing pregnancy, under Antenatal (owner, 3 Oct 2026): its sheet stays there
    expect(forAbortion).not.toContain('info_threatened_miscarriage');
    expect(BUILT_IN_FORMS.find((f) => f.key === 'info_threatened_miscarriage').careTypes).toEqual(['antenatal', 'gynaecology']);
    expect(BUILT_IN_FORMS.filter((f) => f.careTypes.includes('abortion') && f.key !== 'hiv_test').every((f) => f.suggestWhen === 'none')).toBe(true);
    expect(JSON.stringify(BUILT_IN_FORMS.filter((f) => f.careTypes.includes('abortion')))).not.toMatch(/MTP|terminat|Form F/i);
  });

  it('a new hospital never gets it; a hospital holding an old copy keeps it stored, untouched', async () => {
    const res = await library();
    expect(res.status).toBe(200);
    expect(keysOf(res.body.forms)).not.toContain('ultrasound_pregnancy');
    expect(await ConsentForm.countDocuments({ tenantId: hospital._id, key: 'ultrasound_pregnancy' })).toBe(0);

    const { usg } = await seedOldForms();
    await library();
    await ensureConsentForms(hospital._id);
    const stored = await ConsentForm.findOne({ tenantId: hospital._id, _id: usg._id }).lean();
    expect(stored).toMatchObject({ version: 3, builtInVersion: 0, status: 'draft', isActive: true, updatedByName: 'Built-in draft' });
    expect(stored.title.en).toBe(USG_TITLE);
    expect(await AuditLog.countDocuments({ action: 'CONSENT_FORM_UPDATED' })).toBe(0);
  });
});

describe("a hospital's old copies", () => {
  it('are not listed in the library: the old form, its copies and the hospital forms about Form F', async () => {
    const { usg, copy, copyOfCopy, formF, keep } = await seedOldForms();
    expect([...(await retiredFormIds(hospital._id))].sort()).toEqual([usg, copy, copyOfCopy, formF].map((f) => String(f._id)).sort());
    for (const who of ['drA', 'rmo', 'nurse']) {
      const res = await library(who);
      expect(res.status, who).toBe(200);
      const ids = idsOf(res.body.forms);
      for (const f of [usg, copy, copyOfCopy, formF]) expect(ids, `${who} ${f.key}`).not.toContain(String(f._id));
      expect(ids, who).toContain(String(keep._id)); // only the fetal-sex protection: kept
      expect(res.body.forms).toHaveLength(BUILT_IN_FORMS.length + 1);
    }
  });

  it('cannot be opened, changed, approved, switched on or off, or copied', async () => {
    const old = await seedOldForms();
    const dr = await as('drA');
    for (const name of ['usg', 'copy', 'copyOfCopy', 'formF']) {
      const f = old[name];
      const url = `/api/consent-forms/${f._id}`;
      const view = await dr.get(url);
      expect(view.status, name).toBe(404);
      expect(view.body.error.message).toBe('Consent form not found.');
      const body = { title: f.title, description: '', careTypes: [], suggestWhen: 'none', clauses: f.clauses.map((c) => ({ en: c.en, mr: c.mr, hi: c.hi })), version: f.version };
      expect((await dr.put(url).send(body)).status, name).toBe(404);
      expect((await dr.post(`${url}/approve`).send({ confirm: true, version: f.version })).status, name).toBe(404);
      expect((await dr.patch(`${url}/active`).send({ active: false })).status, name).toBe(404);
      const copy = await dr.post('/api/consent-forms').send({ copyFrom: String(f._id) });
      expect(copy.status, name).toBe(404);
      expect(copy.body.error.message).toBe('Form to copy not found.');
    }
    // Nothing changed or added.
    const stored = await ConsentForm.findOne({ tenantId: hospital._id, _id: old.usg._id }).lean();
    expect(stored).toMatchObject({ version: 3, status: 'draft', isActive: true });
    expect(await ConsentForm.countDocuments({ tenantId: hospital._id })).toBe(BUILT_IN_FORMS.length + 5);
    // The kept form still works as before.
    expect((await dr.get(`/api/consent-forms/${old.keep._id}`)).status).toBe(200);
    expect((await dr.post('/api/consent-forms').send({ copyFrom: String(old.keep._id) })).status).toBe(201);
  });

  it("another hospital's forms are not affected", async () => {
    const { usg } = await seedOldForms();
    await ensureConsentForms(other._id);
    const theirs = await ConsentForm.create(formDoc(other._id, { key: 'form_bbbb1111', title: lang('Their own scan consent') }));
    // An entry in another hospital's audit log never counts for this one, and the other way round.
    await copied(other._id, theirs, usg);
    const res = await (await as('outsider')).get('/api/consent-forms');
    expect(res.status).toBe(200);
    expect(idsOf(res.body.forms)).toContain(String(theirs._id));
    expect(keysOf(res.body.forms)).not.toContain('ultrasound_pregnancy');
    expect((await retiredFormIds(other._id)).size).toBe(0);
    expect((await (await as('outsider')).get(`/api/consent-forms/${usg._id}`)).status).toBe(404); // another hospital's form
  });
});

describe("a patient's consent forms", () => {
  it('neither offer nor suggest an old form; a kept form with the scan rule is still suggested', async () => {
    const { usg, copy, copyOfCopy, formF, keep } = await seedOldForms();
    const p = await register();
    const res = await (await as('drA')).get(`/api/patients/${p.id}/consents`);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body.forms);
    for (const f of [usg, copy, copyOfCopy, formF]) expect(ids, f.key).not.toContain(String(f._id));
    const kept = res.body.forms.find((f) => f.id === String(keep._id));
    expect(kept).toMatchObject({ forThisCare: true, suggested: { why: 'scan_due', prefill: { procedure: 'Anomaly scan (level II / TIFFA)' } } });
    expect(JSON.stringify(res.body)).not.toMatch(/ultrasound in pregnancy|Form F/);
    // Printing an old form is refused with the usual message.
    const print = await (await as('drA')).post(`/api/patients/${p.id}/consents`).send({ clientRequestId: randomUUID(), formId: String(usg._id), version: 3, language: 'mr' });
    expect(print.status).toBe(404);
    expect(print.body.error.message).toBe('Consent form not found.');
  });

  it('old printouts stay stored but are never listed, recorded as signed, or have scans attached or opened', async () => {
    const { usg, copy, keep } = await seedOldForms();
    const p = await register();
    const unsigned = await printout(p, usg);
    const signedBy = { on: new Date('2026-09-01T00:00:00Z'), recordedBy: people.nurse._id, recordedByName: 'Sample nurse', recordedAt: new Date('2026-09-01T07:00:00Z') };
    const signed = await printout(p, usg, { signed: signedBy, printedAt: new Date('2026-09-01T06:30:00Z') });
    const file = await StoredFile.create({ tenantId: hospital._id, patientId: p.id, kind: 'signed_consent', ownerId: signed._id, fileName: 'old scan.pdf', mediaType: 'application/pdf', size: PDF.length, data: PDF, by: people.nurse._id, byName: 'Sample nurse' });
    await PatientConsent.collection.updateOne({ _id: signed._id }, { $push: { scans: { fileId: file._id, fileName: 'old scan.pdf', mediaType: 'application/pdf', size: PDF.length, by: people.nurse._id, byName: 'Sample nurse', at: NOW } } });
    const ofCopy = await printout(p, copy);
    const current = await printout(p, keep, { language: 'hi', printedAt: new Date('2026-08-01T06:00:00Z') });

    const res = await (await as('drA')).get(`/api/patients/${p.id}/consents`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body.printed)).toEqual([String(current._id)]);
    expect(res.body.defaultLanguage).toBe('hi'); // from the printouts still listed

    const base = `/api/patients/${p.id}/consents`;
    for (const c of [unsigned, ofCopy]) {
      const r = await (await as('nurse')).post(`${base}/${c._id}/signed`).send({ signedOn: '2026-09-28' });
      expect(r.status).toBe(404);
      expect(r.body.error.message).toBe('This printed consent form was not found.');
    }
    const add = await (await as('nurse')).post(`${base}/${signed._id}/scans`).send({ fileName: 'scan.pdf', mediaType: 'application/pdf', data: PDF.toString('base64') });
    expect(add.status).toBe(404);
    expect((await (await as('drA')).get(`${base}/${signed._id}/scans/${file._id}`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: { $in: ['CONSENT_SIGNED_RECORDED', 'CONSENT_SCAN_ADDED', 'CONSENT_SCAN_OPENED'] } })).toBe(0);

    // Everything is still in the database, unchanged.
    expect(await PatientConsent.countDocuments({ tenantId: hospital._id, patientId: p.id })).toBe(4);
    expect((await PatientConsent.findOne({ tenantId: hospital._id, _id: unsigned._id })).signed).toBeNull();
    expect(await StoredFile.countDocuments({ tenantId: hospital._id, ownerId: signed._id })).toBe(1);
    // The kept form's printout works as before.
    expect((await (await as('nurse')).post(`${base}/${current._id}/signed`).send({ signedOn: '2026-09-28' })).status).toBe(200);
  });
});

describe('information forms', () => {
  it('?kind=information and the information still to give never include an old form or a copy of it', async () => {
    const { usg, formF } = await seedOldForms();
    // Information forms made before the removal: a copy of the old ultrasound form, a copy of the hospital's
    // Form F form, and the hospital's own information sheet (kept). All three would be suggested for everyone.
    const info = (key, title) => formDoc(hospital._id, { key, kind: 'information', title: lang(title), suggestWhen: 'always', clauses: [lang('{doctor} explained {condition} to {patient}.')] });
    const usgInfo = await ConsentForm.create(info('form_cccc1111', 'Scan information'));
    await copied(hospital._id, usgInfo, usg);
    const formFInfo = await ConsentForm.create(info('form_cccc2222', 'Scan record information'));
    await copied(hospital._id, formFInfo, formF);
    const keptInfo = await ConsentForm.create(info('form_cccc3333', 'Our information sheet'));
    const p = await register();
    const dr = await as('drA');

    const consents = await dr.get(`/api/patients/${p.id}/consents`);
    expect(consents.status).toBe(200);
    expect(consents.body.kind).toBe('consent');
    for (const f of [usg, formF, usgInfo, formFInfo]) expect(idsOf(consents.body.forms), f.key).not.toContain(String(f._id));

    const infos = await dr.get(`/api/patients/${p.id}/consents?kind=information`);
    expect(infos.status).toBe(200);
    expect(infos.body.kind).toBe('information');
    const ids = idsOf(infos.body.forms);
    for (const f of [usg, formF, usgInfo, formFInfo]) expect(ids, f.key).not.toContain(String(f._id));
    expect(infos.body.forms.find((f) => f.id === String(keptInfo._id))).toMatchObject({ suggested: { why: 'always' } });

    const due = await dr.get(`/api/patients/${p.id}/consents/information-due`);
    expect(due.status).toBe(200);
    const dueIds = due.body.due.map((f) => f.id);
    expect(dueIds).toContain(String(keptInfo._id));
    for (const f of [usgInfo, formFInfo]) expect(dueIds, f.key).not.toContain(String(f._id));
    expect(JSON.stringify([consents.body, infos.body, due.body])).not.toMatch(/ultrasound in pregnancy|Form F|Scan information|Scan record information/);
  });

  it('an old ultrasound printout saved before forms had a kind is not listed as a consent', async () => {
    const { usg, keep } = await seedOldForms();
    const p = await register();
    const old = await printout(p, usg);
    const kept = await printout(p, keep);
    // Printouts saved before there were information forms have no kind at all.
    await PatientConsent.collection.updateMany({ _id: { $in: [old._id, kept._id] } }, { $unset: { kind: '' } });
    expect((await PatientConsent.collection.findOne({ _id: old._id })).kind).toBeUndefined();

    const dr = await as('drA');
    const consents = await dr.get(`/api/patients/${p.id}/consents`);
    expect(consents.status).toBe(200);
    expect(idsOf(consents.body.printed)).toEqual([String(kept._id)]); // the kept one with no kind is still listed
    const infos = await dr.get(`/api/patients/${p.id}/consents?kind=information`);
    expect(idsOf(infos.body.printed)).toEqual([]);
    expect(await PatientConsent.countDocuments({ tenantId: hospital._id, _id: old._id })).toBe(1); // still stored
  });
});

describe("a hospital form edited after the removal", () => {
  it('stays listed with its printouts and scans, even when the new wording mentions Form F', async () => {
    const p = await register();
    const dr = await as('drA');
    const admission = (await library()).body.forms.find((f) => f.key === 'admission');
    const made = await dr.post('/api/consent-forms').send({ copyFrom: admission.id });
    expect(made.status).toBe(201);
    const id = made.body.form.id;
    expect((await dr.post(`/api/consent-forms/${id}/approve`).send({ confirm: true, version: 1 })).status).toBe(200);

    // Printed for the fake patient, the signed copy recorded and its scan attached – before the removal.
    const base = `/api/patients/${p.id}/consents`;
    const printed = await dr.post(base).send({ clientRequestId: randomUUID(), formId: id, version: 1, language: 'mr' });
    expect(printed.status, JSON.stringify(printed.body)).toBe(201);
    const consentId = printed.body.consent.id;
    expect((await (await as('nurse')).post(`${base}/${consentId}/signed`).send({ signedOn: '2026-09-28' })).status).toBe(200);
    const scan = await (await as('nurse')).post(`${base}/${consentId}/scans`).send({ fileName: 'signed.pdf', mediaType: 'application/pdf', data: PDF.toString('base64') });
    expect(scan.status).toBe(201);
    const fileId = scan.body.consent.scans[0].id;

    // After the removal the doctor adds a clause that mentions Form F.
    vi.setSystemTime(new Date('2026-10-05T06:00:00Z'));
    sessions = {}; // a week later: everyone logs in again
    const dr2 = await as('drA');
    const form = (await dr2.get(`/api/consent-forms/${id}`)).body.form;
    const clauses = [...form.clauses.map((c) => ({ en: c.en, mr: c.mr, hi: c.hi })), lang('The scan record (Form F) is kept by the hospital.')];
    const put = await dr2.put(`/api/consent-forms/${id}`).send({ title: form.title, description: form.description, careTypes: form.careTypes, suggestWhen: form.suggestWhen, clauses, version: form.version });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    expect(idsOf((await library()).body.forms)).toContain(id);
    expect((await dr2.get(`/api/consent-forms/${id}`)).status).toBe(200);
    expect([...(await retiredFormIds(hospital._id))]).not.toContain(id);
    const list = await dr2.get(base);
    expect(idsOf(list.body.printed)).toContain(consentId);
    expect(idsOf(list.body.forms)).toContain(id);
    expect((await dr2.get(`${base}/${consentId}/scans/${fileId}`)).status).toBe(200);
    const more = await (await as('nurse')).post(`${base}/${consentId}/scans`).send({ fileName: 'back page.pdf', mediaType: 'application/pdf', data: PDF.toString('base64') });
    expect(more.status).toBe(201);
  });
});

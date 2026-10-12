// The hospital's consent-form library: built-in bilingual drafts, editing, approval and forms not in use.
// Fake data only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { BUILT_IN_FORMS, BUILT_IN_FORMS_VERSION } from '../src/consents/builtInForms.js';
import { blankProblems, languagesOf } from '../src/consents/consentText.js';
import { ensureConsentForms } from '../src/consents/consentFormsService.js';
import { EN } from '../src/consents/forms/en.js';
import { HI } from '../src/consents/forms/hi.js';
import { MR } from '../src/consents/forms/mr.js';
import { INFO_EN } from '../src/consents/forms/info_en.js';
import { INFO_HI } from '../src/consents/forms/info_hi.js';
import { INFO_MR } from '../src/consents/forms/info_mr.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ConsentForm } from '../src/models/ConsentForm.js';
import { SUGGEST_RULES } from '../src/models/ConsentForm.js';
import * as website from '../../client/src/pages/consents/consentFormat.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

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
  app = createApp();
  hospital = await createTenant('Consent Hospital');
  other = await createTenant('Other Consent Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
  people.superAdmin = await createSuperAdmin();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const list = async (who = 'drA') => (await as(who)).get('/api/consent-forms');
async function formByKey(key, who = 'drA') {
  const res = await list(who);
  expect(res.status).toBe(200);
  const summary = res.body.forms.find((f) => f.key === key);
  const full = await (await as(who)).get(`/api/consent-forms/${summary.id}`);
  expect(full.status).toBe(200);
  return full.body.form;
}
const bodyOf = (f, changes = {}) => ({
  title: f.title,
  description: f.description,
  careTypes: f.careTypes,
  suggestWhen: f.suggestWhen,
  clauses: f.clauses,
  version: f.version,
  ...changes,
});
const put = async (who, f, body) => (await as(who)).put(`/api/consent-forms/${f.id}`).send(body);
const approve = async (who, f, body = { confirm: true, version: f.version }) => (await as(who)).post(`/api/consent-forms/${f.id}/approve`).send(body);

describe('the built-in drafts', () => {
  it('come in English, Marathi and Hindi, clause by clause, with the same blanks', () => {
    expect(Object.keys(MR)).toEqual(Object.keys(EN));
    expect(Object.keys(HI)).toEqual(Object.keys(EN));
    expect(Object.keys(INFO_MR)).toEqual(Object.keys(INFO_EN));
    expect(Object.keys(INFO_HI)).toEqual(Object.keys(INFO_EN));
    expect(BUILT_IN_FORMS.map((f) => f.key).sort()).toEqual([...Object.keys(EN), ...Object.keys(INFO_EN)].sort());
    for (const f of BUILT_IN_FORMS) {
      expect(f.kind, f.key).toBe(f.key in INFO_EN ? 'information' : 'consent');
      expect(f.clauses.length, f.key).toBe((EN[f.key] ?? INFO_EN[f.key]).clauses.length);
      expect(languagesOf(f), f.key).toEqual(['en', 'mr', 'hi']);
      expect(blankProblems(f), f.key).toEqual({});
    }
  });

  it('no longer include the ultrasound consent (removed at the owner\'s request, 2 Oct 2026)', () => {
    expect(BUILT_IN_FORMS.some((f) => f.key === 'ultrasound_pregnancy')).toBe(false);
    for (const words of [EN, MR, HI]) expect(words.ultrasound_pregnancy).toBeUndefined();
    expect(JSON.stringify(BUILT_IN_FORMS)).not.toMatch(/Form F|MTP/);
    // PC&PNDT is only mentioned for the protection that stays (nothing about the baby's sex is disclosed).
    for (const f of BUILT_IN_FORMS.filter((x) => /PC&PNDT/.test(JSON.stringify(x)))) expect(f.description, f.key).toMatch(/sex of the baby/);
  });

  it('are copied into each hospital once, as drafts', async () => {
    const res = await list('nurse');
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.forms).toHaveLength(BUILT_IN_FORMS.length);
    expect(res.body.forms.every((f) => f.status === 'draft' && f.version === 1 && f.origin === 'built_in' && f.isActive)).toBe(true);
    expect(res.body.forms[0]).toMatchObject({ key: 'hiv_test', languages: ['en', 'mr', 'hi'], blanks: expect.arrayContaining(['patient', 'mrn']) });
    expect(res.body.forms[0].clauses).toBeUndefined(); // the list has no clauses
    await ensureConsentForms(hospital._id);
    expect(await ConsentForm.countDocuments({ tenantId: hospital._id })).toBe(BUILT_IN_FORMS.length);
    expect(await ConsentForm.countDocuments({ tenantId: other._id })).toBe(0);
  });

  it('refresh an unedited draft when the built-in wording changes, but never an edited or approved form', async () => {
    await ensureConsentForms(hospital._id);
    const stale = { title: { en: 'Old title', mr: 'जुने', hi: 'पुराना' }, builtInVersion: BUILT_IN_FORMS_VERSION - 1 };
    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'admission' }, { $set: stale });
    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'procedure' }, { $set: { ...stale, builtInVersion: null } });
    await ConsentForm.updateOne({ tenantId: hospital._id, key: 'refusal' }, { $set: { ...stale, status: 'approved' } });
    await ensureConsentForms(hospital._id);
    const [admission, procedure, refusal] = await Promise.all(['admission', 'procedure', 'refusal'].map((key) => ConsentForm.findOne({ tenantId: hospital._id, key })));
    expect(admission.title.en).toBe(EN.admission.title);
    expect(admission).toMatchObject({ version: 2, builtInVersion: BUILT_IN_FORMS_VERSION, updatedByName: 'Built-in draft updated' });
    expect(procedure.title.en).toBe('Old title');
    expect(refusal.title.en).toBe('Old title');
    expect(await AuditLog.countDocuments({ action: 'CONSENT_FORM_UPDATED', actorEmail: 'system (built-in forms)' })).toBe(1);
  });
});

describe('who can use the library', () => {
  it('doctors, RMOs and nurses read it; other roles and other hospitals do not', async () => {
    for (const who of ['drA', 'rmo', 'nurse']) expect((await list(who)).status, who).toBe(200);
    for (const who of ['reception', 'lab', 'admin']) expect((await list(who)).status, who).toBe(403);
    const f = await formByKey('caesarean');
    expect((await (await as('outsider')).get(`/api/consent-forms/${f.id}`)).status).toBe(404);
    const sa = await as('superAdmin');
    expect((await sa.get('/api/consent-forms')).status).toBe(403);
  });

  it('only doctors change, add, approve or retire forms', async () => {
    const f = await formByKey('caesarean');
    for (const who of ['rmo', 'nurse']) {
      expect((await put(who, f, bodyOf(f))).status, who).toBe(403);
      expect((await approve(who, f)).status, who).toBe(403);
      expect((await (await as(who)).post('/api/consent-forms').send({})).status, who).toBe(403);
      expect((await (await as(who)).patch(`/api/consent-forms/${f.id}/active`).send({ active: false })).status, who).toBe(403);
    }
  });
});

describe('editing', () => {
  it('saves a new draft version and records who changed it', async () => {
    const f = await formByKey('caesarean');
    const clauses = f.clauses.map((c, i) => (i === 1 ? { ...c, en: 'The reason it is advised: {reason}. Discussed with the family.' } : c));
    const res = await put('drA', f, bodyOf(f, { clauses, careTypes: ['postnatal', 'antenatal', 'antenatal'] }));
    expect(res.status).toBe(200);
    expect(res.body.form).toMatchObject({ version: 2, status: 'draft', updatedByName: 'Sample drA', careTypes: ['antenatal', 'postnatal'] });
    expect(res.body.form.clauses[1].en).toMatch(/Discussed with the family/);
    const stored = await ConsentForm.findOne({ _id: f.id, tenantId: hospital._id });
    expect(stored.builtInVersion).toBeNull();
    const entry = await AuditLog.findOne({ action: 'CONSENT_FORM_UPDATED' });
    expect(entry.details).toEqual({ formId: f.id, title: f.title.en, version: 2 });
  });

  it('refuses a save based on an older version', async () => {
    const f = await formByKey('caesarean');
    expect((await put('drA', f, bodyOf(f))).status).toBe(200);
    const res = await put('drB', f, bodyOf(f));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/now version 2/);
  });

  it('checks the blanks in every language', async () => {
    const f = await formByKey('caesarean');
    const clauses = f.clauses.map((c) => ({ ...c }));
    clauses[0].en = 'I, {patient}, consent to {operation}.';
    clauses[1].mr = 'कारण: (रिकामे)'; // the English uses {reason}
    const res = await put('drA', f, bodyOf(f, { clauses, title: { ...f.title, hi: 'सहमति {patient}' } }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields['clauses.0.en']).toMatch(/Unknown blank \{operation\}/);
    expect(res.body.error.fields['clauses.1.mr']).toMatch(/same blanks as the English: \{reason\}/);
    expect(res.body.error.fields['title.hi']).toMatch(/cannot contain blanks/);
    expect((await ConsentForm.findOne({ _id: f.id, tenantId: hospital._id })).version).toBe(1);
  });

  it('a form is not a patient record, so a PC&PNDT sentence in its words is not refused', async () => {
    const f = await formByKey('admission');
    const clause = { en: 'The sex of the foetus is not disclosed at this hospital (PC&PNDT Act).', mr: '', hi: '' };
    const res = await put('drA', f, bodyOf(f, { clauses: [...f.clauses, clause] }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses unknown fields and empty English text', async () => {
    const f = await formByKey('caesarean');
    expect((await put('drA', f, { ...bodyOf(f), status: 'approved' })).status).toBe(400);
    const res = await put('drA', f, bodyOf(f, { clauses: [{ en: '  ', mr: '', hi: '' }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields['clauses.0.en']).toBeTruthy();
    expect((await put('drA', f, bodyOf(f, { clauses: [] }))).status).toBe(400);
  });
});

describe('approval', () => {
  it('needs the confirmation and the version reviewed, and becomes a draft again when changed', async () => {
    const f = await formByKey('caesarean');
    expect((await approve('drA', f, { version: f.version })).status).toBe(400);
    expect((await approve('drA', f, { confirm: true, version: f.version + 1 })).status).toBe(409);
    const res = await approve('drB', f);
    expect(res.status).toBe(200);
    expect(res.body.form).toMatchObject({ status: 'approved', approvedByName: 'Sample drB', approvedVersion: 1 });
    expect((await AuditLog.findOne({ action: 'CONSENT_FORM_APPROVED' })).details).toEqual({ formId: f.id, title: f.title.en, version: 1 });
    // approving again changes nothing
    expect((await approve('drA', f)).body.form.approvedByName).toBe('Sample drB');
    const edited = await put('drA', res.body.form, bodyOf(res.body.form));
    expect(edited.body.form).toMatchObject({ status: 'draft', version: 2, approvedVersion: 1 });
  });

  it('needs a complete Marathi or Hindi text', async () => {
    const f = await formByKey('caesarean');
    const englishOnly = await put('drA', f, bodyOf(f, { title: { ...f.title, mr: '', hi: '' }, clauses: f.clauses.map((c) => ({ en: c.en, mr: '', hi: '' })) }));
    expect(englishOnly.body.form.languages).toEqual(['en']);
    const res = await approve('drA', englishOnly.body.form);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Marathi or the Hindi/);
    const withMarathi = await put('drA', englishOnly.body.form, bodyOf(englishOnly.body.form, { title: f.title, clauses: f.clauses.map((c) => ({ ...c, hi: '' })) }));
    expect(withMarathi.body.form.languages).toEqual(['en', 'mr']);
    expect((await approve('drA', withMarathi.body.form)).status).toBe(200);
  });
});

describe("the hospital's own forms", () => {
  it('a doctor adds one from a starting text, or copies another form', async () => {
    const res = await (await as('drA')).post('/api/consent-forms').send({});
    expect(res.status).toBe(201);
    expect(res.body.form).toMatchObject({ origin: 'hospital', status: 'draft', version: 1, careTypes: [], suggestWhen: 'none', languages: ['en'] });
    expect(res.body.form.key).toMatch(/^form_[a-f0-9]{8}$/);
    expect(res.body.form.clauses).toHaveLength(2);
    const f = await formByKey('tubal_ligation');
    const copy = await (await as('drA')).post('/api/consent-forms').send({ copyFrom: f.id });
    expect(copy.status).toBe(201);
    expect(copy.body.form.title.en).toBe(`Copy of ${f.title.en}`);
    expect(copy.body.form.clauses).toEqual(f.clauses);
    expect(copy.body.form.languages).toEqual(['en', 'mr', 'hi']);
    expect(await AuditLog.countDocuments({ action: 'CONSENT_FORM_CREATED' })).toBe(2);
    const outsiderForm = await (await as('outsider')).get('/api/consent-forms');
    const foreign = outsiderForm.body.forms[0].id;
    expect((await (await as('drA')).post('/api/consent-forms').send({ copyFrom: foreign })).status).toBe(404);
  });

  it('a form not in use is kept, listed last and can be used again', async () => {
    const f = await formByKey('refusal');
    const off = await (await as('drA')).patch(`/api/consent-forms/${f.id}/active`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.form.isActive).toBe(false);
    const forms = (await list()).body.forms;
    expect(forms.at(-1).key).toBe('refusal');
    expect(await AuditLog.countDocuments({ action: 'CONSENT_FORM_DEACTIVATED' })).toBe(1);
    const on = await (await as('drA')).patch(`/api/consent-forms/${f.id}/active`).send({ active: true });
    expect(on.body.form.isActive).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'CONSENT_FORM_ACTIVATED' })).toBe(1);
  });
});

describe('the website checks the words the same way', () => {
  it('finds the same blank problems and languages as the server', () => {
    const samples = [
      ...BUILT_IN_FORMS,
      {
        title: { en: 'Consent for {patient}', mr: '', hi: 'सहमति' },
        clauses: [
          { en: 'I, {patient}, agree to {operation}.', mr: 'मी सहमत आहे.', hi: 'मैं, {patient}, {reason}.' },
          { en: 'No blanks.', mr: 'येथे {patient}.', hi: '' },
          { en: 'Reason: {reason}', mr: 'कारण: {reason}', hi: 'कारण: {reason} {reason}' },
        ],
      },
    ];
    for (const f of samples) {
      expect(website.blankProblems(f)).toEqual(blankProblems(f));
      expect(website.languagesOf(f)).toEqual(languagesOf(f));
    }
    expect(website.SUGGEST_RULES).toEqual(SUGGEST_RULES);
  });
});

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { blankProblems, languagesOf } from '../consents/consentText.js';
import { byListOrder, ensureConsentForms, formJSON, formSummary } from '../consents/consentFormsService.js';
import { isRetired, retiredFormIds } from '../consents/retiredForms.js';
import { ConsentForm, FORM_KINDS, SUGGEST_RULES } from '../models/ConsentForm.js';
import { hasRole } from '../models/Membership.js';
import { CARE_TYPES } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, objectId, parse } from '../utils/validate.js';

// The hospital's consent-form library (/api/consent-forms): doctors, RMOs and nurses can read it; doctors add,
// edit, approve and retire forms. The forms hold no patient data. Their wording is not checked for words about
// the baby's sex: a form may need to say that the sex of the foetus is not disclosed, and a form is not a
// patient's record. What is typed for one patient when printing is checked (routes/patientConsents.js).
// Forms removed from Perinexa (consents/retiredForms.js) are never listed, opened, changed or copied.

const VIEWERS = ['doctor', 'rmo', 'nurse'];
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const changedSince = (f, what) => new HttpError(409, `This form was changed (now version ${f.version}) after you opened it. ${what}`, 'CONFLICT');

const words = (label, max) => z.string().trim().max(max, `${label} is too long (at most ${max} characters)`);
const inLanguages = (label, max) =>
  z
    .object({
      en: words(`${label} (English)`, max).min(1, `${label} in English is required`),
      mr: words(`${label} (Marathi)`, max).default(''),
      hi: words(`${label} (Hindi)`, max).default(''),
    })
    .strict();

const formBody = z
  .object({
    title: inLanguages('Title', 150),
    description: words('Notes', 1000).default(''),
    careTypes: z.array(z.enum(CARE_TYPES)).max(CARE_TYPES.length).default([]),
    suggestWhen: z.enum(SUGGEST_RULES, 'Choose when the form is suggested').default('none'),
    clauses: z.array(inLanguages('Clause', 2000)).min(1, 'A form needs at least one clause').max(40, 'A form can have at most 40 clauses'),
    // The version the person edited: a save based on an older version is refused (it would undo newer changes).
    version: z.number('The form version you edited is missing – please reload the page').int().positive(),
  })
  .strict();

const createSchema = z.object({ copyFrom: objectId.optional(), kind: z.enum(FORM_KINDS).default('consent') }).strict();
const approveSchema = z
  .object({
    confirm: z.literal(true, 'Please confirm that the wording has been reviewed'),
    version: z.number('The form version you reviewed is missing – please reload the page').int().positive(),
  })
  .strict();
const activeSchema = z.object({ active: z.boolean('Say whether the form is in use') }).strict();

// A new form of the hospital's own: a starting text to change.
const STARTER = {
  title: { en: 'New consent form', mr: '', hi: '' },
  description: '',
  careTypes: [],
  suggestWhen: 'none',
  clauses: [
    { en: 'I, {patient} (patient no. {mrn}), give consent for {procedure}.', mr: '', hi: '' },
    {
      en: 'I have read this form, or it has been read and explained to me in a language I understand. I had the chance to ask questions and all my questions were answered. I sign this form of my own free will.',
      mr: '',
      hi: '',
    },
  ],
};

// A new information form: what was explained, signed by the patient and her relatives.
const INFO_STARTER = {
  title: { en: 'Information: new condition', mr: '', hi: '' },
  description: '',
  careTypes: [],
  suggestWhen: 'none',
  clauses: [
    { en: '{doctor} has explained to me, {patient} (patient no. {mrn}), and to my relatives that I have the following condition: {condition}.', mr: '', hi: '' },
    { en: 'The possible risks and complications for me and for the baby, the care needed and the warning signs have been explained to us.', mr: '', hi: '' },
    {
      en: 'This information was explained to me and my relatives in a language we understand. We had the chance to ask questions and our questions were answered. We sign to record that we have been informed. This is not a consent for any operation or procedure.',
      mr: '',
      hi: '',
    },
  ],
};

const withRights = (req, f) => ({ ...formJSON(f), canEdit: isDoctor(req), canApprove: isDoctor(req) });
const auditDetails = (f) => ({ formId: String(f._id), title: f.title.en, version: f.version });

async function findForm(req) {
  const { id } = parse(idParams, req.params);
  await ensureConsentForms(req.tenantId);
  const f = await ConsentForm.findOne({ _id: id, tenantId: req.tenantId });
  if (!f || isRetired(f, await retiredFormIds(req.tenantId))) throw new HttpError(404, 'Consent form not found.', 'NOT_FOUND');
  return f;
}

export const consentFormsRouter = Router();

consentFormsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...VIEWERS)) throw forbidden('Consent forms are available to doctors, RMOs and nurses.');
  next();
});

consentFormsRouter.get('/', async (req, res) => {
  await ensureConsentForms(req.tenantId);
  const [forms, retired] = await Promise.all([ConsentForm.find({ tenantId: req.tenantId }), retiredFormIds(req.tenantId)]);
  res.json({ forms: forms.filter((f) => !isRetired(f, retired)).map(formSummary).sort(byListOrder), canEdit: isDoctor(req) });
});

consentFormsRouter.get('/:id', async (req, res) => {
  res.json({ form: withRights(req, await findForm(req)) });
});

// A doctor adds a form of the hospital's own: a starting text, or a copy of another form (as a new draft).
consentFormsRouter.post('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can add consent forms.');
  const { copyFrom, kind } = parse(createSchema, req.body);
  let base = kind === 'information' ? { ...INFO_STARTER, kind } : { ...STARTER, kind };
  if (copyFrom) {
    const from = await ConsentForm.findOne({ _id: copyFrom, tenantId: req.tenantId });
    if (!from || isRetired(from, await retiredFormIds(req.tenantId))) throw new HttpError(404, 'Form to copy not found.', 'NOT_FOUND');
    const c = from.toObject();
    base = { ...c, title: { ...c.title, en: `Copy of ${c.title.en}`.slice(0, 150) } };
  }
  const f = await ConsentForm.create({
    tenantId: req.tenantId,
    key: `form_${randomBytes(4).toString('hex')}`,
    origin: 'hospital',
    kind: base.kind ?? 'consent',
    title: base.title,
    description: base.description ?? '',
    careTypes: base.careTypes ?? [],
    suggestWhen: base.suggestWhen ?? 'none',
    clauses: base.clauses.map((c) => ({ en: c.en, mr: c.mr ?? '', hi: c.hi ?? '' })),
    order: 1000,
    status: 'draft',
    version: 1,
    updatedByName: req.user.name,
  });
  await audit(req, 'CONSENT_FORM_CREATED', { details: { ...auditDetails(f), copiedFrom: copyFrom ?? null } });
  res.status(201).json({ form: withRights(req, f) });
});

// Editing always makes the form a draft again (a new version), so it must be approved again.
consentFormsRouter.put('/:id', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change consent forms.');
  const f = await findForm(req);
  const { version, ...data } = parse(formBody, req.body);
  if (version !== f.version) throw changedSince(f, 'Please reload it and make your changes again.');
  const problems = blankProblems(data);
  if (Object.keys(problems).length) throw invalid(problems);
  Object.assign(f, data, { careTypes: CARE_TYPES.filter((t) => data.careTypes.includes(t)) });
  f.version += 1;
  f.status = 'draft';
  f.builtInVersion = null; // the hospital's wording now: built-in updates no longer replace it
  f.updatedByName = req.user.name;
  await f.save();
  await audit(req, 'CONSENT_FORM_UPDATED', { details: auditDetails(f) });
  res.json({ form: withRights(req, f) });
});

// A doctor confirms the wording (and a translation) was reviewed and approves the form for use with patients.
consentFormsRouter.post('/:id/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can approve consent forms.');
  const { version } = parse(approveSchema, req.body);
  const f = await findForm(req);
  if (f.version !== version) throw changedSince(f, 'Please review the latest version before approving.');
  if (f.status === 'approved') return res.json({ form: withRights(req, f) });
  if (languagesOf(f).length < 2) {
    throw new HttpError(400, 'Complete the Marathi or the Hindi text (title and every clause) before approving: forms are printed in two languages.', 'VALIDATION');
  }
  // Approve exactly the version reviewed: a change saved meanwhile makes this update match nothing.
  const at = req.now ?? new Date();
  const r = await ConsentForm.updateOne(
    { _id: f._id, tenantId: req.tenantId, version, status: 'draft' },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedByName: req.user.name, approvedAt: at, approvedVersion: version }, $inc: { __v: 1 } },
  );
  const saved = await ConsentForm.findOne({ _id: f._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    if (saved?.status === 'approved' && saved.version === version) return res.json({ form: withRights(req, saved) });
    throw changedSince(saved ?? f, 'Please review the latest version before approving.');
  }
  await audit(req, 'CONSENT_FORM_APPROVED', { details: auditDetails(saved) });
  res.json({ form: withRights(req, saved) });
});

// In use or not: an inactive form is no longer offered for patients (it is kept, with its history).
consentFormsRouter.patch('/:id/active', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change which consent forms are in use.');
  const { active } = parse(activeSchema, req.body);
  const f = await findForm(req);
  if (f.isActive !== active) {
    f.isActive = active;
    f.updatedByName = req.user.name;
    await f.save();
    await audit(req, active ? 'CONSENT_FORM_ACTIVATED' : 'CONSENT_FORM_DEACTIVATED', { details: auditDetails(f) });
  }
  res.json({ form: withRights(req, f) });
});

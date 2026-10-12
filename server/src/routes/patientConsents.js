import { Router } from 'express';
import { z } from 'zod';
import { addDays, hospitalToday, utcDay } from '../careplans/dates.js';
import { currentPlanItems, planCtx } from '../careplans/plansService.js';
import { byListOrder, ensureConsentForms, formSummary } from '../consents/consentFormsService.js';
import { formBlanks, languagesOf, LANGUAGE_NAMES } from '../consents/consentText.js';
import { isRetired, RETIRED_FORM_KEYS, retiredFormIds } from '../consents/retiredForms.js';
import { consentFacts, formIsFor, suggestion } from '../consents/suggest.js';
import { ConsentForm, FORM_KINDS } from '../models/ConsentForm.js';
import { LabOrder } from '../models/LabOrder.js';
import { redFlagsForPatient } from '../redflags/redFlagService.js';
import { hasRole } from '../models/Membership.js';
import { PatientConsent } from '../models/PatientConsent.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { objectId, parse } from '../utils/validate.js';

// A patient's consent forms: /api/patients/:id/consents. Mounted inside the patients router, after its role
// gate. Which forms are printed for a patient is a clinical detail, so the list follows the patient access
// rules: those who may see the medical details see it; the treating (or an unassigned) doctor and RMOs print.
// The form is printed in the browser; the server records the printout (PatientConsent) and audits ids only.
// Forms removed from Perinexa (consents/retiredForms.js) are never offered, and their printouts stay stored but
// are never listed or opened.

export const patientConsentsRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
// A printout of a form removed from Perinexa: kept, but never opened or changed.
const isRetiredPrintout = async (req, consent) =>
  RETIRED_FORM_KEYS.includes(consent.formKey) || (await retiredFormIds(req.tenantId)).has(String(consent.formId));
const conflict = (message) => new HttpError(409, message, 'CONFLICT');

function consentAccess(req, patient) {
  const a = patientAccess(req, patient);
  return { view: a.view.has('pregnancy'), print: a.editClinical, level: a.level, emergencyNote: a.emergencyNote };
}

function assertCanView(req, patient) {
  const a = consentAccess(req, patient);
  if (a.view) return a;
  if (!hasRole(req.membership, 'doctor', 'rmo', 'nurse')) throw forbidden("Your role doesn't include consent forms.");
  throw forbidden('This is a sensitive record: consent forms are only visible to the treating doctor and RMOs.');
}

// The signed copy came back: the patient's doctor, an RMO or a nurse records it.
function assertCanRecordSigned(req, patient) {
  assertCanView(req, patient);
  const a = patientAccess(req, patient);
  if (a.editClinical || a.recordVitals) return;
  throw forbidden("Only the patient's doctor, an RMO or a nurse can record a signed consent.");
}

function assertCanPrint(req, patient) {
  const a = assertCanView(req, patient);
  if (a.print) return a;
  if (a.emergencyNote) throw forbidden("This is another doctor's patient: only the patient's doctor or an RMO can print consent forms.");
  throw forbidden("Only the patient's doctor or an RMO can print consent forms.");
}

// Which kind of form a request is about (?kind=information); consent forms when not given.
const kindOf = (req) => (FORM_KINDS.includes(req.query.kind) ? req.query.kind : 'consent');
// Consent printouts saved before there were information forms have no kind.
const kindFilter = (kind) => (kind === 'information' ? { kind: 'information' } : { kind: { $ne: 'information' } });

// The start of this pregnancy (as the red flags use it), or null when not antenatal / no EDD.
const pregnancyStart = (patient) => (patient.careType === 'antenatal' && patient.pregnancy?.effectiveEdd ? addDays(patient.pregnancy.effectiveEdd, -294) : null);

const valueOf = (order, testKeys, valueKey) =>
  order.tests.filter((t) => testKeys.includes(t.key)).flatMap((t) => t.values.filter((v) => v.key === valueKey));

/**
 * What the record shows for the information forms' rules: the latest visit's red-flag keys and the lab results
 * of this pregnancy (OGTT or TSH flagged high, haemoglobin below 11 g/dL, HBsAg reactive). Antenatal patients only.
 */
async function conditionFindings(ctx, patient) {
  if (patient.careType !== 'antenatal') return {};
  const since = pregnancyStart(patient);
  const [flags, orders] = await Promise.all([
    redFlagsForPatient(ctx, patient),
    LabOrder.find(
      { tenantId: ctx.tenantId, patientId: patient._id, status: { $in: ['reported', 'reviewed'] }, ...(since ? { 'reported.at': { $gte: since } } : {}) },
      { tests: 1 },
    ).lean(),
  ]);
  const values = (testKeys, valueKey) => orders.flatMap((o) => valueOf(o, testKeys, valueKey));
  return {
    flagKeys: (flags?.flags ?? []).map((f) => f.key),
    ogttHigh: values(['ogtt'], 'glucose2h').some((v) => v.flag === 'high' || Number(v.value) >= 140),
    tshHigh: values(['tsh'], 'tsh').some((v) => v.flag === 'high'),
    hbLow: values(['hb', 'cbc'], 'hb').some((v) => v.value !== '' && Number(v.value) < 11),
    hbsagReactive: values(['hbsag'], 'hbsag').some((v) => v.value === 'Reactive'),
  };
}

/**
 * The active forms of one kind for this patient, each with its suggestion and whether it fits her type of care.
 * Forms removed from Perinexa (retired) are left out; `retired` may be passed when already looked up.
 */
async function formsFor(req, patient, kind, retired) {
  await ensureConsentForms(req.tenantId);
  retired ??= await retiredFormIds(req.tenantId);
  const ctx = planCtx(req);
  const [forms, planItems, findings] = await Promise.all([
    ConsentForm.find({ tenantId: req.tenantId, isActive: true, kind }),
    currentPlanItems(ctx, patient),
    kind === 'information' ? conditionFindings(ctx, patient) : {},
  ]);
  const facts = consentFacts(patient, planItems, hospitalToday(ctx.now), findings);
  return forms
    .filter((f) => !isRetired(f, retired))
    .map((f) => ({ ...formSummary(f), forThisCare: formIsFor(f, patient.careType), suggested: suggestion(f, facts) }))
    .sort(byListOrder);
}

const printSchema = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    formId: objectId,
    version: z.number('The form version is missing – please reload the page').int().positive(),
    language: z.enum(['mr', 'hi', 'en'], 'Choose the language'),
    // Typed for this patient, so checked like any pregnancy record (nothing about the baby's sex).
    procedure: safeText('Operation or procedure', 200).default(''),
    reason: safeText('Reason', 300).default(''),
    condition: safeText('Condition or complication', 200).default(''),
    doctor: z.enum(['me', 'blank'], 'Choose whether to print your name').default('me'),
  })
  .strict();

// The forms for this patient – each with its suggestion (if any) and whether it is listed for this type of
// care – the forms printed before (newest first), and the language to offer first: the one last used for this
// patient, otherwise the hospital's.
// ?kind=information: the information forms instead (same rules, own list of printouts).
patientConsentsRouter.get('/', async (req, res) => {
  const kind = kindOf(req);
  const patient = await loadPatientForPlan(req);
  const access = assertCanView(req, patient);
  await ensureConsentForms(req.tenantId);
  const retired = await retiredFormIds(req.tenantId);
  const [list, printed] = await Promise.all([
    formsFor(req, patient, kind, retired),
    PatientConsent.find({
      tenantId: req.tenantId,
      patientId: patient._id,
      ...kindFilter(kind),
      formKey: { $nin: RETIRED_FORM_KEYS },
      formId: { $nin: [...retired] },
    })
      .sort({ printedAt: -1 })
      .limit(100),
  ]);
  await audit(req, 'CONSENTS_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, access: access.level, kind } });
  res.json({
    kind,
    forms: list,
    printed: printed.map((c) => c.toJSON()),
    canPrint: access.print,
    canRecordSigned: (() => {
      const a = patientAccess(req, patient);
      return Boolean(a.editClinical || a.recordVitals);
    })(),
    defaultLanguage: printed[0]?.language ?? req.tenant?.letterhead?.consentLanguage ?? 'mr',
  });
});

// The information still to give: suggested information forms with no printout in this pregnancy (or ever, outside
// pregnancy). Shown as a reminder on the patient record – at OPD visits and during a stay. Not audited: it holds
// form titles only and is loaded with the patient page (opening the tab is audited).
patientConsentsRouter.get('/information-due', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanView(req, patient);
  const forms = (await formsFor(req, patient, 'information')).filter((f) => f.suggested);
  if (!forms.length) return res.json({ due: [] });
  const since = pregnancyStart(patient);
  const given = await PatientConsent.distinct('formId', {
    tenantId: req.tenantId,
    patientId: patient._id,
    kind: 'information',
    formId: { $in: forms.map((f) => f.id) },
    ...(since ? { printedAt: { $gte: since } } : {}),
  });
  const givenIds = new Set(given.map(String));
  res.json({ due: forms.filter((f) => !givenIds.has(f.id)).map((f) => ({ id: f.id, title: f.title, why: f.suggested.why })) });
});

// A form is printed for the patient. 201 with the record; 200 when the same print (clientRequestId) was
// already saved, e.g. after a double click.
patientConsentsRouter.post('/', async (req, res) => {
  const body = parse(printSchema, req.body);
  const patient = await loadPatientForPlan(req);
  assertCanPrint(req, patient);

  const same = await PatientConsent.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) {
    if (!same.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ consent: same.toJSON() });
  }

  const form = await ConsentForm.findOne({ _id: body.formId, tenantId: req.tenantId });
  if (!form || isRetired(form, await retiredFormIds(req.tenantId))) throw new HttpError(404, 'Consent form not found.', 'NOT_FOUND');
  if (!form.isActive) throw conflict('This form is no longer in use. Choose another form.');
  if (form.version !== body.version) {
    throw conflict(`This form was changed (now version ${form.version}) after you opened it. Check the new wording, then print again.`);
  }
  if (!languagesOf(form).includes(body.language)) {
    const message = `This form's ${LANGUAGE_NAMES[body.language]} text is not complete. Choose another language.`;
    throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { language: message } });
  }

  const blanks = formBlanks(form);
  let consent;
  try {
    consent = await PatientConsent.create({
      tenantId: req.tenantId,
      patientId: patient._id,
      formId: form._id,
      formKey: form.key,
      kind: form.kind ?? 'consent',
      formVersion: form.version,
      formApproved: form.status === 'approved',
      title: form.title.en,
      language: body.language,
      procedure: blanks.has('procedure') ? body.procedure : '',
      reason: blanks.has('reason') ? body.reason : '',
      condition: blanks.has('condition') ? body.condition : '',
      doctorName: body.doctor === 'me' ? req.user.name : null,
      clientRequestId: body.clientRequestId,
      printedBy: req.user._id,
      printedByName: req.user.name,
      printedAt: req.now ?? new Date(),
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // The same print arrived twice at the same moment: the first one is kept.
    const first = await PatientConsent.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
    if (!first?.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ consent: first.toJSON() });
  }
  await audit(req, 'CONSENT_FORM_PRINTED', { details: { patientId: String(patient._id), mrn: patient.mrn, consentId: String(consent._id), kind: consent.kind } });
  res.status(201).json({ consent: consent.toJSON() });
});

const signedSchema = z
  .object({
    signedOn: z.iso.date('Please enter the date it was signed'),
    witness: safeText('Witness', 150).default(''),
    keptAt: safeText('Where the paper is kept', 200).default(''),
  })
  .strict();

// The signed copy came back: recorded once (the date, the witness, where the paper is kept), never changed.
patientConsentsRouter.post('/:consentId/signed', async (req, res) => {
  const { consentId } = parse(z.object({ consentId: objectId }), { consentId: req.params.consentId });
  const body = parse(signedSchema, req.body);
  const patient = await loadPatientForPlan(req);
  assertCanRecordSigned(req, patient);
  const consent = await PatientConsent.findOne({ _id: consentId, tenantId: req.tenantId, patientId: patient._id });
  if (!consent || (await isRetiredPrintout(req, consent))) throw new HttpError(404, 'This printed consent form was not found.', 'NOT_FOUND');
  if (consent.signed) throw conflict(`The signed copy was already recorded by ${consent.signed.recordedByName}.`);
  const on = utcDay(new Date(`${body.signedOn}T00:00:00Z`));
  const invalid = (message) => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { signedOn: message } });
  if (on > hospitalToday(req.now)) throw invalid("The date it was signed can't be in the future.");
  if (on < utcDay(consent.printedAt)) throw invalid('The date it was signed is before the form was printed – please check it.');
  const signed = { on, witness: body.witness.trim(), keptAt: body.keptAt.trim(), recordedBy: req.user._id, recordedByName: req.user.name, recordedAt: req.now ?? new Date() };
  const r = await PatientConsent.updateOne({ _id: consent._id, tenantId: req.tenantId, signed: null }, { $set: { signed } });
  if (r.matchedCount === 0) throw conflict('The signed copy was recorded by someone else meanwhile. Reload the page.');
  await audit(req, 'CONSENT_SIGNED_RECORDED', { details: { patientId: String(patient._id), mrn: patient.mrn, consentId: String(consent._id) } });
  const saved = await PatientConsent.findOne({ _id: consent._id, tenantId: req.tenantId });
  res.json({ consent: saved.toJSON() });
});

// The scanned copy of the signed paper (Version 2): attached after the signed copy is recorded, by those who may
// record it; at most 3 files (front and back pages). Opened by those who may see the consent forms.
const MAX_SCANS = 3;
const consentOf = async (req, patient) => {
  const { consentId } = parse(z.object({ consentId: objectId }), { consentId: req.params.consentId });
  const consent = await PatientConsent.findOne({ _id: consentId, tenantId: req.tenantId, patientId: patient._id });
  if (!consent || (await isRetiredPrintout(req, consent))) throw new HttpError(404, 'This printed consent form was not found.', 'NOT_FOUND');
  return consent;
};

patientConsentsRouter.post('/:consentId/scans', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanRecordSigned(req, patient);
  const consent = await consentOf(req, patient);
  const body = parse(fileUploadSchema, req.body);
  if (!consent.signed) throw conflict('Record the signed copy first (the date it was signed), then attach its scan.');
  if (consent.scans.length >= MAX_SCANS) throw conflict(`At most ${MAX_SCANS} scanned pages per consent form.`);
  const file = await storeFile(req, { patientId: patient._id, kind: 'signed_consent', ownerId: consent._id, body });
  const r = await PatientConsent.updateOne(
    { _id: consent._id, tenantId: req.tenantId, [`scans.${MAX_SCANS - 1}`]: { $exists: false } },
    { $push: { scans: fileEntry(file, { by: req.user._id, byName: req.user.name, at: req.now }) } },
  );
  if (r.matchedCount === 0) throw conflict(`At most ${MAX_SCANS} scanned pages per consent form.`);
  await audit(req, 'CONSENT_SCAN_ADDED', { details: { patientId: String(patient._id), mrn: patient.mrn, consentId: String(consent._id), fileId: String(file._id) } });
  const saved = await PatientConsent.findOne({ _id: consent._id, tenantId: req.tenantId });
  res.status(201).json({ consent: saved.toJSON() });
});

patientConsentsRouter.get('/:consentId/scans/:fileId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanView(req, patient);
  const consent = await consentOf(req, patient);
  const fileId = parse(objectId, req.params.fileId);
  const file = await findFile(req, { kind: 'signed_consent', ownerId: consent._id, fileId });
  await audit(req, 'CONSENT_SCAN_OPENED', { details: { patientId: String(patient._id), mrn: patient.mrn, consentId: String(consent._id), fileId: String(file._id) } });
  sendFile(res, file);
});

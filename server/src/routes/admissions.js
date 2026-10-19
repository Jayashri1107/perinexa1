import { Router } from 'express';
import { billRound } from '../billing/hooks.js';
import { nextIpdNo } from '../inpatient/admissionDesk.js';
import { billAdmitted } from '../billing/hooks.js';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { NursingEntry } from '../models/NursingEntry.js';
import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { planCtx } from '../careplans/plansService.js';
import { DOC_KINDS, ONE_PER_ADMISSION, SIGNED_BY, contentSchema, missingToSign, nursingSchema } from '../inpatient/docSchemas.js';
import { admissionView, documentView, entryView } from '../inpatient/inpatientView.js';
import { redFlagsForPatient } from '../redflags/redFlagService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// A patient's stays in hospital (Version 2, inpatients): /api/patients/:id/admissions. Mounted inside the patients
// router, after its role gate. Who may do what follows the patient access rules (utils/patientAccess.js):
//  - see the stays, documents and nursing chart: those who may see the medical details;
//  - admit, write documents, change the ward and bed: the treating (or an unassigned) doctor, RMOs;
//  - sign: admission and round notes – the doctor or RMO; delivery, operation and discharge – a doctor (SIGNED_BY);
//  - the nursing chart: nurses (not on sensitive records), the treating doctor, RMOs.
// Signed documents are locked (corrections are added below them). Confirming the discharge card discharges the
// patient; confirming a delivery note records the delivery on her record. The audit log gets ids only.

export const admissionsRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const rev = z.number('The version you edited is missing – please reload the page').int().min(0);
const pcpndtFor = (patient) => patient.careType !== 'newborn';
// The Abortion type of care has no delivery note (the one document that records a baby's sex): an evacuation or
// an operation for an ectopic goes in an operation note. A delivery draft made earlier still opens.
const NO_DELIVERY_NOTE = 'A delivery note is not used for the Abortion type of care – use an operation note.';
function assertDeliveryAllowed(patient, kind) {
  if (kind === 'delivery' && patient.careType === 'abortion') throw invalid({ kind: NO_DELIVERY_NOTE }, NO_DELIVERY_NOTE);
}

function access(req, patient) {
  const a = patientAccess(req, patient);
  return { view: a.view.has('pregnancy'), edit: a.editClinical, nursing: a.recordVitals, emergencyNote: a.emergencyNote, level: a.level };
}
function assertCanView(req, patient) {
  const a = access(req, patient);
  if (a.view) return a;
  if (!hasRole(req.membership, 'doctor', 'rmo', 'nurse')) throw forbidden("Your role doesn't include inpatient records.");
  throw forbidden('This is a sensitive record: inpatient records are only visible to the treating doctor and RMOs.');
}
function assertCanEdit(req, patient) {
  const a = assertCanView(req, patient);
  if (a.edit) return a;
  if (a.emergencyNote) throw forbidden("This is another doctor's patient: you can view her stay but not write in it.");
  throw forbidden("Only the patient's doctor or an RMO can admit her and write her documents.");
}
function assertCanChart(req, patient) {
  const a = assertCanView(req, patient);
  if (a.nursing) return a;
  throw forbidden("Only nurses, the patient's doctor and RMOs write the nursing chart.");
}
/** May this person sign a document of this kind? (and with which role) */
function signerRole(req, kind) {
  const roles = SIGNED_BY[kind];
  if (roles.includes('doctor') && hasRole(req.membership, 'doctor')) return 'doctor';
  if (roles.includes('rmo') && hasRole(req.membership, 'rmo')) return 'rmo';
  return null;
}
const ids = (patient, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...extra });

async function findAdmission(req, patient, id) {
  const admissionId = parse(objectId, id);
  const a = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!a) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return a;
}
async function findDocument(req, patient, admission, id) {
  const docId = parse(objectId, id);
  const d = await ClinicalDocument.findOne({ _id: docId, tenantId: req.tenantId, patientId: patient._id, admissionId: admission._id });
  if (!d) throw new HttpError(404, 'This document was not found.', 'NOT_FOUND');
  return d;
}

// What this person may do on a stay's page.
function pageAccess(req, a, admission) {
  const open = admission.status === 'admitted';
  return {
    canWrite: a.edit && open,
    canChart: a.nursing && open,
    canSignNotes: a.edit && Boolean(signerRole(req, 'round')),
    canConfirm: a.edit && hasRole(req.membership, 'doctor'),
    canAddAddition: a.edit || a.nursing,
  };
}

// The stay's page. While she is in hospital it also has her current red flags (from the nursing chart of this stay,
// her lab results and her latest visit) – worked out now, never stored; everyone who reaches this page may see the
// medical details (assertCanView). A stay that has ended has none.
async function admissionPage(req, patient, admission, a) {
  const [docs, entries, redFlags] = await Promise.all([
    ClinicalDocument.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ createdAt: 1 }),
    NursingEntry.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ at: -1 }).limit(500),
    admission.status === 'admitted' && a.view ? redFlagsForPatient(planCtx(req), patient) : null,
  ]);
  return {
    admission: admissionView(admission),
    documents: docs.map(documentView),
    nursing: entries.map(entryView),
    access: pageAccess(req, a, admission),
    ...(redFlags ? { redFlags } : {}),
  };
}

// ---------- Stays ----------

admissionsRouter.get('/', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanView(req, patient);
  const stays = await Admission.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ admittedAt: -1 }).limit(100);
  const counts = await ClinicalDocument.aggregate([
    { $match: { tenantId: req.tenantId, patientId: patient._id, status: { $ne: 'cancelled' } } },
    { $group: { _id: { admissionId: '$admissionId', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const countOf = (id, status) => counts.find((c) => String(c._id.admissionId) === String(id) && c._id.status === status)?.n ?? 0;
  await audit(req, 'ADMISSIONS_VIEWED', { details: ids(patient, { access: a.level }) });
  res.json({
    admissions: stays.map((s) => ({ ...admissionView(s), drafts: countOf(s._id, 'draft'), signed: countOf(s._id, 'signed') })),
    canAdmit: a.edit && !stays.some((s) => s.status === 'admitted') && !isDuplicate(patient) && !isClosed(patient),
  });
});

const admitSchema = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    admittedAt: z.preprocess((v) => (v === '' ? undefined : v), z.iso.datetime('Please enter the date and time of admission').optional()),
    ward: safeText('Ward', 60).default(''),
    bed: safeText('Bed', 30).default(''),
    reason: safeText('Reason for admission', 300).refine((t) => t.trim().length >= 3, 'Write the reason for admission'),
  })
  .strict();

admissionsRouter.post('/', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  assertCanEdit(req, patient);
  const body = parse(admitSchema, req.body);
  const same = await Admission.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) {
    if (!same.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ admission: admissionView(same) });
  }
  refuseNewOnDuplicate(patient, 'admission'); // a record marked as a duplicate takes no new admission
  refuseNewOnClosed(patient, 'admission'); // nor a record closed after a death (an open stay is finished with its discharge card)
  const now = req.now ?? new Date();
  const admittedAt = body.admittedAt ? new Date(body.admittedAt) : now;
  if (admittedAt.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ admittedAt: "The admission can't be in the future." });
  let admission;
  try {
    admission = await Admission.create({
      tenantId: req.tenantId,
      patientId: patient._id,
      careType: patient.careType,
      admittedAt,
      ward: body.ward,
      bed: body.bed,
      reason: body.reason,
      ipdNo: await nextIpdNo(req.tenantId, now), // docs/ADMISSION_DESK_PLAN.md
      admittedBy: req.user._id,
      admittedByName: req.user.name,
      clientRequestId: body.clientRequestId,
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    throw conflict('She is already admitted. Open her current stay.', 'ALREADY_ADMITTED');
  }
  await audit(req, 'ADMISSION_CREATED', { details: ids(patient, { admissionId: String(admission._id) }) });
  await billAdmitted(req, admission); // billing: the stay's bill with its bed charge
  res.status(201).json({ admission: admissionView(admission) });
});

admissionsRouter.get('/:admissionId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanView(req, patient);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  await audit(req, 'ADMISSION_VIEWED', { details: ids(patient, { admissionId: String(admission._id), access: a.level }) });
  res.json(await admissionPage(req, patient, admission, a));
});

// The ward and bed (while she is admitted)
admissionsRouter.patch('/:admissionId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanEdit(req, patient);
  const body = parse(z.object({ ward: safeText('Ward', 60).optional(), bed: safeText('Bed', 30).optional() }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  if (admission.status !== 'admitted') throw conflict('She has been discharged: this stay can no longer be changed.');
  if (body.ward !== undefined) admission.ward = body.ward;
  if (body.bed !== undefined) admission.bed = body.bed;
  await admission.save();
  await audit(req, 'ADMISSION_UPDATED', { details: ids(patient, { admissionId: String(admission._id) }) });
  res.json(await admissionPage(req, patient, admission, a));
});

// ---------- Documents ----------

admissionsRouter.post('/:admissionId/documents', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanEdit(req, patient);
  const body = parse(z.object({ clientRequestId: z.uuid('Please reload the page and try again'), kind: z.enum(DOC_KINDS, 'Choose the kind of document') }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const same = await ClinicalDocument.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) {
    if (!same.admissionId.equals(admission._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ document: documentView(same) });
  }
  if (admission.status !== 'admitted') throw conflict('She has been discharged: no new documents can be added to this stay.');
  if (body.kind === 'delivery' && patient.careType === 'newborn') throw invalid({ kind: 'A delivery note belongs on the mother’s record.' });
  assertDeliveryAllowed(patient, body.kind);
  if (ONE_PER_ADMISSION.includes(body.kind)) {
    const existing = await ClinicalDocument.findOne({ tenantId: req.tenantId, admissionId: admission._id, kind: body.kind, status: { $ne: 'cancelled' } });
    if (existing) throw conflict(`This stay already has ${body.kind === 'admission' ? 'an admission note' : 'a discharge card'} – open it instead.`, 'ALREADY_EXISTS');
  }
  // A new admission note starts from what was said at admission; a discharge card from the stay's notes.
  const content = parse(contentSchema(body.kind, { pcpndt: pcpndtFor(patient) }), await startingContent(req, admission, body.kind));
  const doc = await ClinicalDocument.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    admissionId: admission._id,
    kind: body.kind,
    content,
    createdBy: req.user._id,
    createdByName: req.user.name,
    clientRequestId: body.clientRequestId,
  });
  await audit(req, 'DOCUMENT_CREATED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind }) });
  res.status(201).json({ document: documentView(doc), access: pageAccess(req, a, admission) });
});

// What a new document starts with: the admission note – the reason given at admission; the discharge card – the
// diagnosis and course from the admission note, and the operations and delivery written during the stay.
async function startingContent(req, admission, kind) {
  if (kind === 'admission') return { reason: admission.reason };
  if (kind !== 'discharge') return {};
  const docs = await ClinicalDocument.find({ tenantId: req.tenantId, admissionId: admission._id, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }).lean();
  const adm = docs.find((d) => d.kind === 'admission')?.content ?? {};
  const ops = docs.filter((d) => d.kind === 'operation').map((d) => d.content?.procedure).filter(Boolean);
  const del = docs.find((d) => d.kind === 'delivery')?.content;
  const MODE = { normal: 'Normal vaginal delivery', vacuum: 'Vacuum-assisted delivery', forceps: 'Forceps delivery', lscs: 'Caesarean section (LSCS)', other: 'Delivery' };
  const procedures = [...(del?.mode ? [MODE[del.mode]] : []), ...ops].join('; ');
  return {
    finalDiagnosis: adm.provisionalDiagnosis ?? '',
    course: adm.reason ? `Admitted for: ${adm.reason}.` : '',
    procedures,
  };
}

admissionsRouter.get('/:admissionId/documents/:docId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanView(req, patient);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  await audit(req, 'DOCUMENT_VIEWED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind, access: a.level }) });
  res.json({ document: documentView(doc), admission: admissionView(admission), signer: await signerOf(doc), access: pageAccess(req, a, admission) });
});

// Saves a draft (only the version the person edited)
admissionsRouter.put('/:admissionId/documents/:docId', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanEdit(req, patient);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  assertDeliveryAllowed(patient, doc.kind);
  const body = parse(z.object({ rev, content: contentSchema(doc.kind, { pcpndt: pcpndtFor(patient) }) }).strict(), req.body);
  if (doc.status === 'signed') throw conflict(`This ${KIND_WORDS[doc.kind]} was signed by ${doc.signed.byName}, so it can no longer be changed. Add a correction below it instead.`, 'DOCUMENT_SIGNED');
  if (doc.status === 'cancelled') throw conflict('This document was marked as entered in error, so it can no longer be changed.');
  const r = await ClinicalDocument.updateOne(
    { _id: doc._id, tenantId: req.tenantId, status: 'draft', rev: body.rev },
    { $set: { content: body.content, savedBy: req.user._id, savedByName: req.user.name, savedAt: req.now ?? new Date() }, $inc: { rev: 1 } },
  );
  if (r.matchedCount === 0) {
    const latest = await findDocument(req, patient, admission, req.params.docId);
    if (latest.status !== 'draft') throw conflict('This document was signed or cancelled meanwhile. Reload to see it.');
    throw conflict(`${latest.savedByName ?? 'Someone'} saved this document after you opened it. Reload to see the latest, then make your change again.`);
  }
  await audit(req, 'DOCUMENT_UPDATED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind }) });
  const saved = await findDocument(req, patient, admission, req.params.docId);
  res.json({ document: documentView(saved), access: pageAccess(req, a, admission) });
});

// The doctor or RMO who signed: name and professional details, printed under the document.
async function signerOf(doc) {
  if (!doc.signed?.by) return null;
  const u = await User.findById(doc.signed.by, { name: 1, professional: 1 }).lean();
  const p = u?.professional ?? {};
  return u ? { name: u.name, professional: { qualification: p.qualification ?? '', registrationNumber: p.registrationNumber ?? '', council: p.council ?? '' } } : null;
}

const KIND_WORDS = { admission: 'admission note', round: 'round note', delivery: 'delivery note', operation: 'operation note', discharge: 'discharge card' };

// Sign (admission, round) or confirm (delivery, operation, discharge): the version the person saw.
admissionsRouter.post('/:admissionId/documents/:docId/sign', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanEdit(req, patient);
  const { rev: seen } = parse(z.object({ rev }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  assertDeliveryAllowed(patient, doc.kind);
  const role = signerRole(req, doc.kind);
  if (!role) throw forbidden(`A ${KIND_WORDS[doc.kind]} is confirmed by a doctor.`);
  if (doc.status !== 'draft') throw conflict(doc.status === 'signed' ? `Already signed by ${doc.signed.byName}.` : 'This document was marked as entered in error.');
  if (doc.rev !== seen) throw conflict(`${doc.savedByName ?? 'Someone'} saved this document after you opened it. Reload, check it, then sign again.`);
  const missing = missingToSign(doc.kind, doc.content);
  const timeOf = { delivery: 'deliveredAt', operation: 'performedAt', discharge: 'dischargedAt', round: 'at' }[doc.kind];
  const t = timeOf && doc.content?.[timeOf] ? new Date(doc.content[timeOf]) : null;
  if (t && t < admission.admittedAt) missing[`content.${timeOf}`] = 'This is before she was admitted – please check the date and time.';
  if (t && t.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) missing[`content.${timeOf}`] = "This can't be in the future.";
  if (Object.keys(missing).length) throw invalid(missing, 'Fill in the highlighted details (and save) before signing.');
  const at = req.now ?? new Date();
  const r = await ClinicalDocument.updateOne(
    { _id: doc._id, tenantId: req.tenantId, status: 'draft', rev: seen },
    { $set: { status: 'signed', signed: { by: req.user._id, byName: req.user.name, role, at, rev: seen } } },
  );
  if (r.matchedCount === 0) throw conflict('Someone changed this document at the same moment. Reload and sign again.');
  await audit(req, 'DOCUMENT_SIGNED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind }) });

  // What the signed document changes on the record
  if (doc.kind === 'discharge') {
    await Admission.updateOne(
      { _id: admission._id, tenantId: req.tenantId, status: 'admitted' },
      { $set: { status: 'discharged', dischargedAt: new Date(doc.content.dischargedAt), dischargedByName: req.user.name } },
    );
    await audit(req, 'PATIENT_DISCHARGED', { details: ids(patient, { admissionId: String(admission._id) }) });
  }
  // A ward round signed by a doctor: one doctor visit on the stay's bill (when the hospital charges it)
  if (doc.kind === 'round' && role === 'doctor') await billRound(req, admission, doc);
  if (doc.kind === 'delivery') {
    const deliveredAt = new Date(doc.content.deliveredAt);
    const later = patient.lastDelivery?.at && patient.lastDelivery.at > deliveredAt;
    if (!later) await Patient.updateOne({ _id: patient._id, tenantId: req.tenantId }, { $set: { lastDelivery: { at: deliveredAt, mode: doc.content.mode, documentId: doc._id } } });
  }
  const latest = await findAdmission(req, patient, req.params.admissionId);
  res.json({ document: documentView(await findDocument(req, patient, latest, req.params.docId)), admission: admissionView(latest), access: pageAccess(req, a, latest) });
});

// A correction or addition to a signed document (doctors, RMOs and nurses of the patient)
admissionsRouter.post('/:admissionId/documents/:docId/additions', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanView(req, patient);
  if (!a.edit && !a.nursing) throw forbidden("Only the patient's doctor, an RMO or a nurse can add a correction.");
  const words = pcpndtFor(patient) ? safeText('Correction or addition', 2000) : z.string().trim().max(2000);
  const { text } = parse(z.object({ text: words.refine((t) => t.trim().length >= 3, 'Please write the correction or addition.') }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  if (doc.status !== 'signed') throw conflict('Only a signed document gets corrections – change the draft itself instead.', 'NOT_SIGNED');
  await ClinicalDocument.updateOne(
    { _id: doc._id, tenantId: req.tenantId, status: 'signed' },
    { $push: { additions: { text: text.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } },
  );
  await audit(req, 'DOCUMENT_ADDITION_ADDED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind }) });
  res.json({ document: documentView(await findDocument(req, patient, admission, req.params.docId)), access: pageAccess(req, a, admission) });
});

// Entered in error (a draft or a signed document): kept, but no longer counted or changed
admissionsRouter.post('/:admissionId/documents/:docId/cancel', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanEdit(req, patient);
  const words = pcpndtFor(patient) ? safeText('Reason', 300) : z.string().trim().max(300);
  const { reason } = parse(z.object({ reason: words.refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  if (doc.status === 'cancelled') throw conflict('Already marked as entered in error.');
  if (doc.kind === 'discharge' && doc.status === 'signed') throw conflict('A confirmed discharge card stays – add a correction below it instead.');
  if (doc.status === 'signed' && !signerRole(req, doc.kind)) throw forbidden('A signed document is marked entered in error by a doctor.');
  await ClinicalDocument.updateOne({ _id: doc._id, tenantId: req.tenantId }, { $set: { status: 'cancelled', cancelled: { reason: reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } });
  await audit(req, 'DOCUMENT_CANCELLED', { details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind }) });
  res.json(await admissionPage(req, patient, admission, a));
});

// A document was printed. language: the discharge card – the one the patient takes home – may print with Marathi
// ('mr') or Hindi ('hi') next to the English; every other document is a staff document, in English only.
const printedSchema = z.object({ language: z.enum(['en', 'mr', 'hi'], 'Choose English, Marathi or Hindi').optional() }).strict();
admissionsRouter.post('/:admissionId/documents/:docId/printed', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanView(req, patient);
  const { language = 'en' } = parse(printedSchema, req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const doc = await findDocument(req, patient, admission, req.params.docId);
  if (doc.status === 'cancelled') throw conflict('This document was marked as entered in error.');
  if (language !== 'en' && doc.kind !== 'discharge') throw invalid({ language: 'Only the discharge card is printed in Marathi or Hindi.' }, 'Only the discharge card is printed in Marathi or Hindi.');
  await audit(req, 'DOCUMENT_PRINTED', {
    details: ids(patient, { admissionId: String(admission._id), documentId: String(doc._id), kind: doc.kind, ...(language !== 'en' ? { language } : {}), access: a.level }),
  });
  res.json({ printed: true });
});

// ---------- The nursing chart ----------

admissionsRouter.post('/:admissionId/nursing', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanChart(req, patient);
  const body = parse(nursingSchema({ pcpndt: pcpndtFor(patient) }), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const same = await NursingEntry.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) return res.status(200).json(await admissionPage(req, patient, admission, a));
  if (admission.status !== 'admitted') throw conflict('She has been discharged: the nursing chart is closed.');
  const now = req.now ?? new Date();
  const at = body.at ? new Date(body.at) : now;
  if (at.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ at: "The time can't be in the future." });
  if (at < admission.admittedAt) throw invalid({ at: 'The time is before she was admitted – please check it.' });
  const entry = await NursingEntry.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    admissionId: admission._id,
    kind: body.kind,
    at,
    ...(body.kind === 'vitals' ? { vitals: body.vitals } : {}),
    ...(body.kind === 'medicine' ? { medicine: body.medicine } : {}),
    ...(body.kind === 'escalation' ? { escalatedTo: body.escalatedTo } : {}),
    note: body.note,
    by: req.user._id,
    byName: req.user.name,
    clientRequestId: body.clientRequestId,
  });
  await audit(req, 'NURSING_ENTRY_ADDED', { details: ids(patient, { admissionId: String(admission._id), entryId: String(entry._id), kind: entry.kind }) });
  res.status(201).json(await admissionPage(req, patient, admission, a));
});

admissionsRouter.post('/:admissionId/nursing/:entryId/cancel', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  const a = assertCanChart(req, patient);
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(), req.body);
  const admission = await findAdmission(req, patient, req.params.admissionId);
  const entryId = parse(objectId, req.params.entryId);
  const r = await NursingEntry.updateOne(
    { _id: entryId, tenantId: req.tenantId, admissionId: admission._id, cancelled: null },
    { $set: { cancelled: { reason: reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } },
  );
  if (r.matchedCount === 0) throw conflict('This entry was not found, or is already marked as entered in error.');
  await audit(req, 'NURSING_ENTRY_CANCELLED', { details: ids(patient, { admissionId: String(admission._id), entryId: String(entryId) }) });
  res.json(await admissionPage(req, patient, admission, a));
});

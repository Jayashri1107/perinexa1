import { Router } from 'express';
import { z } from 'zod';
import { ANSWERS, DANGER_SIGNS_BABY, DANGER_SIGNS_MOTHER, DANGER_SIGN_KEYS, DISCHARGE_ITEMS, DISCHARGE_SOURCE, TEACH_BACK_BY, TEACHING_LANGUAGES, missingToComplete } from '../clinical/postnatalDischarge.js';
import { Admission } from '../models/Admission.js';
import { DischargeChecklist } from '../models/DischargeChecklist.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The postnatal discharge checklist and danger-sign teaching (Clinical Requirements Group B, item 14 – DRAFT,
// clinical/postnatalDischarge.js): /api/discharge-checklist.
//  - GET /?patientId=&admissionId=: the stay's checklist (or none yet), with what is still missing;
//  - PUT /: save it as a draft (only the version the person saw);
//  - POST /:id/complete: mark it complete once nothing is missing – then it is locked;
//  - POST /:id/cancel: filled in by mistake – entered in error with a reason; a new one can be started.
// Who: those who may see her medical details read it; nurses, her doctor and RMOs fill it in (as the nursing chart).
// For pregnancy and after delivery only (not a baby's record). The audit log gets ids – never the answers.

export const dischargeChecklistRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const CARE_TYPES = ['antenatal', 'postnatal', 'abortion'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });

dischargeChecklistRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The discharge checklist is for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const ids = (patient, admission, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), ...extra });

async function load(req, patientId, admissionId) {
  // Another department's patient is "not found" for a doctor (departments, 9 Nov 2026)
  const patient = assertNotHidden(req, await findPatientById(req.tenantId, patientId));
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  if (!CARE_TYPES.includes(patient.careType)) throw invalid({ patientId: 'The postnatal discharge checklist is for a mother after delivery.' });
  const admission = await Admission.findOne({ _id: admissionId, tenantId: req.tenantId, patientId: patient._id });
  if (!admission) throw new HttpError(404, 'This stay was not found.', 'NOT_FOUND');
  return { patient, admission };
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const view = (doc) => {
  const c = doc.toObject ? doc.toObject() : doc;
  return {
  id: String(c._id),
  items: Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, c.items?.[i.key] ?? ''])),
  itemNotes: c.itemNotes,
  dangerSigns: c.dangerSigns,
  teachBack: { done: c.teachBack?.done ?? false, by: c.teachBack?.by ?? '', language: c.teachBack?.language ?? '', note: c.teachBack?.note ?? '' },
  followUpOn: day(c.followUpOn),
  status: c.status,
  rev: c.rev,
  savedByName: c.savedByName,
  savedAt: c.savedAt,
  completed: c.completed ? { byName: c.completed.byName, at: c.completed.at } : null,
  cancelled: c.cancelled ? { reason: c.cancelled.reason, byName: c.cancelled.byName, at: c.cancelled.at } : null,
  missing: missingToComplete(c),
  };
};
const RULES = { items: DISCHARGE_ITEMS, dangerSignsMother: DANGER_SIGNS_MOTHER, dangerSignsBaby: DANGER_SIGNS_BABY, teachBackBy: TEACH_BACK_BY, languages: TEACHING_LANGUAGES, source: DISCHARGE_SOURCE };

dischargeChecklistRouter.get('/', async (req, res) => {
  const q = parse(z.object({ patientId: objectId, admissionId: objectId }).strict(), req.query);
  const { patient, admission } = await load(req, q.patientId, q.admissionId);
  const all = await DischargeChecklist.find({ tenantId: req.tenantId, admissionId: admission._id }).sort({ createdAt: -1 }).lean();
  const live = all.find((c) => c.live) ?? null;
  await audit(req, 'DISCHARGE_CHECKLIST_VIEWED', { details: ids(patient, admission) });
  res.json({ checklist: live ? view(live) : null, earlier: all.filter((c) => !c.live).map(view), access: { write: mayWrite(req, patient) }, rules: RULES });
});

const saveBody = z
  .object({
    patientId: objectId,
    admissionId: objectId,
    rev: z.number().int().min(-1), // -1: a new checklist
    items: z.object(Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, z.enum(['', ...ANSWERS]).default('')]))).strict().default({}),
    itemNotes: safeText('Notes', 1000).default(''),
    dangerSigns: z.array(z.enum(DANGER_SIGN_KEYS)).max(DANGER_SIGN_KEYS.length).default([]),
    teachBack: z
      .object({ done: z.boolean().default(false), by: z.enum(['', ...Object.keys(TEACH_BACK_BY)]).default(''), language: z.enum(['', ...Object.keys(TEACHING_LANGUAGES)]).default(''), note: safeText('Note', 500).default('') })
      .strict()
      .default({}),
    followUpOn: z.union([z.iso.date('Please enter a valid date').transform((d) => new Date(`${d}T00:00:00Z`)), z.null()]).default(null),
  })
  .strict();

dischargeChecklistRouter.put('/', async (req, res) => {
  const b = parse(saveBody, req.body);
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs fill in the discharge checklist.');
  const bad = DISCHARGE_ITEMS.find((i) => b.items[i.key] === 'na' && !i.na);
  if (bad) throw invalid({ [`items.${bad.key}`]: 'Answer yes or no' });
  const fields = { items: b.items, itemNotes: b.itemNotes, dangerSigns: [...new Set(b.dangerSigns)], teachBack: b.teachBack, followUpOn: b.followUpOn, savedByName: req.user.name, savedAt: req.now ?? new Date() };
  let saved;
  if (b.rev === -1) {
    if (admission.status !== 'admitted') throw conflict('She has been discharged: a new checklist cannot be started on this stay.');
    saved = await DischargeChecklist.create({ tenantId: req.tenantId, patientId: patient._id, admissionId: admission._id, source: DISCHARGE_SOURCE, ...fields }).catch((e) => {
      if (e?.code === 11000) throw conflict('Someone started this checklist at the same moment. Reload to see it.');
      throw e;
    });
    await audit(req, 'DISCHARGE_CHECKLIST_SAVED', { details: ids(patient, admission, { checklistId: String(saved._id), new: true }) });
  } else {
    const r = await DischargeChecklist.findOneAndUpdate(
      { tenantId: req.tenantId, admissionId: admission._id, live: true, status: 'draft', rev: b.rev },
      { $set: fields, $inc: { rev: 1 } },
      { returnDocument: 'after' },
    );
    if (!r) {
      const now = await DischargeChecklist.findOne({ tenantId: req.tenantId, admissionId: admission._id, live: true });
      if (now?.status === 'complete') throw conflict(`This checklist was completed by ${now.completed.byName} and is locked.`);
      throw conflict(`${now?.savedByName ?? 'Someone'} saved this checklist after you opened it. Reload to see the latest, then make your change again.`);
    }
    saved = r;
    await audit(req, 'DISCHARGE_CHECKLIST_SAVED', { details: ids(patient, admission, { checklistId: String(saved._id) }) });
  }
  res.json({ checklist: view(saved) });
});

async function loadOne(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const c = await DischargeChecklist.findOne({ _id: id, tenantId: req.tenantId });
  if (!c) throw new HttpError(404, 'This checklist was not found.', 'NOT_FOUND');
  const { patient, admission } = await load(req, c.patientId, c.admissionId);
  if (!mayWrite(req, patient)) throw forbidden('Only nurses, her doctor and RMOs fill in the discharge checklist.');
  return { c, patient, admission };
}

dischargeChecklistRouter.post('/:id/complete', async (req, res) => {
  const { c, patient, admission } = await loadOne(req);
  const { rev } = parse(z.object({ rev: z.number().int() }).strict(), req.body);
  if (!c.live || c.status !== 'draft') throw conflict('This checklist is already complete or was entered in error.');
  if (c.rev !== rev) throw conflict(`${c.savedByName ?? 'Someone'} saved this checklist after you opened it. Reload, check it, then complete it.`);
  const missing = missingToComplete(c);
  if (Object.keys(missing).length) throw invalid(missing, 'Fill in the highlighted parts (and save) before marking it complete.');
  c.status = 'complete';
  c.completed = { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await c.save();
  await audit(req, 'DISCHARGE_CHECKLIST_COMPLETED', { details: ids(patient, admission, { checklistId: String(c._id) }) });
  res.json({ checklist: view(c) });
});

dischargeChecklistRouter.post('/:id/cancel', async (req, res) => {
  const { c, patient, admission } = await loadOne(req);
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(), req.body);
  if (!c.live) throw conflict('Already marked as entered in error.');
  c.live = false;
  c.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await c.save();
  await audit(req, 'DISCHARGE_CHECKLIST_CANCELLED', { details: ids(patient, admission, { checklistId: String(c._id) }) });
  res.json({ checklist: view(c) });
});

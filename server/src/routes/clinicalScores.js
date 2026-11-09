import { Router } from 'express';
import { z } from 'zod';
import { EPDS_ITEMS, EPDS_SOURCE, VTE_FACTORS, VTE_PHASES, VTE_SOURCE, epdsResult, vteConflict, vteFactorsFor, vteResult } from '../clinical/scores.js';
import { ClinicalScore, SCORE_KINDS } from '../models/ClinicalScore.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// EPDS and the VTE risk score (Clinical Requirements Group A, item 5): /api/clinical-scores.
// Doctors, RMOs and nurses who may see her medical details read them; those who may write in her record (or record
// her vital signs) add one; one added by mistake is marked "entered in error" with a reason – never changed or
// deleted. Antenatal, postnatal and pregnancy-loss records only. The audit log gets ids and the kind – never a score.

export const clinicalScoresRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const CARE_TYPES = ['antenatal', 'postnatal', 'abortion'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });

clinicalScoresRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Scores are for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};

const view = (s) => ({
  id: String(s._id),
  kind: s.kind,
  on: s.on,
  phase: s.phase,
  ...(s.kind === 'epds' ? { epdsScores: s.epdsScores, selfHarm: s.selfHarm } : { vteFactors: s.vteFactors, antenatalLmwh: s.antenatalLmwh }),
  total: s.total,
  band: s.band,
  advice: s.advice,
  source: s.source,
  note: s.note,
  byName: s.byName,
  createdAt: s.createdAt,
  cancelled: s.cancelled ? { reason: s.cancelled.reason, byName: s.cancelled.byName, at: s.cancelled.at } : null,
});

async function patientFor(req, id) {
  const patient = await findPatientById(req.tenantId, id);
  assertNotHidden(req, patient); // another department's patient: "not found" for a doctor (departments, 9 Nov 2026)
  if (!mayView(req, patient)) throw forbidden("You can't see this patient's medical details.");
  return patient;
}

clinicalScoresRouter.get('/', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const patient = await patientFor(req, patientId);
  const scores = await ClinicalScore.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ on: -1, _id: -1 }).lean();
  await audit(req, 'CLINICAL_SCORES_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ scores: scores.map(view), access: { write: mayWrite(req, patient) && CARE_TYPES.includes(patient.careType) }, rules: { vteFactors: VTE_FACTORS, epdsItems: EPDS_ITEMS, epdsSource: EPDS_SOURCE, vteSource: VTE_SOURCE } });
});

const score03 = z.number().int().min(0, 'Each answer scores 0 to 3').max(3, 'Each answer scores 0 to 3');
const body = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    kind: z.enum(SCORE_KINDS),
    on: z.iso.date('Please enter a valid date').transform((d) => new Date(`${d}T00:00:00Z`)),
    phase: z.enum(VTE_PHASES, 'Choose antenatal or postnatal'),
    epdsScores: z.array(score03).length(EPDS_ITEMS, 'Enter the score of all ten answers').optional(),
    vteFactors: z.array(z.string().max(40)).max(VTE_FACTORS.length).optional(),
    antenatalLmwh: z.boolean().default(false),
    note: safeText('Note', 1000).default(''),
  })
  .strict();
clinicalScoresRouter.post('/', async (req, res) => {
  const b = parse(body, req.body);
  const patient = await patientFor(req, b.patientId);
  if (!mayWrite(req, patient)) throw forbidden('You can add scores only for patients whose record you may write in.');
  if (!CARE_TYPES.includes(patient.careType)) throw invalid({ kind: 'These scores are for pregnancy and after delivery.' });
  const same = await ClinicalScore.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.status(200).json({ score: view(same) });
  const now = req.now ?? new Date();
  if (b.on.getTime() > now.getTime() + 24 * 60 * 60 * 1000) throw invalid({ on: "This can't be in the future." });
  let result;
  if (b.kind === 'epds') {
    if (!b.epdsScores) throw invalid({ epdsScores: 'Enter the score of all ten answers' });
    result = { ...epdsResult(b.epdsScores), epdsScores: b.epdsScores, source: EPDS_SOURCE };
  } else {
    const keys = b.vteFactors ?? [];
    const allowed = new Set(vteFactorsFor(b.phase).map((f) => f.key));
    const wrong = keys.find((k) => !allowed.has(k));
    if (wrong) throw invalid({ vteFactors: `"${VTE_FACTORS.find((f) => f.key === wrong)?.label ?? wrong}" is not counted ${b.phase === 'antenatal' ? 'before' : 'after'} birth` });
    const conflict = vteConflict(keys);
    if (conflict) throw invalid({ vteFactors: conflict });
    result = { ...vteResult(b.phase, keys, { antenatalLmwh: b.antenatalLmwh }), vteFactors: [...new Set(keys)], antenatalLmwh: b.phase === 'postnatal' ? b.antenatalLmwh : false, source: VTE_SOURCE };
  }
  const s = await ClinicalScore.create({ tenantId: req.tenantId, patientId: patient._id, kind: b.kind, on: b.on, phase: b.phase, note: b.note, clientRequestId: b.clientRequestId, ...result, by: req.user._id, byName: req.user.name });
  await audit(req, 'CLINICAL_SCORE_ADDED', { details: { patientId: String(patient._id), mrn: patient.mrn, scoreId: String(s._id), kind: s.kind } });
  res.status(201).json({ score: view(s) });
});

clinicalScoresRouter.post('/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: safeText('Reason', 500).refine((v) => v.length > 0, 'Write why') }).strict(), req.body);
  const s = await ClinicalScore.findOne({ _id: id, tenantId: req.tenantId });
  if (!s) throw new HttpError(404, 'This score was not found.', 'NOT_FOUND');
  const patient = await patientFor(req, s.patientId);
  if (!mayWrite(req, patient)) throw forbidden('You may not change this record.');
  if (s.cancelled) throw new HttpError(409, 'Already marked as entered in error.', 'CONFLICT');
  s.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await s.save();
  await audit(req, 'CLINICAL_SCORE_CANCELLED', { details: { patientId: String(patient._id), mrn: patient.mrn, scoreId: String(s._id), kind: s.kind } });
  res.json({ score: view(s) });
});

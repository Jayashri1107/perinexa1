import { Router } from 'express';
import { z } from 'zod';
import { AVOIDABLE, CAUSES, CORRECTABLE, DELAY_ANSWERS, DELAYS, NEAR_MISS_CRITERIA, NEAR_MISS_KEYS, REVIEW_KINDS, REVIEW_SOURCE } from '../clinical/caseReview.js';
import { CaseReview } from '../models/CaseReview.js';
import { nextNumber } from '../models/Counter.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { departmentListed, departmentListFilter } from '../utils/patientAccess.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Maternal death and near-miss reviews (Clinical Requirements Group C – PX-OBG-30, DRAFT lists) with corrections and
// sealing (PX-X-05): /api/case-reviews.
//  - GET /: the reviews (newest first) and the deaths of mothers recorded in the last year that have no review yet;
//  - POST /: start a review (her patient number, the kind, when it happened);
//  - GET /:id, PATCH /:id: open and change a DRAFT review;
//  - POST /:id/seal: a doctor signs it – the review is sealed and never changed again;
//  - POST /:id/corrections: on a sealed review, a correction added on top (which part, what it should say, why).
// Who: doctors, RMOs and the quality lead – never the hospital admin (no patient data) or anyone else. Confidential:
// nothing here is shown on the patient's record. The audit log gets ids, the kind and the step – never the text.

export const caseReviewsRouter = Router();
const ROLES = ['doctor', 'rmo', 'quality'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const day = z.union([z.literal(''), z.iso.date('Please enter a valid date')]);
// What the department rule needs to judge a patient (departments, 9 Nov 2026)
const DEPT_FIELDS = { assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 };

caseReviewsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Death and near-miss reviews are for doctors, RMOs and the quality lead.');
  next();
});

const rules = { kinds: REVIEW_KINDS, criteria: NEAR_MISS_CRITERIA, causes: CAUSES, delays: DELAYS, delayAnswers: DELAY_ANSWERS, avoidable: AVOIDABLE, correctable: CORRECTABLE, source: REVIEW_SOURCE };
const ids = (r, extra = {}) => ({ reviewId: String(r._id), serial: r.serial, kind: r.kind, patientId: String(r.patientId), ...extra });

function view(r, patient, req) {
  return {
    id: String(r._id),
    serial: r.serial,
    kind: r.kind,
    patient: patient ? { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn } : null,
    eventAt: r.eventAt,
    summary: r.summary,
    criteria: r.criteria,
    cause: r.cause,
    causeDetail: r.causeDetail,
    delays: Object.fromEntries(Object.keys(DELAYS).map((k) => [k, { answer: r.delays?.[k]?.answer ?? '', note: r.delays?.[k]?.note ?? '' }])),
    avoidable: r.avoidable,
    factors: r.factors,
    lessons: r.lessons,
    actions: r.actions.map((a) => ({ text: a.text, owner: a.owner, dueOn: a.dueOn })),
    meetingOn: r.meetingOn,
    members: r.members,
    status: r.status,
    started: { byName: r.started.byName, at: r.started.at },
    lastSaved: r.lastSaved?.at ? { byName: r.lastSaved.byName, at: r.lastSaved.at } : null,
    sealed: r.sealed ? { byName: r.sealed.byName, at: r.sealed.at } : null,
    corrections: r.corrections.map((c) => ({ id: String(c._id), part: c.part, should: c.should, reason: c.reason, byName: c.byName, at: c.at })),
    access: { edit: r.status === 'draft', seal: r.status === 'draft' && hasRole(req.membership, 'doctor'), correct: r.status === 'sealed' },
  };
}

caseReviewsRouter.get('/', async (req, res) => {
  const found = await CaseReview.find({ tenantId: req.tenantId }).sort({ eventAt: -1 }).limit(300).lean();
  const yearAgo = new Date((req.now ?? new Date()).getTime() - 366 * 864e5);
  const reviewed = new Set(found.filter((r) => r.kind === 'maternal_death').map((r) => String(r.patientId)));
  // Patients the department rule hides from this doctor: neither their reviews nor their deaths are listed
  // (departments, 9 Nov 2026)
  const deaths = await Patient.find({ tenantId: req.tenantId, careType: { $ne: 'newborn' }, 'death.on': { $gte: yearAgo }, duplicateOf: null, ...departmentListFilter(req) }, { fullName: 1, mrn: 1, 'death.on': 1 }).lean();
  const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: found.map((r) => r.patientId) } }, { fullName: 1, mrn: 1, ...DEPT_FIELDS }).lean();
  const hidden = new Set(patients.filter((p) => !departmentListed(req, p)).map((p) => String(p._id)));
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const reviews = found.filter((r) => !hidden.has(String(r.patientId)));
  await audit(req, 'CASE_REVIEWS_VIEWED', { details: { count: reviews.length } });
  res.json({
    reviews: reviews.map((r) => {
      const v = view(r, byId.get(String(r.patientId)), req);
      return { id: v.id, serial: v.serial, kind: v.kind, patient: v.patient, eventAt: v.eventAt, status: v.status, sealed: v.sealed, corrections: v.corrections.length };
    }),
    awaiting: deaths.filter((d) => !reviewed.has(String(d._id))).map((d) => ({ id: String(d._id), fullName: d.fullName, mrn: d.mrn, diedOn: d.death.on })),
    rules,
  });
});

const startBody = z
  .object({
    mrn: z.string().trim().min(1, 'Enter her patient number').max(30),
    kind: z.enum(Object.keys(REVIEW_KINDS), 'Choose death or near miss'),
    eventAt: z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v)),
  })
  .strict();

caseReviewsRouter.post('/', async (req, res) => {
  const b = parse(startBody, req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, mrn: b.mrn.toUpperCase() });
  // (another department's patient is "no patient" for a doctor – departments, 9 Nov 2026)
  if (!patient || !departmentListed(req, patient)) throw invalid({ mrn: 'No patient with this number in this hospital.' });
  if (patient.careType === 'newborn') throw invalid({ mrn: 'This review is for the mother, not a baby.' });
  if (b.eventAt.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ eventAt: "The time can't be in the future." });
  if (b.kind === 'maternal_death' && (await CaseReview.exists({ tenantId: req.tenantId, patientId: patient._id, kind: 'maternal_death' }))) {
    throw conflict('Her death already has a review – open it from the list.');
  }
  const r = await CaseReview.create({ tenantId: req.tenantId, serial: await nextNumber(req.tenantId, 'case_review'), kind: b.kind, patientId: patient._id, eventAt: b.eventAt, started: stamp(req) });
  await audit(req, 'CASE_REVIEW_STARTED', { target: patient, details: ids(r) });
  res.status(201).json({ review: view(r, patient, req) });
});

async function load(req, id) {
  const r = await CaseReview.findOne({ _id: id, tenantId: req.tenantId });
  if (!r) throw new HttpError(404, 'This review was not found.', 'NOT_FOUND');
  const patient = await Patient.findOne({ _id: r.patientId, tenantId: req.tenantId }, { fullName: 1, mrn: 1, ...DEPT_FIELDS });
  // A review of a patient the department rule hides from this doctor is "not found" (departments, 9 Nov 2026)
  if (patient && !departmentListed(req, patient)) throw new HttpError(404, 'This review was not found.', 'NOT_FOUND');
  return { r, patient };
}
const idParam = (req) => parse(z.object({ id: objectId }).strict(), req.params).id;

caseReviewsRouter.get('/:id', async (req, res) => {
  const { r, patient } = await load(req, idParam(req));
  await audit(req, 'CASE_REVIEW_VIEWED', { target: patient, details: ids(r) });
  res.json({ review: view(r, patient, req), rules });
});

const delayBody = z.object({ answer: z.enum([...Object.keys(DELAY_ANSWERS), '']).default(''), note: safeText('Note', 500).default('') }).strict();
const patchBody = z
  .object({
    eventAt: z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v)).optional(),
    summary: safeText('Summary', 3000).optional(),
    criteria: z.array(z.enum(NEAR_MISS_KEYS)).max(NEAR_MISS_KEYS.length).optional(),
    cause: z.enum([...Object.keys(CAUSES), '']).optional(),
    causeDetail: safeText('Cause in words', 500).optional(),
    delays: z.object({ delay1: delayBody.optional(), delay2: delayBody.optional(), delay3: delayBody.optional() }).strict().optional(),
    avoidable: z.enum([...Object.keys(AVOIDABLE), '']).optional(),
    factors: safeText('Avoidable factors', 2000).optional(),
    lessons: safeText('Lessons', 2000).optional(),
    actions: z.array(z.object({ text: safeText('Action', 300), owner: safeText('Who', 150).default(''), dueOn: day.default('') }).strict()).max(30).optional(),
    meetingOn: day.optional(),
    members: safeText('Present', 500).optional(),
  })
  .strict();

caseReviewsRouter.patch('/:id', async (req, res) => {
  const { r, patient } = await load(req, idParam(req));
  const b = parse(patchBody, req.body);
  if (r.status === 'sealed') throw conflict('This review is sealed: add a correction instead.');
  for (const [k, v] of Object.entries(b)) {
    if (k === 'delays') for (const [d, val] of Object.entries(v)) r.delays[d] = val;
    else if (k === 'actions') r.actions = v.filter((a) => a.text.trim());
    else r[k] = v;
  }
  r.lastSaved = stamp(req);
  await r.save();
  await audit(req, 'CASE_REVIEW_SAVED', { target: patient, details: ids(r) });
  res.json({ review: view(r, patient, req) });
});

/** What a review needs before it is sealed: the fields still empty (by name). */
export function missingForSeal(r) {
  const m = {};
  if (!r.summary?.trim()) m.summary = 'Write a summary of the case';
  if (r.kind === 'near_miss' && !r.criteria?.length) m.criteria = 'Tick at least one near-miss criterion';
  if (!r.cause) m.cause = 'Choose the underlying cause';
  for (const k of Object.keys(DELAYS)) if (!r.delays?.[k]?.answer) m[`delays.${k}`] = 'Answer each delay';
  if (!r.avoidable) m.avoidable = 'Choose whether it was avoidable';
  if (!r.meetingOn) m.meetingOn = 'Enter the day of the review meeting';
  return m;
}

caseReviewsRouter.post('/:id/seal', async (req, res) => {
  const { r, patient } = await load(req, idParam(req));
  if (!hasRole(req.membership, 'doctor')) throw forbidden('A doctor signs and seals the review.');
  if (r.status === 'sealed') throw conflict('This review is already sealed.');
  const missing = missingForSeal(r);
  if (Object.keys(missing).length) throw Object.assign(new HttpError(400, 'Fill in these parts before sealing.', 'VALIDATION'), { fields: missing });
  r.status = 'sealed';
  r.sealed = stamp(req);
  await r.save();
  await audit(req, 'CASE_REVIEW_SEALED', { target: patient, details: ids(r) });
  res.json({ review: view(r, patient, req) });
});

const correctionBody = z
  .object({
    part: z.enum(Object.keys(CORRECTABLE), 'Choose which part is wrong'),
    should: safeText('What it should say', 1000).refine((v) => v.trim().length >= 2, 'Write what it should say'),
    reason: safeText('Reason', 300).refine((v) => v.trim().length >= 3, 'Write why it is corrected'),
  })
  .strict();

caseReviewsRouter.post('/:id/corrections', async (req, res) => {
  const { r, patient } = await load(req, idParam(req));
  const b = parse(correctionBody, req.body);
  if (r.status !== 'sealed') throw conflict('A draft is changed directly – corrections are for a sealed review.');
  r.corrections.push({ part: b.part, should: b.should.trim(), reason: b.reason.trim(), ...stamp(req) });
  await r.save();
  await audit(req, 'CASE_REVIEW_CORRECTED', { target: patient, details: ids(r, { part: b.part }) });
  res.status(201).json({ review: view(r, patient, req) });
});

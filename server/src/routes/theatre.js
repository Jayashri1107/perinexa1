import { Router } from 'express';
import { z } from 'zod';
import { ANAESTHESIA, CASE_STATUS, PHASES, PHASE_ORDER, URGENCY, WHO_SOURCE, missingInPhase } from '../clinical/whoChecklist.js';
import { Admission } from '../models/Admission.js';
import { latestPac } from './anaesthesia.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { TheatreCase } from '../models/TheatreCase.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The theatre list and the WHO Surgical Safety Checklist (Clinical Requirements Group B, item 16): /api/theatre.
//  - GET /?date=YYYY-MM-DD: the day's list, by theatre and order, with each case's checklist progress;
//  - POST /: put an operation on the list (by her patient number);
//  - GET /:id: one case with its checklist;
//  - PUT /:id/checklist/:phase: save a phase's answers so far; POST /:id/checklist/:phase/confirm: confirm it (in order:
//    sign in, time out, sign out) – then it is locked; sign in puts the case in theatre, sign out makes it done;
//  - POST /:id/cancel: taken off the list, with a reason (never deleted).
// Doctors, RMOs and nurses who may see her medical details; a sensitive record's case only for those who see it in
// full. The audit log gets ids, the phase and the status – never the answers.

export const theatreRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const notFound = () => new HttpError(404, 'This operation was not found.', 'NOT_FOUND');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const dayQuery = z.iso.date('Choose a date').transform((d) => new Date(`${d}T00:00:00Z`));

theatreRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The theatre list is for doctors, RMOs and nurses.');
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const roleWord = (req) => (hasRole(req.membership, 'doctor') ? 'Doctor' : hasRole(req.membership, 'rmo') ? 'RMO' : 'Nurse');
const ids = (c, patient, extra = {}) => ({ caseId: String(c._id), patientId: String(patient._id), mrn: patient.mrn, ...extra });

function progress(c) {
  return Object.fromEntries(PHASE_ORDER.map((p) => [p, c.checklist?.[p]?.confirmed ? { byName: c.checklist[p].confirmed.byName, role: c.checklist[p].confirmed.role, at: c.checklist[p].confirmed.at } : null]));
}
function view(c, patient, full = false) {
  return {
    id: String(c._id),
    patient: patient ? { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn } : null,
    listDate: c.listDate.toISOString().slice(0, 10),
    theatre: c.theatre,
    order: c.order,
    procedure: c.procedure,
    site: c.site,
    urgency: c.urgency,
    surgeon: c.surgeon,
    assistant: c.assistant,
    anaesthetist: c.anaesthetist,
    anaesthesia: c.anaesthesia,
    status: c.status,
    progress: progress(c),
    ...(full ? { checklist: Object.fromEntries(PHASE_ORDER.map((p) => [p, { answers: c.checklist?.[p]?.answers ?? {}, notes: c.checklist?.[p]?.notes ?? {} }])) } : {}),
    createdByName: c.createdByName,
    cancelled: c.cancelled ? { reason: c.cancelled.reason, byName: c.cancelled.byName, at: c.cancelled.at } : null,
  };
}

theatreRouter.get('/', async (req, res) => {
  const { date } = parse(z.object({ date: dayQuery }).strict(), req.query);
  const cases = await TheatreCase.find({ tenantId: req.tenantId, listDate: date }).sort({ theatre: 1, order: 1, createdAt: 1 }).limit(300);
  const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: cases.map((c) => c.patientId) } });
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const shown = cases.filter((c) => byId.has(String(c.patientId)) && mayView(req, byId.get(String(c.patientId))));
  await audit(req, 'THEATRE_LIST_VIEWED', { details: { date: date.toISOString().slice(0, 10), count: shown.length } });
  res.json({ cases: shown.map((c) => view(c, byId.get(String(c.patientId)))), rules: { urgency: URGENCY, anaesthesia: ANAESTHESIA, status: CASE_STATUS } });
});

const createBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientNo: z.string().trim().min(1, 'Enter her patient number').max(30),
    listDate: dayQuery,
    theatre: safeText('Theatre', 40).default('Theatre 1'),
    order: z.coerce.number().int().min(1).max(50).default(1),
    procedure: safeText('Operation', 300).refine((v) => v.length > 0, 'Write the operation'),
    site: safeText('Site', 100).default(''),
    urgency: z.enum(Object.keys(URGENCY)).default('elective'),
    surgeon: safeText('Surgeon', 150).default(''),
    assistant: safeText('Assistant', 150).default(''),
    anaesthetist: safeText('Anaesthetist', 150).default(''),
    anaesthesia: z.enum(['', ...Object.keys(ANAESTHESIA)]).default(''),
  })
  .strict();
theatreRouter.post('/', async (req, res) => {
  const b = parse(createBody, req.body);
  const same = await TheatreCase.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  const found = await Patient.findOne({ tenantId: req.tenantId, mrn: b.patientNo.toUpperCase() }, { _id: 1 }).lean();
  if (!found) throw invalid({ patientNo: 'No patient with this number in this hospital.' });
  const patient = await findPatientById(req.tenantId, found._id);
  if (!mayView(req, patient) || !mayWrite(req, patient)) throw forbidden("You can't put this patient on the theatre list.");
  if (same) return res.json({ case: view(same, patient, true) });
  const now = req.now ?? new Date();
  if (b.listDate < new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)) throw invalid({ listDate: 'This day has passed.' });
  const { patientNo: _n, ...fields } = b;
  const stay = await Admission.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'admitted' }, { _id: 1 }).lean();
  const c = await TheatreCase.create({ ...fields, tenantId: req.tenantId, patientId: patient._id, admissionId: stay?._id ?? null, createdByName: req.user.name });
  await audit(req, 'THEATRE_CASE_ADDED', { details: ids(c, patient) });
  res.status(201).json({ case: view(c, patient, true) });
});

async function loadOne(req) {
  const { id } = parse(z.object({ id: objectId }).passthrough(), req.params);
  const c = await TheatreCase.findOne({ _id: id, tenantId: req.tenantId });
  if (!c) throw notFound();
  const patient = await findPatientById(req.tenantId, c.patientId);
  if (!mayView(req, patient)) throw notFound();
  return { c, patient };
}

theatreRouter.get('/:id', async (req, res) => {
  const { c, patient } = await loadOne(req);
  await audit(req, 'THEATRE_CASE_VIEWED', { details: ids(c, patient) });
  res.json({ case: view(c, patient, true), pac: await latestPac(req.tenantId, patient._id), access: { write: mayWrite(req, patient) && !c.cancelled }, rules: { phases: PHASES, order: PHASE_ORDER, source: WHO_SOURCE, urgency: URGENCY, anaesthesia: ANAESTHESIA, status: CASE_STATUS } });
});

const answersFor = (phase) =>
  z
    .object({
      answers: z.object(Object.fromEntries(PHASES[phase].items.map((i) => [i.key, z.enum(['', 'yes', 'no', 'na']).default('')]))).strict().default({}),
      notes: z.object(Object.fromEntries(PHASES[phase].items.map((i) => [i.key, safeText('Note', 300).default('')]))).strict().default({}),
    })
    .strict();
const phaseParam = (req) => {
  const { phase } = parse(z.object({ id: objectId, phase: z.enum(PHASE_ORDER) }), req.params);
  return phase;
};
async function prepare(req) {
  const phase = phaseParam(req);
  const { c, patient } = await loadOne(req);
  if (!mayWrite(req, patient)) throw forbidden('Only the theatre team (doctors, RMOs, nurses) fills in the checklist.');
  if (c.cancelled) throw conflict('This operation was taken off the list.');
  if (c.checklist[phase]?.confirmed) throw conflict(`${PHASES[phase].label.split(' – ')[0]} was confirmed by ${c.checklist[phase].confirmed.byName} and is locked.`);
  const body = parse(answersFor(phase), req.body);
  return { phase, c, patient, body };
}

theatreRouter.put('/:id/checklist/:phase', async (req, res) => {
  const { phase, c, patient, body } = await prepare(req);
  c.checklist[phase].answers = body.answers;
  c.checklist[phase].notes = body.notes;
  c.markModified(`checklist.${phase}`);
  await c.save();
  await audit(req, 'THEATRE_CHECKLIST_SAVED', { details: ids(c, patient, { phase }) });
  res.json({ case: view(c, patient, true) });
});

theatreRouter.post('/:id/checklist/:phase/confirm', async (req, res) => {
  const { phase, c, patient, body } = await prepare(req);
  const before = PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(phase)).find((p) => !c.checklist[p]?.confirmed);
  if (before) throw conflict(`Confirm ${PHASES[before].label.split(' – ')[0].toLowerCase()} first.`);
  const missing = missingInPhase(phase, body.answers, body.notes);
  if (Object.keys(missing).length) throw invalid(missing, 'Answer the highlighted items before confirming.');
  c.checklist[phase] = { answers: body.answers, notes: body.notes, confirmed: { by: req.user._id, byName: req.user.name, role: roleWord(req), at: req.now ?? new Date() } };
  c.markModified(`checklist.${phase}`);
  if (phase === 'signIn') c.status = 'in_theatre';
  if (phase === 'signOut') c.status = 'done';
  await c.save();
  await audit(req, 'THEATRE_CHECKLIST_CONFIRMED', { details: ids(c, patient, { phase, status: c.status }) });
  res.json({ case: view(c, patient, true) });
});

theatreRouter.post('/:id/cancel', async (req, res) => {
  const { c, patient } = await loadOne(req);
  if (!mayWrite(req, patient)) throw forbidden('Only the theatre team takes an operation off the list.');
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 5, 'Please say why (at least 5 characters).') }).strict(), req.body);
  if (c.cancelled) throw conflict('Already taken off the list.');
  if (c.status === 'done') throw conflict('This operation is done; it cannot be taken off the list.');
  c.cancelled = { reason, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  c.status = 'cancelled';
  await c.save();
  await audit(req, 'THEATRE_CASE_CANCELLED', { details: ids(c, patient) });
  res.json({ case: view(c, patient, true) });
});

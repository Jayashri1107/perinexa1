import { Router } from 'express';
import { notify } from '../notifications/notify.js';
import { z } from 'zod';
import { totals } from '../billing/money.js';
import { addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { checklistDoc, checklistFromRecord, checklistMissing, checklistSchema, nextPassNo, papersFor } from '../inpatient/admissionDesk.js';
import { BOARD_ROLES, REASON_CODES, REASONS, SETUP_ROLES, mayMoveBed } from '../inpatient/beds.js';
import { Admission } from '../models/Admission.js';
import { AdmissionRequest } from '../models/AdmissionRequest.js';
import { Bill } from '../models/Bill.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { isClosed } from '../patients/deathRules.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// Admission like a hospital system (/api/admission-desk – owner, 17 Oct 2026, docs/ADMISSION_DESK_PLAN.md):
//  - /requests            a doctor's or RMO's request to admit her (from her record); reception admits from it
//  - /stays/:id/checklist  the admission checklist at the desk (ID proof type + last 4, attendant, payer, consent)
//  - /stays/:id/papers     what the admission form, the wristband and the gate pass print (+ /printed to record it)
//  - /to-clear, /stays/:id/clear  after the doctor's discharge: the bill settled (or why not) and the gate pass
//  - /rules               the hospital admin's rule: reception admits only after a doctor's request
// Who may: the bed board's people (reception, doctors, RMOs, nurses); clearance: reception, billing, the admin. The
// audit log gets ids only – never the ID proof, the attendant or a phone number.

export const admissionDeskRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const notFound = (message) => new HttpError(404, message, 'NOT_FOUND');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const CLEAR_ROLES = ['receptionist', 'billing', 'admin'];
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });

admissionDeskRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...BOARD_ROLES, ...CLEAR_ROLES, ...SETUP_ROLES)) throw forbidden('Admission is for reception, billing, doctors, RMOs, nurses and the hospital admin.');
  next();
});

const doctorNameOf = async (p) => (p.assignedDoctor ? ((await User.findById(p.assignedDoctor, { name: 1 }).lean())?.name ?? '') : '');

async function findStay(req) {
  const stay = await Admission.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!stay) throw notFound('This stay was not found.');
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, String(stay.patientId));
  return { stay, patient };
}

// ---------- The hospital's rule ----------

export async function deskRules(tenantId) {
  const t = await Tenant.findById(tenantId, { desk: 1 }).lean();
  return { requireAdmissionRequest: Boolean(t?.desk?.requireAdmissionRequest), requireChecklist: Boolean(t?.desk?.requireChecklist) };
}

admissionDeskRouter.get('/rules', async (req, res) => {
  res.json({ ...(await deskRules(req.tenantId)), canChange: hasRole(req.membership, ...SETUP_ROLES) });
});

admissionDeskRouter.put('/rules', async (req, res) => {
  if (!hasRole(req.membership, ...SETUP_ROLES)) throw forbidden('Only the hospital admin changes this rule.');
  const body = parse(z.object({ requireAdmissionRequest: z.boolean(), requireChecklist: z.boolean().default(false) }).strict(), req.body);
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'desk.requireAdmissionRequest': body.requireAdmissionRequest, 'desk.requireChecklist': body.requireChecklist } });
  await audit(req, 'ADMISSION_RULES_CHANGED', { details: body });
  res.json({ ...(await deskRules(req.tenantId)), canChange: true });
});

// ---------- A doctor's request ----------

const requestView = (r, p, extra = {}) => ({
  id: String(r._id),
  patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn } : null,
  reasonCode: r.reasonCode,
  reason: [REASONS[r.reasonCode], r.reasonNote].filter(Boolean).join(' – '),
  admissionType: r.admissionType,
  ward: r.ward ?? '',
  expectedOn: r.expectedOn ? isoDay(r.expectedOn) : null,
  note: r.note ?? '',
  status: r.status,
  requested: { byName: r.requested.byName, at: r.requested.at },
  cancelled: r.cancelled ? { byName: r.cancelled.byName, at: r.cancelled.at, reason: r.cancelled.reason } : null,
  ...extra,
});

// Open requests (the bed board): ?patientId= one patient's (her record, the admit dialog)
admissionDeskRouter.get('/requests', async (req, res) => {
  if (!hasRole(req.membership, ...BOARD_ROLES)) throw forbidden('Admission requests are for reception, doctors, RMOs and nurses.');
  const { patientId } = parse(z.object({ patientId: objectId.optional() }).strict(), req.query);
  const list = await AdmissionRequest.find({ tenantId: req.tenantId, status: 'open', ...(patientId ? { patientId } : {}) }).sort({ expectedOn: 1, createdAt: 1 }).limit(200).lean();
  const patients = new Map((list.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.patientId) } }) : []).map((p) => [String(p._id), p]));
  // The reason only as the bed board would show it (inpatient/beds.js reasonFor: reception sees the listed reason,
  // never on a sensitive record or the Abortion type of care)
  const shown = list
    .map((r) => {
      const p = patients.get(String(r.patientId));
      if (!p || isClosed(p) || isDuplicate(p)) return null;
      const a = patientAccess(req, p);
      const reasonOk = a.view.has('pregnancy') || (hasRole(req.membership, 'receptionist') && !p.sensitive && p.careType !== 'abortion');
      const v = requestView(r, p, { canCancel: a.editClinical });
      return reasonOk ? v : { ...v, reason: null, reasonCode: null };
    })
    .filter(Boolean);
  res.json({ requests: shown, canRequest: hasRole(req.membership, 'doctor', 'rmo') });
});

const requestSchema = z
  .object({
    patientId: objectId,
    reasonCode: z.enum(REASON_CODES, 'Choose the reason for admission'),
    reasonNote: safeText('Note', 120).default(''),
    admissionType: z.enum(['planned', 'emergency', 'day_care']).default('planned'),
    ward: safeText('Ward', 60).default(''),
    expectedOn: requiredDateOnly('Expected on').nullable().default(null),
    note: safeText('Note for the desk', 300).default(''),
  })
  .strict();

admissionDeskRouter.post('/requests', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden('A doctor or an RMO asks for an admission.');
  const body = parse(requestSchema, req.body);
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, body.patientId);
  if (!patientAccess(req, patient).editClinical) throw forbidden("This is another doctor's patient: ask her doctor or an RMO.");
  if (isClosed(patient) || isDuplicate(patient)) throw conflict('This record takes no admission.', 'NOT_ALLOWED');
  if (body.reasonCode === 'other' && body.reasonNote.trim().length < 3) throw invalid({ reasonNote: 'Write a short note for "Other".' });
  if (body.expectedOn && body.expectedOn < hospitalToday(req.now)) throw invalid({ expectedOn: 'Choose today or a later day.' });
  if (await Admission.exists({ tenantId: req.tenantId, patientId: patient._id, status: 'admitted' })) throw conflict('She is already admitted.', 'ALREADY_ADMITTED');
  let r;
  try {
    r = await AdmissionRequest.create({ tenantId: req.tenantId, patientId: patient._id, ...body, reasonNote: body.reasonNote.trim(), note: body.note.trim(), requested: stampOf(req) });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    throw conflict('She already has an open admission request. Cancel it first to make a new one.', 'ALREADY_REQUESTED');
  }
  await audit(req, 'ADMISSION_REQUESTED', { details: { patientId: String(patient._id), mrn: patient.mrn, requestId: String(r._id) } });
  await notify(req, { roles: ['receptionist'] }, { kind: 'admission', text: `Admission requested by ${req.user.name}: ${patient.fullName}.`, link: '/beds' });
  res.status(201).json({ request: requestView(r, patient) });
});

admissionDeskRouter.post('/requests/:id/cancel', async (req, res) => {
  const body = parse(z.object({ reason: safeText('Reason', 300) }).strict(), req.body);
  const r = await AdmissionRequest.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!r) throw notFound('This request was not found.');
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, String(r.patientId));
  if (!patientAccess(req, patient).editClinical) throw forbidden('Her doctor or an RMO cancels the request.');
  if (r.status !== 'open') throw conflict('This request is no longer open.');
  if (body.reason.trim().length < 3) throw invalid({ reason: 'Write why it is cancelled.' });
  r.status = 'cancelled';
  r.cancelled = { ...stampOf(req), reason: body.reason.trim() };
  await r.save();
  await audit(req, 'ADMISSION_REQUEST_CANCELLED', { details: { patientId: String(patient._id), mrn: patient.mrn, requestId: String(r._id) } });
  res.json({ request: requestView(r, patient) });
});

// ---------- The checklist and the papers ----------

admissionDeskRouter.get('/stays/:id/papers', async (req, res) => {
  if (!hasRole(req.membership, ...BOARD_ROLES, ...CLEAR_ROLES)) throw forbidden('The admission papers are for reception, billing, doctors, RMOs and nurses.');
  const { stay, patient } = await findStay(req);
  const papers = papersFor(req, patient, stay, await doctorNameOf(patient));
  res.json({ papers: { ...papers, checklistDraft: stay.checklist ? null : checklistFromRecord(patient) }, canEditChecklist: stay.status === 'admitted' && mayMoveBed(req, patient) });
});

const PAPERS = { form: 'ADMISSION_FORM_PRINTED', wristband: 'WRISTBAND_PRINTED', gatepass: 'GATE_PASS_PRINTED' };
admissionDeskRouter.post('/stays/:id/printed', async (req, res) => {
  if (!hasRole(req.membership, ...BOARD_ROLES, ...CLEAR_ROLES)) throw forbidden('The admission papers are for reception, billing, doctors, RMOs and nurses.');
  const { what } = parse(z.object({ what: z.enum(Object.keys(PAPERS)) }).strict(), req.body);
  const { stay, patient } = await findStay(req);
  if (what === 'gatepass' && !stay.clearance) throw conflict('The gate pass is printed once she is cleared for leaving.');
  await audit(req, PAPERS[what], { details: { patientId: String(patient._id), mrn: patient.mrn, admissionId: String(stay._id) } });
  res.json({ ok: true });
});

admissionDeskRouter.put('/stays/:id/checklist', async (req, res) => {
  const { stay, patient } = await findStay(req);
  if (!mayMoveBed(req, patient)) throw forbidden('Reception, nurses, her doctor or an RMO fill in the checklist.');
  if (stay.status !== 'admitted') throw conflict('She has been discharged: the checklist can no longer be changed.');
  const body = parse(z.object({ checklist: checklistSchema, mlcPolice: safeText('Police station', 120).optional() }).strict(), req.body);
  stay.checklist = checklistDoc(req, body.checklist);
  if (body.mlcPolice !== undefined) stay.mlcPolice = body.mlcPolice.trim();
  await stay.save();
  await audit(req, 'ADMISSION_CHECKLIST_UPDATED', { details: { patientId: String(patient._id), mrn: patient.mrn, admissionId: String(stay._id), complete: stay.checklist.complete } });
  res.json({ checklist: papersFor(req, patient, stay, '').checklist, missing: checklistMissing(stay.checklist) });
});

// ---------- Clearance for leaving and the gate pass ----------

/** The stay's bill and what is still owed (paise; 0 when settled, negative when money is due back). */
async function stayBalance(tenantId, stayId) {
  const bills = await Bill.find({ tenantId, admissionId: stayId, status: { $ne: 'cancelled' } }).lean();
  return bills.reduce((s, b) => s + totals(b).balance, 0);
}

// Discharged in the last 7 days and not cleared yet: who is waiting to leave, with what she still owes.
admissionDeskRouter.get('/to-clear', async (req, res) => {
  if (!hasRole(req.membership, ...BOARD_ROLES, ...CLEAR_ROLES)) throw forbidden('This list is for reception, billing, doctors, RMOs and nurses.');
  const since = hospitalDayStart(addDays(hospitalToday(req.now), -7));
  const stays = await Admission.find({ tenantId: req.tenantId, status: 'discharged', clearance: null, dischargedAt: { $gte: since } }).sort({ dischargedAt: 1 }).limit(200).lean();
  const patients = new Map((stays.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: stays.map((s) => s.patientId) } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const list = [];
  for (const s of stays) {
    const p = patients.get(String(s.patientId));
    if (!p) continue;
    list.push({ id: String(s._id), ipdNo: s.ipdNo ?? null, ward: s.ward, bed: s.bed, dischargedAt: s.dischargedAt, balancePaise: await stayBalance(req.tenantId, s._id), patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn } });
  }
  res.json({ stays: list, canClear: hasRole(req.membership, ...CLEAR_ROLES) });
});

admissionDeskRouter.post('/stays/:id/clear', async (req, res) => {
  if (!hasRole(req.membership, ...CLEAR_ROLES)) throw forbidden('Reception, billing or the hospital admin clear a patient for leaving.');
  const body = parse(z.object({ note: safeText('Note', 300).default('') }).strict(), req.body);
  const { stay, patient } = await findStay(req);
  if (stay.status !== 'discharged') throw conflict('The doctor confirms the discharge card first.', 'NOT_DISCHARGED');
  if (stay.clearance) throw conflict(`Already cleared – gate pass ${stay.clearance.passNo}.`);
  const balance = await stayBalance(req.tenantId, stay._id);
  if (balance > 0 && body.note.trim().length < 5) throw invalid({ note: `₹${(balance / 100).toLocaleString('en-IN')} is still due on her bill: write why she may leave (e.g. insurance claim pending).` }, 'The bill is not settled.');
  stay.clearance = { ...stampOf(req), balancePaise: balance, note: body.note.trim(), passNo: await nextPassNo(req.tenantId, req.now) };
  await stay.save();
  await audit(req, 'DISCHARGE_CLEARED', { details: { patientId: String(patient._id), mrn: patient.mrn, admissionId: String(stay._id), balancePaise: balance } });
  res.json({ papers: papersFor(req, patient, stay, await doctorNameOf(patient)) });
});


import { Router } from 'express';
import { z } from 'zod';
import { billAdmitted } from '../billing/hooks.js';
import { BOARD_ROLES, REASON_CODES, SETUP_ROLES, mayAdmit, mayMoveBed, reasonFor, reasonText } from '../inpatient/beds.js';
import { admissionView } from '../inpatient/inpatientView.js';
import { hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { Bed } from '../models/Bed.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { loadPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';
import { checklistDoc, checklistMissing, checklistSchema, nextIpdNo } from '../inpatient/admissionDesk.js';
import { AdmissionRequest } from '../models/AdmissionRequest.js';
import { deskRules } from './admissionDesk.js';

// Beds and admission at the desk (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): /api/beds.
//  - GET  /?summary=1  only the counts; /?free=1 only the free beds (no names, not audited);
//  - GET  /            the bed board: each ward's beds, free or occupied (name, patient number, doctor, since, and
//                      the reason as inpatient/beds.js reasonFor allows) – reception, doctors, RMOs, nurses; audited
//                      with counts only;
//  - POST /:bedId/admit  admit a patient to a free bed – reception, or a doctor/RMO who may write her record; the
//                      stay is the same Admission as from her record (the RMO then writes the admission notes), and
//                      its bill opens with the bed charge;
//  - POST /stays/:admissionId/move  move her to another free bed – reception, nurses, her doctor, RMOs;
//  - GET/POST/PATCH /setup  the wards and beds – the hospital admin (who sees only free / occupied, never names).
// A stay ends as before, when a doctor confirms the discharge card; the bed is then free again.

export const bedsRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const notFound = (message) => new HttpError(404, message, 'NOT_FOUND');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const assertRole = (req, roles, message) => {
  if (!hasRole(req.membership, ...roles)) throw forbidden(message);
};

const bedView = (b) => ({ id: String(b._id), ward: b.ward, name: b.name, active: b.active });
/** Wards in the order they were first set up, beds in natural order (G2 before G10). */
function byWard(beds) {
  const wards = new Map();
  for (const b of [...beds].sort((x, y) => x.createdAt - y.createdAt)) {
    if (!wards.has(b.ward)) wards.set(b.ward, []);
    wards.get(b.ward).push(b);
  }
  const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return [...wards].map(([ward, list]) => ({ ward, beds: list.sort((x, y) => natural.compare(x.name, y.name)) }));
}

async function findBed(req, id) {
  const bed = await Bed.findOne({ tenantId: req.tenantId, _id: parse(objectId, id) });
  if (!bed) throw notFound('This bed was not found.');
  return bed;
}
async function assertFree(req, bed) {
  if (!bed.active) throw conflict('This bed is not in use. Choose another bed.', 'BED_NOT_IN_USE');
  if (await Admission.findOne({ tenantId: req.tenantId, bedId: bed._id, status: 'admitted' }, { _id: 1 }).lean()) {
    throw conflict('Someone is already in this bed. Choose a free bed.', 'BED_OCCUPIED');
  }
}

// ---------- The bed board ----------

bedsRouter.get('/', async (req, res) => {
  // The hospital admin's Today (owner, 14 Oct 2026): the counts only (?summary=1) – never who is in a bed
  const countsOnly = req.query.summary === '1' && hasRole(req.membership, ...SETUP_ROLES);
  if (!countsOnly) assertRole(req, BOARD_ROLES, 'The bed board is for reception, doctors, RMOs and nurses.');
  const tenantId = req.tenantId;
  // ?free=1: the free beds only, for admitting from a patient's record – no names, so not audited
  if (req.query.free === '1') {
    const [beds, taken] = await Promise.all([Bed.find({ tenantId, active: true }).lean(), Admission.find({ tenantId, status: 'admitted', bedId: { $ne: null } }, { bedId: 1 }).lean()]);
    const occupied = new Set(taken.map((a) => String(a.bedId)));
    const free = byWard(beds.filter((b) => !occupied.has(String(b._id))));
    return res.json({ beds: free.flatMap(({ ward, beds: list }) => list.map((b) => ({ id: String(b._id), ward, name: b.name, label: `${ward} · ${b.name}` }))) });
  }
  // ?summary=1: the counts only (reception's Today page) – no names, so not audited
  if (req.query.summary === '1') {
    const [inUse, occupied] = await Promise.all([Bed.countDocuments({ tenantId, active: true }), Admission.countDocuments({ tenantId, status: 'admitted', bedId: { $ne: null } })]);
    return res.json({ counts: { total: inUse, occupied, free: Math.max(0, inUse - occupied) } });
  }
  const [beds, stays] = await Promise.all([Bed.find({ tenantId }).lean(), Admission.find({ tenantId, status: 'admitted' }).sort({ admittedAt: 1 }).limit(1000).lean()]);
  const patients = stays.length ? await Patient.find({ tenantId, _id: { $in: stays.map((s) => s.patientId) } }) : [];
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const doctors = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));

  const stayView = (s) => {
    const p = byId.get(String(s.patientId));
    if (!p) return null;
    return {
      id: String(s._id),
      admittedAt: s.admittedAt,
      reason: reasonFor(req, p, s),
      patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn, assignedDoctorName: p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? null) : null, ...(isClosed(p) ? { closed: true } : {}) },
      canMove: mayMoveBed(req, p),
      // HIMS-style admission (docs/ADMISSION_DESK_PLAN.md): the IPD number, and an emergency's checklist still to fill in
      ipdNo: s.ipdNo ?? null,
      checklistIncomplete: Boolean(s.checklist) && !s.checklist.complete,
      mlc: Boolean(s.mlc),
    };
  };
  const inBed = new Map(stays.filter((s) => s.bedId).map((s) => [String(s.bedId), s]));
  const wards = byWard(beds).map(({ ward, beds: list }) => ({
    ward,
    beds: list
      .filter((b) => b.active || inBed.has(String(b._id)))
      .map((b) => ({ ...bedView(b), stay: inBed.has(String(b._id)) ? stayView(inBed.get(String(b._id))) : null })),
  }));
  // Stays admitted without a bed from the list (typed ward and bed, or before the list existed)
  const elsewhere = stays.filter((s) => !s.bedId).map((s) => ({ ...stayView(s), ward: s.ward || '', bed: s.bed || '' })).filter((s) => s.patient);
  const counts = wards.reduce((c, w) => ({ total: c.total + w.beds.filter((b) => b.active).length, occupied: c.occupied + w.beds.filter((b) => b.stay).length }), { total: 0, occupied: 0 });
  await audit(req, 'BEDS_VIEWED', { details: { occupied: counts.occupied, withoutBed: elsewhere.length } });
  res.json({
    wards,
    elsewhere,
    counts: { ...counts, free: Math.max(0, counts.total - counts.occupied) },
    canAdmit: hasRole(req.membership, 'receptionist', 'doctor', 'rmo'),
  });
});

// ---------- The front desk's stays (owner, 14 Oct 2026) ----------
// Reception's Today: how many are in hospital and were admitted today, who is going home (a discharge card being
// written – the doctor confirms it, which ends the stay and frees the bed) and who went home today. Names and beds
// only, never the card's contents. Audited, as the bed board is.
bedsRouter.get('/desk', async (req, res) => {
  // The hospital admin (no patient data): numbers only – how many are in, admitted, going home and went home today
  const numbersOnly = !hasRole(req.membership, ...BOARD_ROLES) && hasRole(req.membership, ...SETUP_ROLES);
  if (!numbersOnly) assertRole(req, BOARD_ROLES, 'The bed board is for reception, doctors, RMOs and nurses.');
  const tenantId = req.tenantId;
  const now = req.now ?? new Date();
  const dayStart = hospitalDayStart(hospitalToday(now));
  const [inHospital, gone] = await Promise.all([
    Admission.find({ tenantId, status: 'admitted' }, { patientId: 1, ward: 1, bed: 1, admittedAt: 1 }).limit(1000).lean(),
    Admission.find({ tenantId, status: 'discharged', dischargedAt: { $gte: dayStart } }, { patientId: 1, ward: 1, bed: 1, dischargedAt: 1, dischargedByName: 1 }).sort({ dischargedAt: 1 }).lean(),
  ]);
  const drafts = inHospital.length
    ? await ClinicalDocument.find({ tenantId, kind: 'discharge', status: 'draft', admissionId: { $in: inHospital.map((s) => s._id) } }, { admissionId: 1, createdAt: 1 }).lean()
    : [];
  const writing = new Map(drafts.map((d) => [String(d.admissionId), d.createdAt]));
  const going = inHospital.filter((s) => writing.has(String(s._id)));
  if (numbersOnly) {
    return res.json({
      inHospital: inHospital.length,
      admittedToday: inHospital.filter((s) => s.admittedAt >= dayStart).length,
      goingHomeCount: going.length,
      dischargedTodayCount: gone.length,
      goingHome: [],
      dischargedToday: [],
      numbersOnly: true,
    });
  }
  const ids = [...going, ...gone].map((s) => s.patientId);
  const patients = new Map((ids.length ? await Patient.find({ tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const who = (s) => {
    const p = patients.get(String(s.patientId));
    return p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn } : null;
  };
  const goingHome = going.map((s) => ({ stayId: String(s._id), patient: who(s), ward: s.ward, bed: s.bed, cardStarted: writing.get(String(s._id)) })).filter((x) => x.patient);
  const dischargedToday = gone.map((s) => ({ stayId: String(s._id), patient: who(s), ward: s.ward, bed: s.bed, dischargedAt: s.dischargedAt, byName: s.dischargedByName ?? '' })).filter((x) => x.patient);
  if (goingHome.length || dischargedToday.length) await audit(req, 'DISCHARGES_VIEWED', { details: { goingHome: goingHome.length, dischargedToday: dischargedToday.length } });
  res.json({
    inHospital: inHospital.length,
    admittedToday: inHospital.filter((s) => s.admittedAt >= dayStart).length,
    goingHomeCount: goingHome.length,
    dischargedTodayCount: dischargedToday.length,
    goingHome,
    dischargedToday,
  });
});

// ---------- Admit at the desk ----------

const admitSchema = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    admittedAt: z.preprocess((v) => (v === '' ? undefined : v), z.iso.datetime('Please enter the date and time of admission').optional()),
    reasonCode: z.enum(REASON_CODES, 'Choose the reason for admission'),
    reasonNote: safeText('Note', 120).default(''),
    admissionType: z.enum(['planned', 'emergency', 'day_care'], 'Choose planned, emergency or day care').default('planned'),
    mlc: z.boolean().default(false),
    // HIMS-style admission (docs/ADMISSION_DESK_PLAN.md): the checklist (required unless an emergency), the police
    // station of a medico-legal case, and the doctor's request she is admitted from
    checklist: checklistSchema.optional(),
    mlcPolice: safeText('Police station', 120).default(''),
    requestId: objectId.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.reasonCode === 'other' && b.reasonNote.trim().length < 3) ctx.addIssue({ code: 'custom', path: ['reasonNote'], message: 'Write a short note for "Other"' });
  });

bedsRouter.post('/:bedId/admit', async (req, res) => {
  assertRole(req, ['receptionist', 'doctor', 'rmo'], 'Patients are admitted by reception, doctors and RMOs.');
  const body = parse(admitSchema, req.body);
  const bed = await findBed(req, req.params.bedId);
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, body.patientId);
  if (!mayAdmit(req, patient)) throw forbidden("This is another doctor's patient: ask her doctor, an RMO or reception to admit her.");
  const same = await Admission.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (same) {
    if (!same.patientId.equals(patient._id)) throw conflict('Please reload the page and try again.');
    return res.status(200).json({ admission: admissionView(same) });
  }
  refuseNewOnDuplicate(patient, 'admission');
  refuseNewOnClosed(patient, 'admission');
  await assertFree(req, bed);
  const now = req.now ?? new Date();
  const admittedAt = body.admittedAt ? new Date(body.admittedAt) : now;
  if (admittedAt.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ admittedAt: "The admission can't be in the future." });
  // The checklist: when the hospital requires it, complete for a planned or day-care admission (an emergency goes in at
  // once and is completed later); otherwise an incomplete one is flagged on the bed board until it is completed
  const rules = await deskRules(req.tenantId);
  const checklist = checklistDoc(req, checklistSchema.parse(body.checklist ?? {}));
  if (rules.requireChecklist && body.admissionType !== 'emergency') {
    const missing = checklistMissing(checklist);
    if (Object.keys(missing).length) throw invalid(missing, 'Complete the admission checklist (an emergency can be admitted first and completed later).');
  }
  if (body.mlc && body.mlcPolice.trim().length < 3) throw invalid({ mlcPolice: 'Write the police station informed (or "to inform").' });
  // The doctor's request: the one she is admitted from, else her open one; required at the desk when the hospital says so
  const request = body.requestId
    ? await AdmissionRequest.findOne({ tenantId: req.tenantId, _id: body.requestId, patientId: patient._id, status: 'open' })
    : await AdmissionRequest.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'open' });
  if (body.requestId && !request) throw conflict('This admission request is no longer open. Reload the page.', 'REQUEST_CLOSED');
  const fromDesk = !hasRole(req.membership, 'doctor', 'rmo');
  if (rules.requireAdmissionRequest && fromDesk && !request && body.admissionType !== 'emergency') {
    throw conflict("A doctor's admission request is needed first (or admit as an emergency).", 'REQUEST_NEEDED');
  }
  let admission;
  try {
    admission = await Admission.create({
      tenantId: req.tenantId,
      patientId: patient._id,
      careType: patient.careType,
      admittedAt,
      ward: bed.ward,
      bed: bed.name,
      bedId: bed._id,
      reason: reasonText(body.reasonCode, body.reasonNote),
      reasonCode: body.reasonCode,
      admissionType: body.admissionType,
      mlc: body.mlc,
      mlcPolice: body.mlc ? body.mlcPolice.trim() : '',
      checklist,
      requestId: request?._id ?? null,
      withoutRequest: Boolean(rules.requireAdmissionRequest && fromDesk && !request),
      ipdNo: await nextIpdNo(req.tenantId, now),
      admittedBy: req.user._id,
      admittedByName: req.user.name,
      clientRequestId: body.clientRequestId,
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    if (e.keyPattern?.bedId) throw conflict('Someone is already in this bed. Choose a free bed.', 'BED_OCCUPIED');
    throw conflict('She is already admitted.', 'ALREADY_ADMITTED');
  }
  await audit(req, 'ADMISSION_CREATED', { details: { patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), bedId: String(bed._id), via: 'bed board' } });
  if (request) await AdmissionRequest.updateOne({ _id: request._id, tenantId: req.tenantId, status: 'open' }, { $set: { status: 'admitted', admissionId: admission._id } });
  await billAdmitted(req, admission); // billing: the stay's bill with the bed charge of this ward
  res.status(201).json({ admission: { id: String(admission._id), ipdNo: admission.ipdNo, admittedAt: admission.admittedAt, ward: admission.ward, bed: admission.bed, checklistComplete: checklist.complete } });
});

// ---------- Move to another bed ----------

bedsRouter.post('/stays/:admissionId/move', async (req, res) => {
  assertRole(req, BOARD_ROLES, 'Beds are changed by reception, nurses, doctors and RMOs.');
  const body = parse(z.object({ bedId: objectId }).strict(), req.body);
  const admission = await Admission.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.admissionId) });
  if (!admission) throw notFound('This stay was not found.');
  if (admission.status !== 'admitted') throw conflict('She has been discharged: this stay can no longer be changed.');
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now ?? new Date() }, String(admission.patientId));
  if (!mayMoveBed(req, patient)) throw forbidden("This is another doctor's patient: ask her doctor, an RMO, a nurse or reception to change her bed.");
  const bed = await findBed(req, body.bedId);
  if (admission.bedId?.equals(bed._id)) return res.json({ admission: { id: String(admission._id), ward: admission.ward, bed: admission.bed } });
  await assertFree(req, bed);
  const from = admission.bedId ? String(admission.bedId) : null;
  admission.bedId = bed._id;
  admission.ward = bed.ward;
  admission.bed = bed.name;
  try {
    await admission.save();
  } catch (e) {
    if (e?.code !== 11000) throw e;
    throw conflict('Someone is already in this bed. Choose a free bed.', 'BED_OCCUPIED');
  }
  await audit(req, 'ADMISSION_BED_CHANGED', { details: { patientId: String(patient._id), mrn: patient.mrn, admissionId: String(admission._id), fromBedId: from, toBedId: String(bed._id) } });
  res.json({ admission: { id: String(admission._id), ward: admission.ward, bed: admission.bed } });
});

// ---------- Wards and beds (hospital admin) ----------

bedsRouter.get('/setup', async (req, res) => {
  assertRole(req, SETUP_ROLES, 'Wards and beds are set up by the hospital admin.');
  const [beds, occupied] = await Promise.all([Bed.find({ tenantId: req.tenantId }).lean(), Admission.find({ tenantId: req.tenantId, status: 'admitted', bedId: { $ne: null } }, { bedId: 1 }).lean()]);
  const taken = new Set(occupied.map((a) => String(a.bedId)));
  res.json({ wards: byWard(beds).map(({ ward, beds: list }) => ({ ward, beds: list.map((b) => ({ ...bedView(b), occupied: taken.has(String(b._id)) })) })) });
});

const bedName = safeText('Bed', 30).refine((t) => t.trim().length > 0, 'Write the bed name');
const addSchema = z
  .object({
    ward: safeText('Ward', 60).refine((t) => t.trim().length > 0, 'Write the ward name'),
    names: z.array(bedName, 'Add at least one bed').min(1, 'Add at least one bed').max(100, 'Add at most 100 beds at a time'),
  })
  .strict();

bedsRouter.post('/setup', async (req, res) => {
  assertRole(req, SETUP_ROLES, 'Wards and beds are set up by the hospital admin.');
  const body = parse(addSchema, req.body);
  const ward = body.ward.trim();
  const names = [...new Set(body.names.map((n) => n.trim()))];
  const existing = await Bed.find({ tenantId: req.tenantId, ward: new RegExp(`^${ward.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { name: 1, ward: 1 }).lean();
  const wardName = existing[0]?.ward ?? ward; // keep the ward's first spelling
  const have = new Set(existing.map((b) => b.name.toLowerCase()));
  const repeated = names.filter((n) => have.has(n.toLowerCase()));
  if (repeated.length) throw invalid({ names: `Already in ${wardName}: ${repeated.join(', ')}` });
  const created = await Bed.insertMany(names.map((name) => ({ tenantId: req.tenantId, ward: wardName, name })));
  await audit(req, 'BEDS_ADDED', { details: { ward: wardName, count: created.length } });
  res.status(201).json({ beds: created.map(bedView) });
});

bedsRouter.patch('/setup/:bedId', async (req, res) => {
  assertRole(req, SETUP_ROLES, 'Wards and beds are set up by the hospital admin.');
  const body = parse(z.object({ active: z.boolean().optional(), name: bedName.optional() }).strict(), req.body);
  const bed = await findBed(req, req.params.bedId);
  if (body.active === false && bed.active) {
    if (await Admission.findOne({ tenantId: req.tenantId, bedId: bed._id, status: 'admitted' }, { _id: 1 }).lean()) {
      throw conflict('Someone is in this bed. Move her to another bed first.', 'BED_OCCUPIED');
    }
  }
  if (body.active !== undefined) bed.active = body.active;
  if (body.name !== undefined) bed.name = body.name.trim();
  try {
    await bed.save();
  } catch (e) {
    if (e?.code !== 11000) throw e;
    throw invalid({ name: `${bed.ward} already has a bed called ${bed.name}` });
  }
  await audit(req, 'BED_UPDATED', { details: { bedId: String(bed._id), active: bed.active } });
  res.json({ bed: bedView(bed) });
});

import { Router } from 'express';
import { z } from 'zod';
import { hospitalDoctor, hospitalDoctors } from '../appointments/appointmentService.js';
import { PURPOSE_NOTE_MAX, VISIT_PURPOSES } from '../appointments/visitPurpose.js';
import { hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { FollowUp } from '../models/FollowUp.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { objectId, parse } from '../utils/validate.js';

// Follow-ups added by hand (26 Oct 2026): "she will come back to Dr X to show her reports". Reception, doctors and RMOs
// add, list and cancel them (GET / POST /api/added-follow-ups, POST /:id/cancel); when she checks in, her open
// follow-up is marked "came" (routes/arrivals.js) and its purpose fills in why she came. The purpose is from a fixed
// list and the note is short – never a medical detail (reception sees them). Adding and cancelling are audited with
// ids only.

export const FOLLOW_UP_ROLES = ['receptionist', 'doctor', 'rmo'];
export const addedFollowUpsRouter = Router();

addedFollowUpsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...FOLLOW_UP_ROLES)) throw new HttpError(403, 'Follow-ups are for reception, doctors and RMOs.', 'FORBIDDEN');
  next();
});

const MAX_ROWS = 300;

/** A follow-up as the website gets it (built field by field). */
export function followUpView(f, { patients = new Map(), doctors = new Map() } = {}) {
  const p = patients.get(String(f.patientId));
  return {
    id: String(f._id),
    patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '' } : { id: String(f.patientId) },
    doctor: { id: String(f.doctorId), name: doctors.get(String(f.doctorId)) ?? 'Doctor' },
    purpose: f.purpose,
    note: f.note ?? '',
    from: f.from ? isoDay(f.from) : null,
    status: f.status,
    // Booked for a day and time (her appointment), or null
    booked: f.booked ? { appointmentId: String(f.booked.appointmentId), date: isoDay(f.booked.on), start: f.booked.start ?? null } : null,
    addedBy: f.created?.byName ?? '',
    addedOn: f.created?.at ? isoDay(f.created.at) : null,
  };
}

/** Open follow-ups of these patients (the earliest first): Map patientId -> [view]. */
export async function openFollowUpsOf(tenantId, patientIds) {
  const ids = [...new Set(patientIds.map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await FollowUp.find({ tenantId, patientId: { $in: ids }, status: 'open' }).sort({ from: 1, 'created.at': 1 }).lean();
  if (!rows.length) return out;
  const doctors = new Map((await hospitalDoctors(tenantId)).map((d) => [d.id, d.name]));
  for (const f of rows) {
    const k = String(f.patientId);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(followUpView(f, { doctors }));
  }
  return out;
}

async function patientFor(req, id) {
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: id }, { fullName: 1, mrn: 1, phone: 1, duplicateOf: 1, 'death.on': 1, careType: 1, assignedDoctor: 1, sensitive: 1, tenantId: 1 });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (!patientAccess(req, patient).view.has('phone')) throw new HttpError(403, "You can't see this patient's follow-ups.", 'FORBIDDEN');
  return patient;
}

/** A booking whose appointment was cancelled (or moved to another patient) no longer counts: the follow-up is unbooked. */
async function withLiveBookings(tenantId, rows) {
  const ids = rows.filter((f) => f.booked).map((f) => f.booked.appointmentId);
  if (!ids.length) return rows;
  const live = new Map((await Appointment.find({ tenantId, _id: { $in: ids }, status: 'booked' }, { on: 1, start: 1, patientId: 1 }).lean()).map((a) => [String(a._id), a]));
  return rows.map((f) => {
    if (!f.booked) return f;
    const a = live.get(String(f.booked.appointmentId));
    // A moved appointment keeps the follow-up booked at its new day and time
    return a && String(a.patientId) === String(f.patientId) ? { ...f, booked: { ...f.booked, on: a.on, start: a.start } } : { ...f, booked: null };
  });
}

// The open follow-ups: of one patient (?patientId=), of everyone (the Follow-ups page), or the logged-in doctor's own
// (?mine=1, her Today), the earliest first
addedFollowUpsRouter.get('/', async (req, res) => {
  const { patientId, mine } = parse(z.object({ patientId: objectId.optional(), mine: z.enum(['1']).optional() }).strict(), req.query);
  const filter = { tenantId: req.tenantId, status: 'open' };
  if (patientId) filter.patientId = (await patientFor(req, patientId))._id;
  if (mine) filter.doctorId = req.user._id;
  const rows = await withLiveBookings(req.tenantId, await FollowUp.find(filter).sort({ from: 1, 'created.at': 1 }).limit(MAX_ROWS + 1).lean());
  const patients = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: rows.map((f) => f.patientId) } }, { fullName: 1, mrn: 1, phone: 1 }).lean()).map((p) => [String(p._id), p]));
  const doctors = new Map((await hospitalDoctors(req.tenantId)).map((d) => [d.id, d.name]));
  res.json({ today: isoDay(hospitalToday(req.now)), followUps: rows.slice(0, MAX_ROWS).map((f) => followUpView(f, { patients, doctors })), cut: rows.length > MAX_ROWS });
});

const addSchema = z
  .object({
    patientId: objectId,
    doctorId: objectId,
    purpose: z.enum(VISIT_PURPOSES, { error: 'Please choose what the follow-up is for.' }),
    note: z.string().trim().max(PURPOSE_NOTE_MAX, `At most ${PURPOSE_NOTE_MAX} characters – no medical details here.`).optional().default(''),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day as YYYY-MM-DD').optional().nullable(),
  })
  .strict();

addedFollowUpsRouter.post('/', async (req, res) => {
  const body = parse(addSchema, req.body);
  const patient = await patientFor(req, body.patientId);
  refuseNewOnDuplicate(patient, 'follow-up');
  refuseNewOnClosed(patient, 'follow-up');
  const doctor = await hospitalDoctor(req.tenantId, body.doctorId);
  const f = await FollowUp.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    doctorId: doctor.id,
    purpose: body.purpose,
    note: body.note,
    // The day she comes from: required on the form; none given means today (owner, 26 Oct 2026)
    from: body.from ? utcDay(new Date(`${body.from}T00:00:00Z`)) : hospitalToday(req.now),
    created: { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() },
  });
  await audit(req, 'FOLLOW_UP_ADDED', { details: { followUpId: String(f._id), patientId: String(patient._id), mrn: patient.mrn, doctorId: doctor.id, purpose: body.purpose } });
  res.status(201).json({ followUp: followUpView(f.toObject(), { patients: new Map([[String(patient._id), patient]]), doctors: new Map([[doctor.id, doctor.name]]) }) });
});

// Booked: her appointment for this follow-up (made with POST /api/appointments, visit type follow-up) is kept on it
addedFollowUpsRouter.post('/:id/booked', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { appointmentId } = parse(z.object({ appointmentId: objectId }).strict(), req.body);
  const f = await FollowUp.findOne({ tenantId: req.tenantId, _id: id });
  if (!f) throw new HttpError(404, 'Follow-up not found.', 'NOT_FOUND');
  const patient = await patientFor(req, f.patientId);
  if (f.status !== 'open') throw new HttpError(409, f.status === 'came' ? 'She has already come for this follow-up.' : 'This follow-up is cancelled.', 'NOT_OPEN');
  const a = await Appointment.findOne({ tenantId: req.tenantId, _id: appointmentId, patientId: f.patientId, status: 'booked' }, { on: 1, start: 1, doctorId: 1 }).lean();
  if (!a) throw new HttpError(400, 'Choose a booked appointment of this patient.', 'VALIDATION_ERROR');
  f.booked = { appointmentId: a._id, on: a.on, start: a.start ?? null, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  // The doctor of the booking is the follow-up's doctor
  f.doctorId = a.doctorId;
  await f.save();
  const doctors = new Map((await hospitalDoctors(req.tenantId)).map((d) => [d.id, d.name]));
  res.json({ followUp: followUpView(f.toObject(), { patients: new Map([[String(patient._id), patient]]), doctors }) });
});

addedFollowUpsRouter.post('/:id/cancel', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const f = await FollowUp.findOne({ tenantId: req.tenantId, _id: id });
  if (!f) throw new HttpError(404, 'Follow-up not found.', 'NOT_FOUND');
  const patient = await patientFor(req, f.patientId);
  if (f.status !== 'open') throw new HttpError(409, f.status === 'came' ? 'She has already come for this follow-up.' : 'This follow-up is already cancelled.', 'NOT_OPEN');
  f.status = 'cancelled';
  f.cancelled = { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await f.save();
  await audit(req, 'FOLLOW_UP_CANCELLED', { details: { followUpId: String(f._id), patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ followUp: followUpView(f.toObject(), { patients: new Map([[String(patient._id), patient]]) }) });
});

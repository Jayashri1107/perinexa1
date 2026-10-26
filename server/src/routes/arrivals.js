import { Router } from 'express';
import { notify } from '../notifications/notify.js';
import { z } from 'zod';
import { cancelAppointment, giveToken, hospitalDoctor, viewsOf } from '../appointments/appointmentService.js';
import { hospitalToday } from '../careplans/dates.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { FollowUp } from '../models/FollowUp.js';
import { PURPOSE_LABELS, PURPOSE_NOTE_MAX, VISIT_PURPOSES } from '../appointments/visitPurpose.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';
import { objectId, parse } from '../utils/validate.js';
import { nextOpdNo } from '../inpatient/admissionDesk.js';
import { currentAge } from '../models/Patient.js';
import { User } from '../models/User.js';
import { patientAccess } from '../utils/patientAccess.js';
import { sendQueueTime } from '../appointments/queueTime.js';

// "Mark arrived" (Feature 10): POST /api/arrivals { patientId, doctorId? } marks a patient as arrived today; DELETE
// /api/arrivals/:patientId undoes it (today only). Reception, nurses, doctors and RMOs. Audited with ids only.
// Appointment booking: a patient with no appointment today who is sent to a doctor (doctorId) gets that doctor's
// next walk-in token (1, 2, 3 … per doctor per day); undoing the arrival cancels the token (its number is not
// given again).

export const ARRIVAL_ROLES = ['receptionist', 'nurse', 'doctor', 'rmo'];
export const arrivalsRouter = Router();

arrivalsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ARRIVAL_ROLES)) throw new HttpError(403, "Your role doesn't include marking arrivals.", 'FORBIDDEN');
  next();
});

async function patientOf(req, id) {
  const patient = await Patient.findOne({ _id: id, tenantId: req.tenantId }, { _id: 1, mrn: 1, duplicateOf: 1, 'death.on': 1 });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  return patient;
}

arrivalsRouter.post('/', async (req, res) => {
  const { patientId, doctorId, purpose } = parse(
    z
      .object({
        patientId: objectId,
        doctorId: objectId.optional(),
        // Why she came (26 Oct 2026): a fixed purpose and a short note – never a medical detail
        purpose: z.object({ kind: z.enum(VISIT_PURPOSES), note: z.string().trim().max(PURPOSE_NOTE_MAX, `At most ${PURPOSE_NOTE_MAX} characters – no medical details here.`).optional().default('') }).strict().optional(),
      })
      .strict(),
    req.body,
  );
  const patient = await patientOf(req, patientId);
  // A record marked as a duplicate is not marked arrived (no token, no visit): she arrives on her main record
  refuseNewOnDuplicate(patient, 'arrival');
  refuseNewOnClosed(patient, 'arrival'); // nor a record closed after a death
  const on = hospitalToday(req.now);
  const doctor = doctorId ? await hospitalDoctor(req.tenantId, doctorId) : null;
  const at = req.now ?? new Date();
  try {
    await Arrival.create({ tenantId: req.tenantId, patientId: patient._id, on, at, by: req.user._id, byName: req.user.name });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // Already marked today (e.g. at the other desk): kept as it was.
  }
  // Why she came: kept with today's arrival (a second check-in may correct it)
  if (purpose) await Arrival.updateOne({ tenantId: req.tenantId, patientId: patient._id, on }, { $set: { purpose } });
  let arrival = await Arrival.findOne({ tenantId: req.tenantId, patientId: patient._id, on }).lean();
  // Her follow-ups due by today: she came (the reason was marked above, from them when she had one)
  const dueFollowUps = await FollowUp.find({ tenantId: req.tenantId, patientId: patient._id, status: 'open', $or: [{ from: null }, { from: { $lte: on } }] }).lean();
  if (dueFollowUps.length) {
    await FollowUp.updateMany({ tenantId: req.tenantId, _id: { $in: dueFollowUps.map((f) => f._id) } }, { $set: { status: 'came', came: { by: req.user._id, byName: req.user.name, at, on } } });
  }
  // The day's OPD number (docs/ADMISSION_DESK_PLAN.md), given once – also to an arrival marked before it existed
  if (!arrival.opdNo) {
    await Arrival.updateOne({ _id: arrival._id, tenantId: req.tenantId, opdNo: null }, { $set: { opdNo: await nextOpdNo(req.tenantId, at) } });
    arrival = await Arrival.findOne({ _id: arrival._id, tenantId: req.tenantId }).lean();
  }
  // Her appointment today, or – sent to a doctor without one – a walk-in token
  let appt = await Appointment.findOne({ tenantId: req.tenantId, patientId: patient._id, on, status: 'booked' }).sort({ kind: 1, start: 1 }).lean();
  if (!appt && doctor) {
    appt = (await giveToken(req, { patientId: patient._id, doctor, day: on })).toObject();
    await audit(req, 'TOKEN_GIVEN', { details: { appointmentId: String(appt._id), patientId: String(patient._id), doctorId: doctor.id, token: appt.token } });
  }
  await audit(req, 'PATIENT_ARRIVED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  const [appointment] = appt ? await viewsOf(req.tenantId, [appt], on) : [null];
  // Her doctor is told she has arrived – and why she came (the doctor of her appointment, or of her follow-up)
  const told = appointment?.doctor?.id ? [appointment.doctor.id] : [...new Set(dueFollowUps.map((f) => String(f.doctorId)))];
  if (told.length) {
    const name = (await Patient.findOne({ tenantId: req.tenantId, _id: patient._id }, { fullName: 1 }).lean())?.fullName ?? 'A patient';
    const why = arrival.purpose?.kind ? ` Came for: ${PURPOSE_LABELS[arrival.purpose.kind]}${arrival.purpose.note ? ` (${arrival.purpose.note})` : ''}.` : '';
    await notify(req, { userIds: told }, { kind: 'arrived', text: `${name} has arrived${appointment?.token ? ` – token ${appointment.token}` : appointment?.start ? ` for ${appointment.start}` : ''}.${why}`, link: '/' });
  }
  // Her place in the queue and about when she goes in, on WhatsApp (when the hospital switched it on and she agreed)
  const queueTime = appt ? await sendQueueTime(req, patient._id, appt._id) : { sent: false, reason: 'no_appointment' };
  res.status(201).json({ queueTime, arrival: { patientId: String(patient._id), at: arrival.at, byName: arrival.byName, opdNo: arrival.opdNo, purpose: arrival.purpose ?? null }, appointment, followUpsCame: dueFollowUps.length });
});

// The OPD case paper of today's visit (docs/ADMISSION_DESK_PLAN.md): the OPD number, the day, her token or time and
// doctor, and her details as this person may see them – printed with ruled space for the doctor to write by hand.
arrivalsRouter.get('/:patientId/case-paper', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await Patient.findOne({ _id: patientId, tenantId: req.tenantId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const a = patientAccess(req, patient);
  if (!a.view.has('phone')) throw new HttpError(403, "You can't see this patient's details.", 'FORBIDDEN');
  const on = hospitalToday(req.now);
  const arrival = await Arrival.findOne({ tenantId: req.tenantId, patientId: patient._id, on }).lean();
  if (!arrival?.opdNo) throw new HttpError(409, 'Mark her arrived first: the OPD number is given then.', 'NOT_ARRIVED');
  const appt = await Appointment.findOne({ tenantId: req.tenantId, patientId: patient._id, on, status: 'booked' }).sort({ kind: 1, start: 1 }).lean();
  const doctorId = appt?.doctorId ?? patient.assignedDoctor;
  const doctor = doctorId ? await User.findById(doctorId, { name: 1 }).lean() : null;
  res.json({
    paper: {
      opdNo: arrival.opdNo,
      date: on.toISOString().slice(0, 10),
      arrivedAt: arrival.at,
      token: appt?.kind === 'token' ? appt.token : null,
      time: appt?.kind === 'slot' ? (appt.start ?? null) : null,
      doctorName: doctor?.name ?? '',
      patient: {
        fullName: patient.fullName,
        mrn: patient.mrn,
        age: patient.careType === 'newborn' ? null : currentAge(patient, req.now),
        careType: patient.careType,
        phone: patient.phone ?? '',
        address: a.view.has('address') ? [patient.address, patient.city, patient.state, patient.pinCode].filter(Boolean).join(', ') : '',
      },
    },
  });
});

arrivalsRouter.post('/:patientId/case-paper/printed', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await patientOf(req, patientId);
  const arrival = await Arrival.findOne({ tenantId: req.tenantId, patientId: patient._id, on: hospitalToday(req.now) }, { opdNo: 1 }).lean();
  await audit(req, 'OPD_CASE_PAPER_PRINTED', { details: { patientId: String(patient._id), mrn: patient.mrn, opdNo: arrival?.opdNo ?? null } });
  res.json({ ok: true });
});

// The live queue (26 Oct 2026): POST /api/arrivals/:patientId/emergency { emergency } – she goes first in her doctor's
// waiting list (or back to her place); POST /api/arrivals/:patientId/left { left } – "Done – she left" (or undone).
// Today's arrival only. Audited with ids only.
async function setFlag(req, res, key, action) {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const { [key]: on } = parse(z.object({ [key]: z.boolean() }).strict(), req.body);
  const patient = await patientOf(req, patientId);
  const day = hospitalToday(req.now);
  const value = on ? { at: req.now ?? new Date(), by: req.user._id, byName: req.user.name } : null;
  const arrival = await Arrival.findOneAndUpdate({ tenantId: req.tenantId, patientId: patient._id, on: day }, { $set: { [key]: value } }, { new: true }).lean();
  if (!arrival) throw new HttpError(409, 'Mark her arrived first.', 'NOT_ARRIVED');
  await audit(req, action, { details: { patientId: String(patient._id), mrn: patient.mrn, [key]: on } });
  res.json({ arrival: { patientId: String(patient._id), emergency: Boolean(arrival.emergency), left: Boolean(arrival.left) } });
}
arrivalsRouter.post('/:patientId/emergency', (req, res) => setFlag(req, res, 'emergency', 'ARRIVAL_EMERGENCY_CHANGED'));
arrivalsRouter.post('/:patientId/left', (req, res) => setFlag(req, res, 'left', 'PATIENT_LEFT_MARKED'));

arrivalsRouter.delete('/:patientId', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }), req.params);
  const patient = await patientOf(req, patientId);
  const on = hospitalToday(req.now);
  const r = await Arrival.deleteOne({ tenantId: req.tenantId, patientId: patient._id, on });
  if (r.deletedCount) {
    await audit(req, 'PATIENT_ARRIVAL_UNDONE', { details: { patientId: String(patient._id), mrn: patient.mrn } });
    // Her walk-in token goes with the arrival
    const tokens = await Appointment.find({ tenantId: req.tenantId, patientId: patient._id, on, kind: 'token', status: 'booked' });
    for (const t of tokens) await cancelAppointment(req, t, 'arrival_undone', { message: false });
  }
  res.json({ undone: r.deletedCount > 0 });
});

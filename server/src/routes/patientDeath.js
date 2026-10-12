import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { DEATH_PLACES, DEATH_TIMINGS, isClosed } from '../patients/deathRules.js';
import { closeRecord, deathDayProblems, recordDeath, undoDeath } from '../patients/deathService.js';
import { sameDay } from '../careplans/dates.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatient } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { parse, requiredDateOnly } from '../utils/validate.js';

// Recording a death on a record, with great care (/api/patients/:id/death). Mounted inside the patients router,
// after its role gate.
//  - PUT   { on, place | timing, confirmed: true }   records the death and closes the record. A baby's record: the
//                                                     date and the place (the age in days is worked out); every other
//                                                     record: the date and when it was in relation to the pregnancy.
//                                                     There is no cause-of-death field.
//  - POST  /undo { reason }                           undoes a death recorded in error; the entry is kept in the
//                                                     record's history with the reason. The appointments the closing
//                                                     cancelled that are still ahead are listed, to book again.
// Who: a DOCTOR who may change the record – the patient's doctor, or any doctor for an unassigned patient. Never an
// RMO, a nurse or reception. A record of another hospital is "not found". What closing does, and what a closed
// record still takes, is in patients/deathRules.js.
// Audit: PATIENT_RECORD_CLOSED and PATIENT_RECORD_REOPENED, stored with the record's id and number and counts only –
// never the date, the place, the timing or the reason. The audit log's readers get the counts alone, never which
// record (utils/auditDetails.js): closing has one reason only, and the hospital admin reads the log.

export const patientDeathRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);

const confirmed = z.literal(true, 'Please confirm that the details are right.');
const babySchema = z.object({ on: requiredDateOnly('Date'), place: z.enum(Object.keys(DEATH_PLACES), 'Choose where the baby died'), confirmed }).strict();
const adultSchema = z.object({ on: requiredDateOnly('Date'), timing: z.enum(Object.keys(DEATH_TIMINGS), 'Choose when it was'), confirmed }).strict();
// The reason is free text about a patient: checked for words about the baby's sex unless the record is a baby's.
const undoSchema = (pcpndt) =>
  z
    .object({ reason: (pcpndt ? safeText('Reason', 300) : z.string().trim().max(300, 'Reason is too long')).refine((t) => t.trim().length >= 5, 'Please write why this was recorded in error (at least 5 characters)') })
    .strict();

/** The doctor who may change this record; a plain 403 for everyone else. */
function assertDoctorOfRecord(req, patient) {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('Only a doctor can record a death, or undo one recorded in error.');
  const access = patientAccess(req, patient);
  if (access.recordDeath) return;
  throw forbidden("This is another doctor's patient: ask that doctor to record the death, or to undo it. (Reception or an RMO can change the doctor of the record.)");
}

const ids = (patient, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...extra });
const counts = (p) => ({ appointmentsCancelled: p.appointmentsCancelled, messagesCancelled: p.messagesCancelled, portalEnded: p.portalEnded });

patientDeathRouter.put('/', async (req, res) => {
  const patient = await findPatient(req);
  assertDoctorOfRecord(req, patient);
  const baby = patient.careType === 'newborn';
  const body = parse(baby ? babySchema : adultSchema, req.body);
  if (isDuplicate(patient)) {
    throw conflict(`This record is marked as a duplicate of ${patient.duplicateOf.mrn}. Record the death on ${patient.duplicateOf.mrn}.`, 'DUPLICATE_RECORD');
  }
  // Pressed again with the same details (the first try was cut off half-way): nothing is recorded twice – what
  // follows a closing is run again, so the appointments and messages that were not cancelled yet are.
  const was = patient.death;
  const again = isClosed(patient) && sameDay(was.on, body.on) && (baby ? was.place === body.place : was.timing === body.timing);
  if (isClosed(patient) && !again) throw conflict('A death is already recorded on this record. If it was recorded in error, undo it first.', 'RECORD_CLOSED');
  if (!again) {
    const problems = await deathDayProblems(req, patient, body.on);
    if (Object.keys(problems).length) throw invalid(problems);
    await recordDeath(req, patient, body);
  }
  // From here on the record IS closed: the audit entry is written whatever happens to the steps that follow.
  const progress = { appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 };
  let result;
  try {
    result = await closeRecord(req, patient, progress);
  } finally {
    if (!again || progress.appointmentsCancelled || progress.messagesCancelled || progress.portalEnded) {
      await audit(req, 'PATIENT_RECORD_CLOSED', { details: ids(patient, counts(progress)) });
    }
  }
  res.json({ closed: true, death: patient.toJSON().death, ...result });
});

patientDeathRouter.post('/undo', async (req, res) => {
  const patient = await findPatient(req);
  assertDoctorOfRecord(req, patient);
  const { reason } = parse(undoSchema(patient.careType !== 'newborn'), req.body);
  if (!isClosed(patient)) return res.json({ undone: false, appointmentsToRebook: [] });
  const result = await undoDeath(req, patient, reason.trim());
  await audit(req, 'PATIENT_RECORD_REOPENED', { details: ids(patient) });
  return res.json({ undone: true, ...result });
});

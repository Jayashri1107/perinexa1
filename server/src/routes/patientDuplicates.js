import { Router } from 'express';
import { z } from 'zod';
import { Admission } from '../models/Admission.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { markingCheck } from '../patients/duplicateCompare.js';
import { cannotBeDuplicate, isDuplicate } from '../patients/duplicateRules.js';
import { duplicatesOf, markDuplicate, openVisitToday, settleDuplicate, undoDuplicate } from '../patients/duplicateService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatient } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Joining two records of one person the safe way (/api/patients/:id/duplicate-of). Mounted inside the patients
// router, after its role gate.
//  - GET    /check?mainId=…      what THIS record has that the main record does not (an allergy, a blood group,
//                                pregnancy dates, a care plan, visits …) and whether it can be marked – shown before
//                                the doctor confirms. Nothing is changed.
//  - PUT    { mainId, reason }   marks THIS record as a duplicate of the main record;
//  - DELETE                      undoes it.
// Who: the patient's doctor (or any doctor for an unassigned patient) or an RMO – and they must be allowed to change
// BOTH records. A record of another hospital is "not found". Nothing is moved or deleted (patients/duplicateRules.js);
// only her booked appointments from today on go to the main record, and come back on undo.
// Audit: marked and undone, with the two records' ids and numbers and a count – never a name or the reason. The
// check reads the main record's medical details, so it is recorded as a view of that record.

export const patientDuplicateRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});

// The reason is free text about a patient: checked for words about the baby's sex unless the record is a baby's.
const reasonText = (pcpndt) => (pcpndt ? safeText('Reason', 300) : z.string().trim().max(300, 'Reason is too long'));
const markSchema = (pcpndt) =>
  z
    .object({
      mainId: objectId,
      reason: reasonText(pcpndt).refine((t) => t.trim().length >= 5, 'Please write why this is a duplicate (at least 5 characters)'),
    })
    .strict();

/** The doctor or RMO who may change this record's clinical details; a plain 403 for everyone else. */
function assertMayJoin(req, patient, other = false) {
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden("Only the patient's doctor or an RMO can mark a record as a duplicate, or undo it.");
  const access = patientAccess(req, patient);
  if (access.editClinical) return;
  if (other) throw forbidden(`You must be allowed to change both records. ${patient.mrn} is another doctor's patient: ask that doctor or an RMO.`);
  throw forbidden("This is another doctor's patient: ask that doctor or an RMO to mark the record as a duplicate, or to undo it.");
}

const ids = (dup, main, extra = {}) => ({ patientId: String(dup._id), mrn: dup.mrn, mainPatientId: String(main._id ?? main.id), mainMrn: main.mrn, ...extra });
const subject = (patient) => (patient.careType === 'newborn' ? 'The baby' : 'She');

/** The main record: this hospital's only (another hospital's is "not found"), and one this person may change. */
async function mainRecord(req, dup, mainId) {
  if (mainId === String(dup._id)) throw invalid(cannotBeDuplicate(dup, dup), { mainId: 'Choose the other record.' });
  const main = await Patient.findOne({ _id: mainId, tenantId: req.tenantId });
  if (!main) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  assertMayJoin(req, main, true);
  return main;
}

/** Is this record already marked as a duplicate of exactly that main record? (a marking pressed again) */
const alreadyMarked = (dup, main) => isDuplicate(dup) && String(dup.duplicateOf.patient) === String(main._id);

/** Why `dup` cannot be marked as a duplicate of `main` now – the refusal (an HttpError), or null when it can. */
async function refusal(req, dup, main) {
  const why = cannotBeDuplicate(dup, main, await duplicatesOf(req.tenantId, dup._id));
  if (why) return invalid(why, { mainId: why });
  // In hospital on this record now: the ward works on it, so it cannot go out of the lists
  if (await Admission.exists({ tenantId: req.tenantId, patientId: dup._id, status: 'admitted' })) {
    return new HttpError(409, `${subject(dup)} is in hospital on this record now. Mark ${main.mrn} as the duplicate of this record instead, or wait until the discharge.`, 'ADMITTED');
  }
  // Today's visit on this record is still open: it could no longer be written in or signed, and she would be on
  // no list of today
  if (await openVisitToday(req.tenantId, dup._id, req.now)) {
    return new HttpError(409, `Today's visit on this record is still open. Sign it or mark it entered in error first – or mark ${main.mrn} as the duplicate of this record instead.`, 'VISIT_OPEN');
  }
  return null;
}

patientDuplicateRouter.get('/check', async (req, res) => {
  const dup = await findPatient(req);
  assertMayJoin(req, dup);
  const { mainId } = parse(z.object({ mainId: objectId }).strict(), req.query);
  const main = await mainRecord(req, dup, mainId);
  const problem = alreadyMarked(dup, main) ? null : await refusal(req, dup, main);
  const check = await markingCheck(req.tenantId, dup, main, req.now ?? new Date());
  // The main record's medical details were compared: a view of that record (ids only)
  await audit(req, 'PATIENT_VIEWED', { details: { patientId: String(main._id), mrn: main.mrn, access: patientAccess(req, main).level } });
  res.json({ main: { id: String(main._id), mrn: main.mrn }, problem: problem?.message ?? null, ...check });
});

patientDuplicateRouter.put('/', async (req, res) => {
  const dup = await findPatient(req);
  assertMayJoin(req, dup);
  const body = parse(markSchema(dup.careType !== 'newborn'), req.body);
  const main = await mainRecord(req, dup, body.mainId);
  // Pressed again for the same main record (the first try was cut off half-way): nothing is marked twice – what
  // follows a marking is run again, so the appointments that did not move yet go to the main record.
  const again = alreadyMarked(dup, main);
  if (!again) {
    const why = await refusal(req, dup, main);
    if (why) throw why;
    await markDuplicate(req, dup, main, body.reason);
  }
  // From here on the record IS marked: the audit entry is written whatever happens to the steps that follow.
  const progress = { appointmentsMoved: 0 };
  let result;
  try {
    result = await settleDuplicate(req, dup, main, progress);
  } finally {
    await audit(req, 'PATIENT_MARKED_DUPLICATE', { details: ids(dup, main, { appointmentsMoved: progress.appointmentsMoved }) });
  }
  res.json({ ...result, main: { id: String(main._id), mrn: main.mrn } });
});

patientDuplicateRouter.delete('/', async (req, res) => {
  const dup = await findPatient(req);
  assertMayJoin(req, dup);
  if (!isDuplicate(dup)) return res.json({ undone: false, appointmentsMoved: 0 });
  const main = await Patient.findOne({ _id: dup.duplicateOf.patient, tenantId: req.tenantId });
  if (main) assertMayJoin(req, main, true);
  const result = await undoDuplicate(req, dup);
  await audit(req, 'PATIENT_DUPLICATE_UNDONE', { details: ids(dup, result.main, { appointmentsMoved: result.appointmentsMoved }) });
  return res.json({ undone: true, ...result });
});

// Who may open a patient's scanned documents and her signed discharge cards (added 7 Oct 2026 at the owner's request).
//  - those who read her record clinically (her doctor, RMOs, nurses, other doctors read-only, emergency access);
//  - reception (registration roles without clinical work) for records that are not sensitive – reception hands the
//    discharge card over and scans the papers. Sensitive records (e.g. infertility) stay with her care team.
// Everything else on her stay (notes, nursing chart, other ward documents) keeps its own, stricter rule.
import { config } from '../../config/index.js';
import { notFoundError } from '../../core/httpError.js';
import { EmergencyAccess, Patient } from '../patients/patient.model.js';
import { atLeast, recordLevel } from '../patients/patientAccess.js';

const { access } = config;
const isFrontDesk = (roles) => roles.some((r) => access.registerPatients.includes(r) && !access.patientsClinical.includes(r));

export function mayOpenRecords(req, patient, level) {
  if (atLeast(level, 'clinicalRead')) return true;
  return isFrontDesk(req.membership.roles) && !patient.isSensitive && atLeast(level, 'contactEdit');
}

// The patient, if this person may open her documents; otherwise "not found" (as for a record they may not see).
export async function loadForRecords(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  const emergency = await EmergencyAccess.exists({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, expiresAt: { $gt: new Date() } });
  const level = recordLevel(req, patient, { emergency: Boolean(emergency) });
  if (!mayOpenRecords(req, patient, level)) throw notFoundError('Patient');
  return { patient, level };
}

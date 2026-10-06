// Need-to-know access to patient records (the same idea as Perinexa's patientAccess.js).
// Levels, from most to least:
//   full         – view and change everything (her doctor, RMOs, the super admin when allowed, emergency access)
//   clinicalRead – view everything, change nothing (other doctors' patients, nurses)
//   contactEdit  – who she is and how to reach her; may change those (reception)
//   contactRead  – the same, read-only (pharmacist)
//   basic        – name, number, age and sex only (lab)
//   none         – not at all (sensitive records outside her care team)
import { config } from '../../config/index.js';

const { access } = config;
const DOCTOR = config.opd.doctorRole;
const has = (roles, list) => roles.some((r) => list.includes(r));
// Registration roles without clinical work (reception): they need every record's contact details, even sensitive ones.
const isFrontDesk = (roles) => roles.some((r) => access.registerPatients.includes(r) && !access.patientsClinical.includes(r));

export const LEVELS = ['none', 'basic', 'contactRead', 'contactEdit', 'clinicalRead', 'full'];
const rank = (level) => LEVELS.indexOf(level);
export const atLeast = (level, wanted) => rank(level) >= rank(wanted);

// The fields each level may see.
const BASIC = ['patientNumber', 'name', 'birthDate', 'birthDateApprox', 'sex', 'status', 'createdAt'];
const CONTACT = [...BASIC, 'phone', 'alternatePhone', 'address', 'abhaNumber', 'consentMessages', 'assignedDoctorId', 'careType', 'isSensitive'];
const CLINICAL = [...CONTACT, 'lmp', 'edd', 'gravida', 'para', 'bloodGroup', 'allergies', 'notes', 'updatedAt'];
export const FIELDS = { basic: BASIC, contactRead: CONTACT, contactEdit: CONTACT, clinicalRead: CLINICAL, full: CLINICAL };

// The best level a person's roles give in general (before looking at one record).
export function roleLevel(membership) {
  const roles = membership?.roles ?? [];
  if (membership?.isSuperAdminAccess && access.superAdminPatientAccess) return 'full';
  if (has(roles, access.patientsAllRecords)) return 'full';
  if (has(roles, access.patientsClinical)) return 'clinicalRead';
  if (has(roles, access.registerPatients)) return 'contactEdit';
  if (has(roles, access.patientsContact)) return 'contactRead';
  if (has(roles, access.patients)) return 'basic';
  return 'none';
}

// The level for one record. emergency: the person has an active emergency access to it.
export function recordLevel(req, patient, { emergency = false } = {}) {
  const general = roleLevel(req.membership);
  if (general === 'full') return 'full';
  const roles = req.membership?.roles ?? [];
  const isHerDoctor = roles.includes(DOCTOR) && patient.assignedDoctorId && req.user._id.equals(patient.assignedDoctorId);
  if (isHerDoctor || (emergency && roles.includes(DOCTOR))) return 'full';
  if (patient.isSensitive) return isFrontDesk(roles) ? 'contactEdit' : 'none';
  return general;
}

// The list filter for sensitive records: who may see them in lists at all.
export function listVisibility(req) {
  const general = roleLevel(req.membership);
  const roles = req.membership?.roles ?? [];
  if (general === 'full' || isFrontDesk(roles)) return {};
  if (roles.includes(DOCTOR)) return { $or: [{ isSensitive: false }, { assignedDoctorId: req.user._id }] };
  return { isSensitive: false };
}

// Only the fields the level allows.
export function viewOf(patient, level) {
  const out = { id: String(patient._id ?? patient.id) };
  for (const f of FIELDS[level] ?? []) if (patient[f] !== undefined) out[f] = patient[f];
  out.access = level;
  return out;
}

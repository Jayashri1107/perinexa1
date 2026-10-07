// Patients: registration (with a duplicate warning), lists, the record, changes and emergency access.
// Every opening of a record is written to the audit log (ids only – never medical details).
import { config } from '../../config/index.js';
import { nextNumber } from '../../db/counter.js';
import { lookupOne } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Membership } from '../members/membership.model.js';
import { User } from '../users/user.model.js';
import { EmergencyAccess, Patient } from './patient.model.js';
import { FIELDS, atLeast, listVisibility, recordLevel, roleLevel, viewOf } from './patientAccess.js';

const { numberPrefix, numberDigits, eddDays, emergencyAccessHours } = config.patients;
const DOCTOR = config.opd.doctorRole;
const DAY = 86400000;
const needsLmp = new Set(config.patients.careTypes.filter((c) => c.needsLmp).map((c) => c.key));

// Date of birth, or an approximate one from the age.
function birthFields({ birthDate, ageYears }) {
  if (birthDate) return { birthDate, birthDateApprox: false };
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - ageYears);
  return { birthDate: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), birthDateApprox: true };
}

export const eddFrom = (lmp) => (lmp ? new Date(lmp.getTime() + eddDays * DAY) : null);

// Active doctors of this hospital, for choosing her doctor.
export async function doctorOptions(hospitalId) {
  const rows = await Membership.aggregate([
    { $match: { hospitalId: toObjectId(hospitalId), isActive: true, roles: DOCTOR } },
    ...lookupOne({ from: User.collection.name, localField: 'userId', as: 'user', fields: ['name', 'isActive'] }),
    { $match: { 'user.isActive': true } },
    { $sort: { 'user.name': 1 } },
    { $project: { _id: 0, id: '$userId', name: '$user.name' } },
  ]);
  return rows.map((r) => ({ id: r.id.toString(), name: r.name }));
}

async function assertDoctor(hospitalId, doctorId) {
  if (!doctorId) return null;
  const ok = await Membership.exists({ hospitalId, userId: doctorId, isActive: true, roles: DOCTOR });
  if (!ok) throw fieldError('assignedDoctorId', 'Choose a doctor who works in this hospital.');
  return toObjectId(doctorId);
}

// Possible duplicates: the same phone number, or the same name.
export async function findDuplicates(hospitalId, { name, phone }, excludeId = null) {
  const or = [];
  if (phone) or.push({ phone });
  if (name) or.push({ nameKey: name.trim().toLowerCase() });
  if (!or.length) return [];
  const rows = await Patient.find({ hospitalId, $or: or, ...(excludeId && { _id: { $ne: excludeId } }) })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  return rows.map((p) => viewOf(p, 'contactRead'));
}

export async function register(req, { confirmDuplicate, ageYears, birthDate, lmp, ...data }) {
  const hospitalId = req.hospitalId;
  const duplicates = await findDuplicates(hospitalId, data);
  if (duplicates.length && !confirmDuplicate) {
    throw new HttpError(
      409,
      'A patient with the same name or phone is already registered. Check before registering again.',
      'POSSIBLE_DUPLICATE',
      undefined,
      { duplicates },
    );
  }
  const patient = await Patient.create({
    ...data,
    ...birthFields({ birthDate, ageYears }),
    lmp: lmp ?? null,
    edd: needsLmp.has(data.careType) ? eddFrom(lmp) : null,
    assignedDoctorId: await assertDoctor(hospitalId, data.assignedDoctorId),
    patientNumber: await nextNumber(hospitalId, 'patient', numberPrefix, numberDigits),
    hospitalId,
    registeredBy: req.user._id,
  });
  await recordAudit(req, duplicates.length ? 'PATIENT_REGISTERED_ANYWAY' : 'PATIENT_REGISTERED', {
    hospitalId,
    details: { patientId: patient._id.toString(), patientNumber: patient.patientNumber, ...(duplicates.length && { similar: duplicates.length }) },
  });
  return viewOf(patient.toObject(), recordLevel(req, patient));
}

export async function listPatients(req, q) {
  const general = roleLevel(req.membership);
  if (general === 'none') throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');

  const match = { hospitalId: toObjectId(req.hospitalId), ...listVisibility(req) };
  if (q.careType) match.careType = q.careType;
  if (q.status) match.status = q.status;
  if (q.doctorId) match.assignedDoctorId = q.doctorId;
  if (q.mine === 'true') match.assignedDoctorId = req.user._id;
  if (q.search) {
    const or = [{ nameKey: containsText(q.search) }, { patientNumber: new RegExp(`^${escapeRegex(q.search)}`, 'i') }];
    if (atLeast(general, 'contactRead')) or.push({ phone: new RegExp(escapeRegex(q.search)) });
    // keep the sensitive-record rule while searching
    match.$and = [...(match.$or ? [{ $or: match.$or }] : []), { $or: or }];
    delete match.$or;
  }

  const fields = Object.fromEntries(FIELDS[general].map((f) => [f, 1]));
  const result = await paginate(Patient, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [
      ...(atLeast(general, 'contactRead')
        ? lookupOne({ from: User.collection.name, localField: 'assignedDoctorId', as: 'doctor', fields: ['name'] })
        : []),
      { $project: { ...fields, doctor: 1 } },
    ],
  });
  result.items = result.items.map((p) => ({ ...viewOf(p, recordLevel(req, p)), doctor: p.doctor ? { id: String(p.doctor.id), name: p.doctor.name } : null }));
  return result;
}

async function activeEmergency(req, patientId) {
  return EmergencyAccess.findOne({ hospitalId: req.hospitalId, patientId, userId: req.user._id, expiresAt: { $gt: new Date() } }).lean();
}

// Loads a record with the level the person has on it; a record they may not see is "not found".
async function loadForUser(req, id) {
  const patient = await Patient.findOne({ _id: id, hospitalId: req.hospitalId });
  if (!patient) throw notFoundError('Patient');
  const emergency = await activeEmergency(req, patient._id);
  const level = recordLevel(req, patient, { emergency: Boolean(emergency) });
  if (level === 'none') throw notFoundError('Patient');
  return { patient, level, emergency };
}

export async function getPatient(req, id) {
  const { patient, level, emergency } = await loadForUser(req, id);
  await recordAudit(req, 'PATIENT_VIEWED', {
    hospitalId: req.hospitalId,
    details: { patientId: patient._id.toString(), ...(emergency && { emergency: true }), ...(req.membership.isSuperAdminAccess && { asSuperAdmin: true }) },
  });
  const doctor = atLeast(level, 'contactRead') && patient.assignedDoctorId ? await User.findById(patient.assignedDoctorId).select('name').lean() : null;
  const roles = req.membership.roles;
  return {
    patient: { ...viewOf(patient.toObject(), level), doctor: doctor ? { id: doctor._id.toString(), name: doctor.name } : null },
    can: {
      editContact: atLeast(level, 'contactEdit') && level !== 'clinicalRead',
      editClinical: level === 'full',
      changeStatus: level === 'full',
      emergencyAccess: roles.includes(DOCTOR) && level !== 'full',
    },
    emergencyUntil: emergency?.expiresAt ?? null,
  };
}

export async function updateContact(req, id, { ageYears, birthDate, lmp, ...data }) {
  const { patient, level } = await loadForUser(req, id);
  if (!(level === 'full' || level === 'contactEdit')) throw new HttpError(403, 'You can only read this record.', 'READ_ONLY');
  const changes = { ...data, ...birthFields({ birthDate, ageYears }), assignedDoctorId: await assertDoctor(req.hospitalId, data.assignedDoctorId) };
  if (lmp !== undefined && level === 'full') {
    changes.lmp = lmp;
    changes.edd = needsLmp.has(data.careType) ? eddFrom(lmp) : patient.edd;
  }
  const changed = Object.keys(changes).filter((k) => JSON.stringify(patient[k] ?? null) !== JSON.stringify(changes[k] ?? null));
  patient.set(changes);
  await patient.save();
  await recordAudit(req, 'PATIENT_UPDATED', { hospitalId: req.hospitalId, details: { patientId: id, part: 'contact', changed } });
  return getPatient(req, id);
}

export async function updateClinical(req, id, data) {
  const { patient, level } = await loadForUser(req, id);
  if (level !== 'full') throw new HttpError(403, 'Only her doctor or an RMO can change clinical details.', 'READ_ONLY');
  const changes = { ...data, lmp: data.lmp ?? null };
  // EDD: as given, or worked out from the LMP for care types that need it.
  changes.edd = data.edd ?? (needsLmp.has(data.careType) ? eddFrom(data.lmp) : null);
  const changed = Object.keys(changes).filter((k) => JSON.stringify(patient[k] ?? null) !== JSON.stringify(changes[k] ?? null));
  patient.set(changes);
  await patient.save();
  await recordAudit(req, 'PATIENT_UPDATED', { hospitalId: req.hospitalId, details: { patientId: id, part: 'clinical', changed } });
  return getPatient(req, id);
}

export async function setStatus(req, id, status) {
  const { patient, level } = await loadForUser(req, id);
  if (level !== 'full') throw new HttpError(403, 'Only her doctor or an RMO can close or reopen a record.', 'READ_ONLY');
  if (patient.status !== status) {
    patient.status = status;
    await patient.save();
    await recordAudit(req, status === 'closed' ? 'PATIENT_CLOSED' : 'PATIENT_REOPENED', { hospitalId: req.hospitalId, details: { patientId: id } });
  }
  return getPatient(req, id);
}

// A doctor opens a record that is not theirs, with a written reason, for a limited time.
export async function grantEmergencyAccess(req, id, reason) {
  if (!req.membership.roles.includes(DOCTOR)) throw new HttpError(403, 'Only doctors can use emergency access.', 'FORBIDDEN');
  const patient = await Patient.findOne({ _id: id, hospitalId: req.hospitalId });
  if (!patient) throw notFoundError('Patient');
  const expiresAt = new Date(Date.now() + emergencyAccessHours * 3600000);
  await EmergencyAccess.create({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, reason, expiresAt });
  // The reason is kept with the access record; the audit log has ids and the length of the access only.
  await recordAudit(req, 'PATIENT_EMERGENCY_ACCESS', { hospitalId: req.hospitalId, details: { patientId: id, hours: emergencyAccessHours } });
  return getPatient(req, id);
}

// For other modules (billing, pharmacy): a patient's name and number, if she belongs to this hospital.
export async function patientSummary(hospitalId, patientId) {
  const p = await Patient.findOne({ _id: patientId, hospitalId }).select('patientNumber name phone sex birthDate birthDateApprox assignedDoctorId').lean();
  if (!p) throw fieldError('patientId', 'Choose a patient of this hospital.');
  return { id: p._id, patientNumber: p.patientNumber, name: p.name, phone: p.phone, sex: p.sex, birthDate: p.birthDate, birthDateApprox: p.birthDateApprox, assignedDoctorId: p.assignedDoctorId };
}

// A quick search by name, number or phone – name and number only (billing and pharmacy pick a patient with it).
export async function pickPatients(hospitalId, search) {
  if (!search) return [];
  const rows = await Patient.find({
    hospitalId,
    status: 'active',
    $or: [{ nameKey: containsText(search) }, { patientNumber: new RegExp(`^${escapeRegex(search)}`, 'i') }, { phone: new RegExp(escapeRegex(search)) }],
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('patientNumber name')
    .lean();
  return rows.map((p) => ({ id: p._id.toString(), patientNumber: p.patientNumber, name: p.name }));
}

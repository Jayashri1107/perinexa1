// Visits and prescriptions (as in Perinexa's routes/visits.js). Who may do what, on top of the record access
// (patientAccess.js):
//  - read her visits: everyone who may read her record clinically (her doctor, other doctors read-only, RMOs, nurses);
//    the doctor's private note only for doctors and RMOs;
//  - start a visit and save the vitals: nurses, and anyone with full access to her record;
//  - findings, prescription, sign, "entered in error": her doctor or an RMO (full access, and a prescriber).
// A signed visit can no longer change: corrections are added below it. The prescription is checked against the
// hospital's APPROVED medicine safety list and the visit against the APPROVED red-flag rules (Clinic library).
// The audit log gets ids only – never medical details.
import { config } from '../../config/index.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { HttpError, notFoundError } from '../../core/httpError.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { Appointment } from '../appointments/appointment.model.js';
import { utcDay } from '../appointments/slots.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { approvedEntries } from '../library/library.service.js';
import { EmergencyAccess, Patient } from '../patients/patient.model.js';
import { atLeast, recordLevel } from '../patients/patientAccess.js';
import { notifyRoles } from '../notifications/notification.service.js';
import { User } from '../users/user.model.js';
import { medicineWarnings, needsReason } from './medicineSafety.js';
import { medicineOptions } from '../medicines/medicine.service.js';
import { evaluateRedFlags, redFlagFacts } from './redFlags.js';
import { Visit } from './visit.model.js';

const DAY = 86400000;
const DOCTOR = config.opd.doctorRole;
const NURSE = 'nurse';
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));
const isPrescriber = (req) => has(req, config.prescriberRoles);
const today = () => utcDay(todayLocal());

// ---------- Access ----------

async function loadPatient(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  const emergency = await EmergencyAccess.exists({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, expiresAt: { $gt: new Date() } });
  const level = recordLevel(req, patient, { emergency: Boolean(emergency) });
  if (!atLeast(level, 'clinicalRead')) throw notFoundError('Patient');
  return { patient, level };
}

const canDoVitals = (req, level) => level === 'full' || req.membership.roles.includes(NURSE);
const canDoClinical = (req, level) => level === 'full' && isPrescriber(req);

function can(req, level, visit, patient) {
  const open = visit.status === 'active' && !visit.signed;
  return {
    vitals: open && canDoVitals(req, level),
    details: open && canDoClinical(req, level),
    prescription: open && canDoClinical(req, level),
    sign: open && canDoClinical(req, level),
    cancel: open && canDoClinical(req, level),
    addition: visit.status === 'active' && Boolean(visit.signed) && (canDoClinical(req, level) || canDoVitals(req, level)),
    // signed or not: the medicines as they are now go to the pharmacy's list
    sendToPharmacy: visit.status === 'active' && canDoClinical(req, level) && (visit.prescription?.items?.length ?? 0) > 0,
    print: visit.status === 'active' && patient.status !== undefined,
  };
}

// ---------- Views ----------

const dayIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Weeks of pregnancy on a day, from her EDD.
export function weeksOn(edd, day) {
  if (!edd) return null;
  const days = Math.floor((utcDay(day) - (new Date(edd) - config.patients.eddDays * DAY)) / DAY);
  return days >= 0 ? Math.floor(days / 7) : null;
}

function visitView(req, v, { full = true } = {}) {
  const x = v.toObject ? v.toObject() : v;
  const { privateNote, ...details } = x.details ?? {};
  const out = {
    id: String(x._id),
    patientId: String(x.patientId),
    visitOn: dayIso(x.visitOn),
    careType: x.careType,
    status: x.status,
    cancelled: x.cancelled,
    signed: x.signed,
    createdByName: x.createdByName,
    createdAt: x.createdAt,
    diagnosis: x.details?.diagnosis ?? '',
    medicines: (x.prescription?.items ?? []).length,
  };
  if (!full) return out;
  return {
    ...out,
    vitals: x.vitals,
    // the private note: doctors and RMOs only
    details: { ...details, nextVisitOn: dayIso(details.nextVisitOn), ...(isPrescriber(req) && { privateNote }) },
    prescription: { ...x.prescription, items: (x.prescription?.items ?? []).map((i) => ({ ...i, id: String(i._id), _id: undefined })), warningReasons: isPrescriber(req) ? x.prescription?.warningReasons ?? [] : [] },
    pharmacy: x.pharmacy?.status ? x.pharmacy : { status: 'none' },
    additions: x.additions ?? [],
  };
}

// ---------- Lists ----------

export async function listVisits(req, patientId) {
  const { patient, level } = await loadPatient(req, patientId);
  const visits = await Visit.find({ hospitalId: req.hospitalId, patientId }).sort({ visitOn: -1, createdAt: -1 }).limit(100).lean();
  return {
    items: visits.map((v) => visitView(req, v, { full: false })),
    canStart: patient.status === 'active' && canDoVitals(req, level),
  };
}

// ---------- One visit ----------

async function loadVisit(req, patientId, visitId) {
  const { patient, level } = await loadPatient(req, patientId);
  const visit = await Visit.findOne({ hospitalId: req.hospitalId, patientId, _id: visitId });
  if (!visit) throw notFoundError('Visit');
  return { patient, level, visit };
}

// The checks of a visit: weeks, the red flags (approved rules) and the medicine warnings (approved list).
async function checksOf(req, patient, visit) {
  const [ruleSets, safetyLists, previous, labOrders] = await Promise.all([
    approvedEntries(req.hospitalId, 'red_flag_rules'),
    approvedEntries(req.hospitalId, 'medicine_safety'),
    Visit.findOne({ hospitalId: req.hospitalId, patientId: patient._id, status: 'active', _id: { $ne: visit._id }, visitOn: { $lt: visit.visitOn }, 'vitals.weightKg': { $ne: null } }).sort({ visitOn: -1 }).lean(),
    LabOrder.find({ hospitalId: req.hospitalId, patientId: patient._id, status: { $in: ['reported', 'reviewed'] } }).sort({ 'reported.at': -1 }).limit(20).lean(),
  ]);
  const weeks = patient.careType === 'antenatal' ? weeksOn(patient.edd, visit.visitOn) : null;
  const rules = ruleSets.flatMap((e) => e.content.rules ?? []);
  const facts = redFlagFacts({ visit, previous, labOrders, edd: patient.careType === 'antenatal' ? patient.edd : null, since: new Date(visit.visitOn.getTime() - 120 * DAY) });
  const list = safetyLists.flatMap((e) => e.content.entries ?? []);
  const babyAgeDays = patient.careType === 'newborn' && patient.birthDate ? Math.floor((utcDay(visit.visitOn) - utcDay(patient.birthDate)) / DAY) : null;
  return {
    weeks,
    redFlags: ruleSets.length ? evaluateRedFlags(rules, facts, { careType: patient.careType, weeks }) : [],
    redFlagRulesApproved: ruleSets.length > 0,
    medicineSafetyApproved: safetyLists.length > 0,
    warnings: medicineWarnings({
      items: visit.prescription?.items ?? [],
      list,
      weeks,
      pregnant: patient.careType === 'antenatal',
      breastfeeding: patient.careType === 'postnatal',
      newborn: patient.careType === 'newborn',
      babyAgeDays,
      allergies: patient.allergies,
    }),
    list,
  };
}

async function fullAnswer(req, { patient, level, visit }) {
  const { list, ...checks } = await checksOf(req, patient, visit);
  const [doctor, hospital] = await Promise.all([
    // the doctor printed on the prescription: who wrote it, else her doctor
    visit.prescription?.by ?? visit.doctorId ? User.findById(visit.prescription?.by ?? visit.doctorId).select('name professional').lean() : null,
    Hospital.findById(req.hospitalId).select('name letterhead logoVersion').lean(),
  ]);
  return {
    print: { hospitalName: hospital?.name ?? '', letterhead: { ...(hospital?.letterhead ?? {}), logoVersion: hospital?.logoVersion ?? 0 } },
    visit: visitView(req, visit),
    patient: { id: String(patient._id), name: patient.name, patientNumber: patient.patientNumber, careType: patient.careType, edd: patient.edd, allergies: patient.allergies ?? '', bloodGroup: patient.bloodGroup ?? '', status: patient.status },
    doctor: doctor ? { name: doctor.name, ...doctor.professional } : null,
    checks,
    can: can(req, level, visit, patient),
  };
}

export async function getVisit(req, patientId, visitId) {
  const loaded = await loadVisit(req, patientId, visitId);
  await recordAudit(req, 'VISIT_VIEWED', { hospitalId: req.hospitalId, details: { patientId, visitId } });
  return fullAnswer(req, loaded);
}

export async function startVisit(req, patientId, { clientRequestId }) {
  const { patient, level } = await loadPatient(req, patientId);
  if (!canDoVitals(req, level)) throw new HttpError(403, 'Her doctor, an RMO or a nurse starts a visit.', 'FORBIDDEN');
  if (patient.status !== 'active') throw new HttpError(409, 'Her record is closed. Reopen it first.', 'CLOSED');
  const same = await Visit.findOne({ hospitalId: req.hospitalId, clientRequestId });
  if (same) return fullAnswer(req, { patient, level, visit: same });
  const visit = await Visit.create({
    hospitalId: req.hospitalId,
    patientId: patient._id,
    visitOn: today(),
    careType: patient.careType,
    doctorId: patient.assignedDoctorId ?? (req.membership.roles.includes(DOCTOR) ? req.user._id : null),
    clientRequestId,
    createdBy: req.user._id,
    createdByName: req.user.name,
  });
  // She is seen: her appointment today (arrived) is marked seen.
  await Appointment.updateMany(
    { hospitalId: req.hospitalId, patientId: patient._id, on: today(), status: 'arrived' },
    { $set: { status: 'seen', seenAt: new Date(), updatedBy: req.user._id } },
  );
  await recordAudit(req, 'VISIT_STARTED', { hospitalId: req.hospitalId, details: { patientId, visitId: String(visit._id) } });
  return fullAnswer(req, { patient, level, visit });
}

function assertOpen(visit) {
  if (visit.status !== 'active') throw new HttpError(409, 'This visit was marked as entered in error.', 'CANCELLED');
  if (visit.signed) throw new HttpError(409, 'This visit is signed: add a correction below it instead.', 'SIGNED');
}
function assertRev(part, rev) {
  if (part.rev !== rev) throw new HttpError(409, 'Someone else saved this part a moment ago. Reload to see their changes.', 'STALE');
}
const savedBy = (req, part) => ({ rev: part.rev + 1, by: req.user._id, byName: req.user.name, at: new Date() });

export async function saveVitals(req, patientId, visitId, { rev, ...data }) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level } = loaded;
  if (!canDoVitals(req, level)) throw new HttpError(403, 'Nurses, her doctor or an RMO record the vitals.', 'FORBIDDEN');
  assertOpen(visit);
  assertRev(visit.vitals, rev);
  visit.vitals = { ...data, ...savedBy(req, visit.vitals) };
  await visit.save();
  await recordAudit(req, 'VISIT_UPDATED', { hospitalId: req.hospitalId, details: { patientId, visitId, part: 'vitals' } });
  return fullAnswer(req, loaded);
}

// A next visit gets a booking with her doctor that still needs a time (reception gives it one), unless she already
// has an appointment that day.
async function bookNextVisit(req, patient, visit, nextVisitOn) {
  if (!nextVisitOn) return;
  const on = utcDay(nextVisitOn);
  if (on <= today()) return;
  const doctorId = visit.doctorId ?? (req.membership.roles.includes(DOCTOR) ? req.user._id : null);
  if (!doctorId) return;
  const booked = await Appointment.exists({ hospitalId: req.hospitalId, patientId: patient._id, on, status: { $ne: 'cancelled' } });
  if (booked) return;
  const appt = await Appointment.create({ hospitalId: req.hospitalId, patientId: patient._id, doctorId, on, kind: 'slot', start: null, visitType: 'follow_up', source: 'booked', createdBy: req.user._id });
  await recordAudit(req, 'APPOINTMENT_BOOKED', { hospitalId: req.hospitalId, details: { appointmentId: String(appt._id), patientId: String(patient._id), fromVisit: String(visit._id) } });
}

export async function saveDetails(req, patientId, visitId, { rev, ...data }) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level, patient } = loaded;
  if (!canDoClinical(req, level)) throw new HttpError(403, 'Her doctor or an RMO writes the findings.', 'FORBIDDEN');
  assertOpen(visit);
  assertRev(visit.details, rev);
  const nextVisitOn = data.nextVisitOn ? utcDay(data.nextVisitOn) : null;
  if (nextVisitOn && nextVisitOn <= today()) throw new HttpError(400, 'The next visit must be after today.', 'VALIDATION', { nextVisitOn: 'Choose a day after today.' });
  const before = visit.details.nextVisitOn ? dayIso(visit.details.nextVisitOn) : null;
  visit.details = { ...data, nextVisitOn, ...savedBy(req, visit.details) };
  await visit.save();
  if (data.nextVisitOn && data.nextVisitOn !== before) await bookNextVisit(req, patient, visit, data.nextVisitOn);
  await recordAudit(req, 'VISIT_UPDATED', { hospitalId: req.hospitalId, details: { patientId, visitId, part: 'details' } });
  return fullAnswer(req, loaded);
}

// ---------- Writing a prescription: medicine names and her last prescription (owner, 10 Oct 2026) ----------

// The pharmacy's medicine forms as the prescription's forms.
const RX_FORM_OF = { tablet: 'tab', capsule: 'cap', syrup: 'syrup', injection: 'inj', drops: 'drops', cream: 'cream', sachet: 'sachet', other: 'other' };

// Medicine names from the hospital's medicine list, for the prescriber to pick (name, strength, form, in stock or not –
// no prices or batches). A name not on the list can still be written by hand.
export async function prescribeMedicines(req, search) {
  if (!isPrescriber(req)) throw new HttpError(403, 'Doctors and RMOs write prescriptions.', 'FORBIDDEN');
  const rows = await medicineOptions(req.hospitalId, search);
  return { items: rows.map((m) => ({ id: m.id, name: m.name, strength: m.strength ?? '', form: RX_FORM_OF[m.form] ?? 'other', inStock: (m.available ?? 0) > 0 })) };
}

// Her latest earlier prescription (another visit, not entered in error), to copy as a starting point.
export async function previousPrescription(req, patientId, visitId) {
  const { visit, level } = await loadVisit(req, patientId, visitId);
  if (!canDoClinical(req, level)) throw new HttpError(403, 'Her doctor or an RMO writes the prescription.', 'FORBIDDEN');
  const prev = await Visit.findOne({ hospitalId: req.hospitalId, patientId, status: 'active', _id: { $ne: visit._id }, visitOn: { $lte: visit.visitOn }, 'prescription.items.0': { $exists: true } })
    .sort({ visitOn: -1, createdAt: -1 })
    .lean();
  return {
    visitOn: prev?.visitOn ?? null,
    items: (prev?.prescription?.items ?? []).map(({ _id, ...i }) => i),
    notes: prev?.prescription?.notes ?? '',
  };
}

export async function savePrescription(req, patientId, visitId, { rev, items, notes, reasons }) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level, patient } = loaded;
  if (!canDoClinical(req, level)) throw new HttpError(403, 'Her doctor or an RMO writes the prescription.', 'FORBIDDEN');
  assertOpen(visit);
  assertRev(visit.prescription, rev);
  // The safety check on what is about to be saved: Avoid and Allergy warnings need a reason to go ahead.
  const { list, weeks } = await checksOf(req, patient, visit);
  const warnings = medicineWarnings({
    items,
    list,
    weeks,
    pregnant: patient.careType === 'antenatal',
    breastfeeding: patient.careType === 'postnatal',
    newborn: patient.careType === 'newborn',
    allergies: patient.allergies,
  });
  const missing = warnings.filter((w) => needsReason(w) && (reasons[w.key] ?? '').length < 3);
  if (missing.length) {
    throw new HttpError(409, 'Some medicines need a reason to go ahead (Avoid or Allergy warning).', 'NEEDS_REASON', undefined, { warnings: missing });
  }
  visit.prescription = {
    items,
    notes,
    warningReasons: warnings.filter(needsReason).map((w) => ({ key: w.key, level: w.level, title: w.title, medicines: w.medicines, reason: reasons[w.key] })),
    ...savedBy(req, visit.prescription),
  };
  await visit.save();
  await recordAudit(req, 'PRESCRIPTION_SAVED', { hospitalId: req.hospitalId, details: { patientId, visitId, medicines: items.length, ...(visit.prescription.warningReasons.length && { wentAhead: visit.prescription.warningReasons.length }) } });
  return fullAnswer(req, loaded);
}

export async function signVisit(req, patientId, visitId) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level } = loaded;
  if (!canDoClinical(req, level)) throw new HttpError(403, 'Her doctor or an RMO signs the visit.', 'FORBIDDEN');
  assertOpen(visit);
  const role = req.membership.roles.includes(DOCTOR) ? DOCTOR : 'rmo';
  visit.signed = { by: req.user._id, byName: req.user.name, role, at: new Date() };
  await visit.save();
  await recordAudit(req, 'VISIT_SIGNED', { hospitalId: req.hospitalId, details: { patientId, visitId } });
  return fullAnswer(req, loaded);
}

export async function cancelVisit(req, patientId, visitId, reason) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level } = loaded;
  if (!canDoClinical(req, level)) throw new HttpError(403, 'Her doctor or an RMO marks a visit as entered in error.', 'FORBIDDEN');
  assertOpen(visit);
  visit.set({ status: 'cancelled', cancelled: { reason, by: req.user._id, byName: req.user.name, at: new Date() } });
  await visit.save();
  await recordAudit(req, 'VISIT_CANCELLED', { hospitalId: req.hospitalId, details: { patientId, visitId } });
  return fullAnswer(req, loaded);
}

export async function addAddition(req, patientId, visitId, text) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level } = loaded;
  if (!can(req, level, visit, loaded.patient).addition) throw new HttpError(403, 'Additions are written below a signed visit by those who work on her record.', 'FORBIDDEN');
  visit.additions.push({ text, by: req.user._id, byName: req.user.name, at: new Date() });
  await visit.save();
  await recordAudit(req, 'VISIT_ADDITION', { hospitalId: req.hospitalId, details: { patientId, visitId } });
  return fullAnswer(req, loaded);
}

// ---------- Send to the pharmacy ----------

// Her doctor or an RMO sends the prescription to the pharmacy: it waits on the pharmacy's Prescriptions tab, and the
// pharmacists get a notification (her name and number and how many medicines – never the diagnosis).
export async function sendToPharmacy(req, patientId, visitId) {
  const loaded = await loadVisit(req, patientId, visitId);
  const { visit, level, patient } = loaded;
  if (!can(req, level, visit, patient).sendToPharmacy) {
    throw new HttpError(403, visit.prescription?.items?.length ? 'Her doctor or an RMO sends the prescription to the pharmacy.' : 'Save at least one medicine first.', 'FORBIDDEN');
  }
  visit.pharmacy = { status: 'sent', sentAt: new Date(), sentByName: req.user.name, givenAt: null, givenByName: null, invoiceNumber: null };
  await visit.save();
  await recordAudit(req, 'PRESCRIPTION_SENT', { hospitalId: req.hospitalId, details: { patientId, visitId, medicines: visit.prescription.items.length } });
  const count = visit.prescription.items.length;
  // the pharmacy and the front desk (config.access.dispense) – the link opens "Give prescription"
  await notifyRoles(req, config.access.dispense, {
    type: 'PRESCRIPTION_SENT',
    title: 'Prescription to give',
    message: `${patient.name} (${patient.patientNumber}) · ${count} ${count === 1 ? 'medicine' : 'medicines'} · from ${req.user.name}`,
    link: `/hospital/dispensing/${visit._id}`,
  });
  return fullAnswer(req, loaded);
}

// ---------- For the prescription form ----------

// The approved prescription sets for this patient's type of care, and the approved medicine safety list's status.
export async function prescriptionSets(req, careType) {
  if (!isPrescriber(req)) throw new HttpError(403, 'Prescription sets are for those who write prescriptions.', 'FORBIDDEN');
  const sets = await approvedEntries(req.hospitalId, 'prescription_set');
  return sets
    .filter((s) => !s.careTypes?.length || !careType || s.careTypes.includes(careType))
    .map((s) => ({ key: s.key, name: s.name, items: s.content.items, notes: s.content.notes, investigations: s.content.investigations, advice: s.content.advice }));
}

// ---------- For the pharmacy ----------

// Her latest prescriptions, to sell from: the medicines only, with the doctor and the date – no findings, no
// diagnosis (the pharmacist needs only what to give).
const pharmacyItems = (v) =>
  v.prescription.items.map((i) => ({ drug: i.drug, form: i.form, strength: i.strength, dose: i.dose, frequency: i.frequency, frequencyText: i.frequencyText, timing: i.timing, durationValue: i.durationValue, durationUnit: i.durationUnit }));

export async function prescriptionsForPharmacy(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).select('_id').lean();
  if (!patient) throw notFoundError('Patient');
  const visits = await Visit.find({ hospitalId: req.hospitalId, patientId, status: 'active', 'prescription.items.0': { $exists: true } }).sort({ visitOn: -1, createdAt: -1 }).limit(5).lean();
  return visits.map((v) => ({
    visitId: String(v._id),
    visitOn: dayIso(v.visitOn),
    doctor: v.prescription.byName,
    pharmacyStatus: v.pharmacy?.status ?? 'none',
    items: pharmacyItems(v),
  }));
}

// The pharmacy's Prescriptions tab: what doctors sent and is still to give (oldest first), and what was given today.
export async function pharmacyQueue(req) {
  const hid = toObjectId(req.hospitalId);
  const [start] = dayRange(todayLocal());
  const [waiting, given] = await Promise.all([
    Visit.find({ hospitalId: hid, status: 'active', 'pharmacy.status': 'sent' }).sort({ 'pharmacy.sentAt': 1 }).limit(100).lean(),
    Visit.find({ hospitalId: hid, status: 'active', 'pharmacy.status': 'given', 'pharmacy.givenAt': { $gte: start } }).sort({ 'pharmacy.givenAt': -1 }).limit(100).lean(),
  ]);
  const ids = [...new Set([...waiting, ...given].map((v) => String(v.patientId)))];
  const patients = await Patient.find({ hospitalId: hid, _id: { $in: ids } }).select('name patientNumber').lean();
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const row = (v) => {
    const p = byId.get(String(v.patientId));
    return {
      visitId: String(v._id),
      patient: { id: String(v.patientId), name: p?.name ?? '', patientNumber: p?.patientNumber ?? '' },
      visitOn: dayIso(v.visitOn),
      doctor: v.prescription.byName,
      items: pharmacyItems(v),
      ...v.pharmacy,
    };
  };
  return { waiting: waiting.map(row), givenToday: given.map(row) };
}

// Every prescription given (owner, 9 Oct 2026) – not only today's: newest first, a page at a time, found by the
// patient's name or number and by the day it was given (on the hospital's clock).
export async function pharmacyHistory(req, { search = '', from = null, to = null, page = 1, limit = 20 }) {
  const hid = toObjectId(req.hospitalId);
  const match = { hospitalId: hid, status: 'active', 'pharmacy.status': 'given' };
  if (from || to) {
    match['pharmacy.givenAt'] = {};
    if (from) match['pharmacy.givenAt'].$gte = dayRange(from)[0];
    if (to) match['pharmacy.givenAt'].$lt = dayRange(to)[1];
  }
  if (search.trim()) {
    const found = await Patient.find({ hospitalId: hid, $or: [{ nameKey: containsText(search.trim()) }, { patientNumber: new RegExp(`^${escapeRegex(search.trim())}`, 'i') }] }).select('_id').limit(500).lean();
    match.patientId = { $in: found.map((p) => p._id) };
  }
  const [total, rows] = await Promise.all([
    Visit.countDocuments(match),
    Visit.find(match).sort({ 'pharmacy.givenAt': -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const patients = await Patient.find({ hospitalId: hid, _id: { $in: rows.map((v) => v.patientId) } }).select('name patientNumber').lean();
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  return {
    items: rows.map((v) => {
      const p = byId.get(String(v.patientId));
      return { visitId: String(v._id), patient: { id: String(v.patientId), name: p?.name ?? '', patientNumber: p?.patientNumber ?? '' }, visitOn: dayIso(v.visitOn), doctor: v.prescription.byName, items: pharmacyItems(v), ...v.pharmacy };
    }),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

// The pharmacist gives it (sold at the counter, or given another way): it leaves the waiting list.
export async function markGiven(req, visitId, invoiceNumber = null) {
  const done = await Visit.findOneAndUpdate(
    { hospitalId: req.hospitalId, _id: visitId, 'pharmacy.status': 'sent' },
    { $set: { 'pharmacy.status': 'given', 'pharmacy.givenAt': new Date(), 'pharmacy.givenByName': req.user.name, 'pharmacy.invoiceNumber': invoiceNumber } },
  );
  if (!done) return false;
  await recordAudit(req, 'PRESCRIPTION_GIVEN', { hospitalId: req.hospitalId, details: { patientId: String(done.patientId), visitId: String(visitId), ...(invoiceNumber && { invoiceNumber }) } });
  return true;
}

// ---------- For Today ----------

// A doctor's visits today that are not signed yet.
export async function unsignedToday(hospitalId, userId) {
  return Visit.countDocuments({ hospitalId: toObjectId(hospitalId), visitOn: today(), status: 'active', signed: null, $or: [{ doctorId: userId }, { createdBy: userId }] });
}

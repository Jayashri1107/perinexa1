// Inpatients (as in Perinexa's routes/admissions.js and routes/inpatients.js). Who may do what, on top of the record
// access (patientAccess.js):
//  - the ward list and a stay: doctors, RMOs and nurses, for records they may read clinically;
//  - admit, write documents: her doctor or an RMO (full access); sign: as SIGNED_BY says, with full access;
//  - change the ward or bed, and the nursing chart: nurses too;
//  - the pharmacist issues medicines to a stay (charged to her hospital bill) and sees who is in hospital by name,
//    number, ward and bed only.
// Signing the discharge card discharges her; its follow-up date books a needs-a-time appointment.
// The audit log gets ids only – never medical details.
import { config } from '../../config/index.js';
import { nextNumber } from '../../db/counter.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { parse, toObjectId } from '../../core/validate.js';
import { Appointment } from '../appointments/appointment.model.js';
import { utcDay } from '../appointments/slots.js';
import { recordAudit } from '../audit/audit.service.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { approvedEntries } from '../library/library.service.js';
import { EmergencyAccess, Patient } from '../patients/patient.model.js';
import { atLeast, listVisibility, recordLevel } from '../patients/patientAccess.js';
import { sell } from '../sales/sale.service.js';
import { evaluateRedFlags, redFlagFacts } from '../visits/redFlags.js';
import { weeksOn } from '../visits/visit.service.js';
import { Membership } from '../members/membership.model.js';
import { notify, notifyRoles } from '../notifications/notification.service.js';
import { User } from '../users/user.model.js';
import { assertFreeBed } from '../wards/ward.service.js';
import { Admission, InpatientDocument, NursingEntry, SIGNED_BY } from './admission.model.js';
import { DOC_CONTENT, dischargeMedicine } from './admission.validation.js';
import { z } from 'zod';

// The content of a ward document, checked. Errors are named "content.<field>", as the form names its fields.
// draft: a draft may be incomplete – empty fields are left out and required ones may be missing (they are checked
// when it is signed); medicine rows with no medicine name are dropped.
function checkContent(kind, content, { draft = false } = {}) {
  let schema = DOC_CONTENT[kind];
  let data = content ?? {};
  if (draft) {
    data = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    if (Array.isArray(data.medicines)) data.medicines = data.medicines.filter((m) => String(m?.drug ?? '').trim());
    if (typeof schema.partial === 'function') schema = schema.partial();
    if (kind === 'discharge') schema = schema.extend({ medicines: z.array(dischargeMedicine.partial().required({ drug: true })).max(40).optional() });
  }
  return parse(z.object({ content: schema }), { content: data }).content;
}

// The follow-up doctor's name kept with the discharge summary (for the printed summary).
async function withDoctorName(kind, content) {
  if (kind !== 'discharge' || !content.followUpDoctorId) return content;
  const d = await User.findById(content.followUpDoctorId).select('name').lean();
  return { ...content, followUpDoctorName: d?.name ?? '' };
}

const DOCTOR = config.opd.doctorRole;
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));
const isPrescriber = (req) => has(req, config.prescriberRoles);
const isNurse = (req) => req.membership.roles.includes('nurse');
const stamp = (req, extra = {}) => ({ by: req.user._id, byName: req.user.name, at: new Date(), ...extra });

async function loadPatient(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  const emergency = await EmergencyAccess.exists({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, expiresAt: { $gt: new Date() } });
  const level = recordLevel(req, patient, { emergency: Boolean(emergency) });
  if (!atLeast(level, 'clinicalRead')) throw notFoundError('Patient');
  return { patient, level };
}

async function loadStay(req, admissionId) {
  const stay = await Admission.findOne({ hospitalId: req.hospitalId, _id: admissionId });
  if (!stay) throw notFoundError('Stay');
  const { patient, level } = await loadPatient(req, stay.patientId);
  return { stay, patient, level };
}

const canWrite = (req, level) => level === 'full' && isPrescriber(req);
const canNurse = (req, level) => level === 'full' || isNurse(req);

// ---------- The ward list ----------

// Who is in hospital now (records this person may read clinically), with each stay's drafts and red flags.
export async function inpatients(req) {
  const hid = toObjectId(req.hospitalId);
  const stays = await Admission.find({ hospitalId: hid, status: 'admitted' }).sort({ ward: 1, bed: 1 }).lean();
  const visibility = listVisibility(req);
  const patients = await Patient.find({ hospitalId: hid, _id: { $in: stays.map((s) => s.patientId) }, ...visibility }).lean();
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const rules = (await approvedEntries(req.hospitalId, 'red_flag_rules')).flatMap((e) => e.content.rules ?? []);
  const out = [];
  for (const s of stays) {
    const p = byId.get(String(s.patientId));
    if (!p || !atLeast(recordLevel(req, p), 'clinicalRead')) continue;
    const [drafts, flags] = await Promise.all([
      InpatientDocument.countDocuments({ hospitalId: hid, admissionId: s._id, status: 'draft' }),
      rules.length ? stayFlags(req, s, p, rules) : [],
    ]);
    out.push({
      id: String(s._id),
      patient: { id: String(p._id), name: p.name, patientNumber: p.patientNumber, careType: p.careType },
      ward: s.ward,
      bed: s.bed,
      reason: s.reason,
      admittedAt: s.admittedAt,
      drafts,
      redFlags: flags.map((f) => ({ label: f.label, level: f.level })),
    });
  }
  await recordAudit(req, 'INPATIENTS_VIEWED', { hospitalId: req.hospitalId, details: { admitted: out.length, flagged: out.filter((s) => s.redFlags.length).length } });
  return { items: out, rulesApproved: rules.length > 0 };
}

// The red flags of a stay: the latest nursing vitals and her recent lab results (approved rules only).
async function stayFlags(req, stay, patient, rules) {
  const [latest, labOrders] = await Promise.all([
    NursingEntry.findOne({ hospitalId: req.hospitalId, admissionId: stay._id, kind: 'vitals', cancelled: null }).sort({ at: -1 }).lean(),
    LabOrder.find({ hospitalId: req.hospitalId, patientId: patient._id, status: { $in: ['reported', 'reviewed'] }, 'reported.at': { $gte: stay.admittedAt } }).sort({ 'reported.at': -1 }).limit(20).lean(),
  ]);
  const visit = latest ? { visitOn: latest.at, vitals: latest.vitals, details: {} } : null;
  const facts = redFlagFacts({ visit, labOrders, edd: patient.careType === 'antenatal' ? patient.edd : null, since: stay.admittedAt });
  const weeks = patient.careType === 'antenatal' ? weeksOn(patient.edd, new Date()) : null;
  return evaluateRedFlags(rules, facts, { careType: patient.careType, weeks });
}

// ---------- A stay ----------

const docView = (d) => ({
  id: String(d._id),
  kind: d.kind,
  status: d.status,
  content: d.content,
  rev: d.rev,
  createdByName: d.createdByName,
  createdAt: d.createdAt,
  savedByName: d.savedByName,
  savedAt: d.savedAt,
  signed: d.signed,
  readyForReview: d.readyForReview ?? null,
  cancelled: d.cancelled,
  additions: d.additions ?? [],
});

async function stayAnswer(req, { stay, patient, level }) {
  const [docs, nursing, rules, doctor] = await Promise.all([
    InpatientDocument.find({ hospitalId: req.hospitalId, admissionId: stay._id }).sort({ createdAt: 1 }).lean(),
    NursingEntry.find({ hospitalId: req.hospitalId, admissionId: stay._id }).sort({ at: -1 }).limit(200).lean(),
    approvedEntries(req.hospitalId, 'red_flag_rules').then((e) => e.flatMap((x) => x.content.rules ?? [])),
    stay.doctorId ? User.findById(stay.doctorId).select('name').lean() : null,
  ]);
  const open = stay.status === 'admitted';
  return {
    stay: {
      id: String(stay._id),
      admissionNumber: stay.admissionNumber ?? '',
      doctorId: stay.doctorId ? String(stay.doctorId) : null,
      doctorName: doctor?.name ?? '',
      status: stay.status,
      wardId: stay.wardId ? String(stay.wardId) : null,
      ward: stay.ward,
      bed: stay.bed,
      reason: stay.reason,
      admittedAt: stay.admittedAt,
      admittedByName: stay.admittedByName,
      dischargedAt: stay.dischargedAt,
      dischargedByName: stay.dischargedByName,
    },
    patient: { id: String(patient._id), name: patient.name, patientNumber: patient.patientNumber, careType: patient.careType, allergies: patient.allergies ?? '', bloodGroup: patient.bloodGroup ?? '', sex: patient.sex, birthDate: patient.birthDate, birthDateApprox: patient.birthDateApprox },
    documents: docs.map(docView),
    nursing: nursing.map((n) => ({ id: String(n._id), kind: n.kind, at: n.at, vitals: n.vitals, medicine: n.medicine, note: n.note, byName: n.byName, cancelled: n.cancelled, mine: String(n.by) === String(req.user._id) })),
    redFlags: rules.length && open ? await stayFlags(req, stay, patient, rules) : [],
    rulesApproved: rules.length > 0,
    can: {
      write: open && canWrite(req, level),
      bed: open && canNurse(req, level),
      nursing: open && canNurse(req, level),
      sign: Object.fromEntries(Object.entries(SIGNED_BY).map(([k, roles]) => [k, level === 'full' && has(req, roles)])),
    },
  };
}

export async function stayOf(req, admissionId) {
  const loaded = await loadStay(req, admissionId);
  await recordAudit(req, 'ADMISSION_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), admissionId } });
  return stayAnswer(req, loaded);
}

// ---------- The front desk (owner, 8 Oct 2026): reception admits patients ----------
// Reception (config.access.admitPatients without a clinical role) admits a patient – choosing her doctor, ward and
// bed – and sees her stays as dates, numbers, ward and bed only: never the notes, documents or nursing chart.
const isFrontDesk = (req) => has(req, config.access.admitPatients) && !has(req, config.access.patientsClinical);

async function loadForFrontDesk(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  if (!atLeast(recordLevel(req, patient), 'contactEdit')) throw notFoundError('Patient');
  return { patient, level: 'contactEdit' };
}

const frontDeskStay = (s) => ({
  id: String(s._id),
  admissionNumber: s.admissionNumber ?? '',
  status: s.status,
  ward: s.ward,
  bed: s.bed,
  reason: s.reason,
  admittedAt: s.admittedAt,
  dischargedAt: s.dischargedAt,
});

async function assertHospitalDoctor(hospitalId, doctorId) {
  if (!doctorId) return null;
  const ok = await Membership.exists({ hospitalId, userId: doctorId, isActive: true, roles: DOCTOR });
  if (!ok) throw fieldError('doctorId', 'Choose a doctor who works in this hospital.');
  return toObjectId(doctorId);
}

// Who is in hospital now, and who went home today – for reception: name, number, admission number, ward, bed, doctor.
export async function frontDeskInpatients(req) {
  const hid = toObjectId(req.hospitalId);
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const stays = await Admission.find({ hospitalId: hid, $or: [{ status: 'admitted' }, { dischargedAt: { $gte: dayStart } }] })
    .sort({ status: 1, ward: 1, bed: 1 })
    .limit(500)
    .lean();
  const [patients, doctors] = await Promise.all([
    Patient.find({ hospitalId: hid, _id: { $in: stays.map((s) => s.patientId) } }).select('name patientNumber').lean(),
    User.find({ _id: { $in: stays.map((s) => s.doctorId).filter(Boolean) } }).select('name').lean(),
  ]);
  const pById = new Map(patients.map((p) => [String(p._id), p]));
  const dById = new Map(doctors.map((d) => [String(d._id), d.name]));
  await recordAudit(req, 'INPATIENTS_VIEWED', { hospitalId: req.hospitalId, details: { admitted: stays.filter((s) => s.status === 'admitted').length, frontDesk: true } });
  return {
    items: stays.map((s) => ({
      ...frontDeskStay(s),
      patient: { id: String(s.patientId), name: pById.get(String(s.patientId))?.name ?? '', patientNumber: pById.get(String(s.patientId))?.patientNumber ?? '' },
      doctorName: s.doctorId ? (dById.get(String(s.doctorId)) ?? '') : '',
    })),
  };
}

export async function staysOfPatient(req, patientId) {
  const frontDesk = isFrontDesk(req);
  const { patient, level } = frontDesk ? await loadForFrontDesk(req, patientId) : await loadPatient(req, patientId);
  const stays = await Admission.find({ hospitalId: req.hospitalId, patientId }).sort({ admittedAt: -1 }).limit(30).lean();
  return {
    items: stays.map(frontDeskStay),
    canAdmit: patient.status === 'active' && (frontDesk || canWrite(req, level)) && !stays.some((s) => s.status === 'admitted'),
    canOpen: !frontDesk, // reception does not open the stay itself (notes, documents, nursing chart)
  };
}

export async function admit(req, body) {
  const frontDesk = isFrontDesk(req);
  const { patient, level } = frontDesk ? await loadForFrontDesk(req, body.patientId) : await loadPatient(req, body.patientId);
  if (!frontDesk && !canWrite(req, level)) throw new HttpError(403, 'Her doctor, an RMO or reception admits her.', 'FORBIDDEN');
  if (patient.status !== 'active') throw new HttpError(409, 'Her record is closed. Reopen it first.', 'CLOSED');
  const same = await Admission.findOne({ hospitalId: req.hospitalId, clientRequestId: body.clientRequestId });
  if (same) return frontDesk ? { stay: frontDeskStay(same) } : stayAnswer(req, { stay: same, patient, level });
  const doctorId = (await assertHospitalDoctor(req.hospitalId, body.doctorId)) ?? patient.assignedDoctorId ?? null;
  const ward = await assertFreeBed(req.hospitalId, body.wardId, body.bed);
  if (await Admission.exists({ hospitalId: req.hospitalId, patientId: patient._id, status: 'admitted' })) throw new HttpError(409, 'She is already in hospital.', 'ALREADY_ADMITTED');
  const stay = await Admission.create({
    hospitalId: req.hospitalId,
    patientId: patient._id,
    admissionNumber: await nextNumber(req.hospitalId, 'admission', config.admissions.admissionPrefix, config.admissions.numberDigits),
    careType: patient.careType,
    admittedAt: body.admittedAt,
    wardId: ward._id,
    ward: ward.name,
    bed: body.bed,
    reason: body.reason,
    doctorId,
    admittedBy: req.user._id,
    admittedByName: req.user.name,
    clientRequestId: body.clientRequestId,
  });
  await recordAudit(req, 'ADMITTED', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), admissionId: String(stay._id), ...(frontDesk && { byReception: true }) } });
  const admitted = { type: 'NEW_ADMISSION', title: 'New admission', message: `${patient.name} (${patient.patientNumber}) · ${stay.ward}${stay.bed ? `, bed ${stay.bed}` : ''}` };
  await notify(req, [doctorId], { ...admitted, link: `/hospital/inpatients/${stay._id}` });
  await notifyRoles(req, ['nurse'], { ...admitted, link: `/hospital/inpatients/${stay._id}` });
  if (!frontDesk) await notifyRoles(req, config.access.registrationMenu, { ...admitted, link: '/hospital/admissions' });
  return frontDesk ? { stay: frontDeskStay(stay) } : stayAnswer(req, { stay, patient, level });
}

export async function moveBed(req, admissionId, { wardId, bed }) {
  const loaded = await loadStay(req, admissionId);
  if (loaded.stay.status !== 'admitted' || !canNurse(req, loaded.level)) throw new HttpError(403, 'You cannot change this stay.', 'FORBIDDEN');
  const ward = await assertFreeBed(req.hospitalId, wardId, bed, loaded.stay._id);
  loaded.stay.set({ wardId: ward._id, ward: ward.name, bed });
  await loaded.stay.save();
  await recordAudit(req, 'ADMISSION_UPDATED', { hospitalId: req.hospitalId, details: { admissionId, part: 'bed' } });
  return stayAnswer(req, loaded);
}

// ---------- Documents ----------

async function loadDoc(req, admissionId, docId) {
  const loaded = await loadStay(req, admissionId);
  const doc = await InpatientDocument.findOne({ hospitalId: req.hospitalId, admissionId, _id: docId });
  if (!doc) throw notFoundError('Document');
  return { ...loaded, doc };
}

export async function newDocument(req, admissionId, { kind, clientRequestId }) {
  const loaded = await loadStay(req, admissionId);
  if (!canWrite(req, loaded.level) || loaded.stay.status !== 'admitted') throw new HttpError(403, 'Her doctor or an RMO writes ward documents while she is in hospital.', 'FORBIDDEN');
  const same = await InpatientDocument.findOne({ hospitalId: req.hospitalId, clientRequestId });
  if (!same) {
    if (kind === 'discharge' && (await InpatientDocument.exists({ hospitalId: req.hospitalId, admissionId, kind: 'discharge', status: { $ne: 'cancelled' } }))) {
      throw new HttpError(409, 'This stay already has a discharge card.', 'ONE_DISCHARGE');
    }
    // A discharge card starts with what is known: now as the time of discharge, and the diagnosis of her admission note.
    let content = {};
    if (kind === 'discharge') {
      const note = await InpatientDocument.findOne({ hospitalId: req.hospitalId, admissionId, kind: 'admission', status: 'signed' }).lean();
      content = {
        dischargedAt: new Date().toISOString(),
        chiefComplaint: note?.content?.reason ?? loaded.stay.reason ?? '',
        admissionDiagnosis: note?.content?.provisionalDiagnosis ?? '',
        medicines: [],
        followUpDoctorId: loaded.stay.doctorId ? String(loaded.stay.doctorId) : '',
      };
    }
    const doc = await InpatientDocument.create({ hospitalId: req.hospitalId, patientId: loaded.stay.patientId, admissionId, kind, content, createdBy: req.user._id, createdByName: req.user.name, clientRequestId });
    await recordAudit(req, 'INPATIENT_DOC_STARTED', { hospitalId: req.hospitalId, details: { admissionId, documentId: String(doc._id), kind } });
    return { document: docView(doc), ...(await stayAnswer(req, loaded)) };
  }
  return { document: docView(same), ...(await stayAnswer(req, loaded)) };
}

// The discharge summary's links, checked when it is marked ready or finalized: the follow-up doctor works in this
// hospital, and the follow-up is not before the discharge.
async function checkDischargeLinks(req, content) {
  await assertHospitalDoctor(req.hospitalId, content.followUpDoctorId).catch(() => {
    throw new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION', { 'content.followUpDoctorId': 'Choose a doctor of this hospital' });
  });
  if (utcDay(content.followUpOn) < utcDay(content.dischargedAt)) {
    throw new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION', { 'content.followUpOn': 'The follow-up cannot be before the discharge' });
  }
}

// Ready for review: the draft is checked complete (every field) and marked; a doctor then finalizes it.
export async function markReady(req, admissionId, docId) {
  const loaded = await loadDoc(req, admissionId, docId);
  const { doc } = loaded;
  if (!canWrite(req, loaded.level)) throw new HttpError(403, 'Her doctor or an RMO writes ward documents.', 'FORBIDDEN');
  if (doc.status !== 'draft') throw new HttpError(409, 'This document is already finalized or entered in error.', 'LOCKED');
  const content = checkContent(doc.kind, doc.content);
  if (doc.kind === 'discharge') await checkDischargeLinks(req, content);
  const wasReady = Boolean(doc.readyForReview);
  doc.set({ readyForReview: stamp(req) });
  await doc.save();
  await recordAudit(req, 'INPATIENT_DOC_SAVED', { hospitalId: req.hospitalId, details: { admissionId, documentId: docId, kind: doc.kind, ready: true } });
  // Reception hears early that she is going home, to get the bill and the papers ready (each time the discharge card
  // becomes ready for review; changing the draft takes "ready" away again)
  if (doc.kind === 'discharge' && !wasReady) {
    const { patient } = loaded;
    await notifyRoles(req, config.access.registrationMenu, {
      type: 'DISCHARGE_SOON',
      title: 'Discharge being prepared',
      message: `${patient.name} (${patient.patientNumber}) · going home ${utcDay(content.dischargedAt).getTime() === utcDay(new Date()).getTime() ? 'today' : 'soon'} – card ready for review`,
      link: '/hospital/admissions',
    });
  }
  return { document: docView(doc), ...(await stayAnswer(req, loaded)) };
}

export async function saveDocument(req, admissionId, docId, { rev, content }) {
  const loaded = await loadDoc(req, admissionId, docId);
  const { doc } = loaded;
  if (!canWrite(req, loaded.level)) throw new HttpError(403, 'Her doctor or an RMO writes ward documents.', 'FORBIDDEN');
  if (doc.status !== 'draft') throw new HttpError(409, 'This document is signed or entered in error: add a correction instead.', 'LOCKED');
  if (doc.rev !== rev) throw new HttpError(409, 'Someone else saved this document a moment ago. Reload to see their changes.', 'STALE');
  doc.set({ content: await withDoctorName(doc.kind, checkContent(doc.kind, content, { draft: true })), rev: rev + 1, savedByName: req.user.name, savedAt: new Date(), readyForReview: null });
  doc.markModified('content');
  await doc.save();
  await recordAudit(req, 'INPATIENT_DOC_SAVED', { hospitalId: req.hospitalId, details: { admissionId, documentId: docId, kind: doc.kind } });
  return { document: docView(doc), ...(await stayAnswer(req, loaded)) };
}

export async function signDocument(req, admissionId, docId) {
  const loaded = await loadDoc(req, admissionId, docId);
  const { doc, stay, patient, level } = loaded;
  if (!(level === 'full' && has(req, SIGNED_BY[doc.kind]))) throw new HttpError(403, `A ${SIGNED_BY[doc.kind].join(' or ')} with full access to her record signs this document.`, 'FORBIDDEN');
  if (doc.status !== 'draft') throw new HttpError(409, 'This document is already signed or entered in error.', 'LOCKED');
  // a document is signed only complete: its fields checked once more
  const content = checkContent(doc.kind, doc.content);
  if (doc.kind === 'discharge') await checkDischargeLinks(req, content);
  const role = req.membership.roles.includes(DOCTOR) ? DOCTOR : 'rmo';
  doc.set({ status: 'signed', signed: stamp(req, { role }) });
  await doc.save();
  if (doc.kind === 'discharge') {
    stay.set({ status: 'discharged', dischargedAt: content.dischargedAt, dischargedByName: req.user.name });
    await stay.save();
    if (content.followUpOn && utcDay(content.followUpOn) > utcDay(new Date())) {
      const doctorId = content.followUpDoctorId ?? stay.doctorId ?? patient.assignedDoctorId ?? (role === DOCTOR ? req.user._id : null);
      const on = utcDay(content.followUpOn);
      if (doctorId && !(await Appointment.exists({ hospitalId: req.hospitalId, patientId: patient._id, on, status: { $ne: 'cancelled' } }))) {
        await Appointment.create({ hospitalId: req.hospitalId, patientId: patient._id, doctorId, on, kind: 'slot', start: null, visitType: 'follow_up', source: 'booked', createdBy: req.user._id });
      }
    }
    await recordAudit(req, 'DISCHARGED', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), admissionId } });
    const who = `${patient.name} (${patient.patientNumber})`;
    await notifyRoles(req, config.access.registrationMenu, { type: 'DISCHARGE_READY', title: 'Discharge card ready', message: `${who} – print the discharge card`, link: '/hospital/discharges' });
    await notifyRoles(req, ['billing'], { type: 'FINAL_BILL', title: 'Final bill needed', message: `${who} was discharged`, link: `/hospital/billing?patientId=${patient._id}` });
  }
  await recordAudit(req, 'INPATIENT_DOC_SIGNED', { hospitalId: req.hospitalId, details: { admissionId, documentId: docId, kind: doc.kind } });
  return { document: docView(doc), ...(await stayAnswer(req, loaded)) };
}

export async function cancelDocument(req, admissionId, docId, reason) {
  const loaded = await loadDoc(req, admissionId, docId);
  if (!canWrite(req, loaded.level)) throw new HttpError(403, 'Her doctor or an RMO does this.', 'FORBIDDEN');
  if (loaded.doc.status !== 'draft') throw new HttpError(409, 'Only a draft can be marked as entered in error; add a correction to a signed one.', 'LOCKED');
  loaded.doc.set({ status: 'cancelled', cancelled: stamp(req, { reason }) });
  await loaded.doc.save();
  await recordAudit(req, 'INPATIENT_DOC_CANCELLED', { hospitalId: req.hospitalId, details: { admissionId, documentId: docId } });
  return { document: docView(loaded.doc), ...(await stayAnswer(req, loaded)) };
}

export async function addToDocument(req, admissionId, docId, text) {
  const loaded = await loadDoc(req, admissionId, docId);
  if (loaded.doc.status !== 'signed' || !(canWrite(req, loaded.level) || canNurse(req, loaded.level))) throw new HttpError(403, 'Corrections are added below a signed document.', 'FORBIDDEN');
  loaded.doc.additions.push({ text, by: req.user._id, byName: req.user.name, at: new Date() });
  await loaded.doc.save();
  await recordAudit(req, 'INPATIENT_DOC_ADDITION', { hospitalId: req.hospitalId, details: { admissionId, documentId: docId } });
  return { document: docView(loaded.doc), ...(await stayAnswer(req, loaded)) };
}

// ---------- Nursing chart ----------

export async function addNursing(req, admissionId, body) {
  const loaded = await loadStay(req, admissionId);
  if (loaded.stay.status !== 'admitted' || !canNurse(req, loaded.level)) throw new HttpError(403, 'Nurses, her doctor or an RMO write the nursing chart while she is in hospital.', 'FORBIDDEN');
  const exists = await NursingEntry.exists({ hospitalId: req.hospitalId, clientRequestId: body.clientRequestId });
  if (!exists) {
    if (body.at < loaded.stay.admittedAt) throw fieldError('at', 'This time is before she was admitted.');
    await NursingEntry.create({
      hospitalId: req.hospitalId,
      patientId: loaded.stay.patientId,
      admissionId,
      kind: body.kind,
      at: body.at,
      vitals: body.kind === 'vitals' ? body.vitals : undefined,
      medicine: body.kind === 'medicine' ? body.medicine : undefined,
      note: body.note,
      by: req.user._id,
      byName: req.user.name,
      clientRequestId: body.clientRequestId,
    });
    await recordAudit(req, 'NURSING_ENTRY', { hospitalId: req.hospitalId, details: { admissionId, kind: body.kind } });
  }
  return stayAnswer(req, loaded);
}

export async function cancelNursing(req, admissionId, entryId, reason) {
  const loaded = await loadStay(req, admissionId);
  const entry = await NursingEntry.findOne({ hospitalId: req.hospitalId, admissionId, _id: entryId });
  if (!entry) throw notFoundError('Entry');
  if (entry.cancelled) return stayAnswer(req, loaded);
  if (!(String(entry.by) === String(req.user._id) || canWrite(req, loaded.level))) throw new HttpError(403, 'Only who wrote it, her doctor or an RMO marks it as entered in error.', 'FORBIDDEN');
  entry.cancelled = stamp(req, { reason });
  await entry.save();
  await recordAudit(req, 'NURSING_ENTRY_CANCELLED', { hospitalId: req.hospitalId, details: { admissionId, entryId } });
  return stayAnswer(req, loaded);
}

// ---------- Pharmacy: issue to ward ----------

// Who is in hospital now, for the pharmacist: name, number, ward and bed only.
export async function admittedForPharmacy(req) {
  const stays = await Admission.find({ hospitalId: req.hospitalId, status: 'admitted' }).sort({ ward: 1, bed: 1 }).lean();
  const patients = new Map((await Patient.find({ hospitalId: req.hospitalId, _id: { $in: stays.map((s) => s.patientId) } }).select('name patientNumber').lean()).map((p) => [String(p._id), p]));
  return stays.map((s) => ({ id: String(s._id), ward: s.ward, bed: s.bed, patient: { id: String(s.patientId), name: patients.get(String(s.patientId))?.name ?? '', patientNumber: patients.get(String(s.patientId))?.patientNumber ?? '' } }));
}

// Medicines issued to a patient in hospital: a sale on her hospital bill, tied to her stay ('ward_issue' in the
// registers).
export async function issueToWard(req, { admissionId, doctorName, lines }) {
  const stay = await Admission.findOne({ hospitalId: req.hospitalId, _id: admissionId, status: 'admitted' }).lean();
  if (!stay) throw fieldError('admissionId', 'Choose a patient who is in hospital now.');
  const sale = await sell(req, { patientId: String(stay.patientId), admissionId: stay._id, customerName: '', doctorName, lines, discount: { amount: 0, reason: '' }, payTo: 'bill', reference: `Ward ${stay.ward}${stay.bed ? ` bed ${stay.bed}` : ''}` });
  return sale;
}

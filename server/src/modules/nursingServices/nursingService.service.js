// Services nurses give (owner, 9 Oct 2026): the nurse records them on the patient, they are sent to the front desk,
// and reception or billing adds them to her bill. Prices come from the price list at the time the service was given.
import { config } from '../../config/index.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2 } from '../../core/money.js';
import { toObjectId } from '../../core/validate.js';
import { nextNumber } from '../../db/counter.js';
import { Admission } from '../admissions/admission.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { addNursingService } from '../bills/bill.service.js';
import { notifyRoles } from '../notifications/notification.service.js';
import { Patient } from '../patients/patient.model.js';
import { atLeast, recordLevel } from '../patients/patientAccess.js';
import { findActiveItems, priceOptions } from '../priceList/priceList.service.js';
import { NursingService } from './nursingService.model.js';

const { serviceGroups, servicePrefix } = config.nursing;

const view = (s) => ({
  id: String(s._id),
  serviceNumber: s.serviceNumber,
  patientId: String(s.patientId),
  admissionId: s.admissionId ? String(s.admissionId) : null,
  items: s.items.map((i) => ({ name: i.name, code: i.code, qty: i.qty, unitPrice: i.unitPrice, amount: round2(i.unitPrice * i.qty) })),
  amount: s.amount,
  givenAt: s.givenAt,
  note: s.note,
  status: s.status,
  givenByName: s.given.byName,
  billed: s.billed ? { byName: s.billed.byName, at: s.billed.at, billId: String(s.billed.billId), billNumber: s.billed.billNumber } : null,
  cancelled: s.cancelled ? { byName: s.cancelled.byName, at: s.cancelled.at, reason: s.cancelled.reason } : null,
});

/** The price list items a nurse may record (config.nursing.serviceGroups: procedures, inpatient care, other). */
export async function options(req) {
  return { items: (await priceOptions(req.hospitalId)).filter((i) => serviceGroups.includes(i.group)) };
}

// The patient, readable clinically by this person; her stay in hospital now, if any.
async function loadPatient(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient || !atLeast(recordLevel(req, patient), 'clinicalRead')) throw notFoundError('Patient');
  if (patient.status !== 'active') throw new HttpError(409, 'Her record is closed.', 'CLOSED');
  const stay = await Admission.findOne({ hospitalId: req.hospitalId, patientId: patient._id, status: 'admitted' }).lean();
  return { patient, stay };
}

/** The services of one patient, newest first (her chart, the nurse who records them). */
export async function ofPatient(req, patientId) {
  const { patient } = await loadPatient(req, patientId);
  const rows = await NursingService.find({ hospitalId: req.hospitalId, patientId: patient._id }).sort({ givenAt: -1 }).limit(100).lean();
  return { items: rows.map(view) };
}

export async function record(req, { patientId, items, givenAt, note, clientRequestId }) {
  const same = await NursingService.findOne({ hospitalId: req.hospitalId, clientRequestId }).lean();
  if (same) return { service: view(same) };
  const { patient, stay } = await loadPatient(req, patientId);
  if (stay && givenAt < stay.admittedAt) throw fieldError('givenAt', 'This time is before she was admitted.');
  const found = await findActiveItems(req.hospitalId, items.map((i) => i.priceItemId));
  const lines = items.map((i) => {
    const p = found.get(i.priceItemId);
    if (!p || !serviceGroups.includes(p.group)) throw fieldError('items', 'A service is no longer on the price list. Reload the page.');
    return { priceItemId: p._id, code: p.code, name: p.name, group: p.group, qty: i.qty, unitPrice: p.price };
  });
  const service = await NursingService.create({
    hospitalId: req.hospitalId,
    serviceNumber: await nextNumber(req.hospitalId, 'nursingService', servicePrefix, config.billing.numberDigits),
    patientId: patient._id,
    admissionId: stay?._id ?? null,
    items: lines,
    amount: round2(lines.reduce((n, l) => n + l.unitPrice * l.qty, 0)),
    givenAt,
    note,
    given: { by: req.user._id, byName: req.user.name, at: new Date() },
    clientRequestId,
  });
  await recordAudit(req, 'SERVICE_RECORDED', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), serviceNumber: service.serviceNumber, amount: service.amount } });
  await notifyRoles(req, config.nursing.billServicesRoles, {
    type: 'SERVICE_TO_BILL',
    title: 'Nursing service to bill',
    message: `${patient.name} (${patient.patientNumber})${stay ? ` · ${stay.ward}${stay.bed ? `, bed ${stay.bed}` : ''}` : ''} · ${lines.map((l) => `${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''}`).join(', ')}`,
    link: '/hospital/billing/services',
  });
  return { service: view(service) };
}

/** A service still waiting is cancelled by the nurse who recorded it (or a doctor / RMO), with the reason. */
export async function cancel(req, id, reason) {
  const s = await NursingService.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!s) throw notFoundError('Service');
  await loadPatient(req, s.patientId);
  if (s.status === 'billed') throw new HttpError(409, `This service is already on bill ${s.billed.billNumber}. Ask the front desk to remove it from the bill.`, 'ALREADY_BILLED');
  const mine = String(s.given.by) === String(req.user._id);
  if (!mine && !req.membership.roles.some((r) => config.prescriberRoles.includes(r))) throw new HttpError(403, 'Only who recorded it, a doctor or an RMO can cancel it.', 'FORBIDDEN');
  if (s.status === 'sent') {
    s.set({ status: 'cancelled', cancelled: { by: req.user._id, byName: req.user.name, at: new Date(), reason } });
    await s.save();
    await recordAudit(req, 'SERVICE_CANCELLED', { hospitalId: req.hospitalId, details: { serviceNumber: s.serviceNumber } });
  }
  return { service: view(s) };
}

// ---------- The front desk: services to bill ----------

/** Waiting to be billed (oldest first) and those billed today, with the patient's name, number, ward and bed. */
export async function queue(req) {
  const hid = toObjectId(req.hospitalId);
  const [start, end] = dayRange(todayLocal());
  const [waiting, billedToday] = await Promise.all([
    NursingService.find({ hospitalId: hid, status: 'sent' }).sort({ givenAt: 1 }).limit(200).lean(),
    NursingService.find({ hospitalId: hid, status: 'billed', 'billed.at': { $gte: start, $lt: end } }).sort({ 'billed.at': -1 }).limit(100).lean(),
  ]);
  const all = [...waiting, ...billedToday];
  const [patients, stays] = await Promise.all([
    Patient.find({ hospitalId: hid, _id: { $in: all.map((s) => s.patientId) } }).select('name patientNumber').lean(),
    Admission.find({ hospitalId: hid, _id: { $in: all.map((s) => s.admissionId).filter(Boolean) } }).select('ward bed admissionNumber').lean(),
  ]);
  const pById = new Map(patients.map((p) => [String(p._id), p]));
  const sById = new Map(stays.map((s) => [String(s._id), s]));
  const withWho = (s) => {
    const p = pById.get(String(s.patientId));
    const stay = s.admissionId ? sById.get(String(s.admissionId)) : null;
    return { ...view(s), patient: { id: String(s.patientId), name: p?.name ?? '', patientNumber: p?.patientNumber ?? '' }, stay: stay ? { ward: stay.ward, bed: stay.bed, admissionNumber: stay.admissionNumber ?? '' } : null };
  };
  await recordAudit(req, 'SERVICES_TO_BILL_VIEWED', { hospitalId: req.hospitalId, details: { waiting: waiting.length } });
  return { waiting: waiting.map(withWho), billedToday: billedToday.map(withWho), total: round2(waiting.reduce((n, s) => n + s.amount, 0)) };
}

/** Adds a waiting service to her bill (the one chosen, or her latest open bill, or a new one). */
export async function bill(req, id, { billId = null } = {}) {
  const s = await NursingService.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!s) throw notFoundError('Service');
  if (s.status === 'billed') throw new HttpError(409, `Already on bill ${s.billed.billNumber}.`, 'ALREADY_BILLED');
  if (s.status === 'cancelled') throw new HttpError(409, 'This service was cancelled by the nurse.', 'CANCELLED');
  // claim it first, so two people clicking at once cannot bill it twice
  const claimed = await NursingService.findOneAndUpdate({ hospitalId: req.hospitalId, _id: id, status: 'sent' }, { $set: { status: 'billed' } }, { returnDocument: 'after' });
  if (!claimed) throw new HttpError(409, 'Someone else has just billed it. Reload the page.', 'ALREADY_BILLED');
  try {
    const b = await addNursingService(req, s.patientId, { serviceNumber: s.serviceNumber, items: s.items }, billId);
    claimed.billed = { by: req.user._id, byName: req.user.name, at: new Date(), billId: b._id, billNumber: b.billNumber };
    await claimed.save();
    await recordAudit(req, 'SERVICE_BILLED', { hospitalId: req.hospitalId, details: { serviceNumber: s.serviceNumber, billNumber: b.billNumber, amount: s.amount } });
    return { service: view(claimed), bill: { id: String(b._id), billNumber: b.billNumber, total: b.total } };
  } catch (err) {
    await NursingService.updateOne({ _id: claimed._id }, { $set: { status: 'sent' } });
    throw err;
  }
}

/** The services this person recorded today (a nurse's Today), with the patient's name and number. */
export async function mineToday(req) {
  const [start, end] = dayRange(todayLocal());
  const rows = await NursingService.find({ hospitalId: req.hospitalId, 'given.by': req.user._id, givenAt: { $gte: start, $lt: end } }).sort({ givenAt: -1 }).limit(50).lean();
  const patients = new Map((await Patient.find({ hospitalId: req.hospitalId, _id: { $in: rows.map((r) => r.patientId) } }).select('name patientNumber').lean()).map((p) => [String(p._id), p]));
  return { items: rows.map((r) => ({ ...view(r), patient: { name: patients.get(String(r.patientId))?.name ?? '', patientNumber: patients.get(String(r.patientId))?.patientNumber ?? '' } })) };
}

/** For Today: how many services wait to be billed. */
export const waitingCount = (hospitalId) => NursingService.countDocuments({ hospitalId, status: 'sent' });


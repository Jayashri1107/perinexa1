// Billing (docs/BILLING_PLAN.md): the price list, finding or opening a patient's bill, the charges added
// automatically by the work done (visits, lab orders, stays and their bed days), and what the website gets.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - automatic charges never stop clinical work: the hooks catch and log their own errors (hooks.js);
//  - a line is never deleted, only marked removed; a bill is never deleted, only cancelled;
//  - lines and payments are changed with single atomic updates (two desks may work on one bill).

import { hospitalToday, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Bill } from '../models/Bill.js';
import { nextNumber } from '../models/Counter.js';
import { Membership } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { PriceItem } from '../models/PriceItem.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { letterheadFor } from '../routes/settings.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { patientAccess } from '../utils/patientAccess.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { BILL_PCPNDT_MESSAGE, CONFIDENTIAL_NAME, CONFIDENTIAL_TESTS, INSURANCE_FIELDS, INSURANCE_KEPT, UPI_HISTORY_KEPT } from './billingRules.js';
import { BUILT_IN_PRICES } from './builtInPrices.js';
import { claimSums, groupSummary, insuranceView } from './claim.js';
import { bedDays, liveLines, totals } from './money.js';
import { payeeNameProblem, upiIdProblem } from './upi.js';

export const stampOf = (req) => ({ by: req.user?._id ?? null, byName: req.user?.name ?? 'Perinexa', at: req.now ?? new Date() });
const padded = (prefix, n) => `${prefix}-${String(n).padStart(6, '0')}`;

/**
 * PC-PNDT: text typed on the bill of a patient who is not a baby never mentions the baby's sex – an item's name, a
 * reason, the payer or the reference of a payment (the insurance details have the same guard in their own schema).
 * Every way of putting text on a bill comes through here: the billing routes and the fee taken with an appointment.
 * texts: { field: what was typed }. Refused with the message under each field. The patient is looked up only when
 * something typed needs it.
 */
export async function refuseFetalSex(req, patientId, texts) {
  const found = Object.keys(texts).filter((k) => mentionsFetalSex(texts[k]));
  if (!found.length) return;
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { careType: 1 }).lean();
  if (patient?.careType === 'newborn') return;
  throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: Object.fromEntries(found.map((k) => [k, BILL_PCPNDT_MESSAGE])) });
}

// ---------- The price list ----------

/** Puts the starting price list in place for a hospital that has none, and adds any keyed item it lacks. */
export async function ensurePriceList(tenantId) {
  const keyed = BUILT_IN_PRICES.filter((p) => p.key);
  const have = new Set((await PriceItem.find({ tenantId, key: { $in: keyed.map((p) => p.key) } }, { key: 1 }).lean()).map((p) => p.key));
  const first = !(await PriceItem.exists({ tenantId }));
  const toAdd = BUILT_IN_PRICES.map((p, i) => ({ ...p, order: (i + 1) * 10 })).filter((p) => (p.key ? !have.has(p.key) : first));
  if (!toAdd.length) return;
  try {
    await PriceItem.insertMany(
      toAdd.map((p) => ({ tenantId, key: p.key, name: p.name, group: p.group, ward: p.ward ?? null, pricePaise: 0, builtIn: true, order: p.order, updatedByName: 'Perinexa' })),
      { ordered: false },
    );
  } catch (e) {
    if (e?.code !== 11000 && !e?.writeErrors?.every((w) => w.code === 11000)) throw e; // added at the same moment elsewhere
  }
}

/** The price item with this key (active or not), or null. */
export async function priceByKey(tenantId, key) {
  await ensurePriceList(tenantId);
  return PriceItem.findOne({ tenantId, key }).lean();
}

/** The bed charge for a ward: the item whose ward matches (ignoring capitals), else the general ward's. */
export async function bedPriceFor(tenantId, ward) {
  await ensurePriceList(tenantId);
  const beds = await PriceItem.find({ tenantId, group: 'inpatient', ward: { $ne: null }, active: true }).lean();
  const w = String(ward ?? '').trim().toLowerCase();
  return beds.find((b) => b.ward && b.ward.trim().toLowerCase() === w) ?? (await PriceItem.findOne({ tenantId, key: 'bed' }).lean());
}

/** A lab test's name on a bill: its own, or the neutral name for a confidential test. */
export const labLineName = (test) => (CONFIDENTIAL_TESTS.includes(test.key) ? CONFIDENTIAL_NAME : test.name);

// ---------- Finding or opening a bill ----------

/**
 * The patient's open bill for new charges: her current stay's bill while she is in hospital, else her outpatient bill
 * of the day (`day`, default today). Opened when there is none. Returns the bill (lean).
 */
export async function openBillFor(req, patientId, { day = null } = {}) {
  const tenantId = req.tenantId;
  const stay = await Admission.findOne({ tenantId, patientId, status: 'admitted' }).lean();
  if (stay) return openStayBill(req, stay);
  const on = utcDay(day ?? hospitalToday(req.now));
  return findOrCreate(req, { tenantId, patientId, kind: 'opd', on, status: 'open' }, { on });
}

/** The open bill of a stay (opened with its bed-charge line when there is none). */
export async function openStayBill(req, stay) {
  const bill = await findOrCreate(req, { tenantId: req.tenantId, admissionId: stay._id, kind: 'ipd', status: 'open' }, { patientId: stay.patientId, on: toHospitalDate(stay.admittedAt) });
  return (await syncBed(req, bill, stay)) ?? bill;
}

async function findOrCreate(req, filter, extra) {
  const found = await Bill.findOne(filter).lean();
  if (found) return found;
  const number = padded('B', await nextNumber(req.tenantId, 'bill'));
  try {
    return (await Bill.create({ ...filter, ...extra, number })).toObject();
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const again = await Bill.findOne(filter).lean(); // opened at the same moment by another request
    if (again) return again;
    throw e;
  }
}

/** Adds lines to a bill in one update. lines: [{ item, name?, qty, ratePaise?, source, ref, doctorId }]. */
export async function pushLines(req, billId, lines) {
  if (!lines.length) return null;
  const docs = lines.map((l) => {
    const rate = l.ratePaise ?? l.item?.pricePaise ?? 0;
    return {
      priceItemId: l.item?._id ?? null,
      key: l.item?.key ?? null,
      name: l.name ?? l.item.name,
      group: l.group ?? l.item.group,
      qty: l.qty ?? 1,
      ratePaise: rate,
      amountPaise: rate * (l.qty ?? 1),
      source: l.source,
      ref: l.ref ?? null,
      doctorId: l.doctorId ?? null,
      added: stampOf(req),
    };
  });
  return Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: billId, status: 'open' }, { $push: { lines: { $each: docs } } }, { returnDocument: 'after' }).lean();
}

/** Marks the live lines added by this work (a visit, a lab order – or one of its tests) as removed, on any bill. */
export async function removeLinesOf(req, ref, reason) {
  const bills = await Bill.find({ tenantId: req.tenantId, 'lines.ref.id': ref.id }).lean();
  for (const bill of bills) {
    for (const line of bill.lines) {
      if (line.removed || String(line.ref?.id) !== String(ref.id) || (ref.test && line.ref?.test !== ref.test)) continue;
      await Bill.updateOne(
        { tenantId: req.tenantId, _id: bill._id },
        { $set: { 'lines.$[l].removed': { ...stampOf(req), reason } } },
        { arrayFilters: [{ 'l._id': line._id, 'l.removed': null }] },
      );
    }
  }
}

/**
 * Brings a stay bill's bed-day line up to date (opened at admission; the days grow until discharge), and fills in the
 * price of automatic lines still at ₹0 once the admin has set it. Returns the bill after, or null when unchanged.
 */
export async function syncBed(req, bill, stay) {
  if (bill.status !== 'open' || bill.kind !== 'ipd') return null;
  const days = bedDays(stay.admittedAt, stay.dischargedAt, req.now ?? new Date());
  // Nursing per day (once its price is set) follows the same days as the bed
  const nursed = (await syncNursing(req, bill, stay, days)) ?? bill;
  if (nursed !== bill) bill = nursed;
  const line = bill.lines.find((l) => l.ref?.kind === 'bed' && !l.removed);
  if (!line) {
    if (bill.lines.some((l) => l.ref?.kind === 'bed')) return null; // taken off by hand: left so
    const item = await bedPriceFor(req.tenantId, stay.ward);
    if (!item) return null;
    return pushLines(req, bill._id, [{ item, name: `${item.name}${stay.ward ? ` (${stay.ward})` : ''}`, qty: days, source: 'auto', ref: { kind: 'bed', id: stay._id } }]);
  }
  if (line.qty === days) return null;
  return Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id },
    { $set: { 'lines.$[l].qty': days, 'lines.$[l].amountPaise': days * line.ratePaise } },
    { arrayFilters: [{ 'l._id': line._id }], returnDocument: 'after' },
  ).lean();
}

/** The nursing line of a stay: as many days as the bed (only when the hospital charges nursing). */
async function syncNursing(req, bill, stay, days) {
  const line = bill.lines.find((l) => l.ref?.kind === 'nursing' && !l.removed);
  if (!line) {
    if (bill.lines.some((l) => l.ref?.kind === 'nursing')) return null; // taken off by hand: left so
    const item = await priceByKey(req.tenantId, 'nursing');
    if (!item?.pricePaise) return null;
    return pushLines(req, bill._id, [{ item, qty: days, source: 'auto', ref: { kind: 'nursing', id: stay._id } }]);
  }
  if (line.qty === days) return null;
  return Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id },
    { $set: { 'lines.$[l].qty': days, 'lines.$[l].amountPaise': days * line.ratePaise } },
    { arrayFilters: [{ 'l._id': line._id }], returnDocument: 'after' },
  ).lean();
}

/** Automatic lines still at ₹0 whose price has since been set get it (open bills only). Returns the bill after, or null. */
export async function fillUnsetPrices(req, bill) {
  if (bill.status !== 'open') return null;
  const unset = bill.lines.filter((l) => !l.removed && l.source === 'auto' && l.ratePaise === 0 && l.priceItemId);
  if (!unset.length) return null;
  const items = new Map((await PriceItem.find({ tenantId: req.tenantId, _id: { $in: unset.map((l) => l.priceItemId) } }).lean()).map((i) => [String(i._id), i]));
  let after = null;
  for (const l of unset) {
    const price = items.get(String(l.priceItemId))?.pricePaise ?? 0;
    if (!price) continue;
    after = await Bill.findOneAndUpdate(
      { tenantId: req.tenantId, _id: bill._id },
      { $set: { 'lines.$[l].ratePaise': price, 'lines.$[l].amountPaise': price * l.qty } },
      { arrayFilters: [{ 'l._id': l._id, 'l.ratePaise': 0 }], returnDocument: 'after' },
    ).lean();
  }
  return after;
}

/** A bill brought up to date before it is shown: bed days, prices set since. */
export async function freshBill(req, bill) {
  let current = bill;
  if (current.kind === 'ipd' && current.admissionId) {
    const stay = await Admission.findOne({ tenantId: req.tenantId, _id: current.admissionId }).lean();
    if (stay) current = (await syncBed(req, current, stay)) ?? current;
  }
  return (await fillUnsetPrices(req, current)) ?? current;
}

// ---------- Charges added by the work done ----------

/** Is this user a doctor of the hospital? */
async function isDoctor(tenantId, userId) {
  return Boolean(userId && (await Membership.exists({ tenantId, userId, roles: 'doctor', isActive: true })));
}

/** A visit was started: the consultation – new (her first visit) or follow-up – on the bill of the visit's day. */
export async function chargeVisit(req, patient, visit) {
  if (await feeTakenForDay(req.tenantId, patient._id, visit.visitOn)) return; // paid when the appointment was booked
  // Her first visit is a new-patient consultation, a later one a follow-up. Visits made on a record that was marked
  // as a duplicate of hers are hers too (they stay on that record; they are only counted here).
  const earlier = (await Patient.find({ tenantId: req.tenantId, 'duplicateOf.patient': patient._id }, { _id: 1 }).lean()).map((p) => p._id);
  const count = await Visit.countDocuments({ tenantId: req.tenantId, patientId: { $in: [patient._id, ...earlier] }, status: 'active' });
  const item = await priceByKey(req.tenantId, count <= 1 ? 'consult_new' : 'consult_follow');
  if (!item) return;
  const doctorId = (await isDoctor(req.tenantId, visit.createdBy)) ? visit.createdBy : (patient.assignedDoctor ?? null);
  const bill = await openBillFor(req, patient._id, { day: visit.visitOn });
  // Already charged at the desk (OPD registration → Registered, or Add service charge, owner 27 Oct 2026): a
  // consultation put on this day's bill by hand, and no visit has charged one yet – not charged a second time
  const live = (bill.lines ?? []).filter((l) => !l.removed);
  if (live.some((l) => l.source === 'manual' && ['consult_new', 'consult_follow'].includes(l.key)) && !live.some((l) => l.ref?.kind === 'visit')) return;
  await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'visit', id: visit._id }, doctorId }]);
}

/** A lab order was made: each test at its price, on today's bill (or the stay's). */
export async function chargeLabOrder(req, patient, order) {
  await ensurePriceList(req.tenantId);
  const items = new Map((await PriceItem.find({ tenantId: req.tenantId, key: { $in: order.tests.map((t) => `lab:${t.key}`) } }).lean()).map((i) => [i.key, i]));
  const lines = order.tests
    .map((t) => {
      const item = items.get(`lab:${t.key}`);
      if (!item) return null;
      return { item, name: t.key === 'other' ? `Lab test – ${t.name}` : labLineName({ key: t.key, name: item.name }), source: 'auto', ref: { kind: 'lab', id: order._id, test: t.key === 'other' ? `other:${t.name}` : t.key }, doctorId: order.ordered?.by ?? null };
    })
    .filter(Boolean);
  const bill = await openBillFor(req, patient._id);
  await pushLines(req, bill._id, lines);
}

/** A scan or procedure was done: its price-list item on the bill of that day (or the stay's). */
export async function chargeWorkDone(req, patient, work, item) {
  const bill = await openBillFor(req, patient._id, { day: work.on });
  await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'work', id: work._id }, doctorId: work.doctorId ?? null }]);
}

/** A patient was admitted: the stay's bill, with its bed-day line, and the admission charge (once its price is set). */
export async function chargeAdmission(req, stay) {
  const bill = await openStayBill(req, stay);
  const item = await priceByKey(req.tenantId, 'admission');
  if (item?.pricePaise && !bill.lines.some((l) => l.ref?.kind === 'admission')) await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'admission', id: stay._id } }]);
}

// Charges a hospital system adds by itself (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md) – only once the hospital
// admin has set their price, so a hospital that does not charge them sees nothing.

/** A new patient was registered: the registration fee on today's bill. */
export async function chargeRegistration(req, patient) {
  const item = await priceByKey(req.tenantId, 'registration');
  if (!item?.pricePaise) return;
  const bill = await openBillFor(req, patient._id);
  await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'registration', id: patient._id }, doctorId: patient.assignedDoctor ?? null }]);
}

/** A doctor signed a ward-round note: one doctor visit on the stay's bill, with the doctor's name. */
export async function chargeRound(req, stay, doc) {
  const item = await priceByKey(req.tenantId, 'ipd_round');
  if (!item?.pricePaise) return;
  const bill = await openStayBill(req, stay);
  if (bill.lines.some((l) => l.ref?.kind === 'round' && String(l.ref.id) === String(doc._id))) return;
  await pushLines(req, bill._id, [{ item, name: `${item.name} – ${req.user.name}`, source: 'auto', ref: { kind: 'round', id: doc._id }, doctorId: req.user._id }]);
}

/** A scan was ordered: its price-list item (scan:<study>) on her bill, with the ordering doctor. */
export async function chargeScan(req, patient, study) {
  const item = await priceByKey(req.tenantId, `scan:${study.study}`);
  if (!item) return;
  const bill = await openBillFor(req, patient._id);
  await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'scan', id: study._id }, doctorId: study.ordered?.by ?? null }]);
}

// ---------- The consultation fee taken when an appointment is booked ----------

const feeLine = (apptIds) => ({ $elemMatch: { 'ref.kind': 'appointment', 'ref.id': { $in: apptIds }, removed: null } });

/** The fees taken in advance for these appointments: Map "<appointmentId>" -> { amountPaise, billId, number }. */
export async function appointmentFees(tenantId, apptIds) {
  const out = new Map();
  if (!apptIds.length) return out;
  const bills = await Bill.find({ tenantId, status: 'open', lines: feeLine(apptIds) }, { number: 1, lines: 1 }).lean();
  for (const b of bills) {
    for (const l of b.lines) {
      if (l.removed || l.ref?.kind !== 'appointment') continue;
      out.set(String(l.ref.id), { amountPaise: l.amountPaise, billId: String(b._id), number: b.number });
    }
  }
  return out;
}

/**
 * Was the consultation of this day already paid for with an appointment of hers that day? The fee is found by the
 * appointment, on whichever bill it is: an appointment that came from a record marked as a duplicate of hers keeps
 * its fee on that record's bill, and her visit must not charge the consultation a second time.
 */
async function feeTakenForDay(tenantId, patientId, day) {
  const appts = await Appointment.find({ tenantId, patientId, on: utcDay(day), status: 'booked' }, { _id: 1 }).lean();
  if (!appts.length) return false;
  return Boolean(await Bill.exists({ tenantId, status: 'open', lines: feeLine(appts.map((a) => a._id)) }));
}

/** The consultation an appointment's fee is for (New → new patient, Follow-up → follow-up), or a 409 saying why none. */
export async function appointmentFeeItem(tenantId, appt) {
  if (!appt.patientId) throw new HttpError(409, 'Register her first: a fee is taken on a patient’s bill.', 'NOT_REGISTERED');
  if (appt.status !== 'booked' || appt.kind !== 'slot') throw new HttpError(409, 'A fee is taken for a booked appointment.', 'NOT_BOOKED');
  if (!['new', 'follow_up'].includes(appt.visitType)) throw new HttpError(409, 'A fee in advance is for a consultation (visit type New or Follow-up).', 'NOT_A_CONSULTATION');
  const item = await priceByKey(tenantId, appt.visitType === 'new' ? 'consult_new' : 'consult_follow');
  if (!item?.pricePaise) throw new HttpError(409, 'The consultation price is not set yet (Billing → Price list).', 'PRICE_NOT_SET');
  return item;
}

/**
 * Takes the consultation fee for an appointment in advance: the consultation goes on her bill of the appointment's
 * day, paid in full, with a receipt. Her visit that day then adds no second consultation (chargeVisit).
 * Returns { bill, receipt, amountPaise }.
 */
export async function takeAppointmentFee(req, appt, { mode, reference = '', scheme = '' }) {
  const item = await appointmentFeeItem(req.tenantId, appt);
  const payer = mode === 'insurance' ? scheme : '';
  // The payer and the reference go on her bill like those of any payment: the same fetal-sex guard, before anything is saved
  await refuseFetalSex(req, appt.patientId, { scheme: payer, reference });
  if ((await appointmentFees(req.tenantId, [appt._id])).size) throw new HttpError(409, 'The fee for this appointment was already taken.', 'FEE_TAKEN');
  // A record marked as a duplicate takes no new bill
  refuseNewOnDuplicate(await Patient.findOne({ tenantId: req.tenantId, _id: appt.patientId }, { duplicateOf: 1 }).lean(), 'bill');
  const bill = await openBillFor(req, appt.patientId, { day: appt.on });
  await pushLines(req, bill._id, [{ item, source: 'auto', ref: { kind: 'appointment', id: appt._id }, doctorId: appt.doctorId }]);
  const receipt = padded('R', await nextNumber(req.tenantId, 'receipt'));
  const payment = { receipt, kind: bill.kind === 'ipd' ? 'deposit' : 'payment', mode, amountPaise: item.pricePaise, reference, scheme: payer, ...stampOf(req) };
  const after = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, status: 'open' }, { $push: { payments: payment } }, { returnDocument: 'after' }).lean();
  const noted = after && mode === 'insurance' ? await noteInsurer(req, after, payer, reference) : null;
  return { bill: noted ?? after, receipt, amountPaise: item.pricePaise };
}

// ---------- Insurance or scheme details, the claim form, the UPI link (billing extras, 4 Oct 2026) ----------

/**
 * A payment by insurance was taken: what it says is noted in the bill's insurance details too, so the bill, its
 * payments and its claim form agree.
 *  - A bill with no details yet takes the payer as its insurer, and the payment's claim number (if one was typed).
 *  - A bill whose insurer is this payer and that has no claim number yet takes the payment's claim number.
 *  - Anything else is left as it is: details typed by hand are never overwritten, and a payment by another payer
 *    never changes them.
 * Returns the bill after, or null when nothing changed. The audit entry holds ids and the fields' names only.
 */
export async function noteInsurer(req, bill, scheme, reference = '') {
  const insurer = String(scheme ?? '').trim();
  // Text that would not pass the fetal-sex guard of the insurance details (PC-PNDT) is never copied into them
  if (insurer.length < 2 || mentionsFetalSex(insurer)) return null;
  const typed = String(reference ?? '').trim();
  const claimNumber = typed && typed.length <= INSURANCE_FIELDS.claimNumber && !mentionsFetalSex(typed) ? typed : '';
  let after = null;
  let fields = [];
  if (!bill.insurance) {
    fields = ['insurer', ...(claimNumber ? ['claimNumber'] : [])];
    after = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, insurance: null }, { $set: { insurance: { insurer, claimNumber, ...stampOf(req) } } }, { returnDocument: 'after' }).lean();
  } else if (claimNumber && bill.insurance.insurer === insurer && !bill.insurance.claimNumber) {
    fields = ['claimNumber'];
    const stamp = stampOf(req);
    after = await Bill.findOneAndUpdate(
      { tenantId: req.tenantId, _id: bill._id, 'insurance.insurer': insurer, 'insurance.claimNumber': { $in: ['', null] } },
      { $set: { 'insurance.claimNumber': claimNumber, 'insurance.by': stamp.by, 'insurance.byName': stamp.byName, 'insurance.at': stamp.at } },
      { returnDocument: 'after' },
    ).lean();
  }
  if (after) await audit(req, 'BILL_INSURANCE_CHANGED', { details: { billId: String(bill._id), number: bill.number, patientId: String(bill.patientId), fields, via: 'payment' } });
  return after;
}

/**
 * What an earlier bill of this patient says about her insurance – only what belongs to the person (the insurer, her
 * policy or member number, the TPA, her PM-JAY ID), never the numbers of one claim. Offered on a bill that has no
 * details yet, so reception need not type them again. null when there is none. Never from a cancelled bill: details
 * typed on the wrong patient's bill stay on it when it is cancelled, and must not be offered to her again.
 */
export async function earlierInsurance(req, bill) {
  if (bill.insurance) return null;
  const earlier = await Bill.findOne({ tenantId: req.tenantId, patientId: bill.patientId, status: 'open', _id: { $ne: bill._id }, 'insurance.insurer': { $gt: '' } }, { number: 1, insurance: 1 })
    .sort({ on: -1, createdAt: -1 })
    .lean();
  if (!earlier) return null;
  return { number: earlier.number, ...Object.fromEntries(INSURANCE_KEPT.map((k) => [k, earlier.insurance[k] ?? ''])) };
}

/** The hospital's billing settings: its UPI ID and payee name, who changed them last, and whether a link can be made. */
export async function billingSettings(tenantId) {
  const t = await Tenant.findById(tenantId, { billing: 1 }).lean();
  const b = t?.billing ?? {};
  const [upiId, payeeName] = [b.upiId ?? '', b.payeeName ?? ''];
  // billNotes: lines printed at the foot of every bill and receipt, e.g. the consultation fees (owner, 27 Oct 2026)
  return { upiId, payeeName, billNotes: b.billNotes ?? '', updatedByName: b.updatedByName ?? '', updatedAt: b.updatedAt ?? null, upiReady: !upiIdProblem(upiId) && !payeeNameProblem(payeeName) };
}

/**
 * Saves a change of the UPI ID or payee name, and keeps it in the settings' own history (the last UPI_HISTORY_KEPT
 * changes): what they were set to, by whom and when – so the hospital can see which account the links of any day
 * pointed to. Settings saved before the history existed are written down as its first entry.
 */
export async function saveBillingSettings(req, before, { upiId, payeeName }) {
  const at = req.now ?? new Date();
  const known = await Tenant.exists({ _id: req.tenantId, 'billing.history.0': { $exists: true } });
  const earlier = !known && (before.upiId || before.payeeName) ? [{ upiId: before.upiId, payeeName: before.payeeName, byName: before.updatedByName, at: before.updatedAt }] : [];
  await Tenant.updateOne(
    { _id: req.tenantId },
    {
      $set: { 'billing.upiId': upiId, 'billing.payeeName': payeeName, 'billing.updatedByName': req.user.name, 'billing.updatedAt': at },
      $push: { 'billing.history': { $each: [...earlier, { upiId, payeeName, byName: req.user.name, at }], $slice: -UPI_HISTORY_KEPT } },
    },
  );
}

/** The changes of the UPI ID and payee name, newest first – for the hospital admin (Billing → Settings). */
export async function billingSettingsHistory(tenantId) {
  const t = await Tenant.findById(tenantId, { 'billing.history': 1 }).lean();
  return (t?.billing?.history ?? []).map((h) => ({ upiId: h.upiId ?? '', payeeName: h.payeeName ?? '', byName: h.byName ?? '', at: h.at ?? null })).reverse();
}

/**
 * The treating doctor a claim form names, for THIS bill:
 *  1. a stay: the doctor who admitted her;
 *  2. the doctor of the bill's own consultation – the visit's, or the appointment's whose fee was taken;
 *  3. the doctor she is assigned to;
 *  4. the doctor of another charge on the bill.
 * 1 and 3 come from her record, not from the bill: they are used only for a reader who may see who her doctor is
 * (utils/patientAccess.js – reception may, a hospital admin with no desk role may not). 2 and 4 are billing data,
 * which everyone who bills sees (the monthly report by doctor, the export).
 * Only someone who has the doctor role in this hospital is named: a lab test's line carries whoever ordered it, who
 * may be an RMO or a nurse. With nobody to name, null – the form prints an empty line to fill in by hand.
 */
async function treatingDoctor(req, bill, patient, stay, may) {
  const lines = liveLines(bill).filter((l) => l.doctorId);
  const seesHerDoctor = may.has('assignedDoctor');
  const candidates = [
    seesHerDoctor ? stay?.admittedBy : null,
    ...lines.filter((l) => ['visit', 'appointment'].includes(l.ref?.kind)).map((l) => l.doctorId),
    seesHerDoctor ? patient.assignedDoctor : null,
    ...lines.map((l) => l.doctorId),
  ];
  for (const id of [...new Set(candidates.filter(Boolean).map(String))]) {
    if (await Membership.exists({ tenantId: req.tenantId, userId: id, roles: 'doctor' })) return User.findById(id, { name: 1, professional: 1 }).lean();
  }
  return null;
}

/**
 * What the printed claim form holds: the hospital's letterhead with its registration number, the patient's identity,
 * the stay's or the visit's dates, the treating doctor, the bill by GROUP with its sums, and the insurance details.
 *
 * Privacy: identity only, and only what this reader's roles may see (utils/patientAccess.js) – a hospital admin with
 * no desk role gets her name, number and phone as everywhere in billing, and empty lines for the rest: not her age,
 * date of birth or address, not whether she is a baby (`baby` is then null and the form prints "Age or date of
 * birth"), not the doctor she is assigned to. No item names (a confidential test stays unnamed), no ward, no reason
 * for admission, no type of care, no diagnosis, no notes, no results: the "Diagnosis and procedure" part is printed
 * empty for the treating doctor.
 */
export async function claimForm(req, bill) {
  const tenantId = req.tenantId;
  const [tenant, patient, stay] = await Promise.all([
    Tenant.findById(tenantId, { name: 1, letterhead: 1 }).lean(),
    Patient.findOne({ tenantId, _id: bill.patientId }, { fullName: 1, mrn: 1, phone: 1, address: 1, city: 1, state: 1, pinCode: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1, careType: 1, assignedDoctor: 1, sensitive: 1, 'newborn.birthAt': 1 }).lean(),
    bill.admissionId ? Admission.findOne({ tenantId, _id: bill.admissionId }, { admittedAt: 1, dischargedAt: 1, admittedBy: 1 }).lean() : null,
  ]);
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const may = patientAccess(req, patient).view;
  // A baby's form asks for the date of birth instead of the age – said only to a reader who may see the type of care
  const baby = may.has('careType') ? patient.careType === 'newborn' : null;
  const doctor = await treatingDoctor(req, bill, patient, stay, may);
  const lh = letterheadFor(tenant);
  return {
    hospital: { name: lh.name, tagline: lh.tagline, address: lh.address, phone: lh.phone, email: lh.email, registrationNumber: lh.registrationNumber },
    // null = not for this reader, or not recorded: the form prints a line to fill in by hand
    patient: {
      fullName: patient.fullName,
      mrn: patient.mrn,
      phone: patient.phone ?? '',
      age: baby === false && may.has('currentAge') ? currentAge(patient, req.now ?? new Date()) : null,
      bornOn: baby === true && may.has('newborn') && patient.newborn?.birthAt ? isoDay(toHospitalDate(patient.newborn.birthAt)) : null,
      // with the city, state and PIN code (owner, 14 Oct 2026)
      address: may.has('address') ? [patient.address, patient.city, [patient.state, patient.pinCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : null,
      baby,
    },
    doctor: doctor ? { name: doctor.name, qualification: doctor.professional?.qualification ?? '', registrationNumber: doctor.professional?.registrationNumber ?? '', council: doctor.professional?.council ?? '' } : null,
    dates: bill.kind === 'ipd' ? { kind: 'stay', admittedAt: stay?.admittedAt ?? null, dischargedAt: stay?.dischargedAt ?? null } : { kind: 'visit', on: isoDay(bill.on) },
    bill: { number: bill.number, kind: bill.kind, date: isoDay(bill.on) },
    groups: groupSummary(bill),
    sums: claimSums(bill),
    insurance: insuranceView(bill.insurance),
  };
}

// ---------- What the website gets ----------

/** Patients' names, numbers and phones, and the stays, for a list of bills. */
async function lookups(tenantId, bills) {
  const pids = [...new Set(bills.map((b) => String(b.patientId)))];
  const aids = [...new Set(bills.map((b) => b.admissionId && String(b.admissionId)).filter(Boolean))];
  const [patients, stays, doctors] = await Promise.all([
    pids.length ? Patient.find({ tenantId, _id: { $in: pids } }, { fullName: 1, mrn: 1, phone: 1, duplicateOf: 1, assignedDoctor: 1, careType: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1 }).lean() : [],
    aids.length ? Admission.find({ tenantId, _id: { $in: aids } }, { admittedAt: 1, dischargedAt: 1, ward: 1, bed: 1, status: 1 }).lean() : [],
    // Each line's doctor, and her own doctor, by name (owner, 17 Oct 2026: the doctor's name shows on the bill)
    userNames(bills.flatMap((b) => (b.lines ?? []).map((l) => l.doctorId))),
  ]);
  const own = await userNames(patients.map((p) => p.assignedDoctor));
  // Her doctor's department, printed on the bill as on a hospital's OPD receipt (owner, 27 Oct 2026)
  const ownIds = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const departments = ownIds.length ? new Map((await Membership.find({ tenantId, userId: { $in: ownIds } }, { userId: 1, department: 1 }).lean()).map((m) => [String(m.userId), m.department ?? ''])) : new Map();
  return { patients: new Map(patients.map((p) => [String(p._id), p])), stays: new Map(stays.map((s) => [String(s._id), s])), doctors: new Map([...doctors, ...own]), departments };
}

const lineView = (l, doctors = new Map()) => ({
  id: String(l._id),
  name: l.name,
  doctorName: l.doctorId ? (doctors.get(String(l.doctorId)) ?? '') : '',
  group: l.group,
  qty: l.qty,
  ratePaise: l.ratePaise,
  amountPaise: l.amountPaise,
  source: l.source,
  from: l.ref?.kind ?? null,
  priceNotSet: l.ratePaise === 0,
  priceItemId: l.priceItemId ? String(l.priceItemId) : null,
  key: l.key ?? null,
  addedByName: l.added?.byName ?? '',
  addedAt: l.added?.at ?? null,
  removed: l.removed ? { byName: l.removed.byName ?? '', at: l.removed.at ?? null, reason: l.removed.reason ?? '' } : null,
});

const paymentView = (p) => ({
  id: String(p._id),
  receipt: p.receipt,
  kind: p.kind,
  mode: p.mode,
  amountPaise: p.amountPaise,
  reference: p.reference ?? '',
  scheme: p.scheme ?? '',
  at: p.at,
  byName: p.byName ?? '',
  corrections: (p.corrections ?? []).map((c) => ({ before: { mode: c.before.mode, amountPaise: c.before.amountPaise, reference: c.before.reference ?? '', scheme: c.before.scheme ?? '', at: c.before.at }, reason: c.reason, byName: c.byName, at: c.at })),
});

/** The bill's latest payment, deposit or refund (by time), or null. */
function lastPayment(b) {
  const last = (b.payments ?? []).reduce((a, p) => (!a || (p.at && p.at > a.at) ? p : a), null);
  return last ? { at: last.at, mode: last.mode, kind: last.kind } : null;
}

/** One bill as the website gets it; `full` adds the lines and payments. */
export function billView(b, { patients, stays, doctors = new Map(), departments = new Map() }, { full = true } = {}) {
  const p = patients.get(String(b.patientId));
  const s = b.admissionId ? stays.get(String(b.admissionId)) : null;
  const t = totals(b);
  return {
    id: String(b._id),
    number: b.number,
    kind: b.kind,
    date: isoDay(b.on),
    // duplicateOf: this bill is on a record marked as a duplicate – the note reception sees ({ id, mrn } of the main record)
    doctorName: p?.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? '') : '',
    doctorDepartment: p?.assignedDoctor ? (departments.get(String(p.assignedDoctor)) ?? '') : '',
    // age: as printed on the bill (a baby's record has none here)
    patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn, phone: p.phone ?? '', age: p.careType === 'newborn' ? null : currentAge(p), duplicateOf: isDuplicate(p) ? { id: String(p.duplicateOf.patient), mrn: p.duplicateOf.mrn } : null } : null,
    stay: s ? { ward: s.ward ?? '', bed: s.bed ?? '', admittedAt: s.admittedAt, dischargedAt: s.dischargedAt ?? null, inHospital: s.status === 'admitted' } : null,
    ...t,
    items: (b.lines ?? []).filter((l) => !l.removed).length,
    priceNotSet: (b.lines ?? []).some((l) => !l.removed && l.ratePaise === 0),
    discountInfo: b.discount?.paise ? { mode: b.discount.mode, value: b.discount.value, reason: b.discount.reason ?? '', byName: b.discount.byName ?? '' } : null,
    cancelled: b.status === 'cancelled' && b.cancelled ? { reason: b.cancelled.reason ?? '', byName: b.cancelled.byName ?? '', at: b.cancelled.at ?? null } : null,
    insurer: b.insurance?.insurer ?? '', // who the claim is with (lists); every detail only with the full bill
    lastPayment: lastPayment(b), // the latest money in or out, for lists: when, how and what kind (null: none yet)
    ...(full ? { lines: (b.lines ?? []).map((l) => lineView(l, doctors)), payments: (b.payments ?? []).map(paymentView), insurance: insuranceView(b.insurance) } : {}),
  };
}

/** Views of many bills. */
export async function billViews(tenantId, bills, opts) {
  const l = await lookups(tenantId, bills);
  return bills.map((b) => billView(b, l, opts));
}

/** The bill with this id in this hospital (404 otherwise), lean. */
export async function findBill(req, id) {
  const bill = await Bill.findOne({ tenantId: req.tenantId, _id: id }).lean();
  if (!bill) throw new HttpError(404, 'Bill not found.', 'NOT_FOUND');
  return bill;
}

/** Doctors' names (users looked up by id only). */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  return new Map((await User.find({ _id: { $in: unique } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
}

export { padded };

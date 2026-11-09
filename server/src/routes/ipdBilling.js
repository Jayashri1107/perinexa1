import { Router } from 'express';
import { z } from 'zod';
import { MAX_PAISE, MIN_REASON } from '../billing/billingRules.js';
import { billViews, concessionAuthorities, findBill, freshBill, openStayBill, pushLines, refuseFetalSex, stampOf, userNames } from '../billing/billingService.js';
import { bedDays, totals } from '../billing/money.js';
import { addDays, hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { DESK_DISCHARGE_TYPES, DISCHARGE_TYPE_LABELS, MEDICAL_ROLES, dischargeTypeFor } from '../inpatient/dischargeTypes.js';
import { Admission } from '../models/Admission.js';
import { Bill } from '../models/Bill.js';
import { Membership, hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { isClosed } from '../patients/deathRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, departmentListed } from '../utils/patientAccess.js';
import { safeText } from '../utils/pcpndt.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';

// The IPD desk (/api/billing/ipd – docs/IPD_DISCHARGE_BILLING_PLAN.md, 9 Nov 2026), like the hospital's old HIMS
// "IPD" menu and its bill window. Mounted inside the billing router, so only reception, the billing department and the
// hospital admin reach it.
//  - GET  /stays                     patients in hospital, or discharged in the last 30 days (search by name, UHID, IPD no.)
//  - GET  /stays/:id                 the bill window: the stay, its bill, her other bills, advances, bed transfers
//  - POST /stays/:id/discharge       the discharge details after the doctor's card: type, doctor, remark
//  - POST /bills/:id/final           the final bill (after the discharge): bed days stop, items are locked
//  - POST /bills/:id/reopen          reopen a final bill, with the reason
//  - PUT  /bills/:id/admin-charge    the administrative charges of a stay's bill (0 takes them off)
// Every query has this hospital's tenantId; the audit log gets ids and amounts only.

export const ipdBillingRouter = Router();

const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const notFound = (message) => new HttpError(404, message, 'NOT_FOUND');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const ADMIN_CHARGE_KEY = 'admin-charge';
const ADMIN_CHARGE_NAME = 'Administrative charges';
const DISCHARGED_DAYS = 30;

const medicalOf = (req) => hasRole(req.membership, ...MEDICAL_ROLES);
const billIds = (b, extra = {}) => ({ billId: String(b._id), number: b.number, patientId: String(b.patientId), ...extra });

// The fields the department rule needs (utils/patientAccess.js)
const DEPT = { assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 };
/** A doctor (e.g. also the hospital admin) whose departments do not include her: "not found" (departments, 9 Nov 2026). */
async function assertPatientShown(req, patientId) {
  const p = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, DEPT).lean();
  assertNotHidden(req, p);
}

async function findStay(req, id) {
  const stay = await Admission.findOne({ tenantId: req.tenantId, _id: parse(objectId, id) }).lean();
  if (!stay) throw notFound('This stay was not found.');
  await assertPatientShown(req, stay.patientId);
  return stay;
}

/** The stay's bill: its open one (made if she is still in hospital), else its latest; null when it never had one. */
async function stayBill(req, stay) {
  if (stay.status === 'admitted') return freshBill(req, await openStayBill(req, stay));
  const bill = (await Bill.findOne({ tenantId: req.tenantId, admissionId: stay._id, status: 'open' }).lean()) ?? (await Bill.findOne({ tenantId: req.tenantId, admissionId: stay._id }).sort({ createdAt: -1 }).lean());
  return bill ? freshBill(req, bill) : null;
}

function dischargeView(req, stay) {
  const d = stay.dischargeInfo;
  if (!d) return null;
  return { ...dischargeTypeFor(d.type, { medical: medicalOf(req) }), doctorName: d.doctorName ?? '', remark: d.remark ?? '', byName: d.byName ?? '', at: d.at ?? null };
}

// ---------- The list ----------

ipdBillingRouter.get('/stays', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['admitted', 'discharged']).default('admitted'), q: z.string().trim().max(60).default('') }), req.query);
  const filter = { tenantId: req.tenantId, status: q.status };
  if (q.status === 'discharged') filter.dischargedAt = { $gte: hospitalDayStart(addDays(hospitalToday(req.now), -DISCHARGED_DAYS)) };
  if (q.q) {
    const text = new RegExp(escapeRegex(q.q), 'i');
    const found = await Patient.find({ tenantId: req.tenantId, $or: [{ fullName: text }, { mrn: text }] }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ patientId: { $in: found.map((p) => p._id) } }, { ipdNo: text }];
  }
  const stays = await Admission.find(filter).sort(q.status === 'admitted' ? { admittedAt: -1 } : { dischargedAt: -1 }).limit(200).lean();
  const patients = new Map((stays.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: stays.map((s) => s.patientId) } }, { fullName: 1, mrn: 1, ...DEPT }).lean() : []).map((p) => [String(p._id), p]));
  const bills = stays.length ? await Bill.find({ tenantId: req.tenantId, admissionId: { $in: stays.map((s) => s._id) }, status: 'open' }).lean() : [];
  const billOf = new Map(bills.map((b) => [String(b.admissionId), b]));
  const doctors = await userNames(stays.map((s) => (s.doctorName ? null : patients.get(String(s.patientId))?.assignedDoctor)));
  const list = [];
  for (const s of stays) {
    const p = patients.get(String(s.patientId));
    if (!p || !departmentListed(req, p)) continue; // another department's patient: left out (departments, 9 Nov 2026)
    const b = billOf.get(String(s._id));
    list.push({
      id: String(s._id),
      ipdNo: s.ipdNo ?? null,
      admittedAt: s.admittedAt,
      dischargedAt: s.dischargedAt ?? null,
      ward: s.ward ?? '',
      bed: s.bed ?? '',
      doctorName: s.doctorName || (p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? '') : ''),
      status: s.status,
      discharge: dischargeView(req, s),
      cleared: Boolean(s.clearance),
      bill: b ? { id: String(b._id), number: b.number, final: Boolean(b.final), ...totals(b) } : null,
      patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn },
    });
  }
  await audit(req, 'IPD_STAYS_VIEWED', { details: { status: q.status, count: list.length, searched: Boolean(q.q) } });
  res.json({ stays: list });
});

// ---------- The bill window ----------

ipdBillingRouter.get('/stays/:id', async (req, res) => {
  const stay = await findStay(req, req.params.id);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: stay.patientId }).lean();
  if (!patient) throw notFound('This stay was not found.');
  const bill = await stayBill(req, stay);
  const others = await Bill.find({ tenantId: req.tenantId, patientId: patient._id, ...(bill ? { _id: { $ne: bill._id } } : {}) }).sort({ on: -1 }).limit(30).lean();
  const [billView] = bill ? await billViews(req.tenantId, [bill]) : [null];
  const otherViews = await billViews(req.tenantId, others, { full: false });
  const doctorMembers = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const doctors = [...(await userNames(doctorMembers.map((m) => m.userId)))].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const ownDoctor = patient.assignedDoctor ? ((await userNames([patient.assignedDoctor])).get(String(patient.assignedDoctor)) ?? '') : '';
  const closed = isClosed(patient);
  if (bill) await audit(req, 'BILL_VIEWED', { details: billIds(bill, { admissionId: String(stay._id) }) });
  res.json({
    stay: {
      id: String(stay._id),
      ipdNo: stay.ipdNo ?? null,
      status: stay.status,
      admittedAt: stay.admittedAt,
      dischargedAt: stay.dischargedAt ?? null,
      dischargedByName: stay.dischargedByName ?? '', // the doctor who signed the discharge card
      days: bedDays(stay.admittedAt, stay.dischargedAt, req.now ?? new Date()),
      ward: stay.ward ?? '',
      bed: stay.bed ?? '',
      mlc: Boolean(stay.mlc),
      doctorName: stay.doctorName || ownDoctor,
      department: stay.department ?? '',
      payer: bill?.insurance?.insurer || stay.checklist?.payerName || '',
      discharge: dischargeView(req, stay),
      clearance: stay.clearance ? { passNo: stay.clearance.passNo, byName: stay.clearance.byName ?? '', at: stay.clearance.at ?? null } : null,
      moves: (stay.moves ?? []).map((m) => ({ fromWard: m.fromWard ?? '', fromBed: m.fromBed ?? '', toWard: m.toWard ?? '', toBed: m.toBed ?? '', byName: m.byName ?? '', at: m.at ?? null })),
    },
    patient: { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn, age: patient.careType === 'newborn' ? null : currentAge(patient, req.now ?? new Date()), closed },
    bill: billView,
    previousBills: otherViews,
    // For the discharge form: the types the desk may choose (a closed record's type is taken from the record), the doctors
    dischargeTypes: DESK_DISCHARGE_TYPES.map((t) => ({ key: t, label: DISCHARGE_TYPE_LABELS[t] })),
    doctors,
    authorities: await concessionAuthorities(req.tenantId),
    canReopen: hasRole(req.membership, 'billing', 'admin'),
  });
});

// ---------- Discharge details ----------

const dischargeSchema = z
  .object({
    type: z.enum(DESK_DISCHARGE_TYPES).optional(),
    doctorId: objectId.nullable().optional(),
    remark: safeText('Remark', 300).default(''),
  })
  .strict();

ipdBillingRouter.post('/stays/:id/discharge', async (req, res) => {
  const body = parse(dischargeSchema, req.body);
  const stay = await findStay(req, req.params.id);
  if (stay.status !== 'discharged') throw conflict('The doctor signs the discharge card first. Then record the discharge here.', 'NOT_DISCHARGED');
  if (stay.clearance) throw conflict(`She has been cleared for leaving (gate pass ${stay.clearance.passNo}): the discharge can no longer be changed.`, 'CLEARED');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: stay.patientId }, { death: 1, careType: 1, mrn: 1 }).lean();
  // A closed record's type comes from the record; the desk never chooses it
  const type = isClosed(patient) ? 'death' : body.type;
  if (!type) throw invalid({ type: 'Choose the discharge type.' });
  let doctor = null;
  if (body.doctorId) {
    if (!(await Membership.exists({ tenantId: req.tenantId, userId: body.doctorId, roles: 'doctor', isActive: true }))) throw invalid({ doctorId: 'Choose a doctor of this hospital.' });
    doctor = { id: body.doctorId, name: (await userNames([body.doctorId])).get(String(body.doctorId)) ?? '' };
  }
  await refuseFetalSex(req, stay.patientId, { remark: body.remark });
  const dischargeInfo = { type, doctorId: doctor?.id ?? null, doctorName: doctor?.name || stay.dischargedByName || '', remark: body.remark.trim(), ...stampOf(req) };
  const r = await Admission.updateOne({ tenantId: req.tenantId, _id: stay._id, status: 'discharged', clearance: null }, { $set: { dischargeInfo } });
  if (!r.matchedCount) throw conflict('Someone cleared her for leaving at the same moment. Reload the page.', 'CLEARED');
  // The audit log (read by the hospital admin) never names a death either: "closed"
  await audit(req, 'DISCHARGE_DETAILS_RECORDED', { details: { patientId: String(stay.patientId), mrn: patient?.mrn, admissionId: String(stay._id), type: type === 'death' ? 'closed' : type, changed: Boolean(stay.dischargeInfo) } });
  res.json({ discharge: dischargeView(req, { ...stay, dischargeInfo }) });
});

// ---------- Final bill, reopen, administrative charges ----------

async function stayBillFor(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const bill = await findBill(req, id);
  if (bill.kind !== 'ipd' || !bill.admissionId) throw conflict('Only the bill of a stay in hospital has a final bill and administrative charges.', 'NOT_IPD');
  if (bill.status === 'cancelled') throw conflict('This bill was cancelled.', 'CANCELLED');
  const stay = await Admission.findOne({ tenantId: req.tenantId, _id: bill.admissionId }).lean();
  if (!stay) throw notFound('This stay was not found.');
  await assertPatientShown(req, stay.patientId); // departments, 9 Nov 2026
  return { bill, stay };
}
const viewOf = async (req, bill) => (await billViews(req.tenantId, [bill]))[0];

ipdBillingRouter.post('/bills/:id/final', async (req, res) => {
  parse(z.object({}).strict(), req.body ?? {});
  const { bill, stay } = await stayBillFor(req);
  if (stay.status !== 'discharged') throw conflict('She is still in hospital: print the interim bill. The final bill is made after the discharge card is signed.', 'NOT_DISCHARGED');
  if (!stay.dischargeInfo) throw conflict('Record the discharge (type, doctor, remark) first.', 'NO_DISCHARGE_DETAILS');
  if (bill.final) throw conflict(`Already the final bill (${bill.final.byName}).`, 'FINAL');
  const fresh = await freshBill(req, bill); // the bed days up to the discharge, prices set since
  const after = await Bill.findOneAndUpdate({ tenantId: req.tenantId, _id: bill._id, status: 'open', final: null }, { $set: { final: stampOf(req) } }, { returnDocument: 'after' }).lean();
  if (!after) throw conflict('Someone changed this bill at the same moment. Reload the page.');
  await audit(req, 'BILL_FINALISED', { details: billIds(fresh, { admissionId: String(stay._id), totalPaise: totals(after).total, balancePaise: totals(after).balance }) });
  res.json({ bill: await viewOf(req, after) });
});

ipdBillingRouter.post('/bills/:id/reopen', async (req, res) => {
  if (!hasRole(req.membership, 'billing', 'admin')) throw new HttpError(403, 'The billing department or the hospital admin reopen a final bill.', 'FORBIDDEN');
  const body = parse(z.object({ reason: z.string().trim().min(MIN_REASON, 'Please write why the final bill is reopened.').max(200) }).strict(), req.body);
  const { bill, stay } = await stayBillFor(req);
  if (!bill.final) throw conflict('This bill is not final.', 'NOT_FINAL');
  if (stay.clearance) throw conflict(`She has been cleared for leaving (gate pass ${stay.clearance.passNo}): a change now is a refund or a new bill.`, 'CLEARED');
  await refuseFetalSex(req, bill.patientId, { reason: body.reason });
  const after = await Bill.findOneAndUpdate(
    { tenantId: req.tenantId, _id: bill._id, final: { $ne: null } },
    { $set: { final: null }, $push: { reopened: { ...stampOf(req), reason: body.reason } } },
    { returnDocument: 'after' },
  ).lean();
  if (!after) throw conflict('Someone changed this bill at the same moment. Reload the page.');
  await audit(req, 'BILL_REOPENED', { details: billIds(bill, { admissionId: String(stay._id), reason: body.reason }) });
  res.json({ bill: await viewOf(req, after) });
});

ipdBillingRouter.put('/bills/:id/admin-charge', async (req, res) => {
  const body = parse(z.object({ amountPaise: z.number().int().min(0).max(MAX_PAISE) }).strict(), req.body);
  const { bill, stay } = await stayBillFor(req);
  if (bill.final) throw conflict('This is the final bill. Reopen it (with the reason) to change its items.', 'FINAL');
  const current = bill.lines.filter((l) => l.key === ADMIN_CHARGE_KEY && !l.removed);
  if (current.length === 1 && current[0].amountPaise === body.amountPaise) return res.json({ bill: await viewOf(req, bill) });
  if (!current.length && body.amountPaise === 0) return res.json({ bill: await viewOf(req, bill) });
  for (const line of current) {
    await Bill.updateOne(
      { tenantId: req.tenantId, _id: bill._id, final: null },
      { $set: { 'lines.$[l].removed': { ...stampOf(req), reason: 'Administrative charges changed' } } },
      { arrayFilters: [{ 'l._id': line._id, 'l.removed': null }] },
    );
  }
  const after = body.amountPaise
    ? await pushLines(req, bill._id, [{ key: ADMIN_CHARGE_KEY, name: ADMIN_CHARGE_NAME, group: 'other', qty: 1, ratePaise: body.amountPaise, source: 'manual' }])
    : await Bill.findOne({ tenantId: req.tenantId, _id: bill._id }).lean();
  if (!after) throw conflict('This bill changed at the same moment. Reload the page.');
  await audit(req, 'BILL_ADMIN_CHARGE_SET', { details: billIds(bill, { admissionId: String(stay._id), amountPaise: body.amountPaise, beforePaise: current.reduce((s, l) => s + l.amountPaise, 0) }) });
  res.json({ bill: await viewOf(req, after) });
});

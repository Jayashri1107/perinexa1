import { Router } from 'express';
import { notify } from '../notifications/notify.js';
import { billLabCancelled, billLabOrdered } from '../billing/hooks.js';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient, currentAge } from '../models/Patient.js';
import { User } from '../models/User.js';
import { markDoneFromLab, planCtx, syncPlanSafely } from '../careplans/plansService.js';
import { refreshPatientRiskSafely } from '../careplans/templatesService.js';
import { ensureLabPackages } from '../lab/labPackages.js';
import { FLAGS, OTHER_TEST, flagFor, isAbnormal, labNumber, testsFor } from '../lab/labTests.js';
import {
  DEPARTMENT_KEYS,
  REJECT_REASONS,
  catalogueView,
  dueAt,
  ensureSampleNo,
  fieldFor,
  labCatalogue,
  labSetup,
  nextSampleNo,
  rangeContext,
  setupOf,
  shownName,
} from '../lab/labSetup.js';
import { LabPackage } from '../models/LabPackage.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { findPatient } from '../utils/patientLookup.js';
import { PCPNDT_MESSAGE, mentionsFetalSex, safeText } from '../utils/pcpndt.js';
import { hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';
import { documentOffer, offerView, sendPatientPdf } from '../visits/whatsappDocuments.js';
import { randomBytes } from 'node:crypto';
import { QcRun } from '../models/QcRun.js';
import { Referrer } from '../models/Referrer.js';
import { Membership } from '../models/Membership.js';
import { takeStock } from '../lab/stock.js';
import { Bill } from '../models/Bill.js';
import { nextNumber } from '../models/Counter.js';
import { totals } from '../billing/money.js';
import { padded } from '../billing/billingService.js';

// The lab module (Version 2; the full lab system of docs/LAB_LIMS_PLAN.md). Two routers:
//  - patientLabRouter, /api/patients/:id/lab-orders: a patient's orders and results (those who may see the
//    medical details), and new orders (the treating or an unassigned doctor, RMOs);
//  - labRouter, /api/lab: the test list, the lab's worklist, Find and the register, one order (labels, collect,
//    reject, results, check, outside lab, report files, printed report, cancel) and the doctor's review.
// Who may do what:
//  - lab staff see only the patient's name, number, type of care and age, the tests and the doctor's note to the
//    lab – never the record or the doctor's review comment; they print labels, collect, reject a sample, enter
//    results, send tests to an outside lab, upload report files and print the report;
//  - nurses may mark a sample collected (and print its labels); doctors and RMOs may also enter results (a test
//    done at the bedside or a report from outside);
//  - with the hospital's check on (LabSetup), results go to the doctor only once a second person checked them;
//  - a doctor reviews the results (the treating or an unassigned doctor). A reviewed result completes the
//    matching care-plan items. A change after the report needs a reason, keeps the earlier results and goes
//    back to the doctor.
// The audit log gets ids only, never a value, a test name or a patient's name.

export const labRouter = Router();
export const patientLabRouter = Router({ mergeParams: true });

const LAB_ROLES = ['lab', 'doctor', 'rmo', 'nurse'];
const MAX_FILES = 5;
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const notFound = (message = 'This lab order was not found.') => new HttpError(404, message, 'NOT_FOUND');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const rev = z.number('The version you edited is missing – please reload the page').int().min(0);
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now });
const ids = (order, extra = {}) => ({ patientId: String(order.patientId), orderId: String(order._id), ...extra });
const OPEN = ['ordered', 'collected', 'entered'];
const DONE = ['reported', 'reviewed'];

// ---------- Who may do what ----------

const isLab = (req) => hasRole(req.membership, 'lab');

/** What this person may do with this patient's lab orders. (Also used by the copy of the whole record.) */
export function labAccess(req, patient) {
  const a = patientAccess(req, patient);
  const clinical = a.view.has('pregnancy'); // may see the medical details (and so the results and the review)
  const lab = isLab(req);
  return {
    clinical,
    lab,
    view: clinical || lab,
    order: a.editClinical,
    collect: lab || (clinical && hasRole(req.membership, 'nurse', 'doctor', 'rmo')),
    report: lab || (a.editClinical && hasRole(req.membership, 'doctor', 'rmo')),
    review: a.editClinical && hasRole(req.membership, 'doctor'),
    cancel: lab || a.editClinical,
  };
}
function assertCan(access, what) {
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  if (access[what]) return;
  const words = {
    order: "Only the patient's doctor or an RMO can order tests.",
    collect: 'Only the lab and nurses mark samples collected.',
    report: 'Only the lab (or the patient\'s doctor or an RMO) can enter results.',
    review: "Only the patient's doctor (or a doctor for an unassigned patient) reviews results.",
    cancel: "Only the lab or the patient's doctor or an RMO can cancel an order.",
  };
  throw forbidden(words[what]);
}

/**
 * Whether this person may check results entered by someone else (the hospital's check, LabSetup): one of the people
 * the hospital chose, or – none chosen – any lab staff, doctor or RMO who may enter results for this patient.
 */
function mayVerify(req, access, setup) {
  if (!setup.verify || !access.report) return false;
  if (setup.verifierIds.length) return setup.verifierIds.includes(String(req.user._id));
  return hasRole(req.membership, 'lab', 'doctor', 'rmo');
}

labRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...LAB_ROLES)) throw forbidden('The lab module is for the lab, doctors, RMOs and nurses.');
  next();
});

// ---------- The view of an order ----------

const stampView = (s) => (s ? { byName: s.byName, at: s.at } : null);
const valueView = (v) => ({
  key: v.key,
  value: v.value,
  flag: v.flag,
  ...(v.name ? { name: v.name } : {}),
  ...(v.unit ? { unit: v.unit } : {}),
  ...(v.range ? { range: v.range } : {}),
  ...(v.deltaPercent != null ? { deltaPercent: v.deltaPercent } : {}),
  ...(v.bigChange ? { bigChange: true } : {}),
});
const outsideView = (o) => (o?.sent ? { labName: o.labName, ref: o.ref ?? '', sent: stampView(o.sent), received: stampView(o.received) } : null);
const testView = (t) => ({ key: t.key, name: t.name, values: (t.values ?? []).map(valueView), text: t.text ?? '', department: t.department ?? '', outside: outsideView(t.outside) });

/** Whether an order is past its due time: not reported yet and the time has passed, or reported after it. */
export function isLate(order, now) {
  if (!order.dueAt || order.status === 'cancelled') return false;
  const done = order.reported?.at ?? null;
  return done ? new Date(done) > new Date(order.dueAt) : new Date(now) > new Date(order.dueAt);
}

/**
 * One order; clinical: may see the doctor's review comment and the earlier results of an amended report, and the
 * name of the test package it was ordered with. Lab staff who may not see the medical details get the tests only: a
 * package name says why she is tested ("Recurrent pregnancy loss work-up") – more than the lab needs to do the work.
 * more: { canVerify, now } – worked out by the caller (the hospital's check needs its settings).
 */
export function orderView(order, access, more = {}) {
  const status = order.status;
  const outsideOpen = (order.tests ?? []).some((t) => t.outside?.sent && !t.outside?.received);
  return {
    id: String(order._id),
    patientId: String(order.patientId),
    visitId: order.visitId ? String(order.visitId) : null,
    status,
    urgent: Boolean(order.urgent),
    sampleNo: order.sampleNo ?? null,
    // Lab version 2 (docs/LAB_V2_PLAN.md): a walk-in order, its referrer and prescription; home collection; QC reason
    source: order.source ?? 'doctor',
    referrer: order.referrer?.name ? { id: order.referrer.id ? String(order.referrer.id) : null, name: order.referrer.name, kind: order.referrer.kind } : null,
    prescription: order.prescription ?? '',
    home: order.home ? { address: order.home.address ?? '', on: order.home.on ?? null, time: order.home.time ?? '', collectorName: order.home.collectorName ?? '', collectorId: order.home.collectorId ? String(order.home.collectorId) : null, status: order.home.status, note: order.home.note ?? '', updated: stampView(order.home.updated) } : null,
    qcOverride: order.qcOverride ? { byName: order.qcOverride.byName, at: order.qcOverride.at, reason: order.qcOverride.reason } : null,
    verifyToken: DONE.includes(status) ? (order.verifyToken ?? null) : null,
    dueAt: order.dueAt ?? null,
    late: isLate(order, more.now ?? new Date()),
    tests: order.tests.map(testView),
    noteToLab: order.noteToLab ?? '',
    packages: access.clinical ? (order.packages ?? []).map((p) => (typeof p === 'string' ? { key: p, name: p } : { key: p.key, name: p.name, version: p.version, approved: p.approved })) : [],
    labNote: order.labNote ?? '',
    ordered: stampView(order.ordered),
    collected: stampView(order.collected),
    received: stampView(order.received),
    entered: stampView(order.entered),
    verified: stampView(order.verified),
    reported: stampView(order.reported),
    lastSaved: stampView(order.lastSaved),
    reviewed: order.reviewed ? { byName: order.reviewed.byName, at: order.reviewed.at, ...(access.clinical ? { comment: order.reviewed.comment ?? '' } : {}) } : null,
    cancelled: order.cancelled ? { byName: order.cancelled.byName, at: order.cancelled.at, reason: order.cancelled.reason ?? '' } : null,
    rejections: (order.rejections ?? []).map((r) => ({ byName: r.byName, at: r.at, reason: r.reason, reasonText: REJECT_REASONS[r.reason] ?? r.reason, note: r.note ?? '' })),
    sentBack: (order.sentBack ?? []).map((r) => ({ byName: r.byName, at: r.at, reason: r.reason ?? '' })),
    amendments: (order.amendments ?? []).map((m) => ({
      byName: m.byName,
      at: m.at,
      reason: m.reason ?? '',
      ...(access.clinical ? { tests: (m.tests ?? []).map(testView), labNote: m.labNote ?? '', reviewedByName: m.reviewedByName ?? null, reviewedAt: m.reviewedAt ?? null } : {}),
    })),
    files: (order.files ?? []).map((f) => ({ id: String(f.fileId), fileName: f.fileName, mediaType: f.mediaType, size: f.size, byName: f.byName, at: f.at })),
    abnormal: Boolean(order.abnormal),
    rev: order.rev ?? 0,
    access: {
      canCollect: access.collect && status === 'ordered',
      canLabel: access.collect && ['ordered', 'collected'].includes(status),
      canReceive: access.report && status === 'collected' && !order.received,
      canReject: access.report && status === 'collected',
      canReport: access.report && status !== 'cancelled',
      canVerify: Boolean(more.canVerify) && status === 'entered' && String(order.entered?.by) !== String(more.userId),
      canSendOutside: access.report && OPEN.includes(status),
      canReceiveOutside: access.report && outsideOpen && status !== 'cancelled',
      canPrint: access.view && DONE.includes(status),
      canReview: access.review && status === 'reported' && order.source !== 'walk_in',
      canHome: access.collect && status === 'ordered',
      canCancel: access.cancel && ['ordered', 'collected'].includes(status),
    },
  };
}

/** The patient as the lab sees them (and as the lists show them). */
const patientBrief = (p, doctorName = null) => ({ id: String(p._id), fullName: p.fullName, mrn: p.mrn, careType: p.careType, age: p.careType === 'newborn' ? null : currentAge(p), assignedDoctorName: doctorName });

async function loadOrder(req) {
  const orderId = parse(objectId, req.params.orderId);
  const order = await LabOrder.findOne({ _id: orderId, tenantId: req.tenantId });
  if (!order) throw notFound();
  const patient = await Patient.findOne({ _id: order.patientId, tenantId: req.tenantId });
  if (!patient) throw notFound();
  return { order, patient, access: labAccess(req, patient) };
}
/** The order's view for this person, with the hospital's check worked out. */
async function viewFor(req, order, access, setup = null) {
  const s = setup ?? (await labSetup(req.tenantId));
  return orderView(order, access, { canVerify: mayVerify(req, access, s), userId: req.user._id, now: req.now });
}
// A reviewed haemoglobin counts for the risk level (the lowest Hb of this pregnancy – careplans/readings.js).
// After a doctor's review the level is worked out again and the care plan follows. (A result changed after its
// review keeps counting as it was reviewed, until a doctor reviews the change – so nothing is done then.) Never
// fails the review, and nothing about the level is audited. Returns whether the level shown changed.
async function riskAfterLab(req, patient) {
  if (patient.careType !== 'antenatal') return false;
  const r = await refreshPatientRiskSafely(planCtx(req), patient._id);
  if (r.saved) await syncPlanSafely(planCtx(req), patient._id);
  return r.changed;
}

function checkRev(order, sent) {
  if (sent !== (order.rev ?? 0)) throw conflict('Someone changed this order meanwhile. The latest version is shown – please check it and try again.', 'STALE');
}

// ---------- A patient's orders ----------

const orderSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    tests: z
      .array(z.object({ key: z.string().min(1).max(40), name: safeText('Test name', 150).optional() }).strict())
      .min(1, 'Choose at least one test.')
      .max(30, 'At most 30 tests in one order.'),
    urgent: z.boolean().default(false),
    noteToLab: safeText('Note to the lab', 500).default(''),
    visitId: objectId.nullable().default(null),
    packages: z.array(z.string().max(60)).max(10).default([]), // keys of the hospital's test packages
  })
  .strict();

patientLabRouter.get('/', async (req, res) => {
  const patient = await findPatient(req);
  const access = labAccess(req, patient);
  if (!access.clinical) throw forbidden(isLab(req) ? 'The lab sees orders in the Lab worklist.' : "You can't see this patient's lab results.");
  const orders = await LabOrder.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(200);
  await audit(req, 'LAB_RESULTS_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  const setup = await labSetup(req.tenantId);
  res.json({ orders: await Promise.all(orders.map((o) => viewFor(req, o, access, setup))), canOrder: access.order && !isDuplicate(patient) && !isClosed(patient) });
});

patientLabRouter.post('/', async (req, res) => {
  const patient = await findPatient(req);
  const access = labAccess(req, patient);
  assertCan(access, 'order');
  const body = parse(orderSchema, req.body);
  const out = await createOrder(req, patient, access, body);
  res.status(201).json({ order: out });
});

/**
 * Makes an order for this patient (body: orderSchema's fields). extra: what a walk-in order adds (source, referrer,
 * prescription, home). Returns the order's view. A repeated request (a double click) returns the first order.
 */
async function createOrder(req, patient, access, body, extra = {}) {
  const repeat = await LabOrder.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) {
    if (String(repeat.patientId) !== String(patient._id)) throw conflict('This request was already used.');
    return viewFor(req, repeat, access);
  }
  // A record marked as a duplicate takes no new lab orders (orders already made on it are still finished there)
  refuseNewOnDuplicate(patient, 'lab');
  refuseNewOnClosed(patient, 'lab'); // nor a record closed after a death (an order already made is finished)
  const catalogue = await labCatalogue(req.tenantId);
  const fields = {};
  const tests = body.tests.map((t, i) => {
    if (t.key === OTHER_TEST) {
      if (!t.name || t.name.trim().length < 2) fields[`tests.${i}.name`] = 'Write the name of the test.';
      return { key: OTHER_TEST, name: (t.name ?? '').trim(), values: [], text: '', department: setupOf(catalogue, OTHER_TEST).department };
    }
    const test = catalogue.byKey.get(t.key);
    if (!test) {
      fields[`tests.${i}.key`] = 'This test is not on the hospital\'s test list. Reload the page and choose again.';
      return { key: t.key, name: t.key, values: [], text: '' };
    }
    if (!test.active) fields[`tests.${i}.key`] = `${test.name} is not offered by the lab at the moment.`;
    // A baby's record takes only baby tests; everyone else's only adult tests (the mother's are on her record).
    if (test.who !== testsFor(patient)) {
      fields[`tests.${i}.key`] = test.who === 'newborn' ? `${test.name} is a test for babies.` : `${test.name} is not a test for a baby – order the mother's tests on her own record.`;
    }
    return { key: t.key, name: test.name, values: [], text: '', department: test.department };
  });
  // The packages chosen: the hospital's own, in use, for this kind of patient. Recorded with their name and version.
  let packages = [];
  const keys = [...new Set(body.packages)];
  if (keys.length) {
    await ensureLabPackages(req.tenantId);
    const found = await LabPackage.find({ tenantId: req.tenantId, key: { $in: keys }, isActive: true, who: testsFor(patient) });
    if (found.length !== keys.length) fields.packages = 'A package chosen is not in use, or not for this patient. Reload the page and choose again.';
    packages = found.map((p) => ({ key: p.key, name: p.name, version: p.version, approved: p.status === 'approved' }));
  }
  const seen = new Set();
  tests.forEach((t, i) => {
    const k = t.key === OTHER_TEST ? `other:${t.name.toLowerCase()}` : t.key;
    if (seen.has(k)) fields[`tests.${i}.key`] = 'This test is already in the order.';
    seen.add(k);
  });
  if (Object.keys(fields).length) throw invalid(fields);
  const order = await LabOrder.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    visitId: body.visitId,
    urgent: body.urgent,
    tests,
    noteToLab: body.noteToLab,
    packages,
    sampleNo: await nextSampleNo(req.tenantId, req.now),
    dueAt: dueAt(req.now, tests.map((t) => setupOf(catalogue, t.key)), body.urgent),
    ordered: stampOf(req),
    clientRequestId: body.clientRequestId,
    ...extra,
  });
  await audit(req, 'LAB_ORDER_CREATED', { details: ids(order, { mrn: patient.mrn, tests: tests.length, ...(extra.source === 'walk_in' ? { walkIn: true } : {}) }) });
  await billLabOrdered(req, patient, order); // billing: each test
  // The lab is told of a new order (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): the count of tests, never their names
  await notify(req, { roles: ['lab'] }, { kind: 'lab', text: `New lab order: ${patient.fullName}, ${tests.length} test${tests.length > 1 ? 's' : ''}${body.urgent ? ' (urgent)' : ''}.`, link: `/lab/orders/${order._id}` });
  return viewFor(req, order, access);
}

// ---------- Walk-in and referred patients (Lab version 2 – docs/LAB_V2_PLAN.md) ----------
// The lab orders tests from an outside prescription (owner's decision, 17 Oct 2026): the referring doctor or centre
// (Lab → Referrers), or "self" with what she asked for. The order is reported by the lab (with the second-person check
// when the hospital has it on); it is not in the hospital doctors' review list and does not tick care plans.
const homeSchema = z
  .object({
    address: safeText('Address', 300).refine((t) => t.trim().length >= 5, 'Write the address for the collection'),
    on: z.iso.date('Choose the day'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the time'),
    collectorId: objectId.nullable().default(null),
  })
  .strict();
const walkInSchema = orderSchema
  .omit({ visitId: true, packages: true })
  .extend({
    patientId: objectId,
    referrerId: objectId.nullable().default(null),
    prescription: safeText('Prescription', 200).default(''),
    home: homeSchema.nullable().default(null),
    // The payment taken at the lab's counter (eLabAssist-style registration – owner, 17 Oct 2026): on the order's bill
    payment: z.object({ mode: z.enum(['cash', 'upi', 'card']), amountPaise: z.number().int().min(1).max(100_000_000), reference: safeText('Reference', 80).default('') }).strict().nullable().default(null),
  })
  .strict();

/**
 * The payment taken when the lab registers a walk-in: on the bill that holds this order's tests, at most what is due on
 * it, with a receipt number – as reception's "Take payment" (routes/billing.js). The cash is handed over at the end of
 * the day (Billing → Cash handover, which the lab now has). Returns { receipt, mode, amountPaise, billNumber, duePaise }.
 */
async function takeWalkInPayment(req, orderId, p) {
  const bill = await Bill.findOne({ tenantId: req.tenantId, status: 'open', 'lines.ref.id': orderId }).lean();
  if (!bill) throw conflict('The order is made, but its bill was not found: take the payment at the billing desk.', 'NO_BILL');
  const due = totals(bill).balance;
  if (p.amountPaise > due) throw invalid({ 'payment.amountPaise': `The order is made; at most ${(due / 100).toFixed(2)} is due on its bill – take the payment at the billing desk.` }, 'The payment was not taken.');
  const receipt = padded('R', await nextNumber(req.tenantId, 'receipt'));
  const entry = { receipt, kind: 'payment', mode: p.mode, amountPaise: p.amountPaise, reference: p.reference.trim(), scheme: '', ...stampOf(req) };
  await Bill.updateOne({ tenantId: req.tenantId, _id: bill._id, status: 'open' }, { $push: { payments: entry } });
  await audit(req, 'PAYMENT_RECEIVED', { details: { billId: String(bill._id), number: bill.number, patientId: String(bill.patientId), receipt, kind: 'payment', mode: p.mode, amountPaise: p.amountPaise } });
  return { receipt, mode: p.mode, amountPaise: p.amountPaise, billNumber: bill.number, duePaise: due - p.amountPaise };
}

/** The collector chosen for a home collection: lab staff of this hospital (or none yet). */
async function homeCollector(req, id) {
  if (!id) return { collectorId: null, collectorName: '' };
  const m = await Membership.findOne({ tenantId: req.tenantId, userId: id, isActive: true, roles: 'lab' }, { userId: 1 }).lean();
  if (!m) throw invalid({ 'home.collectorId': 'Choose someone from the lab.' });
  const u = await User.findById(id, { name: 1 }).lean();
  return { collectorId: m.userId, collectorName: u?.name ?? '' };
}

labRouter.post('/walk-in', async (req, res) => {
  if (!isLab(req)) throw forbidden('The lab enters walk-in orders.');
  const body = parse(walkInSchema, req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: body.patientId });
  if (!patient) throw notFound('Patient not found.');
  let referrer = null;
  if (body.referrerId) {
    const r = await Referrer.findOne({ tenantId: req.tenantId, _id: body.referrerId, active: true }).lean();
    if (!r) throw invalid({ referrerId: 'Choose a referrer from the list (or none).' });
    referrer = { id: r._id, name: r.name, kind: r.kind };
  }
  if (!referrer && body.prescription.trim().length < 3) throw invalid({ prescription: 'Choose the referring doctor, or write "Self – no prescription" and what she asked for.' });
  const home = body.home ? { address: body.home.address.trim(), on: new Date(`${body.home.on}T00:00:00Z`), time: body.home.time, ...(await homeCollector(req, body.home.collectorId)), status: 'scheduled', note: '', updated: stampOf(req) } : null;
  const { patientId, referrerId, prescription, home: _h, payment, ...order } = body;
  const access = labAccess(req, patient);
  const out = await createOrder(req, patient, access, { ...order, visitId: null, packages: [] }, { source: 'walk_in', referrer, prescription: prescription.trim(), home });
  const paid = payment ? await takeWalkInPayment(req, out.id, payment) : null;
  res.status(201).json({ order: out, ...(paid ? { payment: paid } : {}) });
});

// ---------- Home collection (Lab version 2) ----------

const HOME_NEXT = { scheduled: ['on_the_way', 'collected', 'failed'], on_the_way: ['collected', 'failed'], failed: ['scheduled'] };
labRouter.put('/orders/:orderId/home', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'collect');
  const body = parse(z.object({ rev, home: homeSchema.nullable() }).strict(), req.body);
  if (order.status !== 'ordered') throw conflict('The sample is already taken.');
  checkRev(order, body.rev);
  order.home = body.home ? { address: body.home.address.trim(), on: new Date(`${body.home.on}T00:00:00Z`), time: body.home.time, ...(await homeCollector(req, body.home.collectorId)), status: 'scheduled', note: '', updated: stampOf(req) } : null;
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_HOME_COLLECTION', { details: ids(order, { mrn: patient.mrn, status: order.home ? 'scheduled' : 'removed' }) });
  res.json({ order: await viewFor(req, order, access) });
});

labRouter.post('/orders/:orderId/home/status', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'collect');
  const body = parse(z.object({ rev, status: z.enum(['on_the_way', 'collected', 'failed', 'scheduled']), note: safeText('Note', 200).default('') }).strict(), req.body);
  if (!order.home) throw conflict('This order is not collected at home.');
  checkRev(order, body.rev);
  if (!(HOME_NEXT[order.home.status] ?? []).includes(body.status)) throw conflict('This step does not follow the last one. Reload the page.');
  if (body.status === 'failed' && body.note.trim().length < 3) throw invalid({ note: 'Write why the sample could not be collected.' });
  order.home.status = body.status;
  order.home.note = body.note.trim();
  order.home.updated = stampOf(req);
  if (body.status === 'collected' && order.status === 'ordered') {
    order.status = 'collected';
    order.collected = stampOf(req);
    await ensureSampleNo(order, req.now);
  }
  order.markModified('home');
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_HOME_COLLECTION', { details: ids(order, { mrn: patient.mrn, status: body.status }) });
  res.json({ order: await viewFor(req, order, access) });
});

// The day's home collections (all, or one collector's): address and time – lab staff and nurses
labRouter.get('/home', async (req, res) => {
  const q = parse(z.object({ date: z.iso.date().optional(), mine: z.enum(['1', '']).optional() }).strict(), req.query);
  const day = q.date ? new Date(`${q.date}T00:00:00Z`) : hospitalToday(req.now);
  const orders = await LabOrder.find({ tenantId: req.tenantId, 'home.on': day, status: { $ne: 'cancelled' }, ...(q.mine === '1' ? { 'home.collectorId': req.user._id } : {}) }).sort({ 'home.time': 1 }).limit(300);
  const staff = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: 'lab' }, { userId: 1 }).lean();
  const names = new Map((await User.find({ _id: { $in: staff.map((m) => m.userId) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  res.json({ date: day.toISOString().slice(0, 10), orders: await withPatients(req, orders, (a) => a.view), collectors: [...names].map(([id, name]) => ({ id, name })) });
});

// ---------- The test list ----------

labRouter.get('/tests', async (req, res) => {
  res.json(catalogueView(await labCatalogue(req.tenantId)));
});

// ---------- Lists ----------

// The lab's worklist: to collect (ordered), to report (collected), to check (entered, with the check on), tests at an
// outside lab, and reported in the last 7 days. Urgent orders first, then the oldest. A department narrows each list
// to orders with a test of that department. Doctors, RMOs and nurses see only patients whose medical details they may
// see.
const LISTS = {
  collect: { filter: { status: 'ordered' }, sort: { urgent: -1, createdAt: 1 } },
  receive: { filter: { status: 'collected', received: null }, sort: { urgent: -1, 'collected.at': 1 } },
  report: { filter: { status: 'collected', received: { $ne: null } }, sort: { urgent: -1, createdAt: 1 } },
  verify: { filter: { status: 'entered' }, sort: { urgent: -1, createdAt: 1 } },
  outside: { filter: { status: { $ne: 'cancelled' }, tests: { $elemMatch: { 'outside.sent': { $ne: null }, 'outside.received': null } } }, sort: { createdAt: 1 } },
  home: { filter: { status: 'ordered', 'home.status': { $in: ['scheduled', 'on_the_way'] } }, sort: { 'home.on': 1, 'home.time': 1 } },
  done: { filter: { status: { $in: DONE } }, sort: { 'reported.at': -1 } },
};

async function withPatients(req, orders, keep, setup = null) {
  const pids = [...new Set(orders.map((o) => String(o.patientId)))];
  const patients = pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }) : [];
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const names = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  const s = setup ?? (await labSetup(req.tenantId));
  return orders
    .map((o) => {
      const p = byId.get(String(o.patientId));
      if (!p) return null;
      const access = labAccess(req, p);
      if (!keep(access)) return null;
      const view = orderView(o, access, { canVerify: mayVerify(req, access, s), userId: req.user._id, now: req.now });
      return { ...view, patient: patientBrief(p, p.assignedDoctor ? (names.get(String(p.assignedDoctor)) ?? null) : null) };
    })
    .filter(Boolean);
}

const departmentParam = z.enum(['', ...DEPARTMENT_KEYS]).default('');
const byDepartment = (department) => (department ? { 'tests.department': department } : {});

labRouter.get('/worklist', async (req, res) => {
  const { list, department } = parse(z.object({ list: z.enum(Object.keys(LISTS)).default('collect'), department: departmentParam }), req.query);
  const { filter, sort } = LISTS[list];
  const since = new Date(req.now.getTime() - 7 * 24 * 3600 * 1000);
  const where = { tenantId: req.tenantId, ...filter, ...byDepartment(department), ...(list === 'done' ? { 'reported.at': { $gte: since } } : {}) };
  const orders = await LabOrder.find(where).sort(sort).limit(300);
  const setup = await labSetup(req.tenantId);
  const counted = Object.entries(LISTS).filter(([k]) => k !== 'done');
  const counts = {};
  for (const [k, l] of counted) counts[k] = await LabOrder.countDocuments({ tenantId: req.tenantId, ...l.filter, ...byDepartment(department) });
  // Counts are hospital-wide for the lab; for others they are of the patients they may see.
  const shown = await withPatients(req, orders, (a) => a.view, setup);
  if (!isLab(req)) {
    for (const [k, l] of counted) {
      // Only the patient of each order is read here, so the orders are counted by who may see their patient (not
      // passed through withPatients, which needs the whole order)
      const all = await LabOrder.find({ tenantId: req.tenantId, ...l.filter, ...byDepartment(department) }, { patientId: 1 }).limit(1000).lean();
      const pids = [...new Set(all.map((o) => String(o.patientId)))];
      const patients = pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }) : [];
      const visible = new Set(patients.filter((p) => labAccess(req, p).view).map((p) => String(p._id)));
      counts[k] = all.filter((o) => visible.has(String(o.patientId))).length;
    }
  }
  res.json({ list, department, orders: shown, counts, isLab: isLab(req), verify: setup.verify });
});

// Results waiting for a doctor's review: the doctor's own and unassigned patients. Abnormal results first.
labRouter.get('/to-review', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) return res.json({ orders: null });
  const orders = await LabOrder.find({ tenantId: req.tenantId, status: 'reported', source: { $ne: 'walk_in' } }).sort({ abnormal: -1, 'reported.at': 1 }).limit(300);
  res.json({ orders: await withPatients(req, orders, (a) => a.review) });
});

// Find (feature 6): by sample number (a label's barcode "261017-0003-2" finds its order), patient number or name,
// between two dates, in one status. Only orders whose patient this person may see. The audit log records the search
// with how many orders were listed – never what was typed (a name).
const STATUS_FILTER = ['', 'ordered', 'collected', 'entered', 'reported', 'reviewed', 'cancelled', 'late', 'rejected', 'outside'];
const dateRange = z
  .object({ from: z.iso.date('From: please enter a valid date').optional(), to: z.iso.date('To: please enter a valid date').optional() })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: 'The first date must be before the second.', path: ['to'] });

function rangeFilter(from, to) {
  if (!from && !to) return {};
  const at = {};
  if (from) at.$gte = hospitalDayStart(new Date(`${from}T00:00:00Z`));
  if (to) at.$lt = hospitalDayStart(new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000));
  return { 'ordered.at': at };
}
function statusFilter(status, now) {
  if (!status) return {};
  if (status === 'late') return { status: { $in: OPEN }, dueAt: { $ne: null, $lt: now } };
  if (status === 'rejected') return { 'rejections.0': { $exists: true } };
  if (status === 'outside') return { tests: { $elemMatch: { 'outside.sent': { $ne: null } } } };
  return { status };
}

labRouter.get('/search', async (req, res) => {
  const q = parse(
    z.object({ q: z.string().trim().max(100).default(''), status: z.enum(STATUS_FILTER).default(''), department: departmentParam, from: z.string().optional(), to: z.string().optional() }),
    req.query,
  );
  const dates = parse(dateRange, { from: q.from || undefined, to: q.to || undefined });
  const where = { tenantId: req.tenantId, ...rangeFilter(dates.from, dates.to), ...statusFilter(q.status, req.now), ...byDepartment(q.department) };
  const text = q.q;
  if (text) {
    const sample = text.match(/^(\d{6}-\d{4})(?:-\d{1,2})?$/);
    if (sample) where.sampleNo = sample[1];
    else {
      const patients = await Patient.find(
        { tenantId: req.tenantId, $or: [{ mrn: text.toUpperCase() }, { fullName: { $regex: escapeRegex(text), $options: 'i' } }] },
        { _id: 1 },
      )
        .limit(200)
        .lean();
      where.patientId = { $in: patients.map((p) => p._id) };
    }
  }
  if (!text && !dates.from && !dates.to && !q.status) throw invalid({ q: 'Type a sample number, a patient number or a name, or choose dates.' });
  const orders = await LabOrder.find(where).sort({ 'ordered.at': -1 }).limit(200);
  const shown = await withPatients(req, orders, (a) => a.view);
  await audit(req, 'LAB_ORDERS_SEARCHED', { details: { results: shown.length } });
  res.json({ orders: shown, more: orders.length === 200 });
});

// The lab register (feature 8): every order made between two dates (at most 62 days), in one department or all,
// with counts. The names shown are only those of patients this person may see; a confidential test is listed under
// its neutral name. Audited with the dates and the number of orders.
const MAX_REGISTER_DAYS = 62;
labRouter.get('/register', async (req, res) => {
  const q = parse(z.object({ from: z.string(), to: z.string(), department: departmentParam }), req.query);
  const { from, to } = parse(dateRange, { from: q.from, to: q.to });
  if ((new Date(to) - new Date(from)) / 86400000 + 1 > MAX_REGISTER_DAYS) throw invalid({ to: `At most ${MAX_REGISTER_DAYS} days at a time.` });
  const orders = await LabOrder.find({ tenantId: req.tenantId, ...rangeFilter(from, to), ...byDepartment(q.department) }).sort({ 'ordered.at': 1, _id: 1 }).limit(3000);
  const shown = await withPatients(req, orders, (a) => a.view);
  const rows = shown.map((o) => ({ ...o, tests: o.tests.map((t) => ({ ...t, name: shownName(t), values: [], text: '' })), labNote: '', noteToLab: '' }));
  const count = (fn) => rows.filter(fn).length;
  const summary = {
    orders: rows.length,
    tests: rows.reduce((n, o) => n + o.tests.length, 0),
    collected: count((o) => o.collected),
    rejected: count((o) => o.rejections.length > 0),
    reported: count((o) => DONE.includes(o.status)),
    reviewed: count((o) => o.status === 'reviewed'),
    waiting: count((o) => OPEN.includes(o.status)),
    cancelled: count((o) => o.status === 'cancelled'),
    late: count((o) => o.late),
    outside: count((o) => o.tests.some((t) => t.outside)),
    abnormal: count((o) => o.abnormal && DONE.includes(o.status)),
    urgent: count((o) => o.urgent),
  };
  const byDept = {};
  for (const o of rows) for (const t of o.tests) byDept[t.department || 'other'] = (byDept[t.department || 'other'] ?? 0) + 1;
  await audit(req, 'LAB_REGISTER_VIEWED', { details: { from, to, results: rows.length } });
  res.json({ from, to, department: q.department, orders: rows, summary, byDepartment: byDept, more: orders.length === 3000 });
});

// ---------- One order ----------

labRouter.get('/orders/:orderId', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  await audit(req, 'LAB_ORDER_VIEWED', { details: ids(order, { mrn: patient.mrn }) });
  const [catalogue, setup, previous, qc] = await Promise.all([labCatalogue(req.tenantId), labSetup(req.tenantId), previousResults(req.tenantId, order), qcRejected(req.tenantId, order.tests.map((t) => t.key), req.now)]);
  // The result form suggests flags from the ranges that apply to this patient (her age, pregnancy); her earlier results
  // of the same values (trends, Lab version 2); the tests whose quality control was rejected today
  res.json({ order: { ...(await viewFor(req, order, access, setup)), patient: patientBrief(patient) }, catalogue: catalogueView(catalogue, rangeContext(patient, req.now)), verify: setup.verify, previous, qcRejected: qc });
});

// The labels were printed (the browser prints them): the order gets its sample number if it had none (older orders).
labRouter.post('/orders/:orderId/labels-printed', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'collect');
  if (!['ordered', 'collected'].includes(order.status)) throw conflict('Labels are printed before the results are entered.');
  if (await ensureSampleNo(order, req.now)) {
    order.rev += 1;
    await order.save();
  }
  await audit(req, 'LAB_LABELS_PRINTED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: await viewFor(req, order, access) });
});

labRouter.post('/orders/:orderId/collect', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'collect');
  const body = parse(z.object({ rev }).strict(), req.body);
  if (order.status !== 'ordered') throw conflict('The sample is already marked collected (or the order is closed).');
  checkRev(order, body.rev);
  order.status = 'collected';
  order.collected = stampOf(req);
  // Taken by the lab at its counter: received at once. Taken on a ward (a nurse, a doctor): received when it arrives.
  if (isLab(req) && !order.home) order.received = stampOf(req);
  await ensureSampleNo(order, req.now);
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SAMPLE_COLLECTED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: await viewFor(req, order, access) });
});

// The sample arrives in the lab (the accession step): by the order, or by its sample number (a label's barcode
// "261017-0003-2" scanned into the box finds its order).
labRouter.post('/receive', async (req, res) => {
  if (!isLab(req)) throw forbidden('The lab receives samples.');
  const { code } = parse(z.object({ code: z.string().trim().max(40) }).strict(), req.body);
  const m = code.match(/^(\d{6}-\d{4})(?:-\d{1,2})?$/);
  if (!m) throw invalid({ code: 'Scan or type the sample number (e.g. 261017-0003).' });
  const order = await LabOrder.findOne({ tenantId: req.tenantId, sampleNo: m[1] });
  if (!order) throw notFound('No order has this sample number.');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: order.patientId });
  const access = labAccess(req, patient);
  if (order.status === 'ordered') throw conflict('This sample is not taken yet: mark it taken first.');
  if (order.status !== 'collected' || order.received) throw conflict(`Already received${order.received ? ` by ${order.received.byName}` : ''}.`, 'ALREADY_RECEIVED');
  order.received = stampOf(req);
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SAMPLE_RECEIVED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: { ...(await viewFor(req, order, access)), patient: patientBrief(patient) } });
});

labRouter.post('/orders/:orderId/receive', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  const body = parse(z.object({ rev }).strict(), req.body);
  if (order.status !== 'collected' || order.received) throw conflict('This sample is not waiting to be received.');
  checkRev(order, body.rev);
  order.received = stampOf(req);
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SAMPLE_RECEIVED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: await viewFor(req, order, access) });
});

// The lab refuses the sample (feature 1): the order goes back to "sample to take", the rejection is kept.
labRouter.post('/orders/:orderId/reject', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  const body = parse(z.object({ rev, reason: z.enum(Object.keys(REJECT_REASONS), 'Choose why the sample is rejected.'), note: safeText('Note', 300).default('') }).strict(), req.body);
  if (order.status !== 'collected') throw conflict('Only a sample that was taken and has no results yet can be rejected.');
  checkRev(order, body.rev);
  if (body.reason === 'other' && body.note.trim().length < 3) throw invalid({ note: 'Write what was wrong with the sample.' });
  order.rejections.push({ ...stampOf(req), reason: body.reason, note: body.note.trim() });
  order.status = 'ordered';
  order.collected = null;
  order.received = null;
  order.collectedAtReport = false;
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SAMPLE_REJECTED', { details: ids(order, { mrn: patient.mrn, reason: body.reason }) });
  res.json({ order: await viewFor(req, order, access) });
});

const resultsSchema = z
  .object({
    rev,
    tests: z.array(
      z
        .object({
          key: z.string().max(40),
          values: z.array(z.object({ key: z.string().max(40), value: z.string().trim().max(100), flag: z.enum(FLAGS).default('') }).strict()).max(20).default([]),
          text: safeText('Result', 2000).default(''),
        })
        .strict(),
    ),
    labNote: safeText('Remark', 1000).default(''),
    report: z.boolean().default(false), // finish: the results go to the doctor (or to the check)
    reason: safeText('Reason', 500).default(''),
    qcReason: safeText('Reason', 300).default(''), // reporting while a test's quality control is rejected today
  })
  .strict();

/**
 * The sent results, checked against the order's tests and the hospital's test list (values, choices and flags).
 * Each value keeps the name, unit and range that applied to this patient (ctx: rangeContext).
 */
/**
 * Her earlier reported results of this order's tests (Lab version 2 – trends): { testKey: { fieldKey: [{ value, flag,
 * at }] } }, newest first, at most 5 each – from orders reported before this one.
 */
async function previousResults(tenantId, order) {
  const keys = order.tests.map((t) => t.key).filter((k) => k !== OTHER_TEST);
  if (!keys.length) return {};
  const earlier = await LabOrder.find(
    { tenantId, patientId: order.patientId, _id: { $ne: order._id }, status: { $in: DONE }, 'tests.key': { $in: keys }, createdAt: { $lt: order.createdAt ?? new Date() } },
    { tests: 1, reported: 1, collected: 1 },
  )
    .sort({ 'reported.at': -1 })
    .limit(30)
    .lean();
  const out = {};
  for (const o of earlier) {
    for (const t of o.tests) {
      if (!keys.includes(t.key)) continue;
      for (const v of t.values ?? []) {
        if (v.value === '') continue;
        const list = ((out[t.key] ??= {})[v.key] ??= []);
        if (list.length < 5) list.push({ value: v.value, flag: v.flag, at: o.collected?.at ?? o.reported?.at });
      }
    }
  }
  return out;
}

/** The tests whose latest quality-control run today was rejected and has no corrective action yet. */
async function qcRejected(tenantId, keys, now) {
  if (!keys.length) return [];
  const runs = await QcRun.find({ tenantId, testKey: { $in: keys }, 'run.at': { $gte: hospitalDayStart(hospitalToday(now)) } }).sort({ 'run.at': -1, _id: -1 }).lean();
  const latest = new Map();
  for (const r of runs) if (!latest.has(String(r.lotId))) latest.set(String(r.lotId), r);
  return [...new Set([...latest.values()].filter((r) => r.status === 'rejected' && !r.action).map((r) => r.testKey))];
}

function checkedTests(order, sent, catalogue, ctx, previous = {}) {
  const fields = {};
  if (sent.length !== order.tests.length || sent.some((t, i) => t.key !== order.tests[i].key)) {
    throw conflict('The tests of this order are different from those on your screen – please reload the page.', 'STALE');
  }
  const tests = order.tests.map((t, i) => {
    const s = sent[i];
    const def = t.key === OTHER_TEST ? null : catalogue.byKey.get(t.key);
    const values = [];
    for (const v of s.values) {
      const raw = def?.fields.find((f) => f.key === v.key);
      const at = `tests.${i}.${v.key}`;
      if (!raw) {
        fields[at] = 'Unknown value for this test.';
        continue;
      }
      if (v.value === '') continue;
      const field = fieldFor(raw, ctx);
      const words = { name: field.name, ...(field.unit ? { unit: field.unit } : {}), ...(field.range ? { range: field.range } : {}) };
      if (field.type === 'text') {
        if (mentionsFetalSex(v.value)) fields[at] = PCPNDT_MESSAGE;
        values.push({ key: v.key, value: v.value, flag: '', name: field.name });
        continue;
      }
      let value = v.value;
      if (field.type === 'number') {
        // Stored as a plain number: "1,23,456" becomes 123456; "1,500" is asked about; a grouped number in a field
        // that never holds one ("1,40,000" platelets in lakh/µL) is refused with the unit (lab/labTests.js labNumber)
        const n = labNumber(v.value, field);
        if (n.error) fields[at] = n.error;
        else value = n.value;
      }
      if (field.type === 'choice' && !field.options.includes(v.value)) fields[at] = 'Choose one of the options.';
      // The change from her last result of this value (trends), and "Big change" past the hospital's limit
      const prev = previous[t.key]?.[v.key]?.[0];
      let delta = {};
      if (field.type === 'number' && prev && Number(prev.value) !== 0 && Number.isFinite(Number(prev.value)) && Number.isFinite(Number(value))) {
        const pct = Math.round(((Number(value) - Number(prev.value)) / Math.abs(Number(prev.value))) * 1000) / 10;
        delta = { deltaPercent: pct, bigChange: field.deltaPercent != null && Math.abs(pct) >= field.deltaPercent };
      }
      values.push({ key: v.key, value, flag: v.flag || flagFor(field, value), ...words, ...delta });
    }
    return { key: t.key, name: t.name, values, text: s.text, department: t.department ?? '', outside: t.outside ?? null };
  });
  if (Object.keys(fields).length) throw invalid(fields);
  return tests;
}
const hasResult = (t) => t.values.some((v) => v.value !== '') || t.text.trim() !== '';

/** The report: the results go to the doctor (with the check on, `verified` says who checked them). */
function markReported(req, order) {
  order.status = 'reported';
  order.reported = stampOf(req);
  // The secret code of the report's QR code (the public page names the hospital: the hospital's id goes first)
  if (!order.verifyToken) order.verifyToken = `${String(order.tenantId)}.${randomBytes(12).toString('hex')}`;
  if (!order.collected) {
    // Reported without "sample collected": the sample's own time is not known (it is stamped with the report's)
    order.collected = stampOf(req);
    order.collectedAtReport = true;
  }
}

labRouter.put('/orders/:orderId/results', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  const body = parse(resultsSchema, req.body);
  checkRev(order, body.rev);
  const [catalogue, setup, previous] = await Promise.all([labCatalogue(req.tenantId), labSetup(req.tenantId), previousResults(req.tenantId, order)]);
  const tests = checkedTests(order, body.tests, catalogue, rangeContext(patient, req.now), previous);
  // Quality control (Lab version 2): finishing results while a test's control was rejected today needs a reason
  if (body.report || DONE.includes(order.status)) {
    const qc = await qcRejected(req.tenantId, order.tests.map((t) => t.key), req.now);
    if (qc.length) {
      if (body.qcReason.trim().length < 5) throw invalid({ qcReason: 'The quality control of this test was rejected today: write why the result may still be reported.' }, 'Quality control was rejected today.');
      order.qcOverride = { ...stampOf(req), reason: body.qcReason.trim() };
    }
  }
  const amending = DONE.includes(order.status);
  if (amending && body.reason.trim().length < 5) throw invalid({ reason: 'The results were already reported: write why they are changed.' });
  if (!order.received && !amending) order.received = stampOf(req); // typed without "received": received now
  if ((body.report || amending) && order.files.length === 0) {
    const missing = Object.fromEntries(tests.map((t, i) => [t, i]).filter(([t]) => !hasResult(t)).map(([, i]) => [`tests.${i}`, 'Enter the result (or attach the report).']));
    if (Object.keys(missing).length) throw invalid(missing, 'Enter every result, or attach the report file, before reporting.');
  }
  if (amending) {
    order.amendments.push({ ...stampOf(req), reason: body.reason.trim(), tests: order.tests.map(testView), labNote: order.labNote, reviewedByName: order.reviewed?.byName ?? null, reviewedAt: order.reviewed?.at ?? null });
    order.reviewed = null;
  }
  order.tests = tests;
  order.labNote = body.labNote;
  order.abnormal = tests.some((t) => t.values.some((v) => isAbnormal(v.flag)));
  order.lastSaved = stampOf(req);
  let action = amending ? 'LAB_RESULTS_AMENDED' : 'LAB_RESULTS_SAVED';
  if (amending) markReported(req, order);
  else if (body.report && setup.verify) {
    // The hospital's check: entered now, reported once a second person checked them. A change while waiting for the
    // check makes this person the one who entered them (so they can't check their own).
    order.status = 'entered';
    order.entered = stampOf(req);
    action = 'LAB_RESULTS_ENTERED';
  } else if (order.status === 'entered') order.entered = stampOf(req);
  else if (body.report) {
    markReported(req, order);
    action = 'LAB_RESULTS_REPORTED';
  }
  // The lab's stock this order used is taken once, when it is first reported (Lab version 2)
  let stock = null;
  if (order.status === 'reported' && !order.stockTaken) {
    order.stockTaken = true;
    stock = await takeStock(req, order);
  }
  order.rev += 1;
  await order.save();
  await audit(req, action, { details: ids(order, { mrn: patient.mrn }) });
  if (order.status === 'reported' && order.source !== 'walk_in') await notify(req, { userIds: [order.ordered?.by] }, { kind: 'lab', text: `Lab results to review: ${patient.fullName}${order.abnormal ? ' – outside the usual range' : ''}.`, link: `/lab/orders/${order._id}` });
  res.json({ order: await viewFor(req, order, access, setup), ...(stock?.short.length ? { stockShort: stock.short } : {}) });
});

// The hospital's check (feature 5): a second person approves the entered results (they go to the doctor) or sends
// them back with a reason (back to "results to enter").
labRouter.post('/orders/:orderId/verify', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  const setup = await labSetup(req.tenantId);
  const body = parse(z.object({ rev }).strict(), req.body);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  if (order.status !== 'entered') throw conflict('These results are not waiting for a check.');
  if (!mayVerify(req, access, setup)) throw forbidden(setup.verify ? 'You are not one of the people who check lab results here.' : 'Results are not checked before the report in this hospital.');
  if (String(order.entered?.by) === String(req.user._id)) throw forbidden('Someone other than the person who entered the results must check them.');
  checkRev(order, body.rev);
  order.verified = stampOf(req);
  markReported(req, order);
  if (!order.stockTaken) {
    order.stockTaken = true;
    await takeStock(req, order);
  }
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_RESULTS_VERIFIED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: await viewFor(req, order, access, setup) });
});

labRouter.post('/orders/:orderId/send-back', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  const setup = await labSetup(req.tenantId);
  const body = parse(z.object({ rev, reason: safeText('Reason', 500) }).strict(), req.body);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  if (order.status !== 'entered') throw conflict('These results are not waiting for a check.');
  if (!mayVerify(req, access, setup)) throw forbidden('You are not one of the people who check lab results here.');
  checkRev(order, body.rev);
  if (body.reason.trim().length < 5) throw invalid({ reason: 'Write what needs to be looked at again.' });
  order.sentBack.push({ ...stampOf(req), reason: body.reason.trim() });
  order.status = 'collected';
  order.entered = null;
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_RESULTS_SENT_BACK', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: await viewFor(req, order, access, setup) });
});

// Tests sent to an outside lab (feature 7): which tests, which lab and its reference; later, which came back.
// The outside lab's report is attached as a report file and its values typed as usual.
labRouter.post('/orders/:orderId/outside', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  const body = parse(z.object({ rev, tests: z.array(z.number().int().min(0).max(29)).min(1, 'Choose the tests sent.'), labName: safeText('Outside lab', 120), ref: safeText('Their reference', 80).default('') }).strict(), req.body);
  if (!OPEN.includes(order.status)) throw conflict('Tests are sent to an outside lab before the report.');
  checkRev(order, body.rev);
  if (body.labName.trim().length < 2) throw invalid({ labName: 'Write the name of the outside lab.' });
  const fields = {};
  for (const i of body.tests) {
    const t = order.tests[i];
    if (!t) fields.tests = 'A test chosen is not in this order. Reload the page.';
    else if (t.outside?.sent && !t.outside?.received) fields.tests = `${t.name} is already at an outside lab.`;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  for (const i of body.tests) order.tests[i].outside = { labName: body.labName.trim(), ref: body.ref.trim(), sent: stampOf(req), received: null };
  order.markModified('tests');
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SENT_OUTSIDE', { details: ids(order, { mrn: patient.mrn, tests: body.tests.length }) });
  res.json({ order: await viewFor(req, order, access) });
});

labRouter.post('/orders/:orderId/outside/received', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  const body = parse(z.object({ rev, tests: z.array(z.number().int().min(0).max(29)).min(1, 'Choose the tests that came back.') }).strict(), req.body);
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  checkRev(order, body.rev);
  for (const i of body.tests) {
    const t = order.tests[i];
    if (!t?.outside?.sent || t.outside.received) throw invalid({ tests: 'A test chosen is not waiting for an outside lab. Reload the page.' });
  }
  for (const i of body.tests) order.tests[i].outside.received = stampOf(req);
  order.markModified('tests');
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_OUTSIDE_RECEIVED', { details: ids(order, { mrn: patient.mrn, tests: body.tests.length }) });
  res.json({ order: await viewFor(req, order, access) });
});

// The printed report (feature 4): the browser prints it; this records the printout. confidential: whether a
// confidential test (HIV) was included (under its neutral name).
labRouter.post('/orders/:orderId/report-printed', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  const body = parse(z.object({ confidential: z.boolean().default(false) }).strict(), req.body);
  if (!DONE.includes(order.status)) throw conflict('The report is printed once the results are reported.');
  await audit(req, 'LAB_REPORT_PRINTED', { details: ids(order, { mrn: patient.mrn, ...(body.confidential ? { confidential: true } : {}) }) });
  res.json({ ok: true });
});

// The printed report on WhatsApp (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md): only once a doctor has reviewed
// it, as the patient portal; a confidential test (HIV) is never on it (the browser makes the PDF without it, and says
// so here). To the mobile number on her record, with her agreement to WhatsApp messages (visits/whatsappDocuments.js).
const whatsappPatient = (req, order) => Patient.findOne({ tenantId: req.tenantId, _id: order.patientId }, { mrn: 1, phone: 1, reminders: 1, 'death.on': 1 }).lean();

labRouter.get('/orders/:orderId/whatsapp', async (req, res) => {
  const { order, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  if (!(order.status === 'reviewed' || (order.source === 'walk_in' && order.status === 'reported'))) return res.json({ available: false, reason: 'not_reviewed', practice: false });
  res.json(offerView(await documentOffer(req.tenantId, await whatsappPatient(req, order))));
});

labRouter.post('/orders/:orderId/whatsapp', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  const body = parse(z.object({ pdf: z.string().min(100).max(7_500_000), confidential: z.literal(false, 'A confidential test is never sent on WhatsApp.') }).strict(), req.body);
  if (!(order.status === 'reviewed' || (order.source === 'walk_in' && order.status === 'reported'))) throw conflict('The report is sent once a doctor has reviewed it.');
  const offer = await documentOffer(req.tenantId, await whatsappPatient(req, order));
  await sendPatientPdf(offer, { pdf: body.pdf, fileName: `Lab-report-${order.sampleNo ?? patient.mrn}.pdf` });
  await audit(req, 'LAB_REPORT_SENT_WHATSAPP', { details: ids(order, { mrn: patient.mrn, ...(offer.practice ? { practice: true } : {}) }) });
  res.status(201).json({ sent: true, practice: offer.practice });
});

// A report file (PDF or photo): utils/storedFiles.js checks and stores it.
labRouter.post('/orders/:orderId/files', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  const body = parse(fileUploadSchema, req.body);
  if (order.files.length >= MAX_FILES) throw conflict(`At most ${MAX_FILES} report files per order.`);
  const amending = DONE.includes(order.status);
  if (amending && body.reason.trim().length < 5) throw invalid({ reason: 'The results were already reported: write why a file is added.' });
  const file = await storeFile(req, { patientId: order.patientId, kind: 'lab_report', ownerId: order._id, body });
  if (amending) {
    order.amendments.push({ ...stampOf(req), reason: body.reason.trim(), tests: order.tests.map(testView), labNote: order.labNote, reviewedByName: order.reviewed?.byName ?? null, reviewedAt: order.reviewed?.at ?? null });
    order.reviewed = null;
    order.status = 'reported';
    order.reported = stampOf(req);
  }
  order.files.push(fileEntry(file, stampOf(req)));
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_REPORT_UPLOADED', { details: ids(order, { mrn: patient.mrn, fileId: String(file._id) }) });
  res.status(201).json({ order: await viewFor(req, order, access) });
});

labRouter.get('/orders/:orderId/files/:fileId', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  const fileId = parse(objectId, req.params.fileId);
  const file = await findFile(req, { kind: 'lab_report', ownerId: order._id, fileId });
  await audit(req, 'LAB_REPORT_OPENED', { details: ids(order, { mrn: patient.mrn, fileId: String(file._id) }) });
  sendFile(res, file);
});

labRouter.post('/orders/:orderId/cancel', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'cancel');
  const body = parse(z.object({ rev, reason: safeText('Reason', 500) }).strict(), req.body);
  if (!['ordered', 'collected'].includes(order.status)) throw conflict('Only an order without a report can be cancelled.');
  checkRev(order, body.rev);
  if (body.reason.trim().length < 5) throw invalid({ reason: 'Write why the order is cancelled.' });
  order.status = 'cancelled';
  order.cancelled = { ...stampOf(req), reason: body.reason.trim() };
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_ORDER_CANCELLED', { details: ids(order, { mrn: patient.mrn }) });
  await billLabCancelled(req, order); // billing: its tests come off
  res.json({ order: await viewFor(req, order, access) });
});

// The doctor's review. An abnormal result needs a comment (what was done about it). The matching care-plan
// items are then marked done (never failing the review).
const resultWords = (t, def) => {
  const parts = t.values
    .filter((v) => v.value !== '')
    .map((v) => {
      const f = def?.fields.find((x) => x.key === v.key);
      const flag = isAbnormal(v.flag) ? ` (${v.flag})` : '';
      const unit = v.unit ?? f?.unit;
      return `${v.name ?? f?.name ?? v.key} ${v.value}${unit ? ` ${unit}` : ''}${flag}`;
    });
  if (t.text) parts.push(t.text);
  return parts.join(', ') || 'See the lab report';
};

labRouter.post('/orders/:orderId/review', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'review');
  const body = parse(z.object({ rev, comment: safeText('Comment', 1000).default('') }).strict(), req.body);
  if (order.status !== 'reported') throw conflict(order.status === 'reviewed' ? 'These results are already reviewed.' : 'The lab has not reported these results yet.');
  if (order.source === 'walk_in') throw conflict('A walk-in order goes to the referring doctor, not for a review here.');
  checkRev(order, body.rev);
  if (order.abnormal && body.comment.trim().length < 3) throw invalid({ comment: 'A result is outside the usual range: write what was done about it.' });
  order.status = 'reviewed';
  order.reviewed = { ...stampOf(req), comment: body.comment.trim() };
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_RESULTS_REVIEWED', { details: ids(order, { mrn: patient.mrn }) });
  // A reviewed haemoglobin now counts: the risk level is worked out again (covered by the entry above).
  const riskChanged = await riskAfterLab(req, patient);
  let planChanged = false;
  try {
    const catalogue = await labCatalogue(req.tenantId);
    const day = hospitalToday(order.collected?.at ?? order.reported?.at ?? req.now); // the hospital's date of the sample
    const tests = order.tests
      .map((t) => ({ t, def: catalogue.byKey.get(t.key) }))
      .filter(({ def }) => def?.planKeys?.length)
      .map(({ t, def }) => ({ planKeys: def.planKeys, series: Boolean(def.planSeries), result: resultWords(t, def) }));
    const result = tests.length ? await markDoneFromLab(planCtx(req), patient._id, { labOrderId: order._id, on: day, tests }) : null;
    planChanged = Boolean(result?.changed);
  } catch (err) {
    console.error('Care plan after a lab review failed', err?.message ?? err);
  }
  res.json({ order: await viewFor(req, order, access), planChanged, riskChanged });
});

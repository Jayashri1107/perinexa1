import { Router } from 'express';
import { billLabCancelled, billLabOrdered } from '../billing/hooks.js';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient, currentAge } from '../models/Patient.js';
import { User } from '../models/User.js';
import { markDoneFromLab, planCtx, syncPlanSafely } from '../careplans/plansService.js';
import { refreshPatientRiskSafely } from '../careplans/templatesService.js';
import { ensureLabPackages } from '../lab/labPackages.js';
import { FLAGS, LAB_TEST_KEYS, OTHER_TEST, catalogueView, flagFor, isAbnormal, labNumber, testByKey, testsFor } from '../lab/labTests.js';
import { LabPackage } from '../models/LabPackage.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { findPatient } from '../utils/patientLookup.js';
import { PCPNDT_MESSAGE, mentionsFetalSex, safeText } from '../utils/pcpndt.js';
import { hospitalToday } from '../careplans/dates.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { objectId, parse } from '../utils/validate.js';

// The lab module (Version 2). Two routers:
//  - patientLabRouter, /api/patients/:id/lab-orders: a patient's orders and results (those who may see the
//    medical details), and new orders (the treating or an unassigned doctor, RMOs);
//  - labRouter, /api/lab: the test list, the lab's worklist, one order (collect, results, report files, cancel)
//    and the doctor's review.
// Who may do what:
//  - lab staff see only the patient's name, number, type of care and age, the tests and the doctor's note to the
//    lab – never the record or the doctor's review comment; they collect, enter results, upload report files;
//  - nurses may mark a sample collected; doctors and RMOs may also enter results (a test done at the bedside or a
//    report from outside);
//  - a doctor reviews the results (the treating or an unassigned doctor). A reviewed result completes the
//    matching care-plan items. A change after the report needs a reason, keeps the earlier results and goes
//    back to the doctor.
// The audit log gets ids only, never a value.

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

labRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...LAB_ROLES)) throw forbidden('The lab module is for the lab, doctors, RMOs and nurses.');
  next();
});

// ---------- The view of an order ----------

const stampView = (s) => (s ? { byName: s.byName, at: s.at } : null);
const testView = (t) => ({ key: t.key, name: t.name, values: (t.values ?? []).map((v) => ({ key: v.key, value: v.value, flag: v.flag })), text: t.text ?? '' });

/**
 * One order; clinical: may see the doctor's review comment and the earlier results of an amended report, and the
 * name of the test package it was ordered with. Lab staff who may not see the medical details get the tests only: a
 * package name says why she is tested ("Recurrent pregnancy loss work-up") – more than the lab needs to do the work.
 */
export function orderView(order, access) {
  return {
    id: String(order._id),
    patientId: String(order.patientId),
    visitId: order.visitId ? String(order.visitId) : null,
    status: order.status,
    urgent: Boolean(order.urgent),
    tests: order.tests.map(testView),
    noteToLab: order.noteToLab ?? '',
    packages: access.clinical ? (order.packages ?? []).map((p) => (typeof p === 'string' ? { key: p, name: p } : { key: p.key, name: p.name, version: p.version, approved: p.approved })) : [],
    labNote: order.labNote ?? '',
    ordered: stampView(order.ordered),
    collected: stampView(order.collected),
    reported: stampView(order.reported),
    lastSaved: stampView(order.lastSaved),
    reviewed: order.reviewed ? { byName: order.reviewed.byName, at: order.reviewed.at, ...(access.clinical ? { comment: order.reviewed.comment ?? '' } : {}) } : null,
    cancelled: order.cancelled ? { byName: order.cancelled.byName, at: order.cancelled.at, reason: order.cancelled.reason ?? '' } : null,
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
      canCollect: access.collect && order.status === 'ordered',
      canReport: access.report && order.status !== 'cancelled',
      canReview: access.review && order.status === 'reported',
      canCancel: access.cancel && ['ordered', 'collected'].includes(order.status),
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
      .array(z.object({ key: z.enum([...LAB_TEST_KEYS, OTHER_TEST]), name: safeText('Test name', 150).optional() }).strict())
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
  res.json({ orders: orders.map((o) => orderView(o, access)), canOrder: access.order && !isDuplicate(patient) && !isClosed(patient) });
});

patientLabRouter.post('/', async (req, res) => {
  const patient = await findPatient(req);
  const access = labAccess(req, patient);
  assertCan(access, 'order');
  const body = parse(orderSchema, req.body);
  const repeat = await LabOrder.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) {
    if (String(repeat.patientId) !== String(patient._id)) throw conflict('This request was already used.');
    return res.status(201).json({ order: orderView(repeat, access) });
  }
  // A record marked as a duplicate takes no new lab orders (orders already made on it are still finished there)
  refuseNewOnDuplicate(patient, 'lab');
  refuseNewOnClosed(patient, 'lab'); // nor a record closed after a death (an order already made is finished)
  const fields = {};
  const tests = body.tests.map((t, i) => {
    if (t.key === OTHER_TEST) {
      if (!t.name || t.name.trim().length < 2) fields[`tests.${i}.name`] = 'Write the name of the test.';
      return { key: OTHER_TEST, name: (t.name ?? '').trim(), values: [], text: '' };
    }
    const test = testByKey.get(t.key);
    // A baby's record takes only baby tests; everyone else's only adult tests (the mother's are on her record).
    if (test.who !== testsFor(patient)) {
      fields[`tests.${i}.key`] = test.who === 'newborn' ? `${test.name} is a test for babies.` : `${test.name} is not a test for a baby – order the mother's tests on her own record.`;
    }
    return { key: t.key, name: test.name, values: [], text: '' };
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
    ordered: stampOf(req),
    clientRequestId: body.clientRequestId,
  });
  await audit(req, 'LAB_ORDER_CREATED', { details: ids(order, { mrn: patient.mrn, tests: tests.length }) });
  await billLabOrdered(req, patient, order); // billing: each test
  res.status(201).json({ order: orderView(order, access) });
});

// ---------- The test list ----------

labRouter.get('/tests', (_req, res) => {
  res.json(catalogueView());
});

// ---------- Lists ----------

// The lab's worklist: to collect (ordered), to report (collected), and reported in the last 7 days. Urgent orders
// first, then the oldest. Doctors, RMOs and nurses see only patients whose medical details they may see.
const LISTS = {
  collect: { status: 'ordered', sort: { urgent: -1, createdAt: 1 } },
  report: { status: 'collected', sort: { urgent: -1, createdAt: 1 } },
  done: { status: { $in: ['reported', 'reviewed'] }, sort: { 'reported.at': -1 } },
};

async function withPatients(req, orders, keep) {
  const pids = [...new Set(orders.map((o) => String(o.patientId)))];
  const patients = pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }) : [];
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const names = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  return orders
    .map((o) => {
      const p = byId.get(String(o.patientId));
      if (!p) return null;
      const access = labAccess(req, p);
      if (!keep(access)) return null;
      return { ...orderView(o, access), patient: patientBrief(p, p.assignedDoctor ? (names.get(String(p.assignedDoctor)) ?? null) : null) };
    })
    .filter(Boolean);
}

labRouter.get('/worklist', async (req, res) => {
  const { list } = parse(z.object({ list: z.enum(Object.keys(LISTS)).default('collect') }), req.query);
  const { status, sort } = LISTS[list];
  const since = new Date(req.now.getTime() - 7 * 24 * 3600 * 1000);
  const filter = { tenantId: req.tenantId, status, ...(list === 'done' ? { 'reported.at': { $gte: since } } : {}) };
  const orders = await LabOrder.find(filter).sort(sort).limit(300);
  const counts = {};
  for (const [k, l] of Object.entries(LISTS)) {
    if (k !== 'done') counts[k] = await LabOrder.countDocuments({ tenantId: req.tenantId, status: l.status });
  }
  // Counts are hospital-wide for the lab; for others they are of the patients they may see.
  const shown = await withPatients(req, orders, (a) => a.view);
  if (!isLab(req)) {
    for (const k of Object.keys(counts)) {
      // Only the patient of each order is read here, so the orders are counted by who may see their patient (not
      // passed through withPatients, which needs the whole order)
      const all = await LabOrder.find({ tenantId: req.tenantId, status: LISTS[k].status }, { patientId: 1 }).limit(1000).lean();
      const pids = [...new Set(all.map((o) => String(o.patientId)))];
      const patients = pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids } }) : [];
      const visible = new Set(patients.filter((p) => labAccess(req, p).view).map((p) => String(p._id)));
      counts[k] = all.filter((o) => visible.has(String(o.patientId))).length;
    }
  }
  res.json({ list, orders: shown, counts, isLab: isLab(req) });
});

// Results waiting for a doctor's review: the doctor's own and unassigned patients. Abnormal results first.
labRouter.get('/to-review', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) return res.json({ orders: null });
  const orders = await LabOrder.find({ tenantId: req.tenantId, status: 'reported' }).sort({ abnormal: -1, 'reported.at': 1 }).limit(300);
  res.json({ orders: await withPatients(req, orders, (a) => a.review) });
});

// ---------- One order ----------

labRouter.get('/orders/:orderId', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  if (!access.view) throw forbidden("You can't see this patient's lab orders.");
  await audit(req, 'LAB_ORDER_VIEWED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: { ...orderView(order, access), patient: patientBrief(patient) }, catalogue: catalogueView() });
});

labRouter.post('/orders/:orderId/collect', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'collect');
  const body = parse(z.object({ rev }).strict(), req.body);
  if (order.status !== 'ordered') throw conflict('The sample is already marked collected (or the order is closed).');
  checkRev(order, body.rev);
  order.status = 'collected';
  order.collected = stampOf(req);
  order.rev += 1;
  await order.save();
  await audit(req, 'LAB_SAMPLE_COLLECTED', { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: orderView(order, access) });
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
    report: z.boolean().default(false), // finish: the results go to the doctor
    reason: safeText('Reason', 500).default(''),
  })
  .strict();

/** The sent results, checked against the order's tests and the test list (values, choices and flags). */
function checkedTests(order, sent) {
  const fields = {};
  if (sent.length !== order.tests.length || sent.some((t, i) => t.key !== order.tests[i].key)) {
    throw conflict('The tests of this order are different from those on your screen – please reload the page.', 'STALE');
  }
  const tests = order.tests.map((t, i) => {
    const s = sent[i];
    const def = testByKey.get(t.key);
    const values = [];
    for (const v of s.values) {
      const field = def?.fields.find((f) => f.key === v.key);
      const at = `tests.${i}.${v.key}`;
      if (!field) {
        fields[at] = 'Unknown value for this test.';
        continue;
      }
      if (v.value === '') continue;
      if (field.type === 'text') {
        if (mentionsFetalSex(v.value)) fields[at] = PCPNDT_MESSAGE;
        values.push({ key: v.key, value: v.value, flag: '' });
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
      values.push({ key: v.key, value, flag: v.flag || flagFor(field, value) });
    }
    return { key: t.key, name: t.name, values, text: s.text };
  });
  if (Object.keys(fields).length) throw invalid(fields);
  return tests;
}
const hasResult = (t) => t.values.some((v) => v.value !== '') || t.text.trim() !== '';

labRouter.put('/orders/:orderId/results', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  const body = parse(resultsSchema, req.body);
  checkRev(order, body.rev);
  const tests = checkedTests(order, body.tests);
  const amending = ['reported', 'reviewed'].includes(order.status);
  if (amending && body.reason.trim().length < 5) throw invalid({ reason: 'The results were already reported: write why they are changed.' });
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
  if (body.report || amending) {
    order.status = 'reported';
    order.reported = stampOf(req);
    if (!order.collected) {
      // Reported without "sample collected": the sample's own time is not known (it is stamped with the report's)
      order.collected = stampOf(req);
      order.collectedAtReport = true;
    }
  }
  order.rev += 1;
  await order.save();
  const action = amending ? 'LAB_RESULTS_AMENDED' : body.report ? 'LAB_RESULTS_REPORTED' : 'LAB_RESULTS_SAVED';
  await audit(req, action, { details: ids(order, { mrn: patient.mrn }) });
  res.json({ order: orderView(order, access) });
});

// A report file (PDF or photo): utils/storedFiles.js checks and stores it.
labRouter.post('/orders/:orderId/files', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'report');
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  const body = parse(fileUploadSchema, req.body);
  if (order.files.length >= MAX_FILES) throw conflict(`At most ${MAX_FILES} report files per order.`);
  const amending = ['reported', 'reviewed'].includes(order.status);
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
  res.status(201).json({ order: orderView(order, access) });
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
  res.json({ order: orderView(order, access) });
});

// The doctor's review. An abnormal result needs a comment (what was done about it). The matching care-plan
// items are then marked done (never failing the review).
const resultWords = (t) => {
  const def = testByKey.get(t.key);
  const parts = t.values
    .filter((v) => v.value !== '')
    .map((v) => {
      const f = def?.fields.find((x) => x.key === v.key);
      const flag = isAbnormal(v.flag) ? ` (${v.flag})` : '';
      return `${f?.name ?? v.key} ${v.value}${f?.unit ? ` ${f.unit}` : ''}${flag}`;
    });
  if (t.text) parts.push(t.text);
  return parts.join(', ') || 'See the lab report';
};

labRouter.post('/orders/:orderId/review', async (req, res) => {
  const { order, patient, access } = await loadOrder(req);
  assertCan(access, 'review');
  const body = parse(z.object({ rev, comment: safeText('Comment', 1000).default('') }).strict(), req.body);
  if (order.status !== 'reported') throw conflict(order.status === 'reviewed' ? 'These results are already reviewed.' : 'The lab has not reported these results yet.');
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
    const day = hospitalToday(order.collected?.at ?? order.reported?.at ?? req.now); // the hospital's date of the sample
    const tests = order.tests
      .filter((t) => testByKey.get(t.key)?.planKeys.length)
      .map((t) => ({ planKeys: testByKey.get(t.key).planKeys, series: Boolean(testByKey.get(t.key).planSeries), result: resultWords(t) }));
    const result = tests.length ? await markDoneFromLab(planCtx(req), patient._id, { labOrderId: order._id, on: day, tests }) : null;
    planChanged = Boolean(result?.changed);
  } catch (err) {
    console.error('Care plan after a lab review failed', err?.message ?? err);
  }
  res.json({ order: orderView(order, access), planChanged, riskChanged });
});

// The lab (as in Perinexa): doctors and RMOs order tests for a patient, the lab takes the sample and enters the
// results, and a doctor or RMO reviews them. Nurses can read. Lab staff see each order's patient by name and number
// only (never the record), and every order made for the lab – they need it to run the test. Everyone else sees the
// orders of the records they may read clinically. The audit log gets ids and test keys – never results.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { nextNumber } from '../../db/counter.js';
import { recordAudit } from '../audit/audit.service.js';
import { testPackageOptions } from '../library/library.service.js';
import { notify } from '../notifications/notification.service.js';
import { EmergencyAccess, Patient } from '../patients/patient.model.js';
import { atLeast, listVisibility, recordLevel } from '../patients/patientAccess.js';
import { User } from '../users/user.model.js';
import { LabOrder } from './labOrder.model.js';
import { OTHER_TEST, catalogueView, flagFor, isAbnormal, testByKey, testsFor } from './labTests.js';

const { access } = config;
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));
const isLab = (req) => has(req, access.labReport);
const canOrder = (req) => has(req, access.labOrder);
const canReview = (req) => has(req, access.labReview);

const VIEW_STATUSES = {
  collect: ['ordered'],
  report: ['ordered', 'collected'],
  review: ['reported'],
  done: ['reviewed'],
  cancelled: ['cancelled'],
};

// ---------- Access ----------

async function levelFor(req, patient) {
  const emergency = await EmergencyAccess.exists({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, expiresAt: { $gt: new Date() } });
  return recordLevel(req, patient, { emergency: Boolean(emergency) });
}

// The patient of an order and what this person may do with it. Lab staff: name and number only.
async function patientAccess(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  const level = await levelFor(req, patient);
  const canRead = isLab(req) || atLeast(level, 'clinicalRead');
  return { patient, level, canRead };
}

const patientView = (p) => ({ id: String(p._id), name: p.name, patientNumber: p.patientNumber, careType: p.careType, birthDate: p.birthDate, sex: p.sex });

// ---------- Catalogue ----------

export async function catalogue(req) {
  return { ...catalogueView(), packages: await testPackageOptions(req.hospitalId), can: { order: canOrder(req), report: isLab(req), review: canReview(req) } };
}

// ---------- Lists ----------

// The worklist: lab staff see every order; others only orders of records they may read clinically.
export async function listOrders(req, q) {
  if (!isLab(req) && !atLeast(maxLevel(req), 'clinicalRead')) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  const match = { hospitalId: toObjectId(req.hospitalId) };
  if (q.view) match.status = { $in: VIEW_STATUSES[q.view] };

  const visibility = isLab(req) ? {} : listVisibility(req);
  const patientMatch = Object.fromEntries(
    Object.entries(visibility).map(([k, v]) => (k === '$or' ? ['$or', v.map((c) => Object.fromEntries(Object.entries(c).map(([f, x]) => [`patient.${f}`, x])))] : [`patient.${k}`, v])),
  );
  const and = [];
  if (Object.keys(patientMatch).length) and.push(patientMatch);
  if (q.mine === 'true') and.push({ $or: [{ 'ordered.by': req.user._id }, { 'patient.assignedDoctorId': req.user._id }] });
  if (q.search) {
    const starts = new RegExp(`^${escapeRegex(q.search)}`, 'i');
    and.push({ $or: [{ orderNumber: starts }, { 'patient.patientNumber': starts }, { 'patient.nameKey': containsText(q.search) }] });
  }

  const result = await paginate(LabOrder, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    preStages: [
      {
        $lookup: {
          from: Patient.collection.name,
          localField: 'patientId',
          foreignField: '_id',
          as: 'patient',
          pipeline: [{ $match: { hospitalId: match.hospitalId } }, { $project: { name: 1, nameKey: 1, patientNumber: 1, isSensitive: 1, assignedDoctorId: 1 } }],
        },
      },
      { $set: { patient: { $first: '$patient' } } },
      ...(and.length ? [{ $match: { $and: and } }] : []),
    ],
    pageStages: [
      { $lookup: { from: User.collection.name, localField: 'ordered.by', foreignField: '_id', as: 'orderedBy', pipeline: [{ $project: { name: 1 } }] } },
      { $set: { orderedBy: { $first: '$orderedBy.name' } } },
    ],
  });
  result.items = result.items.map((o) => ({
    id: String(o._id),
    orderNumber: o.orderNumber,
    status: o.status,
    urgent: o.urgent,
    bookedByReception: Boolean(o.bookedByReception),
    patient: o.patient ? { id: String(o.patient._id), name: o.patient.name, patientNumber: o.patient.patientNumber } : null,
    tests: o.tests.map((t) => t.name),
    abnormal: o.tests.flatMap((t) => t.values).filter((v) => isAbnormal(v.flag)).length,
    orderedAt: o.ordered.at,
    orderedBy: o.orderedBy ?? '',
    reportedAt: o.reported?.at ?? null,
  }));
  return result;
}

// The best level the person's roles give in general (for list permission only).
function maxLevel(req) {
  return has(req, access.patientsClinical) || req.membership.isSuperAdminAccess ? 'clinicalRead' : 'none';
}

// ---------- One order ----------

async function names(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select('name').lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

async function orderView(req, order, { patient, level }) {
  const stamps = ['ordered', 'collected', 'reported', 'reviewed', 'cancelled'];
  const who = await names([...stamps.map((s) => order[s]?.by), ...order.amendments.map((a) => a.by)]);
  const stamp = (s) => (order[s] ? { at: order[s].at, by: who.get(String(order[s].by)) ?? '', ...(s === 'cancelled' && { reason: order.cancelled.reason }) } : null);
  const open = ['ordered', 'collected'].includes(order.status);
  const full = level === 'full';
  return {
    order: {
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      urgent: order.urgent,
      bookedByReception: Boolean(order.bookedByReception),
      noteToLab: order.noteToLab,
      labNote: order.labNote,
      packages: order.packages,
      tests: order.tests.map((t) => ({ key: t.key, name: t.name, text: t.text, values: t.values.map((v) => ({ key: v.key, value: v.value, flag: v.flag })) })),
      ordered: stamp('ordered'),
      collected: stamp('collected'),
      reported: stamp('reported'),
      reviewed: stamp('reviewed'),
      cancelled: stamp('cancelled'),
      amendments: order.amendments.map((a) => ({ at: a.at, by: who.get(String(a.by)) ?? '', reason: a.reason })),
    },
    patient: patientView(patient),
    can: {
      collect: isLab(req) && order.status === 'ordered',
      report: isLab(req) && order.status !== 'cancelled',
      review: canReview(req) && full && order.status === 'reported',
      cancel: open && (isLab(req) || (canOrder(req) && full)),
      openRecord: atLeast(level, 'basic') && !isLab(req),
    },
  };
}

async function loadOrder(req, id) {
  const order = await LabOrder.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!order) throw notFoundError('Lab order');
  const access_ = await patientAccess(req, order.patientId);
  if (!access_.canRead) throw notFoundError('Lab order');
  return { order, ...access_ };
}

export async function getOrder(req, id) {
  const loaded = await loadOrder(req, id);
  await recordAudit(req, 'LAB_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), orderNumber: loaded.order.orderNumber } });
  return orderView(req, loaded.order, loaded);
}

// ---------- Ordering ----------

// The tests and packages of a new order, checked: catalogue tests for her (adult or baby), named other tests, at most
// config.lab.maxTestsPerOrder.
async function testsOfOrder(req, patient, body) {
  const who = testsFor(patient.careType);
  const packages = (await testPackageOptions(req.hospitalId)).filter((p) => body.packages.includes(p.key));
  const keys = [...new Set([...packages.flatMap((p) => p.tests), ...body.tests])].filter((k) => testByKey.has(k));
  const wrong = keys.filter((k) => testByKey.get(k).who !== who);
  if (wrong.length) throw fieldError('tests', `${testByKey.get(wrong[0]).name} is not a test for ${who === 'newborn' ? 'an adult' : 'a baby'}.`);

  const tests = [
    ...keys.map((k) => ({ key: k, name: testByKey.get(k).name, values: [], text: '' })),
    ...[...new Set(body.otherTests)].map((name) => ({ key: OTHER_TEST, name, values: [], text: '' })),
  ];
  if (tests.length > config.lab.maxTestsPerOrder) throw fieldError('tests', `At most ${config.lab.maxTestsPerOrder} tests in one order.`);
  if (!tests.length) throw fieldError('tests', 'Choose at least one test.');
  return { tests, packages };
}

export async function createOrder(req, body) {
  if (!canOrder(req)) throw new HttpError(403, 'Doctors and RMOs order lab tests.', 'FORBIDDEN');
  const { patient, level } = await patientAccess(req, body.patientId);
  if (level !== 'full') throw new HttpError(403, 'Only her doctor or an RMO can order tests for her.', 'READ_ONLY');
  if (patient.status !== 'active') throw fieldError('patientId', 'Her record is closed. Reopen it first.');
  const { tests, packages } = await testsOfOrder(req, patient, body);

  const order = await LabOrder.create({
    hospitalId: req.hospitalId,
    orderNumber: await nextNumber(req.hospitalId, 'labOrder', config.lab.orderPrefix, config.lab.numberDigits),
    patientId: patient._id,
    urgent: body.urgent,
    tests,
    packages: packages.map((p) => ({ key: p.key, name: p.name, approved: p.status === 'approved' })),
    noteToLab: body.noteToLab,
    ordered: { by: req.user._id, at: new Date() },
  });
  await recordAudit(req, 'LAB_ORDERED', {
    hospitalId: req.hospitalId,
    details: { patientId: String(patient._id), orderNumber: order.orderNumber, tests: tests.map((t) => t.key) },
  });
  return orderView(req, order, { patient, level });
}

// ---------- Booked by reception (owner, 8 Oct 2026) ----------

// The tests reception may book (the catalogue and the packages – no results, no patient records).
export async function bookingCatalogue(req) {
  return { ...catalogueView(), packages: await testPackageOptions(req.hospitalId) };
}

// Reception books tests for a registered patient: the order goes straight to the lab's worklist, marked "booked by
// reception", and her doctor is told (her name and number and the tests – never results). The answer holds only what
// reception may see: the order number, her name and number, and the test names.
export async function bookByReception(req, body) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: body.patientId }).lean();
  if (!patient) throw fieldError('patientId', 'Choose a patient of this hospital.');
  if (patient.status !== 'active') throw fieldError('patientId', 'Her record is closed. Reopen it first.');
  const { tests, packages } = await testsOfOrder(req, patient, body);

  const order = await LabOrder.create({
    hospitalId: req.hospitalId,
    orderNumber: await nextNumber(req.hospitalId, 'labOrder', config.lab.orderPrefix, config.lab.numberDigits),
    patientId: patient._id,
    urgent: body.urgent,
    tests,
    packages: packages.map((p) => ({ key: p.key, name: p.name, approved: p.status === 'approved' })),
    noteToLab: body.noteToLab,
    bookedByReception: true,
    ordered: { by: req.user._id, at: new Date() },
  });
  await recordAudit(req, 'LAB_ORDERED', {
    hospitalId: req.hospitalId,
    details: { patientId: String(patient._id), orderNumber: order.orderNumber, tests: tests.map((t) => t.key), byReception: true },
  });
  if (patient.assignedDoctorId) {
    await notify(req, [patient.assignedDoctorId], {
      type: 'LAB_BOOKED',
      title: 'Lab tests booked by reception',
      message: `${patient.name} (${patient.patientNumber}) · ${tests.map((t) => t.name).join(', ')}`.slice(0, 300),
      link: `/hospital/lab/orders/${order._id}`,
    });
  }
  return { order: { id: String(order._id), orderNumber: order.orderNumber, urgent: order.urgent, tests: tests.map((t) => t.name) }, patient: { name: patient.name, patientNumber: patient.patientNumber } };
}

// ---------- The lab ----------

function assertLab(req) {
  if (!isLab(req)) throw new HttpError(403, 'Only lab staff can do this.', 'FORBIDDEN');
}

export async function collect(req, id) {
  assertLab(req);
  const loaded = await loadOrder(req, id);
  if (loaded.order.status !== 'ordered') throw new HttpError(409, 'The sample has already been taken, or the order is closed.', 'NOT_ORDERED');
  loaded.order.set({ status: 'collected', collected: { by: req.user._id, at: new Date() } });
  await loaded.order.save();
  await recordAudit(req, 'LAB_COLLECTED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), orderNumber: loaded.order.orderNumber } });
  return orderView(req, loaded.order, loaded);
}

// Saves the results with their flags. After the report, a change needs a reason and keeps the earlier results.
export async function saveResults(req, id, body) {
  assertLab(req);
  const loaded = await loadOrder(req, id);
  const { order } = loaded;
  if (order.status === 'cancelled') throw new HttpError(409, 'This order was cancelled.', 'CANCELLED');
  const amending = ['reported', 'reviewed'].includes(order.status);
  if (amending && body.reason.length < 3) throw fieldError('reason', 'Say why the reported results are changed (at least 3 characters).');

  const given = new Map(body.tests.map((t) => [`${t.key}:${t.key === OTHER_TEST ? t.name : ''}`, t]));
  const tests = order.tests.map((t) => {
    const sent = given.get(`${t.key}:${t.key === OTHER_TEST ? t.name : ''}`);
    if (!sent) return t.toObject();
    const def = testByKey.get(t.key);
    const values = (def?.fields ?? [])
      .filter((f) => f.type !== 'text' && sent.values[f.key] !== undefined && sent.values[f.key] !== '')
      .map((f) => {
        if (f.type === 'choice' && !f.options.includes(sent.values[f.key])) throw fieldError(`${t.key}.${f.key}`, `Choose one of the options for ${f.name}.`);
        return { key: f.key, value: sent.values[f.key], flag: flagFor(f, sent.values[f.key]) };
      });
    return { key: t.key, name: t.name, values, text: sent.text };
  });
  if (!tests.some((t) => t.values.length || t.text)) throw fieldError('tests', 'Enter at least one result.');

  const now = new Date();
  if (amending) order.amendments.push({ by: req.user._id, at: now, reason: body.reason, tests: order.tests, labNote: order.labNote });
  order.set({
    tests,
    labNote: body.labNote,
    status: 'reported',
    reported: { by: req.user._id, at: now },
    reviewed: null,
    ...(!order.collected && { collected: { by: req.user._id, at: now } }),
  });
  await order.save();
  await recordAudit(req, amending ? 'LAB_AMENDED' : 'LAB_REPORTED', {
    hospitalId: req.hospitalId,
    details: { patientId: String(loaded.patient._id), orderNumber: order.orderNumber },
  });
  return orderView(req, order, loaded);
}

// ---------- Doctors ----------

export async function review(req, id) {
  const loaded = await loadOrder(req, id);
  if (!canReview(req) || loaded.level !== 'full') throw new HttpError(403, 'Her doctor or an RMO reviews the results.', 'FORBIDDEN');
  if (loaded.order.status !== 'reported') throw new HttpError(409, 'There are no new results to review.', 'NOT_REPORTED');
  loaded.order.set({ status: 'reviewed', reviewed: { by: req.user._id, at: new Date() } });
  await loaded.order.save();
  await recordAudit(req, 'LAB_REVIEWED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), orderNumber: loaded.order.orderNumber } });
  return orderView(req, loaded.order, loaded);
}

export async function cancel(req, id, reason) {
  const loaded = await loadOrder(req, id);
  const { order } = loaded;
  if (!['ordered', 'collected'].includes(order.status)) throw new HttpError(409, 'Only an order without results can be cancelled.', 'NOT_OPEN');
  if (!isLab(req) && !(canOrder(req) && loaded.level === 'full')) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  order.set({ status: 'cancelled', cancelled: { by: req.user._id, at: new Date(), reason } });
  await order.save();
  await recordAudit(req, 'LAB_CANCELLED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), orderNumber: order.orderNumber } });
  return orderView(req, order, loaded);
}

// A patient's orders (her record's Lab section): those who may read her record clinically, and lab staff.
export async function forPatient(req, patientId) {
  const { patient, level, canRead } = await patientAccess(req, patientId);
  if (!canRead) throw notFoundError('Patient');
  const orders = await LabOrder.find({ hospitalId: req.hospitalId, patientId }).sort({ createdAt: -1 }).limit(50).lean();
  return {
    items: orders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      status: o.status,
      urgent: o.urgent,
      tests: o.tests.map((t) => t.name),
      abnormal: o.tests.flatMap((t) => t.values).filter((v) => isAbnormal(v.flag)).length,
      orderedAt: o.ordered.at,
      reportedAt: o.reported?.at ?? null,
    })),
    canOrder: canOrder(req) && level === 'full' && patient.status === 'active',
    who: testsFor(patient.careType),
  };
}

// For the Today page: results waiting for a doctor's review among this doctor's patients, and what the lab has to do.
export async function todayCounts(req) {
  const hid = toObjectId(req.hospitalId);
  if (isLab(req)) {
    const [toCollect, toReport] = await Promise.all([
      LabOrder.countDocuments({ hospitalId: hid, status: 'ordered' }),
      LabOrder.countDocuments({ hospitalId: hid, status: { $in: ['ordered', 'collected'] } }),
    ]);
    return { toCollect, toReport };
  }
  if (!canReview(req)) return null;
  const mine = await Patient.find({ hospitalId: hid, assignedDoctorId: req.user._id }).select('_id').lean();
  const toReview = await LabOrder.countDocuments({ hospitalId: hid, status: 'reported', $or: [{ 'ordered.by': req.user._id }, { patientId: { $in: mine.map((p) => p._id) } }] });
  return { toReview };
}

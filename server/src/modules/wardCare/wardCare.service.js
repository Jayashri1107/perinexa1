// The nurse's work on patients in hospital (owner, 9 Oct 2026):
//  - the nursing station: everyone in hospital this person may read clinically, each with what is due – doses,
//    vital signs, care tasks – IV fluids running, tests not reported yet, and red flags (approved rules only);
//  - a stay's charts: the doctor's orders, the dose and task schedule of the last 24 hours and the rest of today,
//    IV fluids, vital signs, lab tests since admission, intake and output, and the shift handover;
//  - doctors and RMOs write and stop orders; nurses (and the patient's doctor or an RMO) chart against them.
// Every count comes from the records; nothing here is a sample number. What counts as "due" is in config.nursing.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { toObjectId } from '../../core/validate.js';
import { Admission, NursingEntry } from '../admissions/admission.model.js';
import { canNurse, canWrite, loadStay, stayFlags } from '../admissions/admission.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { approvedEntries } from '../library/library.service.js';
import { notify, notifyRoles } from '../notifications/notification.service.js';
import { Patient } from '../patients/patient.model.js';
import { atLeast, listVisibility, recordLevel } from '../patients/patientAccess.js';
import { User } from '../users/user.model.js';
import { Ward } from '../wards/ward.model.js';
import { CareOrder } from './careOrder.model.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const { utcOffset } = config.app;
const nursing = config.nursing;
const NOT_GIVEN = ['refused', 'withheld', 'missed'];
const OPEN_LAB = ['ordered', 'collected'];
const FLAGGED = ['low', 'high', 'abnormal'];

// ---------- Time on the hospital clock ----------

const at = (date, hhmm) => new Date(`${date}T${hhmm}:00${utcOffset}`);
const dayBefore = (date) => new Date(dayRange(date)[0].getTime() - 12 * HOUR).toISOString().slice(0, 10);
const hhmmNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: config.app.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** The shift on now (the last one started; before the first start of the day, the night shift of yesterday). */
export function currentShift() {
  const today = todayLocal();
  const shifts = [...nursing.shifts].sort((a, b) => a.start.localeCompare(b.start));
  const now = hhmmNow();
  const i = shifts.findLastIndex((s) => s.start <= now);
  const shift = i >= 0 ? shifts[i] : shifts.at(-1);
  const startedAt = at(i >= 0 ? today : dayBefore(today), shift.start);
  return { key: shift.key, label: shift.label, startedAt };
}

// ---------- The schedule: doses and tasks due ----------

/**
 * Each time a medicine or task order is due, from 24 hours ago to the end of today, with what was charted for it:
 * given / late / refused / withheld / missed (dose), done / not_done (task), or – nothing charted – overdue, due
 * (from dueBeforeMinutes before) or later. A time already overdue when the order was written is left out, and so is
 * one after the order was stopped.
 */
function scheduleOf(orders, entries, now = new Date()) {
  const today = todayLocal();
  const from = new Date(now.getTime() - 24 * HOUR);
  const until = dayRange(today)[1];
  const charted = new Map();
  for (const e of entries) {
    if (e.cancelled || !e.orderId || !e.dueAt) continue;
    const key = `${e.orderId}|${new Date(e.dueAt).getTime()}`;
    const seen = charted.get(key);
    if (!seen || seen.at < e.at) charted.set(key, e);
  }
  const slots = [];
  for (const o of orders) {
    if (!['medicine', 'task'].includes(o.type)) continue;
    for (const date of [dayBefore(today), today]) {
      for (const t of o.times) {
        const dueAt = at(date, t);
        if (dueAt < from || dueAt >= until) continue;
        if (dueAt.getTime() + nursing.overdueAfterMinutes * MIN < new Date(o.ordered.at).getTime()) continue;
        if (o.stopped && dueAt > new Date(o.stopped.at)) continue;
        const e = charted.get(`${o._id}|${dueAt.getTime()}`);
        let state = 'later';
        if (e) state = e.outcome;
        else if (now.getTime() > dueAt.getTime() + nursing.overdueAfterMinutes * MIN) state = 'overdue';
        else if (now.getTime() >= dueAt.getTime() - nursing.dueBeforeMinutes * MIN) state = 'due';
        slots.push({ orderId: String(o._id), type: o.type, dueAt, state, entry: e ?? null });
      }
    }
  }
  return slots.sort((a, b) => a.dueAt - b.dueAt);
}

/** An IV order's state from its chart: ordered (not started), running, paused or completed; ml given so far. */
function ivStateOf(order, entries) {
  const mine = entries.filter((e) => !e.cancelled && e.kind === 'iv' && String(e.orderId) === String(order._id)).sort((a, b) => a.at - b.at);
  let state = 'ordered';
  let startedAt = null;
  let lastSite = '';
  for (const e of mine) {
    if (e.iv?.action === 'started') { state = 'running'; startedAt ??= e.at; }
    if (e.iv?.action === 'resumed') state = 'running';
    if (e.iv?.action === 'paused') state = 'paused';
    if (e.iv?.action === 'completed') state = 'completed';
    if (e.iv?.site) lastSite = e.iv.site;
  }
  const volumeMl = mine.reduce((n, e) => n + (e.iv?.volumeMl ?? 0), 0);
  return { state, startedAt, site: lastSite, volumeMl };
}

const vitalsDue = (last, now = new Date()) => !last || now - new Date(last.at) >= nursing.vitalsEveryHours * HOUR;

// ---------- Views ----------

const orderView = (o) => ({
  id: String(o._id),
  type: o.type,
  medicine: o.type === 'medicine' ? o.medicine : null,
  iv: o.type === 'iv' ? o.iv : null,
  task: o.type === 'task' ? o.task : null,
  times: o.times,
  instructions: o.instructions,
  status: o.status,
  ordered: { byName: o.ordered.byName, at: o.ordered.at },
  stopped: o.stopped ? { byName: o.stopped.byName, at: o.stopped.at, reason: o.stopped.reason } : null,
});

function entryView(e, req = null) {
  return {
    id: String(e._id),
    kind: e.kind,
    at: e.at,
    orderId: e.orderId ? String(e.orderId) : null,
    dueAt: e.dueAt,
    outcome: e.outcome ?? '',
    reason: e.reason ?? '',
    vitals: e.vitals,
    medicine: e.medicine,
    iv: e.iv,
    io: e.io,
    note: e.note,
    byName: e.byName,
    cancelled: e.cancelled,
    ...(req && { mine: String(e.by) === String(req.user._id) }),
  };
}

const ageOf = (p) => (p.birthDate ? Math.floor((Date.now() - new Date(p.birthDate)) / (365.25 * 24 * HOUR)) : null);

function ioTotals(entries) {
  const t = { oralMl: 0, ivMl: 0, urineMl: 0, otherOutMl: 0 };
  for (const e of entries) if (!e.cancelled && e.kind === 'io') for (const k of Object.keys(t)) t[k] += e.io?.[k] ?? 0;
  return { ...t, intakeMl: t.oralMl + t.ivMl, outputMl: t.urineMl + t.otherOutMl };
}

// ---------- The nursing station ----------

export async function station(req, { wardId = null } = {}) {
  const hid = toObjectId(req.hospitalId);
  const now = new Date();
  const [allStays, wards, rules] = await Promise.all([
    Admission.find({ hospitalId: hid, status: 'admitted' }).sort({ ward: 1, bed: 1 }).lean(),
    Ward.find({ hospitalId: hid, isActive: true }).sort({ sortOrder: 1, name: 1 }).select('name floor').lean(),
    approvedEntries(req.hospitalId, 'red_flag_rules').then((e) => e.flatMap((x) => x.content.rules ?? [])),
  ]);
  const patients = await Patient.find({ hospitalId: hid, _id: { $in: allStays.map((s) => s.patientId) }, ...listVisibility(req) }).lean();
  const pById = new Map(patients.map((p) => [String(p._id), p]));
  const readable = allStays.filter((s) => {
    const p = pById.get(String(s.patientId));
    return p && atLeast(recordLevel(req, p), 'clinicalRead');
  });
  const stays = wardId ? readable.filter((s) => String(s.wardId) === String(wardId)) : readable;
  const ids = stays.map((s) => s._id);

  const since = new Date(now.getTime() - 25 * HOUR);
  const [orders, entries, lastVitals, labs, doctors] = await Promise.all([
    CareOrder.find({ hospitalId: hid, admissionId: { $in: ids }, $or: [{ status: 'active' }, { 'stopped.at': { $gte: since } }] }).lean(),
    NursingEntry.find({ hospitalId: hid, admissionId: { $in: ids }, kind: { $in: ['dose', 'task', 'iv'] }, $or: [{ dueAt: { $gte: since } }, { kind: 'iv' }] }).lean(),
    NursingEntry.aggregate([
      { $match: { hospitalId: hid, admissionId: { $in: ids }, kind: 'vitals', cancelled: null } },
      { $sort: { at: -1 } },
      { $group: { _id: '$admissionId', at: { $first: '$at' } } },
    ]),
    LabOrder.find({ hospitalId: hid, patientId: { $in: stays.map((s) => s.patientId) }, status: { $in: [...OPEN_LAB, 'reported'] } }).select('patientId status createdAt tests.name tests.values.flag').lean(),
    User.find({ _id: { $in: stays.map((s) => s.doctorId).filter(Boolean) } }).select('name').lean(),
  ]);
  const docName = new Map(doctors.map((d) => [String(d._id), d.name]));
  const vitalsAt = new Map(lastVitals.map((v) => [String(v._id), v]));

  const items = [];
  for (const s of stays) {
    const p = pById.get(String(s.patientId));
    const mine = orders.filter((o) => String(o.admissionId) === String(s._id));
    const myEntries = entries.filter((e) => String(e.admissionId) === String(s._id));
    const slots = scheduleOf(mine, myEntries, now);
    const open = (type) => slots.filter((x) => x.type === type && ['due', 'overdue'].includes(x.state));
    const ivs = mine.filter((o) => o.type === 'iv' && o.status === 'active').map((o) => ivStateOf(o, myEntries));
    const myLabs = labs.filter((l) => String(l.patientId) === String(s.patientId) && l.createdAt >= s.admittedAt);
    const last = vitalsAt.get(String(s._id));
    const flags = rules.length ? await stayFlags(req, s, p, rules) : [];
    items.push({
      id: String(s._id),
      patient: { id: String(p._id), name: p.name, patientNumber: p.patientNumber, age: ageOf(p), sex: p.sex ?? '', allergies: p.allergies ?? '' },
      wardId: s.wardId ? String(s.wardId) : null,
      ward: s.ward,
      bed: s.bed,
      reason: s.reason,
      doctorName: s.doctorId ? docName.get(String(s.doctorId)) ?? '' : '',
      admittedAt: s.admittedAt,
      dosesDue: open('medicine').length,
      dosesOverdue: open('medicine').filter((x) => x.state === 'overdue').length,
      tasksDue: open('task').length,
      vitalsDue: vitalsDue(last, now),
      lastVitalsAt: last?.at ?? null,
      ivRunning: ivs.filter((x) => x.state === 'running').length,
      ivToStart: ivs.filter((x) => x.state === 'ordered').length,
      labPending: myLabs.filter((l) => OPEN_LAB.includes(l.status)).length,
      labFlagged: myLabs.filter((l) => l.status === 'reported' && l.tests.some((t) => t.values?.some((v) => FLAGGED.includes(v.flag)))).length,
      redFlags: flags.map((f) => ({ label: f.label, level: f.level })),
    });
  }
  const sum = (k) => items.reduce((n, x) => n + (typeof x[k] === 'boolean' ? Number(x[k]) : x[k]), 0);
  await recordAudit(req, 'NURSING_STATION_VIEWED', { hospitalId: req.hospitalId, details: { patients: items.length, ...(wardId && { wardId: String(wardId) }) } });
  return {
    shift: currentShift(),
    wards: wards.map((w) => ({ id: String(w._id), name: w.name, floor: w.floor ?? '', patients: readable.filter((s) => String(s.wardId) === String(w._id)).length })),
    totals: { patients: items.length, dosesDue: sum('dosesDue'), dosesOverdue: sum('dosesOverdue'), vitalsDue: sum('vitalsDue'), ivRunning: sum('ivRunning'), labPending: sum('labPending'), tasksDue: sum('tasksDue'), redFlags: items.filter((x) => x.redFlags.length).length },
    items,
    settings: { vitalsEveryHours: nursing.vitalsEveryHours },
    rulesApproved: rules.length > 0,
  };
}

// ---------- A stay's charts ----------

async function careAnswer(req, loaded) {
  const { stay, level } = loaded;
  const hid = toObjectId(req.hospitalId);
  const now = new Date();
  const [orders, entries, labs] = await Promise.all([
    CareOrder.find({ hospitalId: hid, admissionId: stay._id }).sort({ status: 1, 'ordered.at': -1 }).lean(),
    NursingEntry.find({ hospitalId: hid, admissionId: stay._id }).sort({ at: -1 }).limit(1000).lean(),
    LabOrder.find({ hospitalId: hid, patientId: stay.patientId, createdAt: { $gte: stay.admittedAt } }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  const open = stay.status === 'admitted';
  const shift = currentShift();
  const day = entries.filter((e) => now - new Date(e.at) <= 24 * HOUR);
  const slots = scheduleOf(orders, entries, now);
  const ivOrders = orders.filter((o) => o.type === 'iv');
  const vitals = entries.filter((e) => e.kind === 'vitals');
  const lastVitals = vitals.find((e) => !e.cancelled);
  const pendingLab = labs.filter((l) => OPEN_LAB.includes(l.status));

  // The handover for the next shift: what is due or overdue, IV fluids running, tests waiting, tasks not done,
  // the latest vital signs and this shift's notes.
  const summary = {
    shift,
    dosesOpen: slots.filter((x) => x.type === 'medicine' && ['due', 'overdue'].includes(x.state)).length,
    dosesNotGiven: slots.filter((x) => x.type === 'medicine' && NOT_GIVEN.includes(x.state) && x.dueAt >= shift.startedAt).length,
    tasksOpen: slots.filter((x) => x.type === 'task' && (['due', 'overdue', 'not_done'].includes(x.state))).length,
    ivRunning: ivOrders.filter((o) => o.status === 'active' && ivStateOf(o, entries).state === 'running').map((o) => o.iv.fluid),
    labPending: pendingLab.map((l) => l.tests.map((t) => t.name).join(', ')),
    lastVitals: lastVitals ? entryView(lastVitals) : null,
    vitalsDue: vitalsDue(lastVitals, now),
    notes: entries.filter((e) => !e.cancelled && e.kind === 'note' && new Date(e.at) >= shift.startedAt).map((e) => entryView(e)),
  };

  return {
    shift,
    orders: orders.map((o) => ({ ...orderView(o), ...(o.type === 'iv' && { ivState: ivStateOf(o, entries) }) })),
    schedule: slots.map((x) => ({ ...x, entry: x.entry ? entryView(x.entry, req) : null })),
    // as-needed doses and IV events, newest first
    doses: entries.filter((e) => e.kind === 'dose').slice(0, 100).map((e) => entryView(e, req)),
    ivEvents: entries.filter((e) => e.kind === 'iv').slice(0, 200).map((e) => entryView(e, req)),
    vitals: vitals.slice(0, 60).map((e) => entryView(e, req)),
    io: day.filter((e) => e.kind === 'io').map((e) => entryView(e, req)),
    ioTotals: ioTotals(day),
    notes: entries.filter((e) => ['note', 'task'].includes(e.kind)).slice(0, 100).map((e) => entryView(e, req)),
    handovers: entries.filter((e) => e.kind === 'handover').slice(0, 20).map((e) => entryView(e, req)),
    summary,
    labs: labs.map((l) => ({
      id: String(l._id),
      orderNumber: l.orderNumber,
      status: l.status,
      orderedAt: l.ordered?.at ?? l.createdAt,
      collectedAt: l.collected?.at ?? null,
      reportedAt: l.reported?.at ?? null,
      tests: l.tests.map((t) => t.name),
      flagged: l.tests.some((t) => t.values?.some((v) => FLAGGED.includes(v.flag))),
    })),
    settings: { vitalsEveryHours: nursing.vitalsEveryHours },
    can: {
      order: open && canWrite(req, level),
      chart: open && canNurse(req, level),
      collect: open && req.membership.roles.some((r) => config.access.labCollect.includes(r)),
    },
  };
}

export async function stayCare(req, admissionId) {
  const loaded = await loadStay(req, admissionId);
  await recordAudit(req, 'CARE_CHART_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), admissionId } });
  return careAnswer(req, loaded);
}

// ---------- Orders (doctors and RMOs) ----------

const ORDER_WORDS = { medicine: 'Medicine', iv: 'IV fluid', task: 'Care task' };
const orderText = (o) => (o.type === 'medicine' ? [o.medicine.drug, o.medicine.dose, o.medicine.route].filter(Boolean).join(' ') : o.type === 'iv' ? o.iv.fluid : o.task.text);

export async function addOrder(req, admissionId, body) {
  const loaded = await loadStay(req, admissionId);
  if (loaded.stay.status !== 'admitted' || !canWrite(req, loaded.level)) throw new HttpError(403, 'Her doctor or an RMO writes orders while she is in hospital.', 'FORBIDDEN');
  const same = await CareOrder.findOne({ hospitalId: req.hospitalId, clientRequestId: body.clientRequestId });
  if (!same) {
    const order = await CareOrder.create({
      hospitalId: req.hospitalId,
      patientId: loaded.stay.patientId,
      admissionId: loaded.stay._id,
      type: body.type,
      [body.type]: body[body.type],
      times: [...new Set(body.times)].sort(),
      instructions: body.instructions,
      ordered: { by: req.user._id, byName: req.user.name, at: new Date() },
      clientRequestId: body.clientRequestId,
    });
    await recordAudit(req, 'CARE_ORDER_ADDED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), admissionId, orderId: String(order._id), type: body.type } });
    await notifyRoles(req, ['nurse'], {
      type: 'CARE_ORDER',
      title: `New order: ${ORDER_WORDS[body.type].toLowerCase()}`,
      message: `${loaded.patient.name} (${loaded.patient.patientNumber}) · ${loaded.stay.ward}${loaded.stay.bed ? `, bed ${loaded.stay.bed}` : ''} · ${orderText(order)}`,
      link: `/hospital/inpatients/${loaded.stay._id}?tab=care`,
    });
  }
  return careAnswer(req, loaded);
}

export async function stopOrder(req, admissionId, orderId, reason) {
  const loaded = await loadStay(req, admissionId);
  if (!canWrite(req, loaded.level)) throw new HttpError(403, 'Her doctor or an RMO stops an order.', 'FORBIDDEN');
  const order = await CareOrder.findOne({ hospitalId: req.hospitalId, admissionId: loaded.stay._id, _id: orderId });
  if (!order) throw notFoundError('Order');
  if (order.status === 'active') {
    order.set({ status: 'stopped', stopped: { by: req.user._id, byName: req.user.name, at: new Date(), reason } });
    await order.save();
    await recordAudit(req, 'CARE_ORDER_STOPPED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), admissionId, orderId } });
    await notifyRoles(req, ['nurse'], {
      type: 'CARE_ORDER',
      title: `Order stopped: ${ORDER_WORDS[order.type].toLowerCase()}`,
      message: `${loaded.patient.name} (${loaded.patient.patientNumber}) · ${orderText(order)} · ${reason}`,
      link: `/hospital/inpatients/${loaded.stay._id}?tab=care`,
    });
  }
  return careAnswer(req, loaded);
}

// ---------- Charting (nurses, her doctor, RMOs) ----------

export async function chart(req, admissionId, body) {
  const loaded = await loadStay(req, admissionId);
  if (loaded.stay.status !== 'admitted' || !canNurse(req, loaded.level)) throw new HttpError(403, 'Nurses, her doctor or an RMO chart while she is in hospital.', 'FORBIDDEN');
  if (await NursingEntry.exists({ hospitalId: req.hospitalId, clientRequestId: body.clientRequestId })) return careAnswer(req, loaded);
  if (body.at < loaded.stay.admittedAt) throw fieldError('at', 'This time is before she was admitted.');

  let order = null;
  if (['dose', 'iv', 'task'].includes(body.kind)) {
    order = await CareOrder.findOne({ hospitalId: req.hospitalId, admissionId: loaded.stay._id, _id: body.orderId }).lean();
    const wanted = { dose: 'medicine', iv: 'iv', task: 'task' }[body.kind];
    if (!order || order.type !== wanted) throw fieldError('orderId', 'Choose one of the doctor\'s orders for her.');
    if (order.status === 'stopped' && !(body.dueAt && body.dueAt <= order.stopped.at)) throw new HttpError(409, 'This order has been stopped by the doctor.', 'ORDER_STOPPED');
    if (body.dueAt) {
      if (!order.times.length) throw fieldError('dueAt', 'This order is as needed: it has no set times.');
      const taken = await NursingEntry.exists({ hospitalId: req.hospitalId, orderId: order._id, dueAt: body.dueAt, cancelled: null });
      if (taken) throw new HttpError(409, 'This dose or task has already been charted. Mark that entry as entered in error first to change it.', 'ALREADY_CHARTED');
    } else if (body.kind !== 'iv' && order.times.length) {
      throw fieldError('dueAt', 'Choose the time it was due.');
    }
  }

  await NursingEntry.create({
    hospitalId: req.hospitalId,
    patientId: loaded.stay.patientId,
    admissionId: loaded.stay._id,
    kind: body.kind,
    at: body.at,
    orderId: order?._id ?? null,
    dueAt: body.dueAt ?? null,
    outcome: body.outcome ?? '',
    reason: body.reason ?? '',
    // a dose keeps the medicine as ordered, so the chart reads on its own
    medicine: body.kind === 'dose' ? { drug: order.medicine.drug, dose: order.medicine.dose, route: order.medicine.route } : undefined,
    iv: body.kind === 'iv' ? body.iv : undefined,
    io: body.kind === 'io' ? body.io : undefined,
    note: body.note,
    by: req.user._id,
    byName: req.user.name,
    clientRequestId: body.clientRequestId,
  });
  await recordAudit(req, 'NURSING_ENTRY', { hospitalId: req.hospitalId, details: { admissionId, kind: body.kind, ...(order && { orderId: String(order._id) }), ...(body.outcome && { outcome: body.outcome }) } });

  // A dose not given: her doctor hears of it.
  if (body.kind === 'dose' && NOT_GIVEN.includes(body.outcome) && loaded.stay.doctorId) {
    await notify(req, [loaded.stay.doctorId], {
      type: 'CARE_ORDER',
      title: 'Dose not given',
      message: `${loaded.patient.name} (${loaded.patient.patientNumber}) · ${orderText(order)} · ${body.outcome}: ${body.reason}`,
      link: `/hospital/inpatients/${loaded.stay._id}?tab=care`,
    });
  }
  return careAnswer(req, loaded);
}

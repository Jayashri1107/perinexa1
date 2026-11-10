// Patient timeline and waiting times (owner's decisions of 10 Nov 2026 – docs/PATIENT_FLOW_PLAN.md).
//
// The moments of an outpatient's day. Four are new and noted here, once each, on the visit (Visit.flow) and the new
// patient (Patient.registrationStartedAt) – by the server's clock, from what staff already do (decision 4: no
// buttons). The others are read from their own records when asked for, so there is one truth and nothing to keep in
// step: the arrival at reception (Arrival), the registration (Patient.createdAt), the first payment on her OPD bill
// that day (Bill), the lab orders of that day (LabOrder), the first pharmacy sale to her that day (PharmacyInvoice).
// "Left" is the last of finished, paid and medicines sold (decision 4). The role is kept, never the person (decision
// 6). Every query names the hospital. First version: OPD visits only (section 8, point 7).

import { Arrival } from '../models/Arrival.js';
import { Bill } from '../models/Bill.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { PharmacyInvoice } from '../models/Pharmacy.js';
import { Visit } from '../models/Visit.js';
import { DAY, hospitalDayStart, hospitalToday, utcDay } from '../careplans/dates.js';
import { config } from '../config.js';

const MIN = 60_000;

// ---------- Noting the new moments (each once) ----------

/** The role a moment is noted for: the doctor role wins (as when signing), then RMO, then nurse. */
export function flowRole(membership) {
  if (hasRole(membership, 'doctor')) return 'doctor';
  if (hasRole(membership, 'rmo')) return 'rmo';
  if (hasRole(membership, 'nurse')) return 'nurse';
  return 'other';
}

/** Writes visit.flow[field] = now only if it is still empty (two people at the same moment: the first one counts). */
export async function noteOnce(req, visit, field) {
  if (visit.flow?.[field]) return;
  const at = req.now ?? new Date();
  await Visit.updateOne({ _id: visit._id, tenantId: req.tenantId, [`flow.${field}`]: null }, { $set: { [`flow.${field}`]: at } });
}

/**
 * Opening a visit: the first time an RMO (without the doctor role) or a doctor opens it on its own day while it can
 * still be written is when they "start seeing her" (decision 2). Platform users working in a hospital are not counted.
 */
export async function noteSeeing(req, visit) {
  if (req.membership?.platform) return;
  if (visit.status !== 'active' || visit.signed) return;
  if (utcDay(visit.visitOn).getTime() !== hospitalToday(req.now).getTime()) return;
  const role = flowRole(req.membership);
  if (role === 'doctor') await noteOnce(req, visit, 'doctorFirstAt');
  else if (role === 'rmo') await noteOnce(req, visit, 'rmoFirstAt');
}

// ---------- The stages ----------

/** The stages, in the order Analytics shows them (section 4 of the plan). wait: a stage where she is waiting. */
export const STAGES = [
  { key: 'registration', label: 'Registration (new patients)', wait: false },
  { key: 'toRmo', label: 'Reception to RMO', wait: true },
  { key: 'rmoToDoctor', label: 'RMO to doctor', wait: true },
  { key: 'toDoctor', label: 'Reception to doctor, no RMO', wait: true },
  { key: 'vitals', label: 'Arrival to vitals', wait: true },
  { key: 'withDoctor', label: 'With the doctor', wait: false },
  { key: 'billing', label: 'Billing wait', wait: true },
  { key: 'pharmacy', label: 'Pharmacy wait', wait: true },
  { key: 'whole', label: 'Whole visit (arrival to leaving)', wait: false },
  { key: 'wholeWithSale', label: 'Whole visit, with medicines from the pharmacy', wait: false },
  { key: 'labSample', label: 'Lab: order to sample', wait: true },
  { key: 'labReport', label: 'Lab: sample to report', wait: false },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

const t = (d) => (d ? new Date(d).getTime() : null);
// Minutes from a to b; null when either is missing or they are in the wrong order (never guessed – section 4).
const minutes = (a, b) => (a == null || b == null || b < a ? null : Math.round((b - a) / MIN));

/**
 * The moments of one visit (epoch ms or null): registrationStart, registered, arrived, vitals, rmo, doctor, finished,
 * paid, sold, left, labs [{ ordered, collected, reported }]. "Arrived" is the arrival at reception, or for a patient
 * registered that day without "Mark arrived", the registration start (else the registration).
 */
export function momentsOf({ visit, arrival, patient, paidAt, soldAt, labs }) {
  const day = utcDay(visit.visitOn).getTime();
  const sameDay = (d) => d != null && hospitalToday(new Date(d)).getTime() === day;
  const registered = sameDay(patient?.createdAt) ? t(patient.createdAt) : null;
  const registrationStart = registered && patient?.registrationStartedAt ? t(patient.registrationStartedAt) : null;
  const arrived = t(arrival?.at) ?? registrationStart ?? registered;
  const f = visit.flow ?? {};
  const finished = t(f.finishedAt);
  const paid = t(paidAt);
  const sold = t(soldAt);
  const ends = [finished, paid, sold].filter((x) => x != null);
  return {
    registrationStart,
    registered,
    arrived,
    vitals: t(f.vitalsFirstAt),
    rmo: t(f.rmoFirstAt),
    doctor: t(f.doctorFirstAt),
    finished,
    paid,
    sold,
    left: ends.length ? Math.max(...ends) : null,
    labs: (labs ?? []).map((l) => ({ ordered: t(l.ordered?.at), collected: l.collectedAtReport ? null : t(l.collected?.at), reported: t(l.reported?.at) })),
  };
}

/** The minutes of each stage of one visit ({ key: minutes | null }) – section 4 of the plan. */
export function stagesOf(m) {
  const receptionDone = m.registered != null && m.arrived != null ? Math.max(m.registered, m.arrived) : (m.arrived ?? m.registered);
  const lab = m.labs.find((l) => l.ordered != null) ?? null;
  return {
    registration: minutes(m.registrationStart, m.registered),
    toRmo: minutes(receptionDone, m.rmo),
    rmoToDoctor: m.rmo != null ? minutes(m.rmo, m.doctor) : null,
    toDoctor: m.rmo == null ? minutes(receptionDone, m.doctor) : null,
    vitals: minutes(m.arrived, m.vitals),
    withDoctor: minutes(m.doctor, m.finished),
    billing: m.paid != null && m.finished != null && m.paid >= m.finished ? minutes(m.finished, m.paid) : null,
    pharmacy: m.sold != null ? minutes(m.finished, m.sold) : null,
    whole: minutes(m.arrived, m.left),
    wholeWithSale: m.sold != null ? minutes(m.arrived, m.left) : null,
    labSample: lab ? minutes(lab.ordered, lab.collected) : null,
    labReport: lab ? minutes(lab.collected, lab.reported) : null,
  };
}

// ---------- Numbers ----------

/** The usual time (median) and the slow time (9 of 10 are within it), nearest rank; null for an empty list. */
export function spread(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, p90: null };
  const rank = (p) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
  return { n: v.length, median: rank(0.5), p90: rank(0.9) };
}

// The hour (0–23) and weekday (0 = Sunday) of an instant in the hospital's time zone.
const PARTS = new Map();
function partsFmt(tz) {
  if (!PARTS.has(tz)) PARTS.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23', weekday: 'short' }));
  return PARTS.get(tz);
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function hourAndDay(ms, tz = config.HOSPITAL_TIME_ZONE) {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), weekday: WEEKDAYS.indexOf(p.weekday) };
}

// ---------- Loading a hospital's visits with their moments ----------

/**
 * The visits of a hospital between two hospital days (inclusive, midnight UTC), each with its moments and stages:
 * [{ visitId, patientId, visitOn, moments, stages }]. patientIds: only these patients (a doctor's visible ones), or
 * null for all. limit: the most visits read (the newest first).
 */
export async function loadFlows(tenantId, fromDay, toDay, { patientIds = null, limit = 20000 } = {}) {
  const q = { tenantId, status: 'active', visitOn: { $gte: utcDay(fromDay), $lte: utcDay(toDay) } };
  if (patientIds) q.patientId = { $in: patientIds };
  const visits = await Visit.find(q, { patientId: 1, visitOn: 1, flow: 1, status: 1, createdAt: 1 }).sort({ visitOn: -1 }).limit(limit).lean();
  if (!visits.length) return [];
  const pids = [...new Set(visits.map((v) => String(v.patientId)))];
  const days = [...new Set(visits.map((v) => utcDay(v.visitOn).getTime()))].map((d) => new Date(d));
  const from = hospitalDayStart(utcDay(fromDay));
  const to = new Date(hospitalDayStart(utcDay(toDay)).getTime() + DAY);
  const [arrivals, patients, bills, sales, labs] = await Promise.all([
    Arrival.find({ tenantId, patientId: { $in: pids }, on: { $in: days } }, { patientId: 1, on: 1, at: 1 }).lean(),
    Patient.find({ tenantId, _id: { $in: pids } }, { createdAt: 1, registrationStartedAt: 1 }).lean(),
    Bill.find({ tenantId, kind: 'opd', status: 'open', patientId: { $in: pids }, on: { $in: days } }, { patientId: 1, on: 1, payments: 1 }).lean(),
    PharmacyInvoice.find({ tenantId, kind: 'sale', patientId: { $in: pids }, 'created.at': { $gte: from, $lt: to } }, { patientId: 1, created: 1 }).lean(),
    LabOrder.find({ tenantId, patientId: { $in: pids }, 'ordered.at': { $gte: from, $lt: to }, status: { $ne: 'cancelled' } }, { patientId: 1, ordered: 1, collected: 1, collectedAtReport: 1, reported: 1 }).lean(),
  ]);
  const key = (pid, day) => `${pid}|${utcDay(day).getTime()}`;
  const dayOf = (instant) => hospitalToday(new Date(instant));
  const arrivalBy = new Map(arrivals.map((a) => [key(a.patientId, a.on), a]));
  const patientBy = new Map(patients.map((p) => [String(p._id), p]));
  const billBy = new Map(bills.map((b) => [key(b.patientId, b.on), b]));
  const firstSale = new Map();
  for (const s of sales) {
    const k = key(s.patientId, dayOf(s.created.at));
    const at = t(s.created.at);
    if (!firstSale.has(k) || at < firstSale.get(k)) firstSale.set(k, at);
  }
  const labsBy = new Map();
  for (const l of labs) {
    const k = key(l.patientId, dayOf(l.ordered.at));
    if (!labsBy.has(k)) labsBy.set(k, []);
    labsBy.get(k).push(l);
  }
  return visits.map((visit) => {
    const k = key(visit.patientId, visit.visitOn);
    const arrival = arrivalBy.get(k) ?? null;
    // The first payment that day after she arrived (an advance fee paid at booking does not count)
    const since = t(arrival?.at) ?? t(visit.createdAt);
    const paidAt = (billBy.get(k)?.payments ?? []).filter((p) => p.kind === 'payment' && !p.removed && t(p.at) >= since).map((p) => t(p.at)).sort((a, b) => a - b)[0] ?? null;
    const moments = momentsOf({ visit, arrival, patient: patientBy.get(String(visit.patientId)), paidAt, soldAt: firstSale.get(k) ?? null, labs: labsBy.get(k) ?? [] });
    return { visitId: String(visit._id), patientId: String(visit.patientId), visitOn: visit.visitOn, moments, stages: stagesOf(moments) };
  });
}

/** One visit's moments and stages (the timeline on her record). */
export async function flowOfVisit(tenantId, visit) {
  const rows = await loadFlows(tenantId, visit.visitOn, visit.visitOn, { patientIds: [visit.patientId] });
  return rows.find((r) => r.visitId === String(visit._id)) ?? null;
}

// ---------- "Longer than usual" (decision 7) ----------

export const USUAL_MIN_VISITS = 30; // no mark until a stage has this many visits in the last three finished months

const usualCache = new Map(); // `${tenantId}|${today}` → { stage: p90 | null }

/**
 * The slow time of each stage in this hospital (9 of 10 visits of the last three finished months are within it), or
 * null for a stage with fewer than USUAL_MIN_VISITS visits. Worked out once a day per hospital.
 */
export async function usualTimes(tenantId, now = new Date()) {
  const today = hospitalToday(now);
  const cacheKey = `${tenantId}|${today.getTime()}`;
  if (usualCache.has(cacheKey)) return usualCache.get(cacheKey);
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
  const to = new Date(firstOfMonth.getTime() - DAY);
  const rows = await loadFlows(tenantId, from, to);
  const out = {};
  for (const k of STAGE_KEYS) {
    const s = spread(rows.map((r) => r.stages[k]));
    out[k] = s.n >= USUAL_MIN_VISITS ? s.p90 : null;
  }
  if (usualCache.size > 500) usualCache.clear();
  usualCache.set(cacheKey, out);
  return out;
}

/** Forgets the cached usual times (tests). */
export const clearUsualTimes = () => usualCache.clear();

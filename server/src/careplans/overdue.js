// Overdue care-plan items across patients (4 Oct 2026): for the automatic "something is due" messages
// (reminders/generalReminders.js) and the "Vaccinations overdue" lists of the Today page (routes/worklist.js,
// routes/today.js). Read-only for the callers: they get the patient and the overdue items; who may see them, and
// what is said about them, is decided by each caller.
//
// Rules this file keeps:
//  - every query carries the hospital's tenantId;
//  - only CURRENT, ACTIVE plans of the patient's present type of care count: a closed or paused plan, a plan on hold
//    for an EDD review and a plan of an earlier type of care have nothing "overdue";
//  - a plan that is behind its patient (the facts it was worked out from changed) is brought up to date before it
//    is believed – never audited, like every automatic sync;
//  - "overdue" is the plan engine's own status (planStatuses): an open item whose due-by day has passed; a visit a
//    later visit replaced is "missed", not overdue;
//  - every row says whether the plan is APPROVED: a doctor approved the very content it was built from (hashes.js).
//    A plan built from a draft is still a draft: staff lists mark it, and no message goes to a patient from it;
//  - when there are more plans than the limit, the ones kept are those whose item became overdue MOST RECENTLY (the
//    cut is made after ordering, in the database) – a list that is cut short never loses this week's patients.

import mongoose from 'mongoose';
import { CarePlan } from '../models/CarePlan.js';
import { CarePlanTemplate, TEMPLATE_CARE_TYPES } from '../models/CarePlanTemplate.js';
import { Patient } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { addDays, daysBetween, hospitalToday, utcDay } from './dates.js';
import { planApproval } from './hashes.js';
import { itemId, planFacts, planStatuses } from './planEngine.js';
import { PLAN_ENGINE_VERSION, POST_DATES_DAYS } from './planRules.js';
import { syncPlanSafely } from './plansService.js';

// What the engine's statuses need of a plan (never the log, notes, results or history).
const PLAN_FIELDS = {
  patientId: 1,
  careType: 1,
  status: 1,
  bookedOn: 1,
  basis: 1,
  source: 1,
  'items._id': 1,
  'items.key': 1,
  'items.origin': 1,
  'items.kind': 1,
  'items.name': 1,
  'items.state': 1,
  'items.timing': 1,
  'items.notInTemplate': 1,
  'items.auto': 1,
};

/** kindsFor of the "Vaccinations overdue" lists (the worklist, reception's call list): a baby's plan, vaccinations only. */
export const babyVaccinations = (careType) => (careType === 'newborn' ? ['vaccination'] : []);

// What an approval is worked out from (hashes.js): the template's content, its risk rules and its recorded approvals.
const TEMPLATE_FIELDS = { careType: 1, kind: 1, items: 1, riskRules: 1, approvals: 1, status: 1, version: 1, approvedVersion: 1, approvedBy: 1, approvedByName: 1, approvedAt: 1 };

// The plan was worked out from other facts than the patient has now (or by an older engine).
const isBehind = (plan, patient, now) => plan.basis?.engineVersion !== PLAN_ENGINE_VERSION || plan.basis?.key !== planFacts(patient, now, plan).basisKey;

/**
 * Patients whose current, active care plan has an overdue item today.
 * options:
 *  - now: the moment (the hospital's date of it is "today");
 *  - kindsFor(careType): the kinds of item that count for a plan of this type of care ([] = none);
 *  - careTypes: only plans of these types of care (default: every type);
 *  - patientIds: only these patients (default: every patient of the hospital);
 *  - overdueSince: only plans with an item whose due-by day is on or after this day (default: however long ago);
 *  - withOlder: with overdueSince, a plan that has such an item is listed with ALL its overdue items, also the
 *    older ones (staff lists: the whole picture of a baby that is on the list). Default: only the items since then;
 *  - skipPostDates: leave out antenatal plans from 43 weeks (they have left the reminder lists);
 *  - limit: plans read at most (cut: true when there were more – the most recently overdue are the ones kept).
 * Returns { rows: [{ patient (lean), planId, careType, approved, items: [{ itemId, kind, name, dueFrom, dueBy }] }],
 * cut } – the rows most recently overdue first, the items of each row oldest first; approved: false for a plan
 * built from content no doctor approved.
 */
export async function overduePlanItems(tenantId, { now = new Date(), kindsFor, careTypes = TEMPLATE_CARE_TYPES, patientIds = null, overdueSince = null, withOlder = false, skipPostDates = false, limit = 1000 }) {
  const today = hospitalToday(now);
  const since = overdueSince ? utcDay(overdueSince) : null;
  const types = careTypes.filter((t) => kindsFor(t).length);
  if (!types.length || (patientIds && !patientIds.length)) return { rows: [], cut: false };
  const kinds = [...new Set(types.flatMap((t) => kindsFor(t)))];
  const oid = (v) => new mongoose.Types.ObjectId(String(v._id ?? v));
  // Which plans, the most recently overdue first – ordered BEFORE the cut. (An aggregate is not cast by the model:
  // the ids and days are given as they are stored.)
  const counts = (it) => ({ $and: [{ $in: [`${it}.kind`, kinds] }, { $eq: [`${it}.state`, 'open'] }, { $eq: [`${it}.auto.phase`, 'open'] }, { $lt: [`${it}.auto.dueBy`, today] }, ...(since ? [{ $gte: [`${it}.auto.dueBy`, since] }] : [])] });
  const order = await CarePlan.aggregate([
    {
      $match: {
        tenantId: oid(tenantId),
        current: true,
        status: 'active',
        careType: { $in: types },
        ...(patientIds ? { patientId: { $in: patientIds.map(oid) } } : {}),
        items: { $elemMatch: { kind: { $in: kinds }, state: 'open', 'auto.phase': 'open', 'auto.dueBy': { $lt: today, ...(since ? { $gte: since } : {}) } } },
      },
    },
    { $project: { latest: { $max: { $map: { input: { $filter: { input: '$items', as: 'it', cond: counts('$$it') } }, as: 'it', in: '$$it.auto.dueBy' } } } } },
    { $sort: { latest: -1, _id: 1 } },
    { $limit: limit + 1 },
  ]);
  const cut = order.length > limit;
  const wanted = order.slice(0, limit).map((o) => o._id);
  const rows = await planRows(tenantId, wanted, now, (plan, statuses) => {
    if (skipPostDates && plan.careType === 'antenatal' && daysBetween(utcDay(plan.basis.edd), today) >= POST_DATES_DAYS) return [];
    const kindsOfPlan = kindsFor(plan.careType);
    const overdue = (plan.items ?? []).filter((it) => kindsOfPlan.includes(it.kind) && it.state === 'open' && statuses.get(it)?.status === 'overdue');
    const recent = since ? overdue.filter((it) => utcDay(it.auto.dueBy) >= since) : overdue;
    return recent.length ? (withOlder ? overdue : recent) : [];
  });
  return { rows, cut };
}

/**
 * Patients whose current, active care plan has an item due soon: open, not overdue yet, and its window opens by
 * `withinDays` days from today (reception's "Babies due soon", 26 Oct 2026). Same options as overduePlanItems
 * (now, kindsFor, careTypes, limit); same rows, each with the items due soon, the earliest first. A plan with
 * an overdue item of these kinds is left out: it is on the overdue lists. cut: true when there were more plans
 * than the limit (the ones whose window opens first are kept).
 */
export async function dueSoonPlanItems(tenantId, { now = new Date(), kindsFor, careTypes = TEMPLATE_CARE_TYPES, withinDays = 7, limit = 1000 }) {
  const today = hospitalToday(now);
  const until = addDays(today, withinDays);
  const types = careTypes.filter((t) => kindsFor(t).length);
  if (!types.length) return { rows: [], cut: false };
  const kinds = [...new Set(types.flatMap((t) => kindsFor(t)))];
  const oid = (v) => new mongoose.Types.ObjectId(String(v._id ?? v));
  const counts = (it) => ({ $and: [{ $in: [`${it}.kind`, kinds] }, { $eq: [`${it}.state`, 'open'] }, { $eq: [`${it}.auto.phase`, 'open'] }, { $gte: [`${it}.auto.dueBy`, today] }, { $lte: [`${it}.auto.dueFrom`, until] }] });
  const order = await CarePlan.aggregate([
    {
      $match: {
        tenantId: oid(tenantId),
        current: true,
        status: 'active',
        careType: { $in: types },
        items: { $elemMatch: { kind: { $in: kinds }, state: 'open', 'auto.phase': 'open', 'auto.dueBy': { $gte: today }, 'auto.dueFrom': { $lte: until } } },
      },
    },
    { $project: { first: { $min: { $map: { input: { $filter: { input: '$items', as: 'it', cond: counts('$$it') } }, as: 'it', in: '$$it.auto.dueFrom' } } } } },
    { $sort: { first: 1, _id: 1 } },
    { $limit: limit + 1 },
  ]);
  const cut = order.length > limit;
  const rows = await planRows(tenantId, order.slice(0, limit).map((o) => o._id), now, (plan, statuses) => {
    const ofKind = (plan.items ?? []).filter((it) => kindsFor(plan.careType).includes(it.kind) && it.state === 'open');
    if (ofKind.some((it) => statuses.get(it)?.status === 'overdue')) return [];
    return ofKind.filter((it) => ['due', 'upcoming'].includes(statuses.get(it)?.status) && it.auto?.dueFrom && utcDay(it.auto.dueFrom) <= until);
  });
  const first = (r) => Math.min(...r.items.map((it) => it.dueFrom.getTime()));
  rows.sort((a, b) => first(a) - first(b));
  return { rows, cut };
}

/**
 * The rows of overduePlanItems and dueSoonPlanItems, for these plan ids (kept in their order): each plan brought up
 * to date when it is behind its patient, then pick(plan, statuses) chooses its items ([] leaves the plan out).
 */
async function planRows(tenantId, wanted, now, pick) {
  if (!wanted.length) return [];
  const today = hospitalToday(now);
  const place = new Map(wanted.map((id, i) => [String(id), i]));
  const plans = (await CarePlan.find({ tenantId, _id: { $in: wanted } }, PLAN_FIELDS).lean()).sort((a, b) => place.get(String(a._id)) - place.get(String(b._id)));
  // (never a record marked as a duplicate of another, nor a record closed after a death: its plan is not followed any more)
  const patients = new Map((await Patient.find({ tenantId, _id: { $in: plans.map((p) => p.patientId) }, ...IN_USE }).lean()).map((p) => [String(p._id), p]));
  // The templates the plans were built from, and each type of care's hospital standard (its risk rules)
  const templates = await CarePlanTemplate.find({ tenantId, $or: [{ _id: { $in: plans.map((p) => p.source.templateId) } }, { kind: 'standard' }] }, TEMPLATE_FIELDS).lean();
  const templateOf = new Map(templates.map((t) => [String(t._id), t]));
  const standardOf = new Map(templates.filter((t) => t.kind === 'standard').map((t) => [t.careType, t]));

  const rows = [];
  for (const stored of plans) {
    const patient = patients.get(String(stored.patientId));
    if (!patient || patient.careType !== stored.careType) continue; // a plan of an earlier type of care
    let plan = stored;
    if (isBehind(stored, patient, now)) {
      // Worked out again from her details as they are now; if that fails the plan is left out (never believed stale).
      if (!(await syncPlanSafely({ req: null, tenantId, user: null, now }, stored.patientId))) continue;
      plan = await CarePlan.findOne({ tenantId, patientId: stored.patientId, careType: stored.careType, current: true, status: 'active' }, PLAN_FIELDS).lean();
      if (!plan) continue;
    }
    const picked = pick(plan, planStatuses(plan, today));
    if (!picked.length) continue;
    const items = [...picked]
      .sort((a, b) => utcDay(a.auto.dueBy) - utcDay(b.auto.dueBy))
      .map((it) => ({ itemId: itemId(it), kind: it.kind, name: it.name, dueFrom: utcDay(it.auto.dueFrom), dueBy: utcDay(it.auto.dueBy) }));
    const { approved } = planApproval(plan, { srcT: templateOf.get(String(plan.source.templateId)) ?? null, stdT: standardOf.get(plan.careType) ?? null, patient });
    rows.push({ patient, planId: String(plan._id), careType: plan.careType, approved, items });
  }
  return rows;
}

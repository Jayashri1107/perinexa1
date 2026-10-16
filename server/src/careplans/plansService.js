// Patients' care plans on the server: building a plan, keeping it in step with the patient's details, and
// every change a doctor or RMO makes. The routes (routes/carePlans.js) and later features (visits, Feature 8)
// call these functions with a context from planCtx(req): { req, tenantId, user, now }.
//
// Rules this file keeps (see the CarePlan model for who writes what):
//  - every lookup is by hospital AND patient, so a plan, item or template of anyone else is "not found";
//  - the automatic sync never writes what people recorded, and is never audited (the patient change that
//    triggered it is). Its details go into the plan log, which only clinical staff can see;
//  - audit entries hold ids only – never an item's name or key, a template name, a reason, a note, a result,
//    a date or a pregnancy outcome.
// This is decision support: the plan suggests, the treating doctor or an RMO decides.

import { randomBytes } from 'node:crypto';
import { CarePlan } from '../models/CarePlan.js';
import { CarePlanTemplate } from '../models/CarePlanTemplate.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientById } from '../utils/patientLookup.js';
import { ANTENATAL_DRAFT } from './antenatalDraft.js';
import { addDays, dayZero, daysBetween, gaOn, hospitalToday, sameDay, timeIn, utcDay, weekEnd } from './dates.js';
import { defaultProtocolFor, defaultStates } from './defaultProtocol.js';
import { contentApproved, itemsHash, planApproval } from './hashes.js';
import { GYNAECOLOGY_DRAFT, INFERTILITY_DRAFT, NEWBORN_DRAFT, POSTNATAL_DRAFT } from './otherDrafts.js';
import { derivePlan, itemId, lossStart, mergeTemplate, newItem, nextVisitSuggestion, planFacts, planStatuses, staffBasis } from './planEngine.js';
import {
  AUTO_LOG_KEEP,
  DONE_EARLIEST_DAYS,
  MAX_CUSTOM,
  MAX_ITEMS,
  MIN_BOOKING_DAYS,
  MOVE_MAX_SPAN_DAYS,
  PLAN_ENGINE_VERSION,
  POST_DATES_DAYS,
  SAME_PREGNANCY_DAYS,
} from './planRules.js';
import { REASON_MESSAGE } from './planSchemas.js';
import { carePlanSummary, dateText, gaText, planView, timingText, windowText } from './planView.js';

export { carePlanSummary, planView };

const ANTENATAL = 'antenatal';
const AUTOMATIC = 'Automatic';
const CLINICAL_ROLES = ['doctor', 'rmo', 'nurse'];

// ---------- Context, access and errors ----------

/** The context every plan function works in: the request (for access and audit), hospital, person, and one moment. */
export const planCtx = (req) => ({ req, tenantId: req.tenantId, user: req.user, now: req.now ?? new Date() });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const notFound = (message) => new HttpError(404, message, 'NOT_FOUND');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const PAUSED_MESSAGE = 'This care plan is paused (the type of care is not antenatal). Only items can be updated, or the plan closed.';
const CLOSED_MESSAGE = 'This care plan is closed. Reopen it to make changes.';
const HAS_CURRENT_MESSAGE = 'This patient already has a current care plan.';

/** The automatic sync could not save after 3 tries (other saves kept getting in first). */
export class SyncConflict extends HttpError {
  constructor() {
    super(409, 'This care plan was being updated at the same moment. Please try again.', 'CONFLICT');
  }
}

/** Who may see and change this patient's care plan: { view, edit, level } (from the patient access rules). */
export function carePlanAccess(req, patient) {
  const a = patientAccess(req, patient);
  return { view: a.view.has('pregnancy'), edit: a.editClinical, level: a.level, emergencyNote: a.emergencyNote };
}

/** 403 unless this person may see the care plan. Returns carePlanAccess. */
export function assertCanView(req, patient) {
  const a = carePlanAccess(req, patient);
  if (a.view) return a;
  if (!hasRole(req.membership, ...CLINICAL_ROLES)) throw forbidden("Your role doesn't include care plans.");
  throw forbidden('This is a sensitive record: care plans are only visible to the treating doctor and RMOs.');
}

/** 403 unless this person may change the care plan (the treating or an unassigned doctor, or an RMO). */
export function assertCanEdit(req, patient) {
  const a = assertCanView(req, patient);
  if (a.edit) return a;
  if (a.emergencyNote) throw forbidden("This is another doctor's patient: you can view the care plan but not change it.");
  throw forbidden("Only the patient's doctor or an RMO can change the care plan.");
}

// ---------- Small helpers ----------

const person = (ctx) => ({ by: ctx.user._id, byName: ctx.user.name, at: ctx.now });
const within56 = (a, b) => a != null && b != null && Math.abs(daysBetween(a, b)) <= SAME_PREGNANCY_DAYS;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// A saved record copied into an item's history, without staff ids.
const plainRecord = (r) => {
  if (!r) return null;
  const { by: _by, visitId: _visitId, ...rest } = typeof r.toObject === 'function' ? r.toObject() : r;
  return rest;
};

const CLOSE_WORDS = {
  delivered: 'Delivered',
  pregnancy_ended: 'Pregnancy ended',
  transferred_out: 'Transferred out',
  care_elsewhere: 'Care continues elsewhere',
  new_pregnancy: 'New pregnancy',
  other: 'Other',
};

// The plan log: what happened to the plan, for clinical staff. Automatic entries are trimmed; entries made
// by people never are.
function addLog(plan, { at, by = null, byName = AUTOMATIC, action, text = '', auto = false }) {
  plan.log.push({ at, by, byName, action, text: text.length > 300 ? `${text.slice(0, 299)}…` : text, auto });
}
const autoLog = (plan, now, action, text) => addLog(plan, { at: now, action, text, auto: true });
const personLog = (ctx, plan, action, text) => addLog(plan, { at: ctx.now, by: ctx.user._id, byName: ctx.user.name, action, text });

/** Keeps the newest AUTO_LOG_KEEP automatic log entries (oldest ones go first); entries by people all stay. */
export function trimAutoLog(plan, keep = AUTO_LOG_KEEP) {
  let extra = plan.log.filter((l) => l.auto).length - keep;
  if (extra <= 0) return;
  plan.log = plan.log.filter((l) => !(l.auto && extra-- > 0));
}

// ---------- Finding plans and templates ----------

// Version 2: every type of care has its own plan (one current plan per patient and type of care). Antenatal plans
// follow the pregnancy (EDD changes, a new pregnancy); the others count from week 0 – the delivery, the birth or
// the day the plan started (planEngine.startFor).
const currentPlanOf = (tenantId, patientId, careType = ANTENATAL) => CarePlan.findOne({ tenantId, patientId, careType, current: true });
// Earlier plans: closed ones, and current ones of another type of care than the one shown (e.g. the paused
// antenatal plan of a mother who is now postnatal).
const earlierPlansOf = (tenantId, patientId, shownId = null) =>
  CarePlan.find({ tenantId, patientId, ...(shownId ? { _id: { $ne: shownId } } : {}), $or: [{ current: false }, { status: 'paused' }] }).sort({ createdAt: -1 });
const standardTemplate = (tenantId, careType = ANTENATAL) => CarePlanTemplate.findOne({ tenantId, careType, kind: 'standard' });

/** The plan's own template and the hospital standard (whose risk rules decide the high-risk items). */
async function templatesOf(tenantId, plan) {
  const stdT = await standardTemplate(tenantId, plan?.careType ?? ANTENATAL);
  if (!plan) return { srcT: null, stdT };
  const same = stdT && String(stdT._id) === String(plan.source.templateId);
  const srcT = same ? stdT : await CarePlanTemplate.findOne({ _id: plan.source.templateId, tenantId });
  return { srcT, stdT };
}

/**
 * A closed plan belongs to this pregnancy (so no new plan is built automatically): its EDD is within 8 weeks,
 * or it was closed by a person while on hold for an EDD within 8 weeks of this one.
 */
async function closedPlanForPregnancy(tenantId, patientId, edd) {
  const closed = await CarePlan.find({ tenantId, patientId, careType: ANTENATAL, current: false }, { basis: 1, closed: 1, eddReview: 1 }).lean();
  return closedForPregnancy(closed, edd);
}

/**
 * The rule of closedPlanForPregnancy, PURE: one of these closed plans (with basis.edd, closed.reason and
 * eddReview.toEdd) belongs to the pregnancy with this EDD. Also used by the calendar, which leaves out the
 * LMP and EDD of a pregnancy whose plan was closed (delivered, ended, transferred …), and by Analytics.
 */
export function closedForPregnancy(closedPlans, edd) {
  return closedPlans.some(
    (p) => Boolean(within56(p.basis?.edd, edd) || (p.closed?.reason !== 'new_pregnancy' && p.eddReview?.toEdd && within56(p.eddReview.toEdd, edd))),
  );
}

/**
 * A plan that starts by itself (postnatal, newborn) and was closed for this same delivery or birth – its week 0 is
 * within 8 weeks of this one – is not built again by itself, like a pregnancy's closed plan: Reopen brings it back.
 * (Before 4 Oct 2026 the next read of the record built a new plan, so a closed plan never stayed closed.)
 */
async function closedPlanForStart(tenantId, patientId, careType, startOn) {
  const closed = await CarePlan.find({ tenantId, patientId, careType, current: false }, { 'basis.startOn': 1 }).lean();
  return closed.some((p) => within56(p.basis?.startOn, startOn));
}

// Why there is no plan: antenatal without dates; postnatal before the delivery is recorded; a newborn without a
// time of birth; pregnancy-loss care before the type of loss is entered (the plan counts from its date seen). null
// for a postnatal, newborn or pregnancy-loss record that has its day: its plan was closed (see Earlier plans).
function noPlanReason(patient) {
  if (patient.careType === ANTENATAL) return !patient.pregnancy?.effectiveEdd ? 'no_dates' : null;
  if (patient.careType === 'postnatal') return !patient.lastDelivery?.at ? 'no_delivery' : null;
  if (patient.careType === 'newborn') return !patient.newborn?.birthAt ? 'no_birth' : null;
  if (patient.careType === 'abortion') return !lossStart(patient) ? 'no_loss_details' : null;
  // Gynaecology and infertility: no plan until a doctor or RMO starts one
  return 'not_started';
}

// ---------- Creating a plan ----------

/**
 * The template a NEW plan of this patient starts from: the default protocol of the patient's assigned doctor for
 * this type of care, while it is in use (approved as it is now, with items, its doctor still working here as a
 * doctor – careplans/defaultProtocol.js); otherwise the hospital standard template. Existing plans never change
 * because of this choice.
 */
async function startingTemplate(tenantId, patient, careType) {
  const own = await defaultProtocolFor(tenantId, patient.assignedDoctor, careType);
  if (own) return own;
  const standard = await standardTemplate(tenantId, careType);
  if (!standard) throw new Error(`The hospital has no standard ${careType} template.`);
  return standard;
}

/**
 * Builds the patient's plan from the template a new plan starts from (startingTemplate): the assigned doctor's
 * default protocol when there is one in use, otherwise the hospital standard template (even while it is a draft – the
 * plan then carries the Draft label). The booking date defaults to the hospital's today (the day the dates
 * are entered, normally the booking visit). Audited (CARE_PLAN_CREATED) only for a patient's first plan.
 * A duplicate-key error (code 11000) means another request built the plan at the same moment.
 * opts: { facts, replacesPlanId, bookedOn }.
 */
export async function createPlan(ctx, patient, { facts = planFacts(patient, ctx.now), replacesPlanId = null, bookedOn = null } = {}) {
  const careType = patient.careType;
  const template = await startingTemplate(ctx.tenantId, patient, careType);
  const firstPlan = !(await CarePlan.exists({ tenantId: ctx.tenantId, patientId: patient._id }));
  const plan = new CarePlan({
    tenantId: ctx.tenantId,
    patientId: patient._id,
    careType,
    replacesPlanId,
    source: {
      templateId: template._id,
      templateName: template.name,
      templateKind: template.kind,
      ownerName: template.ownerName ?? null,
      version: template.version,
      itemsHash: itemsHash(template.items),
      chosenBy: null, // automatic
    },
    basis: {
      key: facts.basisKey,
      edd: facts.edd,
      eddSource: facts.eddSource,
      startOn: facts.startOn ?? null,
      patientVersion: patient.__v ?? 0,
      engineVersion: PLAN_ENGINE_VERSION,
      syncedAt: ctx.now,
    },
    // Gynaecology and infertility: the first visit is the plan's start (week 0). A plan that starts by itself
    // (postnatal, newborn, pregnancy loss) is booked on the day it is built: what had already passed by then is for
    // the doctor to decide, not overdue.
    bookedOn: utcDay(bookedOn) ?? (careType !== ANTENATAL && facts.startOn && !AUTO_START.includes(careType) ? facts.startOn : hospitalToday(ctx.now)),
    items: template.items.map((t) => newItem(t)),
    createdBy: { by: null, byName: AUTOMATIC },
  });
  const whose = template.kind === 'personal' ? ` – the default protocol of ${template.ownerName ?? 'the assigned doctor'}` : '';
  autoLog(plan, ctx.now, 'created', `Plan built from “${template.name}” version ${template.version}${whose}`);
  derivePlan(plan, facts, { at: ctx.now, newIds: new Set(plan.items.map(itemId)) });
  await plan.save();
  if (firstPlan && ctx.req) {
    await audit(ctx.req, 'CARE_PLAN_CREATED', { details: { patientId: String(patient._id), mrn: patient.mrn, planId: String(plan._id) } });
  }
  return plan;
}

// ---------- Keeping the plan in step with the patient (sync) ----------

const PAUSE_TEXT = {
  care_type_changed: 'Paused: the type of care is no longer antenatal. Items can still be marked done; no reminders.',
  no_edd: 'Paused: the pregnancy dates were removed.',
};

function pause(plan, reason, now) {
  if (plan.status === 'active') {
    plan.status = 'paused';
    plan.pausedReason = reason;
    autoLog(plan, now, 'paused', PAUSE_TEXT[reason]);
  } else if (plan.pausedReason !== reason) plan.pausedReason = reason;
}

function closeWith(plan, closed) {
  plan.current = false;
  plan.status = 'closed';
  plan.pausedReason = null;
  plan.closed = closed;
}

/**
 * Applies the patient's type of care and EDD to the plan (in memory): pause, resume, move the dates for a
 * small EDD change, or hold the plan for the doctor's decision when the EDD moved by more than 8 weeks.
 * Returns { newPregnancy: true } when a paused plan meets a different pregnancy, or { redated } when the
 * dates moved (logged after the items are worked out, so the log can say how many need a date check).
 */
function followPatient(plan, patient, facts, now) {
  if (patient.careType !== ANTENATAL) {
    pause(plan, 'care_type_changed', now);
    return {};
  }
  if (!facts.edd) {
    pause(plan, 'no_edd', now);
    return {};
  }
  if (plan.status === 'paused') {
    const same = within56(facts.edd, plan.basis.edd) || (plan.eddReview && within56(facts.edd, plan.eddReview.toEdd));
    if (!same) return { newPregnancy: true };
    plan.status = 'active';
    plan.pausedReason = null;
    autoLog(plan, now, 'resumed', 'Resumed: antenatal care continues for the same pregnancy.');
  }
  const E = utcDay(plan.basis.edd);
  const delta = Math.abs(daysBetween(E, facts.edd));
  if (delta === 0) {
    plan.basis.eddSource = facts.eddSource;
    if (plan.eddReview) {
      plan.eddReview = null;
      autoLog(plan, now, 'edd_review_cleared', `The EDD is back to ${dateText(E)}: the plan is no longer on hold.`);
    }
    return {};
  }
  if (plan.eddReview && sameDay(facts.edd, plan.eddReview.toEdd)) return {}; // still waiting for the decision
  if (delta <= SAME_PREGNANCY_DAYS) {
    plan.basis.edd = facts.edd;
    plan.basis.eddSource = facts.eddSource;
    plan.eddReview = null;
    return { redated: { from: E, to: facts.edd, source: facts.eddSource } };
  }
  plan.eddReview = { fromEdd: E, toEdd: facts.edd, detectedAt: now };
  autoLog(
    plan,
    now,
    'edd_review',
    `The EDD changed from ${dateText(E)} to ${dateText(facts.edd)}. The plan is on hold until the doctor confirms whether this is the same pregnancy.`,
  );
  return {};
}

const checkDateText = (n) => (n ? ` ${plural(n, 'moved item needs', 'moved items need')} a date check.` : '');
const itemNames = (plan, ids) => {
  const set = new Set(ids);
  return plan.items.filter((it) => set.has(itemId(it))).map((it) => it.name).join(', ');
};

// After the items were worked out again: what the plan log says about it.
function logAutomaticChanges(plan, res, redated, now) {
  if (redated) {
    const source = redated.source === 'scan' ? 'scan EDD' : 'EDD from LMP';
    autoLog(plan, now, 'edd_redated', `Due dates moved: EDD changed from ${dateText(redated.from)} to ${dateText(redated.to)} (${source}).${checkDateText(res.checkDate)}`);
  }
  if (res.nowApply.length) autoLog(plan, now, 'items_apply', `${plural(res.nowApply.length, 'item now applies', 'items now apply')}: ${itemNames(plan, res.nowApply)}`);
  if (res.noLongerApply.length) {
    autoLog(plan, now, 'items_no_longer_apply', `${plural(res.noLongerApply.length, 'item no longer applies', 'items no longer apply')}: ${itemNames(plan, res.noLongerApply)}`);
  }
}

/**
 * The automatic part of a sync, in memory: follows the patient's type of care and EDD, then works the items
 * out again and writes the plan log. Returns { newPregnancy: true } (and changes nothing else) when a paused
 * plan meets a different pregnancy. Used by syncPlan, and by a read that could not save.
 */
function workOutSync(plan, patient, facts, now, { log = true } = {}) {
  const { newPregnancy, redated } = followPatient(plan, patient, facts, now);
  if (newPregnancy) return { newPregnancy: true };
  plan.basis.key = facts.basisKey;
  plan.basis.patientVersion = patient.__v ?? 0;
  plan.basis.engineVersion = PLAN_ENGINE_VERSION;
  const res = derivePlan(plan, facts, { at: now, actorName: AUTOMATIC, compare: log });
  if (log) {
    logAutomaticChanges(plan, res, redated, now);
    trimAutoLog(plan);
  }
  return { newPregnancy: false };
}

// A deep copy of a plain (lean) object: Dates are copied; ids and other values are shared (never changed in place).
function copyPlain(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i += 1) out[i] = copyPlain(v[i]);
    return out;
  }
  if (v instanceof Date) return new Date(v.getTime());
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  const out = {};
  for (const k of Object.keys(v)) out[k] = copyPlain(v[k]);
  return out;
}

/**
 * What a read of the current plan would show now, without saving anything (used by Analytics): workOutSync
 * – follow the patient's type of care and EDD (pause, hold for an EDD review, re-date), then work the items
 * out again – on a copy of a lean plan, with a lean patient. Nothing is saved and nothing is logged: the
 * copy's plan log is thrown away. A paused plan that meets a new pregnancy is left as it is (shown paused),
 * as on a read that could not save. Returns the copy; the plan passed in is not changed.
 */
export function previewSync(plan, patient, now) {
  const { log, ...rest } = plan; // the copy's log is thrown away, so the stored one is not copied
  const copy = copyPlain(rest);
  copy.log = [];
  workOutSync(copy, patient, planFacts(patient, now), now, { log: false }); // the log would be thrown away
  delete copy.log;
  return copy;
}

/**
 * Builds the plan that replaces a plan just closed for a new pregnancy. If another request built the new
 * plan at the same moment (duplicate key), that plan gets the link instead. Returns the new plan, or null then.
 */
async function createReplacement(ctx, patient, facts, old) {
  try {
    return await createPlan(ctx, patient, { facts, replacesPlanId: old._id });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // Only a plan built after the close can be the replacement (never a plan reopened in the meantime).
    await CarePlan.updateOne(
      { tenantId: ctx.tenantId, patientId: patient._id, careType: ANTENATAL, current: true, replacesPlanId: null, createdAt: { $gte: old.closed.at } },
      { $set: { replacesPlanId: old._id } },
    );
    return null;
  }
}

const snapshot = (plan) => JSON.stringify(plan.toObject());

/**
 * Brings the patient's current antenatal plan in step with the patient's details (and builds it if the
 * patient needs one). Reads the patient first, then the plan, in every attempt; if the plan was already
 * synced with a newer version of the patient, the patient is read again (so neither this sync nor a change
 * that follows it works the plan out from older facts). Writes only when something changed. Not audited,
 * except that building a patient's first plan is (CARE_PLAN_CREATED, with the requesting person as actor).
 * ctx: { req?, tenantId, now }. Returns { plan (current plan or null), patient }.
 * Throws SyncConflict (409) if other saves kept getting in first.
 */
async function syncAntenatalPlan(ctx, patientId) {
  const { tenantId, now } = ctx;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const patient = await Patient.findOne({ _id: patientId, tenantId }); // fresh; read BEFORE the plan
    if (!patient) return { plan: null, patient: null };
    const plan = await currentPlanOf(tenantId, patient._id);
    // A newer sync ran between our patient read and our plan read: read the patient again.
    if (plan && plan.basis.patientVersion > (patient.__v ?? 0)) continue;
    const facts = planFacts(patient, now);

    if (!plan) {
      if (patient.careType !== ANTENATAL || !facts.edd || (await closedPlanForPregnancy(tenantId, patient._id, facts.edd))) return { plan: null, patient };
      try {
        return { plan: await createPlan(ctx, patient, { facts }), patient };
      } catch (e) {
        if (e?.code === 11000) continue; // built by another request at the same moment
        throw e;
      }
    }

    const before = snapshot(plan);
    if (workOutSync(plan, patient, facts, now).newPregnancy) {
      // A paused plan, and the patient is now antenatal with an EDD far from this plan's: a new pregnancy.
      // The old plan is closed automatically and a new one is built (neither is audited on its own).
      closeWith(plan, { reason: 'new_pregnancy', note: '', auto: true, by: null, byName: AUTOMATIC, at: now });
      autoLog(plan, now, 'replaced', 'Closed automatically: a new pregnancy was recorded, and a new care plan was started.');
      derivePlan(plan, facts, { at: now });
      try {
        await plan.save();
      } catch (e) {
        if (e?.name === 'VersionError') continue;
        throw e;
      }
      const built = await createReplacement(ctx, patient, facts, plan);
      if (built) return { plan: built, patient };
      continue; // built by another request at the same moment: the next attempt syncs it
    }
    if (snapshot(plan) === before) return { plan, patient }; // same facts, same version: no write
    try {
      await plan.save();
      return { plan, patient };
    } catch (e) {
      if (e?.name === 'VersionError') continue;
      throw e;
    }
  }
  throw new SyncConflict();
}

// ---------- Plans that are not antenatal (Version 2) ----------

const OTHER_PAUSE_TEXT = {
  care_type_changed: 'Paused: the type of care changed. Items can still be marked done; no reminders.',
  no_edd: 'Paused: the day the plan counts from (delivery, birth or the date a pregnancy loss was seen) is no longer recorded.',
};

/**
 * Keeps the patient's plan for her current type of care (not antenatal) in step: builds it when week 0 is known,
 * re-dates it when week 0 changes (e.g. a corrected time of birth), pauses it when week 0 is removed, resumes it.
 * Current plans of other non-antenatal types of care are paused (the antenatal one is handled by its own sync).
 * Returns { plan, patient } like syncPlan – and closed: true when there is no plan because the one for this delivery
 * or birth was closed by a doctor or RMO.
 */
async function syncOtherPlan(ctx, patientId, { start = false } = {}) {
  const { tenantId, now } = ctx;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const patient = await Patient.findOne({ _id: patientId, tenantId });
    if (!patient) return { plan: null, patient: null };
    const careType = patient.careType;
    // Other types' current plans: paused while the patient has another type of care.
    const others = await CarePlan.find({ tenantId, patientId: patient._id, current: true, careType: { $nin: [ANTENATAL, careType] }, status: 'active' });
    for (const o of others) {
      o.status = 'paused';
      o.pausedReason = 'care_type_changed';
      autoLog(o, now, 'paused', OTHER_PAUSE_TEXT.care_type_changed);
      await o.save().catch((e) => {
        if (e?.name !== 'VersionError') throw e;
      });
    }
    const plan = await currentPlanOf(tenantId, patient._id, careType);
    if (plan && plan.basis.patientVersion > (patient.__v ?? 0)) continue;
    if (!plan) {
      // Postnatal and newborn plans start by themselves (from the delivery, the birth); gynaecology and infertility
      // plans when a doctor or RMO starts one (start: true).
      if (!AUTO_START.includes(careType) && !start) return { plan: null, patient };
      const facts = planFacts(patient, now, { careType });
      if (!facts.startOn) return { plan: null, patient };
      // Closed by a doctor or RMO for this delivery or birth: stays closed until it is reopened (closed: true tells
      // syncPlan that "no plan" is the answer – not the paused antenatal plan from before the delivery)
      if (!start && (await closedPlanForStart(tenantId, patient._id, careType, facts.startOn))) return { plan: null, patient, closed: true };
      try {
        return { plan: await createPlan(ctx, patient, { facts }), patient };
      } catch (e) {
        if (e?.code === 11000) continue;
        throw e;
      }
    }
    const facts = planFacts(patient, now, plan);
    // Pregnancy-loss care: a loss seen more than 8 weeks from the one this plan counts from is ANOTHER loss on the
    // same record (a small correction of the date seen only moves the dates, below; the form warns before such a
    // date is saved). Its plan is closed by itself – kept under Earlier plans, with everything recorded on it – and a
    // new plan is built for the new loss, so nothing ticked for the earlier loss counts as done for this one. Neither
    // is audited on its own. Its items are NOT worked out again from the new loss's facts (an hCG test after a molar
    // pregnancy must not read "only after a molar pregnancy – does not apply" on that pregnancy's own plan): what
    // was still open only stops counting. If the date was only mistyped, Reopen brings the plan back (reopenCarePlan).
    if (careType === 'abortion' && facts.startOn && plan.basis.startOn && !within56(plan.basis.startOn, facts.startOn)) {
      closeWith(plan, { reason: 'new_pregnancy', note: '', auto: true, by: null, byName: AUTOMATIC, at: now });
      autoLog(
        plan,
        now,
        'replaced',
        `Closed automatically: another pregnancy loss was recorded (seen on ${dateText(facts.startOn)}), and a new care plan was started for it. If the date seen was only corrected, close the new plan and reopen this one.`,
      );
      for (const it of plan.items) if (it.state === 'open' && it.auto) it.auto.phase = 'inactive';
      try {
        await plan.save();
      } catch (e) {
        if (e?.name === 'VersionError') continue;
        throw e;
      }
      try {
        return { plan: await createPlan(ctx, patient, { facts: planFacts(patient, now, { careType }), replacesPlanId: plan._id }), patient };
      } catch (e) {
        if (e?.code === 11000) continue; // built by another request at the same moment: the next attempt reads it
        throw e;
      }
    }
    const before = snapshot(plan);
    if (!facts.edd) {
      if (plan.status === 'active') {
        plan.status = 'paused';
        plan.pausedReason = 'no_edd';
        autoLog(plan, now, 'paused', OTHER_PAUSE_TEXT.no_edd);
      }
    } else {
      if (plan.status === 'paused') {
        plan.status = 'active';
        plan.pausedReason = null;
        autoLog(plan, now, 'resumed', 'Resumed.');
      }
      if (!sameDay(plan.basis.edd, facts.edd)) {
        const from = plan.basis.startOn;
        plan.basis.edd = facts.edd;
        plan.basis.startOn = facts.startOn;
        autoLog(plan, now, 'edd_redated', `Due dates moved: the plan now counts from ${dateText(facts.startOn)}${from ? ` (was ${dateText(from)})` : ''}.`);
      }
    }
    plan.basis.key = facts.basisKey;
    plan.basis.patientVersion = patient.__v ?? 0;
    plan.basis.engineVersion = PLAN_ENGINE_VERSION;
    const res = derivePlan(plan, facts, { at: now, actorName: AUTOMATIC });
    logAutomaticChanges(plan, res, null, now);
    trimAutoLog(plan);
    if (snapshot(plan) === before) return { plan, patient };
    try {
      await plan.save();
      return { plan, patient };
    } catch (e) {
      if (e?.name === 'VersionError') continue;
      throw e;
    }
  }
  throw new SyncConflict();
}

/**
 * She is in pregnancy care again while a pregnancy-loss plan is still open (a new pregnancy after a loss – the
 * beta hCG follow-up of a molar pregnancy may not be over): that plan is paused, so it is listed under Earlier
 * plans, instead of staying "active" where nobody sees it. It resumes if her care becomes pregnancy-loss care again
 * for the same loss.
 */
async function pauseLossPlan(ctx, patient) {
  const open = await CarePlan.find({ tenantId: ctx.tenantId, patientId: patient._id, careType: 'abortion', current: true, status: 'active' });
  for (const o of open) {
    o.status = 'paused';
    o.pausedReason = 'care_type_changed';
    autoLog(o, ctx.now, 'paused', OTHER_PAUSE_TEXT.care_type_changed);
    await o.save().catch((e) => {
      if (e?.name !== 'VersionError') throw e; // changed at the same moment: the next read pauses it
    });
  }
}

/**
 * Brings the patient's plans in step with her details and returns the plan for her current type of care:
 * the antenatal plan follows the pregnancy (and is paused when she is no longer antenatal); a plan for another
 * type of care is built or kept in step by syncOtherPlan. Returns { plan, patient }.
 */
export async function syncPlan(ctx, patientId) {
  const ante = await syncAntenatalPlan(ctx, patientId);
  if (ante.patient?.careType === ANTENATAL) await pauseLossPlan(ctx, ante.patient);
  if (!ante.patient || ante.patient.careType === ANTENATAL) return ante;
  const other = await syncOtherPlan(ctx, patientId);
  if (other.plan) return other;
  // Her postnatal (or the baby's) plan was closed for this delivery or birth: she has NO current plan. The paused
  // antenatal plan must not take its place – it would be shown as "the" plan, a second Close would close it, and
  // the closed plan could not be reopened. It stays under Earlier plans.
  if (other.closed) return { plan: null, patient: other.patient ?? ante.patient };
  // No plan for the new type of care yet: the paused antenatal plan stays the one shown (items can still be
  // marked done, and it can be closed after the delivery).
  return { plan: ante.plan, patient: other.patient ?? ante.patient };
}

/**
 * Types of care whose plan is built by itself – from the delivery, the birth, or the date a pregnancy loss was
 * seen – the first time the record is read or saved once that day is known (so a patient registered before her
 * type of care had a plan gets one the same way). The others are started by a doctor or RMO (startCarePlan).
 */
const AUTO_START = ['postnatal', 'newborn', 'abortion'];
const CARE_WORDS = { antenatal: 'antenatal', postnatal: 'postnatal', newborn: 'newborn', gynaecology: 'gynaecology', infertility: 'infertility', abortion: 'abortion' };

/**
 * POST /care-plan/start (gynaecology, infertility): the treating doctor or an RMO starts the patient's plan from the
 * hospital standard template, counted from today. Audited like any first plan (CARE_PLAN_CREATED).
 */
export async function startCarePlan(ctx, patientId) {
  const loaded = await loadPatientById(ctx, patientId);
  assertCanEdit(ctx.req, loaded);
  if (loaded.careType === ANTENATAL || AUTO_START.includes(loaded.careType)) {
    throw new HttpError(400, 'This plan starts by itself from the pregnancy dates, the delivery, the birth or the date a pregnancy loss was seen.', 'VALIDATION');
  }
  if (await currentPlanOf(ctx.tenantId, loaded._id, loaded.careType)) throw conflict('This patient already has a care plan.', 'PLAN_EXISTS');
  await syncAntenatalPlan(ctx, loaded._id); // pauses an antenatal plan from before
  const { plan, patient } = await syncOtherPlan(ctx, loaded._id, { start: true });
  return respond(ctx, patient ?? loaded, plan, { changed: true });
}

/**
 * The same as syncPlan, but never fails: used after a patient is saved, so the patient's save and its
 * answer never fail because of the plan (the plan heals itself on its next read). Returns null on error.
 */
export async function syncPlanSafely(ctx, patientId) {
  try {
    return await syncPlan(ctx, patientId);
  } catch (err) {
    console.error('Care plan sync failed', err?.message ?? err);
    return null;
  }
}

/**
 * Brings EXISTING current antenatal plans up to date when they are behind their patient (the patient was saved
 * or its risk refreshed after the plan's last sync) or were worked out by an older engine. Used before lists
 * across patients (the calendar; later Feature 10) so they don't depend on someone opening each record.
 * Missing plans are NOT built here: a new plan starts its booking on today, which would put a booking visit on
 * every such patient and hide visits she really missed; they are built as before, when the record is opened
 * or saved. Not audited (like every automatic sync).
 * At least one stale plan is synced per run, then it stops after `budgetMs` or `maxSyncs`; the rest wait for
 * the next request. Requests during a run share it; once a run leaves nothing pending, the next
 * `minIntervalMs` are skipped. Returns { synced, pending }.
 */
const lastPlanRefresh = new Map(); // tenant -> time of the last run that left nothing pending
const lastPending = new Map(); // tenant -> plans left by the last run
const planRefreshInFlight = new Map(); // tenant -> promise of the run going on now
let staleOptionsForTests = {};

async function runStaleRefresh(tenantId, now, { maxSyncs, budgetMs }) {
  const started = performance.now();
  const plans = await CarePlan.find(
    { tenantId, careType: ANTENATAL, current: true },
    { patientId: 1, 'basis.patientVersion': 1, 'basis.engineVersion': 1 },
  ).lean();
  if (!plans.length) return { synced: 0, pending: 0 };
  const patients = await Patient.find({ tenantId, _id: { $in: plans.map((p) => p.patientId) } }, { __v: 1 }).lean();
  const version = new Map(patients.map((p) => [String(p._id), p.__v ?? 0]));
  const stale = plans.filter((p) => {
    const v = version.get(String(p.patientId));
    return v != null && ((p.basis?.patientVersion ?? -1) < v || p.basis?.engineVersion !== PLAN_ENGINE_VERSION);
  });
  let synced = 0;
  for (const p of stale) {
    if (synced > 0 && (synced >= maxSyncs || performance.now() - started >= budgetMs)) break;
    await syncPlanSafely({ req: null, tenantId, user: null, now }, p.patientId);
    synced += 1;
  }
  return { synced, pending: stale.length - synced };
}

export async function refreshStalePlans(tenantId, now = new Date(), options = {}) {
  const { minIntervalMs = 60_000, maxSyncs = 200, budgetMs = 500 } = { ...staleOptionsForTests, ...options };
  const key = String(tenantId);
  if (planRefreshInFlight.has(key)) return planRefreshInFlight.get(key);
  const since = now - (lastPlanRefresh.get(key) ?? -Infinity);
  if (minIntervalMs && since >= 0 && since < minIntervalMs) return { synced: 0, pending: lastPending.get(key) ?? 0 };
  const run = runStaleRefresh(tenantId, now, { maxSyncs, budgetMs })
    .then((r) => {
      lastPending.set(key, r.pending);
      if (r.pending === 0) lastPlanRefresh.set(key, now.getTime());
      else lastPlanRefresh.delete(key); // work left: the next request continues at once
      return r;
    })
    .finally(() => planRefreshInFlight.delete(key));
  planRefreshInFlight.set(key, run);
  return run;
}
export const resetStalePlansTimer = () => {
  lastPlanRefresh.clear();
  lastPending.clear();
};
/** Tests only: options used by every refreshStalePlans call (e.g. { budgetMs: 0 }); {} restores the defaults. */
export const setStalePlanOptionsForTests = (opts = {}) => {
  staleOptionsForTests = { ...opts };
};

// For reading: if the sync can't save, answer with the latest plan worked out in memory (the same way the
// sync would: re-dated, paused or on hold). Not saved; a plan that meets a new pregnancy is shown paused.
async function readCurrentPlan(ctx, patientId) {
  try {
    return await syncPlan(ctx, patientId);
  } catch (e) {
    if (!(e instanceof SyncConflict)) throw e;
    const patient = await Patient.findOne({ _id: patientId, tenantId: ctx.tenantId });
    const plan = patient ? await currentPlanOf(ctx.tenantId, patientId, patient.careType) : null;
    if (plan && patient && plan.careType === ANTENATAL) workOutSync(plan, patient, planFacts(patient, ctx.now), ctx.now);
    return { plan, patient };
  }
}

// ---------- Answers ----------

async function summarize(ctx, patient, plan) {
  const { srcT, stdT } = await templatesOf(ctx.tenantId, plan);
  const shownType = plan?.careType ?? patient.careType;
  const earlierCount = await CarePlan.countDocuments({ tenantId: ctx.tenantId, patientId: patient._id, careType: shownType, current: false });
  // With no current plan, the Overview card says when the last plan was closed and why.
  const last =
    !plan && earlierCount > 0
      ? await CarePlan.findOne({ tenantId: ctx.tenantId, patientId: patient._id, careType: shownType, current: false }).sort({ 'closed.at': -1 }).select('closed').lean()
      : null;
  const lastClosed = last?.closed ? { at: last.closed.at, reason: last.closed.reason } : null;
  return {
    views: { srcT, stdT },
    summary: carePlanSummary(plan, { today: hospitalToday(ctx.now), now: ctx.now, patient, srcT, stdT, earlierCount, lastClosed, reason: plan ? null : noPlanReason(patient) }),
  };
}

/** The answer to every plan change: { plan: PlanView | null, summary, ...extra }. */
async function respond(ctx, patient, plan, extra = {}) {
  const { views, summary } = await summarize(ctx, patient, plan);
  const access = carePlanAccess(ctx.req, patient);
  return {
    plan: plan ? planView(plan, { today: hospitalToday(ctx.now), now: ctx.now, patient, ...views, access, hasCurrentPlan: true }) : null,
    summary,
    ...extra,
  };
}

/**
 * GET /care-plan: the current plan (synced; built if needed), or with planId one of this patient's earlier
 * plans (read-only, not synced). Audited as CARE_PLAN_VIEWED.
 * Returns { plan: PlanView | null, reason: null | 'not_antenatal' | 'no_dates', earlierPlans }.
 */
export async function getCarePlan(ctx, patientId, { planId = null } = {}) {
  const loaded = await loadPatientById(ctx, patientId);
  const access = assertCanView(ctx.req, loaded);
  let plan;
  let patient = loaded;
  let hasCurrentPlan;
  let viewingEarlier = false;
  if (planId) {
    plan = await CarePlan.findOne({ _id: planId, tenantId: ctx.tenantId, patientId: loaded._id });
    if (!plan) throw notFound('Care plan not found.');
    viewingEarlier = !plan.current || plan.careType !== loaded.careType;
    hasCurrentPlan = (plan.current && plan.careType === loaded.careType) || Boolean(await CarePlan.exists({ tenantId: ctx.tenantId, patientId: loaded._id, careType: loaded.careType, current: true }));
  } else {
    const synced = await readCurrentPlan(ctx, loaded._id);
    plan = synced.plan;
    patient = synced.patient ?? loaded;
    hasCurrentPlan = Boolean(plan);
  }
  const earlier = await earlierPlansOf(ctx.tenantId, loaded._id, plan?._id ?? null);
  await audit(ctx.req, 'CARE_PLAN_VIEWED', {
    details: { patientId: String(loaded._id), mrn: loaded.mrn, planId: plan ? String(plan._id) : null, access: access.level },
  });
  const views = await templatesOf(ctx.tenantId, plan);
  return {
    plan: plan ? planView(plan, { today: hospitalToday(ctx.now), now: ctx.now, patient, ...views, access, viewingEarlier, hasCurrentPlan }) : null,
    reason: plan ? null : noPlanReason(patient),
    earlierPlans: earlier.map((p) => ({
      id: String(p._id),
      careType: p.careType,
      status: p.status,
      edd: p.basis.edd,
      closedAt: p.closed?.at ?? null,
      closedReason: p.closed?.reason ?? null,
      templateName: p.source.templateName,
    })),
  };
}

/**
 * A printout of the plan (Feature 9): the patient copy or the staff copy. Everyone who may see the plan may
 * print it (the current plan, or an earlier one with planId). What was chosen, and any advice typed for the
 * patient, stays in the browser: only "printed, which copy" is recorded, in the audit log (ids only) – and for a
 * patient copy with Marathi or Hindi next to the English, that language ('mr' | 'hi').
 */
export async function recordPrint(ctx, patientId, { copy, planId = null, language = 'en' }) {
  const patient = await loadPatientById(ctx, patientId);
  const access = assertCanView(ctx.req, patient);
  const which = planId ? { _id: planId } : { current: true, careType: patient.careType };
  const plan = await CarePlan.findOne({ tenantId: ctx.tenantId, patientId: patient._id, ...which }, { _id: 1 });
  if (!plan) throw notFound('Care plan not found.');
  await audit(ctx.req, 'CARE_PLAN_PRINTED', {
    details: { patientId: String(patient._id), mrn: patient.mrn, planId: String(plan._id), copy, ...(language !== 'en' ? { language } : {}), access: access.level },
  });
  return { printed: true };
}

/**
 * Every care plan of this patient as the Care plan tab shows it (PlanView), oldest first – for the copy of the
 * whole record (patients/recordCopy.js). The current plan is read as the tab reads it (in step with her details);
 * the others as they were left. The views are read-only (nobody can change a plan from a copy). Only for those who
 * may see the plan. Not audited here: the copy itself is. An error is not hidden – a copy that silently left the
 * care plan out would look complete.
 * Returns { plans, more } (more: she has more than `limit` plans, and only the newest `limit` are returned).
 */
export async function carePlansForCopy(ctx, loaded, { limit = 50 } = {}) {
  assertCanView(ctx.req, loaded);
  const { plan: current, patient: fresh } = await readCurrentPlan(ctx, loaded._id);
  const patient = fresh ?? loaded;
  const others = await CarePlan.find({ tenantId: ctx.tenantId, patientId: loaded._id, ...(current ? { _id: { $ne: current._id } } : {}) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  // The plan the tab shows is not always the newest (her paused antenatal plan stays the one shown until a plan for
  // her new type of care is started): all of them in one list, newest first – then the newest `limit`, oldest first.
  const idOrder = (a, b) => (String(a._id) < String(b._id) ? 1 : String(a._id) > String(b._id) ? -1 : 0);
  const all = [...others, ...(current ? [current] : [])].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0) || idOrder(a, b));
  const today = hospitalToday(ctx.now);
  const view = async (plan) =>
    planView(plan, { today, now: ctx.now, patient, ...(await templatesOf(ctx.tenantId, plan)), access: { edit: false }, viewingEarlier: plan !== current, hasCurrentPlan: Boolean(current) });
  const plans = [];
  for (const plan of all.slice(0, limit).reverse()) plans.push(await view(plan));
  return { plans, more: all.length > limit };
}

/**
 * carePlanSummary for GET /patients/:id. Only for people who may see the plan (undefined otherwise – the
 * caller leaves the field out). Syncs first, so a plan is built on first view. Never fails the patient
 * page: null if something went wrong.
 */
export async function carePlanSummaryFor(ctx, patient) {
  if (!carePlanAccess(ctx.req, patient).view) return undefined;
  try {
    const { plan, patient: fresh } = await readCurrentPlan(ctx, patient._id);
    return (await summarize(ctx, fresh ?? patient, plan)).summary;
  } catch (err) {
    console.error('Care plan summary failed', err?.message ?? err);
    return null;
  }
}

/**
 * The current plan's items with today's status ([{ kind, name, status, dueBy }]) – for suggesting consent forms
 * ("a scan is due"). Empty for someone who may not see the plan, without a plan, or if the plan can't be read
 * (suggestions are only a help: they never stop the Consent forms tab from working).
 */
export async function currentPlanItems(ctx, patient) {
  if (!carePlanAccess(ctx.req, patient).view) return [];
  try {
    const { plan } = await readCurrentPlan(ctx, patient._id);
    if (!plan) return [];
    const statuses = planStatuses(plan, hospitalToday(ctx.now));
    return plan.items.map((it) => ({ kind: it.kind, name: it.name, status: statuses.get(it)?.status ?? null, dueBy: it.manualDate?.dueBy ?? it.auto?.dueBy ?? null }));
  } catch (err) {
    console.error('Care plan items for consent suggestions failed', err?.message ?? err);
    return [];
  }
}

/**
 * What an item is called where the patient reads it (the patient portal): its words for the patient, or its name when
 * it has none – except in pregnancy-loss care, whose staff names may name the loss (an item a doctor added without
 * words for the patient): there a neutral PATIENT_FALLBACK_LOSS. The website does the same for her printed copy
 * (carePlanPrintFormat.js patientWhat).
 */
export const PATIENT_FALLBACK_LOSS = 'Check-up or test – your doctor will explain';
export const patientWords = (it, careType) => it.patientText?.trim() || (careType === 'abortion' ? PATIENT_FALLBACK_LOSS : it.name);

// What a reminder asks the patient to do: tests, scans and vaccinations (advice and daily tablets are not
// tasks to come in for), overdue by at most 6 weeks – older ones are for the doctor to decide first – and at
// most 8 in all.
const REMINDER_KINDS = ['investigation', 'scan', 'vaccination'];
const REMINDER_OVERDUE_DAYS = 42;
const REMINDER_MAX_ITEMS = 8;

/**
 * What a follow-up reminder to the patient needs (Smart features, step 3): the next visit and the items
 * overdue (recently) or due now, with the wording for the patient's copy. null without a current active plan.
 */
/**
 * What the patient portal shows of the care plan (Version 2): read only (nothing is saved or audited here), in
 * the patient's own words – the next visit, and the tests, scans and vaccinations due now or in the next 8 weeks.
 * Never a doctor's note, a result, a reason or a risk. null when there is no active plan.
 * builtIn: true only for a BUILT-IN item whose patient wording is still word for word its built-in English – the
 * same rule as the printed patient copy (planItemText in client/src/pages/careplans/itemTranslations.js), so the
 * portal and the paper agree on which items are shown in Marathi or Hindi. false – shown as typed, in English – for an
 * item a doctor added to this plan, an item of a hospital's own template with its own code, a built-in item whose
 * wording was changed (even to the words of another built-in item), and an item with no patient wording. Never the
 * item's key: a key such as scan_growth_gdm names a diagnosis, and the portal never sends one.
 */
export async function portalPlanItems(tenantId, patient, now = new Date()) {
  const plan = await currentPlanOf(tenantId, patient._id, patient.careType);
  if (!plan || plan.status !== 'active') return null;
  const today = hospitalToday(now);
  const statuses = planStatuses(plan, today);
  const next = nextVisitSuggestion(plan, today, statuses);
  const horizon = addDays(today, 56);
  const items = plan.items
    .filter((it) => REMINDER_KINDS.includes(it.kind) && it.state === 'open' && it.auto?.phase === 'open' && ['due', 'overdue', 'upcoming'].includes(statuses.get(it)?.status))
    .filter((it) => it.auto?.dueFrom && it.auto.dueFrom <= horizon)
    .sort((a, b) => a.auto.dueFrom - b.auto.dueFrom)
    .slice(0, 12)
    .map((it) => ({ kind: it.kind, builtIn: builtInWording(it), text: patientWords(it, plan.careType), from: it.auto.dueFrom, by: it.auto.dueBy ?? null }));
  const visit = next.visit ? plan.items.find((it) => itemId(it) === next.visit.itemId) : null;
  return {
    nextVisit: next.visit
      ? { builtIn: Boolean(visit && builtInWording(visit)), text: patientWords(visit ?? { name: next.visit.name }, plan.careType), from: next.visit.dueFrom, by: next.visit.dueBy }
      : null,
    items,
  };
}

// The built-in patient wording of every translated built-in item, by key (every key and wording is different –
// server/tests/careplan-print.test.js checks it). An item is shown in the portal in Marathi or Hindi only while it
// came from a template and its patient wording is exactly the built-in wording of its own key. The pregnancy-loss
// template (ABORTION_DRAFT) has no Marathi or Hindi yet, so it is left out: its items come back builtIn: false and
// show in English, as on her printed copy (the website's planItemText finds no translation for their keys either).
const BUILT_IN_WORDING = new Map([ANTENATAL_DRAFT, POSTNATAL_DRAFT, NEWBORN_DRAFT, GYNAECOLOGY_DRAFT, INFERTILITY_DRAFT].flatMap((t) => t.items.map((it) => [it.key, it.patientText])));
const builtInWording = (it) => it.origin === 'template' && Boolean(it.patientText) && BUILT_IN_WORDING.get(it.key) === it.patientText;

export async function reminderItems(ctx, patient) {
  const { plan } = await readCurrentPlan(ctx, patient._id);
  if (!plan || plan.status !== 'active') return null;
  const today = hospitalToday(ctx.now);
  const statuses = planStatuses(plan, today);
  const next = nextVisitSuggestion(plan, today, statuses);
  const recent = addDays(today, -REMINDER_OVERDUE_DAYS);
  const pick = (st) =>
    plan.items
      .filter((it) => REMINDER_KINDS.includes(it.kind) && it.auto?.phase === 'open' && statuses.get(it)?.status === st)
      .filter((it) => st !== 'overdue' || (it.auto?.dueBy && it.auto.dueBy >= recent))
      .sort((a, b) => (a.auto.dueBy ?? 0) - (b.auto.dueBy ?? 0))
      .map((it) => ({ kind: it.kind, name: it.name, patientText: it.patientText ?? '', dueBy: it.auto?.dueBy ?? null }));
  const overdue = pick('overdue').slice(0, REMINDER_MAX_ITEMS);
  return {
    nextVisit: next.visit ? { name: next.visit.name, dueFrom: next.visit.dueFrom, dueBy: next.visit.dueBy, status: next.visit.status } : null,
    overdue,
    due: pick('due').slice(0, REMINDER_MAX_ITEMS - overdue.length),
  };
}

// ---------- The loop for every change ----------

/**
 * Loads the patient (current risk), checks this person may change the plan, syncs, and finds the current
 * plan. planLevel: a change to the whole plan, refused while the plan is paused.
 */
async function editablePlan(ctx, patientId, { planLevel }) {
  const loaded = await loadPatientById(ctx, patientId);
  assertCanEdit(ctx.req, loaded);
  const { plan, patient } = await syncPlan(ctx, loaded._id);
  if (!plan) {
    const latest = await CarePlan.findOne({ tenantId: ctx.tenantId, patientId: loaded._id, careType: loaded.careType }).sort({ createdAt: -1 });
    if (latest) throw conflict(CLOSED_MESSAGE, 'PLAN_CLOSED');
    throw notFound('This patient has no care plan.');
  }
  if (planLevel && plan.status === 'paused') throw conflict(PAUSED_MESSAGE, 'PLAN_PAUSED');
  return { patient: patient ?? loaded, plan, facts: planFacts(patient ?? loaded, ctx.now, plan) };
}

function auditChange(ctx, patient, plan, { change, itemId: id, visitId }) {
  return audit(ctx.req, 'CARE_PLAN_CHANGED', {
    details: { patientId: String(patient._id), mrn: patient.mrn, planId: String(plan._id), change, ...(id ? { itemId: id } : {}), ...(visitId ? { visitId } : {}) },
  });
}

/**
 * Runs one change on the current plan: work({ plan, patient, facts }) changes the plan in memory and returns
 * { changed: false } (nothing to do) or { changed: true, change, itemId? } (the audit words). If someone else
 * saved the plan meanwhile, everything is read again and the change is worked out again (up to 3 times),
 * so two people changing different items both succeed. Saves and audits; returns { patient, plan, result }
 * (changePlan answers with the plan; moving many plans at once only counts).
 */
async function savePlanChange(ctx, patientId, { planLevel }, work) {
  for (let attempt = 1; ; attempt += 1) {
    const { patient, plan, facts } = await editablePlan(ctx, patientId, { planLevel });
    const result = await work({ plan, patient, facts });
    if (!result.changed) return { patient, plan, result };
    try {
      await plan.save();
    } catch (e) {
      if (e?.name === 'VersionError' && attempt < 3) continue;
      throw e;
    }
    await auditChange(ctx, patient, plan, result);
    return { patient, plan, result };
  }
}

/** savePlanChange, answered with the plan as the Care plan tab shows it: { plan, summary, changed }. */
async function changePlan(ctx, patientId, opts, work) {
  const { patient, plan, result } = await savePlanChange(ctx, patientId, opts, work);
  return respond(ctx, patient, plan, { changed: Boolean(result.changed) });
}

// ---------- Item actions (§7.2) ----------

const findItem = (plan, id) => {
  const it = plan.items.find((x) => String(x._id) === String(id));
  if (!it) throw notFound('Item not found.');
  return it;
};

// "Keep as planned" answers these: a moved or included item checked again, and an added item that may repeat another
const KEEPABLE_FLAGS = ['check_date', 'no_longer_indicated', 'possible_duplicate'];
const hasKeepableFlag = (it) => (it.auto?.flags ?? []).some((f) => KEEPABLE_FLAGS.includes(f));
const moveDueBy = (intent) => intent.dueBy ?? addDays(intent.dueFrom, 6);

// ---- Editing an item a doctor added (5 Oct 2026) ----

// A custom item's timing as sent ({ type: 'weeks', fromWeek, toWeek } or { type: 'date', dueFrom, dueBy }) is
// the one it has now.
function sameCustomTiming(t, timing) {
  const now = t ?? {};
  if (timing.type === 'weeks') return now.date == null && now.fromWeek === timing.fromWeek && (now.toWeek ?? now.fromWeek) === timing.toWeek;
  if (now.fromWeek != null || now.date == null) return false;
  return sameDay(now.date, timing.dueFrom) && sameDay(now.dateBy ?? addDays(now.date, 6), timing.dueBy ?? addDays(timing.dueFrom, 6));
}

// What an edit changes on an item: some of 'name', 'patientText', 'timing', 'note' (in this order).
function editedFields(it, intent) {
  return [
    it.name !== intent.name && 'name',
    (it.patientText ?? '') !== (intent.patientText ?? '') && 'patientText',
    !sameCustomTiming(it.timing, intent.timing) && 'timing',
    (it.note?.text ?? '') !== (intent.note ?? '') && 'note',
  ].filter(Boolean);
}

// The part of an item's timing an edit can change, as kept in its history.
const timingRecord = (t) => (t?.date ? { date: t.date, dateBy: t.dateBy ?? null } : { fromWeek: t?.fromWeek ?? null, toWeek: t?.toWeek ?? null });
const EDIT_WORDS = { name: 'name', patientText: 'wording for the patient', timing: 'due window', note: 'note' };
const NOT_CUSTOM_MESSAGE = 'Only items added for this patient can be edited. For an item of the protocol, move its date, add a note or mark it not needed.';

// The same action sent twice (e.g. a double click, or a retry): nothing to do, and no rev check.
function isIdenticalRepeat(it, intent) {
  switch (intent.action) {
    case 'done':
      return (
        it.state === 'done' &&
        sameDay(it.done?.on, intent.on) &&
        Boolean(it.done?.elsewhere) === Boolean(intent.elsewhere) &&
        (it.done?.result ?? '') === (intent.result ?? '') &&
        (it.done?.note ?? '') === (intent.note ?? '')
      );
    case 'reopen':
      return it.state === 'open';
    case 'not_needed':
      return it.state === 'not_needed' && it.notNeeded?.reasonCode === intent.reasonCode && (it.notNeeded?.reason ?? '') === (intent.reason ?? '');
    case 'move':
      return Boolean(it.manualDate) && sameDay(it.manualDate.dueFrom, intent.dueFrom) && sameDay(it.manualDate.dueBy, moveDueBy(intent)) && (it.manualDate.reason ?? '') === (intent.reason ?? '');
    case 'reset_date':
      return !it.manualDate;
    case 'include':
      return Boolean(it.forceInclude) && it.forceInclude.reason === intent.reason;
    case 'remove_include':
      return !it.forceInclude;
    case 'keep':
      return !hasKeepableFlag(it);
    case 'note':
      return (it.note?.text ?? '') === (intent.text ?? '');
    case 'edit':
      return it.origin === 'custom' && editedFields(it, intent).length === 0;
    default:
      return false;
  }
}

// The person saw an older version of the item: stop and show the latest plan.
function checkRev(it, rev) {
  if (rev === (it.rev ?? 0)) return;
  const at = it.revAt ? timeIn(it.revAt) : null;
  if (!it.revByName || !at) throw conflict('This item was changed. The latest plan is shown – check it and try again.');
  if (it.revByName === AUTOMATIC) {
    throw conflict(`This item was updated automatically at ${at} (the patient's details changed). The latest plan is shown – check it and try again.`);
  }
  throw conflict(`${it.revByName} changed this item at ${at}. The latest plan is shown – check it and try again.`);
}

function notOpen(it) {
  if (it.state === 'done') return conflict('This item is already marked done.');
  if (it.state === 'not_needed') return conflict('This item is marked not needed. Reopen it first.');
  return null;
}

// Whether the action fits the item's state (409 with a plain message otherwise).
function checkState(it, intent) {
  switch (intent.action) {
    case 'done':
      if (it.state === 'done') throw conflict('This item is already marked done.');
      return;
    case 'reopen':
      return; // an open item is an identical repeat
    case 'not_needed':
      if (it.state === 'not_needed') throw conflict('This item is already marked not needed. Reopen it to change the reason.');
      if (it.state !== 'open') throw notOpen(it);
      return;
    case 'move':
      if (it.state !== 'open') throw notOpen(it);
      return;
    case 'include':
      if (it.state !== 'open') throw notOpen(it);
      if (it.forceInclude) throw conflict('This item is already included. Remove the inclusion to change the reason.');
      if (it.auto?.applies === 'yes') throw conflict('This item already applies to this patient.');
      return;
    case 'edit':
      if (it.origin !== 'custom') throw new HttpError(400, NOT_CUSTOM_MESSAGE, 'VALIDATION');
      if (it.state === 'done') throw conflict('This item is marked done, so it cannot be edited. If it was marked done by mistake, reopen it first.');
      if (it.state !== 'open') throw notOpen(it);
      return;
    default:
      // reset_date, remove_include, keep: an item without anything to undo or keep is an identical repeat;
      // note: allowed in any state.
      return;
  }
}

// The guideline window in weeks and days ("18 w 0 d – 20 w 6 d"), or as dates before day 0.
function windowWords(E, from, to) {
  const a = gaOn(E, from);
  const b = gaOn(E, to);
  return a && b ? `${gaText(a)} – ${gaText(b)}` : windowText(from, to);
}

/**
 * The rules for a due window a person sets (Move, and custom items with dates). Returns field errors keyed
 * by the given field names (the first problem per field).
 */
// The last day a plan's dates may reach: 43 weeks of pregnancy, or the end of week 900 for the other plans
// (newborn vaccinations run to 16 years).
const OTHER_MAX_WEEK = 900;
const isPregnancyPlan = (plan) => (plan.careType ?? ANTENATAL) === ANTENATAL;
const lastPlanDay = (plan) => (isPregnancyPlan(plan) ? addDays(utcDay(plan.basis.edd), POST_DATES_DAYS) : weekEnd(utcDay(plan.basis.edd), OTHER_MAX_WEEK));
const lastDayWords = (plan) => (isPregnancyPlan(plan) ? '43 weeks' : `week ${OTHER_MAX_WEEK}`);

function dueDateProblems(plan, today, dueFrom, dueBy, names = { from: 'dueFrom', to: 'dueBy' }) {
  const E = utcDay(plan.basis.edd);
  const fields = {};
  const add = (k, message) => {
    fields[k] ??= message;
  };
  if (dueFrom < dayZero(E)) add(names.from, `Choose a date from the start of this ${isPregnancyPlan(plan) ? 'pregnancy' : 'plan'} (${dateText(dayZero(E))}) onwards.`);
  if (dueBy < dueFrom) add(names.to, "'Due by' must be on or after 'Due from'.");
  if (dueBy < today) add(names.to, 'Choose a date from today onwards.');
  if (dueBy > lastPlanDay(plan)) add(names.to, `Choose a date before ${lastDayWords(plan)}.`);
  if (daysBetween(dueFrom, dueBy) + 1 > MOVE_MAX_SPAN_DAYS) add(names.to, `The due window can be at most ${MOVE_MAX_SPAN_DAYS / 7} weeks long.`);
  return fields;
}

// Checks that need the plan (dates against the EDD and today, the item's kind): 400 with fields.
// Items whose answer is kept on the patient's record, not on the plan: marking one done here is refused (the record
// and the plan would then say different things); the item stops applying by itself once the record has the answer.
// The anti-D of pregnancy-loss care: the record's Anti-D answer, which the safety strip's "Rh negative – anti-D" reads.
export const RECORDED_ON_RECORD = {
  loss_antid: 'Anti-D is recorded on her record, not on the care plan: Edit details → Pregnancy loss → Anti-D. Once it is recorded as given or not needed, this item stops applying by itself.',
};

function checkWithPlan(plan, it, intent, today) {
  if (intent.action === 'done' && RECORDED_ON_RECORD[it.key]) throw new HttpError(400, RECORDED_ON_RECORD[it.key], 'RECORDED_ON_RECORD');
  const E = utcDay(plan.basis.edd);
  const fields = {};
  if (intent.action === 'done') {
    if (intent.on > today) fields.on = "The date can't be in the future.";
    else if (intent.on < addDays(dayZero(E), -DONE_EARLIEST_DAYS)) fields.on = 'This date is more than a year before this pregnancy – please check it.';
    if (intent.result && !['investigation', 'scan'].includes(it.kind)) fields.result = 'Results are recorded for lab tests and scans only.';
  }
  // A new due window for an item a doctor added: the same rules as when it was added (an unchanged window is not
  // checked again, so a name can still be corrected once the window is in the past)
  if (intent.action === 'edit' && !sameCustomTiming(it.timing, intent.timing)) customTiming(plan, today, intent.timing);
  if (intent.action === 'move') {
    const dueBy = moveDueBy(intent);
    Object.assign(fields, dueDateProblems(plan, today, intent.dueFrom, dueBy));
    const [wf, wt] = [it.auto?.windowFrom, it.auto?.windowTo];
    const outside = wf && wt && (intent.dueFrom < utcDay(wf) || dueBy > utcDay(wt));
    if (outside && (intent.reason ?? '').trim().length < 5) {
      fields.reason = `This date is outside the guideline window (${windowWords(E, wf, wt)}). Please give a reason.`;
    }
  }
  if (Object.keys(fields).length) throw invalid(fields);
}

// Raises the item's rev (so an action based on the older view is refused) and records the action.
function record(ctx, it, action, { from = null, to = null, reason = '' } = {}) {
  it.rev = (it.rev ?? 0) + 1;
  it.revByName = ctx.user.name;
  it.revAt = ctx.now;
  it.history.push({ at: ctx.now, by: ctx.user._id, byName: ctx.user.name, action, from, to, reason: reason ?? '' });
  if (it.history.length > 1000) console.warn(`Care plan item ${itemId(it)} has more than 1,000 history entries`);
}

const CHANGE_WORDS = {
  done: 'item_done',
  reopen: 'item_reopened',
  not_needed: 'item_not_needed',
  move: 'item_moved',
  reset_date: 'item_date_reset',
  include: 'item_included',
  remove_include: 'item_include_removed',
  keep: 'item_kept',
  note: 'item_note',
  edit: 'item_edited',
};

// Makes the change (in memory). Only these actions by people ever write the staff fields.
function applyIntent(ctx, plan, it, intent) {
  const by = person(ctx);
  switch (intent.action) {
    case 'done': {
      const from = it.state === 'not_needed' ? { state: it.state, notNeeded: plainRecord(it.notNeeded) } : { state: it.state };
      it.state = 'done';
      it.done = {
        on: intent.on,
        elsewhere: Boolean(intent.elsewhere),
        result: intent.result ?? '',
        note: intent.note ?? '',
        via: intent.via ?? 'manual', // 'visit' from Feature 8, 'lab' from a reviewed lab result (Version 2)
        visitId: intent.visitId ?? null,
        labOrderId: intent.labOrderId ?? null,
        ...by,
      };
      it.notNeeded = null;
      record(ctx, it, 'done', { from, to: { on: intent.on } });
      return;
    }
    case 'reopen': {
      const from = { state: it.state, done: plainRecord(it.done), notNeeded: plainRecord(it.notNeeded) };
      it.state = 'open';
      it.done = null;
      it.notNeeded = null;
      record(ctx, it, 'reopen', { from, reason: intent.reason });
      return;
    }
    case 'not_needed':
      it.state = 'not_needed';
      it.notNeeded = { reasonCode: intent.reasonCode, reason: intent.reason ?? '', ...by };
      record(ctx, it, 'not_needed', { to: { reasonCode: intent.reasonCode }, reason: intent.reason });
      return;
    case 'move': {
      const dueBy = moveDueBy(intent);
      const from = it.manualDate ? { dueFrom: it.manualDate.dueFrom, dueBy: it.manualDate.dueBy } : { dueFrom: it.auto?.dueFrom ?? null, dueBy: it.auto?.dueBy ?? null };
      it.manualDate = { dueFrom: intent.dueFrom, dueBy, reason: intent.reason ?? '', ...by };
      it.staffBasis = staffBasis(plan, it, ctx.now);
      record(ctx, it, 'move', { from, to: { dueFrom: intent.dueFrom, dueBy }, reason: intent.reason });
      return;
    }
    case 'reset_date': {
      const from = plainRecord(it.manualDate);
      it.manualDate = null;
      record(ctx, it, 'reset_date', { from });
      return;
    }
    case 'include':
      it.forceInclude = { reason: intent.reason, ...by };
      it.staffBasis = staffBasis(plan, it, ctx.now);
      record(ctx, it, 'include', { reason: intent.reason });
      return;
    case 'remove_include': {
      const from = { reason: it.forceInclude.reason };
      it.forceInclude = null;
      record(ctx, it, 'remove_include', { from });
      return;
    }
    case 'keep': {
      it.staffBasis = staffBasis(plan, it, ctx.now);
      // Kept beside the item it may repeat: the mark is answered (kept in the item's history)
      const from = it.possibleDuplicate ? { possibleDuplicate: { withItemId: it.possibleDuplicate.withItemId, withName: it.possibleDuplicate.withName } } : null;
      it.possibleDuplicate = null;
      record(ctx, it, 'keep', { from, reason: 'Kept as planned' });
      return;
    }
    case 'note': {
      const from = { text: it.note?.text ?? '' };
      it.note = intent.text ? { text: intent.text, ...by } : null;
      record(ctx, it, 'note', { from, to: { text: intent.text ?? '' } });
      return;
    }
    case 'edit': {
      // Only what changed is written, with what it was (the item's history), and one line in the plan log. A new
      // due window replaces a date moved earlier (kept in the history).
      const fields = editedFields(it, intent);
      const from = {};
      const to = {};
      if (fields.includes('name')) [from.name, to.name, it.name] = [it.name, intent.name, intent.name];
      if (fields.includes('patientText')) [from.patientText, to.patientText, it.patientText] = [it.patientText ?? '', intent.patientText ?? '', intent.patientText ?? ''];
      if (fields.includes('timing')) {
        from.timing = timingRecord(it.timing);
        it.timing = customTiming(plan, hospitalToday(ctx.now), intent.timing);
        to.timing = timingRecord(it.timing);
        if (it.manualDate) {
          from.manualDate = { dueFrom: it.manualDate.dueFrom, dueBy: it.manualDate.dueBy };
          it.manualDate = null;
          if (!it.forceInclude) it.staffBasis = null;
        }
      }
      if (fields.includes('note')) {
        [from.note, to.note] = [it.note?.text ?? '', intent.note ?? ''];
        it.note = intent.note ? { text: intent.note, ...by } : null;
      }
      record(ctx, it, 'edit', { from, to });
      personLog(ctx, plan, 'item_edited', `Item “${it.name}”${from.name ? ` (was “${from.name}”)` : ''} changed: ${fields.map((f) => EDIT_WORDS[f]).join(', ')}.`);
      return;
    }
    default:
      throw new HttpError(400, 'Unknown action.', 'VALIDATION');
  }
}

/**
 * One action by a person on one item (PATCH /items/:itemId; Feature 8 calls it for each item ticked at a
 * visit with { action: 'done', on, via: 'visit', visitId, rev }). intent: already validated (itemActionSchema).
 * Order: access → current plan (closed 409, none 404) → item (404) → identical repeat (200 changed:false,
 * no rev check, no audit) → rev (409) → state (409) → dates (400) → apply → save (retried on a clash) →
 * audit CARE_PLAN_CHANGED. Items can still be changed on a paused plan (except "edit"); a closed plan is read-only.
 * Returns { plan, summary, changed }.
 */
export function applyItemAction(ctx, patientId, id, intent) {
  // Editing an item a doctor added changes the plan's content, like adding one: active plans only (a paused plan
  // answers 409 PLAN_PAUSED). Every other item action works on a paused plan too.
  return changePlan(ctx, patientId, { planLevel: intent.action === 'edit' }, ({ plan, facts }) => {
    const it = findItem(plan, id);
    if (isIdenticalRepeat(it, intent)) return { changed: false };
    checkRev(it, intent.rev);
    checkState(it, intent);
    checkWithPlan(plan, it, intent, hospitalToday(ctx.now));
    applyIntent(ctx, plan, it, intent);
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name, changedIds: new Set([itemId(it)]) });
    return { changed: true, change: CHANGE_WORDS[intent.action], itemId: itemId(it) };
  });
}

// ---------- Visits (Feature 8) ----------

const byDueFrom = (a, b) => utcDay(a.auto?.dueFrom ?? 0) - utcDay(b.auto?.dueFrom ?? 0) || a.name.localeCompare(b.name);
const DUE_SOON_DAYS = 7;

/**
 * The care plan as a visit needs it (null when the patient has no current antenatal plan, or the person may
 * not see it): the open items due now or within a week (to tick off at this visit), the items done at this
 * visit, the next planned visits (for the next-visit date), the open tests, scans and other items coming up
 * (for "due by your next visit" on the prescription), and the Draft label while the plan is not approved.
 */
export async function visitPlanInfo(ctx, patient, visitId) {
  const access = carePlanAccess(ctx.req, patient);
  if (!access.view) return null;
  let plan;
  try {
    ({ plan } = await readCurrentPlan(ctx, patient._id));
  } catch (err) {
    console.error('Care plan for a visit failed', err?.message ?? err);
    return null;
  }
  if (!plan) return null;
  const today = hospitalToday(ctx.now);
  const statuses = planStatuses(plan, today);
  const st = (it) => statuses.get(it)?.status ?? null;
  const approval = planApproval(plan, { ...(await templatesOf(ctx.tenantId, plan)), patient });
  const view = (it) => ({
    id: itemId(it),
    rev: it.rev ?? 0,
    kind: it.kind,
    name: it.name,
    patientText: it.patientText ?? '',
    status: st(it),
    dueFrom: it.auto?.dueFrom ?? null,
    dueBy: it.auto?.dueBy ?? null,
  });
  const soon = addDays(today, DUE_SOON_DAYS);
  const open = plan.items.filter((it) => it.state === 'open' && it.auto?.phase === 'open' && it.auto?.dueFrom);
  const coming = (it) => ['overdue', 'due', 'upcoming'].includes(st(it));
  return {
    planId: String(plan._id),
    status: plan.status,
    canTick: access.edit && plan.status !== 'closed',
    label: approval.approved ? null : approval.label,
    // (not an item answered on her record – the anti-D of pregnancy-loss care: the safety strip asks for it there)
    dueNow: open
      .filter((it) => !RECORDED_ON_RECORD[it.key] && (['overdue', 'due'].includes(st(it)) || (st(it) === 'upcoming' && utcDay(it.auto.dueFrom) <= soon)))
      .sort(byDueFrom)
      .map(view),
    doneHere: plan.items
      .filter((it) => it.state === 'done' && it.done?.visitId && String(it.done.visitId) === String(visitId))
      .map((it) => ({ id: itemId(it), kind: it.kind, name: it.name, on: it.done.on })),
    nextVisits: open.filter((it) => it.kind === 'visit' && coming(it)).sort(byDueFrom).slice(0, 3).map(view),
    // For the printed prescription (what to do by the next visit). Overdue items are left to the doctor: Visit
    // details lists them, and the doctor writes any still needed under Tests advised.
    upcoming: open.filter((it) => !['visit', 'advice'].includes(it.kind) && ['due', 'upcoming'].includes(st(it))).sort(byDueFrom).slice(0, 12).map(view),
    overdue: open.filter((it) => !['visit', 'advice'].includes(it.kind) && st(it) === 'overdue').length,
  };
}

/**
 * Items ticked at a visit are marked done on the visit's date, with via 'visit' and the visit's id – all in
 * one save of the plan (the same checks as Mark done, one by one: version, state, date). Only the treating
 * doctor or an RMO. Audited once as CARE_PLAN_CHANGED 'items_done_at_visit' (ids only).
 * items: [{ id, rev }]. Returns { plan, summary, changed }.
 */
export function markDoneAtVisit(ctx, patientId, { visitId, on, items }) {
  return changePlan(ctx, patientId, { planLevel: false }, ({ plan, facts }) => {
    const changedIds = new Set();
    const today = hospitalToday(ctx.now);
    for (const { id, rev } of items) {
      const it = findItem(plan, id);
      const intent = { action: 'done', on, via: 'visit', visitId, rev, elsewhere: false, result: '', note: '' };
      if (isIdenticalRepeat(it, intent)) continue;
      checkRev(it, rev);
      checkState(it, intent);
      checkWithPlan(plan, it, intent, today);
      applyIntent(ctx, plan, it, intent);
      changedIds.add(itemId(it));
    }
    if (!changedIds.size) return { changed: false };
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name, changedIds });
    return { changed: true, change: 'items_done_at_visit', visitId: String(visitId) };
  });
}

/**
 * A doctor reviewed a lab order's results (Version 2, lab module): the care-plan items those tests stand for are
 * marked done on the day the sample was taken, with the result in short words, via 'lab'. Only items that are
 * open and due now or overdue (a 36-week Hb is not ticked by a booking test); an item that can't take this date
 * is left for the doctor. Audited once as CARE_PLAN_CHANGED 'items_done_from_lab' (ids only).
 * tests: [{ planKeys, result, series }]. series (a test repeated on a schedule, such as beta hCG after a pregnancy
 * loss): one result stands for ONE test of the row – seriesItem() picks it by the day the sample was taken – and an
 * order reviewed again (after its results were corrected or a file was added) never ticks a second one.
 * Returns { plan, summary, changed } – or null when there is no plan to change.
 */
export async function markDoneFromLab(ctx, patientId, { labOrderId, on, tests }) {
  const keys = new Set(tests.flatMap((t) => t.planKeys));
  if (!keys.size) return null;
  const loaded = await loadPatientById(ctx, patientId);
  if (!carePlanAccess(ctx.req, loaded).edit) return null;
  const { plan: current } = await readCurrentPlan(ctx, loaded._id);
  if (!current || current.status !== 'active' || !current.items.some((it) => keys.has(it.key))) return null;
  return changePlan(ctx, patientId, { planLevel: false }, ({ plan, facts }) => {
    const today = hospitalToday(ctx.now);
    const statuses = planStatuses(plan, today);
    const changedIds = new Set();
    for (const t of tests) {
      const open = plan.items.filter((x) => t.planKeys.includes(x.key) && x.state === 'open' && ['due', 'overdue'].includes(statuses.get(x)?.status));
      let chosen = open;
      if (t.series) {
        const row = plan.items.filter((x) => t.planKeys.includes(x.key));
        // This order already stands for a test of the row (reviewed before): nothing more
        if (row.some((x) => x.state === 'done' && x.done?.labOrderId && sameId(x.done.labOrderId, labOrderId))) continue;
        const it = seriesItem(row, on, (x) => statuses.get(x)?.status);
        chosen = it ? [it] : [];
      }
      for (const it of chosen) {
        const intent = { action: 'done', on, via: 'lab', labOrderId, rev: it.rev ?? 0, elsewhere: false, result: t.result.slice(0, 500), note: '' };
        try {
          checkState(it, intent);
          checkWithPlan(plan, it, intent, today);
        } catch {
          continue; // left for the doctor to mark by hand
        }
        applyIntent(ctx, plan, it, intent);
        changedIds.add(itemId(it));
      }
    }
    if (!changedIds.size) return { changed: false };
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name, changedIds });
    return { changed: true, change: 'items_done_from_lab' };
  });
}

/**
 * Which test of a series one sample stands for – PURE. row: the plan's items of the series (a test's planKeys);
 * on: the day the sample was taken; statusOf(item): its status today. Only an open test that is due or overdue today
 * is ticked:
 *  - the test whose due window holds the sample's day – if that test was already done (a second sample in the same
 *    window), none;
 *  - otherwise the test whose window ended last before that day, if it is still open (she came late for it) – not
 *    when that test was already done or marked not needed: the sample is then an extra one between two tests.
 * So an earlier sample never ticks a later test, a missed test behind a done one is never filled in with a later
 * sample, and tests she missed stay for the doctor (done elsewhere, or not needed). The row's tests that do not apply
 * (another type of loss) take no part. null: none.
 */
const SERIES_TAKES = ['due', 'overdue'];
export function seriesItem(row, on, statusOf) {
  const day = utcDay(on).getTime();
  const from = (it) => utcDay(it.auto.dueFrom).getTime();
  const by = (it) => utcDay(it.auto.dueBy ?? it.auto.dueFrom).getTime();
  const takes = (it) => it.state === 'open' && SERIES_TAKES.includes(statusOf(it));
  // The tests of the row in play: those already answered (done, not needed …) and the open ones that apply now
  const inPlay = row.filter((it) => it.auto?.dueFrom && (it.state !== 'open' || [...SERIES_TAKES, 'upcoming'].includes(statusOf(it))));
  const started = inPlay.filter((it) => from(it) <= day);
  const inWindow = started.filter((it) => by(it) >= day).sort((a, b) => from(a) - from(b));
  if (inWindow.length) return inWindow.find(takes) ?? null;
  const last = started.sort((a, b) => by(b) - by(a))[0];
  return last && takes(last) ? last : null;
}

// ---------- Plan-level actions (§7.3; active plan only) ----------

// The timing of an item a doctor adds: a week window (must end between today and 43 weeks), or dates
// (the same rules as moving an item).
function customTiming(plan, today, timing) {
  const E = utcDay(plan.basis.edd);
  if (timing.type === 'weeks') {
    const end = weekEnd(E, timing.toWeek);
    if (end < today || end > lastPlanDay(plan)) throw invalid({ 'timing.toWeek': `The window must end between today and ${lastDayWords(plan)}.` });
    if (isPregnancyPlan(plan) && timing.toWeek > 44) throw invalid({ 'timing.toWeek': 'At most week 44 in a pregnancy.' });
    return { atBooking: false, fromWeek: timing.fromWeek, toWeek: timing.toWeek, after: { key: null, weeks: null }, date: null, dateBy: null };
  }
  const dateBy = timing.dueBy ?? addDays(timing.dueFrom, 6);
  const fields = dueDateProblems(plan, today, timing.dueFrom, dateBy, { from: 'timing.dueFrom', to: 'timing.dueBy' });
  if (Object.keys(fields).length) throw invalid(fields);
  return { atBooking: false, fromWeek: null, toWeek: null, after: { key: null, weeks: null }, date: timing.dueFrom, dateBy };
}

/**
 * POST /items: a doctor adds an item to this patient's plan (body: customItemSchema). Sending the same
 * clientRequestId again returns the existing item. Returns { created, body: { plan, summary, itemId } }
 * (the route answers 201 when created, 200 otherwise).
 */
export async function addCustomItem(ctx, patientId, body) {
  let newId = null;
  let created = false;
  const out = await changePlan(ctx, patientId, { planLevel: true }, ({ plan, facts }) => {
    created = false;
    const existing = plan.items.find((it) => it.clientRequestId === body.clientRequestId);
    if (existing) {
      newId = itemId(existing);
      return { changed: false };
    }
    if (plan.items.filter((it) => it.origin === 'custom').length >= MAX_CUSTOM) {
      throw new HttpError(400, `This plan already has ${MAX_CUSTOM} items added by staff, the most it can have.`, 'VALIDATION');
    }
    if (plan.items.length >= MAX_ITEMS) throw new HttpError(400, `A care plan can have at most ${MAX_ITEMS} items.`, 'VALIDATION');
    const today = hospitalToday(ctx.now);
    const by = person(ctx);
    plan.items.push({
      key: `custom_${randomBytes(4).toString('hex')}`,
      origin: 'custom',
      clientRequestId: body.clientRequestId,
      kind: body.kind,
      name: body.name,
      patientText: body.patientText ?? '',
      source: '',
      appliesWhen: 'always',
      timing: customTiming(plan, today, body.timing),
      addedOn: today,
      added: { reason: body.reason ?? '', ...by },
      note: body.note ? { text: body.note, ...by } : null,
      state: 'open',
    });
    const it = plan.items[plan.items.length - 1];
    newId = itemId(it);
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name, newIds: new Set([newId]) });
    created = true;
    return { changed: true, change: 'item_added', itemId: newId };
  });
  return { created, body: { plan: out.plan, summary: out.summary, itemId: newId } };
}

/**
 * PATCH / – the booking date ({ bookedOn, previousBookedOn }). Must be between 4 w 0 d and today.
 * Items due at the first visit are counted from it; at-booking items with moved dates get "Check date".
 */
export function changeBookingDate(ctx, patientId, { bookedOn, previousBookedOn }) {
  return changePlan(ctx, patientId, { planLevel: true }, ({ plan, facts }) => {
    if (sameDay(bookedOn, plan.bookedOn)) return { changed: false };
    if (!sameDay(previousBookedOn, plan.bookedOn)) {
      throw conflict('The booking date was changed by someone else. The latest plan is shown – check it and try again.');
    }
    const E = utcDay(plan.basis.edd);
    const earliest = addDays(dayZero(E), MIN_BOOKING_DAYS);
    const today = hospitalToday(ctx.now);
    if (bookedOn < earliest || bookedOn > today) {
      throw invalid({ bookedOn: `The booking date must be between ${gaText(gaOn(E, earliest))} (${dateText(earliest)}) and today.` });
    }
    const from = plan.bookedOn;
    plan.bookedOn = utcDay(bookedOn);
    plan.bookedOnSetBy = person(ctx);
    personLog(ctx, plan, 'booking_date', `Booking date changed from ${dateText(from)} to ${dateText(bookedOn)}.`);
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name });
    return { changed: true, change: 'plan_changed' };
  });
}

// ---------- Protocol: switch or update (§6.4) ----------

const isDoctor = (ctx) => hasRole(ctx.req?.membership, 'doctor');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Standard, the assigned doctor's protocols, and a doctor's own protocols (an RMO: the first two).
const mayUseTemplate = (ctx, patient, t) =>
  t.kind === 'standard' || sameId(t.owner, patient.assignedDoctor) || (isDoctor(ctx) && sameId(t.owner, ctx.user._id));

// The checks of a protocol for this patient's plan (400 / 403): her type of care, who may use it, and items.
function assertUsable(ctx, patient, t) {
  if (t.careType !== patient.careType) throw new HttpError(400, `This protocol is not for ${CARE_WORDS[patient.careType] ?? patient.careType} care.`, 'VALIDATION');
  if (!mayUseTemplate(ctx, patient, t)) throw forbidden("You can use the hospital standard, your own protocols or the assigned doctor's protocols.");
  if (!t.items.length) throw new HttpError(400, 'This protocol has no items.', 'VALIDATION');
}

async function usableTemplate(ctx, patient, templateId) {
  const t = await CarePlanTemplate.findOne({ _id: templateId, tenantId: ctx.tenantId });
  if (!t) throw notFound('Template not found.');
  assertUsable(ctx, patient, t);
  return t;
}

/**
 * GET /template-options: the protocols this plan can use, in the order: the assigned doctor's, the hospital
 * standard, the acting doctor's own. Drafts are included (the screen warns). Empty protocols are left out.
 * ownerDefault: the protocol is its doctor's default; defaultState: whether new plans of that doctor's patients start
 * from it now ('in_use') or why not (careplans/defaultProtocol.js); owner: its doctor's id (the screen says "My
 * default" to that doctor).
 */
export async function templateOptions(ctx, patientId) {
  const { patient, plan } = await editablePlan(ctx, patientId, { planLevel: true });
  const owners = [patient.assignedDoctor, isDoctor(ctx) ? ctx.user._id : null].filter(Boolean);
  const all = await CarePlanTemplate.find({
    tenantId: ctx.tenantId,
    careType: plan.careType,
    $or: [{ kind: 'standard' }, { kind: 'personal', owner: { $in: owners } }],
  }).sort({ name: 1 });
  const usable = all.filter((t) => t.items.length && mayUseTemplate(ctx, patient, t));
  const assigned = usable.filter((t) => t.kind === 'personal' && sameId(t.owner, patient.assignedDoctor));
  const standard = usable.filter((t) => t.kind === 'standard');
  const own = usable.filter((t) => t.kind === 'personal' && !sameId(t.owner, patient.assignedDoctor));
  const states = await defaultStates(ctx.tenantId, usable);
  return {
    templates: [...assigned, ...standard, ...own].map((t) => ({
      id: String(t._id),
      name: t.name,
      kind: t.kind,
      owner: t.owner ? String(t.owner) : null,
      ownerName: t.ownerName ?? null,
      version: t.version,
      contentApproved: contentApproved(t),
      itemCount: t.items.length,
      inUse: sameId(t._id, plan.source.templateId),
      ownerDefault: t.kind === 'personal' && Boolean(t.ownerDefault),
      defaultState: states.get(String(t._id)) ?? null,
    })),
  };
}

const actorOf = (ctx) => ({ id: ctx.user._id, name: ctx.user.name });

/**
 * GET /template-preview?templateId=: what switching to (or updating to) this protocol would do, worked
 * out with the same function as the real change, on a copy of the plan. Not audited.
 */
export async function previewTemplate(ctx, patientId, templateId) {
  const { patient, plan, facts } = await editablePlan(ctx, patientId, { planLevel: true });
  const t = await usableTemplate(ctx, patient, templateId);
  const copy = CarePlan.hydrate(plan.toObject());
  const rep = mergeTemplate(copy, t, { at: ctx.now, actor: actorOf(ctx), facts });
  return {
    from: { name: plan.source.templateName, version: plan.source.version, itemsHash: plan.source.itemsHash },
    to: { id: String(t._id), name: t.name, version: t.version, contentApproved: contentApproved(t), itemsHash: itemsHash(t.items) },
    added: rep.added.map((a) => ({ key: a.key, name: a.name, kind: a.kind, timingText: timingText({ timing: a.timing }, copy.items) })),
    needsDecision: rep.needsDecision.map((a) => ({ key: a.key, name: a.name })),
    possibleDuplicates: rep.possibleDuplicates.map((d) => ({ key: d.key, name: d.name, withItemId: d.withItemId, withName: d.withName })),
    changed: rep.changed,
    kept: rep.kept,
    dropped: rep.dropped,
    unchanged: rep.unchanged,
    customKept: rep.customKept,
  };
}

/**
 * Moves the plan to the protocol's current content (in memory; the caller saves and audits): the one rule of a
 * switch or update, used by a single plan (applyTemplate) and by "update all plans" (updatePlansToTemplate).
 * mergeTemplate keeps everything a person recorded: items done stay done, moved dates, notes and inclusions stay,
 * items added for the patient are never touched, and an item that left the template is kept when staff touched it.
 * together: the move was one of many ("update all plans"), which the plan log says.
 */
function moveToTemplate(ctx, plan, facts, t, { together = false } = {}) {
  const sameTemplate = sameId(t._id, plan.source.templateId);
  const rep = mergeTemplate(plan, t, { at: ctx.now, actor: actorOf(ctx), facts });
  if (plan.items.length > MAX_ITEMS) throw new HttpError(400, `A care plan can have at most ${MAX_ITEMS} items.`, 'VALIDATION');
  const repeats = rep.possibleDuplicates.length;
  personLog(
    ctx,
    plan,
    sameTemplate ? 'template_updated' : 'template_switched',
    `${sameTemplate ? 'Updated to' : 'Switched to'} “${t.name}” version ${t.version}${contentApproved(t) ? '' : ' (draft)'}${together ? ' – with every plan of this protocol' : ''}.` +
      (repeats ? ` ${repeats === 1 ? '1 added item may repeat another' : `${repeats} added items may repeat others`}: marked “May repeat” to check.` : ''),
  );
  return { changed: true, change: 'plan_changed', possibleDuplicates: repeats };
}

/**
 * PUT /template ({ templateId, fromItemsHash, toItemsHash }): applies the reviewed switch or update. Refused
 * (409) if the plan's or the protocol's content changed since the preview. Nothing a person recorded is lost.
 */
export function applyTemplate(ctx, patientId, { templateId, fromItemsHash, toItemsHash }) {
  return changePlan(ctx, patientId, { planLevel: true }, async ({ plan, patient, facts }) => {
    const t = await usableTemplate(ctx, patient, templateId);
    const toHash = itemsHash(t.items);
    const sameTemplate = sameId(t._id, plan.source.templateId);
    if (sameTemplate && toHash === plan.source.itemsHash) return { changed: false };
    if (fromItemsHash !== plan.source.itemsHash || toItemsHash !== toHash) {
      throw conflict('The template or the plan changed since you reviewed the changes. Please review them again.');
    }
    return moveToTemplate(ctx, plan, facts, t);
  });
}

// ---------- A template's use, and its new version for all its plans at once (5 Oct 2026) ----------

/** The most plans one "update all plans" moves (the rest are offered again on the template page). */
export const PLANS_UPDATE_MAX = 200;

/**
 * How many current plans use each template – counts only (Map template id → { usedBy, olderVersion }). A plan
 * counts while it is current (active or paused – a closed plan is never current), for her current type of care, on
 * a record that is not marked as a duplicate and not closed after a death: exactly the plans "update all plans"
 * looks at (plansBehindTemplate), so the template page and its preview give the same numbers. olderVersion: of
 * those, the plans whose items are not the template's current items (hashes: Map template id → itemsHash of its
 * current items; a template left out counts 0). templateIds: only these templates (all of the hospital's when null).
 */
export async function templateUsage(tenantId, { templateIds = null, hashes = new Map() } = {}) {
  const plans = await CarePlan.find(
    { tenantId, current: true, ...(templateIds ? { 'source.templateId': { $in: templateIds } } : {}) },
    { patientId: 1, careType: 1, 'source.templateId': 1, 'source.itemsHash': 1 },
  ).lean();
  const usage = new Map();
  if (!plans.length) return usage;
  const ids = [...new Set(plans.map((p) => String(p.patientId)))];
  const careOfPatient = new Map((await Patient.find({ tenantId, _id: { $in: ids }, ...IN_USE }, { careType: 1 }).lean()).map((p) => [String(p._id), p.careType]));
  for (const p of plans) {
    if (careOfPatient.get(String(p.patientId)) !== p.careType) continue; // a duplicate or closed record, or an earlier type of care
    const id = String(p.source.templateId);
    const u = usage.get(id) ?? { usedBy: 0, olderVersion: 0 };
    u.usedBy += 1;
    if (hashes.has(id) && p.source.itemsHash !== hashes.get(id)) u.olderVersion += 1;
    usage.set(id, u);
  }
  return usage;
}

/**
 * The current plans built from this template whose items are not its current items, oldest first, each with its
 * patient and whether this person may move it now – why: null (yes) | 'paused' (a paused plan is moved one by one
 * once it is active again, as on the Care plan tab) | 'other_doctor' (a patient this person may not change: her own
 * doctor or an RMO moves it) | 'not_usable' (a doctor's protocol, and her doctor is now another doctor, who may not
 * use it: nobody can move the plan to its new version – her doctor can switch it to the hospital standard or to
 * their own protocol). Only plans in use: for her current type of care, on a record that is not marked as a
 * duplicate and not closed after a death. Closed plans are never included.
 */
async function plansBehindTemplate(ctx, t) {
  const plans = await CarePlan.find({
    tenantId: ctx.tenantId,
    current: true,
    careType: t.careType,
    'source.templateId': t._id,
    'source.itemsHash': { $ne: itemsHash(t.items) },
  }).sort({ createdAt: 1, _id: 1 });
  if (!plans.length) return [];
  const ids = plans.map((p) => p.patientId);
  const patients = new Map((await Patient.find({ tenantId: ctx.tenantId, _id: { $in: ids }, ...IN_USE }).lean()).map((p) => [String(p._id), p]));
  const rows = [];
  for (const plan of plans) {
    const patient = patients.get(String(plan.patientId));
    if (!patient || patient.careType !== plan.careType) continue;
    let why = null;
    if (plan.status !== 'active') why = 'paused';
    else if (!carePlanAccess(ctx.req, patient).edit) why = usableByHerDoctor(t, patient) ? 'other_doctor' : 'not_usable';
    rows.push({ plan, patient, why });
  }
  return rows;
}

// Her own doctor (or an RMO) may use this template on her plan: the hospital standard, or her doctor's own protocol
// (mayUseTemplate for anyone but the protocol's doctor).
const usableByHerDoctor = (t, patient) => t.kind === 'standard' || sameId(t.owner, patient.assignedDoctor);

const countWhy = (rows, why) => rows.filter((r) => r.why === why).length;

/**
 * "Update all plans", step 1 (GET /care-plans/templates/:id/plans-update): what moving every plan this person may
 * change to the template's current version would do, worked out with the same function as the real move, on copies
 * of the plans (nothing is saved or audited). Counts only – no patient and no item names:
 *  { template: { id, name, careType, version, itemsHash },
 *    plans: { behind, toUpdate, later, otherDoctors, notUsable, paused, fromVersions: [{ version, plans }] },
 *    items: { added, changed, removed, kept, needsDecision, plansWithPossibleDuplicates } }.
 * later: plans beyond PLANS_UPDATE_MAX, moved by pressing the button again. An added item that may repeat another
 * is marked on the plan by the move itself ("May repeat …", counted as needing a decision – mergeTemplate).
 */
export async function previewPlansUpdate(ctx, t) {
  const rows = await plansBehindTemplate(ctx, t);
  const movable = rows.filter((r) => !r.why);
  const now = movable.slice(0, PLANS_UPDATE_MAX);
  const items = { added: 0, changed: 0, removed: 0, kept: 0, needsDecision: 0, plansWithPossibleDuplicates: 0 };
  const versions = new Map();
  for (const { plan, patient } of now) {
    const copy = CarePlan.hydrate(plan.toObject());
    const rep = mergeTemplate(copy, t, { at: ctx.now, actor: actorOf(ctx), facts: planFacts(patient, ctx.now, plan) });
    items.added += rep.added.length;
    items.changed += rep.changed.length;
    items.removed += rep.dropped.length;
    items.kept += rep.kept.length;
    items.needsDecision += rep.needsDecision.length;
    if (rep.possibleDuplicates.length) items.plansWithPossibleDuplicates += 1;
    versions.set(plan.source.version, (versions.get(plan.source.version) ?? 0) + 1);
  }
  return {
    template: { id: String(t._id), name: t.name, careType: t.careType, version: t.version, itemsHash: itemsHash(t.items) },
    plans: {
      behind: rows.length,
      toUpdate: now.length,
      later: movable.length - now.length,
      otherDoctors: countWhy(rows, 'other_doctor'),
      notUsable: countWhy(rows, 'not_usable'),
      paused: countWhy(rows, 'paused'),
      fromVersions: [...versions].sort((a, b) => a[0] - b[0]).map(([version, plans]) => ({ version, plans })),
    },
    items,
  };
}

/**
 * "Update all plans", step 2 (POST /care-plans/templates/:id/plans-update): moves every plan this person may change
 * (at most PLANS_UPDATE_MAX) to the template's current version, one plan at a time, exactly as the Care plan tab's
 * update does (savePlanChange + moveToTemplate: the same checks, the same plan log line, the same audit entry per
 * plan – CARE_PLAN_CHANGED 'plan_changed', ids only). The caller has checked the template (approved, the version
 * the doctor reviewed, who may do this). Every plan not moved is left exactly as it was, and counted by why:
 *  - notUpdated: changed meanwhile (closed, switched, updated by someone else, or saved by others at that moment);
 *  - failed: it could not be moved (it would have too many items, or an unexpected error – each is logged on the
 *    server): the patient's Care plan tab says why;
 *  - otherDoctors / notUsable / paused: as in the preview (also when her doctor changed or the plan was paused
 *    meanwhile).
 * withPossibleDuplicates: plans moved that got an item that may repeat one they had (marked on the plan).
 * Returns { updated, withPossibleDuplicates, alreadyUpdated, notUpdated, failed, otherDoctors, notUsable, paused,
 * remaining }.
 */
export async function updatePlansToTemplate(ctx, t) {
  const rows = await plansBehindTemplate(ctx, t);
  const movable = rows.filter((r) => !r.why);
  const toHash = itemsHash(t.items);
  const out = {
    updated: 0,
    withPossibleDuplicates: 0,
    alreadyUpdated: 0,
    notUpdated: 0,
    failed: 0,
    otherDoctors: countWhy(rows, 'other_doctor'),
    notUsable: countWhy(rows, 'not_usable'),
    paused: countWhy(rows, 'paused'),
    remaining: Math.max(0, movable.length - PLANS_UPDATE_MAX),
  };
  for (const row of movable.slice(0, PLANS_UPDATE_MAX)) {
    try {
      const { result } = await savePlanChange(ctx, row.patient._id, { planLevel: true }, ({ plan, patient, facts }) => {
        // Still the same plan, on this template at another version (else it changed meanwhile: leave it)
        if (!sameId(plan._id, row.plan._id) || !sameId(plan.source.templateId, t._id)) return { changed: false, skipped: 'changed' };
        if (plan.source.itemsHash === toHash) return { changed: false, skipped: 'already' };
        assertUsable(ctx, patient, t);
        return moveToTemplate(ctx, plan, facts, t, { together: true });
      });
      if (result.changed) {
        out.updated += 1;
        if (result.possibleDuplicates) out.withPossibleDuplicates += 1;
      } else if (result.skipped === 'already') out.alreadyUpdated += 1;
      else out.notUpdated += 1;
    } catch (e) {
      // Her doctor was changed meanwhile: her new doctor (or an RMO) updates it – or, for a doctor's protocol, switches it
      if (e?.status === 403) out[t.kind === 'standard' ? 'otherDoctors' : 'notUsable'] += 1;
      else if (e?.code === 'PLAN_PAUSED') out.paused += 1;
      else if (e?.name === 'VersionError' || (e instanceof HttpError && (e.status === 404 || e.status === 409))) out.notUpdated += 1; // closed or changed meanwhile
      else {
        if (!(e instanceof HttpError)) console.error('Moving a care plan to the new template version failed', e?.message ?? e);
        out.failed += 1; // too many items, or an unexpected error: the plan is as it was
      }
    }
  }
  return out;
}

// ---------- EDD decision, close, reopen (§6.5) ----------

/**
 * POST /edd-decision ({ decision, toEdd }), only while the plan is on hold for an EDD change of more than
 * 8 weeks, and only for the EDD the person saw (toEdd):
 *  - same_pregnancy: the plan moves to the new EDD (moved items get "Check date");
 *  - new_pregnancy: this plan is closed (kept read-only) and a new plan is built from the standard template.
 * One audit entry ('plan_changed', with this plan's id). Returns { plan (the new plan after new_pregnancy), summary, changed }.
 */
export async function decideEdd(ctx, patientId, { decision, toEdd }) {
  for (let attempt = 1; ; attempt += 1) {
    const { patient, plan, facts } = await editablePlan(ctx, patientId, { planLevel: true });
    if (!plan.eddReview) throw conflict('The EDD is no longer waiting for a decision. The latest plan is shown.');
    if (!sameDay(toEdd, plan.eddReview.toEdd)) throw conflict('The EDD changed again since you opened the plan. The latest plan is shown – check it and try again.');
    const by = person(ctx);
    let res = null;
    if (decision === 'same_pregnancy') {
      const from = plan.basis.edd;
      plan.basis.edd = utcDay(toEdd);
      plan.basis.eddSource = facts.eddSource;
      plan.eddReview = null;
      res = derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name });
      personLog(ctx, plan, 'edd_same_pregnancy', `Same pregnancy confirmed: due dates moved from EDD ${dateText(from)} to ${dateText(toEdd)}.${checkDateText(res.checkDate)}`);
    } else {
      closeWith(plan, { reason: 'new_pregnancy', note: '', auto: false, ...by }); // eddReview stays on the closed plan
      personLog(ctx, plan, 'edd_new_pregnancy', `New pregnancy confirmed (EDD ${dateText(toEdd)}): this plan was closed and a new care plan started.`);
      derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name });
    }
    try {
      await plan.save();
    } catch (e) {
      if (e?.name === 'VersionError' && attempt < 3) continue;
      throw e;
    }
    // The decision is saved: audit it now (with this plan's id), before a new plan is built (not audited on
    // its own). If building it fails, the next read builds it.
    await auditChange(ctx, patient, plan, { change: 'plan_changed' });
    let result = plan;
    if (decision === 'new_pregnancy') {
      // null: built by another request at the same moment (it was given the link to this plan).
      result = (await createReplacement(ctx, patient, facts, plan)) ?? (await currentPlanOf(ctx.tenantId, patient._id));
    }
    return respond(ctx, patient, result, { changed: true });
  }
}

/**
 * POST /close ({ reason, note }): the plan becomes read-only and leaves all lists; no new plan is built for
 * this pregnancy. Allowed on an active or a paused plan. Returns { plan: null, summary, changed }.
 */
export async function closeCarePlan(ctx, patientId, { reason, note = '' }) {
  for (let attempt = 1; ; attempt += 1) {
    const { patient, plan, facts } = await editablePlan(ctx, patientId, { planLevel: false });
    closeWith(plan, { reason, note, auto: false, ...person(ctx) });
    personLog(ctx, plan, 'closed', `Plan closed (${CLOSE_WORDS[reason]}).`);
    derivePlan(plan, facts, { at: ctx.now, actorName: ctx.user.name });
    try {
      await plan.save();
    } catch (e) {
      if (e?.name === 'VersionError' && attempt < 3) continue;
      throw e;
    }
    await auditChange(ctx, patient, plan, { change: 'plan_changed' });
    return respond(ctx, patient, null, { changed: true });
  }
}

/**
 * POST /reopen ({ planId }): a closed plan of THIS patient becomes the current plan again (404 for any other
 * plan; 409 if the patient already has a current plan). It is then synced: it may pause, or go on hold for
 * a far EDD. Returns { plan, summary, changed }.
 */
export async function reopenCarePlan(ctx, patientId, { planId }) {
  for (let attempt = 1; ; attempt += 1) {
    const loaded = await loadPatientById(ctx, patientId);
    assertCanEdit(ctx.req, loaded);
    await syncPlan(ctx, loaded._id);
    // "Already has a current plan" is about HER type of care only: the paused antenatal plan of a mother who is now
    // postnatal (or in gynaecology care) – which syncPlan may answer with – does not stand in the way.
    const current = await currentPlanOf(ctx.tenantId, loaded._id, loaded.careType);
    const plan = await CarePlan.findOne({ _id: planId, tenantId: ctx.tenantId, patientId: loaded._id, careType: loaded.careType });
    if (!plan) throw notFound('Care plan not found.');
    if (current) {
      if (sameId(current._id, plan._id)) return respond(ctx, loaded, current, { changed: false });
      throw conflict(HAS_CURRENT_MESSAGE);
    }
    const closedOn = plan.closed?.at ? ` on ${dateText(hospitalToday(plan.closed.at))}` : '';
    const closedWhy = plan.closed?.reason ? ` (${CLOSE_WORDS[plan.closed.reason]})` : '';
    plan.current = true;
    plan.status = 'active';
    plan.pausedReason = null;
    plan.closed = null; // the close record stays in the log text
    // A pregnancy-loss plan closed because another loss was recorded, reopened by a doctor (the date seen had only
    // been corrected): it now counts from the date seen on the record – otherwise the next sync would see the far
    // date again and close it once more.
    const redate = plan.careType === 'abortion' ? lossStart(loaded) : null;
    const from = plan.basis?.startOn ? utcDay(plan.basis.startOn) : null;
    const redated = redate && from && !within56(from, redate);
    if (redated) {
      plan.basis.startOn = redate;
      plan.basis.edd = planFacts(loaded, ctx.now, plan).edd;
    }
    personLog(ctx, plan, 'reopened', `Plan reopened. It had been closed${closedOn}${closedWhy}.${redated ? ` It now counts from the date seen on the record, ${dateText(redate)} (was ${dateText(from)}).` : ''}`);
    try {
      await plan.save();
    } catch (e) {
      if (e?.code === 11000) throw conflict(HAS_CURRENT_MESSAGE);
      if (e?.name === 'VersionError' && attempt < 3) continue;
      throw e;
    }
    // The reopen is saved: audit it now, before the automatic sync (which is never audited on its own).
    await auditChange(ctx, loaded, plan, { change: 'plan_changed' });
    const synced = await readCurrentPlan(ctx, loaded._id);
    return respond(ctx, synced.patient ?? loaded, synced.plan ?? plan, { changed: true });
  }
}

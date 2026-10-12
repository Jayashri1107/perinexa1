// The care-plan engine: works out, for every item of a patient's antenatal plan, whether it applies, when it
// is due and what state it is in. PURE – no database, no clock: the caller passes the plan, the patient's
// facts and the moment. Works on plain objects and on Mongoose documents alike (the CarePlan model's shape).
//
// Who writes what (see the CarePlan model):
//  - item content, origin, addedOn, notInTemplate, possibleDuplicate: plan creation and template merge (mergeTemplate
//    here; "Keep as planned" clears possibleDuplicate);
//  - state, done, notNeeded, manualDate, forceInclude, note, staffBasis, history: ONLY actions by people;
//  - auto.*: ONLY derivePlan here. Everything in auto is independent of today's date, so a plan does not
//    have to be rewritten every day; the status shown ("Overdue", "Due now" …) is worked out on read.
//
// This is decision support: the plan suggests, the treating doctor or an RMO decides.

import { PREGNANCY_DAYS, addDays, hospitalToday, isoDay, sameDay, toHospitalDate, utcDay, weekEnd, weekStart } from './dates.js';
import { itemsHash } from './hashes.js';
import { AFTER_WINDOW_DAYS, BOOKING_WINDOW_DAYS, LATE_START, PLAN_ENGINE_VERSION, REMINDER_KINDS } from './planRules.js';
import { isFirstPregnancy, patientFacts } from './risk.js';
import { currentFindingEntries, currentFindings } from '../patients/pregnancyFindings.js';
import { LOSS_TYPE_KEYS, NOT_PREGNANT_NOW, RECURRENT_WORKUP_FROM_LOSSES } from '../patients/abortionRules.js';

// ---------- Facts ----------

/**
 * The "for which patients" conditions each finding of this pregnancy switches on (an item's appliesWhen).
 * diabetes_any / hypertension_any: the pre-existing condition or the finding.
 */
export const FINDING_CONDITIONS = {
  gdm: ['gdm', 'diabetes_any'],
  hypertension: ['pregnancy_hypertension', 'hypertension_any'],
  multiple: ['multiple_pregnancy'],
  placenta_praevia: ['placenta_praevia'],
  bleeding: ['bleeding'],
};

// Findings ticked on the record for THIS pregnancy (patients/pregnancyFindings.js) as plan facts: 'yes' or 'no'
// – never 'unknown' (an unticked finding is "not found so far"). diabetesAny / hypertensionAny: the pre-existing
// condition or the finding in this pregnancy. `key`: the part of the basis key that follows the findings.
// appliesSince: for each condition that applies BECAUSE of a finding, the hospital's date the finding was ticked
// (an item whose weeks had passed by then is for the doctor to decide – it could never have been done in time).
// "Any diabetes / any high blood pressure" has no such date when she had the condition before the pregnancy.
function findingFacts(patient, now, { diabetes, hypertension }) {
  const entries = currentFindingEntries(patient, now);
  const found = new Set(entries.map((f) => f.key));
  const has = (k) => (found.has(k) ? 'yes' : 'no');
  const either = (finding, condition) => (finding === 'yes' || condition === 'yes' ? 'yes' : condition);
  const gdm = has('gdm');
  const pregnancyHypertension = has('hypertension');
  const appliesSince = {};
  for (const f of entries) {
    if (!f.at) continue;
    const day = toHospitalDate(f.at);
    for (const condition of FINDING_CONDITIONS[f.key] ?? []) {
      if ((condition === 'diabetes_any' && diabetes === 'yes') || (condition === 'hypertension_any' && hypertension === 'yes')) continue;
      appliesSince[condition] = day;
    }
  }
  return {
    gdm,
    pregnancyHypertension,
    multiplePregnancy: has('multiple'),
    placentaPraevia: has('placenta_praevia'),
    bleeding: has('bleeding'),
    diabetesAny: either(gdm, diabetes),
    hypertensionAny: either(pregnancyHypertension, hypertension),
    appliesSince,
    key: `pf:${[...found].sort().join(',') || '-'}`,
  };
}

/**
 * Findings ticked for this pregnancy for which the plan's template – as it is NOW – has items that this plan
 * does not have: the plan was built from an older version of the template (plans keep the version they were
 * built from until a doctor updates each plan), so ticking the finding switches nothing on in it. Returns the
 * findings' keys, for the screens to say so next to the finding and offer the plan update. Pure.
 */
export function findingsWithoutPlanItems(plan, template, patient, now = new Date()) {
  if (!template?.items?.length || !patient) return [];
  const mine = new Map((plan.items ?? []).filter((it) => it.origin === 'template').map((it) => [it.key, it]));
  return currentFindings(patient, now).filter((finding) => {
    const conditions = FINDING_CONDITIONS[finding] ?? [];
    return template.items.some((t) => conditions.includes(t.appliesWhen) && !conditions.includes(mine.get(t.key)?.appliesWhen));
  });
}

/**
 * The patient's facts the plan depends on, each 'yes' | 'no' | 'unknown' (never guessed), plus the EDD
 * in use and a key that changes whenever any of them changes.
 * GDM, high blood pressure, twins, a low-lying placenta and bleeding found in THIS pregnancy count when a
 * doctor or RMO has ticked them on the record (never detected by the software itself).
 */
export function planFacts(patient, now = new Date(), plan = null) {
  const careType = plan?.careType ?? patient.careType;
  if (careType !== 'antenatal') return otherFacts(patient, careType, plan, now);
  const edd = utcDay(patient.pregnancy?.effectiveEdd);
  const eddSource = patient.pregnancy?.scanEdd ? 'scan' : 'lmp';
  const f = patientFacts(patient, now);
  const r = patient.risk;
  const yesNo = (v) => (v ? 'yes' : 'no');

  let highRisk = 'unknown'; // incomplete, or not worked out yet
  if (r?.override) highRisk = yesNo(r.override.level === 'high');
  else if (r?.level === 'high') highRisk = 'yes';
  else if (r?.level === 'low') highRisk = 'no';
  else if (r?.level === 'moderate') highRisk = r.mayBeHigher ? 'unknown' : 'no';

  let previousCaesarean = 'unknown';
  if (f.previousCaesareans > 0) previousCaesarean = 'yes';
  else if (f.previousCaesareans === 0 || isFirstPregnancy(patient)) previousCaesarean = 'no';

  const facts = {
    edd,
    eddSource,
    highRisk,
    mayBeHigher: Boolean(r?.mayBeHigher),
    rhNegative: f.rhNegative == null ? 'unknown' : yesNo(f.rhNegative),
    previousCaesarean,
    // Pre-existing (chronic) conditions only
    diabetes: f.conditions.includes('diabetes') ? 'yes' : f.conditionsKnown ? 'no' : 'unknown',
    hypertension: f.conditions.includes('hypertension') ? 'yes' : f.conditionsKnown ? 'no' : 'unknown',
  };
  const { key: findingsKey, ...found } = findingFacts(patient, now, facts);
  Object.assign(facts, found);
  facts.basisKey = [
    `e${PLAN_ENGINE_VERSION}`,
    'antenatal',
    isoDay(edd) ?? 'none',
    `hr:${facts.highRisk}`,
    `rh:${facts.rhNegative}`,
    `cs:${facts.previousCaesarean}`,
    `dm:${facts.diabetes}`,
    `ht:${facts.hypertension}`,
    findingsKey,
  ].join('|');
  return facts;
}

/**
 * The day a pregnancy-loss plan counts from: the day the loss was diagnosed – the "date seen" of the record's
 * Pregnancy loss section. null until that section has a type of loss that is still in use (a threatened
 * miscarriage saved before 3 Oct 2026 is a continuing pregnancy: no plan for a loss is built for it).
 */
export function lossStart(patient) {
  const a = patient?.abortion;
  return a?.presentedOn && LOSS_TYPE_KEYS.includes(a.lossType) ? utcDay(a.presentedOn) : null;
}

/**
 * What a pregnancy-loss plan depends on, from the record's Pregnancy loss section, the obstetric history and the
 * blood group (each 'yes' | 'no' | 'unknown', never guessed):
 *  - lossMolar: a molar pregnancy;
 *  - lossEctopicExpectant: an ectopic managed by waiting; lossEctopicHcg: an ectopic managed by waiting or with
 *    methotrexate (the two that need beta hCG follow-up). Unknown while the management is not recorded;
 *  - lossRecurrent: the recurrent-loss work-up – the type of loss says so, or Abortions (A) has reached
 *    RECURRENT_WORKUP_FROM_LOSSES. One loss fewer is 'unknown' (lossCountBorderline): the loss being cared for now
 *    may not be counted in A yet (the form asks to count it once it is over), so the doctor decides. Unknown also
 *    while A is not recorded;
 *  - lossAntiDDue: the anti-D reminder the record already has – an Rh-negative woman whose anti-D is not recorded
 *    as given or not needed (the same rule as the safety strip's "Rh negative – anti-D"). Unknown without a blood
 *    group; never for a type of loss that is not a pregnancy now;
 *  - lossNow: a loss cared for now – a miscarriage, an ectopic or a molar pregnancy; 'no' for a record that is only
 *    for the recurrent-loss work-up (she is not pregnant now: no "after the loss" check-up, haemoglobin or
 *    contraception item).
 * key: the part of the basis key that changes with them (lossNow follows the type of loss, already in it).
 */
function lossFacts(patient, rhNegative) {
  const a = patient.abortion ?? {};
  const type = a.lossType ?? null;
  const method = a.management?.method ?? null;
  const yesNo = (v) => (v ? 'yes' : 'no');
  const ectopic = (methods) => (type !== 'ectopic' ? 'no' : !method ? 'unknown' : yesNo(methods.includes(method)));
  const losses = patient.obstetric?.abortions ?? null;
  let lossRecurrent = 'no';
  let lossCountBorderline = false;
  if (type === 'recurrent' || (losses != null && losses >= RECURRENT_WORKUP_FROM_LOSSES)) lossRecurrent = 'yes';
  else if (losses == null) lossRecurrent = 'unknown';
  else if (losses === RECURRENT_WORKUP_FROM_LOSSES - 1) [lossRecurrent, lossCountBorderline] = ['unknown', true];
  const antiD = a.antiD?.status ?? null;
  const lossAntiDDue = NOT_PREGNANT_NOW.includes(type) || ['given', 'not_needed'].includes(antiD) ? 'no' : rhNegative;
  return {
    lossMolar: yesNo(type === 'molar'),
    lossEctopicExpectant: ectopic(['expectant']),
    lossEctopicHcg: ectopic(['expectant', 'methotrexate']),
    lossRecurrent,
    lossCountBorderline,
    lossAntiDDue,
    lossNow: yesNo(Boolean(type) && !NOT_PREGNANT_NOW.includes(type)),
    key: `loss:${type ?? '-'}:${method ?? '-'}:${lossRecurrent}${lossCountBorderline ? '?' : ''}:${lossAntiDDue}`,
  };
}

/**
 * Week 0 of a plan that is not antenatal (Version 2): the day of the delivery (postnatal, from the delivery a
 * doctor confirmed), the day of birth (newborn), the day the loss was diagnosed (pregnancy-loss care), or the day
 * the plan started (gynaecology, infertility). null when it is not known yet (no plan can be built).
 */
export function startFor(patient, careType, plan = null, now = new Date()) {
  if (careType === 'postnatal') return patient.lastDelivery?.at ? toHospitalDate(patient.lastDelivery.at) : null;
  if (careType === 'newborn') return patient.newborn?.birthAt ? toHospitalDate(patient.newborn.birthAt) : null;
  if (careType === 'abortion') return lossStart(patient);
  if (plan?.basis?.startOn) return utcDay(plan.basis.startOn);
  if (plan?.bookedOn) return utcDay(plan.bookedOn);
  return hospitalToday(now);
}

// The facts of a plan that is not antenatal: week 0 (as an EDD 280 days later, so the engine's weeks count from it),
// and the same yes/no facts as in pregnancy. A caesarean delivery counts as a "previous caesarean" (wound check).
// The findings are those of the pregnancy whose dates are on the record (for a mother after delivery: the
// pregnancy that just ended, e.g. a sugar test after GDM). A baby's own record has none.
function otherFacts(patient, careType, plan, now) {
  const start = startFor(patient, careType, plan, now);
  const f = patientFacts(patient, now);
  const yesNo = (v) => (v ? 'yes' : 'no');
  const r = patient.risk;
  let highRisk = 'unknown';
  if (r?.override) highRisk = yesNo(r.override.level === 'high');
  else if (r?.level === 'high') highRisk = 'yes';
  else if (r?.level === 'low' || r?.level === 'moderate') highRisk = 'no';
  let previousCaesarean = 'unknown';
  if (careType === 'postnatal' && patient.lastDelivery?.mode) previousCaesarean = yesNo(patient.lastDelivery.mode === 'lscs');
  else if (f.previousCaesareans > 0) previousCaesarean = 'yes';
  else if (f.previousCaesareans === 0) previousCaesarean = 'no';
  const facts = {
    edd: start ? addDays(start, PREGNANCY_DAYS) : null,
    eddSource: 'start',
    startOn: start,
    highRisk,
    mayBeHigher: false,
    rhNegative: f.rhNegative == null ? 'unknown' : yesNo(f.rhNegative),
    previousCaesarean,
    diabetes: f.conditions.includes('diabetes') ? 'yes' : f.conditionsKnown ? 'no' : 'unknown',
    hypertension: f.conditions.includes('hypertension') ? 'yes' : f.conditionsKnown ? 'no' : 'unknown',
  };
  const { key: findingsKey, ...found } = findingFacts(patient, now, facts);
  Object.assign(facts, found);
  const basis = [`e${PLAN_ENGINE_VERSION}`, careType, isoDay(start) ?? 'none', `hr:${highRisk}`, `rh:${facts.rhNegative}`, `cs:${previousCaesarean}`, `dm:${facts.diabetes}`, `ht:${facts.hypertension}`, findingsKey];
  // Pregnancy-loss care: the type of loss, its management, the anti-D answer and the count of losses
  if (careType === 'abortion') {
    const { key: lossKey, ...loss } = lossFacts(patient, facts.rhNegative);
    Object.assign(facts, loss);
    basis.push(lossKey);
  }
  facts.basisKey = basis.join('|');
  return facts;
}

// ---------- Applicability ----------

const FACT_FOR = {
  high_risk: 'highRisk',
  rh_negative: 'rhNegative',
  previous_caesarean: 'previousCaesarean',
  diabetes: 'diabetes',
  hypertension: 'hypertension',
  // Findings ticked for this pregnancy
  gdm: 'gdm',
  pregnancy_hypertension: 'pregnancyHypertension',
  multiple_pregnancy: 'multiplePregnancy',
  placenta_praevia: 'placentaPraevia',
  bleeding: 'bleeding',
  // The pre-existing condition or the finding in this pregnancy
  diabetes_any: 'diabetesAny',
  hypertension_any: 'hypertensionAny',
  // Pregnancy-loss care (lossFacts)
  loss_molar: 'lossMolar',
  loss_ectopic_expectant: 'lossEctopicExpectant',
  loss_ectopic_hcg: 'lossEctopicHcg',
  loss_recurrent: 'lossRecurrent',
  loss_anti_d_due: 'lossAntiDDue',
  loss_now: 'lossNow',
};
// Why an item does not apply: 'only_' + its condition (e.g. only_high_risk, only_gdm).
const WHY_NO = Object.fromEntries(Object.keys(FACT_FOR).map((k) => [k, `only_${k}`]));
const WHY_UNKNOWN = {
  rh_negative: 'rh_unknown',
  previous_caesarean: 'caesareans_unknown',
  diabetes: 'conditions_unconfirmed',
  hypertension: 'conditions_unconfirmed',
  diabetes_any: 'conditions_unconfirmed',
  hypertension_any: 'conditions_unconfirmed',
  loss_ectopic_expectant: 'loss_management_unknown',
  loss_ectopic_hcg: 'loss_management_unknown',
  loss_recurrent: 'loss_count_unknown', // or loss_count_check (ruleFor): one loss fewer than the work-up asks for
  loss_anti_d_due: 'rh_unknown',
};
// Only in pregnancy-loss care: for a plan of another type of care these never apply (a doctor's own template may
// carry one by mistake) – never "check needed" for a fact that does not exist there.
const LOSS_ONLY = ['loss_molar', 'loss_ectopic_expectant', 'loss_ectopic_hcg', 'loss_recurrent', 'loss_anti_d_due', 'loss_now'];
// A finding is ticked or it is not: facts worked out before findings existed (no such fact) read as 'no'.
const FINDING_ONLY = ['gdm', 'pregnancy_hypertension', 'multiple_pregnancy', 'placenta_praevia', 'bleeding'];
const STRENGTH = { no: 0, unknown: 1, yes: 2 };

/** Does an item with this "applies when" apply to a patient with these facts? { rule: yes|no|unknown, why }. */
export function ruleFor(appliesWhen, facts) {
  if (!appliesWhen || appliesWhen === 'always') return { rule: 'yes', why: null };
  const v = facts[FACT_FOR[appliesWhen]] ?? (FINDING_ONLY.includes(appliesWhen) || LOSS_ONLY.includes(appliesWhen) ? 'no' : 'unknown');
  if (v === 'yes') return { rule: 'yes', why: null };
  if (v === 'no') return { rule: 'no', why: WHY_NO[appliesWhen] };
  let why = WHY_UNKNOWN[appliesWhen];
  if (appliesWhen === 'high_risk') why = facts.mayBeHigher ? 'risk_may_be_higher' : 'risk_incomplete';
  else if (appliesWhen === 'loss_recurrent' && facts.lossCountBorderline) why = 'loss_count_check';
  return { rule: 'unknown', why };
}

// ---------- Timing helpers ----------

// Which timing rule an item uses (the first that fits).
function timingType(t) {
  if (t?.atBooking) return 'booking';
  if (t?.fromWeek != null) return 'weeks';
  if (t?.after?.key) return 'after';
  if (t?.date) return 'date';
  return null;
}

/** A short code for how an item is timed: 'b' (at booking), 'w18-20', 'avacc_td1+4', 'd' (fixed dates). */
export function timingKey(it) {
  const t = it.timing ?? {};
  switch (timingType(t)) {
    case 'booking':
      return 'b';
    case 'weeks':
      return `w${t.fromWeek}-${t.toWeek ?? t.fromWeek}`;
    case 'after':
      return `a${t.after.key}+${t.after.weeks}`;
    case 'date':
      return 'd';
    default:
      return null;
  }
}

/** The stable id of an item (the Mongoose _id; plain objects without one use the key). */
export const itemId = (it) => String(it._id ?? it.id ?? it.key);

// "After" items are timed from the template item with that key (a kept not-in-template item counts too,
// if the template no longer has one). Items added by a person are never anchors.
function anchorFinder(items) {
  const inTemplate = new Map();
  const kept = new Map();
  for (const it of items) {
    if (it.origin !== 'template') continue;
    const m = it.notInTemplate ? kept : inTemplate;
    if (!m.has(it.key)) m.set(it.key, it);
  }
  return (key) => inTemplate.get(key) ?? kept.get(key) ?? null;
}

/** The item another item is timed after (null if none, or the anchor is missing). */
export function anchorItem(plan, it) {
  const t = it.timing ?? {};
  return timingType(t) === 'after' ? anchorFinder(plan.items)(t.after.key) : null;
}

// True if following an item's "after" chain comes back round (a loop, or a chain that runs into one).
function reachesLoop(it, anchorOf) {
  const seen = new Set();
  for (let cur = it; cur && timingType(cur.timing) === 'after'; cur = anchorOf(cur.timing.after.key)) {
    if (seen.has(cur)) return true;
    seen.add(cur);
  }
  return false;
}

/**
 * An item a template change added that may repeat one the plan already had (mergeTemplate marks it with
 * possibleDuplicate { withItemId, withName, at }): it is to be checked while it is open and the other item is still
 * on the plan – until a person keeps it ("Keep as planned" clears the mark) or marks one of the two not needed (the
 * other one marked not needed after the mark counts as the answer). byId: the plan's items by itemId.
 */
function mayRepeat(it, byId) {
  const d = it.possibleDuplicate;
  if (it.state !== 'open' || !d?.withItemId) return false;
  const other = byId.get(String(d.withItemId));
  if (!other) return false;
  const answered = other.state === 'not_needed' && other.notNeeded?.at && d.at && new Date(other.notNeeded.at).getTime() >= new Date(d.at).getTime();
  return !answered;
}

/** What a person's move, include or keep is based on (saved with it, so later changes can be spotted). */
export function staffBasis(plan, it, at) {
  return { edd: utcDay(plan.basis.edd), bookedOn: utcDay(plan.bookedOn), timingKey: timingKey(it), applies: it.auto?.applies ?? null, at };
}

// ---------- Working out every item ----------

// Works out auto.* for every item of the plan. Returns a Map item → the new auto values.
function workOut(plan, facts) {
  const E = utcDay(plan.basis?.edd);
  const B = utcDay(plan.bookedOn);
  const anchorOf = anchorFinder(plan.items);
  const loops = new Set(plan.items.filter((it) => reachesLoop(it, anchorOf)));
  const memo = new Map();

  // Applicability and dates (items are worked out after the item they are timed from).
  function timingOf(it) {
    if (memo.has(it)) return memo.get(it);
    const t = it.timing ?? {};
    const type = timingType(t);
    let { rule, why } = ruleFor(it.appliesWhen, facts);
    let riskBased = it.appliesWhen === 'high_risk';
    let window = null;
    let due = null;
    let dateSource = null;
    let anchor = null;

    if (type === 'booking') {
      window = [B, addDays(B, BOOKING_WINDOW_DAYS - 1)];
      dateSource = 'booking';
    } else if (type === 'weeks' && E) {
      window = [weekStart(E, t.fromWeek), weekEnd(E, t.toWeek ?? t.fromWeek)];
      dateSource = 'window';
    } else if (type === 'after') {
      const key = t.after.key;
      const a = anchorOf(key);
      if (!a) anchor = { state: 'missing', key };
      else if (loops.has(it)) anchor = { state: 'loop', key };
      else {
        const ar = timingOf(a);
        // An anchor a person planned or included counts as applying.
        const anchorApplies = a.forceInclude || a.manualDate ? 'yes' : ar.rule;
        riskBased ||= ar.riskBased;
        if (STRENGTH[anchorApplies] < STRENGTH[rule]) {
          rule = anchorApplies;
          why = ar.why;
        }
        if (a.state === 'done' && a.done?.on) {
          const from = addDays(a.done.on, 7 * t.after.weeks);
          window = [from, addDays(from, AFTER_WINDOW_DAYS - 1)];
          dateSource = 'after_done';
        } else if (a.state === 'not_needed') anchor = { state: 'not_needed', key };
        // A person included or planned this item itself: it waits for its anchor even if the anchor does not
        // apply (otherwise it inherits "does not apply" and needs no anchor).
        else if (anchorApplies !== 'no' || it.forceInclude || it.manualDate) anchor = { state: 'waiting', key }; // estimate worked out on read
      }
    } else if (type === 'date') {
      due = [utcDay(t.date), t.dateBy ? utcDay(t.dateBy) : addDays(t.date, 6)];
      dateSource = 'fixed';
    }
    if (window) due = [...window];

    // Late start: the window had already ended when the plan started, when the item was added, or – for an item
    // that applies because of a finding in this pregnancy – when the finding was ticked. (Otherwise a growth scan
    // for 28–30 weeks would be "overdue" the moment GDM is ticked at 32 weeks.)
    let lateStart = null;
    let lateFrom = null;
    if (window && !it.manualDate) {
      const added = utcDay(it.addedOn);
      const found = rule === 'yes' ? utcDay(facts.appliesSince?.[it.appliesWhen]) : null;
      let S = B;
      let from = 'booking';
      if (added && added > S) [S, from] = [added, 'added'];
      if (found && found > S) [S, from] = [found, 'finding'];
      if (from !== 'finding' && it.kind === 'visit' && type !== 'booking' && it.addedOn == null && window[0] <= B && B <= window[1]) lateStart = 'covered';
      else if (window[1] < S) lateStart = LATE_START[it.kind] ?? 'decide';
      if (lateStart) lateFrom = from;
      if (lateStart === 'catch_up') {
        due = [S, addDays(S, BOOKING_WINDOW_DAYS - 1)];
        dateSource = 'catch_up';
      }
    }
    // A date a person set always wins.
    if (it.manualDate) {
      due = [utcDay(it.manualDate.dueFrom), utcDay(it.manualDate.dueBy)];
      dateSource = 'manual';
    }

    const result = { type, rule, why, riskBased, window, due, dateSource, lateStart, lateFrom, anchor };
    memo.set(it, result);
    return result;
  }

  const out = new Map();
  const byId = new Map(plan.items.map((x) => [itemId(x), x]));
  for (const it of plan.items) {
    const r = timingOf(it);
    const md = it.manualDate;
    const forced = Boolean(md || it.forceInclude);
    // The rule turned to 'no' AFTER the person moved or included the item.
    const noLongerIndicated = forced && r.rule === 'no' && it.staffBasis?.applies !== 'no';

    const flags = [];
    if (it.state === 'open' && md) {
      const sb = it.staffBasis;
      if (sb && (!sameDay(sb.edd, E) || sb.timingKey !== timingKey(it) || (r.type === 'booking' && !sameDay(sb.bookedOn, B)))) flags.push('check_date');
      if (r.window && (utcDay(md.dueFrom) < r.window[0] || utcDay(md.dueBy) > r.window[1])) flags.push('outside_window');
    }
    if (it.state === 'open' && noLongerIndicated) flags.push('no_longer_indicated');
    // A marker only (like "Check date"): the item stays due and on lists – decision support never holds it back
    if (mayRepeat(it, byId)) flags.push('possible_duplicate');

    // Phase: first match wins.
    let phase = 'open';
    let why = null;
    if (it.state === 'done' || it.state === 'not_needed') {
      phase = it.state;
      why = r.rule === 'yes' ? null : r.why; // done but no longer applies → marker on the screen
    } else if (plan.status !== 'active') phase = 'inactive';
    else if (noLongerIndicated) [phase, why] = ['check', 'no_longer_indicated'];
    else if (!forced && r.rule === 'no') [phase, why] = ['not_applicable', r.why];
    else if (!forced && r.rule === 'unknown') [phase, why] = ['check', r.why];
    else if (it.notInTemplate && !md) [phase, why] = ['decide', 'not_in_template'];
    else if (!md && r.anchor?.state === 'waiting') [phase, why] = ['waiting', 'anchor_waiting'];
    else if (!md && r.anchor) [phase, why] = ['check', r.anchor.state === 'loop' ? 'timing_loop' : `anchor_${r.anchor.state}`];
    else if (!md && (r.lateStart === 'lapsed' || r.lateStart === 'covered')) phase = 'lapsed';
    else if (!md && r.lateStart === 'decide') phase = 'decide';
    else if (plan.eddReview) phase = 'on_hold';

    out.set(it, {
      applies: r.rule,
      why,
      riskBased: r.riskBased,
      windowFrom: r.window?.[0] ?? null,
      windowTo: r.window?.[1] ?? null,
      dueFrom: r.due?.[0] ?? null,
      dueBy: r.due?.[1] ?? null,
      dateSource: r.dateSource,
      lateStart: r.lateStart,
      lateFrom: r.lateFrom,
      anchor: r.anchor,
      flags,
      phase,
      // Only items with a due date can go on a reminder list.
      listable: phase === 'open' && REMINDER_KINDS.includes(it.kind) && plan.status === 'active' && Boolean(r.due?.[0]),
    });
  }
  return out;
}

// Compares stored and new auto values (dates by day, lists and the anchor by content).
function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : false;
  if (Array.isArray(a) || Array.isArray(b)) return [...(a ?? [])].join('|') === [...(b ?? [])].join('|');
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) return (a?.state ?? null) === (b?.state ?? null) && (a?.key ?? null) === (b?.key ?? null);
  return (a ?? null) === (b ?? null);
}

// What a person sees of an item; a change to any of these raises the item's rev.
const WATCHED = ['applies', 'phase', 'windowFrom', 'windowTo', 'dueFrom', 'dueBy', 'flags'];
const DATES = ['windowFrom', 'windowTo', 'dueFrom', 'dueBy'];
const copyOf = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { state: v.state, key: v.key } : v);

/**
 * Works out auto.* for every item. Deterministic and idempotent: a second run changes nothing.
 * Never touches what people wrote. When what a person sees of an existing item changes (and the item is not
 * one the caller just changed, `changedIds`), its rev goes up, so an action based on the old view is refused.
 * `newIds`: items the caller has just created (a new plan, items a template merge added, a custom item).
 * They are worked out for the first time, so they keep rev 0 and are not counted in the plan log.
 * Every other item counts as existing.
 * Returns { nowApply: [ids], noLongerApply: [ids], retimed, checkDate, changed } for the plan log
 * (open items only).
 */
export function derivePlan(plan, facts, { at, actorName = 'Automatic', changedIds = new Set(), newIds = new Set(), compare = true } = {}) {
  const skip = new Set([...changedIds].map(String));
  const fresh = new Set([...newIds].map(String));
  const next = workOut(plan, facts);
  const res = { nowApply: [], noLongerApply: [], retimed: 0, checkDate: 0, changed: false };

  for (const it of plan.items) {
    if (!it.auto) it.auto = {};
    // compare false (a preview that is never saved): only the auto values are worked out; revs and the report
    // for the plan log, which compare them with the values before, are left out.
    const existed = compare && !fresh.has(itemId(it));
    const before = existed ? Object.fromEntries(WATCHED.map((k) => [k, copyOf(it.auto[k])])) : null;
    const values = next.get(it);
    for (const [k, v] of Object.entries(values)) {
      if (it.auto[k] !== undefined && sameValue(it.auto[k], v)) continue;
      it.auto[k] = v;
      res.changed = true;
    }
    if (!existed) continue;

    const differs = (k) => !sameValue(before[k], values[k]);
    if (WATCHED.some(differs) && !skip.has(itemId(it))) {
      it.rev = (it.rev ?? 0) + 1;
      it.revByName = actorName;
      it.revAt = at;
    }
    if (it.state !== 'open') continue;
    if (before.applies !== 'yes' && values.applies === 'yes') res.nowApply.push(itemId(it));
    if (before.applies === 'yes' && values.applies === 'no') res.noLongerApply.push(itemId(it));
    if (DATES.some(differs)) res.retimed += 1;
    if (values.flags.includes('check_date') && !(before.flags ?? []).includes('check_date')) res.checkDate += 1;
  }
  if (res.changed) {
    if (!plan.basis) plan.basis = {};
    plan.basis.syncedAt = at;
  }
  return res;
}

// ---------- Status shown (worked out on read, from the hospital's today) ----------

const PHASE_STATUS = { check: 'check_needed', decide: 'decide', lapsed: 'lapsed', on_hold: 'on_hold', not_applicable: 'not_applicable', done: 'done', not_needed: 'not_needed', inactive: 'inactive' };
const time = (d) => utcDay(d).getTime();

/**
 * The status of every item on `today` (a date): Map item → { status, estimateFrom }.
 * status: overdue | due | upcoming | missed | waiting | check_needed | decide | lapsed | on_hold |
 *         not_applicable | done | not_needed | inactive.
 * A visit whose window ended becomes "missed" (not overdue) once a later visit has started or been attended.
 * estimateFrom: for a waiting item, about when it will be due (never in the past).
 */
export function planStatuses(plan, today) {
  const T = time(today);
  const anchorOf = anchorFinder(plan.items);
  const laterVisitStarted = (it) =>
    plan.items.some(
      (v) =>
        v !== it &&
        v.kind === 'visit' &&
        v.state !== 'not_needed' &&
        ['open', 'done'].includes(v.auto?.phase) &&
        v.auto.dueFrom &&
        time(v.auto.dueFrom) > time(it.auto.dueFrom) &&
        (time(v.auto.dueFrom) <= T || v.state === 'done'),
    );

  const out = new Map();
  for (const it of plan.items) {
    const a = it.auto ?? {};
    let status = PHASE_STATUS[a.phase] ?? null;
    let estimateFrom = null;
    if (a.phase === 'open' || !a.phase) {
      if (!a.dueFrom || !a.dueBy) status = 'upcoming';
      else if (T > time(a.dueBy)) status = it.kind === 'visit' && laterVisitStarted(it) ? 'missed' : 'overdue';
      else status = T >= time(a.dueFrom) ? 'due' : 'upcoming';
    } else if (a.phase === 'waiting') {
      status = 'waiting';
      const anchorFrom = anchorOf(it.timing.after.key)?.auto?.dueFrom;
      if (anchorFrom) estimateFrom = addDays(new Date(Math.max(time(anchorFrom), T)), 7 * it.timing.after.weeks);
    }
    out.set(it, { status, estimateFrom });
  }
  return out;
}

/** The status of one item (see planStatuses). */
export const itemStatus = (plan, it, today) => planStatuses(plan, today).get(it);

/**
 * The next visit to suggest (used by Feature 8 for the prescription): the first overdue or due visit,
 * otherwise the first upcoming one – never a missed one. alsoDue: other open items due by then.
 * Returns { visit: {itemId, name, dueFrom, dueBy, status} | null, alsoDue: [{itemId, kind, name, status}], missedVisits }.
 */
export function nextVisitSuggestion(plan, today, statuses = planStatuses(plan, today)) {
  const st = (it) => statuses.get(it)?.status;
  const open = plan.items.filter((it) => it.auto?.phase === 'open');
  const byDueFrom = (a, b) => time(a.auto.dueFrom) - time(b.auto.dueFrom);
  const visits = open.filter((it) => it.kind === 'visit' && ['overdue', 'due', 'upcoming'].includes(st(it)) && it.auto.dueFrom).sort(byDueFrom);
  const visit = visits.find((it) => ['overdue', 'due'].includes(st(it))) ?? visits.find((it) => st(it) === 'upcoming') ?? null;
  const alsoDue = open
    .filter((it) => it.kind !== 'visit' && it.auto.dueFrom)
    .filter((it) => ['overdue', 'due'].includes(st(it)) || (st(it) === 'upcoming' && visit && time(it.auto.dueFrom) <= time(visit.auto.dueBy)))
    .sort(byDueFrom);
  return {
    visit: visit ? { itemId: itemId(visit), name: visit.name, dueFrom: visit.auto.dueFrom, dueBy: visit.auto.dueBy, status: st(visit) } : null,
    alsoDue: alsoDue.map((it) => ({ itemId: itemId(it), kind: it.kind, name: it.name, status: st(it) })),
    missedVisits: plan.items.filter((it) => st(it) === 'missed').length,
  };
}

// ---------- New items and template changes ----------

const emptyAuto = () => ({
  applies: 'yes',
  why: null,
  riskBased: false,
  windowFrom: null,
  windowTo: null,
  dueFrom: null,
  dueBy: null,
  dateSource: null,
  lateStart: null,
  lateFrom: null,
  anchor: null,
  flags: [],
  phase: 'open',
  listable: false,
});

const templateTiming = (t) => ({
  atBooking: Boolean(t.atBooking),
  fromWeek: t.fromWeek ?? null,
  toWeek: t.toWeek ?? null,
  after: { key: t.after?.key ?? null, weeks: t.after?.weeks ?? null },
  date: null,
  dateBy: null,
});

/** A plan item made from a template item (open, nothing done). addedOn: the date it joined an existing plan. */
export function newItem(t, { addedOn = null } = {}) {
  return {
    key: t.key,
    origin: 'template',
    rev: 0,
    revByName: null,
    revAt: null,
    clientRequestId: null,
    kind: t.kind,
    name: t.name,
    patientText: t.patientText ?? '',
    source: t.source ?? '',
    appliesWhen: t.appliesWhen ?? 'always',
    timing: templateTiming(t),
    addedOn,
    notInTemplate: null,
    state: 'open',
    done: null,
    notNeeded: null,
    manualDate: null,
    forceInclude: null,
    note: null,
    staffBasis: null,
    added: null,
    history: [],
    auto: emptyAuto(),
  };
}

const blank = (v) => (v === undefined || v === '' ? null : v);
const CONTENT_FIELDS = ['name', 'patientText', 'source', 'appliesWhen'];
const TIMING_FIELDS = ['atBooking', 'fromWeek', 'toWeek'];

// Which content fields of a plan item differ from the template item ('timing' covers all of its parts).
function diffContent(it, t) {
  const fields = CONTENT_FIELDS.filter((f) => {
    const [a, b] = f === 'appliesWhen' ? [it.appliesWhen ?? 'always', t.appliesWhen ?? 'always'] : [it[f], t[f]];
    return blank(a) !== blank(b);
  });
  const now = it.timing ?? {};
  const want = templateTiming(t);
  const timingDiffers =
    TIMING_FIELDS.some((f) => blank(f === 'atBooking' ? Boolean(now[f]) : now[f]) !== blank(want[f])) ||
    blank(now.after?.key) !== want.after.key ||
    blank(now.after?.weeks) !== want.after.weeks;
  if (timingDiffers) fields.push('timing');
  return fields;
}

function copyContent(it, t) {
  it.name = t.name;
  it.patientText = t.patientText ?? '';
  it.source = t.source ?? '';
  it.appliesWhen = t.appliesWhen ?? 'always';
  it.timing = templateTiming(t);
}

const MERGE_ACTIONS = ['template_changed', 'kept_not_in_template'];
/** A person did something to this item (so a template change must not drop it). */
export const touched = (it) =>
  it.state !== 'open' || Boolean(it.manualDate || it.forceInclude || it.note) || (it.history ?? []).some((h) => !MERGE_ACTIONS.includes(h.action));

// Why an item was kept: done | not_needed | moved | included | note | history.
const stateWord = (it) =>
  it.state !== 'open' ? it.state : it.manualDate ? 'moved' : it.forceInclude ? 'included' : it.note ? 'note' : 'history';

// "Anomaly scan (level II / TIFFA)" → "anomaly scan level ii tiffa"
const plainName = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const overlaps = (a, b) => {
  const [af, at] = [a.auto.windowFrom ?? a.auto.dueFrom, a.auto.windowTo ?? a.auto.dueBy];
  const [bf, bt] = [b.auto.windowFrom ?? b.auto.dueFrom, b.auto.windowTo ?? b.auto.dueBy];
  return Boolean(af && at && bf && bt) && time(af) <= time(bt) && time(bf) <= time(at);
};

/**
 * Moves a plan to another template, or to a newer version of its own (pure; the preview and the apply
 * use this same function – the preview on a copy). Nothing a person did is lost:
 *  - same key and kind: the content is updated, everything staff recorded is kept (a moved date stays);
 *  - an item the template no longer has is kept ("not in the template") if a person touched it, otherwise dropped;
 *  - template items the plan does not have are added (addedOn = today, so a passed window is "Decide", not overdue);
 *  - items a person added are never touched.
 *  - an added item that may repeat one the plan already has (same kind, overlapping dates or the same name) is
 *    marked possibleDuplicate (a "May repeat …" flag until a person keeps it or marks one of the two not needed).
 * actor: { id, name }. Returns the report { added, changed, kept, dropped, unchanged, customKept, needsDecision,
 * possibleDuplicates }.
 */
export function mergeTemplate(plan, template, { at, actor, facts }) {
  const remaining = new Map(template.items.map((t) => [t.key, t]));
  const out = [];
  const raised = new Set(); // positions in `out` whose rev the merge raised itself
  const rep = { added: [], changed: [], kept: [], dropped: [], unchanged: 0, customKept: 0 };
  const raise = (it) => {
    it.rev = (it.rev ?? 0) + 1;
    it.revByName = actor.name;
    it.revAt = at;
    raised.add(out.length);
  };
  const log = (it, action, to) => {
    if (!it.history) it.history = [];
    it.history.push({ at, by: actor.id ?? null, byName: actor.name, action, from: null, to: to ?? null, reason: '' });
  };

  for (const it of plan.items) {
    if (it.origin === 'custom') {
      out.push(it);
      rep.customKept += 1;
      continue;
    }
    const t = remaining.get(it.key);
    if (t && t.kind === it.kind) {
      // Same meaning: update the content, keep all staff data.
      const fields = diffContent(it, t);
      if (fields.length) {
        copyContent(it, t);
        raise(it);
        log(it, 'template_changed', { fields });
        rep.changed.push({ itemId: itemId(it), name: it.name, fields, keepsDoctorDate: Boolean(it.manualDate) });
      } else rep.unchanged += 1;
      if (it.notInTemplate) {
        it.notInTemplate = null;
        raise(it);
      }
      remaining.delete(it.key);
      out.push(it);
    } else if (touched(it)) {
      if (!it.notInTemplate) {
        it.notInTemplate = { since: at, templateName: template.name, version: template.version };
        raise(it);
        log(it, 'kept_not_in_template');
      }
      rep.kept.push({ itemId: itemId(it), name: it.name, why: stateWord(it) });
      out.push(it);
    } else rep.dropped.push({ itemId: itemId(it), name: it.name }); // generated and untouched
  }

  const firstAdded = out.length;
  const addedOn = hospitalToday(at);
  for (const t of template.items) if (remaining.has(t.key)) out.push(newItem(t, { addedOn }));

  plan.items = out;
  const items = plan.items; // Mongoose turns the plain new items into subdocuments (with ids)
  const addedItems = items.slice(firstAdded);
  const changedIds = new Set([...raised].map((i) => itemId(items[i])));
  const newIds = new Set(addedItems.map(itemId));
  plan.source = {
    templateId: template._id ?? null,
    templateName: template.name,
    templateKind: template.kind,
    ownerName: template.ownerName ?? null,
    version: template.version,
    itemsHash: itemsHash(template.items),
    chosenBy: { by: actor.id ?? null, byName: actor.name, at },
  };
  derivePlan(plan, facts, { at, actorName: actor.name, changedIds, newIds });

  rep.added = addedItems.map((it) => ({ itemId: itemId(it), key: it.key, name: it.name, kind: it.kind, timing: it.timing }));
  rep.needsDecision = addedItems.filter((it) => ['decide', 'lapsed'].includes(it.auto.phase)).map((it) => ({ itemId: itemId(it), key: it.key, name: it.name }));
  const existing = items.slice(0, firstAdded).filter((it) => it.state !== 'not_needed' || it.notInTemplate);
  rep.possibleDuplicates = [];
  for (const it of addedItems) {
    const same = existing.find((e) => e.kind === it.kind && (overlaps(e, it) || plainName(e.name) === plainName(it.name)));
    if (!same) continue;
    rep.possibleDuplicates.push({ itemId: itemId(it), key: it.key, name: it.name, withItemId: itemId(same), withName: same.name });
    // Kept on the added item, so the pair is still found on the plan afterwards ("May repeat …", Needs decision) –
    // also after "update all plans", where the doctor saw counts only
    it.possibleDuplicate = { withItemId: itemId(same), withName: same.name, at };
  }
  // The marks are new: work out the added items' flags again (only they changed – nothing else moves)
  if (rep.possibleDuplicates.length) derivePlan(plan, facts, { at, actorName: actor.name, changedIds, newIds });
  return rep;
}

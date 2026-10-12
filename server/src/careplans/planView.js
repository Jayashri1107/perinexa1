// What the website receives about a care plan (pure, no database). Only the fields listed here are ever
// sent: never staff ids, never the plan's "basis" (the medical facts it was worked out from), never who
// last changed an item. The status of every item ("Overdue", "Due now" …) is worked out here from the
// hospital's today, so the browser never works statuses out itself.

import { addDays, dayZero, daysBetween, gaOn, toHospitalDate, utcDay } from './dates.js';
import { planApproval } from './hashes.js';
import { anchorItem, findingsWithoutPlanItems, itemId, nextVisitSuggestion, planStatuses } from './planEngine.js';
import { START_WORDS } from './otherDrafts.js';
import { MIN_BOOKING_DAYS, POST_DATES_DAYS, RECENT_CHANGES_DAYS } from './planRules.js';

/** Which care the plan is for, and (other than antenatal) the day it counts from: delivery, birth or start. */
const careOf = (plan) => ({
  careType: plan.careType ?? 'antenatal',
  startOn: plan.careType && plan.careType !== 'antenatal' ? dayZero(utcDay(plan.basis.edd)) : null,
  startWord: START_WORDS[plan.careType] ?? null,
});

// ---------- Words for dates and timing ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (d) => {
  const x = utcDay(d);
  return { day: x.getUTCDate(), month: MONTHS[x.getUTCMonth()], year: x.getUTCFullYear() };
};

/** "12 Oct 2026" */
export function dateText(d) {
  if (d == null) return '';
  const p = parts(d);
  return `${p.day} ${p.month} ${p.year}`;
}

/** A date range: "12–26 Oct 2026", "28 Sep – 4 Oct 2026", "30 Dec 2026 – 5 Jan 2027" or one day "12 Oct 2026". */
export function windowText(from, to) {
  if (from == null) return '';
  if (to == null || daysBetween(from, to) === 0) return dateText(from);
  const a = parts(from);
  const b = parts(to);
  if (a.year !== b.year) return `${dateText(from)} – ${dateText(to)}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${dateText(to)}`;
  return `${a.day}–${dateText(to)}`;
}

/** "18 w 0 d" (empty before day 0). */
export const gaText = (ga) => (ga ? `${ga.weeks} w ${ga.days} d` : '');
const weeksDays = (ga) => (ga ? { weeks: ga.weeks, days: ga.days } : null);

/** When an item is due, in the words the template pages use: "At first visit", "11–13 w", "4 w after “Td – dose 1”", or dates. */
export function timingText(it, items = []) {
  const t = it.timing ?? {};
  if (t.atBooking) return 'At first visit';
  if (t.fromWeek != null) return t.fromWeek === (t.toWeek ?? t.fromWeek) ? `${t.fromWeek} w` : `${t.fromWeek}–${t.toWeek} w`;
  if (t.after?.key) {
    const ref = items.find((i) => i.key === t.after.key && i.origin === 'template');
    return `${t.after.weeks} w after “${ref?.name ?? t.after.key}”`;
  }
  if (t.date) return windowText(t.date, t.dateBy ?? addDays(t.date, 6));
  return '—';
}

// ---------- Small pieces ----------

// Records saved on items may carry staff ids (by, visitId); those never leave the server.
const HIDDEN_KEYS = new Set(['by', 'visitId', '_id']);
function withoutIds(v) {
  if (v == null || v instanceof Date || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(withoutIds);
  const plain = typeof v.toObject === 'function' ? v.toObject() : v;
  return Object.fromEntries(Object.entries(plain).filter(([k]) => !HIDDEN_KEYS.has(k)).map(([k, x]) => [k, withoutIds(x)]));
}

const STATUS_COUNT = {
  overdue: 'overdue',
  due: 'due',
  upcoming: 'upcoming',
  missed: 'missed',
  waiting: 'waiting',
  check_needed: 'checkNeeded',
  decide: 'decide',
  on_hold: 'onHold',
  lapsed: 'lapsed',
  done: 'done',
  not_needed: 'notNeeded',
  not_applicable: 'notApplicable',
};

// Facts the plan's items are waiting for (only those some item needs), in the order the screen lists them.
const MISSING_FACTS = [
  ['rh_unknown', 'Blood group'],
  ['risk_incomplete', 'Risk level (Incomplete)'],
  ['risk_may_be_higher', 'Risk level (Moderate – may be higher)'],
  ['caesareans_unknown', 'Previous caesareans'],
  ['conditions_unconfirmed', 'Pre-existing conditions'],
  // Pregnancy-loss care
  ['loss_management_unknown', 'Management of the ectopic pregnancy'],
  ['loss_count_unknown', 'Abortions (A) in the obstetric history'],
  ['loss_count_check', 'Whether this loss is counted in Abortions (A)'],
];

// Items a doctor should look at: Decide, Check needed, a moved date that needs checking after an automatic
// change (check_date), or an item a template change added that may repeat another (possible_duplicate). A date a
// doctor moved outside the guideline window with a reason is their decision already: "Outside guideline window"
// stays as a marker but does not ask again.
const ASKING_FLAGS = ['check_date', 'possible_duplicate'];
const needsDecision = (it, status) =>
  status === 'decide' || status === 'check_needed' || (status !== 'inactive' && it.state === 'open' && (it.auto?.flags ?? []).some((f) => ASKING_FLAGS.includes(f)));

// Findings ticked for this pregnancy whose items this plan does not have, although the template it was built from
// has them now (the plan needs the "update" step to get them). Only for a plan that is in use (active).
const findingsToUpdateFor = (plan, { patient, srcT, now, today }) =>
  plan.status === 'active' ? findingsWithoutPlanItems(plan, srcT, patient, now ?? today) : [];

/** Everything about the plan that does not depend on who is looking. */
function planState(plan, { today, patient, srcT, stdT }) {
  const statuses = planStatuses(plan, today);
  const status = (it) => statuses.get(it)?.status ?? null;
  const counts = Object.fromEntries(Object.values(STATUS_COUNT).map((k) => [k, 0]));
  for (const it of plan.items) {
    const k = STATUS_COUNT[status(it)];
    if (k) counts[k] += 1;
  }
  counts.total = plan.items.length;
  const E = utcDay(plan.basis.edd);
  return {
    E,
    statuses,
    status,
    counts,
    approval: planApproval(plan, { srcT, stdT, patient }),
    next: nextVisitSuggestion(plan, today, statuses),
    postDates: (plan.careType ?? 'antenatal') === 'antenatal' && daysBetween(E, today) >= POST_DATES_DAYS,
  };
}

function templateView(plan, approval, { full }) {
  const a = approval.itemsApproval;
  const base = {
    label: approval.label,
    draftReason: approval.draftReason,
    approved: approval.approved,
    approvedVersion: a?.version ?? null,
    newerApprovedVersion: approval.newerApprovedVersion,
  };
  if (!full) return base;
  const s = plan.source;
  return {
    id: String(s.templateId),
    name: s.templateName,
    kind: s.templateKind,
    ownerName: s.ownerName ?? null,
    version: s.version,
    ...base,
    approvedByName: a?.byName ?? null,
    approvedAt: a?.at ?? null,
    currentVersion: approval.currentVersion,
    updateAvailable: approval.updateAvailable,
    updateApproved: approval.updateApproved,
    newerApprovedByName: approval.newerApproval?.byName ?? null,
    newerApprovedAt: approval.newerApproval?.at ?? null,
  };
}

// When a paused plan was paused: the newest "paused" log entry (the log is kept oldest first). null otherwise.
const pausedAt = (plan) => (plan.status === 'paused' ? ((plan.log ?? []).findLast((l) => l.action === 'paused')?.at ?? null) : null);

const actorView = (r) => (r ? { byName: r.byName, at: r.at } : null);

function itemView(plan, it, { E, statuses }) {
  const a = it.auto ?? {};
  const t = it.timing ?? {};
  const { status, estimateFrom } = statuses.get(it) ?? {};
  const anchor = anchorItem(plan, it);
  return {
    id: itemId(it),
    rev: it.rev ?? 0,
    key: it.key,
    origin: it.origin,
    kind: it.kind,
    name: it.name,
    patientText: it.patientText ?? '',
    source: it.source ?? '',
    appliesWhen: it.appliesWhen ?? 'always',
    timing: {
      atBooking: Boolean(t.atBooking),
      fromWeek: t.fromWeek ?? null,
      toWeek: t.toWeek ?? null,
      after: { key: t.after?.key ?? null, weeks: t.after?.weeks ?? null },
      date: t.date ?? null,
      dateBy: t.dateBy ?? null,
    },
    timingText: timingText(it, plan.items),
    window: a.windowFrom ? { from: a.windowFrom, to: a.windowTo } : null,
    gaWindow: a.windowFrom ? { from: weeksDays(gaOn(E, a.windowFrom)), to: weeksDays(gaOn(E, a.windowTo)) } : null,
    due: a.dueFrom ? { from: a.dueFrom, to: a.dueBy } : null,
    estimateFrom: estimateFrom ?? null,
    dateSource: a.dateSource ?? null,
    status: status ?? null,
    applies: a.applies ?? null,
    why: a.why ?? null,
    riskBased: Boolean(a.riskBased),
    lateStart: a.lateStart ?? null,
    lateFrom: a.lateFrom ?? null,
    flags: [...(a.flags ?? [])],
    anchor: a.anchor ? { state: a.anchor.state, key: a.anchor.key } : null,
    dependsOn: anchor
      ? { id: itemId(anchor), name: anchor.name, state: anchor.state, doneOn: anchor.done?.on ?? null, weeks: t.after?.weeks ?? null }
      : null,
    addedOn: it.addedOn ?? null,
    done: it.done
      ? {
          on: it.done.on,
          gaOn: weeksDays(gaOn(E, it.done.on)),
          elsewhere: Boolean(it.done.elsewhere),
          result: it.done.result ?? '',
          note: it.done.note ?? '',
          via: it.done.via ?? 'manual',
          labOrderId: it.done.labOrderId ? String(it.done.labOrderId) : null,
          ...actorView(it.done),
        }
      : null,
    notNeeded: it.notNeeded ? { reasonCode: it.notNeeded.reasonCode, reason: it.notNeeded.reason ?? '', ...actorView(it.notNeeded) } : null,
    manualDate: it.manualDate
      ? { dueFrom: it.manualDate.dueFrom, dueBy: it.manualDate.dueBy, reason: it.manualDate.reason ?? '', ...actorView(it.manualDate) }
      : null,
    forceInclude: it.forceInclude ? { reason: it.forceInclude.reason, ...actorView(it.forceInclude) } : null,
    note: it.note ? { text: it.note.text, ...actorView(it.note) } : null,
    added: it.added ? { ...actorView(it.added), reason: it.added.reason ?? '' } : null,
    notInTemplate: it.notInTemplate ? { templateName: it.notInTemplate.templateName, version: it.notInTemplate.version } : null,
    // The item it may repeat (the "May repeat …" flag is in flags while it is to be checked)
    possibleDuplicate: it.possibleDuplicate?.withItemId ? { withItemId: String(it.possibleDuplicate.withItemId), withName: it.possibleDuplicate.withName ?? '' } : null,
    history: (it.history ?? []).slice(-20).map((h) => ({
      at: h.at,
      byName: h.byName,
      action: h.action,
      from: withoutIds(h.from ?? null),
      to: withoutIds(h.to ?? null),
      reason: h.reason ?? '',
    })),
  };
}

// ---------- The plan as the Care plan tab sees it ----------

/**
 * PlanView (the Care plan tab). Options:
 *  - today: the hospital's date (hospitalToday(req.now)); now: the moment (for which findings count now);
 *  - patient: for a doctor's risk override (approval label) and the findings ticked for this pregnancy;
 *    srcT / stdT: the plan's template and the hospital standard antenatal template (null if missing);
 *  - access: { edit } from carePlanAccess (editClinical); viewingEarlier: an earlier plan opened with ?planId;
 *  - hasCurrentPlan: whether the patient has a current plan (Reopen is offered only when not).
 */
export function planView(plan, { today, now = null, patient, srcT, stdT, access, viewingEarlier = false, hasCurrentPlan = true }) {
  const s = planState(plan, { today, patient, srcT, stdT });
  const { E } = s;
  const editClinical = Boolean(access?.edit);
  const closed = plan.status === 'closed';
  const canEdit = editClinical && !closed && !viewingEarlier;
  const todayHospital = utcDay(today);

  const neededWhys = new Set(plan.items.filter((it) => it.auto?.phase === 'check').map((it) => it.auto.why));
  const recentFrom = addDays(todayHospital, -RECENT_CHANGES_DAYS);
  const recentChanges = (plan.log ?? [])
    .filter((l) => l.auto && toHospitalDate(l.at) >= recentFrom)
    .slice(-5)
    .reverse()
    .map((l) => ({ at: l.at, action: l.action, text: l.text ?? '' }));

  return {
    id: String(plan._id),
    ...careOf(plan),
    status: plan.status,
    pausedReason: plan.pausedReason ?? null,
    pausedAt: pausedAt(plan),
    closed: plan.closed
      ? { reason: plan.closed.reason, note: plan.closed.note ?? '', auto: Boolean(plan.closed.auto), byName: plan.closed.byName, at: plan.closed.at }
      : null,
    replacesPlanId: plan.replacesPlanId ? String(plan.replacesPlanId) : null,
    today: todayHospital,
    gestationToday: weeksDays(gaOn(E, todayHospital)),
    edd: E,
    eddSource: plan.basis.eddSource,
    dayZero: dayZero(E),
    postDates: s.postDates,
    bookedOn: utcDay(plan.bookedOn),
    bookedAt: weeksDays(gaOn(E, plan.bookedOn)),
    bookedOnSetByName: plan.bookedOnSetBy?.byName ?? null,
    minBookedOn: addDays(dayZero(E), MIN_BOOKING_DAYS),
    eddReview: plan.eddReview ? { fromEdd: plan.eddReview.fromEdd, toEdd: plan.eddReview.toEdd } : null,
    template: templateView(plan, s.approval, { full: true }),
    counts: s.counts,
    missingFacts: MISSING_FACTS.filter(([why]) => neededWhys.has(why)).map(([, label]) => label),
    // Findings ticked for this pregnancy that switch nothing on here, because the plan was built before the
    // template had items for them (the screen offers the plan update)
    findingsWithoutItems: viewingEarlier ? [] : findingsToUpdateFor(plan, { patient, srcT, now, today }),
    recentChanges,
    next: s.next,
    items: plan.items.map((it) => itemView(plan, it, s)),
    log: (plan.log ?? [])
      .slice(-50)
      .reverse()
      .map((l) => ({ at: l.at, byName: l.byName, action: l.action, text: l.text ?? '', auto: Boolean(l.auto) })),
    canEdit,
    canChangePlan: canEdit && plan.status === 'active',
    canClose: editClinical && ['active', 'paused'].includes(plan.status) && !viewingEarlier,
    canReopen: editClinical && closed && !hasCurrentPlan,
    readOnly: !canEdit,
  };
}

// ---------- The short summary (Overview card, and the answer to every plan change) ----------

/**
 * carePlanSummary. plan: the current plan or null. Options as planView, plus earlierCount (closed plans of
 * this patient), lastClosed ({ at, reason } of the newest closed plan, when there is no current plan) and
 * reason (why there is no plan: 'not_started' | 'no_dates' | 'no_delivery' | 'no_birth' | null).
 * eddReview stays a yes/no; eddChange carries its dates ({ fromEdd, toEdd } or null) for the Overview card.
 */
export function carePlanSummary(plan, { today, now = null, patient, srcT, stdT, earlierCount = 0, lastClosed = null, reason = null }) {
  if (!plan) {
    return {
      exists: false,
      planId: null,
      status: null,
      pausedReason: null,
      pausedAt: null,
      eddReview: false,
      eddChange: null,
      postDates: false,
      earlierCount,
      lastClosed: lastClosed ? { at: lastClosed.at, reason: lastClosed.reason } : null,
      template: null,
      counts: null,
      next: null,
      top: [],
      findingsWithoutItems: [],
      reason,
    };
  }
  const s = planState(plan, { today, patient, srcT, stdT });
  const byDueBy = (a, b) => utcDay(a.auto.dueBy) - utcDay(b.auto.dueBy);
  const withStatus = (st) => plan.items.filter((it) => s.status(it) === st && it.auto?.dueBy).sort(byDueBy);
  const top = [...withStatus('overdue'), ...withStatus('due')]
    .slice(0, 4)
    .map((it) => ({ itemId: itemId(it), kind: it.kind, name: it.name, status: s.status(it), dueBy: it.auto.dueBy }));
  return {
    exists: true,
    planId: String(plan._id),
    ...careOf(plan),
    status: plan.status,
    pausedReason: plan.pausedReason ?? null,
    pausedAt: pausedAt(plan),
    eddReview: Boolean(plan.eddReview),
    eddChange: plan.eddReview ? { fromEdd: plan.eddReview.fromEdd, toEdd: plan.eddReview.toEdd } : null,
    postDates: s.postDates,
    earlierCount,
    lastClosed: null,
    template: templateView(plan, s.approval, { full: false }),
    counts: {
      overdue: s.counts.overdue,
      due: s.counts.due,
      needsDecision: plan.items.filter((it) => needsDecision(it, s.status(it))).length,
      missedVisits: s.next.missedVisits,
      done: s.counts.done,
      total: s.counts.total,
    },
    next: { visit: s.next.visit, alsoDue: s.next.alsoDue },
    top,
    findingsWithoutItems: findingsToUpdateFor(plan, { patient, srcT, now, today }),
    reason: null,
  };
}

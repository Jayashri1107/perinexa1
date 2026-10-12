// Words, icons and small date helpers for a patient's care plan (the Overview card and the Care plan tab).
// The server works out every item's status from the hospital's today (plan.today); the browser never works
// statuses out itself – it only turns them into colour + icon + word (brand guide) and short notes.
import {
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarMinus2,
  CalendarOff,
  CalendarX2,
  Check,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CirclePlus,
  CopyPlus,
  FileMinus,
  History,
  Hourglass,
  ListPlus,
  TriangleAlert,
  UserPen,
  X,
} from 'lucide-react';
import { formatDate } from '../../components/ui.jsx';
import { recurrentWorkupOrdinal } from './abortionFormat.js';
import { PREGNANCY_FINDING_LABELS, formatGestation } from './patientFormat.js';

// ---------- Dates (all care-plan dates are UTC midnight, as the server sends them) ----------

const DAY_MS = 86_400_000;
const dayNumber = (d) => Math.floor(new Date(d).getTime() / DAY_MS);

/** The date n days later (a Date at UTC midnight). */
export const addDays = (d, n) => new Date((dayNumber(d) + n) * DAY_MS);

/** "2026-10-12" – for date inputs (value, min, max) and for request bodies. */
export const toDateInput = (d) => (d ? new Date(dayNumber(d) * DAY_MS).toISOString().slice(0, 10) : '');

/** Gestation on a date, from the EDD: { weeks, days }, or null before day 0. */
export function gaOn(edd, d) {
  if (!edd || !d) return null;
  const days = dayNumber(d) - (dayNumber(edd) - 280);
  return days < 0 ? null : { weeks: Math.floor(days / 7), days: days % 7 };
}

/** "18 w 0 d" (empty when unknown – formatGestation shows "—" instead). */
export const gaText = (ga) => (ga ? formatGestation(ga) : '');

// ---------- Which care the plan is for (Version 2: postnatal, newborn, gynaecology, infertility) ----------

/** True for a pregnancy plan (counted from the EDD); other plans count from the delivery, the birth or the start. */
export const isAntenatalPlan = (plan) => !plan?.careType || plan.careType === 'antenatal';

export const PLAN_TITLES = {
  antenatal: 'Antenatal care plan',
  postnatal: 'Postnatal care plan',
  newborn: 'Newborn care and vaccination plan',
  gynaecology: 'Gynaecology care plan',
  infertility: 'Fertility care plan',
  abortion: 'Pregnancy-loss care plan',
};
// Pregnancy-loss care (the Abortion type of care): the plan is built by itself from the date seen, once the type of
// loss is entered in the record's Pregnancy loss section.
export const NO_LOSS_DETAILS = 'No care plan yet. It is built automatically, counted from the date seen, when a doctor or RMO enters the type of loss.';
export const planTitle = (plan) => PLAN_TITLES[plan?.careType ?? 'antenatal'] ?? 'Care plan';

// loss: the day a pregnancy loss was diagnosed (the record's "date seen"). The words do not name the loss: they are
// also printed on the patient's copy of the plan.
const AFTER_WORDS = { delivery: 'after delivery', birth: 'after birth', start: 'since the start', loss: 'since she was seen' };
const START_LABELS = { delivery: 'Delivered', birth: 'Born', start: 'Started', loss: 'Seen' };

/** "18 w 0 d" for a pregnancy; "6 w 2 d after delivery" (birth, since the start) for the other plans. */
export function sinceText(plan, ga) {
  if (!ga) return '';
  return isAntenatalPlan(plan) ? gaText(ga) : `${gaText(ga)} ${AFTER_WORDS[plan.startWord] ?? 'since the start'}`;
}

/** The day the plan counts from, in words: "EDD 1 Mar 2027 (from scan)" or "Delivered 28 Sep 2026". */
export function basisText(plan) {
  if (isAntenatalPlan(plan)) return `EDD ${formatDate(plan.edd)} (${plan.eddSource === 'scan' ? 'from scan' : 'from LMP'})`;
  return `${START_LABELS[plan.startWord] ?? 'Started'} ${formatDate(plan.startOn ?? plan.dayZero)}`;
}

/** The highest week number an item may use: 44 in a pregnancy, 900 (about 17 years) otherwise. */
export const maxPlanWeek = (plan) => (isAntenatalPlan(plan) ? 44 : 900);

/** The last day a date in the plan may fall on: 3 weeks after the EDD, or the end of week 900. */
export const lastPlanDay = (plan) => (isAntenatalPlan(plan) ? addDays(plan.edd, 21) : addDays(plan.dayZero, 7 * 900 + 6));

/** A date range: "12–26 Oct 2026", "28 Sep – 4 Oct 2026", "30 Dec 2026 – 5 Jan 2027", or one day "12 Oct 2026". */
export function windowText(from, to) {
  if (!from) return '';
  if (!to || dayNumber(from) === dayNumber(to)) return formatDate(from);
  const [a, b] = [new Date(from), new Date(to)];
  const fromDay = a.getUTCDate();
  const fromMonth = formatDate(from).split(' ')[1];
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${formatDate(from)} – ${formatDate(to)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${fromDay} ${fromMonth} – ${formatDate(to)}`;
  return `${fromDay}–${formatDate(to)}`;
}

/** How far a date is from the plan's today: "today", "tomorrow", "in 5 days", "yesterday", "22 days ago". */
export function relativeDays(d, today) {
  if (!d || !today) return '';
  const n = dayNumber(d) - dayNumber(today);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// ---------- Status: colour + icon + word (spec §5.7) ----------

export const PLAN_STATUS = {
  overdue: { tone: 'high', icon: CalendarX2, word: 'Overdue' },
  due: { tone: 'due', icon: CalendarDays, word: 'Due now' },
  upcoming: { tone: 'neutral', icon: CalendarClock, word: 'Upcoming' },
  missed: { tone: 'inactive', icon: CalendarMinus2, word: 'Missed' },
  waiting: { tone: 'neutral', icon: Hourglass, word: 'Waiting' },
  check_needed: { tone: 'watch', icon: CircleHelp, word: 'Check needed' },
  decide: { tone: 'watch', icon: History, word: 'Decide' },
  on_hold: { tone: 'inactive', icon: CirclePause, word: 'On hold – EDD to confirm' },
  lapsed: { tone: 'inactive', icon: CalendarOff, word: 'Before booking' },
  done: { tone: 'stable', icon: Check, word: 'Done' },
  not_needed: { tone: 'inactive', icon: Ban, word: 'Not needed' },
  not_applicable: { tone: 'inactive', icon: CircleMinus, word: 'Does not apply' },
  inactive: { tone: 'inactive', icon: CirclePause, word: 'Paused' },
};
// An open item on a closed plan.
const CLOSED_INACTIVE = { tone: 'inactive', icon: X, word: 'Not done (plan closed)' };

/** What "done" means for each type of item. */
export const DONE_WORDS = {
  visit: 'Attended',
  investigation: 'Done',
  scan: 'Done',
  vaccination: 'Given',
  medication: 'Started',
  advice: 'Given',
};

/**
 * The pill for one item: { tone, icon, word } for <StatusPill tone icon>{word}</StatusPill>.
 * item: a PlanView item, or a summary row ({ kind, status }). plan: for the closed-plan wording (optional).
 */
export function statusLook(item, plan) {
  const look = PLAN_STATUS[item.status] ?? { tone: 'neutral', icon: null, word: item.status ?? '—' };
  if (item.status === 'done') return { ...look, word: DONE_WORDS[item.kind] ?? look.word };
  if (item.status === 'inactive' && plan?.status === 'closed') return CLOSED_INACTIVE;
  if (item.status === 'lapsed' && plan && !isAntenatalPlan(plan)) return { ...look, word: 'Before the start' };
  return look;
}

// The count pills on the Overview card and the Care plan tab (keys of carePlanSummary.counts).
export const SUMMARY_COUNTS = [
  { key: 'overdue', tone: 'high', icon: CalendarX2, word: 'Overdue' },
  { key: 'due', tone: 'due', icon: CalendarDays, word: 'Due now' },
  { key: 'needsDecision', tone: 'watch', icon: CircleHelp, word: 'Needs decision' },
  { key: 'missedVisits', tone: 'inactive', icon: CalendarMinus2, word: 'Missed visits' },
];

// ---------- Reasons and labels ----------

// Items answered on the patient's record, not on the plan (the server refuses "Mark done" for them –
// careplans/plansService.js RECORDED_ON_RECORD): the anti-D of pregnancy-loss care is recorded under Pregnancy loss
// in Edit details, and the item stops applying by itself once it is recorded as given or not needed.
export const RECORDED_ON_RECORD = { loss_antid: 'Recorded on her record: Edit details → Pregnancy loss → Anti-D.' };

/** Why an item is waiting, needs a check, or does not apply (the server's `why` codes). */
export const WHY_TEXT = {
  risk_incomplete: 'Risk level is Incomplete',
  risk_may_be_higher: 'Risk level may be higher – information missing',
  rh_unknown: 'Blood group not recorded',
  caesareans_unknown: 'Previous caesareans not recorded',
  conditions_unconfirmed: 'Pre-existing conditions not confirmed',
  only_high_risk: 'Only for high-risk mothers',
  only_rh_negative: 'Only for Rh-negative mothers',
  only_previous_caesarean: 'Only after a previous caesarean',
  only_diabetes: 'Only for pre-existing diabetes',
  only_hypertension: 'Only for chronic high blood pressure',
  // Findings in this pregnancy: the item applies once a doctor or RMO ticks the finding on her record
  only_gdm: 'Only for gestational diabetes – not ticked for this pregnancy',
  only_pregnancy_hypertension: 'Only for high blood pressure in this pregnancy – not ticked',
  only_multiple_pregnancy: 'Only for twins or more – not ticked for this pregnancy',
  only_placenta_praevia: 'Only for a low-lying placenta – not ticked for this pregnancy',
  only_bleeding: 'Only after bleeding in this pregnancy – not ticked',
  only_diabetes_any: 'Only for diabetes (pre-existing or in this pregnancy)',
  only_hypertension_any: 'Only for high blood pressure (chronic or in this pregnancy)',
  // Pregnancy-loss care: from the record's Pregnancy loss section, the obstetric history and the blood group
  only_loss_molar: 'Only after a molar pregnancy',
  only_loss_ectopic_expectant: 'Only for an ectopic pregnancy managed by waiting',
  // After an operation: a salpingotomy (the tube kept) also needs hCG follow-up (NICE NG126) – the doctor includes it
  only_loss_ectopic_hcg: 'Only for an ectopic pregnancy managed by waiting or with methotrexate – after a salpingotomy, include it (NICE NG126)',
  only_loss_recurrent: `Only from the ${recurrentWorkupOrdinal()} loss in Abortions (A), or for a recurrent-loss work-up`,
  only_loss_anti_d_due: 'Only for an Rh-negative woman whose anti-D is not yet recorded as given or not needed',
  only_loss_now: 'Only after a loss cared for now – not for a record that is only for the recurrent-loss work-up',
  loss_management_unknown: 'Management of the ectopic pregnancy not recorded',
  loss_count_unknown: 'Abortions (A) not recorded in the obstetric history',
  loss_count_check: `Abortions (A) is one below the number for the work-up – if this loss is not counted yet, it is the ${recurrentWorkupOrdinal()}: the doctor decides`,
  anchor_waiting: 'Waiting for the item it is timed after',
  anchor_not_needed: 'The item it is timed after is marked not needed',
  anchor_missing: 'The item it is timed after is not in this plan',
  timing_loop: 'Its timing refers back to itself – check the template',
  no_longer_indicated: 'No longer applies since it was included or moved – check it',
  not_in_template: 'No longer in the template – keep it or mark it not needed',
};

/** Not-needed reasons, in the order the dialog lists them. */
export const NOT_NEEDED_REASONS = {
  not_indicated: "Not indicated – doctor's decision",
  declined: 'Patient declined',
  covered: 'Covered by another item',
  window_passed: 'Window passed',
  unavailable: 'Not available here',
  other: 'Other',
};
export const NOT_NEEDED_HINTS = { covered: 'e.g. booster given, booking OGTT' };
/** These reasons need a few words (at least 5 characters). */
export const REASON_REQUIRED = ['not_indicated', 'other'];

/** Why a plan was closed ('new_pregnancy' is set by the EDD decision, never chosen in the Close dialog). */
export const CLOSE_REASONS = {
  delivered: 'Delivered',
  pregnancy_ended: 'Pregnancy ended',
  transferred_out: 'Transferred out',
  care_elsewhere: 'Care continues elsewhere',
  new_pregnancy: 'New pregnancy',
  other: 'Other',
};
export const USER_CLOSE_REASONS = Object.keys(CLOSE_REASONS).filter((r) => r !== 'new_pregnancy');

export const PAUSED_TEXT = {
  care_type_changed: 'the type of care is no longer antenatal. Items can still be marked done; no reminders.',
  no_edd: 'the pregnancy dates were removed.',
};

/** Quick picks for "Include anyway". */
export const INCLUDE_PICKS = ['GDM in this pregnancy', 'High BP in this pregnancy', "Doctor's decision"];

/** Item flags (watch-tone markers, except "No longer applies", which is shown as a Check needed status). */
export const FLAG_LABELS = {
  check_date: 'Check date',
  outside_window: 'Outside guideline window',
  no_longer_indicated: 'No longer applies',
  possible_duplicate: 'May repeat another item',
};

/**
 * "May repeat “Vitamin D test”" – an item a protocol change added while the plan already had one that may be the same
 * (item.possibleDuplicate names it); the short word when the name is not known.
 */
export const repeatLabel = (item) => (item?.possibleDuplicate?.withName ? `May repeat “${item.possibleDuplicate.withName}”` : FLAG_LABELS.possible_duplicate);

/** Plan log entries (plan.log[].action). */
export const LOG_LABELS = {
  created: 'Plan built',
  template_switched: 'Protocol changed',
  template_updated: 'Protocol updated',
  booking_date: 'Booking date changed',
  edd_redated: 'Due dates moved',
  edd_review: 'On hold – EDD changed',
  edd_review_cleared: 'Hold cleared',
  edd_same_pregnancy: 'Same pregnancy confirmed',
  edd_new_pregnancy: 'New pregnancy confirmed',
  paused: 'Paused',
  resumed: 'Resumed',
  closed: 'Plan closed',
  reopened: 'Plan reopened',
  items_apply: 'Items now apply',
  items_no_longer_apply: 'Items no longer apply',
  replaced: 'Replaced by a new plan',
  item_edited: 'Added item edited',
};

/** One line of the plan history: the server's sentence (it already starts with what happened), else the label. */
export const logText = (entry) => entry.text || LOG_LABELS[entry.action] || entry.action;

/** Why an item is kept in a protocol change (the preview's kept[].why), after a " · ". Unknown codes show nothing. */
export const KEPT_WHY = {
  done: 'done',
  not_needed: 'marked not needed',
  moved: 'date moved',
  included: 'included anyway',
  note: 'has a note',
  history: 'changed by staff',
};

/** An item's own history (item.history[].action). */
export const HISTORY_LABELS = {
  done: 'Marked done',
  reopen: 'Reopened',
  not_needed: 'Marked not needed',
  move: 'Date moved',
  reset_date: 'Date reset to the plan',
  include: 'Included anyway',
  remove_include: 'Inclusion removed',
  keep: 'Kept as planned',
  note: 'Note changed',
  edit: 'Edited',
  template_changed: 'Updated from the template',
  kept_not_in_template: 'Kept – no longer in the template',
};

// ---------- Notes under the status pill ----------

// "11–13 w" from the item's window in gestation.
const weeksText = (gw) => (gw ? (gw.from.weeks === gw.to.weeks ? `${gw.from.weeks} w` : `${gw.from.weeks}–${gw.to.weeks} w`) : '');

/**
 * The short line under an item's status, e.g. "by 18 Oct 2026 · 3 days ago", "4 w after Td – dose 1 · about
 * 12 Nov 2026", "Blood group not recorded", "12 Oct 2026 (19 w 2 d) · elsewhere". Empty when there is nothing to add.
 * patient (optional): adds the blood group to "Only for Rh-negative mothers".
 */
export function statusNote(item, plan, patient) {
  const today = plan?.today;
  const due = item.due;
  switch (item.status) {
    case 'overdue':
    case 'due':
      return due ? `by ${formatDate(due.to)} · ${relativeDays(due.to, today)}` : '';
    case 'upcoming':
      return due ? `from ${formatDate(due.from)} · ${relativeDays(due.from, today)}` : '';
    case 'missed':
      return 'later visit started';
    case 'waiting': {
      const d = item.dependsOn;
      const after = d?.weeks ? `${d.weeks} w after ${d.name}` : WHY_TEXT.anchor_waiting;
      return item.estimateFrom ? `${after} · about ${formatDate(item.estimateFrom)}` : after;
    }
    case 'check_needed':
      return WHY_TEXT[item.why] ?? '';
    case 'decide': {
      if (item.why) return WHY_TEXT[item.why] ?? '';
      const win = weeksText(item.gaWindow);
      if (!win) return '';
      if (item.lateFrom === 'added') return `Window ${win} ended before this item was added (${gaText(gaOn(plan?.edd, item.addedOn))})`;
      // The item applies because of a finding in this pregnancy that was ticked after its weeks had passed
      if (item.lateFrom === 'finding') return `Window ${win} ended before the finding was ticked`;
      if (!isAntenatalPlan(plan)) return `Window ${win} ended before the plan started (${sinceText(plan, plan?.bookedAt)})`;
      return `Window ${win} ended before booking at ${gaText(plan?.bookedAt)}`;
    }
    case 'lapsed':
      if (item.lateStart === 'covered') return `Covered by the ${isAntenatalPlan(plan) ? 'booking visit' : 'first visit'} (${formatDate(plan?.bookedOn)})`;
      if (item.lateFrom === 'added') return 'Passed before it was added';
      if (item.lateFrom === 'finding') return 'Passed before the finding was ticked';
      return weeksText(item.gaWindow) ? `Window ${weeksText(item.gaWindow)} ended before ${isAntenatalPlan(plan) ? 'booking' : 'the plan started'}` : '';
    case 'done': {
      const d = item.done;
      if (!d) return '';
      const ga = gaText(d.gaOn);
      return [`${formatDate(d.on)}${ga ? ` (${ga})` : ''}`, d.elsewhere && 'elsewhere', d.via === 'lab' && 'from the lab result'].filter(Boolean).join(' · ');
    }
    case 'not_needed': {
      const n = item.notNeeded;
      if (!n) return '';
      const words = NOT_NEEDED_REASONS[n.reasonCode] ?? '';
      return n.reason ? `${words}: ${n.reason}` : words;
    }
    case 'not_applicable': {
      const why = WHY_TEXT[item.why] ?? '';
      const group = patient?.medical?.bloodGroup;
      return item.why === 'only_rh_negative' && group ? `${why} – blood group ${group}` : why;
    }
    default:
      return '';
  }
}

/**
 * Small markers after an item's name: [{ key, label, icon, tone }] for <StatusPill>.
 * Who moved, included or added it; template changes; draft risk rules; and the watch-tone date flags.
 */
export function itemMarkers(item, plan) {
  const out = [];
  if (item.manualDate) out.push({ key: 'moved', label: `Moved by ${item.manualDate.byName}`, icon: UserPen, tone: 'neutral' });
  if (item.forceInclude) out.push({ key: 'included', label: `Included by ${item.forceInclude.byName}`, icon: CirclePlus, tone: 'neutral' });
  if (item.added) out.push({ key: 'added', label: `Added by ${item.added.byName}`, icon: ListPlus, tone: 'neutral' });
  if (item.notInTemplate) out.push({ key: 'not-in-template', label: 'No longer in the template', icon: FileMinus, tone: 'neutral' });
  if (item.status === 'done' && item.applies === 'no') out.push({ key: 'no-longer-applies', label: 'No longer applies', icon: CircleMinus, tone: 'neutral' });
  if (item.riskBased && plan?.template?.draftReason === 'risk_rules') {
    out.push({ key: 'draft-rules', label: 'Based on draft risk rules', icon: TriangleAlert, tone: 'neutral' });
  }
  const open = !['done', 'not_needed', 'inactive'].includes(item.status);
  for (const f of ['check_date', 'outside_window']) {
    if (open && item.flags?.includes(f)) out.push({ key: f, label: FLAG_LABELS[f], icon: TriangleAlert, tone: 'watch' });
  }
  if (open && item.flags?.includes('possible_duplicate')) out.push({ key: 'possible_duplicate', label: repeatLabel(item), icon: CopyPlus, tone: 'watch' });
  return out;
}

// ---------- The plan as a whole ----------

const RULES_TEXT = 'The risk rules that decide the high-risk items have changed since a doctor last approved them.';

/**
 * The plan's approval state (carePlanSummary.template or PlanView.template):
 * { tone, icon, word, label, reason } – word goes in the pill; label is the visible Draft sentence (or null);
 * reason explains a draft (PlanView gives the template name and version for the fuller sentence).
 */
export function approvalText(template) {
  if (!template) return null;
  if (!template.approved) {
    const reason =
      template.draftReason === 'risk_rules'
        ? RULES_TEXT
        : template.name
          ? `Based on “${template.name}” version ${template.version}, which no doctor has approved yet. Use it only as a reminder; the treating doctor decides.`
          : 'No doctor has approved this content yet. Use it only as a reminder; the treating doctor decides.';
    return { tone: 'watch', icon: TriangleAlert, word: 'Draft', label: template.label ?? 'Draft – not approved for clinical use', reason };
  }
  if (template.newerApprovedVersion) {
    return {
      tone: 'watch',
      icon: History,
      word: `Approved v${template.approvedVersion} – replaced by approved v${template.newerApprovedVersion}`,
      label: null,
      reason: null,
    };
  }
  return { tone: 'stable', icon: Check, word: `Approved · v${template.approvedVersion}`, label: null, reason: null };
}

/**
 * "Next visit: Antenatal visit (16 weeks) · 7–27 Sep 2026 · also due: Repeat Hb, Td – dose 2" (empty if none).
 * At most 3 "also due" names, then "and 12 more", so a late booking with many open items stays one short line.
 */
export function nextVisitText(next, maxAlso = 3) {
  if (!next?.visit) return '';
  const names = (next.alsoDue ?? []).map((i) => i.name);
  const also = names.length > maxAlso ? `${names.slice(0, maxAlso).join(', ')} and ${names.length - maxAlso} more` : names.join(', ');
  return [`Next visit: ${next.visit.name}`, windowText(next.visit.dueFrom, next.visit.dueBy), also ? `also due: ${also}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** "Rh-negative items can't be decided: blood group not recorded." – one sentence per missing fact (PlanView.missingFacts). */
export const MISSING_FACT_TEXT = {
  'Blood group': "Rh-negative items can't be decided: blood group not recorded.",
  'Risk level (Incomplete)': "High-risk items can't be decided: risk level is Incomplete.",
  'Risk level (Moderate – may be higher)': "High-risk items can't be decided: the risk level may be higher – some information is missing.",
  'Previous caesareans': "Items after a caesarean can't be decided: previous caesareans not recorded.",
  'Pre-existing conditions': "Items for diabetes or high blood pressure can't be decided: pre-existing conditions not confirmed.",
  // Pregnancy-loss care
  'Management of the ectopic pregnancy': "The beta hCG follow-up can't be decided: the management of the ectopic pregnancy is not recorded.",
  'Abortions (A) in the obstetric history': "The recurrent-loss work-up can't be decided: Abortions (A) is not recorded in the obstetric history.",
  'Whether this loss is counted in Abortions (A)': `The recurrent-loss work-up is for the doctor to decide: Abortions (A) is one below the number it starts from – if this loss is not counted yet, it is the ${recurrentWorkupOrdinal()}.`,
};

// ---------- The items table on the Care plan tab ----------

/** What a person recorded: 'open', 'done' or 'not_needed' (PlanView says it with the done / notNeeded records). */
export const itemState = (item) => (item.done ? 'done' : item.notNeeded ? 'not_needed' : 'open');

const KEEPABLE_FLAGS = ['check_date', 'no_longer_indicated', 'possible_duplicate'];
/** "Keep as planned" clears these flags (the server refuses it otherwise). */
export const canKeep = (item) => itemState(item) === 'open' && (item.flags ?? []).some((f) => KEEPABLE_FLAGS.includes(f));
/** "Include anyway": an open item that does not (or may not) apply and is not included yet. */
export const canInclude = (item) => itemState(item) === 'open' && item.applies !== 'yes' && !item.forceInclude;

// Flags that ask a person to look again (the server's needsDecision count uses the same list).
const ASKING_FLAGS = ['check_date', 'possible_duplicate'];

/**
 * Needs a doctor's decision: Decide, Check needed, a moved date to check, or an added item that may repeat another –
 * the same rule as the server's count.
 */
export function needsDecision(item) {
  if (item.status === 'decide' || item.status === 'check_needed') return true;
  // A date moved outside the guideline window (with the doctor's reason) is already decided: only a date that
  // an automatic change may have made wrong ("Check date") asks again.
  return item.status !== 'inactive' && itemState(item) === 'open' && (item.flags ?? []).some((f) => ASKING_FLAGS.includes(f));
}

/** The three views of the table (kept in the web address as ?view=). */
export const PLAN_VIEWS = [
  { key: 'todo', label: 'To do' },
  { key: 'done', label: 'Done & not needed' },
  { key: 'all', label: 'All' },
];

/**
 * The count chips on the Care plan tab. Each sets the table's status filter (?status=) and the view it shows in.
 * Keys match carePlanSummary.counts, so the chips and the Overview card count the same things.
 */
export const STATUS_FILTERS = {
  overdue: { view: 'todo', word: 'Overdue', match: (it) => it.status === 'overdue' },
  due: { view: 'todo', word: 'Due now', match: (it) => it.status === 'due' },
  needsDecision: { view: 'todo', word: 'Needs decision', match: needsDecision },
  missedVisits: { view: 'all', word: 'Missed visits', match: (it) => it.status === 'missed' },
  done: { view: 'done', word: 'Done', match: (it) => itemState(it) === 'done' },
};

/** The same counts as carePlanSummary.counts, from a PlanView (after a change the tab has the plan, not the summary). */
export function planCounts(plan) {
  const c = plan.counts ?? {};
  return {
    overdue: c.overdue ?? 0,
    due: c.due ?? 0,
    needsDecision: (plan.items ?? []).filter(needsDecision).length,
    missedVisits: c.missed ?? 0,
    done: c.done ?? 0,
    total: c.total ?? 0,
  };
}

// Statuses with their own folded section under the table in the To do view.
const FOLDED = ['missed', 'not_applicable', 'lapsed'];

const time = (d) => (d ? new Date(d).getTime() : Infinity);
/** When an item starts: its due-from date, or the estimate for an item waiting on another one. */
export const startOf = (item) => item.due?.from ?? item.estimateFrom ?? null;
const byStart = (a, b) => time(startOf(a)) - time(startOf(b)) || a.name.localeCompare(b.name);
// Done or not needed: the date it was done, or when it was marked not needed.
const recordedOn = (item) => item.done?.on ?? item.notNeeded?.at ?? null;

/** Stages for the All view, by the effective due-from. */
export const STAGES = [
  { key: 'booking', label: 'At booking' },
  { key: 't1', label: 'First trimester (to 13 w 6 d)' },
  { key: 't2', label: 'Second trimester (14–27 w)' },
  { key: 't3', label: 'Third trimester (28 w onwards)' },
  { key: 'after', label: 'Timed after another item' },
];

/** The stages of the other plans (postnatal, newborn, gynaecology, fertility), by weeks from the start. */
export const OTHER_STAGES = [
  { key: 'booking', label: 'At the start' },
  { key: 'w6', label: 'First 6 weeks' },
  { key: 'y1', label: 'Up to 1 year' },
  { key: 'later', label: 'After 1 year' },
  { key: 'after', label: 'Timed after another item' },
];
export const stagesOf = (plan) => (isAntenatalPlan(plan) ? STAGES : OTHER_STAGES);

export function stageOf(item, plan) {
  if (item.timing?.atBooking) return 'booking';
  const from = item.due?.from;
  if (!from && item.timing?.after?.key) return 'after';
  const weeks = from ? (gaOn(plan.edd, from)?.weeks ?? 0) : (item.timing?.fromWeek ?? 0);
  if (!isAntenatalPlan(plan)) {
    if (weeks <= 6) return 'w6';
    return weeks <= 52 ? 'y1' : 'later';
  }
  if (weeks <= 13) return 't1';
  return weeks <= 27 ? 't2' : 't3';
}

const itemRow = (item, decision = false) => ({ type: 'item', key: item.id, item, decision });

/**
 * The rows of the items table: { type: 'group', key, label } | { type: 'today', key } | { type: 'item', key, item, decision }.
 * - To do: first "Needs a decision" (rows with quick actions), then the other open items by date with the Today
 *   divider between those starting on or before today and later ones. Missed, Does not apply and Before booking
 *   items have their own folded sections, unless a status filter asks for them.
 * - Done & not needed: newest first.
 * - All: grouped by stage.
 * kind: '' or an item kind; status: '' or a key of STATUS_FILTERS.
 */
export function planRows(plan, { view = 'todo', kind = '', status = '' } = {}) {
  const match = STATUS_FILTERS[status]?.match;
  const items = (plan.items ?? []).filter((it) => (!kind || it.kind === kind) && (!match || match(it)));

  if (view === 'done') {
    return items
      .filter((it) => itemState(it) !== 'open')
      .sort((a, b) => time(recordedOn(b)) - time(recordedOn(a)) || a.name.localeCompare(b.name))
      .map((it) => itemRow(it));
  }

  if (view === 'all') {
    const rows = [];
    for (const stage of stagesOf(plan)) {
      const inStage = items.filter((it) => stageOf(it, plan) === stage.key).sort(byStart);
      if (!inStage.length) continue;
      rows.push({ type: 'group', key: `stage-${stage.key}`, label: stage.label });
      rows.push(...inStage.map((it) => itemRow(it)));
    }
    return rows;
  }

  const open = items.filter((it) => itemState(it) === 'open' && (match || !FOLDED.includes(it.status)));
  const decision = open.filter(needsDecision).sort(byStart);
  const rest = open.filter((it) => !needsDecision(it)).sort(byStart);
  const rows = [];
  if (decision.length) {
    rows.push({ type: 'group', key: 'decision', label: 'Needs a decision' });
    rows.push(...decision.map((it) => itemRow(it, true)));
    if (rest.length) rows.push({ type: 'group', key: 'by-date', label: 'By date' });
  }
  const today = time(plan.today);
  const later = rest.findIndex((it) => time(startOf(it)) > today);
  rest.forEach((it, i) => {
    if (i === later && i > 0) rows.push({ type: 'today', key: 'today' });
    rows.push(itemRow(it));
  });
  return rows;
}

/** Open items for the folded sections under the To do table: { missed, notApplicable, lapsed }, each by date. */
export function foldedItems(plan, { kind = '' } = {}) {
  const open = (plan.items ?? []).filter((it) => itemState(it) === 'open' && (!kind || it.kind === kind));
  const withStatus = (s) => open.filter((it) => it.status === s).sort(byStart);
  return { missed: withStatus('missed'), notApplicable: withStatus('not_applicable'), lapsed: withStatus('lapsed') };
}

/**
 * The warning (not a block) in the Mark done dialog for an item timed after another one:
 * "Td – dose 1 was given on 15 Oct 2026; Td – dose 2 is usually 4 w later (from 12 Nov 2026)." or
 * "Td – dose 1 is not marked done yet." Empty when the date fits. on: 'YYYY-MM-DD' (the date being entered).
 */
export function afterItemWarning(item, plan, on) {
  const d = item.dependsOn;
  if (!d) return '';
  if (d.state !== 'done' || !d.doneOn) return `${d.name} is not marked done yet.`;
  const from = addDays(d.doneOn, 7 * (d.weeks ?? 0));
  if (on && dayNumber(on) >= dayNumber(from)) return '';
  const anchor = (plan?.items ?? []).find((i) => i.id === d.id);
  const word = (DONE_WORDS[anchor?.kind] ?? 'Done').toLowerCase();
  return `${d.name} was ${word} on ${formatDate(d.doneOn)}; ${item.name} is usually ${d.weeks} w later (from ${formatDate(from)}).`;
}

/** When the plan was paused (PlanView and carePlanSummary both carry pausedAt), or null. */
export const pausedOn = (plan) => plan?.pausedAt ?? null;

/** How far the EDD moved, in whole weeks: "16 weeks", "1 week" (empty when a date is missing). */
export function eddShiftText(fromEdd, toEdd) {
  if (!fromEdd || !toEdd) return '';
  const weeks = Math.round(Math.abs(dayNumber(toEdd) - dayNumber(fromEdd)) / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/**
 * The protocol preview to show and apply in Change protocol: only the answer for the protocol chosen now.
 * useFetch keeps its last answer while the next one loads and after it fails, so that answer may be the
 * preview of a protocol looked at before. fetched: { data, loading, error } from useFetch.
 */
export const previewFor = (fetched, chosen) =>
  !fetched.loading && !fetched.error && chosen && fetched.data?.to?.id === chosen ? fetched.data : null;

/**
 * Whether the tab's last loaded answer is for another plan than the web address asks for (after ?planId=
 * changed, while the new one loads or when it failed). With ?planId= the plan must be that one; without it,
 * the current plan is never a closed one.
 */
export const answerIsForOtherPlan = (data, plan, planId) => Boolean(data) && (planId ? plan?.id !== planId : plan?.status === 'closed');

/**
 * Findings ticked for this pregnancy that her plan has no items for (PlanView.findingsWithoutItems): the plan was
 * built from an older version of its template, from before the template had items for them, so the tick switched
 * nothing on. Plans keep the version they were built from until a doctor or RMO updates each plan – the screen
 * says so and offers the update. Returns { found, why, draft } in plain words, or null when there are none.
 * draft: the sentence to add when her plan is approved now and the newer version is a draft no doctor has
 * approved (null otherwise – a plan that is a draft already loses nothing by the update).
 */
export function findingsWithoutItemsText(plan) {
  const list = (plan?.findingsWithoutItems ?? []).map((k) => PREGNANCY_FINDING_LABELS[k] ?? k);
  if (!list.length) return null;
  const t = plan.template ?? {};
  const them = list.length === 1 ? 'it' : 'them';
  return {
    found: `Ticked on her record: ${list.join(', ')}.`,
    why: `This plan was built from an older version of “${t.name}” (version ${t.version}), which had no items for ${them} – so the plan shows none. Update the plan to add them.`,
    draft: t.approved && !t.updateApproved ? 'The newer version is a draft that no doctor has approved yet: after the update her plan is marked as a draft until a doctor approves the template.' : null,
  };
}

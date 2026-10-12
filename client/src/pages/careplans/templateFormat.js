// Labels and helpers for care-plan templates.
import { CalendarCheck, FlaskConical, MessageSquareText, Pill, ScanLine, Star, Syringe, TriangleAlert } from 'lucide-react';
import { recurrentWorkupOrdinal } from '../patients/abortionFormat.js';
import { addDays, windowText } from '../patients/carePlanFormat.js';

export const ITEM_KIND_LABELS = {
  visit: 'Visit',
  investigation: 'Lab test',
  scan: 'Scan',
  vaccination: 'Vaccination',
  medication: 'Medicine',
  advice: 'Advice',
};
export const ITEM_KINDS = Object.keys(ITEM_KIND_LABELS);

// Icons for the neutral item-type tags (a type is a category, not a clinical status, so no status colour).
export const ITEM_KIND_ICONS = {
  visit: CalendarCheck,
  investigation: FlaskConical,
  scan: ScanLine,
  vaccination: Syringe,
  medication: Pill,
  advice: MessageSquareText,
};

export const APPLIES_LABELS = {
  always: 'All patients',
  high_risk: 'High-risk only',
  rh_negative: 'Rh-negative only',
  previous_caesarean: 'Previous caesarean only',
  // Pre-existing conditions only (as they always were); findings in this pregnancy have their own choices below.
  diabetes: 'Pre-existing diabetes only',
  hypertension: 'Chronic high blood pressure only',
  // Findings a doctor or RMO ticked on the record for this pregnancy
  gdm: 'Gestational diabetes (GDM) only',
  pregnancy_hypertension: 'High blood pressure in this pregnancy only',
  multiple_pregnancy: 'Twins or more only',
  placenta_praevia: 'Low-lying placenta / praevia only',
  bleeding: 'Bleeding in this pregnancy only',
  // Either the pre-existing condition or the finding in this pregnancy
  diabetes_any: 'Any diabetes (pre-existing or GDM)',
  hypertension_any: 'Any high blood pressure (chronic or in this pregnancy)',
  // Pregnancy-loss care (from the record's Pregnancy loss section)
  loss_molar: 'Pregnancy loss: molar pregnancy only',
  loss_ectopic_expectant: 'Pregnancy loss: ectopic managed by waiting only',
  loss_ectopic_hcg: 'Pregnancy loss: ectopic managed by waiting or with methotrexate',
  loss_recurrent: `Pregnancy loss: recurrent-loss work-up (from the ${recurrentWorkupOrdinal()} loss)`,
  loss_anti_d_due: 'Pregnancy loss: Rh-negative, anti-D not yet recorded',
  loss_now: 'Pregnancy loss: a loss cared for now (not a recurrent-loss work-up only)',
};

const countWords = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const listWords = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

/**
 * The offer of newer built-in DRAFT content on a standard template's page (template.builtInUpdates from the
 * server: the names of the risk rules and items that would be added, and the items whose "for which patients"
 * would change), in words: { counts, about, after, lines }, or null when there is nothing to offer.
 * lines lists everything "Add as a new draft" does – it adds or changes nothing that is not listed.
 */
export function builtInOfferText(offer, careType) {
  const rules = offer?.riskRules ?? [];
  const items = offer?.items ?? [];
  const changes = offer?.changes ?? [];
  if (!rules.length && !items.length && !changes.length) return null;
  return {
    counts: listWords(
      [
        rules.length && countWords(rules.length, 'risk rule', 'risk rules'),
        items.length && countWords(items.length, 'schedule item', 'schedule items'),
        changes.length && countWords(changes.length, 'changed item', 'changed items'),
      ].filter(Boolean),
    ),
    about:
      careType === 'antenatal'
        ? `for findings in this pregnancy (gestational diabetes, high blood pressure, twins, low-lying placenta, bleeding)${rules.length ? ' and for the measured haemoglobin and blood pressure' : ''}`
        : 'so that the checks after delivery also apply after high blood pressure or diabetes found in the pregnancy',
    after: rules.length
      ? 'Risk levels are worked out again and marked as based on draft rules until a doctor approves the template.'
      : "Patients' plans keep the version they were built from until a doctor updates each plan.",
    lines: [
      ...rules.map((label) => `Risk rule: ${label}`),
      ...items.map((name) => `Item: ${name}`),
      ...changes.map((c) => `Item changed: ${c.name} – for “${APPLIES_LABELS[c.to] ?? c.to}” instead of “${APPLIES_LABELS[c.from] ?? c.from}”`),
    ],
  };
}

export const CARE_TYPE_TEMPLATE_LABELS = {
  antenatal: 'Antenatal',
  postnatal: 'Postnatal',
  infertility: 'Infertility',
  gynaecology: 'Gynaecology',
  newborn: 'Newborn',
  abortion: 'Abortion', // pregnancy loss (the short word of the Patients list)
};

// Timing in the house gestation shorthand: "12 w", "11–13 w", "2 w after “Anomaly scan”".
// Templates store whole (completed) weeks, so no days are shown. An item a doctor added to one patient's plan
// can have fixed dates instead: "12–26 Oct 2026". Takes a template item (timing fields on the item) or a
// plan item (the same fields under `timing`, plus date and dateBy).
export function timingText(item, items = []) {
  const t = item.timing ?? item;
  if (t.atBooking) return 'At first visit';
  if (t.after?.key) {
    const ref = items.find((i) => i.key === t.after.key);
    return `${t.after.weeks} w after “${ref?.name ?? t.after.key}”`;
  }
  if (t.fromWeek == null && t.date) return windowText(t.date, t.dateBy ?? addDays(t.date, 6));
  if (t.fromWeek == null) return '—';
  return t.fromWeek === (t.toWeek ?? t.fromWeek) ? `${t.fromWeek} w` : `${t.fromWeek}–${t.toWeek} w`;
}

// Groups items by stage for display: by trimester for a pregnancy; for pregnancy-loss care by the weeks since the
// loss was seen (never "trimester" there). The other types of care keep the headings they always had.
const STAGE_TITLES = {
  booking: 'At the first visit (booking)',
  t1: 'First trimester (up to 13 w)',
  t2: 'Second trimester (14–27 w)',
  t3: 'Third trimester (28 w onwards)',
  after: 'Timed after another item',
};
const LOSS_STAGE_TITLES = { booking: 'At the first visit', t1: 'In the first 13 weeks', t2: 'Weeks 14 to 27', t3: 'From 28 weeks', after: 'Timed after another item' };
export function groupByStage(items, careType = 'antenatal') {
  const titles = careType === 'abortion' ? LOSS_STAGE_TITLES : STAGE_TITLES;
  const groups = ['booking', 't1', 't2', 't3', 'after'].map((key) => ({ key, title: titles[key], items: [] }));
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const it of items) {
    if (it.atBooking) byKey.booking.items.push(it);
    else if (it.after?.key) byKey.after.items.push(it);
    else if (it.fromWeek <= 13) byKey.t1.items.push(it);
    else if (it.fromWeek <= 27) byKey.t2.items.push(it);
    else byKey.t3.items.push(it);
  }
  for (const g of groups) g.items.sort((a, b) => (a.fromWeek ?? 0) - (b.fromWeek ?? 0));
  return groups.filter((g) => g.items.length);
}

export const templateOwnerLabel = (t, meId) =>
  t.kind === 'standard' ? 'Hospital standard' : t.owner === meId ? 'My protocol' : `${t.ownerName ?? 'Doctor'}'s protocol`;

// ---------- Use, default protocol and "update all plans" (5 Oct 2026) ----------

const plansWord = (n) => countWords(n, 'current plan', 'current plans');

/** "Used by 12 current plans", "Used by 1 current plan", "Not used by any current plan" (template.usedBy: a count only). */
export const usedByText = (n) => (n ? `Used by ${plansWord(n)}` : 'Not used by any current plan');

const CARE_WORDS = { antenatal: 'antenatal', postnatal: 'postnatal', infertility: 'fertility', gynaecology: 'gynaecology', newborn: 'newborn', abortion: 'pregnancy-loss' };
/** "antenatal care", "pregnancy-loss care" … (a template's type of care inside a sentence). */
export const careWords = (careType) => `${CARE_WORDS[careType] ?? careType} care`;

// Why a doctor's default protocol is not used for new plans now (template.defaultState from the server).
const NOT_IN_USE_WHY = {
  draft: 'this version is a draft',
  no_items: 'it has no items',
  owner_inactive: 'its doctor no longer works here as a doctor',
};

/**
 * The marker beside a protocol that is its doctor's default (the template list): { tone, icon, word } for a
 * StatusPill, or null. A default not used now (a draft …) is a watch status, with its reason in the title.
 */
export function defaultPill(t, meId) {
  if (!t?.ownerDefault || t.kind !== 'personal') return null;
  const mine = t.owner === meId;
  if (t.defaultState === 'in_use') return { tone: 'neutral', icon: Star, word: mine ? 'My default' : 'Default', title: null };
  return { tone: 'watch', icon: TriangleAlert, word: 'Default – not in use', title: `Not used for new plans: ${NOT_IN_USE_WHY[t.defaultState] ?? 'not approved'}` };
}

/**
 * What the template page says about a protocol that is its doctor's default: { type: 'info' | 'warning', text }, or
 * null. For its own doctor: whose new plans start from it, or why they do not now; for everyone else: whose default it is.
 */
export function defaultNotice(t, meId) {
  if (!t?.ownerDefault || t.kind !== 'personal') return null;
  const mine = t.owner === meId;
  const care = careWords(t.careType);
  const whose = mine ? 'the patients assigned to you' : `the patients assigned to ${t.ownerName ?? 'this doctor'}`;
  if (t.defaultState === 'in_use') {
    return {
      type: 'info',
      text: `${mine ? 'This is your default protocol' : `This is ${t.ownerName ?? 'the doctor'}'s default protocol`} for ${care}: new care plans of ${whose} start from it. Plans that already exist do not change.`,
    };
  }
  const why = NOT_IN_USE_WHY[t.defaultState] ?? 'it is not approved';
  const until = t.defaultState === 'draft' ? (mine ? ' until you approve this version' : ' until it is approved again') : '';
  return {
    type: 'warning',
    text: `${mine ? 'This is your default protocol' : `This is ${t.ownerName ?? 'the doctor'}'s default protocol`} for ${care}, but ${why}. New care plans of ${whose} start from the hospital standard template${until}.`,
  };
}

/** The doctor's own defaults that are not used now (for the warning on the template list). */
export const myDefaultsNotInUse = (templates, meId) => (templates ?? []).filter((t) => t.kind === 'personal' && t.ownerDefault && t.owner === meId && t.defaultState !== 'in_use');

/** The warning on the template list for one of those: "Your default protocol “X” is not in use: …". */
export function notInUseText(t) {
  const why = NOT_IN_USE_WHY[t.defaultState] ?? 'it is not approved';
  return `Your default protocol “${t.name}” for ${careWords(t.careType)} is not in use: ${why}. New care plans of your patients start from the hospital standard template${t.defaultState === 'draft' ? ' until you approve it' : ''}.`;
}

/**
 * The template page's "Patients' plans" lines (counts only): how many current plans use it, how many of those are on
 * an older version, and what can be done about it.
 */
export function plansUseText(t) {
  const lines = [`${usedByText(t.usedBy ?? 0)}.`];
  if (t.olderVersion) lines.push(`${countWords(t.olderVersion, 'of them uses', 'of them use')} an older version.`);
  return lines.join(' ');
}

// Where a plan's items that need a decision are listed besides its Care plan tab: Today's "Care plan to act on" lists
// pregnancy care and pregnancy-loss care.
const ON_TODAY = ['antenatal', 'abortion'];

// An item that may repeat another: where it is marked, and what the doctor does with it.
const repeatWhere = (careType) =>
  `It is marked “May repeat” on the patient's Care plan tab and counted under Needs decision${ON_TODAY.includes(careType) ? ' (also on Today, under “Care plan to act on”)' : ''}: keep it, or mark one of the two not needed.`;

/**
 * The preview of "Update all plans" in words (GET …/plans-update, counts only): { summary, lines, items, warnings },
 * or null before it is loaded. Every number is the server's – the screen adds nothing of its own.
 */
export function plansUpdateText(p) {
  if (!p) return null;
  const { plans, items, template } = p;
  const lines = [];
  if (plans.otherDoctors) {
    lines.push(
      `${countWords(plans.otherDoctors, "plan is of another doctor's patient", "plans are of other doctors' patients")}: the patient's own doctor or an RMO updates ${plans.otherDoctors === 1 ? 'it' : 'them'} on the patient's Care plan tab.`,
    );
  }
  if (plans.notUsable) {
    const one = plans.notUsable === 1;
    lines.push(
      `${countWords(plans.notUsable, 'plan is of a patient now assigned to another doctor', 'plans are of patients now assigned to other doctors')}, who cannot use this protocol, so ${one ? 'it is' : 'they are'} not updated. The patient's doctor can switch ${one ? 'it' : 'each plan'} to the hospital standard template or to their own protocol on the patient's Care plan tab.`,
    );
  }
  if (plans.paused) lines.push(`${countWords(plans.paused, 'plan is paused', 'plans are paused')}: a paused plan is updated on the patient's Care plan tab once it is active again.`);
  if (plans.later) lines.push(`${countWords(plans.later, 'more plan', 'more plans')} can be updated afterwards, with this button again (at most ${plans.toUpdate} at a time).`);
  const from = (plans.fromVersions ?? []).map((v) => `version ${v.version} (${countWords(v.plans, 'plan', 'plans')})`);
  const changes = [
    `${countWords(items.added, 'item', 'items')} added`,
    `${countWords(items.changed, 'item', 'items')} changed`,
    `${countWords(items.removed, 'item', 'items')} removed (not started)`,
  ];
  const warnings = [];
  if (items.kept) warnings.push(`${countWords(items.kept, 'item is', 'items are')} no longer in the template but kept, because staff recorded something on ${items.kept === 1 ? 'it' : 'them'}.`);
  if (items.needsDecision) warnings.push(`${countWords(items.needsDecision, 'added item needs', 'added items need')} a decision on the patient's plan: ${items.needsDecision === 1 ? 'its' : 'their'} time has passed.`);
  if (items.plansWithPossibleDuplicates) {
    const one = items.plansWithPossibleDuplicates === 1;
    warnings.push(`${countWords(items.plansWithPossibleDuplicates, 'plan gets', 'plans get')} an item that may repeat one ${one ? 'it' : 'they'} already ${one ? 'has' : 'have'}. ${repeatWhere(template.careType)}`);
  }
  return {
    summary: plans.behind
      ? `${countWords(plans.behind, 'current plan uses', 'current plans use')} an older version than version ${template.version}. You can update ${plans.toUpdate ? countWords(plans.toUpdate, 'plan', 'plans') : 'none of them'} now.`
      : `Every current plan already uses version ${template.version}.`,
    from: from.length ? `From ${listWords(from)}.` : '',
    items: plans.toUpdate ? `In the ${countWords(plans.toUpdate, 'plan', 'plans')} you update: ${listWords(changes)}.` : '',
    lines,
    warnings,
  };
}

/**
 * What "Update all plans" did, for the message on the template page (POST …/plans-update → result). careType: the
 * template's type of care (where items to check are listed).
 */
export function plansUpdateResultText(r, version, careType = null) {
  const parts = [r.updated ? `${countWords(r.updated, 'plan', 'plans')} updated to version ${version}.` : 'No plan was updated.'];
  if (r.withPossibleDuplicates) {
    parts.push(`${countWords(r.withPossibleDuplicates, 'of them got', 'of them got')} an item that may repeat one ${r.withPossibleDuplicates === 1 ? 'it' : 'they'} already had. ${repeatWhere(careType)}`);
  }
  if (r.alreadyUpdated) parts.push(`${countWords(r.alreadyUpdated, 'plan was', 'plans were')} already updated.`);
  if (r.notUpdated) parts.push(`${countWords(r.notUpdated, 'plan was', 'plans were')} changed or closed meanwhile and left as ${r.notUpdated === 1 ? 'it was' : 'they were'} – update ${r.notUpdated === 1 ? 'it' : 'them'} on the patient's Care plan tab if needed.`);
  if (r.failed) {
    parts.push(`${countWords(r.failed, 'plan', 'plans')} could not be updated and ${r.failed === 1 ? 'was' : 'were'} left as ${r.failed === 1 ? 'it was' : 'they were'}: update ${r.failed === 1 ? 'it' : 'them'} one by one on the patient's Care plan tab, which says why.`);
  }
  if (r.otherDoctors) parts.push(`${countWords(r.otherDoctors, "plan of another doctor's patient was", "plans of other doctors' patients were")} left for the patient's own doctor.`);
  if (r.notUsable) {
    parts.push(`${countWords(r.notUsable, 'plan of a patient now assigned to another doctor was', 'plans of patients now assigned to other doctors were')} left as ${r.notUsable === 1 ? 'it was' : 'they were'}: the patient's doctor can switch ${r.notUsable === 1 ? 'it' : 'them'} to the hospital standard template or their own protocol.`);
  }
  if (r.paused) parts.push(`${countWords(r.paused, 'paused plan was', 'paused plans were')} left as ${r.paused === 1 ? 'it was' : 'they were'}.`);
  if (r.remaining) parts.push(`${countWords(r.remaining, 'more plan', 'more plans')} can be updated with the button again.`);
  return parts.join(' ');
}

/** The message after a doctor makes this protocol their default (on) or stops using it (off). */
export const defaultChangedText = (t, on) =>
  on
    ? `New ${careWords(t.careType)} plans of the patients assigned to you now start from “${t.name}”. Plans that already exist do not change.`
    : `“${t.name}” is no longer your default. New ${careWords(t.careType)} plans of your patients start from the hospital standard template. Plans that already exist do not change.`;

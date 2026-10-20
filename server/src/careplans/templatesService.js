import { ANTENATAL_DRAFT, FINDING_ITEM_KEYS, FINDING_RULE_KEYS, RISK_RULES_VERSION } from './antenatalDraft.js';
import { backfillApproval, itemsHash } from './hashes.js';
import { readingsFor, setReadings } from './readings.js';
import { RISK_ENGINE_VERSION, assessRisk, effectiveLevel, nextAgeChange, overrideNeedsReview } from './risk.js';
import { AuditLog } from '../models/AuditLog.js';
import { CarePlanTemplate } from '../models/CarePlanTemplate.js';
import { Patient } from '../models/Patient.js';
import { config } from '../config.js';
import { sharedAcrossCopies, takeTurn } from '../utils/sharedState.js';
import { ABORTION_DRAFT, GYNAECOLOGY_DRAFT, INFERTILITY_DRAFT, NEWBORN_DRAFT, POSTNATAL_DRAFT, POSTNATAL_FINDING_CHANGES } from './otherDrafts.js';

// One built-in DRAFT per type of care. A hospital that does not have the standard template of a type yet (a type
// added later, such as pregnancy-loss care) gets it as a draft on its next request – ensureStandardTemplates below.
const BUILT_IN = { antenatal: ANTENATAL_DRAFT, postnatal: POSTNATAL_DRAFT, newborn: NEWBORN_DRAFT, gynaecology: GYNAECOLOGY_DRAFT, infertility: INFERTILITY_DRAFT, abortion: ABORTION_DRAFT };
const builtInAudit = (tenantId, t, action, note) =>
  AuditLog.create({ action, tenantId, actorEmail: 'system (built-in rules)', details: { templateId: t._id.toString(), name: t.name, version: t.version, note } });

/**
 * Templates approved before approvals were recorded (Feature 7) get their approval written down once, per
 * hospital, before any care plan is read: every patient route calls ensureStandardTemplates first.
 * The write only happens if no approval was recorded meanwhile; it raises the version key (__v), so an edit
 * saved from an older copy at the same moment is refused instead of losing the approval.
 */
const approvalsBackfilled = new Set(); // hospitals already checked since the server started

async function backfillApprovals(tenantId) {
  const key = String(tenantId);
  if (approvalsBackfilled.has(key)) return;
  const old = await CarePlanTemplate.find({ tenantId, status: 'approved', 'approvals.0': { $exists: false } });
  for (const t of old) {
    if (!backfillApproval(t)) continue; // approved at an older version: not trusted
    await CarePlanTemplate.updateOne(
      { _id: t._id, tenantId, 'approvals.0': { $exists: false } },
      { $set: { approvals: t.toObject().approvals }, $inc: { __v: 1 } },
      { timestamps: false },
    );
  }
  approvalsBackfilled.add(key);
}
export const resetApprovalBackfill = () => {
  approvalsBackfilled.clear();
  additionsChecked.clear();
};

// Built-in content added or changed after hospitals already had their standard templates. Each addition is
// recorded on the template (builtInAdditions) once it has been dealt with, so it is never added again after a
// doctor removes it.
//  - newborn_tests (auto: 'always'): added once to the hospital's newborn template (the items it does not have
//    yet), which makes it a new draft version for a doctor to approve; patients' plans take them when moved to
//    the new version (Care plan tab).
//  - pregnancy_findings_items and pregnancy_findings_rules: items and risk rules for findings in this pregnancy.
//  - postnatal_after_findings: the postnatal BP check and sugar test now also apply after high blood pressure or
//    diabetes found IN the pregnancy (itemChanges: the item's "for which patients" as the built-in draft had it
//    before, and has it now).
//    These three are stricter. By themselves they only reach content no doctor has made their own:
//      · items are added or changed only in a template that is still the untouched built-in draft – never
//        approved, its risk rules not edited, and its items exactly the built-in ones (untouchedDraft: judged by
//        the CONTENT, never by the name of who changed it last, which built-in upgrades themselves write);
//      · the risk rules arrive with the built-in rules upgrade (ensureStandardTemplates): only where the template
//        was never approved and no doctor has edited the rules.
//    Everything else – a template a doctor has approved (even if it is a draft again now) or edited – is never
//    changed by an upgrade: its page offers what is missing, and a doctor adds it as a new draft version
//    (pendingBuiltIn, addPendingBuiltIn).
const BUILT_IN_ADDITIONS = [
  { key: 'newborn_tests', careType: 'newborn', itemKeys: ['nb_lab_screening', 'nb_cchd', 'nb_hearing'], auto: 'always' },
  { key: 'pregnancy_findings_items', careType: 'antenatal', itemKeys: FINDING_ITEM_KEYS },
  { key: 'pregnancy_findings_rules', careType: 'antenatal', ruleKeys: FINDING_RULE_KEYS },
  { key: 'postnatal_after_findings', careType: 'postnatal', itemChanges: POSTNATAL_FINDING_CHANGES },
];

/** No doctor has ever approved this template (at any version). */
const neverApproved = (t) => t.status !== 'approved' && !t.approvals?.length && t.approvedVersion == null;

// The built-in items of a type of care as they were before the additions in `pending` (keys of
// BUILT_IN_ADDITIONS): without the items those added, and with the items those changed as they were.
function builtInItemsBefore(careType, pending) {
  let items = BUILT_IN[careType].items;
  for (const a of BUILT_IN_ADDITIONS) {
    if (a.careType !== careType || !pending.has(a.key)) continue;
    if (a.itemKeys) items = items.filter((i) => !a.itemKeys.includes(i.key));
    if (a.itemChanges) items = items.map((i) => ({ ...i, ...(a.itemChanges.find((c) => c.key === i.key)?.from ?? {}) }));
  }
  return items;
}

/**
 * True if the template's items are exactly the built-in draft's (as it was before the additions this template
 * has not had yet). The comparison is by content (the items' fingerprint): who saved the template last says
 * nothing, because built-in upgrades write that name themselves.
 */
function itemsAreBuiltIn(t) {
  if (!BUILT_IN[t.careType]) return false;
  const done = new Set(t.builtInAdditions ?? []);
  const pending = new Set(BUILT_IN_ADDITIONS.filter((a) => a.careType === t.careType && !done.has(a.key)).map((a) => a.key));
  return itemsHash(t.items) === itemsHash(builtInItemsBefore(t.careType, pending));
}

/** Still the built-in draft as the software made it: never approved by a doctor, items exactly the built-in ones. */
const untouchedDraft = (t) => neverApproved(t) && itemsAreBuiltIn(t);

const additionsChecked = new Set(); // hospital + addition already checked since the server started

async function addBuiltInItems(tenantId, addition) {
  const done = `${tenantId}:${addition.key}`;
  if (additionsChecked.has(done)) return;
  const t = await CarePlanTemplate.findOne({ tenantId, careType: addition.careType, kind: 'standard' });
  if (!t || (t.builtInAdditions ?? []).includes(addition.key)) {
    if (t) additionsChecked.add(done);
    return;
  }
  backfillApproval(t); // keep a record of an earlier approval before it becomes a draft
  const have = new Set(t.items.map((i) => i.key));
  const items = BUILT_IN[addition.careType].items.filter((i) => addition.itemKeys.includes(i.key) && !have.has(i.key));
  t.builtInAdditions = [...(t.builtInAdditions ?? []), addition.key];
  if (items.length) {
    t.items.push(...items);
    t.version += 1;
    t.status = 'draft';
    t.updatedByName = 'Built-in items added';
  }
  try {
    await t.save();
  } catch (e) {
    if (e?.name === 'VersionError') return; // another request added them at the same moment
    throw e;
  }
  additionsChecked.add(done);
  if (items.length) await builtInAudit(tenantId, t, 'TEMPLATE_UPDATED', t.updatedByName);
}

// Applies everything pendingBuiltIn found to the template (in memory): the missing items and risk rules are
// added after the template's own, and the changed items get the built-in draft's new values. Existing rules are
// never touched here.
function applyPending(t, pending) {
  if (pending.items.length) t.items.push(...pending.items);
  if (pending.riskRules.length) {
    if (!t.riskRules) t.riskRules = [];
    t.riskRules.push(...pending.riskRules);
  }
  for (const c of pending.changes) Object.assign(t.items.find((i) => i.key === c.key), c.to);
  t.builtInAdditions = [...(t.builtInAdditions ?? []), ...pending.additions];
}

/**
 * A standard template other than the antenatal one (which has its own, stricter upgrade below) that is still
 * the untouched built-in draft gets the newer built-in items by itself, once: a new draft version, audited.
 * A template a doctor has approved or edited is left alone – its page offers the change.
 */
async function upgradeUntouchedDraft(tenantId, careType) {
  const done = `${tenantId}:${careType}:untouched`;
  if (additionsChecked.has(done)) return;
  const t = await CarePlanTemplate.findOne({ tenantId, careType, kind: 'standard' });
  if (!t) return;
  const pending = pendingBuiltIn(t);
  if (pending && untouchedDraft(t)) {
    applyPending(t, pending);
    t.version += 1;
    t.updatedByName = 'Built-in items updated';
    try {
      await t.save();
    } catch (e) {
      if (e?.name === 'VersionError') return; // another request upgraded it at the same moment
      throw e;
    }
    await builtInAudit(tenantId, t, 'TEMPLATE_UPDATED', t.updatedByName);
  }
  additionsChecked.add(done);
}

/**
 * Makes sure the hospital has its standard templates (exactly one per type of care – a unique index
 * prevents duplicates even if two requests arrive at once), and keeps the built-in draft content current:
 *  - a standard template from before risk rules existed gets the draft rules (and needs re-approval if it
 *    had been approved);
 *  - a standard template that still has older built-in draft rules, was NEVER approved and whose rules no
 *    doctor has edited, gets the newer draft rules;
 *  - a template that is still the untouched built-in draft gets the newer built-in items (once): the antenatal
 *    items for findings in this pregnancy, the postnatal items that now follow those findings.
 * A template a doctor has approved is never changed here – not while it is approved, and not after an edit made
 * it a draft again (its rules were reviewed by a doctor; replacing them would put unreviewed rules under the
 * next approval). Neither are rules or items a doctor has edited. The template's page offers the newer built-in
 * content and a doctor adds it as a new draft version (addPendingBuiltIn).
 * Risk rules are only used on the hospital standard template (not on doctors' personal protocols).
 */
export async function ensureStandardTemplates(tenantId) {
  for (const [careType, draft] of Object.entries(BUILT_IN)) {
    await CarePlanTemplate.updateOne(
      { tenantId, careType, kind: 'standard' },
      {
        // tenantId, careType and kind come from the filter. Timestamps are set here (only on insert) so that
        // this check never changes "last changed" on an existing template.
        $setOnInsert: {
          ...draft,
          status: 'draft',
          version: 1,
          updatedByName: 'Built-in draft',
          builtInRulesVersion: RISK_RULES_VERSION,
          builtInAdditions: BUILT_IN_ADDITIONS.filter((a) => a.careType === careType).map((a) => a.key),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, timestamps: false },
    ).catch((e) => {
      if (e?.code !== 11000) throw e; // another request created it at the same moment
    });
  }

  await backfillApprovals(tenantId);
  for (const addition of BUILT_IN_ADDITIONS.filter((a) => a.auto === 'always')) await addBuiltInItems(tenantId, addition);
  const others = new Set(BUILT_IN_ADDITIONS.filter((a) => a.auto !== 'always' && a.careType !== 'antenatal').map((a) => a.careType));
  for (const careType of others) await upgradeUntouchedDraft(tenantId, careType);

  const std = await CarePlanTemplate.findOne({ tenantId, careType: 'antenatal', kind: 'standard' });
  if (!std) return;
  // Record an older approval before the upgrade below can make the template a draft again.
  const backfilled = Boolean(backfillApproval(std));
  // Never approved by a doctor (worked out after an older approval was written down just above).
  const fresh = neverApproved(std);
  // The version of the built-in rules it has; null = a doctor has edited the rules (field missing = created
  // before versions were tracked).
  const builtIn = std.riskRules === undefined ? null : (std.builtInRulesVersion ?? (std.updatedByName?.startsWith('Built-in') ? 1 : null));
  const rulesUnedited = std.riskRules === undefined || builtIn !== null;
  const dealtWith = (key) => (std.builtInAdditions ?? []).includes(key);
  // Still the untouched built-in draft: never approved, rules not edited, items exactly the built-in ones (their
  // content is only compared while the items for findings have not been dealt with – this runs on every request).
  const untouched = !dealtWith('pregnancy_findings_items') && fresh && rulesUnedited && itemsAreBuiltIn(std);
  const record = (key) => {
    if (!dealtWith(key)) std.builtInAdditions = [...(std.builtInAdditions ?? []), key];
  };
  let note = null; // what changed (the template then gets a new version)
  let recorded = false; // only an addition was written down as dealt with (nothing to add)
  if (std.riskRules === undefined) {
    std.riskRules = ANTENATAL_DRAFT.riskRules;
    std.builtInRulesVersion = RISK_RULES_VERSION;
    if (std.status === 'approved') std.status = 'draft';
    record('pregnancy_findings_rules');
    note = 'Built-in draft risk rules added';
  } else if (builtIn !== null && builtIn < RISK_RULES_VERSION && fresh) {
    // Older built-in rules that no doctor has edited or approved: replaced by the current built-in draft rules.
    std.riskRules = ANTENATAL_DRAFT.riskRules;
    std.builtInRulesVersion = RISK_RULES_VERSION;
    record('pregnancy_findings_rules');
    note = 'Built-in draft risk rules updated';
  }
  // Built-in items for findings in this pregnancy: by themselves only into the untouched built-in draft.
  if (untouched) {
    const have = new Set(std.items.map((i) => i.key));
    const items = ANTENATAL_DRAFT.items.filter((i) => FINDING_ITEM_KEYS.includes(i.key) && !have.has(i.key));
    record('pregnancy_findings_items');
    recorded = true;
    if (items.length) {
      std.items.push(...items);
      note = note ? 'Built-in draft risk rules and items updated' : 'Built-in items added';
    }
  }
  if (note) {
    std.version += 1;
    std.updatedByName = note;
  }
  if (note || backfilled || recorded) {
    try {
      await std.save();
    } catch (e) {
      if (e?.name === 'VersionError') return; // another request upgraded it at the same moment
      throw e;
    }
    if (!note) return; // only an older approval, or an addition with nothing to add, was written down
    await builtInAudit(tenantId, std, 'TEMPLATE_UPDATED', std.updatedByName);
    await recalculateForTemplate(std);
  }
}

/**
 * Built-in content a hospital's standard template does not have and has not been offered before (see
 * BUILT_IN_ADDITIONS): { additions: [keys], items, riskRules, changes }, or null when there is nothing to offer.
 *  - items, riskRules: built-in ones the template does not have (by key);
 *  - changes: [{ key, name, from, to }] – a template item that still says what the built-in draft said before
 *    (`from`), where the draft now says `to`. An item a doctor has already changed or removed is left out.
 * Shown on the template's page to doctors; nothing is added or changed until a doctor asks for it.
 */
export function pendingBuiltIn(t) {
  if (t.kind !== 'standard') return null;
  const draft = BUILT_IN[t.careType];
  if (!draft) return null;
  const done = new Set(t.builtInAdditions ?? []);
  const haveItems = new Map((t.items ?? []).map((i) => [i.key, i]));
  const haveRules = new Set((t.riskRules ?? []).map((r) => r.key));
  const out = { additions: [], items: [], riskRules: [], changes: [] };
  for (const a of BUILT_IN_ADDITIONS) {
    if (a.careType !== t.careType || done.has(a.key)) continue;
    const items = draft.items.filter((i) => (a.itemKeys ?? []).includes(i.key) && !haveItems.has(i.key));
    const riskRules = (draft.riskRules ?? []).filter((r) => (a.ruleKeys ?? []).includes(r.key) && !haveRules.has(r.key));
    const changes = [];
    for (const c of a.itemChanges ?? []) {
      const mine = haveItems.get(c.key);
      const now = draft.items.find((i) => i.key === c.key);
      if (!mine || !now) continue;
      const fields = Object.keys(c.from);
      if (!fields.every((f) => mine[f] === c.from[f]) || fields.every((f) => now[f] === c.from[f])) continue;
      changes.push({ key: c.key, name: mine.name, from: { ...c.from }, to: Object.fromEntries(fields.map((f) => [f, now[f]])) });
    }
    if (!items.length && !riskRules.length && !changes.length) continue;
    out.additions.push(a.key);
    out.items.push(...items);
    out.riskRules.push(...riskRules);
    out.changes.push(...changes);
  }
  return out.additions.length ? out : null;
}

/**
 * A doctor adds the offered built-in content to the standard template (in memory; the caller saves, audits
 * and recalculates): exactly what the offer listed – the missing items and risk rules are added after the
 * template's own, and the listed items are changed – which makes a new DRAFT version that a doctor must
 * approve. Nothing else is touched: every rule and item the template already has stays as the doctor approved
 * or edited it (older built-in rules are NOT brought up to the current built-in text – the offer does not list
 * that, and a doctor would be approving changes nobody showed them). Returns what was added, or null if nothing.
 */
export function addPendingBuiltIn(t, byName) {
  const pending = pendingBuiltIn(t);
  if (!pending) return null;
  backfillApproval(t); // keep a record of an earlier approval before the template becomes a draft
  applyPending(t, pending);
  t.version += 1;
  t.status = 'draft';
  t.updatedByName = byName;
  return pending;
}

/** The template whose risk rules apply: always the hospital's standard antenatal template. */
export async function riskTemplateFor(patient) {
  await ensureStandardTemplates(patient.tenantId);
  return CarePlanTemplate.findOne({ tenantId: patient.tenantId, careType: 'antenatal', kind: 'standard' });
}

/**
 * Recalculates the stored risk of one patient (in memory). A doctor's override is always kept – also when
 * the care type is temporarily not antenatal – so it can't be lost by changing the type of care.
 * Returns { changed, from, to } for the level that is shown (null when not antenatal).
 */
export function applyRisk(patient, template, now = new Date()) {
  const before = patient.risk?.level ?? null;
  const override = patient.risk?.override ?? null;
  if (patient.careType !== 'antenatal') {
    patient.risk = {
      level: null,
      computedLevel: null,
      reasons: [],
      missing: [],
      notMeasured: [],
      findingsNotChecked: [],
      readingsNotChecked: [],
      mayBeHigher: false,
      freeTextNotChecked: false,
      overrideNeedsReview: false,
      recheckAt: null,
      rulesChecked: 0,
      engineVersion: RISK_ENGINE_VERSION,
      computedAt: now,
      override,
    };
  } else {
    const a = assessRisk(patient, template, now);
    const risk = { ...a, override, level: override?.level ?? a.computedLevel, recheckAt: nextAgeChange(patient, now) };
    risk.overrideNeedsReview = overrideNeedsReview(risk);
    patient.risk = risk;
  }
  const after = patient.risk.level ?? null;
  return { changed: before !== after, from: before, to: after };
}

/**
 * applyRisk, after reading the readings of this pregnancy again (lowest haemoglobin, latest blood pressure –
 * careplans/readings.js) from her visits and reviewed lab results. In memory; the caller saves.
 */
export async function applyCurrentRisk(patient, template, now = new Date()) {
  if (patient.careType === 'antenatal') {
    const readings = await readingsFor(patient.tenantId, [patient], now);
    setReadings(patient, readings.get(String(patient._id)) ?? null);
  }
  return applyRisk(patient, template, now);
}

// The stored risk without the moment it was worked out (to see whether anything really changed).
const riskSnapshot = (patient) => {
  const { computedAt: _computedAt, ...rest } = patient.toObject().risk ?? {};
  return JSON.stringify(rest);
};

/**
 * Works a patient's risk level out again after something outside her record changed: a visit's vital signs
 * were saved, a visit was marked entered in error, a lab result was reviewed or changed after its review.
 * Saved only when the readings or the result changed (so nothing is written for a visit without new values).
 * A doctor's override is kept, as always. Nothing is audited here: the action that led to it is (hospital
 * admins read the audit log, and even "the level changed" is medical information).
 * If it cannot be saved (other saves kept getting in first), the record is marked as due (markRiskDue).
 * ctx: { tenantId, now }. Returns { changed: the level shown changed, saved, patient }.
 */
export async function refreshPatientRisk(ctx, patientId) {
  const now = ctx.now ?? new Date();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const patient = await Patient.findOne({ _id: patientId, tenantId: ctx.tenantId });
    if (!patient || patient.careType !== 'antenatal') return { changed: false, saved: false, patient };
    const template = await riskTemplateFor(patient);
    const before = riskSnapshot(patient);
    const readingsBefore = JSON.stringify(patient.toObject().pregnancy?.readings ?? null);
    const result = await applyCurrentRisk(patient, template, now);
    if (riskSnapshot(patient) === before && JSON.stringify(patient.toObject().pregnancy?.readings ?? null) === readingsBefore) {
      return { changed: false, saved: false, patient };
    }
    try {
      await patient.save();
      return { changed: result.changed, saved: true, patient };
    } catch (e) {
      if (e?.name !== 'VersionError') throw e; // someone saved the record at the same moment: read it again
    }
  }
  await markRiskDue(ctx.tenantId, patientId, now);
  return { changed: false, saved: false, patient: null };
}

/**
 * The risk level could not be worked out again although a reading changed (the visit or the lab review is saved
 * already): the record is marked as due, so the next read of the record or of a patient list works the level out
 * again (riskIsStale, refreshDueRisks) instead of leaving the old level until someone happens to save another
 * reading. Never throws.
 */
async function markRiskDue(tenantId, patientId, now) {
  try {
    await Patient.updateOne({ _id: patientId, tenantId, careType: 'antenatal' }, { $set: { 'risk.recheckAt': now } }, { timestamps: false });
  } catch (err) {
    console.error('Marking the risk level as due failed', err?.message ?? err);
  }
}

/** refreshPatientRisk that never fails its caller (the visit or the lab result is already saved). */
export async function refreshPatientRiskSafely(ctx, patientId) {
  try {
    return await refreshPatientRisk(ctx, patientId);
  } catch (err) {
    console.error('Risk level after a new reading failed', err?.message ?? err);
    await markRiskDue(ctx.tenantId, patientId, ctx.now ?? new Date());
    return { changed: false, saved: false, patient: null };
  }
}

/** True if the stored risk may be out of date: never worked out, rules/approval changed, or the age changed. */
export function riskIsStale(patient, template, now = new Date()) {
  if (patient.careType !== 'antenatal') return false;
  const r = patient.risk;
  if (!r?.computedAt) return true;
  if (r.engineVersion !== RISK_ENGINE_VERSION) return true; // worked out by older risk logic
  if (template && (String(r.templateId) !== String(template._id) || r.templateVersion !== template.version || r.templateApproved !== (template.status === 'approved'))) {
    return true;
  }
  return Boolean(r.recheckAt && new Date(r.recheckAt) <= now);
}

/**
 * Recalculates many patients with bulk writes. Each write only succeeds if the patient hasn't changed since
 * it was read (version check), so an override or edit saved at the same moment is never overwritten; any
 * skipped patient is picked up by the next refreshDueRisks because its stored template version stays old.
 */
async function recalculateMany(template, filter, now) {
  let checked = 0;
  let changed = 0;
  let skipped = 0;
  let batch = [];
  // A batch at a time: the readings of this pregnancy (visits, reviewed lab results) are read for the whole
  // batch in two queries, then each patient is worked out and written.
  const flush = async () => {
    if (!batch.length) return;
    const readings = await readingsFor(filter.tenantId, batch, now);
    const ops = batch.map((p) => {
      const version = p.__v ?? 0;
      if (p.careType === 'antenatal') setReadings(p, readings.get(String(p._id)) ?? null);
      const r = applyRisk(p, template, now);
      if (r.changed) changed += 1;
      const stored = p.toObject();
      return {
        updateOne: {
          filter: { _id: p._id, tenantId: p.tenantId, __v: version },
          update: { $set: { risk: stored.risk, 'pregnancy.readings': stored.pregnancy?.readings ?? null }, $inc: { __v: 1 } },
          timestamps: false,
        },
      };
    });
    const res = await Patient.bulkWrite(ops, { ordered: false });
    skipped += ops.length - (res.matchedCount ?? ops.length);
    batch = [];
  };
  for await (const p of Patient.find(filter).cursor()) {
    checked += 1;
    batch.push(p);
    if (batch.length >= 200) await flush();
  }
  await flush();
  return { checked, changed, skipped };
}

/** After the standard template's rules or approval change: recalculates every antenatal patient. */
export async function recalculateForTemplate(template, now = new Date()) {
  if (template.kind !== 'standard' || template.careType !== 'antenatal') return { checked: 0, changed: 0, skipped: 0 };
  return recalculateMany(template, { tenantId: template.tenantId, careType: 'antenatal' }, now);
}

/**
 * Brings stored risk levels up to date for patients that are due: never worked out, worked out by older
 * risk logic, based on an older version or approval state of the rules, or whose age has changed. Used
 * before lists and counts so the risk filter and dashboard don't depend on someone opening each record.
 * The first refresh after the server starts is waited for. After that (RISK_REFRESH_IN_BACKGROUND, the default
 * outside tests), a refresh that is due runs in the background and lists answer at once with the levels of a
 * minute ago, so many people opening the worklist together never all wait for it (load test, 20 Oct 2026). With
 * several copies of the server, only one copy refreshes each round. The time is only recorded after success.
 */
const SKIPPED = Object.freeze({ checked: 0, changed: 0, skipped: 0 });
const lastRefresh = new Map(); // tenant -> time of the last successful refresh
const inFlight = new Map(); // tenant -> promise of the refresh running now

async function runDueRefresh(tenantId, now) {
  await ensureStandardTemplates(tenantId);
  const std = await CarePlanTemplate.findOne({ tenantId, careType: 'antenatal', kind: 'standard' });
  if (!std) return { checked: 0, changed: 0, skipped: 0 };
  return recalculateMany(
    std,
    {
      tenantId,
      careType: 'antenatal',
      $or: [
        { 'risk.computedAt': null },
        { 'risk.computedAt': { $exists: false } },
        { 'risk.engineVersion': { $ne: RISK_ENGINE_VERSION } },
        { 'risk.templateId': { $ne: std._id } },
        { 'risk.templateVersion': { $ne: std.version } },
        { 'risk.templateApproved': { $ne: std.status === 'approved' } },
        { 'risk.recheckAt': { $lte: now } },
      ],
    },
    now,
  );
}

export async function refreshDueRisks(tenantId, now = new Date(), { minIntervalMs = 60_000 } = {}) {
  const key = String(tenantId);
  const background = config.RISK_REFRESH_IN_BACKGROUND && lastRefresh.has(key);
  if (inFlight.has(key)) return background ? SKIPPED : inFlight.get(key);
  if (minIntervalMs && now - (lastRefresh.get(key) ?? 0) < minIntervalMs) return SKIPPED;
  const run = (async () => {
    // Several copies: one refreshes this round; the others carry on with the levels as they are
    if (minIntervalMs && sharedAcrossCopies() && !(await takeTurn(`risk-refresh:${key}`, minIntervalMs))) return SKIPPED;
    return runDueRefresh(tenantId, now);
  })()
    .then((r) => {
      lastRefresh.set(key, Date.now());
      return r;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  if (!background) return run;
  run.catch((err) => console.error('Risk levels: background refresh failed:', err?.message ?? err));
  return SKIPPED;
}
export const resetRiskRefreshTimer = () => lastRefresh.clear();

export { effectiveLevel };

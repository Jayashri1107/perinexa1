// Content fingerprints and approvals for care-plan templates (pure, no database).
//
// A plan remembers the fingerprint ("hash") of the template items it was built from. A doctor's approval
// records the fingerprints of the content they approved. So a plan counts as approved exactly when a
// doctor approved that same content – even if the template was edited and later changed back – and never
// just because a template's status says "approved".

import { createHash } from 'node:crypto';

// Empty values all count as "nothing", so '' and null and a missing field give the same fingerprint.
const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Fingerprint of a template's items (their order does not matter). Only what changes the care counts;
 * the template's name and description do not. Schema defaults are applied first (atBooking false,
 * appliesWhen 'always'), so the built-in list and the same list saved in the database match.
 */
export function itemsHash(items = []) {
  const rows = (items ?? []).map((it) =>
    [
      it.key,
      it.kind,
      it.name,
      it.patientText,
      Boolean(it.atBooking),
      it.fromWeek,
      it.toWeek,
      it.after?.key,
      it.after?.weeks,
      it.appliesWhen ?? 'always',
      it.source,
    ].map(norm),
  );
  return sha256(rows.sort(byKey));
}

/**
 * Fingerprint of the risk rules (order does not matter); null when there are none (personal protocols).
 * A rule's finding (rules on a finding in this pregnancy) is added to its row only when it has one, so the
 * fingerprint of rules approved before such rules existed stays exactly the same.
 */
export function rulesHash(riskRules) {
  if (!riskRules?.length) return null;
  const rows = riskRules.map((r) => {
    const row = [r.key, r.label, r.factor, r.op, r.value, r.condition, r.complication, r.level, r.source].map(norm);
    if (norm(r.finding) !== null) row.push(r.finding);
    return row;
  });
  return sha256(rows.sort(byKey));
}

// The approval a template approved before approvals were recorded would have had. Only trusted when the
// approved version is the current one: a template left "approved" by an older race is not.
function legacyApproval(t) {
  if (t.approvals?.length || t.status !== 'approved' || t.approvedVersion !== t.version) return null;
  return {
    version: t.version,
    itemsHash: itemsHash(t.items),
    rulesHash: rulesHash(t.riskRules),
    by: t.approvedBy ?? null,
    byName: t.approvedByName ?? null,
    at: t.approvedAt ?? null,
  };
}

/**
 * Writes the approval of a template approved before Feature 7 into t.approvals (in memory; the caller saves).
 * Does nothing when approvals are already recorded or the old approval can't be trusted. Safe to repeat.
 * Returns the entry added, or null.
 */
export function backfillApproval(t) {
  const entry = legacyApproval(t);
  if (!entry) return null;
  if (!t.approvals) t.approvals = [];
  t.approvals.push(entry);
  return entry;
}

/** The template's approvals, including the not-yet-written one above (never based on the status alone). */
export function approvalsOf(t) {
  if (!t) return [];
  const legacy = legacyApproval(t);
  return legacy ? [legacy] : [...(t.approvals ?? [])];
}

/** A doctor approved exactly the template's current items (never judged by its status alone). */
export function contentApproved(t) {
  const h = itemsHash(t?.items);
  return approvalsOf(t).some((a) => a.itemsHash === h);
}

/**
 * A plan's approval state, worked out on every read (nothing is stored):
 *  - srcT: the template the plan was built from; stdT: the hospital's standard antenatal template
 *    (its risk rules decide the high-risk items); patient: for a doctor's risk override.
 * Returns { approved, itemsApproval, label, draftReason, currentHash, currentVersion, updateAvailable,
 *           updateApproved, newerApprovedVersion, newerApproval (the approval of the newer version, or null) }.
 */
export function planApproval(plan, { srcT, stdT, patient }) {
  const itemsApproval = approvalsOf(srcT).filter((a) => a.itemsHash === plan.source.itemsHash).at(-1) ?? null;
  const usesRisk = (plan.items ?? []).some((it) => it.auto?.riskBased);
  const stdRules = stdT ? rulesHash(stdT.riskRules) : null;
  const rulesApproved =
    !usesRisk || Boolean(patient?.risk?.override) || (Boolean(stdT) && approvalsOf(stdT).some((a) => a.rulesHash === stdRules));
  const approved = Boolean(itemsApproval) && rulesApproved;
  const currentHash = srcT ? itemsHash(srcT.items) : null;
  const updateAvailable = Boolean(srcT) && currentHash !== plan.source.itemsHash;
  const newerApproval = updateAvailable ? (approvalsOf(srcT).filter((a) => a.itemsHash === currentHash).at(-1) ?? null) : null;
  const updateApproved = Boolean(newerApproval);
  return {
    approved,
    itemsApproval,
    label: approved ? null : 'Draft – not approved for clinical use',
    draftReason: approved ? null : !itemsApproval ? 'content' : 'risk_rules',
    currentHash,
    currentVersion: srcT?.version ?? null,
    updateAvailable,
    updateApproved,
    newerApprovedVersion: updateApproved ? srcT.version : null,
    newerApproval,
  };
}

import { Router } from 'express';
import { z } from 'zod';
import { defaultStates } from '../careplans/defaultProtocol.js';
import { backfillApproval, contentApproved, itemsHash, rulesHash } from '../careplans/hashes.js';
import { planCtx, previewPlansUpdate, templateUsage, updatePlansToTemplate } from '../careplans/plansService.js';
import { RISK_FACTORS, RISK_LEVELS, RISK_OPS } from '../careplans/risk.js';
import { addPendingBuiltIn, ensureStandardTemplates, pendingBuiltIn, recalculateForTemplate } from '../careplans/templatesService.js';
import { APPLIES_WHEN, CarePlanTemplate, ITEM_KINDS, TEMPLATE_CARE_TYPES } from '../models/CarePlanTemplate.js';
import { CONDITIONS, PAST_COMPLICATIONS } from '../models/Patient.js';
import { PREGNANCY_FINDINGS } from '../patients/pregnancyFindings.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../utils/pcpndt.js';
import { idParams, objectId, parse } from '../utils/validate.js';

// Who can use care-plan templates: doctors and RMOs work with them, nurses can view them.
const VIEWERS = ['doctor', 'rmo', 'nurse'];

// Antenatal templates keep to 44 weeks of pregnancy (checked where the type of care is known); others to 900 weeks.
const week = (label) => z.union([z.null(), z.coerce.number().int(`${label} must be a whole number`).min(0, `${label} can't be below 0`).max(900, `${label} can't be above 900`)]);
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
// Template text is copied into patients' pregnancy records, so it must never mention the baby's sex (PCPNDT Act).
const noFetalSex = (schema) => schema.refine((t) => !mentionsFetalSex(t), PCPNDT_MESSAGE);

const itemSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Each item needs a short code')
      .max(60)
      .regex(/^[a-z0-9_]+$/, 'Codes can only use lower-case letters, numbers and _'),
    kind: z.enum(ITEM_KINDS, 'Choose what kind of item this is'),
    name: noFetalSex(z.string().trim().min(1, 'Each item needs a name').max(200)),
    patientText: noFetalSex(z.string().trim().max(300)).default(''),
    atBooking: z.boolean().default(false),
    fromWeek: z.preprocess(emptyToNull, week('From week')).default(null),
    toWeek: z.preprocess(emptyToNull, week('To week')).default(null),
    after: z
      .object({ key: z.preprocess(emptyToNull, z.union([z.string().trim().max(60), z.null()])).default(null), weeks: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int().min(1).max(520)])).default(null) })
      .default({ key: null, weeks: null }),
    appliesWhen: z.enum(APPLIES_WHEN).default('always'),
    source: noFetalSex(z.string().trim().max(400)).default(''),
  })
  .superRefine((it, ctx) => {
    const hasWindow = it.fromWeek != null || it.toWeek != null;
    const hasAfter = Boolean(it.after?.key);
    const timings = [it.atBooking, hasWindow, hasAfter].filter(Boolean).length;
    if (timings === 0) ctx.addIssue({ code: 'custom', path: ['fromWeek'], message: 'Choose when this is due: at booking, a week range, or after another item' });
    if (timings > 1) ctx.addIssue({ code: 'custom', path: ['fromWeek'], message: 'Choose only one way of timing this item' });
    if (hasWindow && (it.fromWeek == null || it.toWeek == null)) ctx.addIssue({ code: 'custom', path: ['toWeek'], message: 'Give both "from" and "to" weeks' });
    if (hasWindow && it.fromWeek != null && it.toWeek != null && it.toWeek < it.fromWeek) {
      ctx.addIssue({ code: 'custom', path: ['toWeek'], message: '"To" week must not be before "from" week' });
    }
    if (hasAfter && !it.after.weeks) ctx.addIssue({ code: 'custom', path: ['after', 'weeks'], message: 'How many weeks after?' });
  });

const riskRuleSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Each rule needs a short code')
      .max(60)
      .regex(/^[a-z0-9_]+$/, 'Codes can only use lower-case letters, numbers and _'),
    label: noFetalSex(z.string().trim().min(1, 'Each rule needs a name').max(150)),
    factor: z.enum(Object.keys(RISK_FACTORS), 'Choose what the rule checks'),
    op: z.preprocess(emptyToNull, z.union([z.null(), z.enum(RISK_OPS)])).default(null),
    value: z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number('Value must be a number').min(0, "Value can't be negative").max(500, 'Value is too high')])).default(null),
    condition: z.preprocess(emptyToNull, z.union([z.null(), z.enum(CONDITIONS)])).default(null),
    complication: z.preprocess(emptyToNull, z.union([z.null(), z.enum(PAST_COMPLICATIONS)])).default(null),
    finding: z.preprocess(emptyToNull, z.union([z.null(), z.enum(PREGNANCY_FINDINGS)])).default(null),
    level: z.enum(RISK_LEVELS, 'Choose high or moderate'),
    source: noFetalSex(z.string().trim().max(400)).default(''),
  })
  .superRefine((r, ctx) => {
    const type = RISK_FACTORS[r.factor]?.type;
    if (type === 'number') {
      if (!r.op) ctx.addIssue({ code: 'custom', path: ['op'], message: 'Choose a comparison' });
      if (r.value === null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a value' });
    }
    if (type === 'condition' && !r.condition) ctx.addIssue({ code: 'custom', path: ['condition'], message: 'Choose the condition' });
    if (type === 'complication' && !r.complication) ctx.addIssue({ code: 'custom', path: ['complication'], message: 'Choose the previous-pregnancy problem' });
    if (type === 'finding' && !r.finding) ctx.addIssue({ code: 'custom', path: ['finding'], message: 'Choose the finding in this pregnancy' });
  })
  // Keep only the fields that matter for this kind of rule.
  .transform((r) => {
    const type = RISK_FACTORS[r.factor]?.type;
    return {
      ...r,
      op: type === 'number' ? r.op : null,
      value: type === 'number' ? r.value : null,
      condition: type === 'condition' ? r.condition : null,
      complication: type === 'complication' ? r.complication : null,
      finding: type === 'finding' ? r.finding : null,
    };
  });

// Items timed "after" another item must not come back round to themselves (directly or through others).
// Returns, for each item in a loop, the other items of the loop (empty for an item timed after itself).
function afterLoops(items) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const loops = new Map();
  for (const start of items) {
    const path = [];
    for (let cur = start; cur?.after?.key && !path.includes(cur.key); cur = byKey.get(cur.after.key)) {
      path.push(cur.key);
      if (cur.after.key === start.key) {
        loops.set(start.key, path.slice(1));
        break;
      }
    }
  }
  return loops;
}

const templateBody = z
  .object({
    name: noFetalSex(z.string().trim().min(3, 'Name is too short').max(150)),
    description: noFetalSex(z.string().trim().max(1000)).default(''),
    sources: noFetalSex(z.string().trim().max(1000)).default(''),
    items: z.array(itemSchema).max(200, 'Too many items'),
    riskRules: z.array(riskRuleSchema).max(100, 'Too many risk rules').optional(),
    // The version the person edited: a save based on an older version is refused (it would undo newer changes).
    version: z.number('The template version you edited is missing – please reload the page').int().positive(),
  })
  .superRefine((t, ctx) => {
    const keys = new Set();
    t.items.forEach((it, i) => {
      if (keys.has(it.key)) ctx.addIssue({ code: 'custom', path: ['items', i, 'key'], message: `The code "${it.key}" is used twice` });
      keys.add(it.key);
    });
    t.items.forEach((it, i) => {
      if (it.after?.key && !keys.has(it.after.key)) ctx.addIssue({ code: 'custom', path: ['items', i, 'after', 'key'], message: `No item with code "${it.after.key}"` });
    });
    const loops = afterLoops(t.items);
    t.items.forEach((it, i) => {
      const through = loops.get(it.key);
      if (!through) return;
      const message = through.length
        ? `Item "${it.key}" is timed after itself (through ${through.map((k) => `"${k}"`).join(', ')}).`
        : `Item "${it.key}" is timed after itself.`;
      ctx.addIssue({ code: 'custom', path: ['items', i, 'after', 'key'], message });
    });
    const ruleKeys = new Set();
    (t.riskRules ?? []).forEach((r, i) => {
      if (ruleKeys.has(r.key)) ctx.addIssue({ code: 'custom', path: ['riskRules', i, 'key'], message: `The code "${r.key}" is used twice` });
      ruleKeys.add(r.key);
    });
  });

const createSchema = z
  .object({
    copyFrom: objectId.optional(),
    careType: z.enum(TEMPLATE_CARE_TYPES).optional(),
    // The name is copied into patients' pregnancy records, like the text checked in templateBody.
    name: noFetalSex(z.string().trim().min(3, 'Name is too short').max(150)).optional(),
  })
  .strict();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const changedSince = (t, what = 'Please review the latest version before approving.') =>
  new HttpError(409, `This template was changed (now version ${t.version}) after you opened it. ${what}`, 'CONFLICT');
const isDoctor = (req) => hasRole(req.membership, 'doctor');

// Who may change / approve a template
const canEdit = (req, t) => (t.kind === 'personal' ? t.owner?.equals(req.user._id) : isDoctor(req));
const canApprove = canEdit;

const withRights = (req, t) => ({ ...t.toJSON(), canEdit: canEdit(req, t), canApprove: canApprove(req, t) });

// The template as it is now is exactly what a doctor approved (never judged by its status alone).
const approvedNow = (t) => t.status === 'approved' && contentApproved(t);
// A doctor's own protocol, and the doctor is the one asking: only they choose it as their default.
const ownProtocol = (req, t) => t.kind === 'personal' && isDoctor(req) && Boolean(t.owner?.equals(req.user._id));
// Who may move the plans that use a template to its new version: a protocol – its own doctor, while they work here as
// a doctor; the standard template – any doctor (who may change it).
const mayUpdatePlans = (req, t) => (t.kind === 'personal' ? ownProtocol(req, t) : isDoctor(req));

/**
 * The template's page: the template with who may do what, the built-in offer, and – counts only – how many current
 * plans use it (usedBy) and how many of those are on an older version (olderVersion); whether it is its doctor's
 * default and whether that default is used for new plans (defaultState, careplans/defaultProtocol.js).
 *  - canSetDefault: the doctor who owns this protocol (choose or remove it as their default);
 *  - mayUpdatePlans: a protocol's own doctor (still a doctor here), or any doctor for the standard template;
 *    canUpdatePlans: they may, and its current version is approved.
 */
async function templatePage(req, t) {
  const id = String(t._id);
  const usage = (await templateUsage(req.tenantId, { templateIds: [t._id], hashes: new Map([[id, itemsHash(t.items)]]) })).get(id);
  const states = await defaultStates(req.tenantId, [t]);
  return {
    ...withRights(req, t),
    builtInUpdates: builtInOffer(t),
    usedBy: usage?.usedBy ?? 0,
    olderVersion: usage?.olderVersion ?? 0,
    defaultState: states.get(id) ?? null,
    canSetDefault: ownProtocol(req, t),
    mayUpdatePlans: mayUpdatePlans(req, t), // once its version is approved
    canUpdatePlans: mayUpdatePlans(req, t) && approvedNow(t),
  };
}

// Built-in content this standard template does not have yet (see templatesService pendingBuiltIn), for the offer
// on the template's page: the names of the items and risk rules that would be added, and the items that would
// change ("for which patients", before and after). Exactly this is what "Add as a new draft" does – nothing else.
// null when there is nothing to offer.
function builtInOffer(t) {
  const pending = pendingBuiltIn(t);
  if (!pending) return null;
  return {
    items: pending.items.map((i) => i.name),
    riskRules: pending.riskRules.map((r) => r.label),
    changes: pending.changes.map((c) => ({ name: c.name, from: c.from.appliesWhen ?? null, to: c.to.appliesWhen ?? null })),
  };
}

// Risk levels of patients using this template are recalculated; one audit entry summarises the result.
async function recalculateAndLog(req, t) {
  if (t.careType !== 'antenatal' || t.kind !== 'standard') return { checked: 0, changed: 0, skipped: 0 };
  const r = await recalculateForTemplate(t);
  if (r.checked) await audit(req, 'RISK_RECALCULATED', { details: { templateId: t._id.toString(), name: t.name, version: t.version, ...r } });
  return r;
}

export const templatesRouter = Router();

templatesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...VIEWERS)) throw forbidden('Care-plan templates are available to doctors, RMOs and nurses.');
  next();
});

templatesRouter.get('/', async (req, res) => {
  await ensureStandardTemplates(req.tenantId);
  const q = parse(z.object({ careType: z.enum(TEMPLATE_CARE_TYPES).optional() }), req.query);
  const filter = { tenantId: req.tenantId };
  if (q.careType) filter.careType = q.careType;
  const templates = await CarePlanTemplate.find(filter).sort({ kind: -1, careType: 1, name: 1 }).select('-items');
  // item counts without sending every item
  const counts = await CarePlanTemplate.aggregate([
    { $match: { tenantId: req.tenantId } },
    { $project: { n: { $size: '$items' } } },
  ]);
  const n = new Map(counts.map((c) => [c._id.toString(), c.n]));
  // How many current plans use each template (a count only), and whether each doctor's default is in use – worked
  // out from the default protocols' items and approvals (the list itself is sent without items)
  const usage = await templateUsage(req.tenantId);
  const states = await defaultStates(req.tenantId, await CarePlanTemplate.find({ tenantId: req.tenantId, kind: 'personal', ownerDefault: true }));
  res.json({
    templates: templates.map((t) => ({
      ...withRights(req, t),
      itemCount: n.get(t._id.toString()) ?? 0,
      usedBy: usage.get(t._id.toString())?.usedBy ?? 0,
      defaultState: states.get(t._id.toString()) ?? null,
    })),
  });
});

async function findTemplate(req) {
  const { id } = parse(idParams, req.params);
  await ensureStandardTemplates(req.tenantId); // upgrade older templates before they are shown, edited or approved
  const t = await CarePlanTemplate.findOne({ _id: id, tenantId: req.tenantId });
  if (!t) throw new HttpError(404, 'Template not found.', 'NOT_FOUND');
  return t;
}

templatesRouter.get('/:id', async (req, res) => {
  const t = await findTemplate(req);
  res.json({ template: await templatePage(req, t) });
});

// ---------- A doctor's default protocol (5 Oct 2026) ----------

const versionSeen = z.number('The protocol version you saw is missing – please reload the page').int().positive();

function assertOwnProtocol(req, t) {
  if (t.kind !== 'personal') {
    throw new HttpError(400, "Only a doctor's own protocol can be their default. Without one, new care plans start from the hospital standard template.", 'VALIDATION');
  }
  if (!ownProtocol(req, t)) throw forbidden('Only the doctor who owns this protocol can choose it as their default.');
}

// The doctor who owns this APPROVED protocol makes it their default for its type of care: new care plans of the
// patients assigned to them start from it. Their earlier default for that type of care stops being one. Plans that
// already exist do not change. The version they saw must still be the template's (a newer draft is refused).
//
// At most one default per doctor and type of care (a unique index), so the earlier default is cleared first. If the
// new one then cannot be set (the protocol was edited into a draft at that moment, or an error), the earlier default
// is put back, so a refused request never leaves the doctor without the default they had. Every default this request
// ends (normally the one earlier) is in the audit log: TEMPLATE_DEFAULT_SET names it (replacedTemplateId); any other
// one ended by a clash with a second request at the same moment gets its own TEMPLATE_DEFAULT_REMOVED.
templatesRouter.put('/:id/default', async (req, res) => {
  const { version } = parse(z.object({ version: versionSeen }).strict(), req.body);
  const t = await findTemplate(req);
  assertOwnProtocol(req, t);
  if (version !== t.version) throw changedSince(t, 'Please reload it and try again.');
  if (!approvedNow(t)) throw new HttpError(400, 'A draft protocol cannot be your default. Approve it first.', 'VALIDATION');
  if (t.ownerDefault) return res.json({ template: await templatePage(req, t), changed: false });
  const mine = { tenantId: req.tenantId, kind: 'personal', owner: req.user._id, careType: t.careType };
  // Not "last changed": choosing a default changes nothing in the protocol itself (timestamps: false)
  const setDefault = (id, on) => CarePlanTemplate.updateOne({ _id: id, ...mine, ownerDefault: !on }, { $set: { ownerDefault: on } }, { timestamps: false });
  const ended = []; // the defaults this request cleared (ids), in order
  const putBack = async () => {
    for (const id of ended.reverse()) {
      try {
        await setDefault(id, true);
      } catch (e) {
        if (e?.code !== 11000) throw e;
        // Another default was chosen at this same moment: this one stays ended, and the log says so
        const lost = await CarePlanTemplate.findOne({ _id: id, tenantId: req.tenantId }, { name: 1, version: 1, careType: 1 }).lean();
        if (lost) await audit(req, 'TEMPLATE_DEFAULT_REMOVED', { details: { templateId: String(id), name: lost.name, version: lost.version, careType: lost.careType } });
      }
    }
  };
  for (let attempt = 1; ; attempt += 1) {
    const others = await CarePlanTemplate.find({ ...mine, ownerDefault: true, _id: { $ne: t._id } }, { _id: 1 }).lean();
    for (const o of others) if ((await setDefault(o._id, false)).modifiedCount) ended.push(o._id);
    let r;
    try {
      r = await CarePlanTemplate.updateOne({ _id: t._id, ...mine, version, status: 'approved' }, { $set: { ownerDefault: true } }, { timestamps: false });
    } catch (e) {
      if (e?.code === 11000 && attempt < 3) continue; // another of their protocols was made the default at this moment
      await putBack();
      throw e;
    }
    if (r.matchedCount === 0) {
      // Edited (a new draft version) or no longer approved since the page was read: nothing changes
      await putBack();
      throw changedSince((await CarePlanTemplate.findOne({ _id: t._id, tenantId: req.tenantId })) ?? t, 'Please reload it and try again.');
    }
    break;
  }
  const [replaced, ...alsoEnded] = ended;
  for (const id of alsoEnded) {
    const o = await CarePlanTemplate.findOne({ _id: id, tenantId: req.tenantId }, { name: 1, version: 1, careType: 1 }).lean();
    if (o) await audit(req, 'TEMPLATE_DEFAULT_REMOVED', { details: { templateId: String(id), name: o.name, version: o.version, careType: o.careType } });
  }
  await audit(req, 'TEMPLATE_DEFAULT_SET', {
    details: { templateId: t._id.toString(), name: t.name, version: t.version, careType: t.careType, replacedTemplateId: replaced ? String(replaced) : null },
  });
  const saved = await CarePlanTemplate.findOne({ _id: t._id, tenantId: req.tenantId });
  res.json({ template: await templatePage(req, saved), changed: true });
});

// The doctor stops using this protocol as their default: new care plans of their patients start from the hospital
// standard template again. Allowed in any state (also for a default that became a draft). Plans do not change.
templatesRouter.delete('/:id/default', async (req, res) => {
  const t = await findTemplate(req);
  assertOwnProtocol(req, t);
  if (!t.ownerDefault) return res.json({ template: await templatePage(req, t), changed: false });
  await CarePlanTemplate.updateOne({ _id: t._id, tenantId: req.tenantId }, { $set: { ownerDefault: false } }, { timestamps: false });
  await audit(req, 'TEMPLATE_DEFAULT_REMOVED', { details: { templateId: t._id.toString(), name: t.name, version: t.version, careType: t.careType } });
  const saved = await CarePlanTemplate.findOne({ _id: t._id, tenantId: req.tenantId });
  res.json({ template: await templatePage(req, saved), changed: true });
});

// ---------- A new approved version for all the plans that use the template (5 Oct 2026) ----------

// Who may move the plans (mayUpdatePlans): a protocol – its own doctor, while they work here as a doctor; the
// standard template – any doctor (who may change it); once its current version is approved. Each plan is then moved
// only if this person may change that patient's plan, exactly as on the Care plan tab (updatePlansToTemplate).
function assertCanUpdatePlans(req, t) {
  if (!mayUpdatePlans(req, t)) {
    throw forbidden(t.kind === 'personal' ? 'Only the doctor who owns this protocol can update the plans that use it.' : 'Only doctors can update the plans that use the standard template.');
  }
  if (!approvedNow(t)) throw new HttpError(409, 'Only an approved version can be applied to all plans. Approve this version first.', 'NOT_APPROVED');
}

// Step 1: what the update would do – counts only, nothing saved or audited.
templatesRouter.get('/:id/plans-update', async (req, res) => {
  const t = await findTemplate(req);
  assertCanUpdatePlans(req, t);
  res.json(await previewPlansUpdate(planCtx(req), t));
});

// Step 2: the doctor confirms the version they reviewed (its number and its items' fingerprint); each plan moved is
// audited on its own, as a single update (CARE_PLAN_CHANGED, ids only). Answers with what was done.
templatesRouter.post('/:id/plans-update', async (req, res) => {
  const body = parse(
    z.object({ version: versionSeen, itemsHash: z.string().regex(/^[a-f0-9]{64}$/, 'Please reload the page and review the changes again') }).strict(),
    req.body,
  );
  const t = await findTemplate(req);
  assertCanUpdatePlans(req, t);
  if (body.version !== t.version || body.itemsHash !== itemsHash(t.items)) throw changedSince(t, 'Please review the plans to update again.');
  const result = await updatePlansToTemplate(planCtx(req), t);
  res.json({ result, template: await templatePage(req, t) });
});

// A doctor adds the built-in DRAFT content the standard template does not have yet (items and risk rules for
// findings in this pregnancy; postnatal items that now follow those findings). A template a doctor has approved
// or edited is never changed by an upgrade, so this is how it gets them: asked for by a doctor, saved as a new
// draft version that a doctor must approve again. Only what the offer listed is added or changed.
templatesRouter.post('/:id/built-in', async (req, res) => {
  const { version } = parse(z.object({ version: z.number('The template version you saw is missing – please reload the page').int().positive() }).strict(), req.body);
  const t = await findTemplate(req);
  if (t.kind !== 'standard') throw new HttpError(400, 'Built-in updates are only for the hospital standard templates.', 'VALIDATION');
  if (!canEdit(req, t)) throw forbidden('Only doctors can change the standard template.');
  if (version !== t.version) throw changedSince(t, 'Please reload it and try again.');
  const added = addPendingBuiltIn(t, req.user.name);
  if (!added) throw new HttpError(409, 'There is nothing new to add to this template.', 'NOTHING_TO_ADD');
  await t.save();
  await audit(req, 'TEMPLATE_UPDATED', { details: { templateId: t._id.toString(), name: t.name, version: t.version } });
  const recalculated = await recalculateAndLog(req, t);
  res.json({ template: { ...withRights(req, t), builtInUpdates: builtInOffer(t) }, added: { items: added.items.length, riskRules: added.riskRules.length, changes: added.changes.length }, recalculated });
});

// A doctor creates their own protocol: empty, or copied from another template.
templatesRouter.post('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can create their own protocols.');
  const data = parse(createSchema, req.body);
  let base = null;
  if (data.copyFrom) {
    base = await CarePlanTemplate.findOne({ _id: data.copyFrom, tenantId: req.tenantId });
    if (!base) throw new HttpError(404, 'Template to copy not found.', 'NOT_FOUND');
  }
  const careType = base?.careType ?? data.careType ?? 'antenatal';
  const t = await CarePlanTemplate.create({
    tenantId: req.tenantId,
    careType,
    kind: 'personal',
    owner: req.user._id,
    ownerName: req.user.name,
    basedOn: base?._id ?? null,
    name: data.name ?? (base ? `${req.user.name}'s protocol – based on ${base.name.replace(/ – DRAFT$/, '')}` : `${req.user.name}'s ${careType} protocol`).slice(0, 150),
    description: base?.description ?? '',
    sources: base?.sources ?? '',
    items: base?.items?.map((it) => it.toObject()) ?? [],
    // Risk levels always come from the hospital standard template, so personal protocols have no risk rules.
    riskRules: undefined,
    status: 'draft',
    version: 1,
    updatedByName: req.user.name,
  });
  await audit(req, 'TEMPLATE_CREATED', { details: { templateId: t._id.toString(), name: t.name, copiedFrom: base?._id?.toString() ?? null } });
  res.status(201).json({ template: withRights(req, t) });
});

// Editing always makes the template a draft again (new version), so it must be re-approved.
templatesRouter.put('/:id', async (req, res) => {
  const t = await findTemplate(req);
  if (!canEdit(req, t)) {
    throw forbidden(t.kind === 'personal' ? 'Only the doctor who owns this protocol can change it.' : 'Only doctors can change the standard template.');
  }
  const { version, ...data } = parse(templateBody, req.body);
  if (version !== t.version) throw changedSince(t, 'Please reload it and make your changes again.');
  // An antenatal schedule is in weeks of pregnancy: at most 44.
  if (t.careType === 'antenatal' && data.items) {
    const fields = {};
    data.items.forEach((it, i) => {
      if (it.fromWeek > 44) fields[`items.${i}.fromWeek`] = 'Weeks of pregnancy: at most 44';
      if (it.toWeek > 44) fields[`items.${i}.toWeek`] = 'Weeks of pregnancy: at most 44';
    });
    if (Object.keys(fields).length) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
  }
  if (data.riskRules === undefined || t.kind !== 'standard' || t.careType !== 'antenatal') delete data.riskRules; // not sent / not used here
  // Once a doctor saves the rules, they are the doctor's – built-in updates no longer replace them. Compared by
  // content (the fingerprint), so rules stored before a field existed are not mistaken for edited ones.
  if (data.riskRules !== undefined && rulesHash(data.riskRules) !== rulesHash(t.riskRules)) t.builtInRulesVersion = null;
  // A template approved before approvals were recorded: write that approval down before the edit makes the
  // template a draft (same save), so patients' plans built from the approved content stay approved.
  backfillApproval(t);
  Object.assign(t, data);
  t.version += 1;
  t.status = 'draft';
  t.updatedByName = req.user.name;
  await t.save();
  await audit(req, 'TEMPLATE_UPDATED', { details: { templateId: t._id.toString(), name: t.name, version: t.version } });
  const recalculated = await recalculateAndLog(req, t);
  res.json({ template: withRights(req, t), recalculated });
});

// A doctor confirms they reviewed the template and approves it for clinical use.
templatesRouter.post('/:id/approve', async (req, res) => {
  const { version } = parse(
    z.object({
      confirm: z.literal(true, 'Please confirm that you have reviewed the template'),
      version: z.number('The template version you reviewed is missing – please reload the page').int().positive(), // the version the doctor reviewed
    }),
    req.body,
  );
  const t = await findTemplate(req);
  if (!canApprove(req, t)) {
    throw forbidden(t.kind === 'personal' ? 'Only the doctor who owns this protocol can approve it.' : 'Only doctors can approve the standard template.');
  }
  // Approve only what the doctor actually reviewed: if someone changed the template (or its rules were
  // upgraded) since the page was opened, stop and show the new version first.
  if (t.version !== version) throw changedSince(t);
  if (!t.items.length) throw new HttpError(400, 'An empty template cannot be approved.', 'VALIDATION');
  if (t.status === 'approved') return res.json({ template: withRights(req, t) });
  // The approval records the fingerprints of exactly the content reviewed. It is written only if the
  // template is still that version and a draft (a change saved meanwhile makes this approve fail below).
  const earlier = backfillApproval(t);
  const entry = { version, itemsHash: itemsHash(t.items), rulesHash: rulesHash(t.riskRules), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  const r = await CarePlanTemplate.updateOne(
    { _id: t._id, tenantId: req.tenantId, version, status: 'draft' },
    {
      $set: { status: 'approved', approvedBy: entry.by, approvedByName: entry.byName, approvedAt: entry.at, approvedVersion: version },
      $push: { approvals: { $each: [...(earlier ? [earlier] : []), entry] } },
      $inc: { __v: 1 },
    },
  );
  const saved = await CarePlanTemplate.findOne({ _id: t._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    // Someone else approved this same version at the same moment: fine. Anything else changed it: stop.
    if (saved?.status === 'approved' && saved.version === version) return res.json({ template: withRights(req, saved) });
    throw changedSince(saved ?? t);
  }
  await audit(req, 'TEMPLATE_APPROVED', { details: { templateId: saved._id.toString(), name: saved.name, version: saved.version } });
  const recalculated = await recalculateAndLog(req, saved);
  res.json({ template: withRights(req, saved), recalculated });
});

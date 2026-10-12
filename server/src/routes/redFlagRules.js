import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { RedFlagRuleSet } from '../models/RedFlagRuleSet.js';
import { BUILT_IN_RED_FLAG_VERSION, DEFAULT_APPLIES_TO, NUMBER_OPS, RED_FLAG_CARE_TYPES, RED_FLAG_FACTORS, RED_FLAG_LEVELS, ruleCareTypes } from '../redflags/redFlags.js';
import { ensureRedFlagRules, newBuiltInRules, seenBuiltInVersion } from '../redflags/redFlagService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../utils/pcpndt.js';
import { parse } from '../utils/validate.js';

// The hospital's red-flag rules: /api/red-flag-rules. Doctors, RMOs and nurses see them; doctors change and
// approve them. Any change makes the rules a draft again (new version) that a doctor must approve.
// Each rule says which types of care it applies to, and may check lab results. A new built-in version replaces
// only rules no doctor has approved or changed; any other rule set is offered the new built-in rules
// (POST /add-built-in), never changed by itself.

const VIEWERS = ['doctor', 'rmo', 'nurse'];
export const MAX_RED_FLAG_RULES = 150;
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const changedSince = (set, what) => new HttpError(409, `The red-flag rules were changed (now version ${set.version}) after you opened them. ${what}`, 'CONFLICT');
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const noFetalSex = (schema) => schema.refine((t) => !mentionsFetalSex(t), PCPNDT_MESSAGE);
// A number typed in a field. Empty (also only spaces) means "not set". Only plain digits are read as a number:
// a space is never 0, and "0x10", "1e2" or true are refused – a rule must not change its meaning silently.
const typedNumber = (pattern) => (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return null;
  return pattern.test(t) ? Number(t.replace(',', '.')) : t; // other text stays text: refused below, with the field's message
};
const wholeNumber = (label, max, what = 'a whole number') =>
  z.preprocess(
    typedNumber(/^\d{1,3}$/),
    z.union([z.null(), z.number(`${label} must be ${what}`).int(`${label} must be ${what}`).min(0, `${label} can't be below 0`).max(max, `${label} can't be above ${max}`)], `${label} must be ${what}`),
  );
const week = (label) => wholeNumber(label, 44);
// A baby's age in whole days when the value was taken (0 = the first 24 hours)
const dayOfLife = (label) => wholeNumber(label, 365, 'a whole number of days');
// The types of care in plain words, for messages
const CARE_WORDS = { antenatal: 'antenatal', postnatal: 'postnatal', infertility: 'infertility', gynaecology: 'gynaecology', newborn: 'newborn', abortion: 'pregnancy-loss' };

const conditionSchema = z
  .object({
    factor: z.enum(Object.keys(RED_FLAG_FACTORS), 'Choose what to check'),
    op: z.preprocess(emptyToNull, z.union([z.null(), z.enum(NUMBER_OPS)])).default(null),
    value: z.preprocess(typedNumber(/^-?\d+(?:[.,]\d+)?$/), z.union([z.null(), z.number('Value must be a number').min(-50, 'Value is too low').max(500, 'Value is too high')], 'Value must be a number')).default(null),
    grade: z.preprocess(emptyToNull, z.union([z.null(), z.string()])).default(null),
    choices: z.array(z.string()).max(10).default([]),
  })
  .superRefine((c, ctx) => {
    const f = RED_FLAG_FACTORS[c.factor];
    if (f?.type === 'number') {
      if (!c.op) ctx.addIssue({ code: 'custom', path: ['op'], message: 'Choose a comparison' });
      if (c.value === null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a value' });
    }
    if (f?.type === 'grade' && !f.order.includes(c.grade)) ctx.addIssue({ code: 'custom', path: ['grade'], message: 'Choose the lowest grade that raises the flag' });
    if (f?.type === 'choice' && (!c.choices.length || c.choices.some((x) => !f.choices.includes(x)))) {
      ctx.addIssue({ code: 'custom', path: ['choices'], message: 'Tick at least one' });
    }
  })
  // Keep only the fields that matter for this kind of check.
  .transform((c) => {
    const type = RED_FLAG_FACTORS[c.factor]?.type;
    return {
      factor: c.factor,
      op: type === 'number' ? c.op : null,
      value: type === 'number' ? c.value : null,
      grade: type === 'grade' ? c.grade : null,
      ...(type === 'choice' ? { choices: c.choices } : {}),
    };
  });

const ruleSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Each rule needs a short code')
      .max(60)
      .regex(/^[a-z0-9_]+$/, 'Codes can only use lower-case letters, numbers and _'),
    label: noFetalSex(z.string().trim().min(1, 'Each rule needs a name').max(120)),
    level: z.enum(RED_FLAG_LEVELS, 'Choose Urgent or Watch'),
    message: noFetalSex(z.string().trim().max(500)).default(''),
    // Which types of care the rule applies to (rules sent without it are for pregnancy care, as before)
    appliesTo: z
      .array(z.enum(RED_FLAG_CARE_TYPES, 'Choose a type of care from the list'))
      .min(1, 'Tick at least one type of care')
      .max(RED_FLAG_CARE_TYPES.length)
      .default([...DEFAULT_APPLIES_TO])
      .transform((list) => RED_FLAG_CARE_TYPES.filter((t) => list.includes(t))),
    conditions: z.array(conditionSchema).min(1, 'Add at least one check').max(3, 'At most 3 checks per rule'),
    fromWeek: week('"From" week').default(null),
    toWeek: week('"To" week').default(null),
    fromDay: dayOfLife('"From" day').default(null),
    toDay: dayOfLife('"To" day').default(null),
    source: noFetalSex(z.string().trim().max(400)).default(''),
  })
  .superRefine((r, ctx) => {
    if (r.fromWeek != null && r.toWeek != null && r.toWeek < r.fromWeek) ctx.addIssue({ code: 'custom', path: ['toWeek'], message: '"To" week must not be before "from" week' });
    if (r.fromDay != null && r.toDay != null && r.toDay < r.fromDay) ctx.addIssue({ code: 'custom', path: ['toDay'], message: '"To" day must not be before "from" day' });
    // Weeks of pregnancy and a baby's age only mean something for those patients: a rule that could never be
    // raised is refused, not saved silently.
    if (!r.appliesTo.includes('antenatal')) {
      for (const k of ['fromWeek', 'toWeek']) if (r[k] != null) ctx.addIssue({ code: 'custom', path: [k], message: 'Weeks of pregnancy are only used for antenatal care – tick it above or clear the weeks' });
    }
    if (!r.appliesTo.includes('newborn')) {
      for (const k of ['fromDay', 'toDay']) if (r[k] != null) ctx.addIssue({ code: 'custom', path: [k], message: "The baby's age is only used for newborn care – tick it above or clear the days" });
    }
    // A check that does not exist for a ticked type of care (the fetal heart rate of a baby, a baby's bilirubin of a mother)
    r.conditions.forEach((c, j) => {
      const f = RED_FLAG_FACTORS[c.factor];
      const not = f?.careTypes ? r.appliesTo.filter((t) => !f.careTypes.includes(t)) : [];
      if (not.length) ctx.addIssue({ code: 'custom', path: ['conditions', j, 'factor'], message: `${f.label} is not checked for ${not.map((t) => CARE_WORDS[t]).join(', ')} patients – untick that type of care or choose another check` });
    });
  });

const saveSchema = z
  .object({
    version: z.number('The version you edited is missing – please reload the page').int().positive(),
    rules: z.array(ruleSchema).max(MAX_RED_FLAG_RULES, `At most ${MAX_RED_FLAG_RULES} rules`),
  })
  .superRefine((b, ctx) => {
    const seen = new Map();
    b.rules.forEach((r, i) => {
      if (seen.has(r.key)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'key'], message: `This code is already used by rule ${seen.get(r.key) + 1}` });
      else seen.set(r.key, i);
    });
  });

// newBuiltIn: how many built-in rules a doctor can add (only told to those who can add them); newBuiltInCareTypes:
// the types of care those rules are for (the offer names them).
// builtInAdded: the codes of built-in rules that were added to the hospital's rules and that no doctor has approved
// yet – the page marks them, so nobody takes them for rules a colleague wrote and reviewed.
function withRights(req, set) {
  const offered = isDoctor(req) ? newBuiltInRules(set) : [];
  const offeredFor = new Set(offered.flatMap((r) => ruleCareTypes(r)));
  return {
    ...set.toJSON(),
    builtInAdded: unreviewedBuiltIn(set),
    canEdit: isDoctor(req),
    canApprove: isDoctor(req),
    newBuiltIn: offered.length,
    newBuiltInCareTypes: RED_FLAG_CARE_TYPES.filter((t) => offeredFor.has(t)),
  };
}
const unreviewedBuiltIn = (set) => (set.status === 'draft' ? (set.builtInAdded ?? []).filter((key) => set.rules.some((r) => r.key === key)) : []);

// A change by a doctor: the rules become the hospital's own draft (never replaced by a built-in upgrade again).
function becomesOwnDraft(req, set) {
  set.builtInSeenVersion = seenBuiltInVersion(set);
  set.builtInVersion = null;
  set.version += 1;
  set.status = 'draft';
  set.approvedBy = null;
  set.approvedByName = null;
  set.approvedAt = null;
  set.updatedByName = req.user.name;
}
async function saveOrConflict(set, what = 'Please reload them and make your changes again.') {
  try {
    await set.save();
  } catch (e) {
    if (e?.name === 'VersionError') throw changedSince(set, what);
    throw e;
  }
}

export const redFlagRulesRouter = Router();

redFlagRulesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...VIEWERS)) throw forbidden('Red-flag rules are available to doctors, RMOs and nurses.');
  next();
});

redFlagRulesRouter.get('/', async (req, res) => {
  const set = await ensureRedFlagRules(req.tenantId);
  res.json({ ruleSet: withRights(req, set) });
});

// Saving always makes the rules a draft again (new version), so a doctor must approve them.
redFlagRulesRouter.put('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change the red-flag rules.');
  const { version, rules } = parse(saveSchema, req.body);
  const set = await ensureRedFlagRules(req.tenantId);
  if (version !== set.version) throw changedSince(set, 'Please reload them and make your changes again.');
  set.rules = rules;
  set.builtInAdded = (set.builtInAdded ?? []).filter((key) => rules.some((r) => r.key === key)); // still unreviewed until the next approval
  becomesOwnDraft(req, set); // the doctor's rules from now on: built-in updates no longer replace them
  await saveOrConflict(set);
  await audit(req, 'RED_FLAG_RULES_UPDATED', { details: { version: set.version, rules: rules.length } });
  res.json({ ruleSet: withRights(req, set) });
});

// Adds the built-in rules that came after this hospital's rules were made (lab results, postnatal and newborn
// rules; pregnancy-loss rules) to rules a doctor approved or changed. Nothing already there is changed. The result is a new draft for a
// doctor to review and approve; the added rules stay marked as an unreviewed built-in draft (builtInAdded) until then.
redFlagRulesRouter.post('/add-built-in', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change the red-flag rules.');
  const { version } = parse(z.object({ version: z.number('The version you looked at is missing – please reload the page').int().positive() }).strict(), req.body);
  const set = await ensureRedFlagRules(req.tenantId);
  if (version !== set.version) throw changedSince(set, 'Please reload them and try again.');
  const added = newBuiltInRules(set);
  if (!added.length) throw new HttpError(400, 'There are no new built-in rules to add.', 'VALIDATION');
  if (set.rules.length + added.length > MAX_RED_FLAG_RULES) {
    throw new HttpError(400, `The rule set would have more than ${MAX_RED_FLAG_RULES} rules. Remove some rules first.`, 'VALIDATION');
  }
  set.rules.push(...added);
  set.builtInAdded = [...new Set([...unreviewedBuiltIn(set), ...added.map((r) => r.key)])];
  becomesOwnDraft(req, set);
  set.builtInSeenVersion = BUILT_IN_RED_FLAG_VERSION;
  await saveOrConflict(set, 'Please reload them and try again.');
  await audit(req, 'RED_FLAG_RULES_UPDATED', { details: { version: set.version, rules: set.rules.length, added: added.length } });
  res.json({ ruleSet: withRights(req, set), added: added.length });
});

// A doctor confirms they reviewed the rules and approves them.
redFlagRulesRouter.post('/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can approve the red-flag rules.');
  const { version } = parse(
    z.object({
      confirm: z.literal(true, 'Please confirm that you have reviewed the rules'),
      version: z.number('The version you reviewed is missing – please reload the page').int().positive(),
    }),
    req.body,
  );
  const set = await ensureRedFlagRules(req.tenantId);
  if (set.version !== version) throw changedSince(set, 'Please review the latest version before approving.');
  if (!set.rules.length) throw new HttpError(400, 'Empty rules cannot be approved.', 'VALIDATION');
  if (set.status === 'approved') return res.json({ ruleSet: withRights(req, set) });
  const r = await RedFlagRuleSet.updateOne(
    { _id: set._id, tenantId: req.tenantId, version, status: 'draft' },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedByName: req.user.name, approvedAt: req.now ?? new Date(), builtInAdded: [] }, $inc: { __v: 1 } },
  );
  const saved = await RedFlagRuleSet.findOne({ _id: set._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    if (saved?.status === 'approved' && saved.version === version) return res.json({ ruleSet: withRights(req, saved) });
    throw changedSince(saved ?? set, 'Please review the latest version before approving.');
  }
  await audit(req, 'RED_FLAG_RULES_APPROVED', { details: { version } });
  res.json({ ruleSet: withRights(req, saved) });
});

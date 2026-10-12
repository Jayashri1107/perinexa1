import { Router } from 'express';
import { z } from 'zod';
import {
  BUILT_IN_BEFORE_NEW_KINDS,
  BUILT_IN_MED_SAFETY,
  BUILT_IN_MED_SAFETY_VERSION,
  BUILT_IN_SINCE,
  DOSE_UNITS,
  MAX_MED_SAFETY_ENTRIES,
  MED_SAFETY_KINDS,
  MED_SAFETY_LEVELS,
} from '../medsafety/medicineSafety.js';
import { hasRole } from '../models/Membership.js';
import { MedicineSafetyList } from '../models/MedicineSafetyList.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';

// The hospital's medicine safety list (Smart features, step 2): /api/medicine-safety. Doctors, RMOs and nurses
// read it (the prescription page uses it to warn while writing); doctors change and approve it. Any change
// makes it a draft again (new version) that a doctor must approve.
// Entries: medicines and combinations in pregnancy, medicines while breastfeeding, medicines in a newborn baby, and
// usual maximum doses. A new built-in version replaces only a list no doctor has approved or changed; any other
// list is offered the new built-in entries (POST /add-built-in), never changed by itself.

const VIEWERS = ['doctor', 'rmo', 'nurse'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const changedSince = (l, what) => new HttpError(409, `The medicine safety list was changed (now version ${l.version}) after you opened it. ${what}`, 'CONFLICT');
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const week = (label) => z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int(`${label} must be a whole number`).min(0, `${label} can't be below 0`).max(44, `${label} can't be above 44`)]));
const ageDays = z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number('The age must be a number of days').int('The age must be a whole number of days').min(1, 'The age must be at least 1 day').max(365, 'The age can be at most 365 days')]));
const amount = (label) => z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number(`${label} must be a number`).positive(`${label} must be above 0`).max(1_000_000, `${label} is too high`)]));
// Names are matched case-insensitively at the start of a word, so they are kept in lower case.
const terms = z.array(z.string().trim().toLowerCase().min(2, 'Each name needs at least 2 letters').max(60)).max(40, 'At most 40 names');

/** The hospital's list, created from the built-in draft on first use (and upgraded while no doctor edited it). */
export async function ensureMedicineSafety(tenantId) {
  await MedicineSafetyList.updateOne(
    { tenantId, set: 'standard' },
    {
      $setOnInsert: {
        entries: BUILT_IN_MED_SAFETY,
        builtInVersion: BUILT_IN_MED_SAFETY_VERSION,
        builtInSeenVersion: BUILT_IN_MED_SAFETY_VERSION,
        status: 'draft',
        version: 1,
        updatedByName: 'Built-in draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, timestamps: false },
  ).catch((e) => {
    if (e?.code !== 11000) throw e;
  });
  const list = await MedicineSafetyList.findOne({ tenantId, set: 'standard' });
  if (list.status === 'draft' && list.builtInVersion != null && list.builtInVersion < BUILT_IN_MED_SAFETY_VERSION) {
    list.entries = BUILT_IN_MED_SAFETY;
    list.builtInVersion = BUILT_IN_MED_SAFETY_VERSION;
    list.builtInSeenVersion = BUILT_IN_MED_SAFETY_VERSION;
    list.version += 1;
    list.updatedByName = 'Built-in draft';
    await list.save().catch(() => {});
  }
  return list;
}

/** The built-in version a list was made from or last offered (a list from before this was recorded: version 2). */
const seenVersion = (list) => list.builtInSeenVersion ?? list.builtInVersion ?? BUILT_IN_BEFORE_NEW_KINDS;

/**
 * Built-in entries added after the version this list was made from, and not in it: offered to a doctor, who adds
 * them as a new draft. Nothing for a list that is still the current built-in one.
 */
export function newBuiltInEntries(list) {
  if (list.builtInVersion === BUILT_IN_MED_SAFETY_VERSION) return [];
  const seen = seenVersion(list);
  const have = new Set(list.entries.map((e) => e.key));
  return BUILT_IN_MED_SAFETY.filter((e) => (BUILT_IN_SINCE[e.key] ?? 1) > seen && !have.has(e.key));
}

const entrySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Each entry needs a short code')
      .max(60)
      .regex(/^[a-z0-9_]+$/, 'Codes can only use lower-case letters, numbers and _'),
    kind: z.enum(MED_SAFETY_KINDS, 'Choose a medicine or a combination'),
    label: z.string().trim().min(1, 'Each entry needs a name').max(120),
    terms: terms.min(1, 'Add at least one medicine name'),
    otherTerms: terms.default([]),
    level: z.enum(MED_SAFETY_LEVELS, 'Choose Avoid or Caution'),
    fromWeek: week('"From" week').default(null),
    toWeek: week('"To" week').default(null),
    maxAgeDays: ageDays.default(null),
    doseUnit: z.enum([...DOSE_UNITS, ''], 'Choose the unit').default(''),
    maxSingle: amount('The maximum for one dose').default(null),
    maxDaily: amount('The maximum for a day').default(null),
    perKg: z.boolean('Per kg must be yes or no').default(false),
    message: z.string().trim().max(500).default(''),
    source: z.string().trim().max(400).default(''),
  })
  .superRefine((e, ctx) => {
    if (e.kind === 'combination' && !e.otherTerms.length) ctx.addIssue({ code: 'custom', path: ['otherTerms'], message: 'Add the names of the other medicine' });
    if (e.fromWeek != null && e.toWeek != null && e.toWeek < e.fromWeek) ctx.addIssue({ code: 'custom', path: ['toWeek'], message: '"To" week must not be before "from" week' });
    if (e.kind === 'dose') {
      if (!e.doseUnit) ctx.addIssue({ code: 'custom', path: ['doseUnit'], message: 'Choose the unit' });
      if (e.maxSingle == null && e.maxDaily == null) ctx.addIssue({ code: 'custom', path: ['maxDaily'], message: 'Enter the maximum for one dose, for a day, or both' });
      if (e.maxSingle != null && e.maxDaily != null && e.maxDaily < e.maxSingle) ctx.addIssue({ code: 'custom', path: ['maxDaily'], message: 'The maximum for a day must not be below the maximum for one dose' });
    }
  })
  // Keep only the fields that matter for this kind of entry. A dose limit is always a caution: it never asks for a reason.
  // An age in days belongs to a newborn entry, and to a baby's per-kg dose limit (the lower doses of the first week).
  .transform((e) => {
    const isDose = e.kind === 'dose';
    return {
      ...e,
      otherTerms: e.kind === 'combination' ? e.otherTerms : [],
      level: isDose ? 'caution' : e.level,
      fromWeek: e.kind === 'medicine' ? e.fromWeek : null,
      toWeek: e.kind === 'medicine' ? e.toWeek : null,
      maxAgeDays: e.kind === 'newborn' || (isDose && e.perKg) ? e.maxAgeDays : null,
      doseUnit: isDose ? e.doseUnit : '',
      maxSingle: isDose ? e.maxSingle : null,
      maxDaily: isDose ? e.maxDaily : null,
      perKg: isDose ? e.perKg : false,
    };
  });

const saveSchema = z
  .object({
    version: z.number('The version you edited is missing – please reload the page').int().positive(),
    entries: z.array(entrySchema).max(MAX_MED_SAFETY_ENTRIES, `At most ${MAX_MED_SAFETY_ENTRIES} entries`),
  })
  .superRefine((b, ctx) => {
    const seen = new Map();
    b.entries.forEach((e, i) => {
      if (seen.has(e.key)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'key'], message: `This code is already used by entry ${seen.get(e.key) + 1}` });
      else seen.set(e.key, i);
    });
  });

// newBuiltIn: how many built-in entries a doctor can add (only told to those who can add them).
const withRights = (req, l) => ({ ...l.toJSON(), canEdit: isDoctor(req), canApprove: isDoctor(req), newBuiltIn: isDoctor(req) ? newBuiltInEntries(l).length : 0 });

// A change by a doctor: the list becomes the hospital's own draft (never replaced by a built-in upgrade again).
function becomesOwnDraft(req, list) {
  list.builtInSeenVersion = seenVersion(list);
  list.builtInVersion = null;
  list.version += 1;
  list.status = 'draft';
  list.approvedBy = null;
  list.approvedByName = null;
  list.approvedAt = null;
  list.updatedByName = req.user.name;
}
async function saveOrConflict(list) {
  try {
    await list.save();
  } catch (e) {
    if (e?.name === 'VersionError') throw changedSince(list, 'Please reload it and make your changes again.');
    throw e;
  }
}

export const medicineSafetyRouter = Router();

medicineSafetyRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...VIEWERS)) throw forbidden('The medicine safety list is available to doctors, RMOs and nurses.');
  next();
});

medicineSafetyRouter.get('/', async (req, res) => {
  const list = await ensureMedicineSafety(req.tenantId);
  res.json({ list: withRights(req, list) });
});

medicineSafetyRouter.put('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change the medicine safety list.');
  const { version, entries } = parse(saveSchema, req.body);
  const list = await ensureMedicineSafety(req.tenantId);
  if (version !== list.version) throw changedSince(list, 'Please reload it and make your changes again.');
  list.entries = entries;
  becomesOwnDraft(req, list);
  await saveOrConflict(list);
  await audit(req, 'MEDICINE_SAFETY_UPDATED', { details: { version: list.version, entries: entries.length } });
  res.json({ list: withRights(req, list) });
});

// Adds the built-in entries that came after this hospital's list was made (for example dose limits, breastfeeding
// and newborn entries) to a list a doctor approved or changed. The result is a new draft for a doctor to approve.
medicineSafetyRouter.post('/add-built-in', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change the medicine safety list.');
  const { version } = parse(z.object({ version: z.number('The version you looked at is missing – please reload the page').int().positive() }).strict(), req.body);
  const list = await ensureMedicineSafety(req.tenantId);
  if (version !== list.version) throw changedSince(list, 'Please reload it and try again.');
  const added = newBuiltInEntries(list);
  if (!added.length) throw new HttpError(400, 'There are no new built-in entries to add.', 'VALIDATION');
  if (list.entries.length + added.length > MAX_MED_SAFETY_ENTRIES) {
    throw new HttpError(400, `The list would have more than ${MAX_MED_SAFETY_ENTRIES} entries. Remove some entries first.`, 'VALIDATION');
  }
  list.entries.push(...added);
  becomesOwnDraft(req, list);
  list.builtInSeenVersion = BUILT_IN_MED_SAFETY_VERSION;
  await saveOrConflict(list);
  await audit(req, 'MEDICINE_SAFETY_UPDATED', { details: { version: list.version, entries: list.entries.length, added: added.length } });
  res.json({ list: withRights(req, list), added: added.length });
});

medicineSafetyRouter.post('/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can approve the medicine safety list.');
  const { version } = parse(
    z.object({
      confirm: z.literal(true, 'Please confirm that you have reviewed the list'),
      version: z.number('The version you reviewed is missing – please reload the page').int().positive(),
    }),
    req.body,
  );
  const list = await ensureMedicineSafety(req.tenantId);
  if (list.version !== version) throw changedSince(list, 'Please review the latest version before approving.');
  if (!list.entries.length) throw new HttpError(400, 'An empty list cannot be approved.', 'VALIDATION');
  if (list.status === 'approved') return res.json({ list: withRights(req, list) });
  const r = await MedicineSafetyList.updateOne(
    { _id: list._id, tenantId: req.tenantId, version, status: 'draft' },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedByName: req.user.name, approvedAt: req.now ?? new Date() }, $inc: { __v: 1 } },
  );
  const saved = await MedicineSafetyList.findOne({ _id: list._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    if (saved?.status === 'approved' && saved.version === version) return res.json({ list: withRights(req, saved) });
    throw changedSince(saved ?? list, 'Please review the latest version before approving.');
  }
  await audit(req, 'MEDICINE_SAFETY_APPROVED', { details: { version } });
  res.json({ list: withRights(req, saved) });
});

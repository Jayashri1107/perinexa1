import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AGE_UNITS, BAND_PREGNANT, BAND_SEX, DEPARTMENT_KEYS, DEPARTMENTS, labCatalogue, labSetup, rangeText } from '../lab/labSetup.js';
import { LAB_GROUPS, LAB_TESTS, testByKey } from '../lab/labTests.js';
import { LabSetup } from '../models/LabSetup.js';
import { LabTestSetting } from '../models/LabTestSetting.js';
import { Membership, hasRole } from '../models/Membership.js';
import { PriceItem } from '../models/PriceItem.js';
import { Referrer } from '../models/Referrer.js';
import { User } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';
import { safeText } from '../utils/pcpndt.js';

// The lab's set-up (/api/lab-setup, docs/LAB_LIMS_PLAN.md features 2, 3 and 5). Holds no patient data.
//  - The hospital's test list: lab staff, doctors and RMOs add the hospital's own tests and change any test's
//    department, turnaround times, usual outside lab, whether it is offered, and its usual ranges (also ranges for a
//    group: an age, pregnant or not, a baby's sex after birth). A change to the fields or ranges is clinical: it makes
//    a new DRAFT version, which only a doctor approves. Nurses read the list.
//  - The lab's settings (the check before the report and who checks): doctors change them.
// A new test of the hospital's own gets a ₹0 line on the price list (key lab:<test key>) for the hospital admin to price.

const READERS = ['lab', 'doctor', 'rmo', 'nurse'];
const EDITORS = ['lab', 'doctor', 'rmo'];
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const canEdit = (req) => hasRole(req.membership, ...EDITORS);
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const changedSince = (s) => new HttpError(409, `This test was changed (now version ${s.version}) after you opened it. Reload the page and check it again.`, 'CONFLICT');
const MAX_BANDS = 10;
const MAX_FIELDS = 20;

export const labSetupRouter = Router();

labSetupRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The lab set-up is for the lab, doctors, RMOs and nurses.');
  next();
});

// ---------- Shapes ----------

const limit = z.number('Enter a number').finite().nullable().default(null);
const bandSchema = z
  .object({
    sex: z.enum(BAND_SEX).default(''),
    pregnant: z.enum(BAND_PREGNANT).default(''),
    ageUnit: z.enum(AGE_UNITS).default('years'),
    fromAge: z.number().int().min(0).max(3650).nullable().default(null),
    toAge: z.number().int().min(0).max(3650).nullable().default(null),
    low: limit,
    high: limit,
    range: safeText('Range in words', 150).default(''),
  })
  .strict();
const fieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,30}$/).optional(),
    name: safeText('Name', 80).refine((t) => t.trim().length > 0, 'Name the value'),
    type: z.enum(['number', 'choice', 'text'], 'Choose the kind of result'),
    unit: safeText('Unit', 30).default(''),
    low: limit,
    high: limit,
    range: safeText('Usual range in words', 150).default(''),
    options: z.array(safeText('Choice', 40)).max(12).default([]),
    abnormal: z.array(z.string().max(40)).max(12).default([]),
    bands: z.array(bandSchema).max(MAX_BANDS, `At most ${MAX_BANDS} group ranges`).default([]),
    // Lab version 2: flag "Big change" when the value moved by at least this much from her last result (per cent)
    deltaPercent: z.number().min(1).max(1000).nullable().default(null),
  })
  .strict();
const optionalLimit = z.number('Enter a number').finite().nullable().optional(); // left out = the built-in limit
const rangeSchema = z
  .object({ low: optionalLimit, high: optionalLimit, range: safeText('Usual range in words', 150).default(''), bands: z.array(bandSchema).max(MAX_BANDS).default([]), deltaPercent: z.number().min(1).max(1000).nullable().default(null) })
  .strict();
const hours = z.number('Enter the hours').int().min(1).max(2000).nullable().default(null);
const commonShape = {
  department: z.enum(['', ...DEPARTMENT_KEYS]).default(''),
  tatHours: hours,
  urgentTatHours: hours,
  outsideLab: safeText('Usual outside lab', 120).default(''),
  active: z.boolean().default(true),
};
const ownShape = {
  who: z.enum(['adult', 'newborn'], 'Choose whose test this is'),
  name: safeText('Test name', 150).refine((t) => t.trim().length >= 2, 'Name the test'),
  group: z.string().max(40),
  sample: safeText('Sample', 150).default(''),
  fields: z.array(fieldSchema).min(1, 'Add at least one result value').max(MAX_FIELDS, `At most ${MAX_FIELDS} values`),
};
const version = z.number('The version you edited is missing – please reload the page').int().positive();
const createSchema = z.object({ ...ownShape, ...commonShape }).strict();
const updateOwnSchema = z.object({ ...ownShape, ...commonShape, version }).strict();
const updateBuiltInSchema = z.object({ ...commonShape, fieldRanges: z.record(z.string().max(40), rangeSchema).default({}), version }).strict();

/** The checks a schema can't do, for the group ranges of one value. at: where the error is shown. */
function checkBands(bands, who, at, fields) {
  bands.forEach((b, j) => {
    const here = `${at}.bands.${j}`;
    if (b.sex && who !== 'newborn') fields[here] = "A range for one sex is only for a baby's test (the sex recorded after birth).";
    if (b.ageUnit === 'days' && who !== 'newborn') fields[here] = "Days of life are only for a baby's test – use years.";
    if (b.low == null && b.high == null) fields[here] = 'Enter the lower or the upper limit (or both).';
    else if (b.low != null && b.high != null && b.low > b.high) fields[here] = 'The lower limit must not be above the upper limit.';
    if (b.fromAge != null && b.toAge != null && b.fromAge > b.toAge) fields[here] = 'The first age must not be after the last.';
    if (!b.sex && !b.pregnant && b.fromAge == null && b.toAge == null) fields[here] = 'Say whom this range is for (an age, pregnant or not).';
  });
}

/** The hospital's own test's values: keys kept or given, choices checked, limits in order. */
function checkedFields(data, fields) {
  const used = new Set();
  const out = data.fields.map((f, i) => {
    const at = `fields.${i}`;
    let key = f.key && !used.has(f.key) ? f.key : null;
    for (let n = i + 1; !key; n += 1) if (!used.has(`v${n}`)) key = `v${n}`;
    used.add(key);
    if (f.type === 'choice') {
      if (f.options.length < 2) fields[at] = 'A choice needs at least two options.';
      if (f.abnormal.some((a) => !f.options.includes(a))) fields[at] = 'An abnormal choice must be one of the options.';
    }
    if (f.type === 'number') {
      if (f.low != null && f.high != null && f.low > f.high) fields[at] = 'The lower limit must not be above the upper limit.';
      checkBands(f.bands, data.who, at, fields);
    }
    const base = { key, name: f.name.trim(), type: f.type };
    if (f.type === 'number') return { ...base, unit: f.unit.trim(), low: f.low, high: f.high, range: f.range.trim() || rangeText(f.low, f.high, f.unit.trim()), bands: f.bands, deltaPercent: f.deltaPercent };
    if (f.type === 'choice') return { ...base, options: f.options.map((o) => o.trim()), abnormal: f.abnormal };
    return base;
  });
  if (!(data.group in LAB_GROUPS) || data.group.startsWith('nb_') !== (data.who === 'newborn')) fields.group = 'Choose a group for this kind of test.';
  return out;
}

const clinicalOf = (s) => JSON.stringify(s.custom ? { name: s.name, sample: s.sample, group: s.group, who: s.who, fields: s.fields } : { fieldRanges: s.fieldRanges ?? {} });

// ---------- The test list ----------

const auditOf = (s, extra = {}) => ({ test: s.key, name: s.custom ? s.name : testByKey.get(s.key)?.name, version: s.version, ...extra });

async function listView(req) {
  const catalogue = await labCatalogue(req.tenantId);
  const settings = new Map((await LabTestSetting.find({ tenantId: req.tenantId, custom: false }, { key: 1, fieldRanges: 1 }).lean()).map((x) => [x.key, x]));
  const prices = new Map((await PriceItem.find({ tenantId: req.tenantId, key: { $in: catalogue.tests.map((t) => `lab:${t.key}`) } }, { key: 1, pricePaise: 1, active: 1 }).lean()).map((p) => [p.key.slice(4), p]));
  return {
    groups: LAB_GROUPS,
    departments: DEPARTMENTS,
    // A built-in test also says what the hospital changed (fieldRanges) and each value's built-in limits
    tests: catalogue.tests.map((t) => {
      const builtIn = t.custom ? null : testByKey.get(t.key);
      return {
        ...t,
        pricePaise: prices.get(t.key)?.pricePaise ?? null,
        ...(builtIn ? { fieldRanges: settings.get(t.key)?.fieldRanges ?? {}, builtIn: Object.fromEntries(builtIn.fields.map((f) => [f.key, { low: f.low ?? null, high: f.high ?? null, range: f.range ?? '' }])) } : {}),
      };
    }),
    canEdit: canEdit(req),
    canApprove: isDoctor(req),
  };
}

labSetupRouter.get('/tests', async (req, res) => {
  res.json(await listView(req));
});

labSetupRouter.post('/tests', async (req, res) => {
  if (!canEdit(req)) throw forbidden('The lab, doctors and RMOs add tests.');
  const body = parse(createSchema, req.body);
  const fields = {};
  const checked = checkedFields(body, fields);
  const exists = await LabTestSetting.exists({ tenantId: req.tenantId, custom: true, name: { $regex: `^${body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (exists || LAB_TESTS.some((t) => t.name.toLowerCase() === body.name.trim().toLowerCase())) fields.name = 'A test with this name is already on the list.';
  if (Object.keys(fields).length) throw invalid(fields);
  const s = await LabTestSetting.create({
    tenantId: req.tenantId,
    key: `h_${randomBytes(4).toString('hex')}`,
    custom: true,
    who: body.who,
    name: body.name.trim(),
    group: body.group,
    sample: body.sample.trim(),
    fields: checked,
    department: body.department || 'other',
    tatHours: body.tatHours,
    urgentTatHours: body.urgentTatHours,
    outsideLab: body.outsideLab.trim(),
    active: body.active,
    updatedByName: req.user.name,
  });
  // Its line on the price list (₹0 until the hospital admin prices it), so an order bills it like any other test
  await PriceItem.updateOne(
    { tenantId: req.tenantId, key: `lab:${s.key}` },
    { $setOnInsert: { tenantId: req.tenantId, key: `lab:${s.key}`, name: s.name, group: 'lab', pricePaise: 0, builtIn: false, order: 5000, updatedByName: req.user.name } },
    { upsert: true },
  );
  await audit(req, 'LAB_TEST_CREATED', { details: auditOf(s) });
  res.status(201).json({ ...(await listView(req)), key: s.key });
});

labSetupRouter.put('/tests/:key', async (req, res) => {
  if (!canEdit(req)) throw forbidden('The lab, doctors and RMOs change tests.');
  const key = parse(z.string().max(40), req.params.key);
  const builtIn = testByKey.get(key);
  let s = await LabTestSetting.findOne({ tenantId: req.tenantId, key });
  if (!builtIn && !s?.custom) throw new HttpError(404, 'This test is not on the hospital\'s test list.', 'NOT_FOUND');
  const body = parse(builtIn ? updateBuiltInSchema : updateOwnSchema, req.body);
  if (body.version !== (s?.version ?? 1)) throw changedSince(s);
  const fields = {};
  if (!s) s = new LabTestSetting({ tenantId: req.tenantId, key, custom: false });
  const before = clinicalOf(s);
  if (builtIn) {
    // Only values of the test, only number values; an unchanged limit is not stored (the built-in one stays)
    const ranges = {};
    for (const [k, r] of Object.entries(body.fieldRanges)) {
      const f = builtIn.fields.find((x) => x.key === k);
      if (!f || f.type !== 'number') {
        fields[`fieldRanges.${k}`] = 'This test has no such number value.';
        continue;
      }
      const low = r.low === undefined ? f.low : r.low;
      const high = r.high === undefined ? f.high : r.high;
      if (low != null && high != null && low > high) fields[`fieldRanges.${k}`] = 'The lower limit must not be above the upper limit.';
      checkBands(r.bands, builtIn.who, `fieldRanges.${k}`, fields);
      const entry = {};
      if (low !== f.low) entry.low = low;
      if (high !== f.high) entry.high = high;
      if (r.range.trim() && r.range.trim() !== f.range) entry.range = r.range.trim();
      if (r.bands.length) entry.bands = r.bands;
      if (r.deltaPercent != null) entry.deltaPercent = r.deltaPercent;
      if (Object.keys(entry).length) ranges[k] = entry;
    }
    s.fieldRanges = ranges;
    s.markModified('fieldRanges');
  } else {
    const checked = checkedFields(body, fields);
    Object.assign(s, { who: body.who, name: body.name.trim(), group: body.group, sample: body.sample.trim(), fields: checked });
    s.markModified('fields');
  }
  if (Object.keys(fields).length) throw invalid(fields);
  Object.assign(s, { department: body.department || (builtIn ? '' : 'other'), tatHours: body.tatHours, urgentTatHours: body.urgentTatHours, outsideLab: body.outsideLab.trim(), active: body.active, updatedByName: req.user.name });
  const clinical = clinicalOf(s) !== before;
  if (clinical && !s.isNew) {
    s.version += 1;
    s.status = 'draft';
  }
  await s.save();
  if (!builtIn) await PriceItem.updateOne({ tenantId: req.tenantId, key: `lab:${key}` }, { $set: { name: s.name } });
  await audit(req, 'LAB_TEST_UPDATED', { details: auditOf(s, clinical ? { ranges: true } : {}) });
  res.json(await listView(req));
});

labSetupRouter.post('/tests/:key/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only a doctor approves a test and its usual ranges.');
  const key = parse(z.string().max(40), req.params.key);
  const body = parse(z.object({ confirm: z.literal(true, 'Please confirm that you checked the values and ranges'), version }).strict(), req.body);
  const builtIn = testByKey.get(key);
  let s = await LabTestSetting.findOne({ tenantId: req.tenantId, key });
  if (!builtIn && !s?.custom) throw new HttpError(404, 'This test is not on the hospital\'s test list.', 'NOT_FOUND');
  if (body.version !== (s?.version ?? 1)) throw changedSince(s);
  if (!s) s = new LabTestSetting({ tenantId: req.tenantId, key, custom: false }); // approving the built-in ranges as they are
  Object.assign(s, { status: 'approved', approvedVersion: s.version, approvedByName: req.user.name, approvedAt: req.now });
  await s.save();
  await audit(req, 'LAB_TEST_APPROVED', { details: auditOf(s) });
  res.json(await listView(req));
});

// ---------- The lab's settings ----------

const STAFF_ROLES = ['lab', 'doctor', 'rmo'];
async function settingsView(req) {
  const setup = await labSetup(req.tenantId);
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: STAFF_ROLES } }, { userId: 1, roles: 1 }).lean();
  const users = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  const staff = members
    .filter((m) => users.has(String(m.userId)))
    .map((m) => ({ id: String(m.userId), name: users.get(String(m.userId)), roles: m.roles.filter((r) => STAFF_ROLES.includes(r)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...setup, staff, canEdit: isDoctor(req) };
}

labSetupRouter.get('/settings', async (req, res) => {
  res.json(await settingsView(req));
});

labSetupRouter.put('/settings', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('A doctor changes the lab settings.');
  const body = parse(z.object({ verify: z.boolean(), verifierIds: z.array(objectId).max(50).default([]) }).strict(), req.body);
  const ids = [...new Set(body.verifierIds)];
  if (ids.length) {
    const ok = await Membership.countDocuments({ tenantId: req.tenantId, isActive: true, roles: { $in: STAFF_ROLES }, userId: { $in: ids } });
    if (ok !== ids.length) throw invalid({ verifierIds: 'Choose lab staff, doctors or RMOs of this hospital.' });
  }
  await LabSetup.updateOne({ tenantId: req.tenantId, set: 'lab' }, { $set: { verify: body.verify, verifierIds: ids, updatedByName: req.user.name } }, { upsert: true });
  await audit(req, 'LAB_SETTINGS_CHANGED', { details: { verify: body.verify, checkers: ids.length } });
  res.json(await settingsView(req));
});

// ---------- Referrers (Lab version 2 – docs/LAB_V2_PLAN.md) ----------
// Doctors and centres who refer walk-in patients: the lab, doctors and RMOs keep the list; everyone in the lab module
// reads it. No money is recorded for a referrer (commissions are not allowed).

const referrerSchema = z
  .object({
    kind: z.enum(['doctor', 'centre'], 'Choose a doctor or a centre'),
    name: safeText('Name', 120).refine((t) => t.trim().length >= 2, 'Write the name'),
    qualification: safeText('Qualification', 80).default(''),
    registrationNumber: safeText('Registration number', 40).default(''),
    phone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'Write the phone number in digits').default(''),
    address: safeText('Address', 200).default(''),
    active: z.boolean().default(true),
  })
  .strict();
const referrerView = (r) => ({ id: String(r._id), kind: r.kind, name: r.name, qualification: r.qualification ?? '', registrationNumber: r.registrationNumber ?? '', phone: r.phone ?? '', address: r.address ?? '', active: r.active !== false });

labSetupRouter.get('/referrers', async (req, res) => {
  const list = await Referrer.find({ tenantId: req.tenantId }).sort({ active: -1, name: 1 }).limit(1000).lean();
  res.json({ referrers: list.map(referrerView), canEdit: canEdit(req) });
});

labSetupRouter.post('/referrers', async (req, res) => {
  if (!canEdit(req)) throw forbidden('The lab, doctors and RMOs keep the list of referrers.');
  const body = parse(referrerSchema, req.body);
  const r = await Referrer.create({ tenantId: req.tenantId, ...body, name: body.name.trim(), updatedByName: req.user.name });
  await audit(req, 'LAB_REFERRER_CHANGED', { details: { referrerId: String(r._id), added: true } });
  res.status(201).json({ referrer: referrerView(r) });
});

labSetupRouter.put('/referrers/:id', async (req, res) => {
  if (!canEdit(req)) throw forbidden('The lab, doctors and RMOs keep the list of referrers.');
  const body = parse(referrerSchema, req.body);
  const r = await Referrer.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!r) throw new HttpError(404, 'This referrer was not found.', 'NOT_FOUND');
  Object.assign(r, { ...body, name: body.name.trim(), updatedByName: req.user.name });
  await r.save();
  await audit(req, 'LAB_REFERRER_CHANGED', { details: { referrerId: String(r._id), active: r.active } });
  res.json({ referrer: referrerView(r) });
});

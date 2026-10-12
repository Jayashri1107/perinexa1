import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { byListOrder, ensureLabPackages, packageJSON } from '../lab/labPackages.js';
import { testByKey } from '../lab/labTests.js';
import { LabPackage, MAX_DAY, MAX_PACKAGE_TESTS, PACKAGE_WHO } from '../models/LabPackage.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, objectId, parse } from '../utils/validate.js';
import { safeText } from '../utils/pcpndt.js';

// The hospital's test packages (/api/lab-packages): doctors, RMOs and nurses read them (doctors and RMOs order
// them on a patient's Lab tab); doctors add, edit, approve and stop using packages. A package holds no patient data.

const READERS = ['doctor', 'rmo', 'nurse'];
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const changedSince = (p, what) => new HttpError(409, `This package was changed (now version ${p.version}) after you opened it. ${what}`, 'CONFLICT');

const day = z.number('Enter a day of life (0 = the day of birth)').int().min(0).max(MAX_DAY);
const contentShape = {
  who: z.enum(PACKAGE_WHO, 'Choose whose tests these are'),
  name: safeText('Name', 120).refine((t) => t.length > 0, 'Give the package a name'),
  forWhom: safeText('For which patients', 300).default(''),
  about: safeText('Notes for doctors', 1000).default(''),
  fromDay: day.nullable().default(null),
  toDay: day.nullable().default(null),
  tests: z.array(z.string().max(40)).min(1, 'Choose at least one test').max(MAX_PACKAGE_TESTS, `At most ${MAX_PACKAGE_TESTS} tests in a package`),
};
const createSchema = z.object(contentShape).strict();
const copySchema = z.object({ copyFrom: objectId }).strict();
const updateSchema = z.object({ ...contentShape, version: z.number('The package version you edited is missing – please reload the page').int().positive() }).strict();
const approveSchema = z
  .object({
    confirm: z.literal(true, 'Please confirm that you checked the tests'),
    version: z.number('The package version you checked is missing – please reload the page').int().positive(),
  })
  .strict();
const activeSchema = z.object({ active: z.boolean('Say whether the package is in use') }).strict();

/** The checks a schema can't do: every test of the right kind, once; the day window only for babies, in order. */
function checked(data) {
  const fields = {};
  const tests = [...new Set(data.tests)];
  const wrong = tests.filter((k) => testByKey.get(k)?.who !== data.who);
  if (wrong.length) fields.tests = `${wrong.map((k) => testByKey.get(k)?.name ?? k).join(', ')}: not a test for ${data.who === 'newborn' ? 'a baby' : 'an adult'}.`;
  if (data.who === 'newborn') {
    if (data.fromDay == null) fields.fromDay = 'Enter the first day of life it fits (0 = the day of birth).';
    else if (data.toDay != null && data.toDay < data.fromDay) fields.toDay = 'The last day must be the same as or after the first day.';
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return { ...data, tests, ...(data.who === 'adult' ? { fromDay: null, toDay: null } : {}) };
}

const withRights = (req, p) => ({ ...packageJSON(p), canEdit: isDoctor(req), canApprove: isDoctor(req) });
const auditDetails = (p) => ({ packageId: String(p._id), name: p.name, version: p.version });

async function findPackage(req) {
  const { id } = parse(idParams, req.params);
  await ensureLabPackages(req.tenantId);
  const p = await LabPackage.findOne({ _id: id, tenantId: req.tenantId });
  if (!p) throw new HttpError(404, 'Test package not found.', 'NOT_FOUND');
  return p;
}

export const labPackagesRouter = Router();

labPackagesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('Test packages are for doctors, RMOs and nurses.');
  next();
});

labPackagesRouter.get('/', async (req, res) => {
  await ensureLabPackages(req.tenantId);
  const packages = await LabPackage.find({ tenantId: req.tenantId });
  res.json({ packages: packages.map(packageJSON).sort(byListOrder), canEdit: isDoctor(req) });
});

labPackagesRouter.get('/:id', async (req, res) => {
  res.json({ package: withRights(req, await findPackage(req)) });
});

// A doctor adds a package of the hospital's own, or copies one (as a new draft).
labPackagesRouter.post('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can add test packages.');
  let data;
  let copiedFrom = null;
  if (req.body?.copyFrom !== undefined) {
    ({ copyFrom: copiedFrom } = parse(copySchema, req.body));
    const from = await LabPackage.findOne({ _id: copiedFrom, tenantId: req.tenantId });
    if (!from) throw new HttpError(404, 'Package to copy not found.', 'NOT_FOUND');
    const c = from.toObject();
    data = { who: c.who, name: `Copy of ${c.name}`.slice(0, 120), forWhom: c.forWhom, about: c.about, fromDay: c.fromDay, toDay: c.toDay, tests: c.tests };
  } else {
    data = checked(parse(createSchema, req.body));
  }
  const p = await LabPackage.create({
    ...data,
    tenantId: req.tenantId,
    key: `pkg_${randomBytes(4).toString('hex')}`,
    origin: 'hospital',
    order: 1000,
    status: 'draft',
    version: 1,
    createdByName: req.user.name,
    updatedByName: req.user.name,
  });
  await audit(req, 'LAB_PACKAGE_CREATED', { details: { ...auditDetails(p), copiedFrom } });
  res.status(201).json({ package: withRights(req, p) });
});

// Editing always makes the package a draft again (a new version), so it must be approved again.
labPackagesRouter.put('/:id', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change test packages.');
  const p = await findPackage(req);
  const { version, ...rest } = parse(updateSchema, req.body);
  if (version !== p.version) throw changedSince(p, 'Please reload it and make your changes again.');
  Object.assign(p, checked(rest));
  p.version += 1;
  p.status = 'draft';
  p.builtInVersion = null;
  p.updatedByName = req.user.name;
  await p.save();
  await audit(req, 'LAB_PACKAGE_UPDATED', { details: auditDetails(p) });
  res.json({ package: withRights(req, p) });
});

labPackagesRouter.post('/:id/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can approve test packages.');
  const { version } = parse(approveSchema, req.body);
  const p = await findPackage(req);
  if (p.version !== version) throw changedSince(p, 'Please check the latest version before approving.');
  if (p.status === 'approved') return res.json({ package: withRights(req, p) });
  const at = req.now ?? new Date();
  const r = await LabPackage.updateOne(
    { _id: p._id, tenantId: req.tenantId, version, status: 'draft' },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedByName: req.user.name, approvedAt: at, approvedVersion: version }, $inc: { __v: 1 } },
  );
  const saved = await LabPackage.findOne({ _id: p._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    if (saved?.status === 'approved' && saved.version === version) return res.json({ package: withRights(req, saved) });
    throw changedSince(saved ?? p, 'Please check the latest version before approving.');
  }
  await audit(req, 'LAB_PACKAGE_APPROVED', { details: auditDetails(saved) });
  res.json({ package: withRights(req, saved) });
});

// In use or not: a package not in use is no longer offered when ordering tests (it is kept).
labPackagesRouter.patch('/:id/active', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change which test packages are in use.');
  const { active } = parse(activeSchema, req.body);
  const p = await findPackage(req);
  if (p.isActive !== active) {
    p.isActive = active;
    p.updatedByName = req.user.name;
    await p.save();
    await audit(req, active ? 'LAB_PACKAGE_ACTIVATED' : 'LAB_PACKAGE_DEACTIVATED', { details: auditDetails(p) });
  }
  res.json({ package: withRights(req, p) });
});

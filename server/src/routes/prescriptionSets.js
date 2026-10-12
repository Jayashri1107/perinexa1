import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { CARE_TYPES } from '../models/Patient.js';
import { MAX_SET_ITEMS, PrescriptionSet } from '../models/PrescriptionSet.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, objectId, parse } from '../utils/validate.js';
import { byListOrder, ensurePrescriptionSets, setJSON } from '../visits/prescriptionSets.js';
import { visitSchemas } from '../visits/visitSchemas.js';

// The hospital's ready-made prescription sets (/api/prescription-sets, Feature 8b): doctors and RMOs read them
// and add them to prescriptions; doctors add, edit, approve and stop using sets. A set holds no patient data.
// Its text ends up on pregnancy records, so it is checked for words about the baby's sex like a prescription.

const READERS = ['doctor', 'rmo'];
const isDoctor = (req) => hasRole(req.membership, 'doctor');
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const changedSince = (s, what) => new HttpError(409, `This set was changed (now version ${s.version}) after you opened it. ${what}`, 'CONFLICT');

const { item, words } = visitSchemas({ pcpndt: true });
const contentShape = {
  name: words('Name', 120).min(1, 'Give the set a name'),
  about: words('Notes for doctors', 1000).default(''),
  careTypes: z.array(z.enum(CARE_TYPES, 'Choose a type of care')).max(CARE_TYPES.length).default([]),
  items: z.array(item).max(MAX_SET_ITEMS, `A set can have at most ${MAX_SET_ITEMS} medicines`).default([]),
  notes: words('General instructions', 1000).default(''),
  investigations: words('Tests advised', 1000).default(''),
  advice: words('Advice', 2000).default(''),
};
const hasSomething = (s) => s.items.length > 0 || Boolean(s.notes || s.investigations || s.advice);
const SOMETHING = { message: 'Add at least one medicine, or tests or advice', path: ['items'] };

const newSetSchema = z.object(contentShape).strict().refine(hasSomething, SOMETHING);
const copySchema = z.object({ copyFrom: objectId }).strict();
const updateSchema = z
  .object({
    ...contentShape,
    // The version the person edited: a save based on an older version is refused (it would undo newer changes).
    version: z.number('The set version you edited is missing – please reload the page').int().positive(),
  })
  .strict()
  .refine(hasSomething, SOMETHING);
const approveSchema = z
  .object({
    confirm: z.literal(true, 'Please confirm that you checked every medicine and dose'),
    version: z.number('The set version you checked is missing – please reload the page').int().positive(),
  })
  .strict();
const activeSchema = z.object({ active: z.boolean('Say whether the set is in use') }).strict();

const withRights = (req, s) => ({ ...setJSON(s), canEdit: isDoctor(req), canApprove: isDoctor(req) });
const auditDetails = (s) => ({ setId: String(s._id), name: s.name, version: s.version });
const inCareOrder = (careTypes) => CARE_TYPES.filter((t) => careTypes.includes(t));

async function findSet(req) {
  const { id } = parse(idParams, req.params);
  await ensurePrescriptionSets(req.tenantId);
  const s = await PrescriptionSet.findOne({ _id: id, tenantId: req.tenantId });
  if (!s) throw new HttpError(404, 'Prescription set not found.', 'NOT_FOUND');
  return s;
}

export const prescriptionSetsRouter = Router();

prescriptionSetsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('Prescription sets are for doctors and RMOs.');
  next();
});

// Every set, in use or not (with their medicines: the Prescription tab adds them without asking again).
prescriptionSetsRouter.get('/', async (req, res) => {
  await ensurePrescriptionSets(req.tenantId);
  const sets = await PrescriptionSet.find({ tenantId: req.tenantId });
  res.json({ sets: sets.map(setJSON).sort(byListOrder), canEdit: isDoctor(req) });
});

prescriptionSetsRouter.get('/:id', async (req, res) => {
  res.json({ set: withRights(req, await findSet(req)) });
});

// A doctor adds a set of the hospital's own – written in the editor or saved from a prescription – or copies
// one (as a new draft).
prescriptionSetsRouter.post('/', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can add prescription sets.');
  let data;
  let copiedFrom = null;
  if (req.body?.copyFrom !== undefined) {
    ({ copyFrom: copiedFrom } = parse(copySchema, req.body));
    const from = await PrescriptionSet.findOne({ _id: copiedFrom, tenantId: req.tenantId });
    if (!from) throw new HttpError(404, 'Set to copy not found.', 'NOT_FOUND');
    const c = from.toObject();
    data = {
      name: `Copy of ${c.name}`.slice(0, 120),
      about: c.about,
      careTypes: c.careTypes,
      items: c.items.map(({ _id, ...it }) => it),
      notes: c.notes,
      investigations: c.investigations,
      advice: c.advice,
    };
  } else {
    data = parse(newSetSchema, req.body);
  }
  const s = await PrescriptionSet.create({
    ...data,
    careTypes: inCareOrder(data.careTypes),
    tenantId: req.tenantId,
    key: `set_${randomBytes(4).toString('hex')}`,
    origin: 'hospital',
    order: 1000,
    status: 'draft',
    version: 1,
    createdByName: req.user.name,
    updatedByName: req.user.name,
  });
  await audit(req, 'PRESCRIPTION_SET_CREATED', { details: { ...auditDetails(s), copiedFrom } });
  res.status(201).json({ set: withRights(req, s) });
});

// Editing always makes the set a draft again (a new version), so it must be approved again.
prescriptionSetsRouter.put('/:id', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change prescription sets.');
  const s = await findSet(req);
  const { version, ...data } = parse(updateSchema, req.body);
  if (version !== s.version) throw changedSince(s, 'Please reload it and make your changes again.');
  Object.assign(s, data, { careTypes: inCareOrder(data.careTypes) });
  s.version += 1;
  s.status = 'draft';
  s.builtInVersion = null; // the hospital's content now: built-in updates no longer replace it
  s.updatedByName = req.user.name;
  await s.save();
  await audit(req, 'PRESCRIPTION_SET_UPDATED', { details: auditDetails(s) });
  res.json({ set: withRights(req, s) });
});

// A doctor confirms every medicine and dose was checked and approves the set for use in the hospital.
prescriptionSetsRouter.post('/:id/approve', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can approve prescription sets.');
  const { version } = parse(approveSchema, req.body);
  const s = await findSet(req);
  if (s.version !== version) throw changedSince(s, 'Please check the latest version before approving.');
  if (s.status === 'approved') return res.json({ set: withRights(req, s) });
  // Approve exactly the version checked: a change saved meanwhile makes this update match nothing.
  const at = req.now ?? new Date();
  const r = await PrescriptionSet.updateOne(
    { _id: s._id, tenantId: req.tenantId, version, status: 'draft' },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedByName: req.user.name, approvedAt: at, approvedVersion: version }, $inc: { __v: 1 } },
  );
  const saved = await PrescriptionSet.findOne({ _id: s._id, tenantId: req.tenantId });
  if (r.matchedCount === 0) {
    if (saved?.status === 'approved' && saved.version === version) return res.json({ set: withRights(req, saved) });
    throw changedSince(saved ?? s, 'Please check the latest version before approving.');
  }
  await audit(req, 'PRESCRIPTION_SET_APPROVED', { details: auditDetails(saved) });
  res.json({ set: withRights(req, saved) });
});

// In use or not: a set not in use is no longer offered on the Prescription tab (it is kept).
prescriptionSetsRouter.patch('/:id/active', async (req, res) => {
  if (!isDoctor(req)) throw forbidden('Only doctors can change which prescription sets are in use.');
  const { active } = parse(activeSchema, req.body);
  const s = await findSet(req);
  if (s.isActive !== active) {
    s.isActive = active;
    s.updatedByName = req.user.name;
    await s.save();
    await audit(req, active ? 'PRESCRIPTION_SET_ACTIVATED' : 'PRESCRIPTION_SET_DEACTIVATED', { details: auditDetails(s) });
  }
  res.json({ set: withRights(req, s) });
});

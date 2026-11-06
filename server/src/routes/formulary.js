import { Router } from 'express';
import { z } from 'zod';
import { DOSE_BASES, FormularyItem, POPULATIONS, isVerified } from '../models/FormularyItem.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';

// The formulary (Clinical Requirements Group A, item 7): /api/formulary.
//  - doctors, RMOs, nurses and the pharmacist read it;
//  - doctors and the pharmacist add and change rows (a change is a new version and clears the confirmations);
//  - a doctor and the pharmacist each confirm a version; with both it is verified (who, when);
//  - POST /:id/dose works a dose out from the weight – only from a verified row; an unverified row calculates nothing.
// No patient data here. Rows are removed from use (isActive false), never deleted.

export const formularyRouter = Router();
const READERS = ['doctor', 'rmo', 'nurse', 'pharmacist'];
const EDITORS = ['doctor', 'pharmacist'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m, code = 'CONFLICT') => new HttpError(409, m, code);
const notFound = () => new HttpError(404, 'This formulary row was not found.', 'NOT_FOUND');

formularyRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The formulary is for doctors, RMOs, nurses and the pharmacist.');
  next();
});
const editor = (req) => {
  if (!hasRole(req.membership, ...EDITORS)) throw forbidden('Formulary rows are written and confirmed by doctors and the pharmacist.');
};

const view = (i, req) => ({
  id: String(i._id),
  name: i.name,
  form: i.form,
  strength: i.strength,
  route: i.route,
  population: i.population,
  indication: i.indication,
  doseBasis: i.doseBasis,
  doseMg: i.doseMg,
  frequency: i.frequency,
  maxSingleMg: i.maxSingleMg,
  maxDailyMg: i.maxDailyMg,
  highAlert: i.highAlert,
  notes: i.notes,
  source: i.source,
  version: i.version,
  isActive: i.isActive,
  verified: isVerified(i),
  confirmations: i.confirmations.filter((c) => c.version === i.version).map((c) => ({ role: c.role, byName: c.byName, at: c.at, mine: Boolean(req && String(c.by) === String(req.user._id)) })),
  updatedByName: i.updatedByName,
  updatedAt: i.updatedAt,
});

/** The dose from a verified row and a weight (kg): mg per dose, capped at the row's maximum single dose. PURE. */
export function doseFor(item, weightKg) {
  const raw = item.doseBasis === 'per_kg' ? item.doseMg * weightKg : item.doseMg;
  const capped = item.maxSingleMg != null && raw > item.maxSingleMg;
  const mg = Math.round((capped ? item.maxSingleMg : raw) * 100) / 100;
  return { mg, capped, frequency: item.frequency, maxDailyMg: item.maxDailyMg };
}

formularyRouter.get('/', async (req, res) => {
  const items = await FormularyItem.find({ tenantId: req.tenantId }).sort({ isActive: -1, name: 1, population: 1 }).lean();
  res.json({ items: items.map((i) => view(i, req)), editor: hasRole(req.membership, ...EDITORS) });
});

const num = (label) => z.union([z.null(), z.number(`${label} must be a number`).min(0, `${label} can't be below 0`).max(100000, `${label} is too high`)]);
const rowBody = z
  .object({
    name: z.string().trim().min(2, 'Write the medicine').max(120),
    form: z.string().trim().max(60).default(''),
    strength: z.string().trim().max(80).default(''),
    route: z.string().trim().max(40).default(''),
    population: z.enum(POPULATIONS, 'Choose for whom'),
    indication: z.string().trim().max(200).default(''),
    doseBasis: z.enum(DOSE_BASES, 'Choose per kg or a fixed dose'),
    doseMg: z.number('Enter the dose').positive('The dose must be above 0').max(100000),
    frequency: z.string().trim().max(80).default(''),
    maxSingleMg: num('The maximum single dose').default(null),
    maxDailyMg: num('The maximum daily dose').default(null),
    highAlert: z.boolean().default(false),
    notes: z.string().trim().max(1000).default(''),
    source: z.string().trim().min(3, 'Write where it comes from (the manual page or the reference)').max(300),
  })
  .strict();

formularyRouter.post('/', async (req, res) => {
  editor(req);
  const b = parse(rowBody, req.body);
  const i = await FormularyItem.create({ ...b, tenantId: req.tenantId, updatedByName: req.user.name });
  await audit(req, 'FORMULARY_ROW_ADDED', { details: { itemId: String(i._id), name: i.name } });
  res.status(201).json({ item: view(i, req) });
});

async function loadOne(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const i = await FormularyItem.findOne({ _id: id, tenantId: req.tenantId });
  if (!i) throw notFound();
  return i;
}

// A change: a new version, both confirmations cleared (the row is unverified until both confirm it again)
formularyRouter.put('/:id', async (req, res) => {
  editor(req);
  const i = await loadOne(req);
  const { version, ...b } = parse(rowBody.extend({ version: z.number().int(), isActive: z.boolean().default(true) }), req.body);
  if (version !== i.version) throw conflict(`${i.updatedByName} changed this row after you opened it. Reload, then make your change again.`);
  Object.assign(i, b, { version: i.version + 1, updatedByName: req.user.name });
  await i.save();
  await audit(req, 'FORMULARY_ROW_CHANGED', { details: { itemId: String(i._id), name: i.name, version: i.version } });
  res.json({ item: view(i, req) });
});

// A doctor's or the pharmacist's confirmation of the version they saw
formularyRouter.post('/:id/confirm', async (req, res) => {
  editor(req);
  const i = await loadOne(req);
  const { version } = parse(z.object({ version: z.number().int() }).strict(), req.body);
  if (version !== i.version) throw conflict('This row was changed after you opened it. Reload and check it again.');
  if (!i.isActive) throw conflict('This row is not in use.');
  // A person with both roles confirms as the role not yet confirmed (one person never makes both)
  const done = i.confirmations.filter((c) => c.version === i.version);
  if (done.some((c) => String(c.by) === String(req.user._id))) throw conflict('You have already confirmed this version – the other confirmation is by another person.');
  const roles = EDITORS.filter((r) => hasRole(req.membership, r) && !done.some((c) => c.role === r));
  if (!roles.length) throw conflict('This version already has that confirmation.');
  i.confirmations.push({ by: req.user._id, byName: req.user.name, role: roles[0], at: req.now ?? new Date(), version: i.version });
  await i.save();
  await audit(req, 'FORMULARY_ROW_CONFIRMED', { details: { itemId: String(i._id), name: i.name, version: i.version, role: roles[0], verified: isVerified(i) } });
  res.json({ item: view(i, req) });
});

// A dose from the weight – only from a verified row
formularyRouter.post('/:id/dose', async (req, res) => {
  const i = await loadOne(req);
  const { weightKg } = parse(z.object({ weightKg: z.number('Enter the weight').positive('The weight must be above 0').max(250, 'The weight looks too high') }).strict(), req.body);
  if (!i.isActive || !isVerified(i)) throw conflict('This row is not verified by a doctor and the pharmacist, so no dose is worked out from it.', 'NOT_VERIFIED');
  await audit(req, 'FORMULARY_DOSE_WORKED_OUT', { details: { itemId: String(i._id), name: i.name, version: i.version } });
  res.json({ dose: doseFor(i, weightKg), item: view(i, req) });
});

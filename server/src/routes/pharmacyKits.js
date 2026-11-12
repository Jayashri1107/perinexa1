import { Router } from 'express';
import { z } from 'zod';
import { Kit, Medicine, StockBatch } from '../models/Pharmacy.js';
import { hasRole } from '../models/Membership.js';
import { usableMatch } from '../pharmacy/pharmacyService.js';
import { medicineView } from '../pharmacy/pharmacyHttp.js';
import { hospitalToday } from '../careplans/dates.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';

// PH14 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 4): kits – /api/pharmacy-kits. A doctor or the hospital admin
// makes and changes them; the pharmacist reads them and fills an issue from one (the issue's checks are unchanged).
// Perinexa ships none. Nothing about a patient is read here; no price is shown.

export const pharmacyKitsRouter = Router();
const KIT_WRITERS = ['doctor', 'admin'];
const KIT_READERS = [...KIT_WRITERS, 'pharmacist'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');

pharmacyKitsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...KIT_READERS)) throw forbidden('Kits are for doctors, the hospital admin and the pharmacist.');
  next();
});
const writer = (req) => {
  if (!hasRole(req.membership, ...KIT_WRITERS)) throw forbidden('A kit is made by a doctor or the hospital admin.');
};

const medicineWords = (m) => ({ id: String(m._id), name: m.name, generic: m.generic ?? '', strength: m.strength ?? '', form: m.form, unit: m.unit, kind: m.kind ?? 'medicine', active: m.active !== false });

/** The kits with their lines' medicines; for the pharmacist also what is usable in stock of each (to see a short line). */
async function kitViews(req, kits) {
  const ids = [...new Set(kits.flatMap((k) => k.lines.map((l) => String(l.medicineId))))];
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: ids } }).lean()).map((m) => [String(m._id), m]));
  const stock = new Map();
  const pharmacist = hasRole(req.membership, 'pharmacist');
  if (pharmacist && ids.length) {
    const rows = await StockBatch.aggregate([
      { $match: { tenantId: req.tenantId, medicineId: { $in: [...meds.values()].map((m) => m._id) }, ...usableMatch(hospitalToday(req.now)) } },
      { $group: { _id: '$medicineId', qty: { $sum: '$qtyLeft' } } },
    ]);
    for (const r of rows) stock.set(String(r._id), r.qty);
  }
  return kits.map((k) => ({
    id: String(k._id),
    name: k.name,
    note: k.note ?? '',
    active: k.active,
    updatedByName: k.updated?.byName ?? k.created?.byName ?? '',
    lines: k.lines.map((l) => {
      const m = meds.get(String(l.medicineId));
      // The pharmacist gets the counter's own medicine shape (to fill an issue); others the words only
      const words = m ? (pharmacist ? medicineView(m, stock.get(String(l.medicineId)) ?? 0) : medicineWords(m)) : { id: String(l.medicineId), name: 'Medicine not found', active: false };
      return { medicine: words, qty: l.qty, ...(pharmacist ? { inStock: stock.get(String(l.medicineId)) ?? 0 } : {}) };
    }),
  }));
}

pharmacyKitsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ active: z.enum(['1', '0']).optional() }).strict(), req.query);
  const kits = await Kit.find({ tenantId: req.tenantId, ...(q.active === '1' ? { active: true } : {}) }).sort({ name: 1 }).lean();
  res.json({ kits: await kitViews(req, kits), canEdit: hasRole(req.membership, ...KIT_WRITERS) });
});

// Finding a medicine or item for a kit (doctors and the admin have no pharmacy screens)
pharmacyKitsRouter.get('/search', async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(2).max(60) }).strict(), req.query);
  const rx = new RegExp(escapeRegex(q.q), 'i');
  const list = await Medicine.find({ tenantId: req.tenantId, active: true, $or: [{ name: rx }, { generic: rx }] }).sort({ name: 1 }).limit(20).lean();
  res.json({ medicines: list.map(medicineWords) });
});

const kitBody = z
  .object({
    name: z.string().trim().min(2, 'Name the kit.').max(80),
    note: z.string().trim().max(300).default(''),
    lines: z
      .array(z.object({ medicineId: objectId, qty: z.number().int().min(1, 'At least 1.').max(1000) }).strict())
      .min(1, 'Add at least one medicine or item.')
      .max(40),
    active: z.boolean().default(true),
  })
  .strict();

async function checkLines(req, body) {
  const ids = body.lines.map((l) => String(l.medicineId));
  if (new Set(ids).size !== ids.length) throw Object.assign(new HttpError(400, 'A medicine is in the kit twice: add the quantities together.', 'VALIDATION'), { fields: { lines: 'A medicine is listed twice.' } });
  const found = await Medicine.find({ tenantId: req.tenantId, _id: { $in: ids } }, { active: 1, name: 1 }).lean();
  if (found.length !== ids.length) throw new HttpError(400, 'A medicine of the kit was not found.', 'VALIDATION');
  const stopped = found.filter((m) => m.active === false);
  if (stopped.length) throw Object.assign(new HttpError(400, `${stopped.map((m) => m.name).join(', ')} is no longer used: take it out of the kit.`, 'VALIDATION'), { fields: { lines: 'A medicine is no longer used.' } });
}
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now });

pharmacyKitsRouter.post('/', async (req, res) => {
  writer(req);
  const body = parse(kitBody, req.body);
  await checkLines(req, body);
  const kit = await Kit.create({ tenantId: req.tenantId, ...body, created: stamp(req) });
  await audit(req, 'PHARMACY_KIT_CHANGED', { details: { kitId: String(kit._id), name: kit.name, added: true, lines: kit.lines.length } });
  res.status(201).json({ kit: (await kitViews(req, [kit.toObject()]))[0] });
});

pharmacyKitsRouter.put('/:id', async (req, res) => {
  writer(req);
  const kit = await Kit.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!kit) throw new HttpError(404, 'Kit not found.', 'NOT_FOUND');
  const body = parse(kitBody, req.body);
  // A kit being stopped keeps its lines as they were, even one with a medicine no longer used
  if (body.active) await checkLines(req, body);
  Object.assign(kit, body, { updated: stamp(req) });
  await kit.save();
  await audit(req, 'PHARMACY_KIT_CHANGED', { details: { kitId: String(kit._id), name: kit.name, lines: kit.lines.length, ...(body.active ? {} : { stopped: true }) } });
  res.json({ kit: (await kitViews(req, [kit.toObject()]))[0] });
});

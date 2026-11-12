import { Router } from 'express';
import { z } from 'zod';
import { addDays, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { pharmacyWitnessField, pharmacyWitnessName } from '../auth/witness.js';
import { Admission } from '../models/Admission.js';
import { Membership, hasRole } from '../models/Membership.js';
import { LOCATION_KINDS, LocationCheck, Medicine, StockBatch, StockLocation } from '../models/Pharmacy.js';
import { User } from '../models/User.js';
import { CONTROLLED } from '../pharmacy/pharmacyRules.js';
import { countStock, createInvoice, isExpired, moveStock, writeOff } from '../pharmacy/pharmacyService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientById } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';

// PH13 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 4): stock kept outside the pharmacy – /api/stock-places.
//   - The hospital admin or a doctor makes the places (labour room, theatre, a ward, an emergency tray) and names their
//     staff. Perinexa ships none beyond the pharmacy (a batch with no place).
//   - The pharmacist moves stock to a place and back: a copy of the batch at the place, two moves (transfer_out and
//     transfer_in), the medicine's total unchanged; a narcotic or Schedule X move needs a witness who signs in.
//   - The place's staff and the pharmacist check a place: each batch counted, expired stock taken out (written off).
//   - The place's staff use its stock for an admitted patient they may chart for (the nursing chart's rule): a
//     pharmacy issue invoice on her bill, from the place's batches, with the doctor who ordered it. They see names,
//     batches and quantities – never a price or a purchase.

export const stockPlacesRouter = Router();
const PLACE_ROLES = ['admin', 'doctor', 'rmo', 'nurse', 'pharmacist'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const bad = (m, fields) => Object.assign(new HttpError(400, m, 'VALIDATION'), fields ? { fields } : {});
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now });
const writer = (req) => hasRole(req.membership, 'admin', 'doctor');
const pharmacist = (req) => hasRole(req.membership, 'pharmacist');
const onStaff = (req, place) => place.staffIds.some((id) => String(id) === String(req.user._id));

stockPlacesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...PLACE_ROLES)) throw forbidden('Places that hold stock are for doctors, RMOs, nurses, the pharmacist and the hospital admin.');
  next();
});

async function loadPlace(req, id = req.params.id) {
  const place = await StockLocation.findOne({ tenantId: req.tenantId, _id: parse(objectId, id) });
  if (!place) throw new HttpError(404, 'Place not found.', 'NOT_FOUND');
  return place;
}
/** Who may see a place's stock: its staff, the pharmacist, the admin and doctors. */
function canSee(req, place) {
  if (!(writer(req) || pharmacist(req) || onStaff(req, place))) throw forbidden('This place’s stock is for its staff and the pharmacist.');
}

/** The place's batches – names, batch numbers, expiry and quantities only (no prices). */
async function placeStock(req, place) {
  const today = hospitalToday(req.now);
  const batches = await StockBatch.find({ tenantId: req.tenantId, locationId: place._id, qtyLeft: { $gt: 0 } }).sort({ expiry: 1 }).lean();
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: batches.map((b) => b.medicineId) } }, { name: 1, strength: 1, unit: 1, schedule: 1, kind: 1 }).lean()).map((m) => [String(m._id), m]));
  return batches.map((b) => {
    const m = meds.get(String(b.medicineId));
    return { batchId: String(b._id), medicineId: String(b.medicineId), name: m ? [m.name, m.strength].filter(Boolean).join(' ') : '', unit: m?.unit ?? '', schedule: m?.schedule ?? '', batch: b.batch, expiry: isoDay(b.expiry).slice(0, 7), expired: isExpired(b, today), hold: Boolean(b.hold), qty: b.qtyLeft };
  });
}

async function lastChecks(req, ids) {
  const rows = await LocationCheck.aggregate([{ $match: { tenantId: req.tenantId, locationId: { $in: ids } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$locationId', at: { $first: '$created.at' }, byName: { $first: '$created.byName' } } }]);
  return new Map(rows.map((r) => [String(r._id), { at: r.at, byName: r.byName }]));
}
function placeView(req, p, last, staffNames) {
  const today = hospitalToday(req.now);
  const due = last ? addDays(utcDay(last.at), p.checkEveryDays) : null;
  return {
    id: String(p._id),
    name: p.name,
    kind: p.kind,
    checkEveryDays: p.checkEveryDays,
    active: p.active,
    staff: p.staffIds.map((id) => ({ id: String(id), name: staffNames.get(String(id)) ?? '' })),
    lastCheck: last ?? null,
    checkOverdue: p.active && (!last || due < utcDay(today)),
    mine: onStaff(req, p),
  };
}

stockPlacesRouter.get('/', async (req, res) => {
  const places = await StockLocation.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean();
  const shown = writer(req) || pharmacist(req) ? places : places.filter((p) => onStaff(req, p));
  const last = await lastChecks(req, shown.map((p) => p._id));
  const staffNames = new Map((await User.find({ _id: { $in: shown.flatMap((p) => p.staffIds) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  res.json({ places: shown.map((p) => placeView(req, p, last.get(String(p._id)), staffNames)), canEdit: writer(req), canMove: pharmacist(req), kinds: LOCATION_KINDS });
});

// The staff who may be named for a place: the hospital's doctors, RMOs and nurses
stockPlacesRouter.get('/staff', async (req, res) => {
  if (!writer(req)) throw forbidden('Places are made by a doctor or the hospital admin.');
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: ['doctor', 'rmo', 'nurse'] } }, { userId: 1, roles: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1 }).sort({ name: 1 }).lean();
  const roleOf = new Map(members.map((m) => [String(m.userId), m.roles.filter((r) => ['doctor', 'rmo', 'nurse'].includes(r)).join(', ')]));
  res.json({ staff: users.map((u) => ({ id: String(u._id), name: u.name, roles: roleOf.get(String(u._id)) ?? '' })) });
});

const placeBody = z
  .object({
    name: z.string().trim().min(2, 'Name the place.').max(80),
    kind: z.enum(LOCATION_KINDS).default('other'),
    checkEveryDays: z.number().int().min(1).max(90).default(7),
    staffIds: z.array(objectId).max(100).default([]),
    active: z.boolean().default(true),
  })
  .strict();
async function checkStaff(req, ids) {
  const ok = await Membership.countDocuments({ tenantId: req.tenantId, isActive: true, userId: { $in: ids }, roles: { $in: ['doctor', 'rmo', 'nurse'] } });
  if (ok !== new Set(ids.map(String)).size) throw bad('The staff of a place are doctors, RMOs and nurses of this hospital.', { staffIds: 'Choose doctors, RMOs and nurses of this hospital.' });
}

stockPlacesRouter.post('/', async (req, res) => {
  if (!writer(req)) throw forbidden('Places are made by a doctor or the hospital admin.');
  const body = parse(placeBody, req.body);
  await checkStaff(req, body.staffIds);
  const p = await StockLocation.create({ tenantId: req.tenantId, ...body, created: stamp(req) });
  await audit(req, 'STOCK_PLACE_CHANGED', { details: { placeId: String(p._id), name: p.name, added: true, staff: p.staffIds.length } });
  res.status(201).json({ place: placeView(req, p.toObject(), null, new Map()) });
});

stockPlacesRouter.put('/:id', async (req, res) => {
  if (!writer(req)) throw forbidden('Places are changed by a doctor or the hospital admin.');
  const p = await loadPlace(req);
  const body = parse(placeBody, req.body);
  await checkStaff(req, body.staffIds);
  if (!body.active && (await StockBatch.exists({ tenantId: req.tenantId, locationId: p._id, qtyLeft: { $gt: 0 } }))) throw new HttpError(409, 'This place still holds stock: the pharmacist takes it back first.', 'CONFLICT');
  Object.assign(p, body, { updated: stamp(req) });
  await p.save();
  await audit(req, 'STOCK_PLACE_CHANGED', { details: { placeId: String(p._id), name: p.name, staff: p.staffIds.length, ...(body.active ? {} : { stopped: true }) } });
  res.json({ place: placeView(req, p.toObject(), null, new Map()) });
});

stockPlacesRouter.get('/:id', async (req, res) => {
  const p = await loadPlace(req);
  canSee(req, p);
  const checks = await LocationCheck.find({ tenantId: req.tenantId, locationId: p._id }).sort({ createdAt: -1 }).limit(10).lean();
  const staffNames = new Map((await User.find({ _id: { $in: p.staffIds } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  res.json({
    place: placeView(req, p.toObject(), checks[0] ? { at: checks[0].created.at, byName: checks[0].created.byName } : null, staffNames),
    stock: await placeStock(req, p),
    checks: checks.map((c) => ({ at: c.created.at, byName: c.created.byName, witness: c.witness ?? '', note: c.note ?? '', differences: c.lines.filter((l) => l.found !== l.expected).length, expiredOut: c.lines.filter((l) => l.expiredOut).length })),
    can: { move: pharmacist(req) && p.active, check: (pharmacist(req) || onStaff(req, p)) && p.active, use: onStaff(req, p) && p.active },
  });
});

// ---------- Moving stock: the pharmacist ----------

/** A copy of a batch at another place (or the same batch number back in the pharmacy, merged with one there). */
async function destinationBatch(req, from, locationId) {
  const same = await StockBatch.findOne({ tenantId: req.tenantId, medicineId: from.medicineId, batch: from.batch, expiry: from.expiry, mrpPaise: from.mrpPaise, costPaise: from.costPaise, locationId: locationId ?? null, hold: from.hold ? { $ne: null } : null }).lean();
  if (same) return same;
  const { _id, createdAt, updatedAt, __v, qtyLeft, qtyIn, locationId: _l, fromBatchId: _f, released, ...copy } = from;
  return (await StockBatch.create({ ...copy, released: [], qtyIn: 0, qtyLeft: 0, locationId: locationId ?? null, fromBatchId: from.fromBatchId ?? from._id })).toObject();
}

async function transfer(req, from, toPlace, qty, witness) {
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: from.medicineId }, { name: 1, schedule: 1 }).lean();
  if (CONTROLLED.includes(m.schedule) && !witness) throw bad(`${m.name} is a controlled medicine: a second person who checked the move signs in for it.`, { 'witness.email': 'A second person (pharmacist, doctor, RMO or nurse) types their email and password.' });
  const witnessName = CONTROLLED.includes(m.schedule) ? await pharmacyWitnessName(req, witness, 'stock_place_move') : '';
  if (from.qtyLeft < qty) throw new HttpError(409, `Batch ${from.batch}: only ${from.qtyLeft} left.`, 'OUT_OF_STOCK');
  const fromPlace = from.locationId ? await StockLocation.findOne({ tenantId: req.tenantId, _id: from.locationId }, { name: 1 }).lean() : null;
  const fromName = fromPlace?.name ?? '';
  const toName = toPlace?.name ?? '';
  const dest = await destinationBatch(req, from, toPlace?._id ?? null);
  await moveStock(req, from, -qty, { kind: 'transfer_out', reason: `Moved to ${toName || 'the pharmacy'}`, witness: witnessName, place: fromName, otherPlace: toName || 'Pharmacy' });
  try {
    await moveStock(req, dest, qty, { kind: 'transfer_in', reason: `Moved from ${fromName || 'the pharmacy'}`, witness: witnessName, place: toName, otherPlace: fromName || 'Pharmacy' });
  } catch (err) {
    await moveStock(req, from, qty, { kind: 'transfer_in', reason: 'Move not completed', place: fromName }).catch(() => {});
    throw err;
  }
  await audit(req, 'STOCK_TRANSFERRED', { details: { medicineId: String(from.medicineId), batch: from.batch, qty, from: fromName || 'Pharmacy', to: toName || 'Pharmacy', ...(witnessName ? { witness: witnessName } : {}) } });
  return { name: m.name, batch: from.batch, qty, from: fromName || 'Pharmacy', to: toName || 'Pharmacy' };
}

const moveBody = z.object({ batchId: objectId, qty: z.number().int().min(1).max(100000), witness: pharmacyWitnessField }).strict();

// From the pharmacy to this place
stockPlacesRouter.post('/:id/move-in', async (req, res) => {
  if (!pharmacist(req)) throw forbidden('The pharmacist moves stock to a place.');
  const p = await loadPlace(req);
  if (!p.active) throw new HttpError(409, 'This place is no longer used.', 'CONFLICT');
  const body = parse(moveBody, req.body);
  const b = await StockBatch.findOne({ tenantId: req.tenantId, _id: body.batchId, locationId: null }).lean();
  if (!b) throw bad('Choose a batch kept in the pharmacy.');
  if (b.hold) throw new HttpError(409, `Batch ${b.batch} is on hold: it is not moved.`, 'ON_HOLD');
  if (isExpired(b, hospitalToday(req.now))) throw new HttpError(409, `Batch ${b.batch} has expired: it is not moved.`, 'EXPIRED');
  res.status(201).json({ moved: await transfer(req, b, p, body.qty, body.witness || null) });
});

// From this place back to the pharmacy (also expired or held stock, to be written off or returned there)
stockPlacesRouter.post('/:id/move-out', async (req, res) => {
  if (!pharmacist(req)) throw forbidden('The pharmacist takes stock back from a place.');
  const p = await loadPlace(req);
  const body = parse(moveBody, req.body);
  const b = await StockBatch.findOne({ tenantId: req.tenantId, _id: body.batchId, locationId: p._id }).lean();
  if (!b) throw bad('Choose a batch kept at this place.');
  res.status(201).json({ moved: await transfer(req, b, null, body.qty, body.witness || null) });
});

// ---------- Checking a place: its staff or the pharmacist ----------
stockPlacesRouter.post('/:id/checks', async (req, res) => {
  const p = await loadPlace(req);
  if (!(pharmacist(req) || onStaff(req, p))) throw forbidden('A place is checked by its staff or the pharmacist.');
  const body = parse(z.object({ lines: z.array(z.object({ batchId: objectId, found: z.number().int().min(0).max(100000) }).strict()).max(500), note: z.string().trim().max(300).default(''), witness: pharmacyWitnessField }).strict(), req.body);
  const today = hospitalToday(req.now);
  const batches = await StockBatch.find({ tenantId: req.tenantId, locationId: p._id, qtyLeft: { $gt: 0 } }).lean();
  const found = new Map(body.lines.map((l) => [String(l.batchId), l.found]));
  if (batches.some((b) => !found.has(String(b._id)))) throw bad('Count every batch of the place (write 0 for one that is not there).', { lines: 'Every batch needs a count.' });
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: batches.map((b) => b.medicineId) } }, { name: 1, schedule: 1 }).lean()).map((m) => [String(m._id), m]));
  const controlledDiff = batches.some((b) => CONTROLLED.includes(meds.get(String(b.medicineId))?.schedule) && (found.get(String(b._id)) !== b.qtyLeft || isExpired(b, today)));
  if (controlledDiff && !body.witness) throw bad('A narcotic or Schedule X count differs or is taken out: a second person who checked it signs in.', { 'witness.email': 'A second person (pharmacist, doctor, RMO or nurse) types their email and password.' });
  const witnessName = controlledDiff ? await pharmacyWitnessName(req, body.witness, 'stock_place_check') : '';
  const lines = [];
  for (const b of batches) {
    const m = meds.get(String(b.medicineId));
    const n = found.get(String(b._id));
    const expired = isExpired(b, today);
    if (n !== b.qtyLeft) await countStock(req, b, n, `Check of ${p.name}`, witnessName, m);
    // Expired stock is taken out of the place (written off as expired)
    if (expired && n > 0) await writeOff(req, { ...b, qtyLeft: n }, n, `Expired, taken out at the check of ${p.name}`, witnessName, 'expired');
    lines.push({ batchId: b._id, medicineId: b.medicineId, name: m?.name ?? '', batch: b.batch, expected: b.qtyLeft, found: n, expiredOut: expired && n > 0 });
  }
  const c = await LocationCheck.create({ tenantId: req.tenantId, locationId: p._id, lines, note: body.note, witness: witnessName, created: stamp(req) });
  await audit(req, 'STOCK_PLACE_CHECKED', { details: { placeId: String(p._id), name: p.name, batches: lines.length, differences: lines.filter((l) => l.found !== l.expected).length, expiredOut: lines.filter((l) => l.expiredOut).length } });
  res.status(201).json({ check: { at: c.created.at, byName: c.created.byName, differences: lines.filter((l) => l.found !== l.expected).length, expiredOut: lines.filter((l) => l.expiredOut).length } });
});

// ---------- Using a place's stock for a patient: its staff ----------

/** The admitted patients the place's staff may chart for (the nursing chart's rule), for the picker. */
stockPlacesRouter.get('/:id/patients', async (req, res) => {
  const p = await loadPlace(req);
  if (!onStaff(req, p)) throw forbidden('A place’s stock is used by its staff.');
  const stays = await Admission.find({ tenantId: req.tenantId, status: 'admitted' }, { patientId: 1, ward: 1, bed: 1 }).lean();
  const out = [];
  for (const s of stays) {
    const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now }, s.patientId).catch(() => null);
    if (patient && patientAccess(req, patient).recordVitals) out.push({ id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn, ward: s.ward ?? '', bed: s.bed ?? '' });
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({ patients: out, doctors: await orderingDoctors(req) });
});

async function orderingDoctors(req) {
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: ['doctor', 'rmo'] } }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1, 'professional.registrationNumber': 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, reg: u.professional?.registrationNumber ?? '' }));
}

stockPlacesRouter.post('/:id/use', async (req, res) => {
  const p = await loadPlace(req);
  if (!onStaff(req, p)) throw forbidden('A place’s stock is used by its staff.');
  if (!p.active) throw new HttpError(409, 'This place is no longer used.', 'CONFLICT');
  const body = parse(
    z
      .object({
        patientId: objectId,
        orderedById: objectId.optional(),
        lines: z.array(z.object({ medicineId: objectId, qty: z.number().int().min(1).max(1000), batchId: objectId.optional() }).strict()).min(1, 'Add at least one medicine or item.').max(30),
      })
      .strict(),
    req.body,
  );
  const patient = await loadPatientById({ tenantId: req.tenantId, now: req.now }, body.patientId).catch(() => null);
  if (!patient || !patientAccess(req, patient).recordVitals) throw forbidden('Only for a patient you may chart for.');
  const orderedId = body.orderedById ?? (hasRole(req.membership, 'doctor', 'rmo') ? req.user._id : null);
  const doctor = orderedId ? (await orderingDoctors(req)).find((d) => d.id === String(orderedId)) : null;
  if (!doctor) throw bad('Choose the doctor who ordered it.', { orderedById: 'Choose the doctor who ordered it.' });
  const inv = await createInvoice(req, { kind: 'issue', patientId: patient._id, lines: body.lines, discountPercent: 0, discountReason: '', rxSeen: false, _place: { id: p._id, name: p.name }, _orderedBy: { userId: doctor.id, name: doctor.name, reg: doctor.reg } });
  await audit(req, 'STOCK_PLACE_USED', { details: { patientId: String(patient._id), mrn: patient.mrn, placeId: String(p._id), place: p.name, invoiceId: String(inv._id), number: inv.number, lines: inv.lines.length, controlled: inv.lines.some((l) => CONTROLLED.includes(l.schedule)) } });
  // Names, batches and quantities only – the price goes on her bill, not to the ward
  res.status(201).json({ used: { number: inv.number, place: p.name, orderedBy: doctor.name, lines: inv.lines.map((l) => ({ name: l.name, batch: l.batch, qty: l.qty })) } });
});

import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { nextNumber } from '../models/Counter.js';
import { Membership, hasRole } from '../models/Membership.js';
import { Medicine, StockBatch } from '../models/Pharmacy.js';
import { User } from '../models/User.js';
import { WardRequest } from '../models/WardRequest.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';

// PH12 (docs/PHARMACY_BUILD_NOTE.md): the ward asks the pharmacy on screen – /api/patients/:id/ward-requests.
// Who asks: those who may chart for her (nurses, her doctor, RMOs – the nursing chart's rule, routes/admissions.js),
// for her current stay only. They pick from the stock list and see what doctors see while prescribing – in stock,
// low, not in stock – never a quantity or a price. The pharmacist answers in Pharmacy → Ward requests.

export const wardRequestsRouter = Router({ mergeParams: true });
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const ORDERING_ROLES = ['doctor', 'rmo'];

async function herStay(req) {
  const patient = await loadPatientForPlan(req);
  if (!patientAccess(req, patient).recordVitals) throw forbidden('Only nurses, her doctor and RMOs ask the pharmacy for her.');
  const stay = await Admission.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'admitted' }).lean();
  return { patient, stay };
}

const padded = (n) => `WR-${String(n).padStart(6, '0')}`;
/** What the ward sees of a request: names and quantities, never a price. */
export const wardRequestView = (r) => ({
  id: String(r._id),
  number: r.number,
  patientId: String(r.patientId),
  urgent: r.urgent,
  note: r.note ?? '',
  status: r.status,
  orderedBy: { name: r.orderedBy?.name ?? '', reg: r.orderedBy?.reg ?? '' },
  requested: { byName: r.requested?.byName ?? '', at: r.requested?.at },
  lines: r.lines.map((l) => ({ medicineId: String(l.medicineId), name: l.name, qty: l.qty, issuedQty: l.issuedQty ?? 0, refused: l.refused ? { reason: l.refused.reason, byName: l.refused.byName, at: l.refused.at } : null })),
  issues: (r.issues ?? []).map((i) => ({ number: i.number, byName: i.byName, at: i.at })),
  cancelled: r.cancelled ? { reason: r.cancelled.reason, byName: r.cancelled.byName, at: r.cancelled.at } : null,
});

/** In stock / low / not in stock for each medicine – the doctors' words (routes/pharmacyStock.js groupStatus). */
async function stockWords(req, meds) {
  const rows = await StockBatch.aggregate([
    { $match: { tenantId: req.tenantId, medicineId: { $in: meds.map((m) => m._id) }, qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(hospitalToday(req.now)) }, hold: null } },
    { $group: { _id: '$medicineId', qty: { $sum: '$qtyLeft' } } },
  ]);
  const usable = new Map(rows.map((r) => [String(r._id), r.qty]));
  return new Map(meds.map((m) => {
    const q = usable.get(String(m._id)) ?? 0;
    return [String(m._id), q > (m.reorderLevel ?? 0) ? 'in' : q > 0 ? 'low' : 'out'];
  }));
}

// Her requests (this stay first), and whether she is admitted now
wardRequestsRouter.get('/', async (req, res) => {
  const { patient, stay } = await herStay(req);
  const list = await WardRequest.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(50).lean();
  const doctors = await orderingDoctors(req);
  res.json({ admitted: Boolean(stay), requests: list.map(wardRequestView), doctors, me: hasRole(req.membership, ...ORDERING_ROLES) ? String(req.user._id) : null });
});

// The stock list for the ward: name, form, strength and the doctors' stock word – no quantity, no price
wardRequestsRouter.get('/medicines', async (req, res) => {
  await herStay(req);
  const q = parse(z.object({ q: z.string().trim().min(2).max(60) }).strict(), req.query);
  const rx = new RegExp(escapeRegex(q.q), 'i');
  const meds = await Medicine.find({ tenantId: req.tenantId, active: true, $or: [{ name: rx }, { generic: rx }] }, { name: 1, generic: 1, form: 1, strength: 1, unit: 1, kind: 1, reorderLevel: 1 }).sort({ name: 1 }).limit(20).lean();
  const words = await stockWords(req, meds);
  res.json({ medicines: meds.map((m) => ({ id: String(m._id), name: m.name, generic: m.generic ?? '', form: m.form, strength: m.strength ?? '', unit: m.unit, kind: m.kind ?? 'medicine', stock: words.get(String(m._id)) })) });
});

/** The doctors and RMOs of the hospital who may have ordered (active members). */
async function orderingDoctors(req) {
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: ORDERING_ROLES } }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1, 'professional.registrationNumber': 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, reg: u.professional?.registrationNumber ?? '' }));
}

const askSchema = z
  .object({
    lines: z
      .array(z.object({ medicineId: objectId, qty: z.number().int().min(1, 'At least 1.').max(1000) }).strict())
      .min(1, 'Add at least one medicine.')
      .max(30),
    urgent: z.boolean().default(false),
    note: z.string().trim().max(300).default(''),
    orderedById: objectId.optional(), // a nurse names the doctor who ordered; a doctor or RMO asking is the one who ordered
  })
  .strict();

wardRequestsRouter.post('/', async (req, res) => {
  const { patient, stay } = await herStay(req);
  if (!stay) throw new HttpError(409, 'She is not admitted: the ward asks the pharmacy only for an admitted patient.', 'NOT_ADMITTED');
  const body = parse(askSchema, req.body);
  const ids = body.lines.map((l) => String(l.medicineId));
  if (new Set(ids).size !== ids.length) throw Object.assign(new HttpError(400, 'A medicine is asked for twice: add the quantities together.', 'VALIDATION'), { fields: { lines: 'A medicine is listed twice.' } });
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: ids }, active: true }, { name: 1 }).lean()).map((m) => [String(m._id), m]));
  if (meds.size !== ids.length) throw new HttpError(400, 'A medicine was not found on the stock list.', 'VALIDATION');
  const orderedId = body.orderedById ?? (hasRole(req.membership, ...ORDERING_ROLES) ? req.user._id : null);
  if (!orderedId) throw Object.assign(new HttpError(400, 'Choose the doctor who ordered it.', 'VALIDATION'), { fields: { orderedById: 'Choose the doctor who ordered it.' } });
  const doctor = (await orderingDoctors(req)).find((d) => d.id === String(orderedId));
  if (!doctor) throw Object.assign(new HttpError(400, 'The doctor who ordered must be a doctor or RMO of this hospital.', 'VALIDATION'), { fields: { orderedById: 'Choose a doctor of this hospital.' } });
  const r = await WardRequest.create({
    tenantId: req.tenantId,
    number: padded(await nextNumber(req.tenantId, 'ward-request')),
    patientId: patient._id,
    admissionId: stay._id,
    lines: body.lines.map((l) => ({ medicineId: l.medicineId, name: meds.get(String(l.medicineId)).name, qty: l.qty })),
    urgent: body.urgent,
    note: body.note,
    orderedBy: { userId: doctor.id, name: doctor.name, reg: doctor.reg },
    requested: { by: req.user._id, byName: req.user.name, at: req.now },
  });
  await audit(req, 'WARD_REQUEST_MADE', { details: { patientId: String(patient._id), mrn: patient.mrn, requestId: String(r._id), number: r.number, lines: r.lines.length, ...(r.urgent ? { urgent: true } : {}) } });
  res.status(201).json({ request: wardRequestView(r.toObject()) });
});

wardRequestsRouter.post('/:requestId/cancel', async (req, res) => {
  const { patient } = await herStay(req);
  const r = await WardRequest.findOne({ tenantId: req.tenantId, patientId: patient._id, _id: parse(objectId, req.params.requestId) });
  if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
  if (r.status !== 'requested') throw new HttpError(409, 'The pharmacy has already answered this request: what is left of it can no longer be cancelled here. Ask the pharmacist.', 'CONFLICT');
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Write why.').max(200) }).strict(), req.body);
  r.status = 'cancelled';
  r.cancelled = { by: req.user._id, byName: req.user.name, at: req.now, reason };
  await r.save();
  await audit(req, 'WARD_REQUEST_CANCELLED', { details: { patientId: String(patient._id), mrn: patient.mrn, requestId: String(r._id), number: r.number } });
  res.json({ request: wardRequestView(r.toObject()) });
});

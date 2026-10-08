import { statusMatch, withId } from '../../core/aggregate.js';
import { notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { StockBatch, recordMovement } from '../stock/stock.model.js';
import { Medicine } from './medicine.model.js';

export async function listMedicines(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId), ...statusMatch(q.status) };
  if (q.schedule) match.schedule = q.schedule;
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ name: text }, { generic: text }];
  }
  return paginate(Medicine, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: [{ $project: { nameKey: 0 } }, ...withId()] });
}

// Medicines for the counter: name, schedule and the units that can be sold now (not expired).
export async function medicineOptions(hospitalId, search) {
  const hid = toObjectId(hospitalId);
  const match = { hospitalId: hid, isActive: true, ...(search && { $or: [{ name: containsText(search) }, { generic: containsText(search) }] }) };
  return Medicine.aggregate([
    { $match: match },
    { $sort: { name: 1 } },
    { $limit: 20 },
    {
      $lookup: {
        from: StockBatch.collection.name,
        localField: '_id',
        foreignField: 'medicineId',
        as: 'stock',
        pipeline: [{ $match: { hospitalId: hid, qty: { $gt: 0 }, expiry: { $gt: new Date() } } }, { $group: { _id: null, qty: { $sum: '$qty' }, mrp: { $max: '$mrp' } } }],
      },
    },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: 1,
        strength: 1,
        form: 1,
        schedule: 1,
        gstRate: 1,
        available: { $ifNull: [{ $first: '$stock.qty' }, 0] },
        mrp: { $ifNull: [{ $first: '$stock.mrp' }, 0] },
      },
    },
  ]);
}

async function findOr404(hospitalId, id) {
  const medicine = await Medicine.findOne({ _id: id, hospitalId });
  if (!medicine) throw notFoundError('Medicine');
  return medicine;
}

// A new medicine and its opening stock (one batch: batch number, expiry, units, purchase price, MRP), recorded as
// received ("Opening stock") so it shows in the stock and the registers like a purchase.
export async function createMedicine(req, { stock, ...data }) {
  const medicine = await Medicine.create({ ...data, hospitalId: req.hospitalId });
  if (stock) {
    const batch = await StockBatch.create({ hospitalId: req.hospitalId, medicineId: medicine._id, batch: stock.batch, expiry: stock.expiry, qty: stock.qty, purchasePrice: stock.purchasePrice, mrp: stock.mrp, gstRate: medicine.gstRate });
    await recordMovement(req, { medicine, batch, kind: 'purchase', qty: stock.qty, ref: 'Opening stock' });
  }
  await recordAudit(req, 'MEDICINE_CREATED', { hospitalId: req.hospitalId, details: { name: medicine.name, schedule: medicine.schedule, ...(stock && { openingUnits: stock.qty }) } });
  return medicine;
}

export async function updateMedicine(req, id, data) {
  const medicine = await findOr404(req.hospitalId, id);
  medicine.set(data);
  await medicine.save();
  await recordAudit(req, 'MEDICINE_UPDATED', { hospitalId: req.hospitalId, details: { name: medicine.name } });
  return medicine;
}

export async function setMedicineStatus(req, id, isActive) {
  const medicine = await findOr404(req.hospitalId, id);
  if (medicine.isActive !== isActive) {
    medicine.isActive = isActive;
    await medicine.save();
    await recordAudit(req, 'MEDICINE_UPDATED', { hospitalId: req.hospitalId, details: { name: medicine.name, isActive } });
  }
  return medicine;
}

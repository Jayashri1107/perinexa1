// Stock: what is on hand per medicine (sellable, expired, value), its batches, and write-offs / stock counts.
import { REGISTER_SCHEDULE_KEYS } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Medicine } from '../medicines/medicine.model.js';
import { StockBatch, recordMovement } from './stock.model.js';

// Each medicine with its stock, worked out from its batches.
const stockOf = (hospitalId) => [
  {
    $lookup: {
      from: StockBatch.collection.name,
      localField: '_id',
      foreignField: 'medicineId',
      as: 'batches',
      pipeline: [{ $match: { hospitalId, qty: { $gt: 0 } } }],
    },
  },
  {
    $set: {
      sellable: { $sum: { $map: { input: { $filter: { input: '$batches', cond: { $gt: ['$$this.expiry', '$$NOW'] } } }, in: '$$this.qty' } } },
      expired: { $sum: { $map: { input: { $filter: { input: '$batches', cond: { $lte: ['$$this.expiry', '$$NOW'] } } }, in: '$$this.qty' } } },
      nearestExpiry: { $min: { $map: { input: { $filter: { input: '$batches', cond: { $gt: ['$$this.expiry', '$$NOW'] } } }, in: '$$this.expiry' } } },
      valueAtCost: { $sum: { $map: { input: '$batches', in: { $multiply: ['$$this.qty', '$$this.purchasePrice'] } } } },
      valueAtMrp: { $sum: { $map: { input: '$batches', in: { $multiply: ['$$this.qty', '$$this.mrp'] } } } },
      batchCount: { $size: '$batches' },
    },
  },
  { $set: { isLow: { $lte: ['$sellable', '$reorderLevel'] } } },
  { $project: { batches: 0, nameKey: 0 } },
];

export async function listStock(hospitalId, q) {
  const hid = toObjectId(hospitalId);
  const match = { hospitalId: hid, isActive: true };
  if (q.search) match.$or = [{ name: containsText(q.search) }, { generic: containsText(q.search) }];
  const lowOnly = q.lowStock === 'true';
  const result = await paginate(Medicine, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    // the low-stock filter needs the stock first; otherwise it is worked out for the page only
    preStages: lowOnly ? [...stockOf(hid), { $match: { isLow: true } }] : [],
    pageStages: lowOnly ? [] : stockOf(hid),
  });
  result.items = result.items.map(({ _id, ...m }) => ({ id: _id.toString(), ...m }));
  return result;
}

export async function listBatches(hospitalId, medicineId) {
  const medicine = await Medicine.findOne({ _id: medicineId, hospitalId }).lean();
  if (!medicine) throw notFoundError('Medicine');
  const batches = await StockBatch.find({ hospitalId, medicineId, qty: { $gt: 0 } }).sort({ expiry: 1 }).lean();
  const now = new Date();
  return {
    medicine: { id: medicine._id.toString(), name: medicine.name, strength: medicine.strength, schedule: medicine.schedule },
    batches: batches.map(({ _id, ...b }) => ({ id: _id.toString(), ...b, isExpired: b.expiry <= now })),
  };
}

export async function adjustBatch(req, batchId, { kind, qty, reason, note }) {
  const batch = await StockBatch.findOne({ _id: batchId, hospitalId: req.hospitalId });
  if (!batch) throw notFoundError('Batch');
  const medicine = await Medicine.findOne({ _id: batch.medicineId, hospitalId: req.hospitalId });
  if (REGISTER_SCHEDULE_KEYS.includes(medicine.schedule) && note.length < 5) {
    throw fieldError('note', 'For register medicines, write a note on what happened.');
  }
  const change = kind === 'writeoff' ? -qty : qty - batch.qty;
  if (kind === 'writeoff' && qty > batch.qty) throw fieldError('qty', `Only ${batch.qty} in this batch.`);
  if (change === 0) throw new HttpError(400, 'Nothing changes: the count is the same as the stock.', 'NO_CHANGE');

  // atomic: only if the batch still holds what we read
  const updated = await StockBatch.findOneAndUpdate({ _id: batch._id, hospitalId: req.hospitalId, qty: batch.qty }, { $inc: { qty: change } }, { returnDocument: 'after' });
  if (!updated) throw new HttpError(409, 'The stock of this batch just changed. Reload and try again.', 'CONFLICT');
  const reasonText = [reason, note].filter(Boolean).join(': ');
  await recordMovement(req, { medicine, batch: updated, kind, qty: change, reason: reasonText });
  await recordAudit(req, 'STOCK_ADJUSTED', { hospitalId: req.hospitalId, details: { medicine: medicine.name, batch: batch.batch, change, reason } });
  return updated;
}

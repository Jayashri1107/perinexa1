// Purchases: a supplier invoice adds a batch to stock for each line, and each is logged as a movement.
import { withId } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2, sum } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Medicine } from '../medicines/medicine.model.js';
import { StockBatch, recordMovement } from '../stock/stock.model.js';
import { findActiveSupplier } from '../suppliers/supplier.service.js';
import { Purchase } from './purchase.model.js';

export async function listPurchases(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId) };
  if (q.supplierId) match.supplierId = q.supplierId;
  if (q.search) match.$or = [{ invoiceNumber: containsText(q.search) }, { supplierName: containsText(q.search) }];
  return paginate(Purchase, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [{ $set: { lineCount: { $size: '$lines' } } }, { $project: { lines: 0 } }, ...withId()],
  });
}

export async function getPurchase(hospitalId, id) {
  const purchase = await Purchase.findOne({ _id: id, hospitalId });
  if (!purchase) throw notFoundError('Purchase');
  return purchase;
}

export async function recordPurchase(req, data) {
  const hospitalId = req.hospitalId;
  const supplier = await findActiveSupplier(hospitalId, data.supplierId);
  if (await Purchase.exists({ hospitalId, supplierId: supplier._id, invoiceNumber: data.invoiceNumber })) {
    throw fieldError('invoiceNumber', 'This invoice of this supplier is already recorded.', 'DUPLICATE');
  }
  const medicines = await Medicine.find({ hospitalId, _id: { $in: data.lines.map((l) => l.medicineId) }, isActive: true });
  const byId = new Map(medicines.map((m) => [m._id.toString(), m]));
  if (data.lines.some((l) => !byId.has(l.medicineId))) throw new HttpError(400, 'A medicine is not on the list or not active.', 'VALIDATION');

  const purchase = new Purchase({
    hospitalId,
    supplierId: supplier._id,
    supplierName: supplier.name,
    invoiceNumber: data.invoiceNumber,
    invoiceDate: data.invoiceDate,
    byUserId: req.user._id,
    byName: req.user.name,
    total: sum(data.lines.map((l) => l.purchasePrice * l.qty)),
  });

  for (const l of data.lines) {
    const medicine = byId.get(l.medicineId);
    const units = l.qty + l.freeQty;
    const batch = await StockBatch.create({
      hospitalId,
      medicineId: medicine._id,
      batch: l.batch,
      expiry: l.expiry,
      qty: units,
      purchasePrice: round2(l.purchasePrice),
      mrp: round2(l.mrp),
      gstRate: l.gstRate,
      supplierId: supplier._id,
      purchaseId: purchase._id,
    });
    purchase.lines.push({ ...l, medicineId: medicine._id, medicineName: medicine.name, batchId: batch._id, amount: round2(l.purchasePrice * l.qty) });
    await recordMovement(req, { medicine, batch, kind: 'purchase', qty: units, ref: data.invoiceNumber, party: supplier.name });
  }
  await purchase.save();
  await recordAudit(req, 'PURCHASE_RECORDED', { hospitalId, details: { invoiceNumber: purchase.invoiceNumber, supplier: supplier.name, lines: purchase.lines.length, total: purchase.total } });
  return purchase;
}

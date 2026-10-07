// Returns to a supplier (as in Perinexa's pharmacy/supplierReturnsService.js). Rules kept here:
//  - a batch goes back only to the supplier it was bought from, and never more than is left of it;
//  - expired stock may go back (the usual reason) – unlike a sale, there is no expiry check;
//  - the stock leaves with its own kind of movement ('supplier_return'), so the H1, Schedule X and narcotic registers
//    show it; Schedule X and narcotic medicines need a witness's name;
//  - the debit note's rate is the batch's purchase price per unit, with the GST rate of the purchase: IGST when the
//    supplier's GSTIN is from another state than the pharmacy's, else CGST + SGST;
//  - a return is never deleted: a cancelled one puts its units back ('supplier_return_cancelled').
import { WITNESS_SCHEDULE_KEYS, config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2, sum } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { nextNumber } from '../../db/counter.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Medicine } from '../medicines/medicine.model.js';
import { StockBatch, recordMovement } from '../stock/stock.model.js';
import { findActiveSupplier } from '../suppliers/supplier.service.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { SupplierReturn } from './supplierReturn.model.js';

const canChange = (req) => req.membership.roles.some((r) => config.access.pharmacyCounter.includes(r));
function assertCanChange(req) {
  if (!canChange(req)) throw new HttpError(403, 'The pharmacist returns stock to suppliers.', 'FORBIDDEN');
}
const stamp = (req, extra = {}) => ({ by: req.user._id, byName: req.user.name, at: new Date(), ...extra });

// The state code of a GSTIN: its first two digits, when it is well formed.
const stateOf = (gstin) => (/^\d{2}[A-Z0-9]{13}$/i.test(String(gstin ?? '').trim()) ? gstin.trim().slice(0, 2) : null);
export function isInterState(pharmacyGstin, supplierGstin) {
  const a = stateOf(pharmacyGstin);
  const b = stateOf(supplierGstin);
  return Boolean(a && b && a !== b);
}

export function returnView(r, req) {
  const x = r.toObject ? r.toObject() : r;
  return {
    id: String(x._id),
    returnNumber: x.returnNumber,
    supplierId: String(x.supplierId),
    supplierName: x.supplierName,
    supplierGstin: x.supplierGstin,
    reason: x.reason,
    note: x.note,
    witness: x.witness,
    lines: x.lines.map((l) => ({ ...l, batchId: String(l.batchId), medicineId: String(l.medicineId) })),
    amount: x.amount,
    gst: x.gst,
    interState: x.interState,
    total: x.total,
    status: x.status,
    created: x.created,
    cancelled: x.cancelled,
    createdAt: x.createdAt,
    can: req ? { cancel: canChange(req) && x.status === 'returned' } : undefined,
  };
}

export async function listReturns(req, q) {
  const match = { hospitalId: toObjectId(req.hospitalId) };
  if (q.search) match.$or = [{ returnNumber: containsText(q.search) }, { supplierName: containsText(q.search) }];
  const result = await paginate(SupplierReturn, { match, sort: toSort(q.sort), page: q.page, limit: q.limit });
  result.items = result.items.map((r) => ({ ...returnView(r), lineCount: r.lines.length }));
  return result;
}

export async function getReturn(req, id) {
  const r = await SupplierReturn.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!r) throw notFoundError('Supplier return');
  return returnView(r, req);
}

// The batches of this supplier still in stock (expired ones too), for choosing what goes back.
export async function returnableBatches(req, supplierId) {
  const batches = await StockBatch.find({ hospitalId: req.hospitalId, supplierId, qty: { $gt: 0 } }).sort({ expiry: 1 }).lean();
  const medicines = new Map((await Medicine.find({ hospitalId: req.hospitalId, _id: { $in: batches.map((b) => b.medicineId) } }).lean()).map((m) => [String(m._id), m]));
  const now = new Date();
  return batches.map((b) => {
    const m = medicines.get(String(b.medicineId));
    return {
      batchId: String(b._id),
      medicineName: `${m?.name ?? 'Medicine'}${m?.strength ? ` ${m.strength}` : ''}`,
      schedule: m?.schedule ?? 'none',
      batch: b.batch,
      expiry: b.expiry,
      isExpired: b.expiry <= now,
      qty: b.qty,
      rate: b.purchasePrice,
      gstRate: b.gstRate,
      needsWitness: WITNESS_SCHEDULE_KEYS.includes(m?.schedule),
    };
  });
}

export async function createReturn(req, body) {
  assertCanChange(req);
  const supplier = await findActiveSupplier(req.hospitalId, body.supplierId);
  const hospital = await Hospital.findById(req.hospitalId).lean();
  const interState = isInterState(hospital?.pharmacy?.gstin, supplier.gstin);

  const ids = body.lines.map((l) => l.batchId);
  if (new Set(ids).size !== ids.length) throw fieldError('lines', 'A batch is chosen twice: keep one line.');
  const batches = new Map((await StockBatch.find({ hospitalId: req.hospitalId, _id: { $in: ids } })).map((b) => [String(b._id), b]));
  const medicines = new Map((await Medicine.find({ hospitalId: req.hospitalId, _id: { $in: [...batches.values()].map((b) => b.medicineId) } })).map((m) => [String(m._id), m]));

  const lines = body.lines.map((l, i) => {
    const b = batches.get(l.batchId);
    if (!b || String(b.supplierId) !== String(supplier._id)) throw fieldError(`lines.${i}.batchId`, 'This batch was not bought from this supplier.');
    if (l.qty > b.qty) throw fieldError(`lines.${i}.qty`, `Only ${b.qty} left in batch ${b.batch}.`);
    const m = medicines.get(String(b.medicineId));
    if (WITNESS_SCHEDULE_KEYS.includes(m.schedule) && body.witness.length < 2) throw fieldError('witness', `${m.name} is a Schedule X or narcotic medicine: write the witness's name.`);
    const amount = round2(l.qty * b.purchasePrice);
    return { b, m, qty: l.qty, amount, gst: round2((amount * b.gstRate) / 100) };
  });

  // Take the units off their batches – each only if it still holds enough; undo the ones taken if one fails.
  const taken = [];
  for (const x of lines) {
    const ok = await StockBatch.findOneAndUpdate({ _id: x.b._id, hospitalId: req.hospitalId, qty: { $gte: x.qty } }, { $inc: { qty: -x.qty } }, { returnDocument: 'after' });
    if (!ok) {
      for (const t of taken) await StockBatch.updateOne({ _id: t.b._id, hospitalId: req.hospitalId }, { $inc: { qty: t.qty } });
      throw new HttpError(409, `The stock of batch ${x.b.batch} just changed. Reload and try again.`, 'CONFLICT');
    }
    taken.push(x);
  }

  const amount = sum(lines.map((x) => x.amount));
  const gst = sum(lines.map((x) => x.gst));
  const ret = await SupplierReturn.create({
    hospitalId: req.hospitalId,
    returnNumber: await nextNumber(req.hospitalId, 'supplierReturn', config.pharmacy.supplierReturnPrefix, config.pharmacy.numberDigits),
    supplierId: supplier._id,
    supplierName: supplier.name,
    supplierGstin: supplier.gstin ?? '',
    reason: body.reason,
    note: body.note,
    witness: body.witness,
    lines: lines.map((x) => ({
      batchId: x.b._id,
      medicineId: x.m._id,
      medicineName: `${x.m.name}${x.m.strength ? ` ${x.m.strength}` : ''}`,
      schedule: x.m.schedule,
      batch: x.b.batch,
      expiry: x.b.expiry,
      qty: x.qty,
      rate: x.b.purchasePrice,
      gstRate: x.b.gstRate,
      amount: x.amount,
      gst: x.gst,
    })),
    amount,
    gst,
    interState,
    total: round2(amount + gst),
    created: stamp(req),
  });
  for (const x of lines) {
    await recordMovement(req, { medicine: x.m, batch: x.b, kind: 'supplier_return', qty: -x.qty, ref: ret.returnNumber, party: supplier.name, reason: [body.reason, body.witness && `witness ${body.witness}`].filter(Boolean).join(', ') });
  }
  await recordAudit(req, 'SUPPLIER_RETURN_MADE', { hospitalId: req.hospitalId, details: { returnNumber: ret.returnNumber, supplier: supplier.name, lines: lines.length, total: ret.total } });
  return returnView(ret, req);
}

export async function cancelReturn(req, id, { reason, witness }) {
  assertCanChange(req);
  const ret = await SupplierReturn.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!ret) throw notFoundError('Supplier return');
  if (ret.status === 'cancelled') return returnView(ret, req);
  if (ret.lines.some((l) => WITNESS_SCHEDULE_KEYS.includes(l.schedule)) && witness.length < 2) throw fieldError('witness', "Write the witness's name (Schedule X or narcotic medicines).");
  const supplier = await Supplier.findOne({ hospitalId: req.hospitalId, _id: ret.supplierId }).lean();
  for (const l of ret.lines) {
    const batch = await StockBatch.findOneAndUpdate({ _id: l.batchId, hospitalId: req.hospitalId }, { $inc: { qty: l.qty } }, { returnDocument: 'after' });
    const medicine = await Medicine.findOne({ _id: l.medicineId, hospitalId: req.hospitalId });
    if (batch && medicine) {
      await recordMovement(req, { medicine, batch, kind: 'supplier_return_cancelled', qty: l.qty, ref: ret.returnNumber, party: supplier?.name ?? ret.supplierName, reason: [reason, witness && `witness ${witness}`].filter(Boolean).join(', ') });
    }
  }
  ret.set({ status: 'cancelled', cancelled: stamp(req, { reason, witness }) });
  await ret.save();
  await recordAudit(req, 'SUPPLIER_RETURN_CANCELLED', { hospitalId: req.hospitalId, details: { returnNumber: ret.returnNumber } });
  return returnView(ret, req);
}

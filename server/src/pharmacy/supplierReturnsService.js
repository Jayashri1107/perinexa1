// Stock returned to a supplier (SR-000001 …), each with a printable debit note.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - a batch goes back only to the supplier it was bought from, and never more than is left of it;
//  - expired stock MAY go back (that is the usual reason) – unlike a sale, there is no expiry check;
//  - the stock leaves with its own kind of stock move ('supplier_return'), so the Schedule H1, Schedule X and narcotic
//    registers show it with the running balance; Schedule X and narcotic medicines need a witness's name;
//  - the debit note's rate is the purchase price per unit as on the purchase (the batch's cost: where free units came
//    with the purchase, the price paid spread over all the units, so a return never claims more than was paid), and
//    its GST is the rate recorded on the purchase (the medicine's present rate for purchases older than that record) –
//    IGST when the supplier's GSTIN is from another state than the pharmacy's, else CGST + SGST;
//  - a return is never deleted. One entered by mistake is cancelled with a reason: its units go back on their batches
//    with their own stock move ('supplier_return_cancelled' – in the registers too, with a witness for Schedule X and
//    narcotic medicines), and it no longer counts in the purchases report.

import mongoose from 'mongoose';
import { stampOf } from '../billing/billingService.js';
import { hospitalToday, isoDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { nextNumber } from '../models/Counter.js';
import { Medicine, Purchase, StockBatch, Supplier, SupplierReturn } from '../models/Pharmacy.js';
import { HttpError } from '../utils/httpError.js';
import { debitMoney } from './gst.js';
import { gstinState } from './gstin.js';
import { settingsOf, supplierView } from './pharmacyHttp.js';
import { CONTROLLED, PHARMACY_DESK_ROLES, SCHEDULE_LABELS, SUPPLIER_RETURN_REASON_LABELS } from './pharmacyRules.js';
import { daysLeft, isExpired, moveStock } from './pharmacyService.js';

const padded = (prefix, n) => `${prefix}-${String(n).padStart(6, '0')}`;
const bad = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
/** Returns that count: every one that was not cancelled (returns made before 5 Oct 2026 have no status). */
export const NOT_CANCELLED = { status: { $ne: 'cancelled' } };

/** Is the supplier in another state than the pharmacy? Only when both GSTINs are well formed; otherwise "same state". */
export function isInterState(pharmacyGstin, supplierGstin) {
  const a = gstinState(pharmacyGstin);
  const b = gstinState(supplierGstin);
  return Boolean(a && b && a.code !== b.code);
}

/** The purchase line a batch came in on: its HSN code and GST rate on that day, and the supplier's invoice. */
async function purchaseFacts(tenantId, batches) {
  const ids = [...new Set(batches.map((b) => b.purchaseId && String(b.purchaseId)).filter(Boolean))];
  const purchases = ids.length ? await Purchase.find({ tenantId, _id: { $in: ids } }, { number: 1, invoiceNo: 1, invoiceDate: 1, lines: 1 }).lean() : [];
  const byBatch = new Map();
  for (const p of purchases) for (const l of p.lines) if (l.batchId) byBatch.set(String(l.batchId), { purchase: p, line: l });
  return byBatch;
}

/** One batch as it would go on a debit note. */
function debitLine(batch, medicine, fact) {
  return {
    medicineId: medicine._id,
    name: medicine.name,
    generic: medicine.generic ?? '',
    hsn: fact?.line.hsn || medicine.hsn || '',
    gstRate: fact?.line.gstRate ?? medicine.gstRate,
    schedule: medicine.schedule ?? '',
    batchId: batch._id,
    batch: batch.batch,
    expiry: batch.expiry,
    ratePaise: batch.costPaise,
    purchaseId: fact?.purchase._id ?? null,
    purchaseNumber: fact?.purchase.number ?? '',
    invoiceNo: fact?.purchase.invoiceNo ?? '',
    invoiceDate: fact?.purchase.invoiceDate ?? null,
  };
}

/** The batches in stock that were bought from this supplier (expired ones too), earliest expiry first. */
export async function returnableBatches(req, supplierId) {
  const tenantId = req.tenantId;
  const supplier = await Supplier.findOne({ tenantId, _id: supplierId }).lean();
  if (!supplier) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
  const today = hospitalToday(req.now);
  const batches = await StockBatch.find({ tenantId, supplierId: supplier._id, qtyLeft: { $gt: 0 } }).sort({ expiry: 1, createdAt: 1 }).limit(500).lean();
  const meds = new Map((await Medicine.find({ tenantId, _id: { $in: batches.map((b) => b.medicineId) } }).lean()).map((m) => [String(m._id), m]));
  const facts = await purchaseFacts(tenantId, batches);
  const interState = isInterState((await settingsOf(tenantId)).gstin, supplier.gstin);
  return {
    supplier: supplierView(supplier),
    interState,
    batches: batches
      .filter((b) => meds.has(String(b.medicineId)))
      .map((b) => {
        const m = meds.get(String(b.medicineId));
        const line = debitLine(b, m, facts.get(String(b._id)));
        return {
          id: String(b._id),
          medicineId: String(m._id),
          name: m.name,
          generic: m.generic ?? '',
          strength: m.strength ?? '',
          unit: m.unit,
          schedule: m.schedule ?? '',
          scheduleLabel: SCHEDULE_LABELS[m.schedule ?? ''],
          controlled: CONTROLLED.includes(m.schedule),
          batch: b.batch,
          expiry: isoDay(b.expiry),
          expired: isExpired(b, today),
          daysLeft: daysLeft(b.expiry, today),
          qtyLeft: b.qtyLeft,
          hsn: line.hsn,
          gstRate: line.gstRate,
          ratePaise: line.ratePaise,
          purchaseNumber: line.purchaseNumber,
          invoiceNo: line.invoiceNo,
          invoiceDate: line.invoiceDate ? isoDay(line.invoiceDate) : null,
        };
      }),
  };
}

/**
 * Sends stock back to a supplier. body: { supplierId, reason, note, witness, lines [{ batchId, qty }] }.
 * Every line is checked first; then the stock goes out batch by batch (if one cannot be had, what was taken goes
 * back), and the return is saved with its debit note's sums. Returns the SupplierReturn.
 */
export async function createSupplierReturn(req, body) {
  const tenantId = req.tenantId;
  const supplier = await Supplier.findOne({ tenantId, _id: body.supplierId }).lean();
  if (!supplier) throw bad('Choose the supplier.', { supplierId: 'Choose the supplier.' });
  const batches = new Map((await StockBatch.find({ tenantId, _id: { $in: body.lines.map((l) => l.batchId) } }).lean()).map((b) => [String(b._id), b]));
  const meds = new Map((await Medicine.find({ tenantId, _id: { $in: [...batches.values()].map((b) => b.medicineId) } }).lean()).map((m) => [String(m._id), m]));
  const fields = {};
  const seen = new Set();
  body.lines.forEach((l, i) => {
    const b = batches.get(String(l.batchId));
    const m = b && meds.get(String(b.medicineId));
    if (!b || !m) fields[`lines.${i}.batchId`] = 'Choose a batch in stock.';
    else if (seen.has(String(b._id))) fields[`lines.${i}.batchId`] = `${m.name}, batch ${b.batch}, is on this return twice: keep one line.`;
    else if (String(b.supplierId) !== String(supplier._id)) fields[`lines.${i}.batchId`] = `${m.name}, batch ${b.batch}, was not bought from ${supplier.name}: it goes back to the supplier it came from.`;
    else if (l.qty > b.qtyLeft) fields[`lines.${i}.qty`] = `${m.name}, batch ${b.batch}: only ${b.qtyLeft} left.`;
    seen.add(String(l.batchId));
  });
  if (Object.keys(fields).length) throw bad(Object.values(fields)[0], fields);
  const controlled = body.lines.map((l) => meds.get(String(batches.get(String(l.batchId)).medicineId))).filter((m) => CONTROLLED.includes(m.schedule));
  const witness = (body.witness ?? '').trim();
  if (controlled.length && witness.length < 2) {
    throw bad(`${controlled[0].name} is a controlled medicine: write the name of the staff member who saw it handed back.`, { witness: 'Write the witness’s name.' });
  }

  const facts = await purchaseFacts(tenantId, [...batches.values()]);
  const interState = isInterState((await settingsOf(tenantId)).gstin, supplier.gstin);
  const number = padded('SR', await nextNumber(tenantId, 'pharmacy-supplier-return'));
  const returnId = new mongoose.Types.ObjectId();
  const why = [SUPPLIER_RETURN_REASON_LABELS[body.reason], body.note].filter(Boolean).join(' – ').slice(0, 200);
  const meta = { kind: 'supplier_return', ref: { kind: 'supplier_return', id: returnId, number }, supplierName: supplier.name, reason: why, witness };
  const taken = [];
  const lines = [];
  try {
    for (const l of body.lines) {
      const b = batches.get(String(l.batchId));
      const m = meds.get(String(b.medicineId));
      const after = await moveStock(req, b, -l.qty, meta);
      taken.push({ batch: after, qty: l.qty });
      const line = debitLine(b, m, facts.get(String(b._id)));
      lines.push({ ...line, qty: l.qty, ...debitMoney({ qty: l.qty, ratePaise: line.ratePaise, gstRate: line.gstRate, interState }) });
    }
  } catch (err) {
    // A batch ran out between the check and the move (someone sold or returned it at that moment): what was already
    // taken goes back, so the return is all or nothing
    for (const t of taken) await moveStock(req, t.batch, t.qty, { ...meta, kind: 'supplier_return_cancelled', reason: 'Return to the supplier not completed' }).catch(() => {});
    throw err;
  }
  return SupplierReturn.create({ _id: returnId, tenantId, number, supplierId: supplier._id, reason: body.reason, note: body.note ?? '', witness, interState, lines, created: stampOf(req) });
}

/**
 * Cancels a return that was entered by mistake (the wrong quantity, the wrong batch, entered twice): the return is
 * kept, marked cancelled with the reason, and its units go back on the batches they left – each with a stock move of
 * its own kind, so the registers show it with the balance. Schedule X and narcotic medicines need a witness, as the
 * return itself did. The cancel is claimed in one step first, so two people cannot both put the stock back.
 */
export async function cancelSupplierReturn(req, ret, { reason, witness = '' }) {
  const tenantId = req.tenantId;
  const already = () => conflict(`Return ${ret.number} was already cancelled.`, 'CANCELLED');
  if (ret.status === 'cancelled') throw already();
  const controlled = ret.lines.find((l) => CONTROLLED.includes(l.schedule));
  const seenBy = String(witness ?? '').trim();
  if (controlled && seenBy.length < 2) {
    throw bad(`${controlled.name} is a controlled medicine: write the name of the staff member who saw it put back in stock.`, { witness: 'Write the witness’s name.' });
  }
  const batches = new Map((await StockBatch.find({ tenantId, _id: { $in: ret.lines.map((l) => l.batchId) } }).lean()).map((b) => [String(b._id), b]));
  const lost = ret.lines.find((l) => !batches.has(String(l.batchId)));
  if (lost) throw conflict(`${lost.name}, batch ${lost.batch}, is no longer on the stock list: this return cannot be cancelled.`, 'NO_BATCH');
  const claimed = await SupplierReturn.findOneAndUpdate({ tenantId, _id: ret._id, ...NOT_CANCELLED }, { $set: { status: 'cancelled', cancelled: { ...stampOf(req), reason, witness: seenBy } } }, { returnDocument: 'after' });
  if (!claimed) throw already();
  const supplier = await Supplier.findOne({ tenantId, _id: claimed.supplierId }, { name: 1 }).lean();
  const meta = { kind: 'supplier_return_cancelled', ref: { kind: 'supplier_return', id: claimed._id, number: claimed.number }, supplierName: supplier?.name ?? '', reason: `Return cancelled – ${reason}`.slice(0, 200), witness: seenBy };
  for (const l of claimed.lines) await moveStock(req, batches.get(String(l.batchId)), l.qty, meta);
  return claimed;
}

// ---------- What the website gets ----------

/** A return's sums: units, taxable value (the purchase value going back), GST and the debit note's total. */
export function returnTotals(ret) {
  const out = { qty: 0, taxablePaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, amountPaise: 0 };
  for (const l of ret.lines) for (const k of Object.keys(out)) out[k] += l[k] ?? 0;
  return out;
}

/** Views of returns (plain objects) with their suppliers. */
export async function supplierReturnViews(req, returns) {
  const suppliers = new Map((await Supplier.find({ tenantId: req.tenantId, _id: { $in: returns.map((r) => r.supplierId) } }).lean()).map((s) => [String(s._id), s]));
  return returns.map((r) => {
    const s = suppliers.get(String(r.supplierId));
    return {
      id: String(r._id),
      number: r.number,
      date: r.created?.at ?? r.createdAt,
      byName: r.created?.byName ?? '',
      supplier: s ? supplierView(s) : null,
      reason: r.reason,
      reasonLabel: SUPPLIER_RETURN_REASON_LABELS[r.reason] ?? r.reason,
      note: r.note ?? '',
      witness: r.witness ?? '',
      interState: Boolean(r.interState),
      controlled: r.lines.some((l) => CONTROLLED.includes(l.schedule)),
      status: r.status === 'cancelled' ? 'cancelled' : 'active',
      cancelled: r.status === 'cancelled' && r.cancelled ? { at: r.cancelled.at ?? null, byName: r.cancelled.byName ?? '', reason: r.cancelled.reason ?? '', witness: r.cancelled.witness ?? '' } : null,
      // May this person cancel it (the pharmacist, while it is not cancelled)? The server checks again.
      canCancel: r.status !== 'cancelled' && hasRole(req.membership, ...PHARMACY_DESK_ROLES),
      lines: r.lines.map((l) => ({
        id: String(l._id),
        medicineId: String(l.medicineId),
        name: l.name,
        generic: l.generic ?? '',
        hsn: l.hsn ?? '',
        gstRate: l.gstRate,
        schedule: l.schedule ?? '',
        batch: l.batch,
        expiry: isoDay(l.expiry),
        qty: l.qty,
        ratePaise: l.ratePaise,
        taxablePaise: l.taxablePaise,
        gstPaise: l.gstPaise,
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        igstPaise: l.igstPaise,
        amountPaise: l.amountPaise,
        purchaseNumber: l.purchaseNumber ?? '',
        invoiceNo: l.invoiceNo ?? '',
        invoiceDate: l.invoiceDate ? isoDay(l.invoiceDate) : null,
      })),
      totals: returnTotals(r),
    };
  });
}

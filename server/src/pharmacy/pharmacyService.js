// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md): batches, stock movements, purchases, invoices (counter sales
// and issues to admitted patients), returns with credit notes, write-offs and stock counts.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - a batch's quantity is only changed by one conditional update, so it never goes below 0 (two counters at once);
//  - every change of stock leaves a StockMove (the registers and reports are read from them);
//  - the earliest-expiring batch is used first; an expired batch is never sold or issued;
//  - Schedule H/H1/X and narcotic medicines need a prescription; X and narcotic ones also the doctor's registration
//    number and a registered patient (pharmacyRules.js).

import mongoose from 'mongoose';
import { openBillFor, openStayBill, pushLines, stampOf } from '../billing/billingService.js';
import { addDays, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Bill } from '../models/Bill.js';
import { nextNumber } from '../models/Counter.js';
import { Patient } from '../models/Patient.js';
import { Medicine, PharmacyInvoice, Purchase, StockBatch, StockMove, Supplier } from '../models/Pharmacy.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';
import { earlierRecordIds } from '../patients/duplicateService.js';
import { HttpError } from '../utils/httpError.js';
import { buyerState } from './einvoice.js';
import { lineMoney, partOf, sum } from './gst.js';
import { CONTROLLED, NEEDS_PRESCRIPTION } from './pharmacyRules.js';

const padded = (prefix, n) => `${prefix}-${String(n).padStart(6, '0')}`;
const bad = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);

/** "2027-03" → the last day of March 2027 (a pack's expiry month), as midnight UTC. */
export const endOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};
export const isExpired = (batch, today) => utcDay(batch.expiry) < utcDay(today);

/** Units in stock of each medicine (all batches, expired or not): Map "<medicineId>" -> qty. */
export async function stockOf(tenantId, medicineIds = null) {
  const rows = await StockBatch.aggregate([
    { $match: { tenantId, qtyLeft: { $gt: 0 }, ...(medicineIds ? { medicineId: { $in: medicineIds } } : {}) } },
    { $group: { _id: '$medicineId', qty: { $sum: '$qtyLeft' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
}

/**
 * Changes a batch's quantity by `qty` (+ in, − out) and records the move. Out of stock: 409 naming what is left.
 * meta: { kind, ref, patientId, customer, doctorName, doctorReg, supplierName, reason, witness }.
 */
export async function moveStock(req, batch, qty, meta) {
  const filter = { tenantId: req.tenantId, _id: batch._id, ...(qty < 0 ? { qtyLeft: { $gte: -qty } } : {}) };
  const after = await StockBatch.findOneAndUpdate(filter, { $inc: { qtyLeft: qty } }, { returnDocument: 'after' }).lean();
  if (!after) {
    const now = await StockBatch.findOne({ tenantId: req.tenantId, _id: batch._id }, { qtyLeft: 1 }).lean();
    throw conflict(`Batch ${batch.batch}: only ${now?.qtyLeft ?? 0} left.`, 'OUT_OF_STOCK');
  }
  const balance = (await stockOf(req.tenantId, [after.medicineId])).get(String(after.medicineId)) ?? 0;
  await StockMove.create({ tenantId: req.tenantId, medicineId: after.medicineId, batchId: after._id, qty, balanceAfter: balance, ...meta, ...stampOf(req) });
  return after;
}

// ---------- Purchases ----------

/**
 * Saves a supplier invoice and adds its stock, batch by batch. body: { supplierId, invoiceNo, invoiceDate, lines,
 * orderId? } – orderId: the purchase order it is received against (checked by the caller, ordersService.js).
 */
export async function createPurchase(req, body) {
  const supplier = await Supplier.findOne({ tenantId: req.tenantId, _id: body.supplierId, active: true }).lean();
  if (!supplier) throw bad('Choose a supplier in use.');
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: body.lines.map((l) => l.medicineId) }, active: true }).lean()).map((m) => [String(m._id), m]));
  const today = hospitalToday(req.now);
  const fields = {};
  body.lines.forEach((l, i) => {
    if (!meds.has(String(l.medicineId))) fields[`lines.${i}.medicineId`] = 'Choose a medicine in use.';
    if (endOfMonth(l.expiry) < today) fields[`lines.${i}.expiry`] = 'This batch has already expired.';
    if (l.qty + l.freeQty < 1) fields[`lines.${i}.qty`] = 'Enter the quantity.';
    if (l.ratePaise > l.mrpPaise) fields[`lines.${i}.ratePaise`] = 'The purchase price is above the MRP.';
  });
  if (Object.keys(fields).length) throw bad('Please check the highlighted lines.', fields);
  const number = padded('PU', await nextNumber(req.tenantId, 'pharmacy-purchase'));
  const purchase = await Purchase.create({
    tenantId: req.tenantId,
    number,
    supplierId: supplier._id,
    invoiceNo: body.invoiceNo,
    invoiceDate: body.invoiceDate,
    // Each line keeps the medicine's HSN code and GST rate of today: a debit note (a return to the supplier) uses them
    lines: body.lines.map((l) => {
      const m = meds.get(String(l.medicineId));
      return { ...l, name: m.name, expiry: endOfMonth(l.expiry), hsn: m.hsn ?? '', gstRate: m.gstRate };
    }),
    totalPaise: body.lines.reduce((s, l) => s + l.ratePaise * l.qty, 0),
    orderId: body.orderId ?? null,
    created: stampOf(req),
  });
  for (const line of purchase.lines) {
    const units = line.qty + line.freeQty;
    const batch = await StockBatch.create({
      tenantId: req.tenantId,
      medicineId: line.medicineId,
      batch: line.batch,
      expiry: line.expiry,
      mrpPaise: line.mrpPaise,
      costPaise: units ? Math.round((line.ratePaise * line.qty) / units) : line.ratePaise,
      qtyIn: units,
      qtyLeft: 0,
      purchaseId: purchase._id,
      supplierId: supplier._id,
    });
    line.batchId = batch._id;
    await moveStock(req, batch, units, { kind: 'purchase', ref: { kind: 'purchase', id: purchase._id, number }, supplierName: supplier.name });
  }
  await purchase.save();
  return purchase;
}

/** Cancels a purchase entered by mistake – only while none of its stock has left. */
export async function cancelPurchase(req, purchase, reason) {
  if (purchase.status === 'cancelled') throw conflict('This purchase was already cancelled.');
  const batches = await StockBatch.find({ tenantId: req.tenantId, purchaseId: purchase._id }).lean();
  if (batches.some((b) => b.qtyLeft !== b.qtyIn)) throw conflict('Some of this stock has already been sold, issued, written off or returned to the supplier: the purchase cannot be cancelled. Write off or count the stock instead.', 'USED');
  for (const b of batches) await moveStock(req, b, -b.qtyLeft, { kind: 'purchase_cancelled', ref: { kind: 'purchase', id: purchase._id, number: purchase.number }, reason });
  purchase.status = 'cancelled';
  purchase.cancelled = { ...stampOf(req), reason };
  await purchase.save();
  return purchase;
}

// ---------- Invoices: counter sales and issues ----------

/** The batches to take `qty` units of a medicine from: the chosen one, or the earliest-expiring first. */
async function allocate(req, medicine, qty, batchId, today) {
  if (batchId) {
    const b = await StockBatch.findOne({ tenantId: req.tenantId, _id: batchId, medicineId: medicine._id }).lean();
    if (!b) throw bad(`${medicine.name}: choose a batch of this medicine.`);
    if (isExpired(b, today)) throw conflict(`${medicine.name}, batch ${b.batch}, has expired and cannot be sold.`, 'EXPIRED');
    if (b.qtyLeft < qty) throw conflict(`${medicine.name}, batch ${b.batch}: only ${b.qtyLeft} left.`, 'OUT_OF_STOCK');
    return [{ batch: b, qty }];
  }
  const batches = await StockBatch.find({ tenantId: req.tenantId, medicineId: medicine._id, qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(today) } }).sort({ expiry: 1, createdAt: 1 }).lean();
  const out = [];
  let need = qty;
  for (const b of batches) {
    if (!need) break;
    const take = Math.min(need, b.qtyLeft);
    out.push({ batch: b, qty: take });
    need -= take;
  }
  if (need > 0) throw conflict(`${medicine.name}: only ${qty - need} in stock (not expired).`, 'OUT_OF_STOCK');
  return out;
}

/**
 * Makes an invoice: a counter sale (kind 'sale') or an issue to an admitted patient (kind 'issue'). body: { kind,
 * patientId | customer, doctor { name, reg }, visitId, rxSeen, lines [{ medicineId, qty, batchId? }], discountPercent,
 * discountReason, payment { mode, reference } (a walk-in pays at once), buyer? { name, gstin, address, place, pin } (a
 * walk-in sale to a business with a GSTIN – never a patient) }. The doctor comes from the prescription (visitId) when
 * there is one. Returns the invoice.
 */
export async function createInvoice(req, body) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  let patient = null;
  if (body.patientId) {
    patient = await Patient.findOne({ tenantId, _id: body.patientId }, { _id: 1, fullName: 1, duplicateOf: 1, 'death.on': 1 }).lean();
    if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
    // A record marked as a duplicate takes no new sale (it would open a new bill on it): she is sold to on her main
    // record, where the prescriptions written on this record can be chosen too
    refuseNewOnDuplicate(patient, 'sale');
    // A record closed after a death takes no new sale at the counter (an issue to the ward for a stay that is still
    // open can still be entered: the stay's records are finished)
    if (body.kind !== 'issue') refuseNewOnClosed(patient, 'sale');
  }
  const stay = patient ? await Admission.findOne({ tenantId, patientId: patient._id, status: 'admitted' }).lean() : null;
  if (body.kind === 'issue' && !stay) throw bad('She is not admitted: issue to the ward only for an admitted patient (sell at the counter instead).');
  if (!patient && !body.customer?.name) throw bad('Choose the patient, or write the customer’s name.');
  if (body.buyer && (patient || body.kind !== 'sale')) throw bad('A business buyer is for a walk-in sale at the counter, not for a patient.', { buyer: 'Not for a patient.' });

  // The prescription: a Perinexa one (its doctor and registration number), or an outside one seen by the pharmacist.
  let doctor = body.doctor?.name ? { name: body.doctor.name, reg: body.doctor.reg ?? '' } : null;
  let visitId = null;
  if (body.visitId) {
    if (!patient) throw bad('A Perinexa prescription belongs to a registered patient: choose her first.');
    // Her own prescription – also one written on a record that was marked as a duplicate of hers (nothing is moved:
    // the visit stays on that record)
    const visit = await Visit.findOne({ tenantId, _id: body.visitId, patientId: { $in: [patient._id, ...(await earlierRecordIds(tenantId, patient._id))] }, status: 'active' }, { prescription: 1 }).lean();
    if (!visit) throw bad('That prescription is not this patient’s.');
    visitId = visit._id;
    const by = visit.prescription?.by ? await User.findById(visit.prescription.by, { name: 1, professional: 1 }).lean() : null;
    if (by) doctor = { name: by.name, reg: by.professional?.registrationNumber ?? '' };
  }

  const ids = [...new Set(body.lines.map((l) => String(l.medicineId)))];
  const meds = new Map((await Medicine.find({ tenantId, _id: { $in: ids }, active: true }).lean()).map((m) => [String(m._id), m]));
  const fields = {};
  body.lines.forEach((l, i) => {
    const m = meds.get(String(l.medicineId));
    if (!m) return (fields[`lines.${i}.medicineId`] = 'Choose a medicine in use.');
    if (NEEDS_PRESCRIPTION.includes(m.schedule) && !visitId && !(body.rxSeen && doctor?.name)) {
      fields[`lines.${i}.medicineId`] = `${m.name} needs a prescription: choose her Perinexa prescription, or write the doctor's name and tick "prescription seen".`;
    }
    if (CONTROLLED.includes(m.schedule)) {
      if (!patient) fields[`lines.${i}.medicineId`] = `${m.name} is given only to a registered patient.`;
      else if (!doctor?.reg) fields[`lines.${i}.medicineId`] = `${m.name} needs the prescribing doctor's registration number.`;
    }
  });
  if (Object.keys(fields).length) throw bad(Object.values(fields)[0], fields);

  // Take the stock (batch by batch); if any line can't be had, what was taken goes back.
  const number = padded('PH', await nextNumber(tenantId, 'pharmacy-invoice'));
  const taken = [];
  const lines = [];
  const pct = body.discountPercent ?? 0;
  const invoiceId = new mongoose.Types.ObjectId();
  const meta = {
    kind: body.kind,
    ref: { kind: 'invoice', id: invoiceId, number },
    patientId: patient?._id ?? null,
    customer: patient ? '' : body.customer.name,
    doctorName: doctor?.name ?? '',
    doctorReg: doctor?.reg ?? '',
  };
  try {
    for (const l of body.lines) {
      const m = meds.get(String(l.medicineId));
      for (const part of await allocate(req, m, l.qty, l.batchId, today)) {
        const after = await moveStock(req, part.batch, -part.qty, meta);
        taken.push({ batch: after, qty: part.qty });
        lines.push({
          medicineId: m._id,
          name: m.name,
          generic: m.generic ?? '',
          hsn: m.hsn ?? '',
          gstRate: m.gstRate,
          schedule: m.schedule ?? '',
          batchId: part.batch._id,
          batch: part.batch.batch,
          expiry: part.batch.expiry,
          qty: part.qty,
          mrpPaise: part.batch.mrpPaise,
          ...lineMoney({ qty: part.qty, mrpPaise: part.batch.mrpPaise, gstRate: m.gstRate, discountPercent: pct }),
        });
      }
    }
  } catch (err) {
    for (const t of taken) await moveStock(req, t.batch, t.qty, { ...meta, kind: 'return', reason: 'Sale not completed' }).catch(() => {});
    throw err;
  }
  const total = sum(lines).amountPaise;
  const invoice = await PharmacyInvoice.create({
    _id: invoiceId,
    tenantId,
    number,
    kind: body.kind,
    patientId: patient?._id ?? null,
    customer: patient ? null : { name: body.customer.name, phone: body.customer.phone ?? '' },
    buyer: body.buyer ? { name: body.buyer.name, gstin: body.buyer.gstin, address: body.buyer.address, place: body.buyer.place, pin: body.buyer.pin, ...buyerState(body.buyer.gstin) } : null,
    doctor,
    visitId,
    rxSeen: Boolean(body.rxSeen),
    admissionId: stay?._id ?? null,
    lines,
    discountPercent: pct,
    discountReason: pct ? (body.discountReason ?? '') : '',
    payments: !patient && body.payment ? [{ kind: 'payment', mode: body.payment.mode, amountPaise: total, reference: body.payment.reference ?? '', ...stampOf(req) }] : [],
    created: stampOf(req),
  });

  // A registered patient: the invoice goes on her hospital bill (her stay's while she is admitted)
  if (patient) {
    const bill = stay ? await openStayBill(req, stay) : await openBillFor(req, patient._id);
    await pushLines(req, bill._id, [{ name: `Pharmacy – invoice ${number}`, group: 'medicine', ratePaise: total, source: 'auto', ref: { kind: 'pharmacy', id: invoice._id } }]);
    invoice.billId = bill._id;
    await invoice.save();
  }
  return invoice;
}

/**
 * Takes back unopened medicines (before their expiry – owner's choice): stock returns to its batch, a GST credit note
 * (CN-000001) is made, and her bill line is lowered (a walk-in gets the money back at the counter, `refund`).
 * items: [{ lineId, qty }].
 */
export async function returnItems(req, invoice, items, reason, refund) {
  const today = hospitalToday(req.now);
  const parts = [];
  for (const it of items) {
    const line = invoice.lines.id(it.lineId);
    if (!line) throw bad('A line of this invoice was not found.');
    if (it.qty > line.qty - line.returnedQty) throw bad(`${line.name}: at most ${line.qty - line.returnedQty} can be returned.`);
    if (isExpired(line, today)) throw conflict(`${line.name}, batch ${line.batch}, has expired: it can't be taken back.`, 'EXPIRED');
    parts.push({ line, qty: it.qty, money: partOf(line, it.qty) });
  }
  if (!invoice.patientId && !refund?.mode) throw bad('Choose how the money is given back.');
  const number = padded('CN', await nextNumber(req.tenantId, 'pharmacy-credit'));
  const meta = { kind: 'return', ref: { kind: 'invoice', id: invoice._id, number: invoice.number }, patientId: invoice.patientId, customer: invoice.customer?.name ?? '', doctorName: invoice.doctor?.name ?? '', doctorReg: invoice.doctor?.reg ?? '', reason };
  for (const p of parts) {
    await moveStock(req, { _id: p.line.batchId, batch: p.line.batch }, p.qty, meta);
    p.line.returnedQty += p.qty;
  }
  const credit = sum(parts.map((p) => p.money));
  invoice.returns.push({ number, lines: parts.map((p) => ({ lineId: p.line._id, qty: p.qty, ...p.money })), reason, ...stampOf(req) });
  if (!invoice.patientId) invoice.payments.push({ kind: 'refund', mode: refund.mode, amountPaise: credit.amountPaise, reference: refund.reference ?? '', ...stampOf(req) });
  await invoice.save();

  // Her bill: the invoice line now shows what is still charged
  if (invoice.billId) {
    const net = invoiceTotals(invoice).netPaise;
    await Bill.updateOne(
      { tenantId: req.tenantId, _id: invoice.billId },
      { $set: { 'lines.$[l].ratePaise': net, 'lines.$[l].amountPaise': net, 'lines.$[l].name': `Pharmacy – invoice ${invoice.number} (less return ${number})` } },
      { arrayFilters: [{ 'l.ref.id': invoice._id, 'l.removed': null }] },
    );
  }
  return { invoice, number, credit };
}

/** Writes off stock (expired, damaged, lost) with a reason. */
export async function writeOff(req, batch, qty, reason) {
  return moveStock(req, batch, -qty, { kind: 'writeoff', reason });
}

/** Sets a batch to the counted quantity, with a reason (and a witness for Schedule X and narcotic medicines). */
export async function countStock(req, batch, counted, reason, witness, medicine) {
  if (CONTROLLED.includes(medicine.schedule) && (witness ?? '').trim().length < 2) throw bad(`${medicine.name} is a controlled medicine: write the name of the staff member who checked the count.`, { witness: 'Write the witness’s name.' });
  const diff = counted - batch.qtyLeft;
  if (!diff) throw bad('The count is the same as the stock shown: nothing to change.');
  return moveStock(req, batch, diff, { kind: 'count', reason, witness: witness ?? '' });
}

// ---------- What the website gets ----------

/** An invoice's sums: total, returned, net, GST of the net; walk-in payments, refunds and balance. */
export function invoiceTotals(inv) {
  const sold = sum(inv.lines);
  const returned = sum((inv.returns ?? []).flatMap((r) => r.lines));
  const paid = (inv.payments ?? []).reduce((s, p) => s + (p.kind === 'refund' ? -p.amountPaise : p.amountPaise), 0);
  const net = sold.amountPaise - returned.amountPaise;
  return {
    grossPaise: inv.lines.reduce((s, l) => s + l.qty * l.mrpPaise, 0),
    totalPaise: sold.amountPaise,
    returnedPaise: returned.amountPaise,
    netPaise: net,
    taxablePaise: sold.taxablePaise - returned.taxablePaise,
    cgstPaise: sold.cgstPaise - returned.cgstPaise,
    sgstPaise: sold.sgstPaise - returned.sgstPaise,
    paidPaise: inv.patientId ? null : paid,
    balancePaise: inv.patientId ? null : net - paid,
  };
}

export function invoiceView(inv, { patient = null, today = new Date() } = {}) {
  return {
    id: String(inv._id),
    number: inv.number,
    kind: inv.kind,
    date: inv.created?.at ?? inv.createdAt,
    patient: patient ? { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn, phone: patient.phone ?? '' } : null,
    customer: inv.customer ? { name: inv.customer.name, phone: inv.customer.phone ?? '' } : null,
    // A sale to a business with a GSTIN (it can have an e-invoice file); null for every other invoice
    buyer: inv.buyer?.gstin ? { name: inv.buyer.name ?? '', gstin: inv.buyer.gstin, address: inv.buyer.address ?? '', place: inv.buyer.place ?? '', pin: inv.buyer.pin ?? '', state: inv.buyer.state ?? '', stateCode: inv.buyer.stateCode ?? '' } : null,
    doctor: inv.doctor ? { name: inv.doctor.name, reg: inv.doctor.reg ?? '' } : null,
    fromPrescription: Boolean(inv.visitId),
    rxSeen: Boolean(inv.rxSeen),
    discountPercent: inv.discountPercent ?? 0,
    discountReason: inv.discountReason ?? '',
    billId: inv.billId ? String(inv.billId) : null,
    lines: inv.lines.map((l) => ({
      id: String(l._id),
      medicineId: String(l.medicineId),
      name: l.name,
      generic: l.generic,
      hsn: l.hsn,
      gstRate: l.gstRate,
      schedule: l.schedule,
      batch: l.batch,
      expiry: isoDay(l.expiry),
      qty: l.qty,
      returnedQty: l.returnedQty ?? 0,
      canReturn: (l.returnedQty ?? 0) < l.qty && !isExpired(l, today),
      mrpPaise: l.mrpPaise,
      amountPaise: l.amountPaise,
      taxablePaise: l.taxablePaise,
      cgstPaise: l.cgstPaise,
      sgstPaise: l.sgstPaise,
    })),
    returns: (inv.returns ?? []).map((r) => ({ number: r.number, at: r.at, byName: r.byName ?? '', reason: r.reason ?? '', amountPaise: sum(r.lines).amountPaise, lines: r.lines.map((x) => ({ lineId: String(x.lineId), qty: x.qty, amountPaise: x.amountPaise })) })),
    payments: (inv.payments ?? []).map((p) => ({ kind: p.kind, mode: p.mode, amountPaise: p.amountPaise, reference: p.reference ?? '', at: p.at, byName: p.byName ?? '' })),
    ...invoiceTotals(inv),
    byName: inv.created?.byName ?? '',
  };
}

/** Views of many invoices with their patients. */
export async function invoiceViews(req, invoices) {
  const ids = [...new Set(invoices.map((i) => i.patientId && String(i.patientId)).filter(Boolean))];
  const patients = new Map((ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1, phone: 1 }).lean() : []).map((p) => [String(p._id), p]));
  const today = hospitalToday(req.now);
  return invoices.map((i) => invoiceView(i, { patient: i.patientId ? patients.get(String(i.patientId)) : null, today }));
}

/** Days until a date (negative once passed). */
export const daysLeft = (date, today) => Math.round((utcDay(date) - utcDay(today)) / 86_400_000);
export { addDays, padded };

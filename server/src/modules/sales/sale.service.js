// Counter sales and returns.
//  - Batches: the earliest-expiring one first (or the one chosen); expired batches are never sold.
//  - Price: MRP (GST included), never above; one discount for the sale, with a reason.
//  - H1 / X / narcotic medicines need the patient (or buyer) and the prescribing doctor – they go into the registers.
//  - A registered patient's sale can go on her hospital bill instead of being paid at the counter.
// Stock is taken with an atomic "only if enough is left"; if any line fails, what was taken is put back.
import { REGISTER_SCHEDULE_KEYS, config } from '../../config/index.js';
import { nextNumber } from '../../db/counter.js';
import { withId } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2, sum } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { addPharmacyCharge, reducePharmacyCharge } from '../bills/bill.service.js';
import { Medicine } from '../medicines/medicine.model.js';
import { patientSummary } from '../patients/patient.service.js';
import { StockBatch, recordMovement } from '../stock/stock.model.js';
import { Visit } from '../visits/visit.model.js';
import { markGiven } from '../visits/visit.service.js';
import { Sale } from './sale.model.js';

const { invoicePrefix, numberDigits } = config.pharmacy;

// The GST inside an amount that includes it.
const gstIn = (amount, rate) => round2(amount - amount / (1 + rate / 100));

// Which batches (and how much of each) a line takes.
async function pickBatches(hospitalId, line, now) {
  const filter = { hospitalId, medicineId: line.medicineId, qty: { $gt: 0 }, expiry: { $gt: now } };
  if (line.batchId) filter._id = line.batchId;
  const batches = await StockBatch.find(filter).sort({ expiry: 1, createdAt: 1 }).lean();
  const picks = [];
  let left = line.qty;
  for (const b of batches) {
    if (left === 0) break;
    const take = Math.min(left, b.qty);
    picks.push({ batch: b, qty: take });
    left -= take;
  }
  return { picks, short: left };
}

async function putBack(taken) {
  for (const t of taken) await StockBatch.updateOne({ _id: t.batch._id, hospitalId: t.batch.hospitalId }, { $inc: { qty: t.qty } });
}

export async function sell(req, data) {
  const hospitalId = req.hospitalId;
  const medicines = await Medicine.find({ hospitalId, _id: { $in: data.lines.map((l) => l.medicineId) }, isActive: true });
  const byId = new Map(medicines.map((m) => [m._id.toString(), m]));
  if (data.lines.some((l) => !byId.has(l.medicineId))) throw new HttpError(400, 'A medicine is not on the list or not active.', 'VALIDATION');

  const patient = data.patientId ? await patientSummary(hospitalId, data.patientId) : null;
  const needsRegister = data.lines.some((l) => REGISTER_SCHEDULE_KEYS.includes(byId.get(l.medicineId).schedule));
  if (needsRegister && !data.doctorName) throw fieldError('doctorName', 'H1, X and narcotic medicines need the prescribing doctor.');
  if (needsRegister && !patient && !data.customerName) throw fieldError('customerName', 'H1, X and narcotic medicines need the patient or buyer.');

  // Take the stock, line by line.
  const now = new Date();
  const taken = [];
  try {
    for (const line of data.lines) {
      const { picks, short } = await pickBatches(hospitalId, line, now);
      const medicine = byId.get(line.medicineId);
      if (short > 0) throw new HttpError(400, `Not enough stock of ${medicine.name}: ${line.qty - short} can be sold.`, 'OUT_OF_STOCK');
      for (const p of picks) {
        const ok = await StockBatch.findOneAndUpdate(
          { _id: p.batch._id, hospitalId, qty: { $gte: p.qty }, expiry: { $gt: now } },
          { $inc: { qty: -p.qty } },
        );
        if (!ok) throw new HttpError(409, `The stock of ${medicine.name} just changed. Please try again.`, 'CONFLICT');
        taken.push({ ...p, medicine });
      }
    }
  } catch (err) {
    await putBack(taken);
    throw err;
  }

  const lines = taken.map(({ batch, qty, medicine }) => ({
    medicineId: medicine._id,
    name: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
    schedule: medicine.schedule,
    hsn: medicine.hsn,
    batchId: batch._id,
    batch: batch.batch,
    expiry: batch.expiry,
    qty,
    mrp: batch.mrp,
    gstRate: batch.gstRate,
    amount: round2(batch.mrp * qty),
  }));
  const subtotal = sum(lines.map((l) => l.amount));
  const discount = round2(Math.min(data.discount.amount, subtotal));
  const total = round2(subtotal - discount);
  const factor = subtotal > 0 ? total / subtotal : 0;
  const gst = sum(lines.map((l) => gstIn(l.amount * factor, l.gstRate)));

  const invoiceNumber = await nextNumber(hospitalId, 'pharmacy-invoice', invoicePrefix, numberDigits);
  const party = patient ? `${patient.name} (${patient.patientNumber})` : data.customerName;
  let billNumber = '';
  try {
    if (data.payTo === 'bill') billNumber = await addPharmacyCharge(req, patient.id, { invoiceNumber, amount: total }, data.billId ?? null);
  } catch (err) {
    await putBack(taken);
    throw err;
  }

  const sale = await Sale.create({
    hospitalId,
    invoiceNumber,
    patientId: patient?.id ?? null,
    patient: patient ? { patientNumber: patient.patientNumber, name: patient.name } : undefined,
    customerName: patient ? '' : data.customerName,
    doctorName: data.doctorName,
    admissionId: data.admissionId ?? null,
    lines,
    subtotal,
    discount: { amount: discount, reason: data.discount.reason },
    total,
    taxable: round2(total - gst),
    gst,
    payment: { to: data.payTo, mode: data.payTo === 'counter' ? data.mode : '', reference: data.reference, billNumber },
    byUserId: req.user._id,
    byName: req.user.name,
  });
  for (const t of taken) {
    await recordMovement(req, { medicine: t.medicine, batch: t.batch, kind: data.admissionId ? 'ward_issue' : 'sale', qty: -t.qty, ref: invoiceNumber, party, doctorName: data.doctorName });
  }
  await recordAudit(req, 'SALE_MADE', { hospitalId, details: { invoiceNumber, total, lines: lines.length, ...(billNumber && { billNumber }) } });
  // the prescription it was sold from (her own) leaves the pharmacy's waiting list
  if (data.visitId && patient && (await Visit.exists({ hospitalId, _id: data.visitId, patientId: patient.id }))) {
    await markGiven(req, data.visitId, invoiceNumber);
  }
  return sale;
}

export async function getSale(hospitalId, id) {
  const sale = await Sale.findOne({ _id: id, hospitalId });
  if (!sale) throw notFoundError('Sale');
  return sale;
}

export async function listSales(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId) };
  if (q.status) match.status = q.status;
  if (q.from || q.to) match.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.search) {
    match.$or = [
      { invoiceNumber: new RegExp(`^${escapeRegex(q.search)}`, 'i') },
      { 'patient.name': containsText(q.search) },
      { customerName: containsText(q.search) },
    ];
  }
  return paginate(Sale, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [{ $set: { lineCount: { $size: '$lines' } } }, { $project: { lines: 0 } }, ...withId()],
  });
}

// Unopened medicines back before their expiry: stock goes back to its batch, the money back (or off her bill).
export async function returnItems(req, id, { lines: returns, reason, refundMode }) {
  const sale = await getSale(req.hospitalId, id);
  if (sale.payment.to === 'counter' && !refundMode) throw fieldError('refundMode', 'Choose how the money is given back.');
  const now = new Date();
  const factor = sale.subtotal > 0 ? sale.total / sale.subtotal : 0;
  let amount = 0;
  for (const r of returns) {
    const line = sale.lines.id(r.lineId);
    if (!line) throw notFoundError('Sale line');
    if (r.qty > line.qty - line.returnedQty) throw fieldError('lines', `At most ${line.qty - line.returnedQty} of ${line.name} can come back.`);
    if (line.expiry <= now) throw fieldError('lines', `${line.name} has expired and cannot be taken back.`);
    line.returnedQty += r.qty;
    amount += line.mrp * r.qty * factor;
  }
  amount = round2(amount);
  sale.returnedAmount = round2(sale.returnedAmount + amount);
  sale.status = sale.lines.every((l) => l.returnedQty === l.qty) ? 'returned' : 'part_returned';
  await sale.save();

  const party = sale.patient?.name ? `${sale.patient.name} (${sale.patient.patientNumber})` : sale.customerName;
  for (const r of returns) {
    const line = sale.lines.id(r.lineId);
    const batch = await StockBatch.findOneAndUpdate({ _id: line.batchId, hospitalId: req.hospitalId }, { $inc: { qty: r.qty } }, { returnDocument: 'after' });
    const medicine = await Medicine.findOne({ _id: line.medicineId, hospitalId: req.hospitalId });
    await recordMovement(req, { medicine, batch, kind: 'return', qty: r.qty, ref: sale.invoiceNumber, party, reason });
  }
  if (sale.payment.to === 'bill') await reducePharmacyCharge(req, sale.invoiceNumber, amount);
  await recordAudit(req, 'SALE_RETURNED', { hospitalId: req.hospitalId, details: { invoiceNumber: sale.invoiceNumber, amount, ...(refundMode && { refundMode }) } });
  return { sale, refund: amount };
}

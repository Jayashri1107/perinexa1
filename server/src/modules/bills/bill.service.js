// Bills and payments: create, add or remove lines, discount, cancel, take payment, refund – the totals are always
// worked out again here (recalculate), never trusted from the browser.
import { config } from '../../config/index.js';
import { nextNumber } from '../../db/counter.js';
import { withId } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2, sum } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { patientSummary } from '../patients/patient.service.js';
import { findActiveItems } from '../priceList/priceList.service.js';
import { Bill, Payment } from './bill.model.js';

const { billPrefix, receiptPrefix, numberDigits, pharmacyGroup } = config.billing;

// Subtotal, discount, total, balance and status from the lines and the money.
export function recalculate(bill) {
  bill.subtotal = sum(bill.lines.map((l) => l.amount));
  // Pharmacy lines are already priced (with their own discount) at the counter: a bill discount never applies to them.
  const discountable = sum(bill.lines.filter((l) => l.source !== 'pharmacy').map((l) => l.amount));
  const d = bill.discount;
  const wanted = d.mode === 'percent' ? (discountable * d.value) / 100 : d.value;
  d.amount = round2(Math.min(wanted, discountable));
  bill.total = round2(bill.subtotal - d.amount);
  bill.balance = round2(bill.total - (bill.paid - bill.refunded));
  if (bill.status !== 'cancelled') bill.status = bill.total > 0 && bill.balance <= 0 ? 'paid' : 'open';
}

const netPaid = (bill) => round2(bill.paid - bill.refunded);

// Turns the browser's lines into bill lines, taking names and prices from the price list.
async function toLines(req, lines) {
  const items = await findActiveItems(req.hospitalId, lines.filter((l) => l.priceItemId).map((l) => l.priceItemId));
  return lines.map((l) => {
    if (l.priceItemId) {
      const item = items.get(l.priceItemId);
      if (!item) throw fieldError('lines', 'A price list item is no longer available. Reload the page.');
      return { priceItemId: item._id, code: item.code, name: item.name, group: item.group, qty: l.qty, unitPrice: item.price, amount: round2(item.price * l.qty), addedBy: req.user._id };
    }
    return { name: l.name, group: l.group, qty: l.qty, unitPrice: round2(l.unitPrice), amount: round2(l.unitPrice * l.qty), addedBy: req.user._id };
  });
}

async function findBillOr404(hospitalId, id) {
  const bill = await Bill.findOne({ _id: id, hospitalId });
  if (!bill) throw notFoundError('Bill');
  return bill;
}

const assertOpen = (bill) => {
  if (bill.status === 'cancelled') throw new HttpError(400, 'This bill is cancelled.', 'BILL_CANCELLED');
};

// A change may never leave the bill owing money back without a refund.
const assertNotBelowPaid = (bill) => {
  if (bill.total < netPaid(bill)) {
    throw new HttpError(400, 'More has been paid than the bill would then come to. Record a refund first.', 'REFUND_FIRST');
  }
};

export async function getBill(hospitalId, id) {
  const bill = await findBillOr404(hospitalId, id);
  const payments = await Payment.find({ hospitalId, billId: bill._id }).sort({ createdAt: 1 }).lean();
  return { bill, payments: payments.map(({ _id, ...p }) => ({ id: _id.toString(), ...p })) };
}

export async function createBill(req, { patientId, lines }) {
  const patient = await patientSummary(req.hospitalId, patientId);
  const bill = new Bill({
    hospitalId: req.hospitalId,
    billNumber: await nextNumber(req.hospitalId, 'bill', billPrefix, numberDigits),
    patientId: patient.id,
    patient: { patientNumber: patient.patientNumber, name: patient.name },
    lines: await toLines(req, lines),
    createdBy: req.user._id,
  });
  recalculate(bill);
  await bill.save();
  await recordAudit(req, 'BILL_CREATED', { hospitalId: req.hospitalId, details: { billNumber: bill.billNumber, total: bill.total } });
  return getBill(req.hospitalId, bill._id);
}

export async function addLines(req, id, lines) {
  const bill = await findBillOr404(req.hospitalId, id);
  assertOpen(bill);
  bill.lines.push(...(await toLines(req, lines)));
  recalculate(bill);
  await bill.save();
  await recordAudit(req, 'BILL_UPDATED', { hospitalId: req.hospitalId, details: { billNumber: bill.billNumber, added: lines.length, total: bill.total } });
  return getBill(req.hospitalId, id);
}

export async function removeLine(req, id, lineId) {
  const bill = await findBillOr404(req.hospitalId, id);
  assertOpen(bill);
  const line = bill.lines.id(lineId);
  if (!line) throw notFoundError('Bill line');
  if (line.source === 'pharmacy') throw new HttpError(400, 'Pharmacy lines are changed by a return in the pharmacy.', 'PHARMACY_LINE');
  line.deleteOne();
  recalculate(bill);
  assertNotBelowPaid(bill);
  await bill.save();
  await recordAudit(req, 'BILL_UPDATED', { hospitalId: req.hospitalId, details: { billNumber: bill.billNumber, removed: line.name, total: bill.total } });
  return getBill(req.hospitalId, id);
}

export async function setDiscount(req, id, discount) {
  const bill = await findBillOr404(req.hospitalId, id);
  assertOpen(bill);
  bill.discount = { ...discount, amount: 0 };
  recalculate(bill);
  assertNotBelowPaid(bill);
  await bill.save();
  await recordAudit(req, 'BILL_DISCOUNTED', { hospitalId: req.hospitalId, details: { billNumber: bill.billNumber, discount: bill.discount.amount } });
  return getBill(req.hospitalId, id);
}

export async function cancelBill(req, id, reason) {
  const bill = await findBillOr404(req.hospitalId, id);
  assertOpen(bill);
  if (netPaid(bill) > 0) throw new HttpError(400, 'Money has been paid on this bill. Refund it before cancelling.', 'REFUND_FIRST');
  if (bill.lines.some((l) => l.source === 'pharmacy')) {
    throw new HttpError(400, 'This bill has pharmacy sales. Return them in the pharmacy first.', 'PHARMACY_LINE');
  }
  bill.status = 'cancelled';
  bill.cancelReason = reason;
  await bill.save();
  await recordAudit(req, 'BILL_CANCELLED', { hospitalId: req.hospitalId, details: { billNumber: bill.billNumber } });
  return getBill(req.hospitalId, id);
}

async function recordMoney(req, bill, kind, data) {
  const payment = await Payment.create({
    hospitalId: req.hospitalId,
    receiptNumber: await nextNumber(req.hospitalId, 'receipt', receiptPrefix, numberDigits),
    billId: bill._id,
    billNumber: bill.billNumber,
    patientId: bill.patientId,
    kind,
    mode: data.mode,
    reference: data.reference,
    amount: round2(data.amount),
    reason: data.reason ?? '',
    byUserId: req.user._id,
    byName: req.user.name,
  });
  await recordAudit(req, kind === 'payment' ? 'PAYMENT_RECEIVED' : 'REFUND_GIVEN', {
    hospitalId: req.hospitalId,
    details: { billNumber: bill.billNumber, receiptNumber: payment.receiptNumber, amount: payment.amount, mode: payment.mode },
  });
  return payment;
}

export async function takePayment(req, id, data) {
  const bill = await findBillOr404(req.hospitalId, id);
  assertOpen(bill);
  if (round2(data.amount) > bill.balance) throw fieldError('amount', `At most the balance (${bill.balance}).`);
  bill.paid = round2(bill.paid + data.amount);
  recalculate(bill);
  await bill.save(); // first, so two payments at the same moment cannot both pass the balance check
  const payment = await recordMoney(req, bill, 'payment', data);
  return { ...(await getBill(req.hospitalId, id)), receipt: payment.receiptNumber };
}

export async function giveRefund(req, id, data) {
  const bill = await findBillOr404(req.hospitalId, id);
  if (round2(data.amount) > netPaid(bill)) throw fieldError('amount', `At most what was paid (${netPaid(bill)}).`);
  bill.refunded = round2(bill.refunded + data.amount);
  recalculate(bill);
  await bill.save();
  const payment = await recordMoney(req, bill, 'refund', data);
  return { ...(await getBill(req.hospitalId, id)), receipt: payment.receiptNumber };
}

export async function listBills(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId) };
  if (q.status) match.status = q.status;
  if (q.patientId) match.patientId = q.patientId;
  if (q.from || q.to) match.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ billNumber: new RegExp(`^${escapeRegex(q.search)}`, 'i') }, { 'patient.name': text }, { 'patient.patientNumber': text }];
  }
  return paginate(Bill, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [{ $project: { lines: 0, __v: 0 } }, ...withId()],
  });
}

// A pharmacy sale to a registered patient goes on her open bill (a new bill when she has none).
export async function addPharmacyCharge(req, patientId, { invoiceNumber, amount }) {
  let bill = await Bill.findOne({ hospitalId: req.hospitalId, patientId, status: 'open' }).sort({ createdAt: -1 });
  if (!bill) {
    const patient = await patientSummary(req.hospitalId, patientId);
    bill = new Bill({
      hospitalId: req.hospitalId,
      billNumber: await nextNumber(req.hospitalId, 'bill', billPrefix, numberDigits),
      patientId: patient.id,
      patient: { patientNumber: patient.patientNumber, name: patient.name },
      createdBy: req.user._id,
    });
  }
  bill.lines.push({ name: `Pharmacy – invoice ${invoiceNumber}`, group: pharmacyGroup, qty: 1, unitPrice: round2(amount), amount: round2(amount), source: 'pharmacy', sourceRef: invoiceNumber, addedBy: req.user._id });
  recalculate(bill);
  await bill.save();
  return bill.billNumber;
}

// A pharmacy return takes money off the line of that invoice.
export async function reducePharmacyCharge(req, invoiceNumber, amount) {
  const bill = await Bill.findOne({ hospitalId: req.hospitalId, 'lines.sourceRef': invoiceNumber, status: { $ne: 'cancelled' } });
  if (!bill) return null;
  const line = bill.lines.find((l) => l.sourceRef === invoiceNumber);
  line.unitPrice = line.amount = round2(Math.max(0, line.amount - amount));
  recalculate(bill); // when more was paid than is now due, the balance turns negative: a refund to give
  await bill.save();
  return bill.billNumber;
}

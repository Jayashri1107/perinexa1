// Purchase orders (as in Perinexa's pharmacy/ordersService.js). Rules kept here:
//  - only a draft can be changed; a medicine appears once on an order;
//  - what has been received is counted from the purchases recorded against the order (paid and free units);
//  - "Suggest from low stock" offers the medicines in use at or below their reorder level (unexpired stock), less what
//    is already on an open order;
//  - two people at once: an order is saved with its version (optimisticConcurrency), so a change made from an older
//    copy is refused instead of being lost.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { nextNumber } from '../../db/counter.js';
import { recordAudit } from '../audit/audit.service.js';
import { Medicine } from '../medicines/medicine.model.js';
import { StockBatch } from '../stock/stock.model.js';
import { findActiveSupplier } from '../suppliers/supplier.service.js';
import { PurchaseOrder } from './purchaseOrder.model.js';

const OPEN = ['sent', 'part_received'];
const stamp = (req, extra = {}) => ({ by: req.user._id, byName: req.user.name, at: new Date(), ...extra });
export const isOpen = (o) => OPEN.includes(o.status) && !o.closed;
const canChange = (req) => req.membership.roles.some((r) => config.access.pharmacyCounter.includes(r));
function assertCanChange(req) {
  if (!canChange(req)) throw new HttpError(403, 'The pharmacist keeps the purchase orders.', 'FORBIDDEN');
}

// An order's status from what has been received.
function statusFromLines(lines) {
  if (lines.length && lines.every((l) => l.receivedQty >= l.qty)) return 'received';
  return lines.some((l) => l.receivedQty > 0) ? 'part_received' : 'sent';
}

export function orderView(o, req) {
  const order = o.toObject ? o.toObject() : o;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    supplierId: String(order.supplierId),
    supplierName: order.supplierName,
    status: order.status,
    closed: order.closed,
    note: order.note,
    lines: order.lines.map((l) => ({ medicineId: String(l.medicineId), medicineName: l.medicineName, qty: l.qty, gstRate: l.gstRate, receivedQty: l.receivedQty, outstanding: Math.max(0, l.qty - l.receivedQty) })),
    created: order.created,
    sent: order.sent,
    cancelled: order.cancelled,
    createdAt: order.createdAt,
    can: req
      ? {
          edit: canChange(req) && order.status === 'draft',
          send: canChange(req) && order.status === 'draft',
          cancel: canChange(req) && ['draft', 'sent'].includes(order.status),
          close: canChange(req) && order.status === 'part_received' && !order.closed,
          receive: canChange(req) && isOpen(order),
        }
      : undefined,
  };
}

export async function listOrders(req, q) {
  const match = { hospitalId: toObjectId(req.hospitalId) };
  if (q.status === 'open') Object.assign(match, { status: { $in: OPEN }, closed: null });
  else if (q.status) match.status = q.status;
  if (q.supplierId) match.supplierId = toObjectId(q.supplierId);
  if (q.search) match.$or = [{ orderNumber: containsText(q.search) }, { supplierName: containsText(q.search) }, { 'lines.medicineName': containsText(q.search) }];
  const result = await paginate(PurchaseOrder, { match, sort: toSort(q.sort), page: q.page, limit: q.limit });
  result.items = result.items.map((o) => ({ ...orderView(o), lineCount: o.lines.length }));
  return result;
}

async function load(req, id) {
  const order = await PurchaseOrder.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!order) throw notFoundError('Purchase order');
  return order;
}

export async function getOrder(req, id) {
  return orderView(await load(req, id), req);
}

// The lines checked against the medicine list: medicines in use, each once.
async function checkedLines(req, lines) {
  const meds = new Map((await Medicine.find({ hospitalId: req.hospitalId, _id: { $in: lines.map((l) => l.medicineId) }, isActive: true }).lean()).map((m) => [String(m._id), m]));
  const seen = new Set();
  return lines.map((l, i) => {
    const m = meds.get(String(l.medicineId));
    if (!m) throw fieldError(`lines.${i}.medicineId`, 'Choose a medicine in use.');
    if (seen.has(String(l.medicineId))) throw fieldError(`lines.${i}.medicineId`, `${m.name} is on this order twice: keep one line.`);
    seen.add(String(l.medicineId));
    return { medicineId: m._id, medicineName: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, qty: l.qty, gstRate: m.gstRate ?? 0, receivedQty: 0 };
  });
}

export async function createOrder(req, body) {
  assertCanChange(req);
  const supplier = await findActiveSupplier(req.hospitalId, body.supplierId);
  // checked before a number is taken, so a refused order leaves no gap in the numbers
  const lines = await checkedLines(req, body.lines);
  const order = await PurchaseOrder.create({
    hospitalId: req.hospitalId,
    orderNumber: await nextNumber(req.hospitalId, 'purchaseOrder', config.pharmacy.orderPrefix, config.pharmacy.numberDigits),
    supplierId: supplier._id,
    supplierName: supplier.name,
    lines,
    note: body.note,
    created: stamp(req),
  });
  await recordAudit(req, 'ORDER_CREATED', { hospitalId: req.hospitalId, details: { orderNumber: order.orderNumber, supplier: supplier.name, lines: order.lines.length } });
  return orderView(order, req);
}

export async function updateOrder(req, id, body) {
  assertCanChange(req);
  const order = await load(req, id);
  if (order.status !== 'draft') throw new HttpError(409, `Order ${order.orderNumber} was already sent: it can no longer be changed.`, 'NOT_DRAFT');
  const supplier = await findActiveSupplier(req.hospitalId, body.supplierId);
  order.set({ supplierId: supplier._id, supplierName: supplier.name, lines: await checkedLines(req, body.lines), note: body.note });
  await order.save();
  await recordAudit(req, 'ORDER_UPDATED', { hospitalId: req.hospitalId, details: { orderNumber: order.orderNumber } });
  return orderView(order, req);
}

async function step(req, id, allowed, change, audit, message) {
  assertCanChange(req);
  const order = await load(req, id);
  if (!allowed(order)) throw new HttpError(409, message(order), 'WRONG_STATE');
  order.set(change(order));
  await order.save();
  await recordAudit(req, audit, { hospitalId: req.hospitalId, details: { orderNumber: order.orderNumber } });
  return orderView(order, req);
}

export const sendOrder = (req, id) =>
  step(req, id, (o) => o.status === 'draft', () => ({ status: 'sent', sent: stamp(req) }), 'ORDER_SENT', (o) => `Order ${o.orderNumber} is not a draft.`);

export const cancelOrder = (req, id, reason) =>
  step(
    req,
    id,
    (o) => ['draft', 'sent'].includes(o.status) && o.lines.every((l) => l.receivedQty === 0),
    () => ({ status: 'cancelled', cancelled: stamp(req, { reason }) }),
    'ORDER_CANCELLED',
    (o) => `Order ${o.orderNumber} cannot be cancelled: something was already received, or it is closed.`,
  );

export const closeOrder = (req, id, reason) =>
  step(req, id, (o) => o.status === 'part_received' && !o.closed, () => ({ closed: stamp(req, { reason }) }), 'ORDER_CLOSED', (o) => `Order ${o.orderNumber} is not part received, or it is already closed.`);

// ---------- Receiving (called by purchases) ----------

// The open order a purchase is recorded against: same supplier, still open.
export async function openOrderFor(req, orderId, supplierId) {
  const order = await load(req, orderId);
  if (!isOpen(order)) throw fieldError('purchaseOrderId', `Order ${order.orderNumber} is not open: it was not sent, is received, cancelled or closed.`);
  if (String(order.supplierId) !== String(supplierId)) throw fieldError('purchaseOrderId', `Order ${order.orderNumber} is for ${order.supplierName}, not this supplier.`);
  return order;
}

// Counts a purchase's units (paid and free) on its order and moves the order on.
export async function receiveOnOrder(order, purchaseLines) {
  for (const pl of purchaseLines) {
    const line = order.lines.find((l) => String(l.medicineId) === String(pl.medicineId));
    if (line) line.receivedQty += pl.qty + (pl.freeQty ?? 0);
  }
  order.status = statusFromLines(order.lines);
  await order.save();
  return order;
}

// ---------- Suggest from low stock ----------

// Medicines in use at or below their reorder level (unexpired stock), less what is already on an open order:
// [{ medicineId, medicineName, reorderLevel, usable, onOrder, qty }]. qty: enough for twice the reorder level.
export async function suggest(req) {
  const hid = toObjectId(req.hospitalId);
  const now = new Date();
  const [medicines, stock, open] = await Promise.all([
    Medicine.find({ hospitalId: hid, isActive: true, reorderLevel: { $gt: 0 } }).lean(),
    StockBatch.aggregate([{ $match: { hospitalId: hid, qty: { $gt: 0 }, expiry: { $gt: now } } }, { $group: { _id: '$medicineId', usable: { $sum: '$qty' } } }]),
    PurchaseOrder.find({ hospitalId: hid, status: { $in: ['draft', ...OPEN] }, closed: null }).lean(),
  ]);
  const usable = new Map(stock.map((s) => [String(s._id), s.usable]));
  const onOrder = new Map();
  for (const o of open) for (const l of o.lines) onOrder.set(String(l.medicineId), (onOrder.get(String(l.medicineId)) ?? 0) + Math.max(0, l.qty - l.receivedQty));
  return medicines
    .map((m) => {
      const have = usable.get(String(m._id)) ?? 0;
      const coming = onOrder.get(String(m._id)) ?? 0;
      return { medicineId: String(m._id), medicineName: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, reorderLevel: m.reorderLevel, usable: have, onOrder: coming, qty: Math.max(0, 2 * m.reorderLevel - have - coming) };
    })
    .filter((s) => s.usable <= s.reorderLevel && s.qty > 0)
    .sort((a, b) => a.medicineName.localeCompare(b.medicineName));
}

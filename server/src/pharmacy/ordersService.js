// Purchase orders to suppliers (PO-000001 …): what the pharmacy asks a supplier for. An order moves no stock – stock
// comes in only when a purchase (the supplier's invoice) is entered against it.
//
//   draft ──send──▶ sent ──receive──▶ part received ──receive──▶ received
//     │              │                      └──close (nothing more will come; it stays "part received")
//     └──cancel──────┴──▶ cancelled (only while nothing has been received)
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - only a draft can be edited; a medicine appears once on an order;
//  - what has been received is counted from the purchases entered against the order (their paid and free units), and
//    taken back when such a purchase is cancelled;
//  - "Suggest from low stock" offers the medicines in use at or below their reorder level (stock that has not
//    expired), less what is already on an open order;
//  - two people at once: every change of an order is ONE conditional update that also raises its version (__v), so a
//    change made from an older copy is noticed – a draft changed while someone marks it as sent, an order cancelled or
//    closed while a purchase against it is being saved.

import { stampOf } from '../billing/billingService.js';
import { hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { nextNumber } from '../models/Counter.js';
import { Medicine, Purchase, PurchaseOrder, StockBatch, Supplier } from '../models/Pharmacy.js';
import { HttpError } from '../utils/httpError.js';
import { canEdit, medicineView, supplierView } from './pharmacyHttp.js';
import { ORDER_STATUS_LABELS, ORDER_SUGGEST_TIMES, PHARMACY_DESK_ROLES } from './pharmacyRules.js';

const padded = (prefix, n) => `${prefix}-${String(n).padStart(6, '0')}`;
const bad = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), fields ? { fields } : {});
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const OPEN = ['sent', 'part_received'];

/** Still to come on a line. */
export const outstanding = (line) => Math.max(0, line.qty - (line.receivedQty ?? 0));
/** An order's status from what has been received (never for a draft or a cancelled order). PURE. */
export function statusFromLines(lines) {
  if (lines.length && lines.every((l) => (l.receivedQty ?? 0) >= l.qty)) return 'received';
  return lines.some((l) => (l.receivedQty ?? 0) > 0) ? 'part_received' : 'sent';
}
/** Can more be received against it? */
export const isOpen = (order) => OPEN.includes(order.status) && !order.closed;

async function supplierInUse(req, supplierId) {
  const supplier = await Supplier.findOne({ tenantId: req.tenantId, _id: supplierId, active: true }).lean();
  if (!supplier) throw bad('Choose a supplier in use.', { supplierId: 'Choose a supplier in use.' });
  return supplier;
}

/** The order's lines checked against the stock list: medicines in use, each once. → [{ medicineId, name, qty }] */
async function checkedLines(req, lines) {
  const meds = new Map((await Medicine.find({ tenantId: req.tenantId, _id: { $in: lines.map((l) => l.medicineId) }, active: true }, { name: 1 }).lean()).map((m) => [String(m._id), m]));
  const fields = {};
  const seen = new Set();
  lines.forEach((l, i) => {
    const key = String(l.medicineId);
    if (!meds.has(key)) fields[`lines.${i}.medicineId`] = 'Choose a medicine in use.';
    else if (seen.has(key)) fields[`lines.${i}.medicineId`] = `${meds.get(key).name} is on this order twice: keep one line.`;
    seen.add(key);
  });
  if (Object.keys(fields).length) throw bad(Object.values(fields)[0], fields);
  return lines.map((l) => ({ medicineId: l.medicineId, name: meds.get(String(l.medicineId)).name, qty: l.qty }));
}

/** A new order, as a draft. body: { supplierId, lines [{ medicineId, qty }], note }. */
export async function createOrder(req, body) {
  const supplier = await supplierInUse(req, body.supplierId);
  const lines = await checkedLines(req, body.lines);
  const number = padded('PO', await nextNumber(req.tenantId, 'pharmacy-order'));
  return PurchaseOrder.create({ tenantId: req.tenantId, number, supplierId: supplier._id, lines, note: body.note ?? '', status: 'draft', created: stampOf(req) });
}

/**
 * Changes a draft (supplier, medicines, quantities, note) – in one step that only a draft takes, so an order that
 * someone else marked as sent (or cancelled) a moment ago is not changed after the supplier was given it.
 */
export async function updateOrder(req, order, body) {
  const notDraft = () => conflict(`Order ${order.number} is no longer a draft: it cannot be changed. Cancel it and make a new one.`, 'NOT_DRAFT');
  if (order.status !== 'draft') throw notDraft();
  const supplier = await supplierInUse(req, body.supplierId);
  const lines = await checkedLines(req, body.lines);
  const after = await PurchaseOrder.findOneAndUpdate(
    { tenantId: req.tenantId, _id: order._id, status: 'draft' },
    { $set: { supplierId: supplier._id, lines, note: body.note ?? '' }, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!after) throw notDraft();
  return after;
}

/**
 * A change of status that must start from one of `from`: done in one step, so two people cannot both do it. It raises
 * the order's version, so a purchase being counted against the order at that moment (applyPurchase) notices it.
 */
async function step(req, order, from, set, refusal) {
  const after = await PurchaseOrder.findOneAndUpdate({ tenantId: req.tenantId, _id: order._id, status: { $in: from }, closed: null }, { $set: set, $inc: { __v: 1 } }, { returnDocument: 'after' });
  if (!after) throw conflict(refusal, 'WRONG_STATUS');
  return after;
}

/** Draft → sent (the order has been given or sent to the supplier; Perinexa itself sends nothing). */
export const sendOrder = (req, order) => step(req, order, ['draft'], { status: 'sent', sent: stampOf(req) }, `Order ${order.number} is not a draft: it was already sent or cancelled.`);

/** Cancels a draft or a sent order of which nothing has been received. */
export const cancelOrder = (req, order, reason) =>
  step(req, order, ['draft', 'sent'], { status: 'cancelled', cancelled: { ...stampOf(req), reason } }, `Order ${order.number} cannot be cancelled: medicines were already received against it, or it was cancelled before.`);

/** Part received, and nothing more will come: no more can be received against it. */
export const closeOrder = (req, order, reason) => step(req, order, ['part_received'], { closed: { ...stampOf(req), reason } }, `Order ${order.number} is not part received, or it is already closed.`);

/**
 * The order a new purchase is received against: it must be this hospital's, sent (or part received and not closed),
 * from the same supplier, and at least one of the purchase's medicines must be on it.
 */
export async function orderToReceive(req, orderId, body) {
  const order = await PurchaseOrder.findOne({ tenantId: req.tenantId, _id: orderId }).lean();
  if (!order) throw new HttpError(404, 'Purchase order not found.', 'NOT_FOUND');
  if (!isOpen(order)) {
    throw conflict(
      order.status === 'draft' ? `Order ${order.number} is still a draft: mark it as sent first.` : `Order ${order.number} is ${order.closed ? 'closed' : ORDER_STATUS_LABELS[order.status].toLowerCase()}: nothing more can be received against it.`,
      'WRONG_STATUS',
    );
  }
  if (String(order.supplierId) !== String(body.supplierId)) throw bad(`Order ${order.number} was made to another supplier: choose that supplier, or enter this purchase without the order.`, { supplierId: 'Not the supplier of the order.' });
  const onOrder = new Set(order.lines.map((l) => String(l.medicineId)));
  if (!body.lines.some((l) => onOrder.has(String(l.medicineId)))) throw bad(`None of these medicines is on order ${order.number}.`);
  return order;
}

/**
 * Adds (sign +1) the units of a purchase to the order it was received against, or takes them back (sign −1, the
 * purchase was cancelled – a closed order is then open again), and sets the order's status from what has been
 * received. purchaseLines: [{ medicineId, qty, freeQty }].
 * Returns { order, counted }: the order as it now is (null: no such order), and whether the units were counted. They
 * are NOT counted when the order was cancelled – or, for a new purchase, closed – meanwhile: `order` then says which.
 */
export async function applyPurchase(req, orderId, purchaseLines, sign = 1) {
  const units = new Map();
  for (const l of purchaseLines) units.set(String(l.medicineId), (units.get(String(l.medicineId)) ?? 0) + sign * (l.qty + (l.freeQty ?? 0)));
  // Read, work out, write only if nobody else changed the order meanwhile – and try again if somebody did.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const order = await PurchaseOrder.findOne({ tenantId: req.tenantId, _id: orderId }).lean();
    if (!order || order.status === 'cancelled' || order.status === 'draft' || (sign > 0 && order.closed)) return { order, counted: false };
    const lines = order.lines.map((l) => ({ ...l, receivedQty: Math.max(0, (l.receivedQty ?? 0) + (units.get(String(l.medicineId)) ?? 0)) }));
    const set = { lines, status: statusFromLines(lines), ...(sign < 0 ? { closed: null } : {}) };
    const after = await PurchaseOrder.findOneAndUpdate({ tenantId: req.tenantId, _id: orderId, __v: order.__v }, { $set: set, $inc: { __v: 1 } }, { returnDocument: 'after' }).lean();
    if (after) return { order: after, counted: true };
  }
  throw conflict('This order was changed by someone else at the same moment. Open it again to see what was received.');
}

/**
 * A purchase that was just saved against an order (its stock is already in) is counted on the order. When the order
 * was cancelled or closed at that very moment – after it was checked, before the purchase was saved – the purchase
 * stays (the stock did arrive) but is taken off the order, and the answer says so instead of leaving a purchase linked
 * to an order that does not count it.
 * Returns { order, counted, why }: why is 'cancelled' | 'closed' | 'busy' when it was not counted.
 */
export async function countPurchaseOnOrder(req, orderId, purchase) {
  let out;
  try {
    out = await applyPurchase(req, orderId, purchase.lines, 1);
  } catch (err) {
    if (err?.status !== 409) throw err;
    out = { order: await PurchaseOrder.findOne({ tenantId: req.tenantId, _id: orderId }).lean(), counted: false, busy: true };
  }
  if (out.counted) return { order: out.order, counted: true, why: null };
  await Purchase.updateOne({ tenantId: req.tenantId, _id: purchase._id }, { $set: { orderId: null } });
  purchase.orderId = null;
  return { order: out.order, counted: false, why: out.busy ? 'busy' : out.order?.status === 'cancelled' ? 'cancelled' : out.order?.closed ? 'closed' : 'busy' };
}

// ---------- Suggest from low stock ----------

/** How many to order to bring a medicine up to ORDER_SUGGEST_TIMES × its reorder level (at least 1). PURE. */
export function suggestedOrderQty({ reorderLevel = 0, usable = 0, onOrder = 0 }) {
  const target = Math.max(reorderLevel * ORDER_SUGGEST_TIMES, 1);
  return Math.max(0, target - usable - onOrder);
}

/**
 * Medicines in use at or below their reorder level (stock that has not expired), each with what is already on an open
 * order, a suggested quantity and the supplier it was last bought from.
 */
export async function suggestFromLowStock(req) {
  const tenantId = req.tenantId;
  const today = hospitalToday(req.now);
  const meds = await Medicine.find({ tenantId, active: true }).sort({ name: 1 }).lean();
  const usableRows = await StockBatch.aggregate([{ $match: { tenantId, qtyLeft: { $gt: 0 }, expiry: { $gte: utcDay(today) } } }, { $group: { _id: '$medicineId', qty: { $sum: '$qtyLeft' } } }]);
  const usable = new Map(usableRows.map((r) => [String(r._id), r.qty]));
  const low = meds.filter((m) => (usable.get(String(m._id)) ?? 0) <= (m.reorderLevel ?? 0));
  if (!low.length) return [];

  const open = await PurchaseOrder.find({ tenantId, status: { $in: OPEN }, closed: null }, { number: 1, lines: 1 }).lean();
  const onOrder = new Map(); // "<medicineId>" → { qty, orders: [number] }
  for (const o of open) {
    for (const l of o.lines) {
      const left = outstanding(l);
      if (!left) continue;
      const row = onOrder.get(String(l.medicineId)) ?? { qty: 0, orders: [] };
      row.qty += left;
      row.orders.push(o.number);
      onOrder.set(String(l.medicineId), row);
    }
  }

  const lastRows = await StockBatch.aggregate([
    { $match: { tenantId, medicineId: { $in: low.map((m) => m._id) }, supplierId: { $ne: null } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$medicineId', supplierId: { $first: '$supplierId' } } },
  ]);
  const lastSupplier = new Map(lastRows.map((r) => [String(r._id), String(r.supplierId)]));
  const suppliers = new Map((await Supplier.find({ tenantId, _id: { $in: [...new Set(lastSupplier.values())] } }, { name: 1 }).lean()).map((s) => [String(s._id), s.name]));

  return low.map((m) => {
    const key = String(m._id);
    const have = usable.get(key) ?? 0;
    const ordered = onOrder.get(key) ?? { qty: 0, orders: [] };
    const supplierId = lastSupplier.get(key) ?? null;
    return {
      medicine: medicineView(m, have),
      inStock: have,
      reorderLevel: m.reorderLevel ?? 0,
      onOrder: ordered.qty,
      onOrders: ordered.orders,
      suggestedQty: suggestedOrderQty({ reorderLevel: m.reorderLevel ?? 0, usable: have, onOrder: ordered.qty }),
      lastSupplier: supplierId && suppliers.has(supplierId) ? { id: supplierId, name: suppliers.get(supplierId) } : null,
    };
  });
}

// ---------- What the website gets ----------

const stampView = (s) => (s ? { at: s.at, byName: s.byName ?? '', ...(s.reason !== undefined ? { reason: s.reason ?? '' } : {}) } : null);

/** What this person may do with the order now (the buttons the website shows; the server checks again). */
export function orderCan(req, order) {
  const edit = canEdit(req);
  return {
    edit: edit && order.status === 'draft',
    send: edit && order.status === 'draft' && order.lines.length > 0,
    receive: hasRole(req.membership, ...PHARMACY_DESK_ROLES) && isOpen(order),
    cancel: edit && ['draft', 'sent'].includes(order.status),
    close: edit && order.status === 'part_received' && !order.closed,
  };
}

/** Views of orders (plain objects) with their suppliers; `full` adds each line's medicine and the purchases received. */
export async function orderViews(req, orders, { full = false } = {}) {
  const tenantId = req.tenantId;
  const suppliers = new Map((await Supplier.find({ tenantId, _id: { $in: orders.map((o) => o.supplierId) } }).lean()).map((s) => [String(s._id), s]));
  const meds = full ? new Map((await Medicine.find({ tenantId, _id: { $in: orders.flatMap((o) => o.lines.map((l) => l.medicineId)) } }).lean()).map((m) => [String(m._id), m])) : new Map();
  const purchases = full ? await Purchase.find({ tenantId, orderId: { $in: orders.map((o) => o._id) } }, { number: 1, invoiceNo: 1, invoiceDate: 1, status: 1, orderId: 1 }).sort({ createdAt: 1 }).lean() : [];
  return orders.map((o) => {
    const s = suppliers.get(String(o.supplierId));
    return {
      id: String(o._id),
      number: o.number,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      closed: stampView(o.closed),
      supplier: s ? supplierView(s) : null,
      note: o.note ?? '',
      date: o.created?.at ?? o.createdAt,
      byName: o.created?.byName ?? '',
      sent: stampView(o.sent),
      cancelled: stampView(o.cancelled),
      items: o.lines.length,
      units: o.lines.reduce((n, l) => n + l.qty, 0),
      lines: o.lines.map((l) => {
        const m = meds.get(String(l.medicineId));
        return {
          id: String(l._id),
          medicineId: String(l.medicineId),
          name: l.name,
          qty: l.qty,
          receivedQty: l.receivedQty ?? 0,
          outstanding: outstanding(l),
          ...(m ? { medicine: medicineView(m) } : {}),
        };
      }),
      ...(full ? { purchases: purchases.filter((p) => String(p.orderId) === String(o._id)).map((p) => ({ id: String(p._id), number: p.number, invoiceNo: p.invoiceNo, invoiceDate: isoDay(p.invoiceDate), status: p.status })) } : {}),
      can: orderCan(req, o),
    };
  });
}

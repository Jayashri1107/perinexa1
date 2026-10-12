import { Router } from 'express';
import { z } from 'zod';
import { PurchaseOrder } from '../models/Pharmacy.js';
import { cancelOrder, closeOrder, createOrder, orderViews, sendOrder, suggestFromLowStock, updateOrder } from '../pharmacy/ordersService.js';
import { editor, idParam, notFound, qty, reason, settingsOf } from '../pharmacy/pharmacyHttp.js';
import { MAX_ORDER_LINES, ORDER_STATUSES, ORDER_SUGGEST_TIMES } from '../pharmacy/pharmacyRules.js';
import { audit } from '../utils/audit.js';
import { objectId, parse } from '../utils/validate.js';

// Purchase orders to suppliers: /api/pharmacy/orders (mounted inside routes/pharmacy.js, after its "pharmacists and
// the hospital admin only" check). The pharmacist or the hospital admin makes, sends, cancels, closes and prints an
// order; receiving one is entering a purchase against it (POST /api/pharmacy/purchases with orderId – the pharmacist).
// An order holds no patient data: suppliers, medicines and quantities only. The audit log gets ids and numbers.

export const pharmacyOrdersRouter = Router();

const orderSchema = z
  .object({
    supplierId: objectId,
    lines: z.array(z.object({ medicineId: objectId, qty }).strict()).min(1, 'Add at least one medicine.').max(MAX_ORDER_LINES, `An order holds at most ${MAX_ORDER_LINES} medicines.`),
    note: z.string().trim().max(300).default(''),
  })
  .strict();

const loadOrder = async (req) => {
  const order = await PurchaseOrder.findOne({ tenantId: req.tenantId, _id: idParam(req) });
  if (!order) throw notFound('Purchase order');
  return order;
};
const one = async (req, order) => (await orderViews(req, [order.toObject ? order.toObject() : order], { full: true }))[0];
const ids = (order) => ({ orderId: String(order._id), number: order.number });

pharmacyOrdersRouter.get('/', async (req, res) => {
  const q = parse(z.object({ status: z.enum(ORDER_STATUSES).optional() }).strict(), req.query);
  const list = await PurchaseOrder.find({ tenantId: req.tenantId, ...(q.status ? { status: q.status } : {}) }).sort({ 'created.at': -1, _id: -1 }).limit(200).lean();
  res.json({ orders: await orderViews(req, list) });
});

// Medicines at or below their reorder level, to fill a new order with ("Suggest from low stock").
pharmacyOrdersRouter.get('/suggest', async (req, res) => {
  editor(req);
  res.json({ suggestions: await suggestFromLowStock(req), times: ORDER_SUGGEST_TIMES });
});

pharmacyOrdersRouter.post('/', async (req, res) => {
  editor(req);
  const order = await createOrder(req, parse(orderSchema, req.body));
  await audit(req, 'PHARMACY_ORDER_CREATED', { details: { ...ids(order), supplierId: String(order.supplierId), lines: order.lines.length } });
  res.status(201).json({ order: await one(req, order) });
});

// One order, with the pharmacy's details for its printout.
pharmacyOrdersRouter.get('/:id', async (req, res) => {
  const order = await loadOrder(req);
  res.json({ order: await one(req, order), settings: await settingsOf(req.tenantId) });
});

pharmacyOrdersRouter.put('/:id', async (req, res) => {
  editor(req);
  const body = parse(orderSchema, req.body);
  const order = await updateOrder(req, await loadOrder(req), body);
  await audit(req, 'PHARMACY_ORDER_CHANGED', { details: { ...ids(order), supplierId: String(order.supplierId), lines: order.lines.length } });
  res.json({ order: await one(req, order) });
});

pharmacyOrdersRouter.post('/:id/send', async (req, res) => {
  editor(req);
  parse(z.object({}).strict(), req.body);
  const order = await sendOrder(req, await loadOrder(req));
  await audit(req, 'PHARMACY_ORDER_SENT', { details: ids(order) });
  res.json({ order: await one(req, order) });
});

pharmacyOrdersRouter.post('/:id/cancel', async (req, res) => {
  editor(req);
  const body = parse(z.object({ reason: reason('Cancelling an order') }).strict(), req.body);
  const order = await cancelOrder(req, await loadOrder(req), body.reason);
  await audit(req, 'PHARMACY_ORDER_CANCELLED', { details: ids(order) });
  res.json({ order: await one(req, order) });
});

// Part received and nothing more will come.
pharmacyOrdersRouter.post('/:id/close', async (req, res) => {
  editor(req);
  const body = parse(z.object({ reason: reason('Closing an order') }).strict(), req.body);
  const order = await closeOrder(req, await loadOrder(req), body.reason);
  await audit(req, 'PHARMACY_ORDER_CLOSED', { details: ids(order) });
  res.json({ order: await one(req, order) });
});

pharmacyOrdersRouter.post('/:id/printed', async (req, res) => {
  parse(z.object({}).strict(), req.body);
  const order = await loadOrder(req);
  await audit(req, 'PHARMACY_ORDER_PRINTED', { details: ids(order) });
  res.json({ ok: true });
});

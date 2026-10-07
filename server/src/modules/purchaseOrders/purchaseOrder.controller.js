import { parse } from '../../core/validate.js';
import * as service from './purchaseOrder.service.js';
import { orderBody, orderListQuery, orderParams, reasonBody } from './purchaseOrder.validation.js';

const idOf = (req) => parse(orderParams, req.params).id;

export async function list(req, res) {
  res.json(await service.listOrders(req, parse(orderListQuery, req.query)));
}

export async function suggest(req, res) {
  res.json({ items: await service.suggest(req) });
}

export async function get(req, res) {
  res.json({ order: await service.getOrder(req, idOf(req)) });
}

export async function create(req, res) {
  res.status(201).json({ order: await service.createOrder(req, parse(orderBody, req.body)) });
}

export async function update(req, res) {
  res.json({ order: await service.updateOrder(req, idOf(req), parse(orderBody, req.body)) });
}

export async function send(req, res) {
  res.json({ order: await service.sendOrder(req, idOf(req)) });
}

export async function cancel(req, res) {
  res.json({ order: await service.cancelOrder(req, idOf(req), parse(reasonBody, req.body).reason) });
}

export async function close(req, res) {
  res.json({ order: await service.closeOrder(req, idOf(req), parse(reasonBody, req.body).reason) });
}

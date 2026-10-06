import { parse } from '../../core/validate.js';
import * as service from './purchase.service.js';
import { purchaseBody, purchaseListQuery, purchaseParams } from './purchase.validation.js';

export async function list(req, res) {
  res.json(await service.listPurchases(req.hospitalId, parse(purchaseListQuery, req.query)));
}

export async function get(req, res) {
  const { id } = parse(purchaseParams, req.params);
  res.json({ purchase: await service.getPurchase(req.hospitalId, id) });
}

export async function create(req, res) {
  res.status(201).json({ purchase: await service.recordPurchase(req, parse(purchaseBody, req.body)) });
}

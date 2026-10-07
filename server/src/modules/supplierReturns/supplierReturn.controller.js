import { parse } from '../../core/validate.js';
import * as service from './supplierReturn.service.js';
import { cancelBody, returnBody, returnListQuery, returnParams, supplierParams } from './supplierReturn.validation.js';

export async function list(req, res) {
  res.json(await service.listReturns(req, parse(returnListQuery, req.query)));
}

export async function batches(req, res) {
  res.json({ items: await service.returnableBatches(req, parse(supplierParams, req.params).supplierId) });
}

export async function get(req, res) {
  res.json({ supplierReturn: await service.getReturn(req, parse(returnParams, req.params).id) });
}

export async function create(req, res) {
  res.status(201).json({ supplierReturn: await service.createReturn(req, parse(returnBody, req.body)) });
}

export async function cancel(req, res) {
  res.json({ supplierReturn: await service.cancelReturn(req, parse(returnParams, req.params).id, parse(cancelBody, req.body)) });
}

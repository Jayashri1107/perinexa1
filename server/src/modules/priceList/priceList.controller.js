import { parse, statusBody } from '../../core/validate.js';
import * as service from './priceList.service.js';
import { createPriceBody, priceListQuery, priceParams, updatePriceBody } from './priceList.validation.js';

export async function list(req, res) {
  res.json(await service.listPrices(req.hospitalId, parse(priceListQuery, req.query)));
}

export async function options(req, res) {
  res.json({ items: await service.priceOptions(req.hospitalId) });
}

export async function create(req, res) {
  res.status(201).json({ item: await service.createPrice(req, parse(createPriceBody, req.body)) });
}

export async function update(req, res) {
  const { id } = parse(priceParams, req.params);
  res.json({ item: await service.updatePrice(req, id, parse(updatePriceBody, req.body)) });
}

export async function setStatus(req, res) {
  const { id } = parse(priceParams, req.params);
  res.json({ item: await service.setPriceStatus(req, id, parse(statusBody, req.body).isActive) });
}

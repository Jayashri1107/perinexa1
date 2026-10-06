import { parse, statusBody } from '../../core/validate.js';
import * as service from './supplier.service.js';
import { supplierBody, supplierListQuery, supplierParams } from './supplier.validation.js';

export async function list(req, res) {
  res.json(await service.listSuppliers(req.hospitalId, parse(supplierListQuery, req.query)));
}

export async function options(req, res) {
  res.json({ items: await service.supplierOptions(req.hospitalId) });
}

export async function create(req, res) {
  res.status(201).json({ item: await service.createSupplier(req, parse(supplierBody, req.body)) });
}

export async function update(req, res) {
  const { id } = parse(supplierParams, req.params);
  res.json({ item: await service.updateSupplier(req, id, parse(supplierBody, req.body)) });
}

export async function setStatus(req, res) {
  const { id } = parse(supplierParams, req.params);
  res.json({ item: await service.setSupplierStatus(req, id, parse(statusBody, req.body).isActive) });
}

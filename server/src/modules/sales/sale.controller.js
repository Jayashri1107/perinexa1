import { parse } from '../../core/validate.js';
import { pickPatients } from '../patients/patient.service.js';
import { patientSearchQuery } from '../bills/bill.validation.js';
import * as service from './sale.service.js';
import { returnBody, saleBody, saleListQuery, saleParams } from './sale.validation.js';

export async function list(req, res) {
  res.json(await service.listSales(req.hospitalId, parse(saleListQuery, req.query)));
}

export async function patients(req, res) {
  res.json({ items: await pickPatients(req.hospitalId, parse(patientSearchQuery, req.query).search) });
}

export async function get(req, res) {
  const { id } = parse(saleParams, req.params);
  res.json({ sale: await service.getSale(req.hospitalId, id) });
}

export async function create(req, res) {
  res.status(201).json({ sale: await service.sell(req, parse(saleBody, req.body)) });
}

export async function returnItems(req, res) {
  const { id } = parse(saleParams, req.params);
  res.json(await service.returnItems(req, id, parse(returnBody, req.body)));
}

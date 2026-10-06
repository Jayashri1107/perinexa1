import { parse } from '../../core/validate.js';
import * as service from './pharmacyReports.service.js';
import { periodQuery, registerQuery } from './pharmacyReports.validation.js';

export async function alerts(req, res) {
  res.json(await service.alertCounts(req.hospitalId));
}

export async function expiry(req, res) {
  res.json(await service.expiryReport(req.hospitalId));
}

export async function value(req, res) {
  res.json(await service.stockValue(req.hospitalId));
}

export async function register(req, res) {
  res.json(await service.register(req.hospitalId, parse(registerQuery, req.query)));
}

export async function sales(req, res) {
  res.json(await service.salesReport(req.hospitalId, parse(periodQuery, req.query)));
}

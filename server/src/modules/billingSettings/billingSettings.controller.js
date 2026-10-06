import { parse } from '../../core/validate.js';
import * as service from './billingSettings.service.js';
import { billingSettingsBody } from './billingSettings.validation.js';

export async function get(req, res) {
  res.json({ settings: await service.getBillingSettings(req.hospitalId) });
}

export async function payee(req, res) {
  res.json({ payee: await service.getUpiPayee(req.hospitalId) });
}

export async function update(req, res) {
  res.json({ settings: await service.updateBillingSettings(req, parse(billingSettingsBody, req.body)) });
}

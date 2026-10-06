import { parse } from '../../core/validate.js';
import { getSettings } from '../hospitalSettings/hospitalSettings.service.js';
import * as service from './billingSettings.service.js';
import { billingSettingsBody } from './billingSettings.validation.js';

export async function get(req, res) {
  res.json({ settings: await service.getBillingSettings(req.hospitalId) });
}

export async function payee(req, res) {
  res.json({ payee: await service.getUpiPayee(req.hospitalId) });
}

// The letterhead for printing bills and receipts (read-only).
export async function letterhead(req, res) {
  const settings = await getSettings(req.hospitalId);
  res.json({ letterhead: settings.letterhead ?? {}, hospitalName: settings.name });
}

export async function update(req, res) {
  res.json({ settings: await service.updateBillingSettings(req, parse(billingSettingsBody, req.body)) });
}

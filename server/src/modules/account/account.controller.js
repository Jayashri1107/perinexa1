import { parse } from '../../core/validate.js';
import * as service from './account.service.js';
import { appearanceBody, professionalBody } from './account.validation.js';

export async function get(req, res) {
  res.json({ user: req.user, isPrescriber: await service.isPrescriber(req.user._id) });
}

export async function updateProfessional(req, res) {
  res.json({ user: await service.updateProfessional(req, parse(professionalBody, req.body)) });
}

export async function updateAppearance(req, res) {
  res.json({ user: await service.updateAppearance(req, parse(appearanceBody, req.body)) });
}

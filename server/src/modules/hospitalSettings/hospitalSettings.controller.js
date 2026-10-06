import { parse } from '../../core/validate.js';
import * as service from './hospitalSettings.service.js';
import { SETTINGS_SECTIONS, sectionParams } from './hospitalSettings.validation.js';

export async function get(req, res) {
  res.json({ settings: await service.getSettings(req.hospitalId) });
}

export async function updateSection(req, res) {
  const { section } = parse(sectionParams, req.params);
  const data = parse(SETTINGS_SECTIONS[section], req.body);
  res.json({ settings: await service.updateSection(req, req.hospitalId, section, data) });
}

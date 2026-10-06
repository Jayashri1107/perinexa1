// Pharmacy → Settings: the details printed on its tax invoices. Kept as the "pharmacy" section of the hospital
// settings; the pharmacist reads them (to print), the admin changes them.
import { parse } from '../../core/validate.js';
import { getSettings, updateSection } from '../hospitalSettings/hospitalSettings.service.js';
import { SETTINGS_SECTIONS } from '../hospitalSettings/hospitalSettings.validation.js';

const SECTION = 'pharmacy';

export async function get(req, res) {
  const settings = await getSettings(req.hospitalId);
  res.json({ pharmacy: settings.pharmacy ?? {}, letterhead: settings.letterhead ?? {}, hospitalName: settings.name });
}

export async function update(req, res) {
  const settings = await updateSection(req, req.hospitalId, SECTION, parse(SETTINGS_SECTIONS[SECTION], req.body));
  res.json({ pharmacy: settings.pharmacy, letterhead: settings.letterhead, hospitalName: settings.name });
}

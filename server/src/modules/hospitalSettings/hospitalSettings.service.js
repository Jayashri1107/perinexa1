// The hospital admin's settings of their own hospital, one section at a time.
import { notFoundError } from '../../core/httpError.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { SECTION_KEYS } from './hospitalSettings.validation.js';

const PROFILE_FIELDS = 'name code address phone email';

export async function getSettings(hospitalId) {
  const hospital = await Hospital.findById(hospitalId)
    .select(`${PROFILE_FIELDS} ${SECTION_KEYS.join(' ')} settingsUpdatedAt`)
    .populate('settingsUpdatedBy', 'name')
    .lean();
  if (!hospital) throw notFoundError('Hospital');
  const { _id, settingsUpdatedBy, ...rest } = hospital;
  return { id: _id.toString(), ...rest, settingsUpdatedByName: settingsUpdatedBy?.name ?? null };
}

export async function updateSection(req, hospitalId, section, data) {
  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw notFoundError('Hospital');
  const before = hospital[section]?.toObject?.() ?? {};
  hospital.set(section, data);
  hospital.settingsUpdatedAt = new Date();
  hospital.settingsUpdatedBy = req.user._id;
  await hospital.save();

  // Which fields changed (names only – the values stay in the settings).
  const changed = Object.keys(data).filter((k) => String(before[k] ?? '') !== String(data[k] ?? ''));
  await recordAudit(req, 'SETTINGS_UPDATED', { hospitalId, details: { section, changed } });
  return getSettings(hospitalId);
}

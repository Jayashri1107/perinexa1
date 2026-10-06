// My settings: what every person sets for themselves – professional details (those who prescribe) and appearance.
import { config } from '../../config/index.js';
import { HttpError } from '../../core/httpError.js';
import { recordAudit } from '../audit/audit.service.js';
import { Membership } from '../members/membership.model.js';

// Doctors and RMOs (in any hospital) have professional details printed on their prescriptions.
export async function isPrescriber(userId) {
  return Boolean(await Membership.exists({ userId, isActive: true, roles: { $in: config.prescriberRoles } }));
}

export async function updateProfessional(req, data) {
  if (!(await isPrescriber(req.user._id))) {
    throw new HttpError(403, 'Professional details are for doctors and RMOs.', 'FORBIDDEN');
  }
  req.user.professional = data;
  await req.user.save();
  await recordAudit(req, 'PROFILE_UPDATED', { target: req.user, hospitalId: req.hospitalId });
  return req.user;
}

export async function updateAppearance(req, data) {
  req.user.preferences = data;
  await req.user.save();
  return req.user;
}

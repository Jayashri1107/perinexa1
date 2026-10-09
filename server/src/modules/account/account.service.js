// My settings: what every person sets for themselves – professional details (those who prescribe) and appearance.
import { config } from '../../config/index.js';
import { HttpError } from '../../core/httpError.js';
import { recordAudit } from '../audit/audit.service.js';
import { Membership } from '../members/membership.model.js';
import { UserPhoto } from './userPhoto.model.js';

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

// The person's own name and phone. The email stays as the administrator set it (it is the login).
export async function updateProfile(req, data) {
  const changed = ['name', 'phone'].filter((k) => (req.user[k] ?? '') !== data[k]);
  if (!changed.length) return req.user;
  req.user.set(data);
  await req.user.save();
  await recordAudit(req, 'USER_UPDATED', { target: req.user, hospitalId: req.hospitalId, details: { changed, own: true } });
  return req.user;
}

export async function updateAppearance(req, data) {
  req.user.preferences = data;
  await req.user.save();
  return req.user;
}

// ---------- Profile photo ----------

const MAX_PHOTO_BYTES = 200 * 1024;
// The file's first bytes, not the name it was sent with, decide what it is.
function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** The person's own photo, or null. */
export const myPhoto = (req) => UserPhoto.findOne({ userId: req.user._id }).lean();

export async function setPhoto(req, dataUrl) {
  const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const contentType = imageType(data);
  if (!contentType) throw new HttpError(400, 'Choose a photo (JPEG, PNG or WebP).', 'NOT_AN_IMAGE');
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(400, 'This photo is too large. Choose a smaller one.', 'TOO_LARGE');
  await UserPhoto.updateOne({ userId: req.user._id }, { $set: { contentType, data } }, { upsert: true });
  req.user.photoVersion = (req.user.photoVersion ?? 0) + 1;
  await req.user.save();
  await recordAudit(req, 'PROFILE_PHOTO_CHANGED', { target: req.user, hospitalId: req.hospitalId });
  return req.user;
}

export async function removePhoto(req) {
  if (!req.user.photoVersion) return req.user;
  await UserPhoto.deleteOne({ userId: req.user._id });
  req.user.photoVersion = 0;
  await req.user.save();
  await recordAudit(req, 'PROFILE_PHOTO_REMOVED', { target: req.user, hospitalId: req.hospitalId });
  return req.user;
}

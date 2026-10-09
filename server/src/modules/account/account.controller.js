import { parse } from '../../core/validate.js';
import * as service from './account.service.js';
import { appearanceBody, photoBody, professionalBody, profileBody } from './account.validation.js';

export async function get(req, res) {
  res.json({ user: req.user, isPrescriber: await service.isPrescriber(req.user._id) });
}

export async function updateProfessional(req, res) {
  res.json({ user: await service.updateProfessional(req, parse(professionalBody, req.body)) });
}

export async function updateProfile(req, res) {
  res.json({ user: await service.updateProfile(req, parse(profileBody, req.body)) });
}

export async function updateAppearance(req, res) {
  res.json({ user: await service.updateAppearance(req, parse(appearanceBody, req.body)) });
}

export async function photo(req, res) {
  const found = await service.myPhoto(req);
  if (!found) return res.status(404).json({ error: { message: 'No photo.', code: 'NOT_FOUND' } });
  // private: only this person's browser keeps it; a new version has a new address (?v=)
  res.set({ 'Content-Type': found.contentType, 'Cache-Control': 'private, max-age=86400' });
  res.send(found.data.buffer ? Buffer.from(found.data.buffer) : found.data);
}

export async function setPhoto(req, res) {
  res.json({ user: await service.setPhoto(req, parse(photoBody, req.body).image) });
}

export async function removePhoto(req, res) {
  res.json({ user: await service.removePhoto(req) });
}

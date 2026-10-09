// The hospital's logo for its printed papers (owner, 9 Oct 2026): discharge cards, bills, receipts, prescriptions …
// One per hospital, uploaded by its hospital admin under Print letterhead. Kept apart from the hospital record (which is
// read often); the hospital keeps only `logoVersion` (0 = no logo; raised at each change so printers fetch the new one).
// The website shrinks it before sending; what it really is, is checked from its bytes (PNG, JPEG or WebP, ≤ 300 KB).
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { HttpError } from '../../core/httpError.js';
import { parse } from '../../core/validate.js';
import mongoose from '../../db/mongoose.js';
import { requireRoles } from '../../middleware/auth.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';

const logoSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, unique: true },
    contentType: { type: String, enum: ['image/png', 'image/jpeg', 'image/webp'], required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);
export const HospitalLogo = mongoose.model('HospitalLogo', logoSchema, 'hospital_logos');

const MAX_BYTES = 300 * 1024;
function imageType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const body = z.object({
  image: z.string('Choose the logo').max(420_000, 'This logo is too large. Choose a smaller picture.').regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Choose a PNG, JPEG or WebP picture.'),
});

// The hospital admin: PUT (a data URL) and DELETE – mounted with the hospital settings (hospital admin only).
export const logoAdminRouter = Router();
logoAdminRouter.put('/', requireRoles([config.adminRole]), async (req, res) => {
  const { image } = parse(body, req.body);
  const data = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  const contentType = imageType(data);
  if (!contentType) throw new HttpError(400, 'Choose a PNG, JPEG or WebP picture.', 'NOT_AN_IMAGE');
  if (data.length > MAX_BYTES) throw new HttpError(400, 'This logo is too large. Choose a smaller picture.', 'TOO_LARGE');
  await HospitalLogo.updateOne({ hospitalId: req.hospitalId }, { $set: { contentType, data } }, { upsert: true });
  const hospital = await Hospital.findByIdAndUpdate(req.hospitalId, { $inc: { logoVersion: 1 } }, { returnDocument: 'after' }).select('logoVersion').lean();
  await recordAudit(req, 'HOSPITAL_LOGO_CHANGED', { hospitalId: req.hospitalId });
  res.json({ logoVersion: hospital.logoVersion });
});
logoAdminRouter.delete('/', requireRoles([config.adminRole]), async (req, res) => {
  await HospitalLogo.deleteOne({ hospitalId: req.hospitalId });
  await Hospital.updateOne({ _id: req.hospitalId }, { $set: { logoVersion: 0 } });
  await recordAudit(req, 'HOSPITAL_LOGO_REMOVED', { hospitalId: req.hospitalId });
  res.json({ logoVersion: 0 });
});

// Everyone working in the hospital: the logo, for the printed papers.
export const logoRouter = Router();
logoRouter.get('/', async (req, res) => {
  const logo = await HospitalLogo.findOne({ hospitalId: req.hospitalId }).lean();
  if (!logo) return res.status(404).json({ error: { message: 'No logo.', code: 'NOT_FOUND' } });
  res.set({ 'Content-Type': logo.contentType, 'Cache-Control': 'private, max-age=86400' });
  return res.send(logo.data.buffer ? Buffer.from(logo.data.buffer) : logo.data);
});

import { Router } from 'express';
import { z } from 'zod';
import { Tenant } from '../models/Tenant.js';
import { requireTenantRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { parse } from '../utils/validate.js';

const text = (label, max) => z.string().trim().max(max, `${label} is too long`).default('');

export const letterheadSchema = z.object({
  name: text('Name', 150),
  tagline: text('Tagline', 150),
  address: text('Address', 300),
  phone: text('Phone', 60),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Please enter a valid email address')
    .default(''),
  registrationNumber: text('Registration number', 80),
  footer: text('Footer', 300),
  // Printed next to English on consent forms: Marathi or Hindi.
  consentLanguage: z.enum(['mr', 'hi'], 'Choose Marathi or Hindi').default('mr'),
});

const FIELDS = Object.keys(letterheadSchema.shape);

// The fields as stored (only the ones in use; an old PC-PNDT number, removed 2 Oct 2026, is never returned).
const savedFields = (tenant) => Object.fromEntries(FIELDS.map((k) => [k, tenant.letterhead?.[k] ?? '']));

// What gets printed: empty name falls back to the hospital's name.
export const letterheadFor = (tenant) => {
  const lh = tenant.letterhead ?? {};
  const out = Object.fromEntries(FIELDS.map((k) => [k, lh[k] ?? '']));
  return { ...out, name: out.name || tenant.name, consentLanguage: out.consentLanguage || 'mr' };
};

// Hospital settings for the hospital selected in the session.
export const tenantSettingsRouter = Router();

// Everyone in the hospital can read the letterhead (needed for printing).
tenantSettingsRouter.get('/letterhead', async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId);
  res.json({ letterhead: letterheadFor(tenant), saved: savedFields(tenant), hospitalName: tenant.name });
});

// Only the hospital admin can change it.
tenantSettingsRouter.put('/letterhead', requireTenantRole('admin'), async (req, res) => {
  const data = parse(letterheadSchema, req.body);
  const tenant = await Tenant.findById(req.tenantId);
  const before = letterheadFor(tenant);
  // One field at a time, so stored values that are no longer used (e.g. the old PC-PNDT number) are kept, not wiped.
  for (const k of FIELDS) tenant.set(`letterhead.${k}`, data[k]);
  await tenant.save();
  const after = letterheadFor(tenant);
  const changes = {};
  for (const k of FIELDS) if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
  if (Object.keys(changes).length) await audit(req, 'TENANT_SETTINGS_UPDATED', { details: { changes } });
  res.json({ letterhead: after, saved: savedFields(tenant), hospitalName: tenant.name });
});

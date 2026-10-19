import { Router } from 'express';
import { z } from 'zod';
import { Membership, hasRole } from '../models/Membership.js';
import { Referral } from '../models/Referral.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { requireTenantRole } from '../middleware/auth.js';
import { REFERRAL_SETTINGS_FIELDS, referralSettingsFor, referralSettingsSchema } from '../referrals/settings.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
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

// ---------- Referral settings (docs/REFERRALS_PLAN.md) ----------
// The centres, the referral desk's number, the consultants' direct lines, the working hours and holidays, and the
// urgent cut-off (referrals/settings.js). Everyone in the hospital reads them (the referral desk and doctors use them
// on every referral; the slip prints the direct lines); only the hospital admin changes them. The audit entry names
// the settings that changed – never a number, a centre or a doctor.

// The hospital's doctors who work here now (for the direct lines): id and name only.
async function activeDoctors(tenantId) {
  const memberships = await Membership.find({ tenantId, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, isActive: true }, { name: 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name }));
}

const referralAnswer = async (req, tenant) => ({
  settings: referralSettingsFor(tenant),
  canEdit: hasRole(req.membership, 'admin'),
  doctors: await activeDoctors(req.tenantId),
});

tenantSettingsRouter.get('/referrals', async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId);
  res.json(await referralAnswer(req, tenant));
});

// Fields left out stay as they are. What needs the database is checked here: a direct line is for a doctor who works
// at this hospital now, and a centre that referrals were logged for is never taken off the list (its name is shown on
// them) – it is marked not in use instead.
tenantSettingsRouter.put('/referrals', requireTenantRole('admin'), async (req, res) => {
  const body = parse(referralSettingsSchema, req.body);
  const tenant = await Tenant.findById(req.tenantId);
  const before = referralSettingsFor(tenant);
  const after = { ...before, ...body };
  const fields = {};
  if (body.consultantLines?.length) {
    const doctors = new Set((await activeDoctors(req.tenantId)).map((d) => d.id));
    body.consultantLines.forEach((l, i) => {
      if (!doctors.has(l.userId.toLowerCase())) fields[`consultantLines.${i}.userId`] = 'Choose a doctor who works at this hospital.';
    });
  }
  if (body.centres) {
    const kept = new Set(body.centres.map((c) => c.key));
    for (const c of before.centres.filter((x) => !kept.has(x.key))) {
      if (await Referral.exists({ tenantId: req.tenantId, centre: c.key })) {
        fields.centres = `${c.name} has referrals, so it stays on the list. Mark it not in use instead.`;
        break;
      }
    }
  }
  if (Object.keys(fields).length) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
  const changed = REFERRAL_SETTINGS_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length) {
    tenant.set('referrals', after); // the whole settings, defaults included: what the clocks use from now on
    await tenant.save();
    await audit(req, 'REFERRAL_SETTINGS_CHANGED', { details: { fields: changed } }); // names only, never the values
  }
  res.json(await referralAnswer(req, tenant));
});

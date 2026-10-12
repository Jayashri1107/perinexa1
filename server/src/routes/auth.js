import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { Tenant } from '../models/Tenant.js';
import { PLATFORM_AREAS, User, canEditPlatform, isPlatformUser } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';
import { fakeVerify, hashPassword, passwordSchema, verifyPassword } from '../utils/password.js';
import {
  clearAuthCookie,
  COOKIE_NAME,
  findActiveMembership,
  listActiveMemberships,
  pickTenant,
  requireAuth,
  setAuthCookie,
} from '../middleware/auth.js';
import { APPEARANCE_CHOICES, STANDARD_APPEARANCE } from '../utils/appearance.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });

const switchSchema = z.object({ tenantId: objectId });

const professionalSchema = z.object({
  qualification: z.string().trim().max(150, 'Qualification is too long').default(''),
  registrationNumber: z.string().trim().max(60, 'Registration number is too long').default(''),
  council: z.string().trim().max(120, 'Council name is too long').default(''),
});

const APPEARANCE_WORDS = { theme: 'a colour template', font: 'a font', textSize: 'a text size', density: 'the spacing', motion: 'whether things move', help: 'whether explanations are shown' };
const appearanceSchema = z
  .object(
    Object.fromEntries(
      Object.entries(APPEARANCE_CHOICES).map(([k, values]) => {
        const choice = z.enum(values, `Choose ${APPEARANCE_WORDS[k]}`);
        // "help" came later: a page that doesn't send it keeps the standard (explanations hidden).
        return [k, k === 'help' ? choice.default(STANDARD_APPEARANCE.help) : choice];
      }),
    ),
  )
  .strict();

const INVALID_LOGIN = 'Invalid email or password.';

// What the website needs to know about the logged-in person.
const sessionBody = (user, memberships, activeTenantId, platform = null) => ({
  user,
  memberships,
  activeTenantId,
  ...(platform ? { platform } : {}),
  sessionTimeoutMinutes: config.SESSION_TIMEOUT_MINUTES,
});

/**
 * For a super admin or platform admin: their role, what they may change, the hospital whose setup is open (if any)
 * and their linked hospital account ("Switch to your doctor account"). Null for everyone else.
 */
async function platformInfo(user, tenant) {
  if (!isPlatformUser(user)) return null;
  const linked = user.linkedAccountId ? await User.findById(user.linkedAccountId) : null;
  return {
    role: user.isSuperAdmin ? 'superadmin' : 'platformadmin',
    permissions: user.isSuperAdmin ? PLATFORM_AREAS : [...(user.platformPermissions ?? [])],
    hospital: tenant ? { tenantId: String(tenant._id), tenantName: tenant.name, readOnly: !canEditPlatform(user, 'hospitalSetup') } : null,
    linkedAccount: linked?.isActive && !isPlatformUser(linked) ? { email: linked.email, name: linked.name } : null,
  };
}

const openHospitalSchema = z.object({ tenantId: objectId.nullable() });

export function authRouter({ loginRateLimitMax }) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginRateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: async (req, res) => {
      await audit(req, 'LOGIN_RATE_LIMITED', { details: { email: String(req.body?.email ?? '').slice(0, 254) } });
      res.status(429).json({
        error: { message: 'Too many login attempts. Please wait 15 minutes and try again.', code: 'RATE_LIMITED' },
      });
    },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user) {
      await fakeVerify(password); // same timing as a real check, so emails can't be guessed
      await audit(req, 'LOGIN_FAILED', { details: { email, reason: 'unknown_email' } });
      throw new HttpError(401, INVALID_LOGIN, 'INVALID_LOGIN');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok || !user.isActive) {
      await audit(req, 'LOGIN_FAILED', {
        actor: user,
        target: user,
        details: { email, reason: ok ? 'inactive_account' : 'wrong_password' },
      });
      throw new HttpError(401, INVALID_LOGIN, 'INVALID_LOGIN');
    }

    // Land in the hospital the person last worked in (if they still have access there).
    const memberships = await listActiveMemberships(user);
    const activeTenantId = pickTenant(memberships, user.lastTenantId);

    user.lastLoginAt = new Date();
    if (activeTenantId) user.lastTenantId = activeTenantId;
    await user.save();
    await audit(req, 'LOGIN_SUCCESS', { actor: user, target: user, tenantId: activeTenantId });
    setAuthCookie(res, user, activeTenantId);
    res.json(sessionBody(user, memberships, activeTenantId, await platformInfo(user, null)));
  });

  router.post('/logout', async (req, res) => {
    // Works even if the session already expired; ends the session on the server if it is still valid.
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET);
        const user = await User.findById(payload.sub);
        if (user && user.tokenVersion === payload.tv) {
          user.tokenVersion += 1; // this cookie can never be used again
          await user.save();
          await audit(req, 'LOGOUT', { actor: user, target: user, tenantId: payload.tid ?? null });
        }
      } catch {
        /* expired or invalid token: nothing to end */
      }
    }
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    const memberships = await listActiveMemberships(req.user);
    let activeTenantId = req.tenantId ? String(req.tenantId) : null;
    if (!activeTenantId && memberships.length) {
      // Session has no (valid) hospital: pick one, e.g. after access to the previous one was removed.
      activeTenantId = pickTenant(memberships, req.user.lastTenantId);
      setAuthCookie(res, req.user, activeTenantId);
    }
    res.json(sessionBody(req.user, memberships, activeTenantId, await platformInfo(req.user, req.tenant)));
  });

  // A super admin or platform admin opens a hospital's setup (Hospital admin pages only – never its patients), or
  // closes it again (tenantId null). Recorded in the audit log like any change of hospital.
  router.post('/open-hospital', requireAuth, async (req, res) => {
    if (!isPlatformUser(req.user)) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
    if (req.user.mustChangePassword) throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    const { tenantId } = parse(openHospitalSchema, req.body);
    const tenant = tenantId ? await Tenant.findOne({ _id: tenantId, isActive: true }) : null;
    if (tenantId && !tenant) throw new HttpError(404, 'This hospital does not exist or is deactivated.', 'NOT_FOUND');
    const from = req.tenantId ? String(req.tenantId) : null;
    if (from !== tenantId) {
      await audit(req, 'TENANT_SWITCHED', { tenantId: tenant?._id ?? req.tenantId ?? null, details: { from, to: tenantId, platform: true } });
    }
    setAuthCookie(res, req.user, tenant?._id ?? null);
    res.json(sessionBody(req.user, [], tenantId, await platformInfo(req.user, tenant)));
  });

  // Choose which hospital to work in. Everything created afterwards goes into that hospital.
  router.post('/switch-tenant', requireAuth, async (req, res) => {
    const { tenantId } = parse(switchSchema, req.body);
    // Super admins and platform admins are not members of a hospital: they open its setup with /open-hospital.
    if (isPlatformUser(req.user)) throw new HttpError(403, "You don't have access to this hospital.", 'FORBIDDEN');
    const found = await findActiveMembership(req.user, tenantId);
    if (!found) throw new HttpError(403, "You don't have access to this hospital.", 'FORBIDDEN');

    const from = req.tenantId ? String(req.tenantId) : null;
    req.user.lastTenantId = found.tenant._id;
    await req.user.save();
    if (from !== tenantId) {
      await audit(req, 'TENANT_SWITCHED', { tenantId: found.tenant._id, details: { from, to: tenantId } });
    }
    setAuthCookie(res, req.user, found.tenant._id);
    res.json(sessionBody(req.user, await listActiveMemberships(req.user), tenantId));
  });

  // A person's own professional details (qualification, medical registration number).
  router.put('/me/professional', requireAuth, async (req, res) => {
    if (req.user.mustChangePassword) {
      throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }
    const data = parse(professionalSchema, req.body);
    const before = req.user.professional?.toObject?.() ?? req.user.professional ?? {};
    const changes = {};
    for (const k of Object.keys(data)) if ((before[k] ?? '') !== data[k]) changes[k] = { from: before[k] ?? '', to: data[k] };
    req.user.professional = data;
    await req.user.save();
    if (Object.keys(changes).length) await audit(req, 'PROFILE_UPDATED', { target: req.user, details: { changes } });
    res.json({ user: req.user });
  });

  // How the app looks for this person (My settings → Appearance). Saved as they choose; not in the audit log –
  // it opens no record and changes nobody's access.
  router.put('/me/appearance', requireAuth, async (req, res) => {
    if (req.user.mustChangePassword) {
      throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }
    const appearance = parse(appearanceSchema, req.body);
    req.user.set('preferences.appearance', appearance);
    await req.user.save();
    res.json({ appearance });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const user = await User.findById(req.user._id).select('+passwordHash');

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      const message = 'Current password is incorrect.';
      return res.status(400).json({ error: { message, code: 'VALIDATION', fields: { currentPassword: message } } });
    }

    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    user.tokenVersion += 1; // signs out any other sessions
    await user.save();
    await audit(req, 'PASSWORD_CHANGED', { actor: user, target: user });
    setAuthCookie(res, user, req.tenantId);
    res.json({ user });
  });

  return router;
}

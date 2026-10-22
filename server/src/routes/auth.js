import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { lockedError, staffFailed, staffLockLeft, staffSignedIn } from '../auth/loginLock.js';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { rateLimitStore } from '../utils/sharedState.js';
import { Membership } from '../models/Membership.js';
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
  hasAdminSwitch,
  listActiveMemberships,
  pickTenant,
  requireAuth,
  setAuthCookie,
} from '../middleware/auth.js';
import { APPEARANCE_CHOICES, STANDARD_APPEARANCE } from '../utils/appearance.js';
import { capitalizeName } from '../utils/personName.js';

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

// My profile: name, work phone and staff number (the email is the login: changed by the super admin only).
const detailsSchema = z
  .object({
    name: z.string().trim().min(2, 'Write your name').max(100, 'The name is too long').transform(capitalizeName),
    phone: z.string().trim().max(30, 'The phone number is too long').regex(/^[\d+\-\s()]*$/, 'Only digits, spaces, + - ( )').default(''),
    employeeId: z.string().trim().max(30, 'The staff number is too long').default(''),
  })
  .strict();
const photoSchema = z
  .object({ photo: z.string().max(120000, 'The photo is too large').regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Choose a JPEG, PNG or WebP picture').nullable() })
  .strict();

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
// switchBack: a super admin working in their own doctor account – the website offers "Switch back to super admin".
// roleMode: 'admin' while someone who is both a hospital admin and clinical staff works as the admin (22 Oct 2026).
const sessionBody = (user, memberships, activeTenantId, platform = null, switchBack = false, roleMode = null) => ({
  user,
  memberships,
  activeTenantId,
  ...(platform ? { platform } : {}),
  ...(switchBack ? { switchBack: true } : {}),
  ...(roleMode === 'admin' ? { roleMode: 'admin' } : {}),
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
    // own: made by this super admin for themselves – the switch needs no password (21 Oct 2026)
    linkedAccount: linked?.isActive && !isPlatformUser(linked) ? { email: linked.email, name: linked.name, own: ownDoctorAccount(user, linked) } : null,
  };
}

const openHospitalSchema = z.object({ tenantId: objectId.nullable() });

// ---------- A super admin who is also a doctor: one login (21 Oct 2026) ----------
// The super admin makes their own doctor account (no second email: theirs with "+doctor", a random password nobody
// knows) and is tagged as a doctor in a hospital. "Switch to your doctor account" then needs no password; "Switch back
// to super admin" asks for theirs (going up to every hospital). Only a super admin's OWN account can be entered without
// a password – an account linked by email (someone's real login) still asks for its own password, so a super admin can
// never step into another doctor's account. The two stay separate accounts: the hospital's rules for doctors, and the
// audit log, see a doctor; the super admin never becomes a hospital member.
const ownDoctorAccount = (superAdmin, linked) =>
  Boolean(superAdmin?.isSuperAdmin && linked?.ownedBy && linked.ownedBy.equals(superAdmin._id) && superAdmin.linkedAccountId?.equals(linked._id));
/** The doctor account's email: the super admin's own with "+doctor" (name@x.in → name+doctor@x.in). */
export const doctorEmailOf = (email) => {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}+doctor${email.slice(at)}`;
};
const doctorAccountSchema = z.object({ tenantId: objectId }).strict();
const switchUpSchema = z.object({ password: z.string().min(1, 'Type your super admin password.').max(128) }).strict();
const switchAdminSchema = z.object({ password: z.string().min(1, 'Type your password.').max(128) }).strict();
const superAdminOnly = (req) => {
  if (!req.user.isSuperAdmin || req.via) throw new HttpError(403, 'Only a super admin can do this.', 'FORBIDDEN');
  if (req.user.mustChangePassword) throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
};

// The very first start: no super admin yet. The sign-in page then shows "Create the first super admin".
const needsSetup = async () => !(await User.exists({ isSuperAdmin: true }));
// The first super admin needs the one-time SETUP_CODE when one is set – and always on the live server (read when
// used, so tests can set their own).
const setupCode = () => String(process.env.SETUP_CODE ?? config.SETUP_CODE ?? '').trim();
const setupNeedsCode = () => Boolean(setupCode()) || config.isProduction;
const sameCode = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const setupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long').transform(capitalizeName),
  email: z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address').max(254)),
  password: passwordSchema,
});

export function authRouter({ loginRateLimitMax }) {
  const router = Router();

  // Per internet address, wrong tries only (a hospital's staff often share one address); the lock per account
  // (utils/loginLock.js) is the main guard.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginRateLimitMax,
    skipSuccessfulRequests: true,
    store: rateLimitStore('login'),
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
    const now = req.now ?? new Date();
    // 3 wrong tries in a row lock this email for 2 minutes (auth/loginLock.js): the password is not checked meanwhile
    const left = await staffLockLeft(email, now);
    if (left) throw lockedError(left);
    const user = await User.findOne({ email }).select('+passwordHash');
    // A wrong try – the same for an unknown email, so the answer never shows whether an account exists
    const wrong = async () => {
      const { lockedFor, triesLeft } = await staffFailed(email, now);
      if (lockedFor) {
        await audit(req, 'LOGIN_LOCKED', { ...(user ? { actor: user, target: user } : {}), details: { email, seconds: lockedFor } });
        throw lockedError(lockedFor);
      }
      throw new HttpError(401, `${INVALID_LOGIN} ${triesLeft === 1 ? 'One more wrong try and sign-in waits 2 minutes.' : ''}`.trim(), 'INVALID_LOGIN');
    };

    if (!user) {
      await fakeVerify(password); // same timing as a real check, so emails can't be guessed
      await audit(req, 'LOGIN_FAILED', { details: { email, reason: 'unknown_email' } });
      return wrong();
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok || !user.isActive) {
      await audit(req, 'LOGIN_FAILED', {
        actor: user,
        target: user,
        details: { email, reason: ok ? 'inactive_account' : 'wrong_password' },
      });
      return wrong();
    }
    await staffSignedIn(email);

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

  // Is there a super admin yet? (No login needed: the sign-in page asks before anyone exists.)
  router.get('/setup-status', async (_req, res) => {
    const open = await needsSetup();
    res.json({ needsSetup: open, needsCode: open && setupNeedsCode() });
  });

  // Creates the first super admin – refused as soon as one exists, so it can only ever be used once.
  router.post('/setup', loginLimiter, async (req, res) => {
    if (!(await needsSetup())) throw new HttpError(403, 'Perinexa already has a super admin. Please log in.', 'ALREADY_SET_UP');
    if (setupNeedsCode()) {
      if (!setupCode()) throw new HttpError(403, 'The first super admin can be made only with a setup code. Set SETUP_CODE in the server settings, then try again.', 'SETUP_CODE_MISSING');
      if (!sameCode(req.body?.setupCode ?? '', setupCode())) {
        await audit(req, 'LOGIN_FAILED', { details: { email: String(req.body?.email ?? '').slice(0, 254), reason: 'wrong_setup_code' } });
        throw Object.assign(new HttpError(403, 'The setup code is not right.', 'WRONG_SETUP_CODE'), { fields: { setupCode: 'The setup code is not right.' } });
      }
    }
    const data = parse(setupSchema, req.body);
    if (await User.exists({ email: data.email })) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
    const user = await User.create({
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      isSuperAdmin: true,
      mustChangePassword: false, // they chose this password themselves
    });
    await audit(req, 'USER_CREATED', { actor: user, target: user, details: { name: user.name, superAdmin: true, firstSetup: true } });
    res.status(201).json({ ok: true });
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
    const memberships = await listActiveMemberships(req.user, req.mode);
    let activeTenantId = req.tenantId ? String(req.tenantId) : null;
    if (!activeTenantId && memberships.length) {
      // Session has no (valid) hospital: pick one, e.g. after access to the previous one was removed.
      activeTenantId = pickTenant(memberships, req.user.lastTenantId);
      setAuthCookie(res, req.user, activeTenantId, req.via, req.mode);
    }
    res.json(sessionBody(req.user, memberships, activeTenantId, await platformInfo(req.user, req.tenant), Boolean(req.via), req.mode));
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
    setAuthCookie(res, req.user, found.tenant._id, req.via, req.mode);
    res.json(sessionBody(req.user, await listActiveMemberships(req.user, req.mode), tenantId, null, Boolean(req.via), req.mode));
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

  // My profile: name, work phone, staff number. In the audit log with what changed (staff details, never a patient's).
  router.put('/me/details', requireAuth, async (req, res) => {
    if (req.user.mustChangePassword) throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    const data = parse(detailsSchema, req.body);
    const changes = {};
    for (const k of Object.keys(data)) if ((req.user[k] ?? '') !== data[k]) changes[k] = { from: req.user[k] ?? '', to: data[k] };
    Object.assign(req.user, data);
    await req.user.save();
    if (Object.keys(changes).length) await audit(req, 'PROFILE_UPDATED', { target: req.user, details: { changes } });
    res.json({ user: req.user });
  });

  // My profile: the person's photo (or none). Audited as a change, without the picture.
  router.put('/me/photo', requireAuth, async (req, res) => {
    if (req.user.mustChangePassword) throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    const { photo } = parse(photoSchema, req.body);
    req.user.photo = photo;
    await req.user.save();
    await audit(req, 'PROFILE_UPDATED', { target: req.user, details: { changes: { photo: photo ? 'changed' : 'removed' } } });
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

  // "Work as a doctor here": the super admin's own doctor account – made the first time – tagged as a doctor in this
  // hospital (another hospital: called again). Shown in the hospital's staff list like any doctor.
  router.post('/me/doctor-account', requireAuth, async (req, res) => {
    superAdminOnly(req);
    const { tenantId } = parse(doctorAccountSchema, req.body);
    const tenant = await Tenant.findOne({ _id: tenantId, isActive: true });
    if (!tenant) throw new HttpError(404, 'This hospital does not exist or is deactivated.', 'NOT_FOUND');
    const me = req.user;
    let doctor = me.linkedAccountId ? await User.findById(me.linkedAccountId) : null;
    if (doctor && !ownDoctorAccount(me, doctor)) {
      throw new HttpError(409, 'Your doctor account is a separate login with its own email. Remove that link under Users (your name) first, or keep switching with its password.', 'LINKED_ELSEWHERE');
    }
    if (doctor && !doctor.isActive) throw new HttpError(409, 'Your doctor account has been deactivated. A super admin can restore it under Users.', 'DOCTOR_INACTIVE');
    if (!doctor) {
      const email = doctorEmailOf(me.email);
      if (email.length > 254) throw new HttpError(400, 'Your email is too long to make a doctor account from it.', 'VALIDATION');
      if (await User.exists({ email })) throw new HttpError(409, `${email} is already someone's login. Link it under Users instead.`, 'EMAIL_TAKEN');
      doctor = await User.create({
        name: me.name,
        email,
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')), // never told to anyone
        mustChangePassword: false,
        ownedBy: me._id,
        // printed under the doctor's name on prescriptions (changed later on the doctor's own My profile)
        professional: { qualification: me.professional?.qualification ?? '', registrationNumber: me.professional?.registrationNumber ?? '', council: me.professional?.council ?? '' },
      });
      me.linkedAccountId = doctor._id;
      await me.save();
      await audit(req, 'USER_CREATED', { target: doctor, details: { name: doctor.name, ownDoctorAccount: true } });
      await audit(req, 'LINKED_ACCOUNT_CHANGED', { target: me, details: { linked: true, linkedEmail: doctor.email, own: true } });
    }
    const membership = await Membership.findOne({ tenantId: tenant._id, userId: doctor._id });
    if (!membership) {
      await Membership.create({ tenantId: tenant._id, userId: doctor._id, roles: ['doctor'], createdBy: me._id });
      await audit(req, 'MEMBER_ADDED', { target: doctor, tenantId: tenant._id, details: { roles: ['doctor'], ownDoctorAccount: true } });
    } else if (!membership.isActive || !membership.roles.includes('doctor')) {
      const before = [...membership.roles];
      if (!membership.roles.includes('doctor')) membership.roles = [...membership.roles, 'doctor'];
      membership.isActive = true;
      await membership.save();
      await audit(req, 'MEMBER_ROLE_CHANGED', { target: doctor, tenantId: tenant._id, details: { from: before, to: membership.roles, ownDoctorAccount: true } });
    }
    res.json({ platform: await platformInfo(me, req.tenant), hospitals: await listActiveMemberships(doctor) });
  });

  // "Switch to your doctor account" – the super admin's own: no password. This browser then works as the doctor.
  router.post('/switch-to-doctor', requireAuth, async (req, res) => {
    superAdminOnly(req);
    const me = req.user;
    const doctor = me.linkedAccountId ? await User.findById(me.linkedAccountId) : null;
    if (!doctor || !ownDoctorAccount(me, doctor)) throw new HttpError(409, 'Make your doctor account first ("Work as a doctor").', 'NO_OWN_DOCTOR_ACCOUNT');
    if (!doctor.isActive || isPlatformUser(doctor)) throw new HttpError(409, 'Your doctor account has been deactivated. A super admin can restore it under Users.', 'DOCTOR_INACTIVE');
    const memberships = await listActiveMemberships(doctor);
    if (!memberships.length) throw new HttpError(409, 'Your doctor account is not in any hospital yet. Choose a hospital under "Work as a doctor".', 'NO_HOSPITAL');
    const activeTenantId = pickTenant(memberships, doctor.lastTenantId);
    doctor.lastLoginAt = new Date();
    doctor.lastTenantId = activeTenantId;
    await doctor.save();
    await audit(req, 'ACCOUNT_SWITCHED', { actor: me, target: doctor, tenantId: activeTenantId, details: { to: 'doctor' } });
    setAuthCookie(res, doctor, activeTenantId, { id: me._id, tv: me.tokenVersion });
    res.json(sessionBody(doctor, memberships, activeTenantId, null, true));
  });

  // "Switch back to super admin": asks the super admin's password (every hospital is behind it). Wrong tries count
  // towards the same lock as signing in with that email.
  router.post('/switch-to-super-admin', requireAuth, async (req, res) => {
    if (!req.via) throw new HttpError(403, 'This is not a switched session. Please sign in as super admin.', 'NOT_SWITCHED');
    const { password } = parse(switchUpSchema, req.body);
    const now = req.now ?? new Date();
    const me = await User.findById(req.via.id).select('+passwordHash');
    const valid = me && me.isActive && me.isSuperAdmin && me.tokenVersion === req.via.tv && ownDoctorAccount(me, req.user);
    if (!valid) throw new HttpError(403, 'Your super admin session has ended. Please sign out and sign in as super admin.', 'SWITCH_ENDED');
    const left = await staffLockLeft(me.email, now);
    if (left) throw lockedError(left);
    if (!(await verifyPassword(password, me.passwordHash))) {
      const { lockedFor } = await staffFailed(me.email, now);
      await audit(req, 'LOGIN_FAILED', { actor: me, target: me, details: { email: me.email, reason: 'wrong_password_switch_back' } });
      if (lockedFor) throw lockedError(lockedFor);
      const message = 'That is not your super admin password.';
      throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { password: message } });
    }
    await staffSignedIn(me.email);
    await audit(req, 'ACCOUNT_SWITCHED', { actor: me, target: req.user, tenantId: req.tenantId, details: { to: 'superadmin' } });
    setAuthCookie(res, me, null);
    res.json(sessionBody(me, [], null, await platformInfo(me, null)));
  });

  // ---------- Admin or clinical work (22 Oct 2026) ----------
  // A doctor (or other clinical staff) whom the super admin also made this hospital's admin works in one at a time.
  // "Switch to admin" asks their password (the admin pages: staff, settings, money); going back to clinical work does
  // not. A super admin working in their own doctor account types the super admin password (that account has none).
  router.post('/switch-to-admin', requireAuth, async (req, res) => {
    if (!req.membership || req.membership.platform || !hasAdminSwitch(req.membershipRoles)) {
      throw new HttpError(403, 'Only someone who is also an admin of this hospital can switch to admin.', 'NO_ADMIN_ROLE');
    }
    if (req.mode === 'admin') throw new HttpError(409, 'You are already working as the admin.', 'ALREADY_ADMIN');
    if (req.user.mustChangePassword) throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    const { password } = parse(switchAdminSchema, req.body);
    const now = req.now ?? new Date();
    const ownAccount = req.via && req.user.ownedBy && String(req.user.ownedBy) === String(req.via.id);
    const checker = await User.findById(ownAccount ? req.via.id : req.user._id).select('+passwordHash');
    if (!checker?.isActive) throw new HttpError(403, 'Your session has ended. Please sign in again.', 'SWITCH_ENDED');
    const left = await staffLockLeft(checker.email, now);
    if (left) throw lockedError(left);
    if (!(await verifyPassword(password, checker.passwordHash))) {
      const { lockedFor } = await staffFailed(checker.email, now);
      await audit(req, 'LOGIN_FAILED', { actor: req.user, target: req.user, details: { email: checker.email, reason: 'wrong_password_switch_to_admin' } });
      if (lockedFor) throw lockedError(lockedFor);
      const message = ownAccount ? 'That is not your super admin password.' : 'That is not your password.';
      throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { password: message } });
    }
    await staffSignedIn(checker.email);
    await audit(req, 'ROLE_MODE_SWITCHED', { details: { to: 'admin' } });
    setAuthCookie(res, req.user, req.tenantId, req.via, 'admin');
    res.json(sessionBody(req.user, await listActiveMemberships(req.user, 'admin'), String(req.tenantId), null, Boolean(req.via), 'admin'));
  });

  // Back to clinical work (patients) – no password.
  router.post('/switch-to-clinical', requireAuth, async (req, res) => {
    if (req.mode !== 'admin') throw new HttpError(409, 'You are not working as the admin.', 'NOT_ADMIN_MODE');
    await audit(req, 'ROLE_MODE_SWITCHED', { details: { to: 'clinical' } });
    setAuthCookie(res, req.user, req.tenantId, req.via, null);
    const memberships = await listActiveMemberships(req.user, null);
    res.json(sessionBody(req.user, memberships, req.tenantId ? String(req.tenantId) : null, null, Boolean(req.via), null));
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
    setAuthCookie(res, user, req.tenantId, req.via, req.mode);
    res.json({ user });
  });

  return router;
}

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { Membership, hasRole } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { User, canEditPlatform, isPlatformUser } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';

export const COOKIE_NAME = 'perinexa_session';
export const TENANT_HEADER = 'x-tenant-id';

const cookieOptions = () => ({
  httpOnly: true, // JavaScript in the browser can't read it
  secure: config.cookieSecure, // only sent over HTTPS (on in production)
  sameSite: 'strict', // not sent with requests coming from other websites
  path: '/',
});

// Issues (or renews) the login cookie. It remembers who you are and which hospital you're working in.
// The session ends after SESSION_TIMEOUT_MINUTES without any request.
export function setAuthCookie(res, user, tenantId = null) {
  const maxAgeMs = config.SESSION_TIMEOUT_MINUTES * 60 * 1000;
  const payload = { sub: user._id.toString(), tv: user.tokenVersion, tid: tenantId ? String(tenantId) : null };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.SESSION_TIMEOUT_MINUTES * 60 });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: maxAgeMs });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

// A super admin or platform admin opening a hospital's setup: not a member, but the hospital admin's role there, marked
// `platform` so platformHospitalGuard lets them reach the setup only (never patients, bills, the pharmacy counter …).
// `readOnly`: a platform admin who was not given "hospitalSetup" may look but not change.
const platformMembership = (user, tenant) => ({
  userId: user._id,
  tenantId: tenant._id,
  roles: ['admin'],
  isActive: true,
  platform: true,
  readOnly: !canEditPlatform(user, 'hospitalSetup'),
});

// The person's active membership in a hospital, or null if they don't (or no longer) have access there.
export async function findActiveMembership(user, tenantId) {
  if (!tenantId) return null;
  if (isPlatformUser(user)) {
    const tenant = await Tenant.findOne({ _id: tenantId, isActive: true });
    return tenant ? { membership: platformMembership(user, tenant), tenant } : null;
  }
  const [membership, tenant] = await Promise.all([
    Membership.findOne({ userId: user._id, tenantId, isActive: true }),
    Tenant.findOne({ _id: tenantId, isActive: true }),
  ]);
  return membership && tenant ? { membership, tenant } : null;
}

// All hospitals the person can currently work in, sorted by name.
export async function listActiveMemberships(user) {
  if (isPlatformUser(user)) return [];
  const memberships = await Membership.find({ userId: user._id, isActive: true }).lean();
  const tenants = await Tenant.find({ _id: { $in: memberships.map((m) => m.tenantId) }, isActive: true })
    .sort({ name: 1 })
    .lean();
  return tenants.map((t) => ({
    tenantId: t._id.toString(),
    tenantName: t.name,
    roles: memberships.find((m) => m.tenantId.equals(t._id)).roles,
  }));
}

// Picks the first preferred hospital the person still has access to, otherwise the first one.
export function pickTenant(memberships, ...preferred) {
  for (const p of preferred) {
    if (p && memberships.some((m) => m.tenantId === String(p))) return String(p);
  }
  return memberships[0]?.tenantId ?? null;
}

// Only lets the request through if it comes from a logged-in, active user.
// Also loads the hospital they're working in (req.tenantId, req.membership), if still allowed.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Please log in.', 'NOT_AUTHENTICATED');

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    clearAuthCookie(res);
    throw new HttpError(401, 'Your session has expired. Please log in again.', 'SESSION_EXPIRED');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
    clearAuthCookie(res);
    throw new HttpError(401, 'Your session has ended. Please log in again.', 'SESSION_EXPIRED');
  }

  req.user = user;
  req.tenantId = null;
  req.tenant = null;
  req.membership = null;
  const found = await findActiveMembership(user, payload.tid);
  if (found) {
    req.tenantId = found.tenant._id;
    req.tenant = found.tenant;
    req.membership = found.membership;
  }

  // Sliding session: activity keeps you logged in. If access to the hospital was removed,
  // the renewed cookie no longer points at it.
  setAuthCookie(res, user, req.tenantId);
  next();
}

// Blocks everything except changing the password while a password change is pending.
export function requirePasswordChanged(req, _res, next) {
  if (req.user.mustChangePassword) {
    throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
}

export function requireSuperAdmin(req, _res, next) {
  if (!req.user.isSuperAdmin) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  next();
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const VIEW_ONLY = 'View only: a super admin has not given you permission to change this.';

/**
 * Platform pages: super admins and platform admins may read; a change needs a super admin, or a platform admin who
 * was given this area (area null: super admins only).
 */
export const requirePlatform = (area) => (req, _res, next) => {
  if (!isPlatformUser(req.user)) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  if (!READS.has(req.method) && !canEditPlatform(req.user, area)) throw new HttpError(403, VIEW_ONLY, 'VIEW_ONLY');
  next();
};

// Inside a hospital a platform user reaches its setup only – the pages under Hospital admin – and never anything
// with patients in it (records, bills, the pharmacy, the calendar, analytics lists). Paths are relative to /api.
const PLATFORM_HOSPITAL_PATHS = [
  /^\/tenant\/(members|audit-logs|settings|doctors)(\/|$)/,
  /^\/appointments\/(doctors|timings)(\/|$)/,
  /^\/reminders\/settings(\/|$)/,
  /^\/abdm\/(settings|status)(\/|$)/,
];

/** After requireTenant: a super admin or platform admin in a hospital – setup only, and view only without the right. */
export function platformHospitalGuard(req, _res, next) {
  if (!req.membership?.platform) return next();
  const path = req.originalUrl.split('?')[0].replace(/^\/api/, '');
  if (!PLATFORM_HOSPITAL_PATHS.some((rx) => rx.test(path))) {
    throw new HttpError(403, "Super admins and platform admins see a hospital's setup only – never its patients, bills or pharmacy.", 'PLATFORM_SETUP_ONLY');
  }
  if (req.membership.readOnly && !READS.has(req.method)) throw new HttpError(403, VIEW_ONLY, 'VIEW_ONLY');
  next();
}

// Hospital data routes: the person must be working in a hospital, and the browser must confirm
// which one it thinks is selected. If they switched hospital in another tab, we refuse instead of
// saving data into the wrong hospital.
export function requireTenant(req, _res, next) {
  if (!req.membership) {
    throw new HttpError(403, 'Please choose a hospital first.', 'NO_TENANT');
  }
  if (req.get(TENANT_HEADER) !== String(req.tenantId)) {
    throw new HttpError(
      409,
      'The selected hospital changed (possibly in another browser tab). The page has been refreshed; please try again.',
      'TENANT_MISMATCH',
    );
  }
  next();
}

export const requireTenantRole =
  (...roles) =>
  (req, _res, next) => {
    if (!hasRole(req.membership, ...roles)) {
      throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
    }
    next();
  };

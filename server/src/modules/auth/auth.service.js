// Login, logout, password change and the hospital being worked in – the same rules as Perinexa:
// the same answer for an unknown email, a wrong password and a deactivated account (and the same timing),
// every attempt in the audit log, logout and password change end the session on the server too.
import { HttpError, fieldError } from '../../core/httpError.js';
import { fakeVerify, hashPassword, verifyPassword } from '../../core/password.js';
import { readSessionToken, verifySessionToken } from '../../core/session.js';
import { recordAudit } from '../audit/audit.service.js';
import { findActiveMembership, listUserMemberships, superAdminAccess, superAdminMemberships } from '../members/member.service.js';

// The hospitals a person may work in. A super admin may open every active hospital (they start on the platform).
const membershipsOf = (user) => (user.isSuperAdmin ? superAdminMemberships() : listUserMemberships(user._id));
import { User } from '../users/user.model.js';

const INVALID_LOGIN = 'Invalid email or password.';

// The hospital to work in: the last one if still allowed, otherwise the first one.
function pickHospital(memberships, lastHospitalId) {
  const last = lastHospitalId && memberships.find((m) => m.hospital.id.toString() === lastHospitalId.toString());
  return (last ?? memberships[0])?.hospital.id ?? null;
}

export async function login(req, { email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    await fakeVerify(password);
    await recordAudit(req, 'LOGIN_FAILED', { details: { email, reason: 'unknown_email' } });
    throw new HttpError(401, INVALID_LOGIN, 'INVALID_LOGIN');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || !user.isActive) {
    await recordAudit(req, 'LOGIN_FAILED', {
      actor: user,
      target: user,
      details: { email, reason: ok ? 'inactive_account' : 'wrong_password' },
    });
    throw new HttpError(401, INVALID_LOGIN, 'INVALID_LOGIN');
  }

  const memberships = await membershipsOf(user);
  const hospitalId = user.isSuperAdmin ? null : pickHospital(memberships, user.lastHospitalId);
  user.lastLoginAt = new Date();
  if (hospitalId) user.lastHospitalId = hospitalId;
  await user.save();
  await recordAudit(req, 'LOGIN_SUCCESS', { actor: user, target: user, hospitalId });
  return { user, memberships, hospitalId };
}

export const recordRateLimited = (req) =>
  recordAudit(req, 'LOGIN_RATE_LIMITED', { details: { email: String(req.body?.email ?? '').slice(0, 254) } });

// Works even when the session already expired; a still-valid token is made unusable on the server.
export async function logout(req) {
  const token = readSessionToken(req);
  const payload = token && verifySessionToken(token);
  if (!payload) return;
  const user = await User.findById(payload.sub);
  if (user && user.tokenVersion === payload.tv) {
    user.tokenVersion += 1;
    await user.save();
    await recordAudit(req, 'LOGOUT', { actor: user, target: user, hospitalId: payload.hid ?? null });
  }
}

export async function changePassword(req, { currentPassword, newPassword }) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw fieldError('currentPassword', 'Current password is incorrect.');
  }
  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  user.tokenVersion += 1; // ends every other session
  await user.save();
  await recordAudit(req, 'PASSWORD_CHANGED', { actor: user, target: user, hospitalId: req.hospitalId });
  return user;
}

// The session as the website sees it. If the session has no (or no longer an allowed) hospital, one is chosen.
export async function currentSession(req) {
  const memberships = await membershipsOf(req.user);
  const hospitalId = req.hospitalId ?? (req.user.isSuperAdmin ? null : pickHospital(memberships, req.user.lastHospitalId));
  return { user: req.user, memberships, hospitalId };
}

export async function switchHospital(req, hospitalId) {
  const found = req.user.isSuperAdmin ? await superAdminAccess(hospitalId) : await findActiveMembership(req.user._id, hospitalId);
  if (!found) throw new HttpError(403, 'You do not have access to this hospital.', 'FORBIDDEN');
  req.user.lastHospitalId = found.hospital._id;
  await req.user.save();
  await recordAudit(req, 'HOSPITAL_SWITCHED', {
    target: req.user,
    hospitalId: found.hospital._id,
    details: req.user.isSuperAdmin ? { asSuperAdmin: true } : {},
  });
  return { user: req.user, memberships: await membershipsOf(req.user), hospitalId: found.hospital._id };
}

// The super admin goes back to the platform screens (no hospital in the session).
export async function leaveHospital(req) {
  return { user: req.user, memberships: await membershipsOf(req.user), hospitalId: null };
}

// What the website needs to know about the logged-in person.
export const sessionBody = ({ user, memberships, hospitalId }) => ({
  user,
  memberships,
  activeHospitalId: hospitalId ? hospitalId.toString() : null,
});

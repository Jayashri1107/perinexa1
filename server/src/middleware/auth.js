// Who may call an address. Same session rules as Perinexa: a valid cookie, an active account, the same tokenVersion,
// and every request renews the cookie (sliding session), so only inactivity ends it.
// The hospital the person works in comes from the session; access to it is checked again on every request.
import { HttpError } from '../core/httpError.js';
import { clearSessionCookie, readSessionToken, setSessionCookie, verifySessionToken } from '../core/session.js';
import { findActiveMembership, superAdminAccess } from '../modules/members/member.service.js';
import { User } from '../modules/users/user.model.js';

export const HOSPITAL_HEADER = 'X-Hospital-Id';

export async function requireAuth(req, res, next) {
  const token = readSessionToken(req);
  if (!token) throw new HttpError(401, 'Please log in.', 'NOT_AUTHENTICATED');

  const payload = verifySessionToken(token);
  const user = payload ? await User.findById(payload.sub) : null;
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Your session has ended. Please log in again.', 'SESSION_EXPIRED');
  }

  req.user = user;
  req.hospitalId = null;
  req.hospital = null;
  req.membership = null;
  const found = payload.hid
    ? user.isSuperAdmin
      ? await superAdminAccess(payload.hid)
      : await findActiveMembership(user._id, payload.hid)
    : null;
  if (found) {
    req.hospitalId = found.hospital._id;
    req.hospital = found.hospital;
    req.membership = found.membership;
  }

  // Renewed with the hospital only if access to it still exists.
  setSessionCookie(res, user, req.hospitalId);
  next();
}

// Until the temporary password is changed, nothing else is allowed.
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

// Hospital addresses: the person must be working in an active hospital, and the browser must say the same hospital –
// if another tab switched hospital, the request is refused instead of saving into the wrong hospital.
export function requireHospital(req, _res, next) {
  if (!req.hospitalId) throw new HttpError(403, 'Choose a hospital to work in.', 'NO_HOSPITAL');
  const sent = req.get(HOSPITAL_HEADER);
  if (sent && sent !== String(req.hospitalId)) {
    throw new HttpError(409, 'You switched hospital in another tab. The page will reload.', 'HOSPITAL_MISMATCH');
  }
  next();
}

// At least one of these roles in the current hospital.
export const requireRoles = (roles) => (req, _res, next) => {
  if (!req.membership?.roles.some((r) => roles.includes(r))) {
    throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  }
  next();
};

// The guard chains a module can ask for in modules/index.js (plus `roles` for hospital modules).
export const ACCESS = {
  public: [],
  user: [requireAuth, requirePasswordChanged],
  superAdmin: [requireAuth, requirePasswordChanged, requireSuperAdmin],
  hospital: [requireAuth, requirePasswordChanged, requireHospital],
};

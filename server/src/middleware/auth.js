// Who may call an address. Same session rules as Perinexa: a valid cookie, an active account, the same tokenVersion,
// and every request renews the cookie (sliding session), so only inactivity ends it.
import { HttpError } from '../core/httpError.js';
import { clearSessionCookie, readSessionToken, setSessionCookie, verifySessionToken } from '../core/session.js';
import { User } from '../modules/users/user.model.js';

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
  setSessionCookie(res, user);
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

// The guard chains a module can ask for in modules/index.js.
export const ACCESS = {
  public: [],
  user: [requireAuth, requirePasswordChanged],
  superAdmin: [requireAuth, requirePasswordChanged, requireSuperAdmin],
};

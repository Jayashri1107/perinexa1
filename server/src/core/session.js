// The login session: a signed JWT in an httpOnly cookie. The token carries the user id, their tokenVersion and the
// hospital they are working in. Raising tokenVersion on the user ends every session at once (logout, password change,
// deactivation, password reset).
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

const { jwtSecret, cookieName, cookieSecure, sessionTimeoutMinutes } = config.auth;

const cookieOptions = () => ({
  httpOnly: true, // not readable by scripts on the page
  secure: cookieSecure, // HTTPS only (switch on in production)
  sameSite: 'strict', // not sent with requests from other websites
  path: '/',
});

// Drops a session cookie already set on this response (the renewed one from requireAuth), so only the newest is sent.
function removeEarlierCookie(res) {
  const existing = [res.getHeader('Set-Cookie') ?? []].flat();
  const others = existing.filter((c) => !String(c).startsWith(`${cookieName}=`));
  if (others.length !== existing.length) res.setHeader('Set-Cookie', others);
}

// hospitalId: the hospital the person works in for this session (null for a super admin).
export function setSessionCookie(res, user, hospitalId = null) {
  const payload = { sub: user._id.toString(), tv: user.tokenVersion, hid: hospitalId ? String(hospitalId) : null };
  const token = jwt.sign(payload, jwtSecret, { expiresIn: sessionTimeoutMinutes * 60 });
  removeEarlierCookie(res);
  res.cookie(cookieName, token, { ...cookieOptions(), maxAge: sessionTimeoutMinutes * 60 * 1000 });
}

export function clearSessionCookie(res) {
  removeEarlierCookie(res);
  res.clearCookie(cookieName, cookieOptions());
}

export const readSessionToken = (req) => req.cookies?.[cookieName] ?? null;

// Returns the token's payload, or null when it is missing, expired or tampered with.
export function verifySessionToken(token) {
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

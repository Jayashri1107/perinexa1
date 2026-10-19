// Sign-in after wrong passwords (owner, 19 Oct 2026): 3 wrong tries in a row lock the sign-in for 2 minutes – hospital
// staff (by email) and patients (their portal code, or their own account). While locked the password is not even
// checked; the answer says how many seconds are left, and the sign-in page counts them down. A right password clears the
// count. The IP rate limits (routes/auth.js, routes/portal.js) stay as well.
import { LoginLock } from '../models/LoginLock.js';
import { HttpError } from '../utils/httpError.js';

export const LOGIN_TRIES = 3;
export const LOCK_SECONDS = 120;
export const LOCKED_MESSAGE = 'Too many wrong tries. Please wait 2 minutes, then try again.';

/** Whole seconds until `until` (0 when not locked). */
export const secondsLeft = (until, now) => (until && until > now ? Math.ceil((until.getTime() - now.getTime()) / 1000) : 0);

/** The 429 answer while locked: the message, and the seconds left for the countdown (also the Retry-After header). */
export const lockedError = (seconds, code = 'LOGIN_LOCKED', message = LOCKED_MESSAGE) => Object.assign(new HttpError(429, message, code), { retryAfterSeconds: seconds });

/** A wrong try on a record with failedAttempts / lockedUntil (patients' codes and accounts): seconds locked now, or 0. */
export function countFailure(record, now) {
  record.failedAttempts = (record.failedAttempts ?? 0) + 1;
  if (record.failedAttempts < LOGIN_TRIES) return 0;
  record.lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000);
  record.failedAttempts = 0;
  return LOCK_SECONDS;
}

// ---------- Hospital staff: by the email typed ----------
const staffKey = (email) => `staff:${String(email).toLowerCase()}`;

/** Seconds this email is still locked (0: may try). */
export async function staffLockLeft(email, now) {
  const lock = await LoginLock.findOne({ key: staffKey(email) }, { lockedUntil: 1 }).lean();
  return secondsLeft(lock?.lockedUntil, now);
}

/** A wrong try for this email: { lockedFor: seconds locked now (0: not yet), triesLeft }. */
export async function staffFailed(email, now) {
  const lock = await LoginLock.findOneAndUpdate({ key: staffKey(email) }, { $inc: { failures: 1 } }, { upsert: true, returnDocument: 'after' });
  if (lock.failures < LOGIN_TRIES) return { lockedFor: 0, triesLeft: LOGIN_TRIES - lock.failures };
  await LoginLock.updateOne({ _id: lock._id }, { $set: { failures: 0, lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000) } });
  return { lockedFor: LOCK_SECONDS, triesLeft: 0 };
}

/** The right password: the count starts again. */
export const staffSignedIn = (email) => LoginLock.deleteOne({ key: staffKey(email) });

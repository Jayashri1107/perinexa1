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

// ---------- Patients' codes and accounts: the same, counted in the database before the check (health check M3) ----------
// filter: the record ({ _id } for a portal code; { _id, tenantId } for her account – a hospital's record). Counting in
// memory and saving after the check let many tries sent at once each be checked before any was counted.

/** One try claimed before checking: { lockedFor } (0: go ahead), and `count`, the tries in a row with this one. */
export async function claimTry(Model, filter, now) {
  const doc = await Model.findOneAndUpdate(
    { ...filter, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $inc: { failedAttempts: 1 }, $set: { lockedUntil: null } },
    { returnDocument: 'after', projection: { failedAttempts: 1 } },
  ).lean();
  if (!doc) {
    const current = await Model.findOne(filter, { lockedUntil: 1 }).lean();
    return { lockedFor: secondsLeft(current?.lockedUntil, now) || LOCK_SECONDS, count: 0 };
  }
  if (doc.failedAttempts > LOGIN_TRIES) {
    await Model.updateOne(filter, { $set: { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000) } });
    return { lockedFor: LOCK_SECONDS, count: 0 };
  }
  return { lockedFor: 0, count: doc.failedAttempts };
}

/** The claimed try was wrong: the third in a row locks it. Returns the seconds locked now (0: not). */
export async function triedWrong(Model, filter, count, now) {
  if (count < LOGIN_TRIES) return 0;
  await Model.updateOne(filter, { $set: { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000) } });
  return LOCK_SECONDS;
}

// ---------- Hospital staff: by the email typed ----------
const staffKey = (email) => `staff:${String(email).toLowerCase()}`;

/** Seconds this email is still locked (0: may try). */
export async function staffLockLeft(email, now) {
  const lock = await LoginLock.findOne({ key: staffKey(email) }, { lockedUntil: 1 }).lean();
  return secondsLeft(lock?.lockedUntil, now);
}

const lockNow = (id, now) => LoginLock.updateOne({ _id: id }, { $set: { failures: 0, lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000) } });

/**
 * Sign-in: one try for this email is counted BEFORE the password is checked, in one step in the database (health check
 * M3, 16 Nov 2026). Checking the lock first and counting after the (slow) password check let many tries sent at once
 * all be checked before any of them was counted. Returns { lockedFor } – 0: go ahead and check the password, then call
 * staffFailed(email, now, { counted: true }) if it was wrong, or staffSignedIn if right.
 */
export async function staffClaimTry(email, now) {
  let lock;
  try {
    lock = await LoginLock.findOneAndUpdate(
      { key: staffKey(email), $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $inc: { failures: 1 }, $set: { lockedUntil: null } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    // Locked now: the filter found no entry, and the upsert met the existing one
    if (err?.code === 11000) return { lockedFor: (await staffLockLeft(email, now)) || LOCK_SECONDS };
    throw err;
  }
  if (lock.failures <= LOGIN_TRIES) return { lockedFor: 0 };
  // More tries at once than are allowed in a row: the lock starts now, and this one is not checked
  await lockNow(lock._id, now);
  return { lockedFor: LOCK_SECONDS };
}

/**
 * A wrong try for this email: { lockedFor: seconds locked now (0: not yet), triesLeft }. counted: the try was already
 * counted by staffClaimTry (sign-in); otherwise it is counted here (the password asked again inside the app).
 */
export async function staffFailed(email, now, { counted = false } = {}) {
  const lock = counted
    ? await LoginLock.findOne({ key: staffKey(email) })
    : await LoginLock.findOneAndUpdate({ key: staffKey(email) }, { $inc: { failures: 1 } }, { upsert: true, returnDocument: 'after' });
  if (!lock) return { lockedFor: 0, triesLeft: LOGIN_TRIES };
  if (lock.lockedUntil && lock.lockedUntil > now) return { lockedFor: secondsLeft(lock.lockedUntil, now), triesLeft: 0 };
  if (lock.failures < LOGIN_TRIES) return { lockedFor: 0, triesLeft: LOGIN_TRIES - lock.failures };
  await lockNow(lock._id, now);
  return { lockedFor: LOCK_SECONDS, triesLeft: 0 };
}

/** The right password: the count starts again. */
export const staffSignedIn = (email) => LoginLock.deleteOne({ key: staffKey(email) });

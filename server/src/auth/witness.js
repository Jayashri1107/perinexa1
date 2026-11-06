import { z } from 'zod';
import { Membership, hasRole } from '../models/Membership.js';
import { User } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { verifyPassword } from '../utils/password.js';
import { lockedError, staffFailed, staffLockLeft, staffSignedIn } from './loginLock.js';

// The second-person check (Clinical Requirements Group C – PX-X-06): a step that needs two people (the theatre counts,
// the baby's identity band, a high-alert or controlled medicine and its wastage) is confirmed by a SECOND member of
// staff who types their own email and password on the same screen. The second person must be someone else, active, a
// member of this hospital with an allowed role. Their password is checked exactly as at sign-in – the same 3-tries lock
// on their email – and is never stored or written to the audit log; only who, their role and when are kept.

export const witnessSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter the second person’s email').max(254),
    password: z.string().min(1, 'The second person types their password').max(200),
  })
  .strict();

const fail = (field, message) => Object.assign(new HttpError(400, message, 'WITNESS'), { fields: { [`witness.${field}`]: message } });
const ROLE_WORDS = { doctor: 'Doctor', rmo: 'RMO', nurse: 'Nurse', pharmacist: 'Pharmacist' };

/**
 * Checks the second person and returns the stamp to keep: { by, byName, role, at }.
 * roles: who may be the second person; purpose: a short word for the audit log (e.g. 'theatre_counts').
 */
export async function verifyWitness(req, witness, { roles = ['doctor', 'rmo', 'nurse'], purpose }) {
  if (!witness) throw fail('email', 'This step needs a second person: they type their own email and password.');
  const { email, password } = witnessSchema.parse(witness);
  const now = req.now ?? new Date();
  if (email === String(req.user.email).toLowerCase()) throw fail('email', 'The second person must be someone else.');
  const left = await staffLockLeft(email, now);
  if (left) throw lockedError(left);
  const user = await User.findOne({ email }).select('+passwordHash');
  const membership = user ? await Membership.findOne({ tenantId: req.tenantId, userId: user._id, isActive: true }).lean() : null;
  const ok = user && (await verifyPassword(password, user.passwordHash));
  if (!ok || !user.isActive) {
    const { lockedFor } = await staffFailed(email, now);
    await audit(req, 'WITNESS_FAILED', { details: { purpose, reason: !user ? 'unknown_email' : !ok ? 'wrong_password' : 'inactive_account' } });
    if (lockedFor) throw lockedError(lockedFor);
    throw fail('password', 'The second person’s email or password is not right.');
  }
  await staffSignedIn(email);
  if (!membership || !hasRole(membership, ...roles)) {
    await audit(req, 'WITNESS_FAILED', { target: user, details: { purpose, reason: 'not_allowed_here' } });
    throw fail('email', `The second person must be a ${roles.map((r) => ROLE_WORDS[r] ?? r).join(', ').toLowerCase()} of this hospital.`);
  }
  const role = roles.find((r) => membership.roles.includes(r));
  await audit(req, 'WITNESS_CONFIRMED', { target: user, details: { purpose } });
  return { by: user._id, byName: user.name, role: ROLE_WORDS[role] ?? role, at: now };
}

/** How a witness stamp is shown (never the user id). */
export const witnessView = (w) => (w ? { byName: w.byName, role: w.role, at: w.at } : null);

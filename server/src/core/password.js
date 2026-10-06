// Password rules, hashing and temporary passwords. All rules come from config.auth.password.
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { config } from '../config/index.js';

const { bcryptRounds, password: rules, temporaryPassword: temp } = config.auth;

// Each rule that is switched on in config, with its message.
const CHECKS = [
  [rules.requireUppercase, /[A-Z]/, 'at least one capital letter (A–Z)'],
  [rules.requireLowercase, /[a-z]/, 'at least one small letter (a–z)'],
  [rules.requireNumber, /[0-9]/, 'at least one number (0–9)'],
  [rules.requireSpecial, /[^A-Za-z0-9]/, 'at least one special character (such as @ # $ % ! -)'],
].filter(([on]) => on);

export const PASSWORD_RULE_TEXT = `At least ${rules.minLength} characters, with ${CHECKS.map(([, , text]) => text).join(', ')}.`;

export const passwordSchema = CHECKS.reduce(
  (schema, [, pattern, text]) => schema.regex(pattern, `Password needs ${text}`),
  z
    .string()
    .min(rules.minLength, `Password must be at least ${rules.minLength} characters`)
    .max(rules.maxLength, `Password must be at most ${rules.maxLength} characters`),
);

export const hashPassword = (plain) => bcrypt.hash(plain, bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real hash of a random value: "unknown email" takes as long as "wrong password", so emails can't be guessed.
const dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), bcryptRounds);
export const fakeVerify = (plain) => bcrypt.compare(plain, dummyHash);

// Readable temporary password such as "Kx7m-Pq3r-Tz9w" (the alphabet leaves out look-alikes such as 0/O, 1/l;
// the dashes are the special characters). Tried again until it meets every rule.
export function generateTemporaryPassword() {
  for (;;) {
    const groups = Array.from({ length: temp.groups }, () =>
      Array.from({ length: temp.groupLength }, () => temp.alphabet[crypto.randomInt(temp.alphabet.length)]).join(''),
    );
    const candidate = groups.join('-');
    if (passwordSchema.safeParse(candidate).success) return candidate;
  }
}

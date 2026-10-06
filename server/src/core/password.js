// Password rules, hashing and temporary passwords. All limits come from config.auth.
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { config } from '../config/index.js';

const { bcryptRounds, password: rules, temporaryPassword: temp } = config.auth;

export const passwordSchema = z
  .string()
  .min(rules.minLength, `Password must be at least ${rules.minLength} characters`)
  .max(rules.maxLength, `Password must be at most ${rules.maxLength} characters`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const hashPassword = (plain) => bcrypt.hash(plain, bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real hash of a random value: "unknown email" takes as long as "wrong password", so emails can't be guessed.
const dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), bcryptRounds);
export const fakeVerify = (plain) => bcrypt.compare(plain, dummyHash);

// Readable temporary password such as "Kx7m-Pq3r-Tz9w" (the alphabet leaves out look-alikes such as 0/O, 1/l).
export function generateTemporaryPassword() {
  for (;;) {
    const groups = Array.from({ length: temp.groups }, () =>
      Array.from({ length: temp.groupLength }, () => temp.alphabet[crypto.randomInt(temp.alphabet.length)]).join(''),
    );
    const candidate = groups.join('-');
    if (passwordSchema.safeParse(candidate).success) return candidate;
  }
}

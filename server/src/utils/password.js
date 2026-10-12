import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';

// Strong hashing for real use; the automatic tests use a lighter setting only so they run quickly.
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real bcrypt hash of a random value, used so "unknown email" takes as long as "wrong password".
const dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
export const fakeVerify = (plain) => bcrypt.compare(plain, dummyHash);

// Readable temporary password like "Kx7m-Pq3r-Tz9w" (no look-alike characters such as 0/O, 1/l).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function generateTemporaryPassword() {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]);
    const pwd = `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
    if (passwordSchema.safeParse(pwd).success) return pwd;
  }
}

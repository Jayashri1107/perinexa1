// Two-step sign-in with an authenticator app (health check H4; owner's decision of 17 Nov 2026: an authenticator app,
// not SMS). Time-based one-time passwords as in RFC 6238 (30-second steps, 6 digits, HMAC-SHA1 – what Google and
// Microsoft Authenticator expect), written with Node's own crypto: no new dependency.
//
// The secret is kept encrypted (AES-256-GCM, a key derived from JWT_SECRET – the same scheme as utils/sharedState.js).
// Changing JWT_SECRET therefore turns every two-step sign-in off: each person sets it up again at the next sign-in
// (docs/RUNBOOK.md). Recovery codes are kept as SHA-256 hashes only.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
export const RECOVERY_CODES = 8;
const ISSUER = 'Perinexa';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as base32 text (what the app's QR code carries). */
export const newSecret = () => base32(randomBytes(20));

/** The code for one 30-second step. */
export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}
export const stepOf = (now = new Date()) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/**
 * Checks a typed code against the step now and one either side (a phone clock a little off). Returns the matching
 * step, or null. `after`: the last step already used – a code is accepted once only (no replay).
 */
export function checkCode(secret, typed, { now = new Date(), after = -1 } = {}) {
  const code = String(typed ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !secret) return null;
  const here = stepOf(now);
  for (const step of [here - 1, here, here + 1]) {
    if (step <= after) continue;
    const want = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(want, Buffer.from(code))) return step;
  }
  return null;
}

/** The address the QR code holds: the authenticator app reads the account name, the issuer and the secret from it. */
export const otpauthUri = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`${ISSUER}:${email}`)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// ---------- Keeping the secret ----------

const key = () => createHmac('sha256', config.JWT_SECRET).update('perinexa-two-step-v1').digest();
export function sealSecret(secret) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
/** The secret, or null when it can't be read (JWT_SECRET changed since it was kept). */
export function openSecret(sealed) {
  if (!sealed) return null;
  try {
    const [iv, tag, data] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64'));
    const d = createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------- Recovery codes (for a lost phone) ----------

const hashCode = (code) => createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
/** Eight new codes like "K7Q2-M9XD", shown once; only their hashes are kept. */
export function newRecoveryCodes() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
  const codes = Array.from({ length: RECOVERY_CODES }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}
/** The index of the matching recovery code's hash, or -1. */
export const matchRecovery = (typed, hashes = []) => {
  const h = hashCode(typed);
  return /^[A-Z0-9]{8}$/i.test(String(typed).replace(/[^A-Z0-9]/gi, '')) ? hashes.indexOf(h) : -1;
};

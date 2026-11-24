// The four payroll numbers at rest (decision 4 of docs/PAYROLL_BUILD_NOTE.md): PF number, ESI number, PAN and bank
// account are sealed with AES-256-GCM under a key of their own – PAYROLL_KEY in server/.env, never JWT_SECRET
// (health check L18: one secret, one use). The database keeps the sealed text and the last four characters only.
// A lost or changed key: the kept numbers can no longer be read and are typed again (docs/RUNBOOK.md).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cleanNumber, lastFour } from './payrollRules.js';

const keyFrom = (secret) => createHash('sha256').update(`perinexa-payroll-numbers:${secret}`).digest();

/** Is there a key to seal with? */
export const canSeal = (secret) => typeof secret === 'string' && secret.length >= 32;

/** A number sealed for keeping: { enc, last4 }. Throws when there is no key. */
export function seal(value, secret) {
  if (!canSeal(secret)) throw new Error('PAYROLL_KEY is not set');
  const text = cleanNumber(value);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { enc: ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.'), last4: lastFour(text) };
}

/** The number in full, or null when it can't be read (no key, another key, or text that was changed). */
export function unseal(sealed, secret) {
  if (!sealed?.enc || !canSeal(secret)) return null;
  try {
    const [version, iv, tag, data] = String(sealed.enc).split('.');
    if (version !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

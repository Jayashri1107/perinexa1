// The UIDAI signature of the Secure QR (24 Oct 2026). Fake cards only: the tests sign with a key made here; UIDAI's
// own certificates are only read, never used to sign.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseAadhaarQr } from './aadhaarQr.js';
import { publicKeyOf, uidaiKeys, verifySecureQr } from './aadhaarSignature.js';

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const FIELDS = ['V2', '3', '123420191231120000000', 'Asha Sample', '15-08-1996', 'F', 'W/O Ravi Sample', 'Pune', 'Near Temple', '12', 'Kothrud', '411038', 'Kothrud', 'Maharashtra', 'MG Road', 'Haveli', 'Pune', '0000'];
const data = Buffer.concat([...FIELDS.flatMap((f) => [Buffer.from(f, 'latin1'), Buffer.from([255])]), Buffer.from([1, 2, 3, 4])]);

async function testKey() {
  const pair = await crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
  return { pair, keys: [{ name: 'test', spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)) }] };
}
const signed = async (pair, bytes) => new Uint8Array(Buffer.concat([bytes, Buffer.from(await crypto.subtle.sign(ALG, pair.privateKey, bytes))]));

describe("UIDAI's certificates", () => {
  it('each gives a 2048-bit RSA key that the browser can use', async () => {
    const keys = uidaiKeys();
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) {
      const key = await crypto.subtle.importKey('spki', k.spki, ALG, true, ['verify']);
      expect(key.algorithm.modulusLength, k.name).toBe(2048);
    }
  });
  it('a broken certificate is refused, not misread', () => {
    expect(() => publicKeyOf(new Uint8Array([0x30, 0x82, 0x10, 0x00, 0x30]))).toThrow();
  });
});

describe('checking the signature', () => {
  it('verified when signed by a known key; not verified once any byte is changed', async () => {
    const { pair, keys } = await testKey();
    const bytes = await signed(pair, data);
    expect(await verifySecureQr(bytes, keys)).toBe('verified');
    const changed = bytes.slice();
    changed[20] ^= 1; // a letter of the name
    expect(await verifySecureQr(changed, keys)).toBe('not-verified');
  });
  it('not verified for a key UIDAI does not have, or no signature at all', async () => {
    const { pair } = await testKey();
    expect(await verifySecureQr(await signed(pair, data))).toBe('not-verified'); // UIDAI's keys
    expect(await verifySecureQr(new Uint8Array(100))).toBe('not-verified');
  });
  it('a made-up Secure QR still fills the form, marked not verified', async () => {
    const { pair } = await testKey();
    const qr = BigInt(`0x${gzipSync(await signed(pair, data)).toString('hex')}`).toString(10);
    expect(await parseAadhaarQr(qr, new Date(2026, 9, 24))).toMatchObject({ fullName: 'Asha Sample', signature: 'not-verified' });
  });
});

// ABDM's encryption of health records on their way to another hospital or app (M2 – and M3 decrypts with the same
// code): the "Fidelius" scheme of ABDM's data flow – ECDH key agreement on Curve25519, HKDF-SHA256 and AES-256-GCM –
// with Node's built-in crypto only (no package).
//
// How it works (as in ABDM's reference implementation, Fidelius, which uses BouncyCastle):
//  - Each side has a key pair on Curve25519 and a 32-byte random nonce. The requester (the HIU) sends its public key
//    and nonce with the data request (keyMaterial); the sender (the HIP – Perinexa) sends its own with the data.
//  - The shared secret is ECDH: the x-coordinate of (own private key × the other's public key), 32 bytes.
//  - The two nonces are XORed: the first 20 bytes are the HKDF salt, the last 12 bytes the AES-GCM IV.
//  - The AES key is HKDF-SHA256(secret, salt, no info), 32 bytes. The data is AES-256-GCM with that IV and no extra
//    data; what is sent is the ciphertext followed by the 16-byte tag, in base64.
//
// Curve25519 comes in two shapes. ABDM's reference library keeps it in its Weierstrass form (y² = x³ + ax + b) and
// sends public keys as X.509 (SubjectPublicKeyInfo with the curve written out) or as the bare 65-byte point 04‖x‖y.
// Node knows the same curve as X25519 (Montgomery form, 32-byte keys). The two are one curve: x = u + A/3 with
// A = 486662. The agreement is done with Node's X25519 and the coordinates converted, so the secret is the same 32
// bytes BouncyCastle computes (a test checks it against OpenSSL's own ECDH on the Weierstrass curve). A key that
// comes as X25519 (32 bytes, or X.509 with the X25519 algorithm) is answered in that shape.
//
// Never kept: a private key is made for one page of data and forgotten; nothing here is logged.
// ⚠️ Not yet checked against ABDM's sandbox: the key shape ABDM sends, that HKDF takes the raw 32-byte secret, and the
// checksum (ABDM_CHECKLIST_M2 in v3Client.js).

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';

export const CRYPTO_ALG = 'ECDH';
export const CURVE = 'Curve25519';
export const KEY_PARAMETERS = 'Curve25519/32byte random key';

// ---------- The curve ----------

const P = 2n ** 255n - 19n;
const A = 486662n;
const ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (v) => ((v % P) + P) % P;
function powMod(base, exp) {
  let r = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}
const inverse = (v) => powMod(v, P - 2n);
/** A square root modulo p (p ≡ 5 mod 8), or null when there is none. */
function sqrtMod(v) {
  const a = mod(v);
  let r = powMod(a, (P + 3n) / 8n);
  if (mod(r * r) === a) return r;
  r = mod(r * powMod(2n, (P - 1n) / 4n));
  return mod(r * r) === a ? r : null;
}
const A_THIRD = mod(A * inverse(3n)); // Montgomery u = Weierstrass x − A/3
const montgomeryRhs = (u) => mod(u * u * u + A * u * u + u); // v² = u³ + Au² + u

/** Curve25519 in the Weierstrass form ABDM's reference library uses: y² = x³ + ax + b over p, base point (gx, gy). */
export const WEIERSTRASS = Object.freeze({
  p: P,
  a: mod((3n - A * A) * inverse(3n)),
  b: mod((2n * A ** 3n - 9n * A) * inverse(27n)),
  gx: mod(9n + A_THIRD),
  gy: sqrtMod(montgomeryRhs(9n)),
  n: ORDER,
  h: 8n,
});

// ---------- Bytes ----------

const toBigBE = (buf) => (buf.length ? BigInt(`0x${Buffer.from(buf).toString('hex')}`) : 0n);
const toBigLE = (buf) => toBigBE(Buffer.from(buf).reverse());
const be32 = (v) => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
const le32 = (v) => be32(v).reverse();

const bad = (message = 'The public key sent is not a Curve25519 key.') => Object.assign(new Error(message), { code: 'ABDM_KEY' });

// ---------- DER (just enough for public keys) ----------

const derLength = (n) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
const derSequence = (...parts) => tlv(0x30, Buffer.concat(parts));
function derInteger(v) {
  let hex = v.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let b = Buffer.from(hex, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const derOctets = (b) => tlv(0x04, b);
/** One DER element at `at`: its tag and where its content starts and ends. */
function derRead(buf, at) {
  if (at + 2 > buf.length) throw bad();
  const tag = buf[at];
  let length = buf[at + 1];
  let start = at + 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n < 1 || n > 3 || start + n > buf.length) throw bad();
    length = 0;
    for (let i = 0; i < n; i += 1) length = length * 256 + buf[start + i];
    start += n;
  }
  const end = start + length;
  if (end > buf.length) throw bad();
  return { tag, start, end };
}

const OID_EC_PUBLIC_KEY = Buffer.from('06072a8648ce3d0201', 'hex'); // 1.2.840.10045.2.1
const OID_PRIME_FIELD = Buffer.from('06072a8648ce3d0101', 'hex'); // 1.2.840.10045.1.1
const OID_X25519 = Buffer.from('06032b656e', 'hex'); // 1.3.101.110
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

const W = WEIERSTRASS;
/** The curve written out (explicit ECParameters), as ABDM's reference library writes it in its X.509 keys. */
const EC_PARAMETERS = derSequence(
  derInteger(1n),
  derSequence(OID_PRIME_FIELD, derInteger(P)),
  derSequence(derOctets(be32(W.a)), derOctets(be32(W.b))),
  derOctets(Buffer.concat([Buffer.from([4]), be32(W.gx), be32(W.gy)])),
  derInteger(ORDER),
  derInteger(W.h),
);
const ecSpki = (point) => derSequence(derSequence(OID_EC_PUBLIC_KEY, EC_PARAMETERS), tlv(0x03, Buffer.concat([Buffer.from([0]), point])));

// ---------- Points and keys ----------

/** A Weierstrass point (04‖x‖y, or 02/03‖x) → the X25519 u-coordinate (32 bytes, little-endian). */
function pointToU(point) {
  const x = toBigBE(point.subarray(1, 33));
  if (x >= P) throw bad();
  if (point.length === 65) {
    const y = toBigBE(point.subarray(33, 65));
    if (y >= P || mod(y * y) !== mod(x * x * x + W.a * x + W.b)) throw bad('The public key sent is not on Curve25519.');
  }
  const u = mod(x - A_THIRD);
  if (sqrtMod(montgomeryRhs(u)) == null) throw bad('The public key sent is not on Curve25519.');
  return le32(u);
}

/** The X25519 u-coordinate → the Weierstrass point (65 bytes 04‖x‖y, or 33 bytes compressed). */
function uToPoint(u, compressed = false) {
  const uu = toBigLE(u);
  const x = mod(uu + A_THIRD);
  const y = sqrtMod(montgomeryRhs(uu));
  if (y == null) throw bad();
  return compressed ? Buffer.concat([Buffer.from([y & 1n ? 3 : 2]), be32(x)]) : Buffer.concat([Buffer.from([4]), be32(x), be32(y)]);
}

const SHAPES = ['ec-spki', 'ec-spki-compressed', 'ec-raw', 'ec-raw-compressed', 'x25519-spki', 'x25519-raw'];

/**
 * A public key as ABDM sends it (base64) → { u, shape }: u is the X25519 coordinate, shape how it was written (the
 * answer is written the same way). Refuses anything that is not a Curve25519 key.
 */
export function readPublicKey(keyValue) {
  const raw = Buffer.from(String(keyValue ?? ''), 'base64');
  if (raw.length === 32) return { u: Buffer.from(raw), shape: 'x25519-raw' };
  if (raw.length === 65 && raw[0] === 4) return { u: pointToU(raw), shape: 'ec-raw' };
  if (raw.length === 33 && (raw[0] === 2 || raw[0] === 3)) return { u: pointToU(raw), shape: 'ec-raw-compressed' };
  if (raw[0] !== 0x30) throw bad();
  const outer = derRead(raw, 0);
  const algorithm = derRead(raw, outer.start);
  const bits = derRead(raw, algorithm.end);
  if (algorithm.tag !== 0x30 || bits.tag !== 0x03 || raw[bits.start] !== 0) throw bad();
  const key = raw.subarray(bits.start + 1, bits.end);
  const alg = raw.subarray(algorithm.start, algorithm.end);
  if (alg.subarray(0, OID_X25519.length).equals(OID_X25519) && key.length === 32) return { u: Buffer.from(key), shape: 'x25519-spki' };
  if (alg.subarray(0, OID_EC_PUBLIC_KEY.length).equals(OID_EC_PUBLIC_KEY)) {
    // Curve25519 written out: its prime and its coefficients a and b must be there (a named curve is not Curve25519)
    const params = alg.subarray(OID_EC_PUBLIC_KEY.length);
    const ours = [derInteger(P), derOctets(be32(W.a)), derOctets(be32(W.b))];
    if (!ours.every((part) => params.includes(part))) throw bad();
    if (key.length === 65 && key[0] === 4) return { u: pointToU(key), shape: 'ec-spki' };
    if (key.length === 33 && (key[0] === 2 || key[0] === 3)) return { u: pointToU(key), shape: 'ec-spki-compressed' };
  }
  throw bad();
}

/** Our public key (its u-coordinate) written in one of the shapes, in base64. */
export function writePublicKey(u, shape) {
  switch (shape) {
    case 'x25519-raw':
      return Buffer.from(u).toString('base64');
    case 'x25519-spki':
      return Buffer.concat([X25519_SPKI_PREFIX, u]).toString('base64');
    case 'ec-raw':
      return uToPoint(u).toString('base64');
    case 'ec-raw-compressed':
      return uToPoint(u, true).toString('base64');
    case 'ec-spki':
      return ecSpki(uToPoint(u)).toString('base64');
    case 'ec-spki-compressed':
      return ecSpki(uToPoint(u, true)).toString('base64');
    default:
      throw new Error(`Unknown key shape: ${shape}`);
  }
}
export { SHAPES as KEY_SHAPES };

/** A key pair for one exchange (a given 32-byte private key for tests; otherwise a new random one). */
export function newKeyPair(privateRaw) {
  const k = privateRaw ? Buffer.from(privateRaw) : randomBytes(32);
  if (k.length !== 32) throw new Error('A private key has 32 bytes.');
  k[0] &= 248; // X25519's clamping, so the same scalar is used in both curve shapes
  k[31] &= 127;
  k[31] |= 64;
  const privateKey = createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, k]), format: 'der', type: 'pkcs8' });
  const u = Buffer.from(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32));
  return { privateKey, privateRaw: k, u };
}

/** The 32-byte shared secret: the Weierstrass x-coordinate (as BouncyCastle gives it) for an EC key, X25519's for X25519. */
export function sharedSecret(ours, peer) {
  const publicKey = createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, peer.u]), format: 'der', type: 'spki' });
  const u = diffieHellman({ privateKey: ours.privateKey, publicKey }); // little-endian u of the shared point
  return peer.shape.startsWith('ec') ? be32(mod(toBigLE(u) + A_THIRD)) : u;
}

/** The AES key and IV from the secret and the two nonces (XORed: salt = the first 20 bytes, IV = the last 12). */
export function keyAndIv(secret, nonceA, nonceB) {
  const a = Buffer.from(String(nonceA ?? ''), 'base64');
  const b = Buffer.from(String(nonceB ?? ''), 'base64');
  if (a.length !== 32 || b.length !== 32) throw bad('A nonce has 32 bytes.');
  const x = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) x[i] = a[i] ^ b[i];
  const key = Buffer.from(hkdfSync('sha256', secret, x.subarray(0, 20), Buffer.alloc(0), 32));
  return { key, iv: x.subarray(32 - 12) };
}

const newNonce = () => randomBytes(32).toString('base64');

/**
 * Encrypts `text` for the requester (its public key and nonce from the data request). keys and nonce: ours – new
 * ones unless given (tests). Returns the data and OUR keyMaterial, to send with it.
 */
export function encryptFor({ text, requester, keys = newKeyPair(), nonce = newNonce(), expiry }) {
  const peer = readPublicKey(requester?.publicKey);
  const { key, iv } = keyAndIv(sharedSecret(keys, peer), nonce, requester?.nonce);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(String(text), 'utf8')), cipher.final(), cipher.getAuthTag()]);
  return {
    encryptedData: data.toString('base64'),
    keyMaterial: { cryptoAlg: CRYPTO_ALG, curve: CURVE, dhPublicKey: { expiry, parameters: KEY_PARAMETERS, keyValue: writePublicKey(keys.u, peer.shape) }, nonce },
  };
}

/** Decrypts what a sender encrypted for us (its public key and nonce; our private key and nonce, base64). */
export function decryptFrom({ encryptedData, sender, ours }) {
  const peer = readPublicKey(sender?.publicKey);
  const keys = newKeyPair(Buffer.from(String(ours?.privateRaw ?? ''), 'base64'));
  const { key, iv } = keyAndIv(sharedSecret(keys, peer), sender?.nonce, ours?.nonce);
  const all = Buffer.from(String(encryptedData ?? ''), 'base64');
  if (all.length < 17) throw bad('Nothing to decrypt.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([decipher.update(all.subarray(0, all.length - 16)), decipher.final()]).toString('utf8');
}

/**
 * Key material of a requester (the practice HIU here; Perinexa itself in M3): the private key stays with the caller.
 * shape: how the public key is written ('ec-spki', as ABDM's reference library sends it, unless said otherwise).
 */
export function requesterKeyMaterial({ shape = 'ec-spki', privateRaw, nonce = newNonce(), expiry } = {}) {
  const keys = newKeyPair(privateRaw);
  return {
    privateRaw: keys.privateRaw.toString('base64'),
    nonce,
    keyMaterial: { cryptoAlg: CRYPTO_ALG, curve: CURVE, dhPublicKey: { expiry, parameters: KEY_PARAMETERS, keyValue: writePublicKey(keys.u, shape) }, nonce },
  };
}

/** The checksum sent with each document: MD5 of the document before encryption, in hex (to check with ABDM). */
export const checksumOf = (text) => createHash('md5').update(String(text), 'utf8').digest('hex');

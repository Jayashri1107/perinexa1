// Checking the UIDAI digital signature of an Aadhaar Secure QR (24 Oct 2026), in the browser with its own crypto – no
// add-on, nothing sent. The unpacked QR ends with a 2048-bit RSA signature (SHA-256) over every byte before it.
// UIDAI's public certificates are kept in ./uidai-keys (downloaded from uidai.gov.in "Data and Downloads" on
// 24 Oct 2026: the Secure QR, Offline e-KYC and digital-signature ones). Which key signed a card depends on when it
// was printed, so every key is tried. A certificate's end date does not matter here: it says until when UIDAI signed
// with that key, and a card printed then stays valid. Developer: see docs/AADHAAR_QR.md.

const PEMS = import.meta.glob('./uidai-keys/*.pem', { query: '?raw', import: 'default', eager: true });

const SIGNATURE_BYTES = 256;

function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// One DER element at `at`: { tag, start (of its content), end }
function element(der, at) {
  const tag = der[at];
  let len = der[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i += 1) len = len * 256 + der[start + i];
    start += n;
  }
  if (start + len > der.length) throw new Error('bad certificate');
  return { tag, at, start, end: start + len };
}

/** An X.509 certificate (DER) → its public key (SubjectPublicKeyInfo, DER), the form crypto.subtle imports. */
export function publicKeyOf(der) {
  const cert = element(der, 0);
  const tbs = element(der, cert.start);
  let at = tbs.start;
  if (der[at] === 0xa0) at = element(der, at).end; // the version, when there
  // serial number, signature algorithm, issuer, validity, subject – then the public key
  for (let i = 0; i < 5; i += 1) at = element(der, at).end;
  const key = element(der, at);
  if (key.tag !== 0x30) throw new Error('bad certificate');
  return der.slice(key.at, key.end);
}

/** UIDAI's keys: [{ name, spki }] */
export function uidaiKeys() {
  return Object.entries(PEMS).map(([path, pem]) => ({ name: path.replace(/^.*\//, '').replace(/\.pem$/, ''), spki: publicKeyOf(pemToDer(pem)) }));
}

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
let imported = null;
const importKeys = (keys) => Promise.all(keys.map(async (k) => ({ name: k.name, key: await crypto.subtle.importKey('spki', k.spki, ALG, false, ['verify']) })));

/**
 * The whole unpacked Secure QR → 'verified' (signed by one of the keys) or 'not-verified'. `keys` for the tests;
 * by default UIDAI's own.
 */
export async function verifySecureQr(bytes, keys = null) {
  if (!bytes || bytes.length <= SIGNATURE_BYTES || !globalThis.crypto?.subtle) return 'not-verified';
  const data = bytes.subarray(0, bytes.length - SIGNATURE_BYTES);
  const signature = bytes.subarray(bytes.length - SIGNATURE_BYTES);
  let list;
  try {
    list = keys ? await importKeys(keys) : await (imported ??= importKeys(uidaiKeys()));
  } catch {
    return 'not-verified';
  }
  for (const { key } of list) {
    try {
      if (await crypto.subtle.verify(ALG, key, signature, data)) return 'verified';
    } catch {
      // the next key
    }
  }
  return 'not-verified';
}

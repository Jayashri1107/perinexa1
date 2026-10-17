// Reading the QR code on an Aadhaar card, in the browser (owner, 16 Oct 2026: "upload Aadhaar … all info gets
// filled"). Staff upload a photo or scan of the card; the QR is read here and nothing is sent anywhere. Only the name,
// age, address and the last 4 digits of the Aadhaar number (as the form's "ID proof seen" already keeps) are used –
// never the whole number, the photo or the image itself.
//
// Two kinds of QR:
//  - the Secure QR (cards printed since 2019, e-Aadhaar): a long decimal number holding gzip-compressed fields split
//    by the byte 255 – "V2" first in version 2, then the email/mobile indicator, a reference id (its first 4 digits are
//    the last 4 of the Aadhaar number), name, date of birth, gender, care of, district, landmark, house, location, PIN
//    code, post office, state, street, sub-district, village/town/city, …, the photo and a digital signature.
//  - the old XML QR: <PrintLetterBarcodeData uid="…" name="…" yob="…" … />.
// The UIDAI signature is NOT checked (that needs UIDAI's certificate): a forged QR would fill the form with its words,
// so staff still look at the card as before. Developer: see docs/AADHAAR_QR.md.

const SEP = 255;

/** A decimal string of the Secure QR → its bytes. */
export function decimalToBytes(text) {
  let hex = BigInt(text).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The text fields at the start (ISO-8859-1), stopping before the photo
function textFields(bytes, count) {
  const fields = [];
  let start = 0;
  for (let i = 0; i < bytes.length && fields.length < count; i += 1) {
    if (bytes[i] !== SEP) continue;
    fields.push(Array.from(bytes.subarray(start, i), (b) => String.fromCharCode(b)).join(''));
    start = i + 1;
  }
  return fields;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Age in whole years on `today` from "DD-MM-YYYY" / "DD/MM/YYYY" / "YYYY-MM-DD", or from a year of birth. */
export function ageFrom({ dob, yob }, today = new Date()) {
  let y;
  let m = 1;
  let d = 1;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(clean(dob));
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(clean(dob));
  if (dmy) [, d, m, y] = dmy.map(Number);
  else if (ymd) [, y, m, d] = ymd.map(Number);
  else if (/^\d{4}$/.test(clean(yob))) return String(today.getFullYear() - Number(yob));
  else return '';
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? String(age) : '';
}

// "W/O Ravi Sample" (wife of), "D/O …" (daughter of), "C/O …" (care of) → her contact person and how related
const CARE_OF = [
  [/^\s*(?:w\/o|wife\s+of)\s*[:.,-]?\s*/i, 'Husband'],
  [/^\s*(?:d\/o|daughter\s+of|s\/o|son\s+of)\s*[:.,-]?\s*/i, 'Father'],
  [/^\s*(?:c\/o|care\s+of)\s*[:.,-]?\s*/i, ''],
];
export function careOf(co) {
  const text = clean(co);
  for (const [rx, relation] of CARE_OF) if (rx.test(text)) return { name: text.replace(rx, '').slice(0, 100), relation };
  return { name: text.slice(0, 100), relation: '' };
}

/** The form's words from the card's address parts. */
function fromParts(p, today) {
  const city = clean(p.vtc) || clean(p.loc) || clean(p.dist);
  const seen = new Set([city.toLowerCase()]);
  const address = [p.house, p.street, p.lm, p.loc, p.po, p.subdist, p.dist]
    .map(clean)
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .join(', ')
    .slice(0, 300);
  const pin = clean(p.pc).replace(/\D/g, '');
  return {
    fullName: clean(p.name).slice(0, 150),
    ageYears: ageFrom({ dob: p.dob, yob: p.yob }, today),
    address,
    pinCode: pin.length === 6 ? pin : '',
    city: city.slice(0, 60),
    state: clean(p.state).slice(0, 60),
    last4: /^\d{4}$/.test(p.last4 ?? '') ? p.last4 : '',
    ...(clean(p.co) ? { contactName: careOf(p.co).name, contactRelation: careOf(p.co).relation } : { contactName: '', contactRelation: '' }),
  };
}

function parseXml(text, today) {
  const attr = (name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(text) ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i').exec(text);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"') : '';
  };
  const uid = attr('uid').replace(/\D/g, '');
  return fromParts(
    {
      name: attr('name'), dob: attr('dob'), yob: attr('yob'), co: attr('co'), house: attr('house'), street: attr('street'), lm: attr('lm'), loc: attr('loc'),
      vtc: attr('vtc'), po: attr('po'), dist: attr('dist'), subdist: attr('subdist'), state: attr('state'), pc: attr('pc'),
      last4: uid.length >= 4 ? uid.slice(-4) : '',
    },
    today,
  );
}

async function parseSecure(text, today) {
  const fields = textFields(await gunzip(decimalToBytes(text)), 18);
  const v2 = /^V\d$/.test(fields[0] ?? '');
  const f = v2 ? fields.slice(1) : fields;
  // f: 0 indicator, 1 reference id, 2 name, 3 dob, 4 gender, 5 care of, 6 district, 7 landmark, 8 house, 9 location,
  //    10 PIN, 11 post office, 12 state, 13 street, 14 sub-district, 15 village/town/city
  if (f.length < 16) throw new Error('short');
  return fromParts(
    { name: f[2], dob: f[3], co: f[5], dist: f[6], lm: f[7], house: f[8], loc: f[9], pc: f[10], po: f[11], state: f[12], street: f[13], subdist: f[14], vtc: f[15], last4: f[1].slice(0, 4) },
    today,
  );
}

/**
 * The text read from an Aadhaar QR → { fullName, ageYears, address, pinCode, city, state, last4, contactName,
 * contactRelation } (text, '' when missing). Throws Error('NOT_AADHAAR') for any other QR.
 */
export async function parseAadhaarQr(text, today = new Date()) {
  const t = String(text ?? '').trim();
  try {
    if (/<PrintLetterBarcodeData/i.test(t)) return parseXml(t, today);
    if (/^\d{100,}$/.test(t)) {
      const out = await parseSecure(t, today);
      if (out.fullName) return out;
    }
  } catch {
    // not an Aadhaar QR after all
  }
  throw new Error('NOT_AADHAAR');
}

// ---------- Finding the QR in a picture ----------
// The Secure QR on the card is dense (about 100 × 100 squares) and small on a photo of the whole card, so it is looked
// for in several ways until one reads it: Chrome's own QR reader where the computer has one (phones, Macs), then jsQR
// on the whole picture at a few sizes, then on overlapping parts of it at full sharpness (the QR then fills more of
// what is looked at, and the card's printing around it no longer confuses the search).

let nativeDetector; // undefined: not asked yet; null: none on this computer
async function nativeRead(source) {
  if (nativeDetector === undefined) {
    nativeDetector = null;
    try {
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch {
      nativeDetector = null;
    }
  }
  if (!nativeDetector) return null;
  try {
    const found = await nativeDetector.detect(source);
    return found.find((f) => f.rawValue)?.rawValue ?? null;
  } catch {
    return null;
  }
}

let jsQRModule = null;
const loadJsQR = async () => (jsQRModule ??= (await import('jsqr')).default);

/** The parts of a w × h picture to look in: [sx, sy, sw, sh] – the whole, the middle, then overlapping halves. */
export function searchAreas(w, h, quick = false) {
  const areas = [[0, 0, w, h]];
  const mid = (f) => [Math.round((w * (1 - f)) / 2), Math.round((h * (1 - f)) / 2), Math.round(w * f), Math.round(h * f)];
  areas.push(mid(0.6));
  if (quick) return areas;
  for (const fy of [0, 0.25, 0.5]) for (const fx of [0, 0.25, 0.5]) areas.push([Math.round(w * fx), Math.round(h * fy), Math.round(w * 0.5), Math.round(h * 0.5)]);
  return areas;
}

/**
 * Reads a QR from something that can be drawn (an image or a video frame) of w × h, or null. quick: fewer tries, for
 * the camera's frames (it tries again on the next one).
 */
export async function readQrFrom(source, w, h, { quick = false, canvas = null } = {}) {
  const native = await nativeRead(source);
  if (native) return native;
  const jsQR = await loadJsQR();
  const c = canvas ?? document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const attempt = (sx, sy, sw, sh, size) => {
    // Shrunk to `size` on its longer side – or enlarged to it, for a small part, so each square of the QR is a few dots
    const scale = size / Math.max(sw, sh);
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    return jsQR(data, width, height, { inversionAttempts: quick ? 'dontInvert' : 'attemptBoth' })?.data ?? null;
  };
  const longest = Math.max(w, h);
  const sizes = quick ? [Math.min(longest, 1280)] : [1600, 1200, 2400, Math.min(longest, 3200)];
  for (const [sx, sy, sw, sh] of searchAreas(w, h, quick)) {
    const own = Math.max(sw, sh);
    for (const size of sx === 0 && sy === 0 && sw === w ? sizes : [Math.min(Math.max(own, 1000), 2000)]) {
      const text = attempt(sx, sy, sw, sh, size);
      if (text) return text;
    }
  }
  return null;
}

/** Finds and reads a QR in an image file (a photo or scan of the card). */
export async function readQrFromImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('NOT_IMAGE'));
      i.src = url;
    });
    const text = await readQrFrom(img, img.naturalWidth, img.naturalHeight);
    if (!text) throw new Error('NO_QR');
    return text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

// The address of ZXing's program file, served by this app (just a text; the file loads only when a QR is read)
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

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
// The Secure QR on the card is dense (about 120–150 squares across) and small in a webcam picture, often a little
// blurred. Measured on 17 Oct 2026 (Aadhaar-sized sample codes, blurred and noisy as a webcam sees them): ZXing reads
// them down to about 2.6 camera pixels per square when a generous middle part of the picture is enlarged 2× first;
// jsQR needs about 3–4 sharp pixels per square. So the QR is looked for, until one way reads it:
//  1. Chrome's own QR reader, where the computer has one (phones, Macs);
//  2. ZXing (zxing-wasm, loaded from this app – never from the internet) on the whole picture, then on the middle 85 %
//     enlarged 2×; the camera alternates the two from frame to frame;
//  3. for a photo: ZXing and jsQR on overlapping parts of it, at full sharpness; jsQR on the whole picture.

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

// ZXing: its program file comes with the app (Vite gives its address); without this it would be fetched from a CDN.
let zxing = null; // a promise of the reader, or of null when it can't load
function loadZxing() {
  zxing ??= (async () => {
    try {
      const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
      await prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) }, fireImmediately: true });
      return readBarcodes;
    } catch {
      return null;
    }
  })();
  return zxing;
}
const ZXING_OPTIONS = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 };
async function zxingRead(imageData, extra = {}) {
  const read = await loadZxing();
  if (!read) return null;
  try {
    return (await read(imageData, { ...ZXING_OPTIONS, ...extra })).find((r) => r.isValid && r.text)?.text ?? null;
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
  areas.push(mid(quick ? 0.85 : 0.6));
  if (quick) return areas;
  for (const fy of [0, 0.25, 0.5]) for (const fx of [0, 0.25, 0.5]) areas.push([Math.round(w * fx), Math.round(h * fy), Math.round(w * 0.5), Math.round(h * 0.5)]);
  return areas;
}

/** Part [sx, sy, sw, sh] of the picture, drawn `scale` times its size (at most `max` dots on its longer side). */
function pixels(source, [sx, sy, sw, sh], scale, canvas, max = 3600) {
  const k = Math.min(scale, max / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Reads a QR from something that can be drawn (an image or a video frame) of w × h, or null.
 * quick: one try per camera frame (`frame` counts them – whole picture and enlarged middle in turn).
 * deep: a camera frame looked at more closely (every ~2 seconds, and Capture): a smaller QR (the card held further away,
 * where a webcam can focus) enlarged 3×, another way of telling black from white, and the four quarters.
 */
export async function readQrFrom(source, w, h, { quick = false, deep = false, frame = 0, canvas = null } = {}) {
  const native = await nativeRead(source);
  if (native) return native;
  const c = canvas ?? document.createElement('canvas');
  const [whole, middle] = searchAreas(w, h, true);
  if (deep) {
    const mid = (f) => [Math.round((w * (1 - f)) / 2), Math.round((h * (1 - f)) / 2), Math.round(w * f), Math.round(h * f)];
    const quarters = [0, 0.5].flatMap((fy) => [0, 0.5].map((fx) => [Math.round(w * fx), Math.round(h * fy), Math.round(w * 0.5), Math.round(h * 0.5)]));
    const tries = [
      [whole, 1, {}],
      [middle, 2, {}],
      [mid(0.55), 3, {}],
      [mid(0.4), 4, {}],
      [middle, 2, { binarizer: 'GlobalHistogram' }],
      [whole, 1, { binarizer: 'FixedThreshold' }],
      ...quarters.map((q) => [q, 2, {}]),
    ];
    for (const [area, scale, extra] of tries) {
      const text = await zxingRead(pixels(source, area, scale, c, 3600), extra);
      if (text) return text;
    }
    return null;
  }
  if (quick) {
    const text = frame % 2 === 0 ? await zxingRead(pixels(source, whole, 1, c, 2560)) : await zxingRead(pixels(source, middle, 2, c));
    if (text || (await loadZxing())) return text;
    // ZXing could not load: jsQR on the whole frame
    const jsQR = await loadJsQR();
    const d = pixels(source, whole, 1, c, 1600);
    return jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  }
  // A photo: every way, the surest first
  for (const [area, scale, max] of [[whole, 1, 4000], [middle, 2, 3600], [whole, 0.5, 4000]]) {
    const text = await zxingRead(pixels(source, area, scale, c, max));
    if (text) return text;
  }
  const jsQR = await loadJsQR();
  for (const area of searchAreas(w, h)) {
    const own = Math.max(area[2], area[3]);
    const d = pixels(source, area, Math.max(1, 1600 / own), c, 2400);
    const text = (await zxingRead(d)) ?? jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    if (text) return text;
  }
  for (const size of [1600, 1200, 2400]) {
    const d = pixels(source, whole, size / Math.max(w, h), c, size);
    const text = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    if (text) return text;
  }
  return null;
}

/** Starts loading the QR readers before they are needed (when the Aadhaar panel opens). */
export const prepareQrReaders = () => {
  loadZxing();
  loadJsQR().catch(() => {});
};

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

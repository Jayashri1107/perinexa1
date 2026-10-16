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
      name: attr('name'), dob: attr('dob'), yob: attr('yob'), house: attr('house'), street: attr('street'), lm: attr('lm'), loc: attr('loc'),
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
    { name: f[2], dob: f[3], dist: f[6], lm: f[7], house: f[8], loc: f[9], pc: f[10], po: f[11], state: f[12], street: f[13], subdist: f[14], vtc: f[15], last4: f[1].slice(0, 4) },
    today,
  );
}

/**
 * The text read from an Aadhaar QR → { fullName, ageYears, address, pinCode, city, state, last4 } (text, '' when
 * missing). Throws Error('NOT_AADHAAR') for any other QR.
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

/** Finds and reads a QR in an image file (photo or scan), trying a few sizes – a phone photo is often too big. */
export async function readQrFromImage(file) {
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('NOT_IMAGE'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    for (const size of [1600, 1200, 2400, 800, longest]) {
      const scale = Math.min(1, size / longest);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
      if (found?.data) return found.data;
    }
    throw new Error('NO_QR');
  } finally {
    URL.revokeObjectURL(url);
  }
}

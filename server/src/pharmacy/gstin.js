// GSTIN (the 15-character GST number of a business) and the GST state codes. PURE.
// The website keeps its own copy (client/src/pages/pharmacy/gstin.js): keep the two the same.
//
// A GSTIN is: 2 digits (the state code) + the 10-character PAN (5 letters, 4 digits, 1 letter) + 1 character (which
// registration of that PAN in the state) + "Z" + 1 check character worked out from the first 14. The check character
// catches a mistyped GSTIN before it reaches an invoice or the e-invoice portal.

export const GST_STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
  97: 'Other Territory',
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A GSTIN as it is kept: no spaces, capitals. */
export const cleanGstin = (text) => String(text ?? '').replace(/\s+/g, '').toUpperCase();

/** The check character (the 15th) for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14) {
  let sum = 0;
  [...String(first14).slice(0, 14)].forEach((ch, i) => {
    const product = CHARS.indexOf(ch) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  });
  return CHARS[(36 - (sum % 36)) % 36];
}

/**
 * What is wrong with a GSTIN, in plain words – or null when it is well formed (15 characters in the right pattern, a
 * state code that exists, and the right check character). It cannot tell whether the GSTIN is really registered:
 * only the GST portal knows that.
 */
export function gstinProblem(text) {
  const g = cleanGstin(text);
  if (!g) return 'Enter the GSTIN.';
  if (g.length !== 15) return 'A GSTIN has 15 characters.';
  if (!SHAPE.test(g)) return 'This does not look like a GSTIN (for example 27ABCDE1234F1Z0: state code, PAN, a number, Z, a check character).';
  if (!GST_STATES[g.slice(0, 2)]) return 'The first two digits of a GSTIN are the state code: this one is not a state.';
  if (gstinCheckChar(g) !== g[14]) return 'This GSTIN has a typing mistake (its last character does not match the rest): check it against the GST certificate.';
  return null;
}

export const isGstin = (text) => gstinProblem(text) === null;

/** { code: '27', name: 'Maharashtra' } from a well-formed GSTIN, else null. */
export function gstinState(text) {
  const g = cleanGstin(text);
  if (!isGstin(g)) return null;
  const code = g.slice(0, 2);
  return { code, name: GST_STATES[code] };
}

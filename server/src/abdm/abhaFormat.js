// ABHA and Aadhaar numbers (ABDM linking, M1). PURE.
// PRIVACY: an Aadhaar number only passes through Perinexa on its way to ABDM – nothing here stores or logs it.

/** The Verhoeff check every Aadhaar number passes (its last digit is a check digit). */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 8, 7, 6, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeffValid(digits) {
  let c = 0;
  [...digits].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** A 12-digit Aadhaar number (spaces allowed) → its digits, or null. Real Aadhaar numbers never start with 0 or 1. */
export function aadhaarDigits(text) {
  const d = String(text ?? '').replace(/\s/g, '');
  return /^[2-9]\d{11}$/.test(d) ? d : null;
}

/** "91123456789012" or "91-1234-5678-9012" → "91-1234-5678-9012", or null. */
export function abhaNumber(text) {
  const d = String(text ?? '').replace(/[\s-]/g, '');
  return /^\d{14}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : null;
}

/** An ABHA address (e.g. "asha.sample@sbx" or "asha.sample@abdm"); the part before @ only is fine too. */
export function abhaAddress(text) {
  const t = String(text ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,31}(@[a-z]{2,10})?$/.test(t) ? t : null;
}

/** A 10-digit Indian mobile number → its digits, or null. */
export function mobileDigits(text) {
  const d = String(text ?? '').replace(/\D/g, '').replace(/^(?:91|0)(?=[6-9]\d{9}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "9876543210" → "******3210". */
export const maskMobile = (m) => (m ? `******${String(m).slice(-4)}` : '');

/** Her age from ABHA's year of birth (as of a given year). */
export const ageFrom = (yearOfBirth, year) => (yearOfBirth ? Math.max(0, year - Number(yearOfBirth)) : null);

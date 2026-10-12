// The UPI payment link of a bill (billing extras, 4 Oct 2026). PURE: no database, no network.
//
// Perinexa only writes the standard link (upi://pay?pa=…&pn=…&am=…&cu=INR&tn=<bill number>) and a message to copy.
// It is connected to no bank and no payment gateway: it never learns whether anything was paid, so a payment is
// recorded only by reception with "Take payment". Nothing about the patient goes into the link or the message –
// only the bill number.

import { rupees } from './money.js';

// A UPI ID (VPA): name@handle. The name has letters, digits, dots, hyphens and underscores; the handle (the bank or
// app) starts with a letter and has letters and digits only.
const UPI_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}@[A-Za-z][A-Za-z0-9]{1,31}$/;
export const UPI_ID_MAX = 100;
export const PAYEE_NAME_MAX = 80;

/** What is wrong with this UPI ID, in plain words, or null when its format is right. */
export function upiIdProblem(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Enter the UPI ID.';
  if (/\s/.test(text)) return 'A UPI ID has no spaces.';
  if (!text.includes('@')) return 'A UPI ID looks like name@bank – the @ is missing.';
  if (text.split('@').length !== 2) return 'A UPI ID has one @ only.';
  if (text.length > UPI_ID_MAX || !UPI_ID.test(text)) return 'This does not look like a UPI ID. It looks like name@bank: letters, digits, dots and hyphens, then @ and the bank or app.';
  return null;
}

/** What is wrong with this payee name, or null. It goes into the link, so it stays on one line. */
export function payeeNameProblem(value) {
  const text = String(value ?? '').trim();
  if (text.length < 2) return 'Enter the name the UPI ID is registered under.';
  if (text.length > PAYEE_NAME_MAX) return 'The payee name is too long.';
  if (/[\u0000-\u001f\u007f]/.test(text)) return 'The payee name must be on one line.';
  return null;
}

/** Paise → the amount as a UPI link carries it: rupees with two decimals ("1250.50"). */
export const upiAmount = (paise) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

/**
 * The standard UPI link: who is paid (pa, pn), how much (am, cu=INR) and the bill number as the note (tn).
 * Nothing else – no name, patient number or phone of the patient.
 */
export function upiLink({ upiId, payeeName, amountPaise, billNumber }) {
  const e = encodeURIComponent;
  // The @ of a UPI ID is written as it is (it is allowed there, and every UPI app expects it so)
  return `upi://pay?pa=${e(upiId.trim()).replace(/%40/g, '@')}&pn=${e(payeeName.trim())}&am=${upiAmount(amountPaise)}&cu=INR&tn=${e(billNumber)}`;
}

/**
 * The message to copy and send to the patient by hand: the amount, the link, and the UPI ID to pay to when the
 * link does not open on her phone. It names the hospital and the bill number – never the patient.
 */
export function upiMessage({ upiId, payeeName, amountPaise, billNumber, link }) {
  return [
    `${payeeName.trim()}: bill ${billNumber}. Amount to pay: ${rupees(amountPaise)}.`,
    'To pay by UPI, open this link on your phone:',
    link,
    `If the link does not open, pay to the UPI ID ${upiId.trim()} and write ${billNumber} in the note.`,
    'After paying, please show the payment message at the reception.',
  ].join('\n');
}

// A record marked as a duplicate of another ("Duplicate of P-…"), and the words that find a possible match at
// registration. PURE (no database): the model, the routes and the lists all read these.
//
// What "duplicate" means in this app:
//  - nothing is ever moved between records or deleted (the one exception: her appointments from today on go to
//    the main record, and come back on "Undo");
//  - a duplicate stays fully readable, but takes nothing new: no new visits, lab orders, admissions,
//    appointments, prescriptions, scans or procedures, bills, pharmacy sales or referrals – the server refuses with
//    refuseNewOnDuplicate (the pharmacy sells on the main record, also against a prescription written on the duplicate);
//  - a record with a visit of today that is still open, or with a patient in hospital on it, cannot be marked
//    (routes/patientDuplicates.js): the work under way on it would be frozen;
//  - what the duplicate has and the main record has not (an allergy, a blood group, pregnancy dates, a care plan …)
//    is told to the doctor before and after the marking, and on the main record (duplicateCompare.js) – never copied;
//  - what happened to the person is counted once, under her main record: her visits on a duplicate count for the
//    main record in Analytics, the monthly report and the consultation type (new or follow-up);
//  - it is left out of the Patients list, searches, the calendar, the worklists, reminders and Analytics
//    (NOT_DUPLICATE in their queries). Work already under way on it – a lab order, an open bill – stays where it
//    is and can be finished.

import { HttpError } from '../utils/httpError.js';

/** The database filter for records that are not marked as a duplicate (also every record from before this field). */
export const NOT_DUPLICATE = Object.freeze({ 'duplicateOf.patient': null });
/** The database filter for records marked as a duplicate. */
export const ONLY_DUPLICATES = Object.freeze({ 'duplicateOf.patient': { $ne: null } });

// Why a message still waiting for a duplicate record was not sent (shown in the outbox; "Undo" finds its messages by it).
export const DUPLICATE_MESSAGE_REASON = 'Record marked as a duplicate';

/** Is this record marked as a duplicate of another? (needs the record's duplicateOf) */
export const isDuplicate = (patient) => Boolean(patient?.duplicateOf?.patient);

// What a duplicate takes no more of, as the refusal says it.
export const NEW_THINGS = {
  visit: 'new visits or changes to a visit',
  prescription: 'prescriptions',
  lab: 'new lab orders',
  admission: 'new admissions',
  appointment: 'new appointments',
  arrival: 'new arrivals',
  work: 'new scans or procedures',
  bill: 'new bills',
  sale: 'new pharmacy sales',
  referral: 'new referrals', // a referral is linked to her main record (routes/referrals.js)
};

/** The plain refusal for something new on a duplicate record. */
export function duplicateRefusal(patient, what) {
  const main = patient.duplicateOf?.mrn ?? 'another record';
  return new HttpError(409, `This record is marked as a duplicate of ${main}, so it takes no ${NEW_THINGS[what] ?? 'new entries'}. Open ${main} instead.`, 'DUPLICATE_RECORD');
}

/** Throws the refusal when the record is a duplicate (needs the record's duplicateOf). */
export function refuseNewOnDuplicate(patient, what) {
  if (isDuplicate(patient)) throw duplicateRefusal(patient, what);
}

// ---------- Possible matches at registration ----------

// A phone number counts for matching only when it has at least this many digits (a shorter one is not a number).
export const MIN_PHONE_DIGITS = 6;
// A name counts for matching only when it has at least this many letters.
export const MIN_NAME_LETTERS = 2;

// One number's digits as they are compared: without zeros in front, and without India's 91 (and a 0 after it) in
// front of a ten-digit number.
const oneNumber = (digits) => digits.replace(/^0+/, '').replace(/^91(?=0?\d{10}$)/, '').replace(/^0+/, '');
const usableNumber = (digits) => digits.length >= MIN_PHONE_DIGITS && !/^(\d)\1*$/.test(digits);
// From this many digits on, the field holds more than one number (two numbers are sometimes typed into it).
const SEVERAL_NUMBERS_DIGITS = 16;

/**
 * The numbers in a phone field, as they are compared: digits only, without a leading 0 and without India's 91 in
 * front of a ten-digit number – so "+91 98765 43210", "098765-43210", "+91 098765 43210" and "9876543210" are the
 * same. Two numbers typed into the one field ("98765 43210 91234 56789") each count: the ten digits at the front and
 * the ten at the end. [] when there is no usable number: too short, or one digit repeated (0000000000 is typed when
 * she has no phone).
 */
export function phoneKeys(phone) {
  const text = String(phone ?? '');
  // Each "+" starts a number of its own ("+91 98765 43210 +91 91234 56789")
  const parts = text.split('+').map((part) => part.replace(/\D/g, '')).filter(Boolean);
  const keys = [];
  for (const digits of parts) {
    const one = oneNumber(digits);
    if (one.length < SEVERAL_NUMBERS_DIGITS) keys.push(one);
    else {
      // Whole ten-digit numbers one after the other have no 91 in front; otherwise a 91 in front is India's code
      const front = digits.replace(/^0+/, '');
      keys.push((front.length % 10 === 0 ? front : front.replace(/^910?/, '')).slice(0, 10), digits.slice(-10));
    }
  }
  return [...new Set(keys.filter(usableNumber))];
}

/** The digits of a phone field with one number in it, as they are compared ('' when there is no usable number). */
export const phoneKey = (phone) => phoneKeys(phone)[0] ?? '';

/**
 * A name as it is compared: capitals, spaces and dots make no difference ("A. Sample" = "a sample" = "ASample").
 * Characters that cannot be seen (control characters) are left out, so they never reach a database pattern.
 */
export function nameKey(name) {
  const key = String(name ?? '').normalize('NFKC').toLowerCase().replace(/[\s.\p{Cc}]+/gu, '');
  return [...key].length < MIN_NAME_LETTERS ? '' : key;
}

const escapeChar = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A pattern for stored phone numbers that HAVE these digits in this order, whatever signs or spaces are between
 * them (at the end, or as the first of two numbers in the field). It only narrows the search in the database: every
 * record it finds is compared again, exactly, with matchedOn.
 */
export const phonePattern = (key) => new RegExp([...key].join('[^0-9]*'));

/**
 * A pattern for stored names equal to this key but for capitals, spaces and dots. It only narrows the search in
 * the database: every record it finds is compared again, exactly, with matchedOn.
 */
export const namePattern = (key) => new RegExp(`^[\\s.]*${[...key].map(escapeChar).join('[\\s.]*')}[\\s.]*$`, 'i');

/**
 * How a stored record matches what was typed: ['phone'], ['name'], both, or [] (checked again here, exactly).
 * phones: the numbers typed (phoneKeys); name: the name typed (nameKey).
 */
export function matchedOn(patient, { phones = [], name }) {
  const out = [];
  if (phones.length && phoneKeys(patient.phone).some((k) => phones.includes(k))) out.push('phone');
  if (name && nameKey(patient.fullName) === name) out.push('name');
  return out;
}

/** The last four digits of a phone number ("…3210"), or '' when it has fewer than four. */
export function lastFourDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

// ---------- Marking a record as a duplicate ----------

/**
 * Why this record cannot be marked as a duplicate of that one – a plain sentence, or null when it can.
 * dup, main: the two records (with duplicateOf, careType, mrn); earlier: the records marked as duplicates of `dup`.
 */
export function cannotBeDuplicate(dup, main, earlier = []) {
  if (String(dup._id) === String(main._id)) return 'A record cannot be a duplicate of itself. Choose the other record of this person.';
  if (isDuplicate(dup)) return `This record is already marked as a duplicate of ${dup.duplicateOf.mrn}. Undo that first.`;
  if (isDuplicate(main)) return `${main.mrn} is itself marked as a duplicate of ${main.duplicateOf.mrn}. Choose ${main.duplicateOf.mrn} as the main record.`;
  if (earlier.length) return `This record is the main record of ${earlier.map((e) => e.mrn).join(', ')}. Mark the other record as the duplicate, or undo that first.`;
  if ((dup.careType === 'newborn') !== (main.careType === 'newborn')) return "A baby's record and an adult's record cannot be the same person.";
  // A record closed after a death (patients/deathRules.js) is not hidden behind a record that is still in use: the
  // main record would go on getting appointments and reminders. (Both closed, or only the main one, is fine.)
  if (dup.death?.on && !main.death?.on) return `This record is closed and ${main.mrn} is not. Close ${main.mrn} in the same way first, or reopen this record – then mark it as a duplicate.`;
  return null;
}

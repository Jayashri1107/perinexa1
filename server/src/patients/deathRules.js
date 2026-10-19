// A death recorded on a record, and the record that is CLOSED by it. PURE (no database): the model, the routes, the
// lists and the reminders all read these.
//
// What "closed" means in this app:
//  - a death is recorded by a DOCTOR only (the patient's doctor, or any doctor for an unassigned patient), after a
//    confirmation, with an audit entry. On a baby's record: the date, the age in completed days (worked out from the
//    day of birth) and the place. On every other record: the date and when it was in relation to the pregnancy.
//    There is no cause-of-death field;
//  - the record stays fully readable, but takes nothing new: no new visits, admissions, appointments, arrivals, lab
//    orders, scans or procedures, referrals and no counter sale at the pharmacy; no next visit can be set; no
//    reminder, message or patient-portal access of any kind (refuseNewOnClosed). What was under way can be finished: a visit already
//    started, the documents of a stay in hospital (the discharge card ends the stay), a lab order already made, and
//    her bills;
//  - when it is closed, her booked appointments from today on are cancelled (no message goes out), every message
//    still waiting for her is cancelled, and her portal access ends;
//  - it stays in the Patients list and in every search (the record must be found), marked "Record closed", but is
//    left out of the worklists, Today's lists and call lists, the overdue lists, the calendar and every reminder
//    (IN_USE in their queries). A stay in hospital that is still open stays on the In hospital list (marked
//    "Record closed", with no red flags) until the discharge card ends it;
//  - staff who may not see the medical details (reception, the lab, the pharmacist) see only that the record is
//    closed – never why, and never the date;
//  - a doctor can undo a death recorded in error, with a reason: the record is in use again. Nothing the closing
//    cancelled comes back by itself – the appointments it cancelled that are still ahead are listed for reception to
//    book again (a fee may have come off the bill, the time may be taken). The entry is kept in the record's history.

import { daysBetween, utcDay } from '../careplans/dates.js';
import { HttpError } from '../utils/httpError.js';
import { NOT_DUPLICATE } from './duplicateRules.js';

/** The database filter for records that are not closed (also every record from before this field). */
export const NOT_CLOSED = Object.freeze({ 'death.on': null });
/** The database filter for records in use: not marked as a duplicate of another, and not closed. */
export const IN_USE = Object.freeze({ ...NOT_DUPLICATE, ...NOT_CLOSED });

/** Is this record closed? (needs the record's death) */
export const isClosed = (patient) => Boolean(patient?.death?.on);

// Why a message still waiting for a closed record was not sent (shown in the outbox – it never says why the record
// was closed: reception reads the outbox too).
export const CLOSED_MESSAGE_REASON = 'Record closed';
// Why an appointment was cancelled when the record was closed (models/Appointment.js; "Undo" finds them by it).
export const CLOSED_CANCEL_REASON = 'record_closed';

// A baby's record: where the baby died.
export const DEATH_PLACES = { here: 'This hospital', elsewhere: 'Elsewhere' };
// Every other record: when, in relation to the pregnancy. The first three are counted as a maternal death. WHO: a
// death while pregnant or within 42 days of the end of the pregnancy, from a cause related to the pregnancy or its
// care – NOT from an accident or an incidental cause, which goes under "other". The times do not overlap: the first
// 24 hours after delivery are "delivery", from 24 hours on "postpartum". DRAFT wording, to be checked by the owner;
// the website asks with the same words and hint (client/src/pages/patients/deathFormat.js).
export const DEATH_TIMINGS = {
  pregnancy: 'During pregnancy',
  delivery: 'During delivery or within 24 hours after it',
  postpartum: 'From 24 hours up to 42 days after delivery (or after the pregnancy ended)',
  other: 'Other: an accident or a cause not related to the pregnancy, or later than 42 days',
};
/** Where the definitions of a maternal and a newborn death come from (said wherever they are counted). */
export const DEATH_DEFINITIONS_SOURCE = 'WHO definitions (ICD-11): newborn death in the first 28 days of life; maternal death during pregnancy or within 42 days of its end, not from an accident or an incidental cause';
/** The timings counted as a maternal death in the monthly report. */
export const MATERNAL_DEATH_TIMINGS = ['pregnancy', 'delivery', 'postpartum'];
// A newborn death: in the first 28 days of life (days 0 to 27); "early": in the first 7 days (days 0 to 6).
export const NEONATAL_DAYS = 28;
export const EARLY_NEONATAL_DAYS = 7;

// What a closed record takes no more of, as the refusal says it.
export const CLOSED_THINGS = {
  visit: 'new visits',
  nextVisit: 'next visit',
  lab: 'new lab orders',
  admission: 'new admissions',
  appointment: 'new appointments',
  arrival: 'new arrivals',
  work: 'new scans or procedures',
  sale: 'new pharmacy sales',
  message: 'reminders or messages',
  portal: 'patient portal access',
  ai: 'AI briefs',
  referral: 'new referrals', // a referral is not logged or linked to a closed record (routes/referrals.js)
};

/** The plain refusal for something new on a closed record (it never says why the record is closed). */
export const closedRefusal = (what) => new HttpError(409, `This record is closed, so it takes no ${CLOSED_THINGS[what] ?? 'new entries'}.`, 'RECORD_CLOSED');

/** Throws the refusal when the record is closed (needs the record's death). */
export function refuseNewOnClosed(patient, what) {
  if (isClosed(patient)) throw closedRefusal(what);
}

/** A baby's age at death in completed days (0 = died on the day of birth), from the two days; null when not known. */
export function ageInDays(birthDay, deathDay) {
  if (!birthDay || !deathDay) return null;
  const days = daysBetween(utcDay(birthDay), utcDay(deathDay));
  return days < 0 ? null : days;
}

/**
 * The death as the record's readers get it (those who may see the medical details): the date, the place or the
 * timing, the age in days of a baby, who recorded it and when – never a staff id.
 */
export const deathView = (d) => (d?.on ? { on: d.on, place: d.place ?? null, timing: d.timing ?? null, ageDays: d.ageDays ?? null, byName: d.byName, at: d.at } : null);

/** An entry of the record's history: a death that was recorded in error and undone, with the reason. */
export const deathHistoryView = (h) => ({ on: h.on, place: h.place ?? null, timing: h.timing ?? null, byName: h.byName, at: h.at, undoneReason: h.undoneReason ?? '', undoneByName: h.undoneByName, undoneAt: h.undoneAt });

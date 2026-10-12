// Billing's automatic charges, called by the clinical routes after their work is saved (owner: fully automatic).
// A billing problem must never stop clinical work, so each hook catches and logs its own error; reception can still
// add the charge by hand.

import { chargeAdmission, chargeLabOrder, chargeVisit, chargeWorkDone, removeLinesOf } from './billingService.js';

async function safely(what, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`Billing: could not ${what}:`, err?.message ?? err);
  }
}

/** A visit was started (a new visit, not the same request again). */
export const billVisitStarted = (req, patient, visit) => safely('charge the consultation', () => chargeVisit(req, patient, visit));
/** A visit was cancelled (entered in error): its consultation comes off. */
export const billVisitCancelled = (req, visit) => safely('take off the consultation', () => removeLinesOf(req, { id: visit._id }, 'Visit cancelled'));
/** A lab order was made. */
export const billLabOrdered = (req, patient, order) => safely('charge the lab tests', () => chargeLabOrder(req, patient, order));
/** A lab order was cancelled: its tests come off. */
export const billLabCancelled = (req, order) => safely('take off the lab tests', () => removeLinesOf(req, { id: order._id }, 'Lab order cancelled'));
/** A patient was admitted: the stay's bill opens with its bed charge. */
export const billAdmitted = (req, stay) => safely('open the stay bill', () => chargeAdmission(req, stay));
/** An appointment was cancelled: a fee taken in advance comes off her bill (the money shows as due back). */
export const billAppointmentCancelled = (req, appt) => safely('take off the appointment fee', () => removeLinesOf(req, { id: appt._id }, 'Appointment cancelled'));
/** A scan or procedure was recorded as done. */
export const billWorkDone = (req, patient, work, item) => safely('charge the scan or procedure', () => chargeWorkDone(req, patient, work, item));
/** A scan or procedure was entered in error: its charge comes off. */
export const billWorkCancelled = (req, work) => safely('take off the scan or procedure', () => removeLinesOf(req, { id: work._id }, 'Entered in error'));

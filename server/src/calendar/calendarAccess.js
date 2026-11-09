// Who sees what on the calendar. Two detail levels per patient:
//  - 'clinical': a doctor or RMO who may see this patient's pregnancy details (the need-to-know rules in
//    utils/patientAccess.js, counting only the doctor and RMO roles);
//  - 'reception': a receptionist – name, patient number, phone, doctor and visit dates only;
//  - null: the patient is left out.
// Only calendar roles count: a nurse who is also a receptionist gets reception detail, never clinical.

import { departmentsOf, hasRole } from '../models/Membership.js';
import { patientAccess } from '../utils/patientAccess.js';
import { EVENT_TYPES, PREGNANCY_TYPES } from './calendarRules.js';

// Every patient lookup of the calendar selects these fields. calendarLevel needs sensitive and assignedDoctor
// (a narrower select would make another doctor's sensitive record look "not sensitive"), and the department fields
// for the department rule (departments, 9 Nov 2026: without them she would look "no department yet" = seen by all).
export const PATIENT_FIELDS = '_id mrn fullName phone careType pregnancy assignedDoctor sensitive department departmentReferrals babyDepartments';

const CLINICAL_ROLES = ['doctor', 'rmo'];

/** The person's clinical calendar roles (doctor, RMO) in this hospital. */
export const clinicalRoles = (req) => CLINICAL_ROLES.filter((r) => hasRole(req.membership, r));

/**
 * 'clinical' | 'reception' | null for one patient (needs PATIENT_FIELDS). A doctor gets null for another department's
 * patient (the doctor role sees nothing of her – departments, 9 Nov 2026), unless also a receptionist.
 */
export function calendarLevel(req, patient) {
  const roles = clinicalRoles(req);
  if (roles.length && patientAccess({ user: req.user, membership: { roles, departments: departmentsOf(req.membership) } }, patient).view.has('pregnancy')) return 'clinical';
  if (hasRole(req.membership, 'receptionist')) return 'reception';
  return null;
}

/** The detail level of the person as a whole (for the counts): clinical when they are a doctor or RMO. */
export const personLevel = (req) => (clinicalRoles(req).length ? 'clinical' : 'reception');

/** The entry types this person may see. */
export const allowedTypes = (req) => (clinicalRoles(req).length ? [...EVENT_TYPES] : EVENT_TYPES.filter((t) => !PREGNANCY_TYPES.includes(t)));

/** Only doctors have their own patient list ("My patients" / "All patients"). */
export const canChooseScope = (req) => hasRole(req.membership, 'doctor');

/** "mine" for a doctor who is not an RMO, else "all" (as on the Patients page). */
export const defaultScope = (req) => (hasRole(req.membership, 'doctor') && !hasRole(req.membership, 'rmo') ? 'mine' : 'all');

/** mine: patients assigned to me (unassigned patients are not "mine"); all: everyone in the hospital. */
export const scopeFilter = (req, scope) => (scope === 'mine' ? { assignedDoctor: req.user._id } : {});

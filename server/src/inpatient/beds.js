// Beds and admission at the desk (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): who may do what, and the
// short list of reasons reception chooses from.
import { hasRole } from '../models/Membership.js';
import { patientAccess } from '../utils/patientAccess.js';

// The bed board (names of the patients in each bed): those who work with admitted patients.
export const BOARD_ROLES = ['receptionist', 'doctor', 'rmo', 'nurse'];
// Wards and beds are set up by the hospital admin.
export const SETUP_ROLES = ['admin'];

// The reasons reception chooses from – a short list, so no medical details are typed at the desk (owner's choice:
// reception sees the reason; the plan keeps it to this list plus a short note). 'other' needs the note.
export const REASONS = {
  labour: 'Labour',
  caesarean_planned: 'Caesarean section – planned',
  observation: 'Observation',
  surgery: 'Other surgery',
  newborn_care: 'Newborn care',
  other: 'Other',
};
export const REASON_CODES = Object.keys(REASONS);

/** The reason written on the stay: the chosen reason and the note ("Labour – sent from the OPD"). */
export const reasonText = (code, note) => [REASONS[code], note?.trim()].filter(Boolean).join(' – ');

/** May this person admit this patient from the desk or the bed board? Reception, or a doctor/RMO who may write her record. */
export const mayAdmit = (req, patient) => hasRole(req.membership, 'receptionist') || patientAccess(req, patient).editClinical;

/** May this person move this patient to another bed? Reception and nurses, or a doctor/RMO who may write her record. */
export const mayMoveBed = (req, patient) => hasRole(req.membership, 'receptionist', 'nurse') || patientAccess(req, patient).editClinical;

/**
 * The reason for admission as this person may see it on the bed board:
 *  - those who may see her medical details: the reason as written;
 *  - reception: only a reason chosen from the list at the desk, and never on a sensitive record or the Abortion type
 *    of care (there reception keeps seeing only the word "Abortion", as everywhere else);
 *  - anyone else: nothing.
 */
export function reasonFor(req, patient, stay) {
  const access = patientAccess(req, patient);
  if (access.view.has('pregnancy')) return stay.reason || null;
  if (!hasRole(req.membership, 'receptionist')) return null;
  if (patient.sensitive || patient.careType === 'abortion' || !stay.reasonCode) return null;
  return stay.reason || null;
}

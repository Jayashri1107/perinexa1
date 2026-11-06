// Incidents on the website (Clinical Requirements Group A, item 6): the same kinds and degrees of harm as
// server/src/incidents/incidentKinds.js (a server test checks both copies). DRAFT words.
import { CircleCheck, ClipboardCheck, TriangleAlert } from 'lucide-react';

/** Everyone in a hospital may report an incident (and see their own). */
export const INCIDENT_ROLES = ['admin', 'doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'sonographer', 'pharmacist', 'billing', 'referral_desk', 'followup_coordinator', 'quality'];

/** An incident's status as colour, icon and word. */
export function incidentLook(i) {
  if (i.status === 'closed') return { tone: 'stable', icon: CircleCheck, word: 'Closed' };
  if (i.status === 'reviewed') return { tone: 'due', icon: ClipboardCheck, word: 'Reviewed – actions open' };
  return { tone: 'watch', icon: TriangleAlert, word: 'Waiting for review' };
}

export const INCIDENT_SOURCE = 'WHO Conceptual Framework for the International Classification for Patient Safety (2009) – degree of harm';
export const INCIDENT_KINDS = {
  medication: 'Medicine (wrong drug, dose, patient, time or route)',
  fall: 'Fall',
  identification: 'Wrong patient or baby identification',
  caesarean_delay: 'Category 1 caesarean over 30 minutes',
  haemorrhage: 'Unexpected heavy bleeding',
  newborn: 'Newborn event (unexpected NICU admission, birth injury)',
  infection: 'Infection or sterility',
  equipment: 'Equipment or supply failure',
  transfusion: 'Blood transfusion',
  documentation: 'Records or communication',
  security: 'Security (a baby leaving without discharge, violence)',
  other: 'Other',
};
export const SEVERITIES = { none: 'No harm', mild: 'Mild harm', moderate: 'Moderate harm', severe: 'Severe harm', death: 'Death' };
export const INCIDENT_STATUSES = ['reported', 'reviewed', 'closed'];

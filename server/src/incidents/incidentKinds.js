// Kinds of incident and their severity (Clinical Requirements Group A, item 6 – PX-X-10). DRAFT until checked against
// the manuals' incident forms by the quality lead. Severity follows the common harm scale (WHO Conceptual Framework
// for the International Classification for Patient Safety, 2009: none, mild, moderate, severe, death).
// The website keeps the same words (client/src/pages/incidents/incidentFormat.js); a server test checks them.

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

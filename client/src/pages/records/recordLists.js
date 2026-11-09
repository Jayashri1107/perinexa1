// The medical records module: the fixed lists, their words and the small rules, without any screen part – so the
// server's tests can read them (server/src/records/recordRules.js has the same lists; a test keeps them the same).

export const DOC_TYPES = ['case_sheet', 'outside_discharge', 'outside_report', 'outside_prescription', 'referral_letter', 'operation_note', 'other'];
export const DOC_TYPE_LABELS = {
  case_sheet: 'Old paper case sheet',
  outside_discharge: 'Discharge summary from another hospital',
  outside_report: 'Report from outside (lab, scan or other)',
  outside_prescription: 'Prescription from another doctor',
  referral_letter: 'Referral letter',
  operation_note: 'Operation or procedure note on paper',
  other: 'Other document',
};
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const COPY_WHATS = ['whole_record', 'discharge_summary', 'documents', 'other'];
export const COPY_WHAT_LABELS = { whole_record: 'Copy of the whole record', discharge_summary: 'Discharge summary', documents: 'Particular documents', other: 'Something else' };
export const GIVEN_TO = ['patient', 'relative', 'insurer', 'court', 'police', 'other_hospital', 'other'];
export const GIVEN_TO_LABELS = { patient: 'The patient herself', relative: 'A relative or attendant', insurer: 'An insurer or TPA', court: 'A court', police: 'The police', other_hospital: 'Another hospital or doctor', other: 'Someone else' };
/** The same, inside a sentence ("given to an insurer or TPA"). */
export const GIVEN_TO_WORDS = { patient: 'the patient herself', relative: 'a relative or attendant', insurer: 'an insurer or TPA', court: 'a court', police: 'the police', other_hospital: 'another hospital or doctor', other: 'someone else' };
export const RECEIVER_NAME_NEEDED = GIVEN_TO.filter((k) => k !== 'patient');
export const COPY_WITHIN_HOURS = 72;

export const INCOMPLETE_KINDS = ['visit_unsigned', 'document_draft'];
export const INCOMPLETE_KIND_LABELS = { visit_unsigned: 'Visit not signed', document_draft: 'Inpatient document still a draft' };
export const VISIT_UNSIGNED_AFTER_DAYS = 1;
export const DRAFT_OPEN_AFTER_DAYS = 7;

export const RECORDS_TABS = [
  { label: 'Index', to: '/records', end: true },
  { label: 'Incomplete records', to: '/records/incomplete', end: true },
  { label: 'Copies register', to: '/records/copies', end: true },
];

const HOUR = 3_600_000;
export function hoursToGive(issue, now = new Date()) {
  if (!issue.requestedOn) return null;
  const end = issue.givenOn ? new Date(issue.givenOn) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(issue.requestedOn).getTime()) / HOUR));
}
export const copyLate = (issue, now = new Date()) => {
  const h = hoursToGive(issue, now);
  return h !== null && h > COPY_WITHIN_HOURS;
};
/** "Given 2 days after the request", "Given the same day", or '' without a request date. */
export function copyTimingWords(issue, now = new Date()) {
  const h = hoursToGive(issue, now);
  if (h === null) return '';
  if (!issue.givenOn) return h > COPY_WITHIN_HOURS ? `Requested ${Math.floor(h / 24)} days ago – over ${COPY_WITHIN_HOURS} hours` : 'Requested, not given yet';
  if (h < 24) return 'Given the same day as the request';
  const days = Math.floor(h / 24);
  return `Given ${days} ${days === 1 ? 'day' : 'days'} after the request${h > COPY_WITHIN_HOURS ? ` – over ${COPY_WITHIN_HOURS} hours` : ''}`;
}

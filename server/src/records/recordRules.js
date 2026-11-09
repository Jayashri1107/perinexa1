// The medical records module (9 Nov 2026, the owner's request): documents attached to a record, the records index,
// the incomplete-records list and the copies register. Pure: the fixed lists and the small rules the screens and the
// routes share. The website has the same lists (client/src/pages/records/recordLists.js – a test keeps them the same).

// What a scanned or outside document can be. No identity documents (Aadhaar and the like): they are not stored.
export const DOC_TYPES = ['case_sheet', 'outside_discharge', 'outside_report', 'outside_prescription', 'referral_letter', 'operation_note', 'other'];
// A scanned case sheet can be many pages: bigger than the 5 MB of a lab report, but under MongoDB's 16 MB per
// document while files live in the database (object storage lifts this – docs/PROGRESS.md, 9 Nov 2026).
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

// The copies register: what was given, and to whom
export const COPY_WHATS = ['whole_record', 'discharge_summary', 'documents', 'other'];
export const GIVEN_TO = ['patient', 'relative', 'insurer', 'court', 'police', 'other_hospital', 'other'];
/** Everyone but the patient herself is named on the register. */
export const RECEIVER_NAME_NEEDED = GIVEN_TO.filter((k) => k !== 'patient');
/** The Indian Medical Council's ethics regulations (2002, 1.3.2): records are given within 72 hours of the request. */
export const COPY_WITHIN_HOURS = 72;

// The incomplete-records list
export const INCOMPLETE_KINDS = ['visit_unsigned', 'document_draft'];
/** A visit is listed when it is still unsigned the day after. */
export const VISIT_UNSIGNED_AFTER_DAYS = 1;
/** A draft inpatient document is listed once the stay is over, or after this many days in an open stay. */
export const DRAFT_OPEN_AFTER_DAYS = 7;

const HOUR = 3_600_000;
/** Hours from the request to the copy being given (or to now, while it is not given); null without a request date. */
export function hoursToGive(issue, now = new Date()) {
  if (!issue.requestedOn) return null;
  const end = issue.givenOn ? new Date(issue.givenOn) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(issue.requestedOn).getTime()) / HOUR));
}
/** Given (or still owed) more than 72 hours after the request. */
export const copyLate = (issue, now = new Date()) => {
  const h = hoursToGive(issue, now);
  return h !== null && h > COPY_WITHIN_HOURS;
};

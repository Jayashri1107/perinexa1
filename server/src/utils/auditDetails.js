import { AUDIT_CATEGORIES } from '../models/AuditLog.js';

// What every audit-log reader sends for an entry's details. Admins can read the audit log but must not see
// medical information, so risk and care-plan entries only ever show these fields – even older entries saved
// before the details were trimmed down.

// Risk entries.
const RISK_ACTIONS = new Set(['PATIENT_RISK_CHANGED', 'RISK_OVERRIDDEN', 'RISK_OVERRIDE_REMOVED']);
const RISK_DETAIL_FIELDS = ['patientId', 'mrn', 'why'];

// Care-plan entries: ids and plain action words only (never an item's name or key, a template, a reason, a
// note, a result, a date or a pregnancy outcome). The service writes nothing else; this is a second guard.
const CARE_PLAN_ACTIONS = new Set(['CARE_PLAN_CREATED', 'CARE_PLAN_VIEWED', 'CARE_PLAN_CHANGED', 'CARE_PLAN_PRINTED']);
// copy: 'patient' | 'staff' for a printout; language: 'mr' | 'hi' for a patient copy printed with Marathi or Hindi.
const CARE_PLAN_DETAIL_FIELDS = ['patientId', 'mrn', 'planId', 'itemId', 'visitId', 'change', 'access', 'copy', 'language'];

// A patient's consent forms: ids only – never which form was printed (its title could reveal a procedure).
const CONSENT_ACTIONS = new Set(['CONSENTS_VIEWED', 'CONSENT_FORM_PRINTED', 'CONSENT_SIGNED_RECORDED', 'CONSENT_SCAN_ADDED', 'CONSENT_SCAN_OPENED']);
const CONSENT_DETAIL_FIELDS = ['patientId', 'mrn', 'consentId', 'fileId', 'access', 'kind']; // kind: consent or information

// Visits and prescriptions: ids and the names of the parts saved – never what was written.
const VISIT_ACTIONS = new Set([
  'VISITS_VIEWED',
  'VISIT_VIEWED',
  'VISIT_CREATED',
  'VISIT_UPDATED',
  'VISIT_CANCELLED',
  'VISIT_SIGNED',
  'VISIT_ADDITION_ADDED',
  'PRESCRIPTION_UPDATED',
  'PRESCRIPTION_PRINTED',
  'PRESCRIPTION_PDF_SAVED',
  'VISIT_SUMMARY_PRINTED',
  'VISIT_SUMMARY_PDF_SAVED',
  'PRESCRIPTION_SENT_WHATSAPP',
  'VISIT_SUMMARY_SENT_WHATSAPP',
  'REMINDER_PREPARED',
]);
// Inpatient stays, documents and the nursing chart (Version 2): ids and the kind of document only – never what was written.
// language: 'mr' | 'hi' for a discharge card printed with Marathi or Hindi.
const INPATIENT_ACTIONS = new Set(['ADMISSIONS_VIEWED', 'ADMISSION_VIEWED', 'ADMISSION_CREATED', 'ADMISSION_UPDATED', 'ADMISSION_BED_CHANGED', 'BEDS_VIEWED', 'DISCHARGES_VIEWED', 'PATIENT_DISCHARGED', 'DOCUMENT_CREATED', 'DOCUMENT_VIEWED', 'DOCUMENT_UPDATED', 'DOCUMENT_SIGNED', 'DOCUMENT_ADDITION_ADDED', 'DOCUMENT_CANCELLED', 'DOCUMENT_PRINTED', 'NURSING_ENTRY_ADDED', 'NURSING_ENTRY_CANCELLED']);
// Beds (13 Oct 2026): bed ids, "bed board" for an admission from the board, and the counts on the board.
const INPATIENT_DETAIL_FIELDS = ['patientId', 'mrn', 'admissionId', 'documentId', 'entryId', 'kind', 'access', 'language', 'bedId', 'fromBedId', 'toBedId', 'via', 'occupied', 'withoutBed'];

// The lab module (Version 2): ids and the number of tests ordered – never a test name, value or file name.
const LAB_ACTIONS = new Set(AUDIT_CATEGORIES.patients.filter((a) => a.startsWith('LAB_')));
const LAB_DETAIL_FIELDS = ['patientId', 'mrn', 'orderId', 'fileId', 'tests'];
// Registers removed 2 Oct 2026 – kept so old entries still display. REPORT_VIEWED (the monthly report) is still written.
const REGISTER_ACTIONS = new Set(AUDIT_CATEGORIES.patients.filter((a) => a.startsWith('REGISTER_') || a === 'REPORT_VIEWED'));
const REGISTER_DETAIL_FIELDS = ['register', 'report', 'entryId', 'patientId', 'mrn', 'fileId', 'month'];

// Duplicate records: the ids and patient numbers of the records and counts – never a name, a phone number or the
// reason a doctor typed. matchIds: the records that were shown as possible matches when someone registered anyway.
const DUPLICATE_ACTIONS = new Set(['PATIENT_REGISTERED_ANYWAY', 'PATIENT_MARKED_DUPLICATE', 'PATIENT_DUPLICATE_UNDONE']);
const DUPLICATE_DETAIL_FIELDS = ['patientId', 'mrn', 'mainPatientId', 'mainMrn', 'appointmentsMoved', 'matchIds', 'matches'];

// A copy of a patient's whole record (opened, printed, saved as a PDF): which record and with what access – never
// what the copy held (no name, no count of visits, no title).
const RECORD_COPY_ACTIONS = new Set(['PATIENT_RECORD_COPIED', 'PATIENT_RECORD_COPY_PRINTED', 'PATIENT_RECORD_COPY_PDF_SAVED']);
const RECORD_COPY_DETAIL_FIELDS = ['patientId', 'mrn', 'access'];

// The whole hospital's data taken out by the person who runs the server (npm run export:hospital): counts only – how
// many patients, records and stored files, and how many records of each kind.
const HOSPITAL_EXPORT_ACTIONS = new Set(['HOSPITAL_DATA_EXPORTED']);
const HOSPITAL_EXPORT_DETAIL_FIELDS = ['patients', 'records', 'files', 'counts'];

// Billing extras (4 Oct 2026) – insurance details on a bill, the claim form, the UPI payment link: ids, which printout
// and the NAMES of the details changed – never what was typed (an insurer, a policy, claim or PM-JAY number), an
// amount or a link. The routes write nothing else; this is a second guard.
const BILLING_EXTRA_ACTIONS = new Set(['BILL_INSURANCE_CHANGED', 'CLAIM_FORM_PRINTED', 'UPI_LINK_MADE']);
const BILLING_EXTRA_DETAIL_FIELDS = ['billId', 'number', 'patientId', 'fields', 'removed', 'via', 'layout'];
// A record closed after a death, and reopened: counts only, in every reader – never which record, the date, the
// place, the timing or the reason a doctor typed. A record is closed for one reason only (a doctor recorded a death),
// so an entry with the record's number would give the hospital admin – who reads this log and sees no patient data –
// a list of deaths by patient number, which Analytics keeps even as a count from them (analytics/roles.js
// ADMIN_HIDDEN). The stored entry keeps the record's id and number (for the person who runs the server); the record
// itself keeps who recorded the death and when, and who undid it and why.
const CLOSED_ACTIONS = new Set(['PATIENT_RECORD_CLOSED', 'PATIENT_RECORD_REOPENED']);
const CLOSED_DETAIL_FIELDS = ['appointmentsCancelled', 'messagesCancelled', 'portalEnded'];

// ABDM milestone M2 – her records through her ABHA: the record's id and number, ABDM's consent and transaction ids,
// and counts – never which records, what was sent, the receiving hospital or a reason typed. via: hospital | patient;
// status: linked | waiting | refused (linking), or the consent's status; ignored: a "granted" that came after the
// consent was withdrawn, expired or refused (it stays so); refusal: why a request got nothing (a code); practice:
// practice mode (nothing left the computer).
const ABDM_SHARE_ACTIONS = new Set(['ABDM_RECORDS_VIEWED', 'ABDM_RECORDS_LINKED', 'ABDM_RECORDS_DISCOVERED', 'ABDM_CONSENT_RECEIVED', 'ABDM_RECORDS_SHARED', 'ABDM_SHARE_REFUSED']);
const ABDM_SHARE_DETAIL_FIELDS = ['patientId', 'mrn', 'consentId', 'transactionId', 'records', 'documents', 'heldBack', 'offered', 'found', 'via', 'status', 'ignored', 'refusal', 'practice'];
const ABDM_SHARE_PLATFORM_FIELDS = ['records', 'documents', 'heldBack', 'offered', 'found', 'via', 'status', 'ignored', 'refusal', 'practice'];

// ABDM milestone M3 – her records from other hospitals: the record's id and number, our request's id, ABDM's consent and
// transaction ids, the document or file opened, and counts – never which hospital, what kinds of record, a title or
// anything the documents hold. status: her answer (GRANTED, DENIED, REVOKED, EXPIRED); why: expired | revoked |
// replaced (asked again); practice: practice mode (nothing left the computer).
const ABDM_FETCH_ACTIONS = new Set(['ABDM_FETCH_REQUESTED', 'ABDM_FETCH_ANSWERED', 'ABDM_RECORDS_FETCHED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_DELETED']);
const ABDM_FETCH_DETAIL_FIELDS = ['patientId', 'mrn', 'requestId', 'consentId', 'transactionId', 'recordId', 'fileId', 'status', 'why', 'types', 'days', 'hospitals', 'documents', 'files', 'filesLeftOut', 'withheld', 'failed', 'practice'];
const ABDM_FETCH_PLATFORM_FIELDS = ['status', 'why', 'types', 'days', 'hospitals', 'documents', 'files', 'filesLeftOut', 'withheld', 'failed', 'practice'];

// AI use (Smart features): which feature, the model and token counts – never what was sent or answered.
const AI_ACTIONS = new Set(['AI_USED', 'AI_QUESTION_ASKED', 'AI_CHECK_PRINTED_ANYWAY']);
// The AI brief of Today and the calendar: how many patients and their ids (sorted), never what was sent.
const AI_DETAIL_FIELDS = ['patientId', 'mrn', 'visitId', 'feature', 'model', 'inputTokens', 'outputTokens', 'results', 'issues', 'patientIds'];

// via: 'whatsapp' for a PDF saved to send on WhatsApp (never the number); practice: sent in practice mode (nothing left)
const VISIT_DETAIL_FIELDS = ['patientId', 'mrn', 'visitId', 'sections', 'access', 'via', 'warningsOverridden', 'practice'];

// Analytics (Feature 11): which page was opened, and for a patient list the ids of the patients on the page
// (sorted by id), how many and which page – never the number, cell, label or period they came from. The
// platform never gets the ids.
export const ANALYTICS_ACTIONS = new Set(['ANALYTICS_VIEWED', 'ANALYTICS_LIST_VIEWED']);
export const ANALYTICS_DETAIL_FIELDS = {
  tenant: ['section', 'scope', 'hospital', 'patientIds', 'count', 'page'],
  platform: ['section', 'scope', 'hospital', 'count', 'page'],
};

const only = (details, fields) => Object.fromEntries(fields.filter((k) => details[k] !== undefined).map((k) => [k, details[k]]));

// The super admin runs the platform, not a hospital's patients: the platform audit log and the platform
// Overview's "Recent activity" never show which patient an entry was about, for every kind of event (older
// entries included). From a patient event only these plain words are kept – never a record number, the id of a
// patient, visit, care plan, plan item, consent or note, a type of care, a doctor's id, or typed text (the
// emergency-note reason). This is an allowlist, so a new patient key stays hidden until it is added here.
// The hospital's own admin still sees the ids in the hospital's audit log.
const PATIENT_EVENT_ACTIONS = new Set(AUDIT_CATEGORIES.patients);
const PLATFORM_PATIENT_EVENT_FIELDS = ['access', 'fields', 'sections', 'change', 'copy', 'via', 'sensitive'];
// Patient events with their own platform fields. RISK_RECALCULATED is about a care-plan template (its name,
// version and how many patients were checked), never about one patient.
// ANALYTICS_LIST_VIEWED, the AI events, WORKLIST_VIEWED and INPATIENTS_VIEWED are patient events: without their
// own fields the allowlist above would drop them all.
const PLATFORM_FIELDS_BY_ACTION = {
  RISK_RECALCULATED: ['templateId', 'name', 'version', 'checked', 'changed', 'skipped'],
  ANALYTICS_VIEWED: ANALYTICS_DETAIL_FIELDS.platform,
  ANALYTICS_LIST_VIEWED: ANALYTICS_DETAIL_FIELDS.platform,
  // Smart features: which AI feature, the model and counts; the worklist's counts – never a patient.
  AI_USED: ['feature', 'model', 'inputTokens', 'outputTokens'],
  AI_QUESTION_ASKED: ['feature', 'results'],
  AI_CHECK_PRINTED_ANYWAY: ['issues'],
  WORKLIST_VIEWED: ['scope', 'redFlags', 'carePlan', 'seenToday', 'vaccinations'],
  // The "In hospital" list: how many patients were listed and how many of them had red flags – never a patient.
  INPATIENTS_VIEWED: ['admitted', 'flagged'],
  // Duplicate records: counts only – never which records
  PATIENT_REGISTERED_ANYWAY: ['matches'],
  PATIENT_MARKED_DUPLICATE: ['appointmentsMoved'],
  PATIENT_DUPLICATE_UNDONE: ['appointmentsMoved'],
  // A record closed or reopened: counts only – never which record
  PATIENT_RECORD_CLOSED: ['appointmentsCancelled', 'messagesCancelled', 'portalEnded'],
  PATIENT_RECORD_REOPENED: [],
  // ABDM M2: counts and plain words only – never which record or consent
  ...Object.fromEntries([...ABDM_SHARE_ACTIONS].map((a) => [a, ABDM_SHARE_PLATFORM_FIELDS])),
  // ABDM M3: counts and plain words only – never which record, request or consent
  ...Object.fromEntries([...ABDM_FETCH_ACTIONS].map((a) => [a, ABDM_FETCH_PLATFORM_FIELDS])),
};
// A second guard for staff, hospital, template and form events (not `reason`: a failed sign-in needs it).
const PLATFORM_HIDDEN_KEYS = ['mrn', 'orderId', 'fileId', 'entryId', 'patientId', 'patientIds', 'careType', 'planId', 'visitId', 'noteId', 'itemId', 'consentId', 'mainPatientId', 'mainMrn', 'matchIds'];
const withoutPatientKeys = (details) => Object.fromEntries(Object.entries(details).filter(([k]) => !PLATFORM_HIDDEN_KEYS.includes(k)));

function platformDetails(action, shown) {
  if (PLATFORM_FIELDS_BY_ACTION[action]) return only(shown, PLATFORM_FIELDS_BY_ACTION[action]);
  if (PATIENT_EVENT_ACTIONS.has(action)) return only(shown, PLATFORM_PATIENT_EVENT_FIELDS);
  return withoutPatientKeys(shown);
}

function trimmedByAction(action, details) {
  if (RISK_ACTIONS.has(action)) return only(details, RISK_DETAIL_FIELDS);
  if (CARE_PLAN_ACTIONS.has(action)) return only(details, CARE_PLAN_DETAIL_FIELDS);
  if (CONSENT_ACTIONS.has(action)) return only(details, CONSENT_DETAIL_FIELDS);
  if (VISIT_ACTIONS.has(action)) return only(details, VISIT_DETAIL_FIELDS);
  if (INPATIENT_ACTIONS.has(action)) return only(details, INPATIENT_DETAIL_FIELDS);
  if (AI_ACTIONS.has(action)) return only(details, AI_DETAIL_FIELDS);
  if (LAB_ACTIONS.has(action)) return only(details, LAB_DETAIL_FIELDS);
  if (REGISTER_ACTIONS.has(action)) return only(details, REGISTER_DETAIL_FIELDS);
  if (BILLING_EXTRA_ACTIONS.has(action)) return only(details, BILLING_EXTRA_DETAIL_FIELDS);
  if (ANALYTICS_ACTIONS.has(action)) return only(details, ANALYTICS_DETAIL_FIELDS.tenant);
  if (DUPLICATE_ACTIONS.has(action)) return only(details, DUPLICATE_DETAIL_FIELDS);
  if (CLOSED_ACTIONS.has(action)) return only(details, CLOSED_DETAIL_FIELDS);
  if (RECORD_COPY_ACTIONS.has(action)) return only(details, RECORD_COPY_DETAIL_FIELDS);
  if (HOSPITAL_EXPORT_ACTIONS.has(action)) return only(details, HOSPITAL_EXPORT_DETAIL_FIELDS);
  if (ABDM_SHARE_ACTIONS.has(action)) return only(details, ABDM_SHARE_DETAIL_FIELDS);
  if (ABDM_FETCH_ACTIONS.has(action)) return only(details, ABDM_FETCH_DETAIL_FIELDS);
  return details;
}

const SCOPES = ['tenant', 'platform'];

/**
 * The details of an entry with this action that may be shown.
 * scope: 'tenant' (a hospital admin's audit log, the default) or 'platform' (the super admin's readers, which
 * keep only plain words from a patient event and lose every patient key from the others).
 */
export function safeAuditDetails(action, details, { scope = 'tenant' } = {}) {
  if (!details || typeof details !== 'object') return details;
  const shown = trimmedByAction(action, details);
  return scope === 'platform' ? platformDetails(action, shown) : shown;
}

/**
 * An audit entry as sent to the browser: trimmed details, and the hospital's name (names: id → name).
 * Every reader must say which audit log it is ({ scope: 'tenant' | 'platform' }), so a new reader can't
 * show patient numbers to the super admin by leaving it out.
 */
export function auditEntryJSON(entry, names, { scope } = {}) {
  if (!SCOPES.includes(scope)) throw new Error(`auditEntryJSON needs scope 'tenant' or 'platform', got ${scope}`);
  const json = entry.toJSON();
  return {
    ...json,
    details: safeAuditDetails(json.action, json.details, { scope }),
    tenantName: entry.tenantId ? (names.get(entry.tenantId.toString()) ?? null) : null,
  };
}

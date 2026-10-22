import { Archive, BadgeCheck, Building2, ChartColumn, Download, FileDown, FileText, Files, Link2, LogIn, LogOut, MessageCircle, Printer, Send, Trash2 } from 'lucide-react';
import { formatNumber } from './DataTable.jsx';
import { formatDate, rolesLabel } from './ui.jsx';
import { monthWords } from '../pages/analytics/analyticsFormat.js';

// AI features named in the audit log (Smart features 4–9).
const AI_FEATURES = {
  visit_summary: 'visit summary',
  translate_advice: 'advice translated',
  letter_referral: 'referral letter drafted',
  letter_discharge: 'discharge summary drafted',
  letter_fitness: 'fitness note drafted',
  risk_suggestions: 'typed notes checked for risk factors',
  read_report: 'report read',
  ask_records: 'question about the records',
  dictation: 'dictation written down',
  understand_dictation: 'dictation parts placed',
  prescription_check: 'prescription checked before printing',
  brief_today: 'brief of the Today page',
  brief_calendar: 'brief of the calendar',
  brief_patient: 'brief of the patient page',
};

// Plain-English names for audit log events.
// What she opened in the portal (PORTAL_RECORDS_VIEWED)
const PORTAL_RECORD_WORDS = { prescriptions: 'prescriptions', lab: 'lab reports', visits: 'visits', bills: 'bills', summary: 'her Home page summary', appointments: 'appointments', profile: 'profile', scans: 'scan reports' };
// Her profile (19 Oct 2026): which details – never the values
const PORTAL_PROFILE_WORDS = { address: 'address', city: 'city', state: 'state', pinCode: 'PIN code', emergencyContact: 'emergency contact', fullName: 'name', ageYears: 'age', phone: 'mobile', email: 'email' };
const profileFields = (d) => (d.fields ?? []).map((f) => PORTAL_PROFILE_WORDS[f] ?? f).join(', ');
// How she signed in with her own account, and why a sign-in failed (PORTAL_LOGIN_SUCCESS / _FAILED)
const LOGIN_METHOD_WORDS = { password: 'with email and password', otp: 'with mobile and OTP' };
const PORTAL_FAIL_WORDS = { unknown_email: 'Email not signed up', wrong_password: 'Wrong password', wrong_otp: 'Wrong OTP', otp_expired: 'OTP expired or not asked for' };

export const AUDIT_LABELS = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  LOGIN_LOCKED: 'Sign-in locked for 2 minutes (3 wrong tries)',
  LOGIN_RATE_LIMITED: 'Too many sign-in attempts',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGED: 'Changed password',
  USER_CREATED: 'Account created',
  USER_UPDATED: 'Account edited',
  ROLE_CHANGED: 'Role changed (earlier format)',
  USER_ACTIVATED: 'Account reactivated',
  USER_DEACTIVATED: 'Account deactivated',
  PASSWORD_RESET: 'Password reset',
  SUPER_ADMIN_GRANTED: 'Made super admin',
  SUPER_ADMIN_REVOKED: 'Super admin removed',
  PLATFORM_ADMIN_CHANGED: 'Platform admin rights changed',
  LINKED_ACCOUNT_CHANGED: 'Linked doctor account changed',
  ACCOUNT_SWITCHED: 'Switched between super admin and own doctor account',
  LIST_EXPORTED: 'List exported (CSV)',
  ROLE_MODE_SWITCHED: 'Switched between clinical work and admin',
  TENANT_CREATED: 'Hospital created',
  TENANT_UPDATED: 'Hospital renamed',
  TENANT_ACTIVATED: 'Hospital reactivated',
  TENANT_DEACTIVATED: 'Hospital deactivated',
  TENANT_SWITCHED: 'Switched hospital',
  MEMBER_ADDED: 'Added to hospital',
  MEMBER_ROLE_CHANGED: 'Role changed',
  MEMBER_ACTIVATED: 'Hospital access restored',
  MEMBER_DEACTIVATED: 'Hospital access removed',
  PATIENT_CREATED: 'Patient added',
  PATIENT_REGISTERED_ANYWAY: 'Registered as new although a record matched',
  PATIENT_MARKED_DUPLICATE: 'Record marked as a duplicate',
  PATIENT_DUPLICATE_UNDONE: 'Duplicate marking undone',
  // A record closed by a doctor (a death was recorded on it) – the log never says which record, or why
  PATIENT_RECORD_CLOSED: 'Record closed by a doctor',
  PATIENT_RECORD_REOPENED: 'Closed record reopened (recorded in error)',
  PATIENT_VIEWED: 'Patient record viewed',
  PATIENT_RECORD_COPIED: 'Full record copied',
  PATIENT_RECORD_COPY_PRINTED: 'Copy of the whole record printed',
  PATIENT_RECORD_COPY_PDF_SAVED: 'Copy of the whole record saved as PDF',
  PATIENT_ARRIVED: 'Patient marked arrived',
  PATIENT_ARRIVAL_UNDONE: 'Arrival undone',
  APPOINTMENT_BOOKED: 'Appointment booked',
  APPOINTMENT_MOVED: 'Appointment moved',
  APPOINTMENT_CANCELLED: 'Appointment cancelled',
  APPOINTMENT_LINKED: 'Quick booking linked to a record',
  APPOINTMENT_DONE: 'Checkup marked done',
  TOKEN_GIVEN: 'Walk-in token given',
  OPD_TIMINGS_CHANGED: 'OPD timings changed',
  BEDS_ADDED: 'Beds added',
  BED_UPDATED: 'Bed changed',
  PATIENT_CARD_PRINTED: 'Patient card printed',
  // Billing
  BILL_VIEWED: 'Bill opened',
  BILL_ITEM_ADDED: 'Item added to a bill',
  BILL_ITEM_REMOVED: 'Item taken off a bill',
  DISCOUNT_GIVEN: 'Discount given or taken off',
  PAYMENT_RECEIVED: 'Payment received',
  REFUND_GIVEN: 'Refund given',
  PAYMENT_CORRECTED: 'Payment corrected',
  BILL_CANCELLED: 'Bill cancelled',
  BILL_PRINTED: 'Bill or receipt printed',
  PRICE_LIST_CHANGED: 'Price list changed',
  BILLING_EXPORTED: 'Billing export downloaded',
  // Pharmacy
  PHARMACY_SETTINGS_CHANGED: 'Pharmacy settings saved',
  PHARMACY_MEDICINE_CHANGED: 'Medicine list changed',
  PHARMACY_SUPPLIER_CHANGED: 'Supplier list changed',
  PHARMACY_PURCHASE_ENTERED: 'Purchase entered',
  PHARMACY_PURCHASE_CANCELLED: 'Purchase cancelled',
  PHARMACY_STOCK_WRITTEN_OFF: 'Stock written off',
  PHARMACY_STOCK_COUNTED: 'Stock count corrected',
  PHARMACY_PRESCRIPTIONS_VIEWED: "Patient's prescriptions opened in the pharmacy",
  PHARMACY_SOLD: 'Medicines sold at the counter',
  PHARMACY_ISSUED: 'Medicines issued to an admitted patient',
  PHARMACY_INVOICE_VIEWED: 'Pharmacy invoice opened',
  PHARMACY_RETURNED: 'Medicines returned to the pharmacy',
  PHARMACY_PRINTED: 'Pharmacy invoice or credit note printed',
  PHARMACY_REGISTER_VIEWED: 'Pharmacy register opened',
  PHARMACY_EXPORTED: 'Pharmacy export downloaded',
  TENANT_SETTINGS_UPDATED: 'Letterhead changed',
  PROFILE_UPDATED: 'Professional details changed',
  PATIENT_UPDATED: 'Patient details changed',
  PATIENT_ASSIGNED: 'Patient doctor changed',
  PATIENT_SENSITIVITY_CHANGED: 'Sensitive marking changed',
  EMERGENCY_NOTE_ADDED: 'Emergency note added',
  TEMPLATE_CREATED: 'Care-plan template created',
  TEMPLATE_UPDATED: 'Care-plan template changed',
  TEMPLATE_APPROVED: 'Care-plan template approved',
  TEMPLATE_DEFAULT_SET: "Protocol made a doctor's default",
  TEMPLATE_DEFAULT_REMOVED: "Protocol no longer a doctor's default",
  PATIENT_RISK_CHANGED: 'Risk level changed',
  RISK_OVERRIDDEN: 'Risk level overridden',
  RISK_OVERRIDE_REMOVED: 'Risk override removed',
  RISK_RECALCULATED: 'Risk levels recalculated',
  CARE_PLAN_CREATED: 'Care plan created',
  CARE_PLAN_VIEWED: 'Care plan viewed',
  CARE_PLAN_CHANGED: 'Care plan changed',
  CARE_PLAN_PRINTED: 'Care plan printed',
  CONSENT_FORM_CREATED: 'Consent form created',
  CONSENT_FORM_UPDATED: 'Consent form changed',
  CONSENT_FORM_APPROVED: 'Consent form approved',
  CONSENT_FORM_ACTIVATED: 'Consent form in use again',
  CONSENT_FORM_DEACTIVATED: 'Consent form no longer used',
  CONSENTS_VIEWED: 'Consent forms viewed',
  CONSENT_FORM_PRINTED: 'Consent form printed',
  CONSENT_SIGNED_RECORDED: 'Signed consent recorded',
  CONSENT_SCAN_ADDED: 'Scan of a signed consent attached',
  CONSENT_SCAN_OPENED: 'Scan of a signed consent opened',
  VISITS_VIEWED: 'Visits viewed',
  VISIT_VIEWED: 'Visit viewed',
  VISIT_CREATED: 'Visit started',
  VISIT_UPDATED: 'Visit updated',
  VISIT_CANCELLED: 'Visit marked entered in error',
  VISIT_SIGNED: 'Visit signed and finished',
  ADMISSIONS_VIEWED: 'Stays viewed',
  ADMISSION_VIEWED: 'Stay opened',
  ADMISSION_CREATED: 'Patient admitted',
  ADMISSION_UPDATED: 'Ward or bed changed',
  ADMISSION_BED_CHANGED: 'Moved to another bed',
  BEDS_VIEWED: 'Bed board viewed',
  DISCHARGES_VIEWED: 'Discharges viewed (Today)',
  PATIENT_DISCHARGED: 'Patient discharged',
  DOCUMENT_CREATED: 'Inpatient document started',
  DOCUMENT_VIEWED: 'Inpatient document opened',
  DOCUMENT_UPDATED: 'Inpatient document saved',
  DOCUMENT_SIGNED: 'Inpatient document signed',
  DOCUMENT_ADDITION_ADDED: 'Correction added to a document',
  DOCUMENT_CANCELLED: 'Document marked entered in error',
  DOCUMENT_PRINTED: 'Inpatient document printed',
  NURSING_ENTRY_ADDED: 'Nursing chart entry added',
  NURSING_ENTRY_CANCELLED: 'Nursing chart entry marked entered in error',
  VISIT_ADDITION_ADDED: 'Correction added to a signed visit',
  PRESCRIPTION_UPDATED: 'Prescription saved',
  PRESCRIPTION_PRINTED: 'Prescription printed',
  PRESCRIPTION_PDF_SAVED: 'Prescription saved as PDF',
  VISIT_SUMMARY_PRINTED: 'Visit summary printed',
  VISIT_SUMMARY_PDF_SAVED: 'Visit summary saved as PDF',
  PRESCRIPTION_SENT_WHATSAPP: 'Prescription sent to the patient on WhatsApp',
  VISIT_SUMMARY_SENT_WHATSAPP: 'Visit summary sent to the patient on WhatsApp',
  PRESCRIPTION_SET_CREATED: 'Prescription set created',
  LAB_PACKAGE_CREATED: 'Test package created',
  LAB_PACKAGE_UPDATED: 'Test package changed',
  LAB_PACKAGE_APPROVED: 'Test package approved',
  LAB_PACKAGE_ACTIVATED: 'Test package in use again',
  LAB_PACKAGE_DEACTIVATED: 'Test package no longer used',
  PRESCRIPTION_SET_UPDATED: 'Prescription set changed',
  PRESCRIPTION_SET_APPROVED: 'Prescription set approved',
  PRESCRIPTION_SET_ACTIVATED: 'Prescription set in use again',
  PRESCRIPTION_SET_DEACTIVATED: 'Prescription set no longer used',
  RED_FLAG_RULES_UPDATED: 'Red-flag rules changed',
  RED_FLAG_RULES_APPROVED: 'Red-flag rules approved',
  WORKLIST_VIEWED: 'Worklist viewed',
  INPATIENTS_VIEWED: 'In hospital list viewed',
  MEDICINE_SAFETY_UPDATED: 'Medicine safety list changed',
  MEDICINE_SAFETY_APPROVED: 'Medicine safety list approved',
  REMINDER_PREPARED: 'Reminder prepared for a patient',
  AI_USED: 'AI used on a record',
  AI_QUESTION_ASKED: 'Records searched with AI',
  AI_CHECK_PRINTED_ANYWAY: 'Printed without the changes the AI check suggested',
  ANALYTICS_VIEWED: 'Analytics opened',
  ANALYTICS_LIST_VIEWED: 'Patient list opened from Analytics',
  LAB_ORDER_CREATED: 'Lab tests ordered',
  LAB_ORDER_VIEWED: 'Lab order opened',
  LAB_RESULTS_VIEWED: "Patient's lab results opened",
  LAB_SAMPLE_COLLECTED: 'Lab sample taken',
  LAB_SAMPLE_RECEIVED: 'Lab sample received in the lab',
  LAB_RESULTS_SAVED: 'Lab results saved (not reported)',
  LAB_RESULTS_REPORTED: 'Lab results reported',
  LAB_RESULTS_AMENDED: 'Lab results changed after the report',
  LAB_REPORT_UPLOADED: 'Lab report file attached',
  LAB_REPORT_OPENED: 'Lab report file opened',
  LAB_RESULTS_REVIEWED: 'Lab results reviewed by a doctor',
  LAB_ORDER_CANCELLED: 'Lab order cancelled',
  // Referrals from other doctors (docs/REFERRALS_PLAN.md): ids, the record number and which part – never what was written
  REFERRAL_CREATED: 'Referral logged',
  REFERRAL_VIEWED: 'Referral opened',
  REFERRAL_UPDATED: 'Referral details changed',
  REFERRAL_LINKED: 'Referral linked to a patient record',
  REFERRAL_BOOKED: 'Appointment booked for a referral',
  REFERRAL_ATTACHMENT_ADDED: "Referring doctor's note or report attached",
  REFERRAL_ATTACHMENT_OPENED: "Referring doctor's note or report opened",
  REFERRAL_SHARING_ANSWERED: 'Her answer on sharing with the referring doctor recorded',
  REFERRAL_NOTE_SAVED: 'Consultant note saved',
  REFERRAL_NOTE_SIGNED: 'Consultant note signed',
  REFERRAL_NOTE_ADDITION_ADDED: 'Addition to a signed consultant note',
  REFERRAL_PDF_RELEASED: 'PDF released to the referral desk',
  REFERRAL_PDF_OPENED: 'Released PDF opened',
  REFERRAL_MESSAGE_SENT: 'Message to a referring doctor marked sent',
  REFERRAL_REVIEW_ADDED: 'Weekly review note on a missed promise',
  REFERRAL_CLOSED: 'Referral closed',
  REFERRAL_CANCELLED: 'Referral cancelled',
  REFERRING_DOCTOR_ADDED: 'Referring doctor added',
  REFERRING_DOCTOR_UPDATED: "Referring doctor's details changed",
  REFERRAL_SUMMARY_VIEWED: "Referring doctor's quarterly summary opened",
  REFERRAL_SETTINGS_CHANGED: 'Referral settings changed',
  LAB_HOME_COLLECTION: 'Lab home collection updated',
  LAB_REPORT_VERIFIED: 'Lab report checked with its QR code',
  IMAGING_ORDERED: 'Scan ordered',
  IMAGING_VIEWED: 'Scan opened',
  IMAGING_SCHEDULED: 'Scan scheduled',
  IMAGING_DONE: 'Scan done',
  IMAGING_SAVED: 'Scan report saved',
  IMAGING_AMENDED: 'Scan report changed after signing',
  IMAGING_SIGNED: 'Scan report signed',
  IMAGING_CANCELLED: 'Scan cancelled',
  IMAGING_PRINTED: 'Scan report printed',
  LAB_REFERRER_CHANGED: 'Lab referrer added or changed',
  LAB_QC_LOT_CHANGED: 'QC lot added or changed',
  LAB_QC_RUN: 'QC run entered',
  LAB_QC_ACTION: 'QC corrective action written',
  LAB_STOCK_CHANGED: 'Lab stock changed',
  ADMISSION_REQUESTED: 'Admission requested by a doctor',
  ADMISSION_REQUEST_CANCELLED: 'Admission request cancelled',
  ADMISSION_CHECKLIST_UPDATED: 'Admission checklist filled in',
  ADMISSION_FORM_PRINTED: 'Admission form printed',
  WRISTBAND_PRINTED: 'Wristband printed',
  DISCHARGE_CLEARED: 'Cleared for leaving (gate pass)',
  GATE_PASS_PRINTED: 'Gate pass printed',
  OPD_CASE_PAPER_PRINTED: 'OPD case paper printed',
  ADMISSION_RULES_CHANGED: 'Admission rules changed',
  QUEUE_TIME_SENT: 'Queue time sent on WhatsApp',
  BILL_SENT_WHATSAPP: 'Bill sent on WhatsApp',
  LAB_REPORT_SENT_WHATSAPP: 'Lab report sent on WhatsApp',
  CASH_HANDED_OVER: 'Cash handed over',
  CASH_HANDOVER_CONFIRMED: 'Cash handover confirmed',
  LAB_LABELS_PRINTED: 'Lab sample labels printed',
  LAB_SAMPLE_REJECTED: 'Lab sample rejected',
  LAB_RESULTS_ENTERED: 'Lab results entered (to check)',
  LAB_RESULTS_VERIFIED: 'Lab results checked and reported',
  LAB_RESULTS_SENT_BACK: 'Lab results sent back by the checker',
  LAB_SENT_OUTSIDE: 'Lab tests sent to an outside lab',
  LAB_OUTSIDE_RECEIVED: 'Lab tests back from an outside lab',
  LAB_REPORT_PRINTED: 'Lab report printed',
  LAB_ORDERS_SEARCHED: 'Lab orders searched',
  LAB_REGISTER_VIEWED: 'Lab register opened',
  LAB_TEST_CREATED: 'Lab test added to the test list',
  LAB_TEST_UPDATED: 'Lab test changed',
  LAB_TEST_APPROVED: 'Lab test ranges approved',
  LAB_SETTINGS_CHANGED: 'Lab settings changed',
  WORK_DONE_VIEWED: "Patient's scans and procedures opened",
  WORK_DONE_RECORDED: 'Scan or procedure recorded as done',
  WORK_DONE_CANCELLED: 'Scan or procedure cancelled',
  // Registers removed 2 Oct 2026 – kept so old entries still display.
  REGISTER_ENTRY_CREATED: 'Register entry started',
  REGISTER_ENTRY_VIEWED: 'Register entry opened',
  REGISTER_ENTRY_SAVED: 'Register entry saved',
  REGISTER_ENTRY_SIGNED: 'Register entry signed',
  REGISTER_ENTRY_CANCELLED: 'Register entry cancelled',
  REGISTER_LIST_VIEWED: 'Register opened',
  REGISTER_PRINTED: 'Register entry printed',
  REGISTER_SCAN_ADDED: 'Scan of a register form attached',
  REGISTER_SCAN_OPENED: 'Scan of a register form opened',
  REPORT_VIEWED: 'Monthly report opened',
  PATIENT_REMINDERS_CHANGED: 'Reminder choice recorded for a patient',
  REMINDER_SENT_BY_HAND: 'Reminder sent by hand',
  REMINDERS_RUN: 'Reminders sent now',
  PORTAL_ACCESS_CREATED: 'Patient portal code made',
  PORTAL_ACCESS_REVOKED: 'Patient portal access withdrawn',
  PORTAL_LOGIN_SUCCESS: 'Patient signed in to the portal',
  PORTAL_LOGIN_FAILED: 'Failed patient portal sign-in',
  PORTAL_VIEWED: 'Patient viewed the portal',
  PORTAL_APPOINTMENT_BOOKED: 'Patient booked an appointment in the portal',
  PORTAL_APPOINTMENT_CANCELLED: 'Patient cancelled her appointment in the portal',
  PORTAL_SIGNUP_RECEIVED: 'Patient signed up online',
  PORTAL_SIGNUP_APPROVED: "Patient's online sign-up approved",
  PORTAL_SIGNUP_REJECTED: "Patient's online sign-up rejected",
  PORTAL_PASSWORD_CHANGED: 'Patient changed her portal password',
  PORTAL_RECORDS_VIEWED: 'Patient viewed her records in the portal',
  PORTAL_PROFILE_UPDATED: 'Patient changed her contact details in the portal',
  PORTAL_CHANGE_REQUESTED: 'Patient asked to change her name, age, mobile or email',
  PORTAL_CHANGE_APPROVED: "Patient's change request approved",
  PORTAL_CHANGE_REJECTED: "Patient's change request rejected",
  KEEPSAKE_CARD_PRINTED: 'Baby keepsake card printed',
  // Pharmacy extras (4 Oct 2026)
  PHARMACY_ORDER_CREATED: 'Purchase order made',
  PHARMACY_ORDER_CHANGED: 'Purchase order changed',
  PHARMACY_ORDER_SENT: 'Purchase order marked as sent',
  PHARMACY_ORDER_RECEIVED: 'Purchase received against an order',
  PHARMACY_ORDER_CLOSED: 'Purchase order closed',
  PHARMACY_ORDER_CANCELLED: 'Purchase order cancelled',
  PHARMACY_ORDER_PRINTED: 'Purchase order printed',
  PHARMACY_SUPPLIER_RETURNED: 'Stock returned to a supplier',
  PHARMACY_SUPPLIER_RETURN_CANCELLED: 'Return to a supplier cancelled',
  PHARMACY_DEBIT_NOTE_PRINTED: 'Debit note printed',
  PHARMACY_EINVOICE_DOWNLOADED: 'E-invoice file downloaded',
  // The Tally link (16 Oct 2026)
  TALLY_SETTINGS_CHANGED: 'Tally account names changed',
  TALLY_BATCH_CREATED: 'Tally batch prepared',
  TALLY_FILE_DOWNLOADED: 'Tally file downloaded',
  TALLY_VOUCHER_STATUS: 'Tally entry status changed',
  // Billing extras (4 Oct 2026)
  BILL_INSURANCE_CHANGED: 'Insurance details of a bill changed',
  CLAIM_FORM_PRINTED: 'Claim form printed',
  UPI_LINK_MADE: 'UPI payment link made',
  BILLING_SETTINGS_CHANGED: 'Billing settings changed',
  // The whole hospital's data written to a folder by the person who runs the server (a command, never a web page)
  HOSPITAL_DATA_EXPORTED: 'Hospital data exported by the server operator',
  // ABDM (ABHA) – M1: her ABHA and Scan & Share
  ABHA_VERIFIED: 'ABHA verified by OTP',
  ABHA_LINKED: 'ABHA linked to a record',
  ABHA_CREATED: 'ABHA created at the desk',
  ABHA_UNLINKED: 'ABHA unlinked from a record',
  ABHA_VIEWED: 'ABHA details opened',
  ABHA_CARD_PRINTED: 'ABHA card printed',
  ABDM_SCAN_SHARE_RECEIVED: 'Scan & Share received',
  ABDM_SCAN_SHARE_HANDLED: 'Scan & Share put aside',
  ABDM_SETTINGS_CHANGED: 'ABDM settings changed',
  // ABDM – M2: her records through her ABHA (ids, counts and the consent id – never what was sent)
  ABDM_RECORDS_VIEWED: 'Records linked to her ABHA opened',
  ABDM_RECORDS_LINKED: 'Records linked to her ABHA',
  ABDM_RECORDS_DISCOVERED: 'Her ABHA app looked for her records',
  ABDM_CONSENT_RECEIVED: 'Consent from her ABHA app received',
  ABDM_RECORDS_SHARED: 'Records sent through ABDM',
  ABDM_SHARE_REFUSED: 'Request for her records refused',
  // ABDM – M3: her records from other hospitals (ids and counts – never which hospital or what the records say)
  ABDM_FETCH_REQUESTED: 'Her records asked for from other hospitals',
  ABDM_FETCH_ANSWERED: 'Her answer to a request for her records',
  ABDM_RECORDS_FETCHED: 'Records received from another hospital',
  ABDM_FETCHED_VIEWED: 'Records from other hospitals opened',
  ABDM_FETCHED_DELETED: 'Records from other hospitals deleted',
};

// How much attention an event needs (older grouping, still used by some screens).
// Registers removed 2 Oct 2026 – kept so old entries still display.
const REGISTER_WORDS = { form_f: 'Form F (PC-PNDT)', mtp: 'MTP register', mtp_summary: 'MTP monthly report' };

export const AUDIT_TONES = {
  LOGIN_FAILED: 'warn',
  LOGIN_LOCKED: 'danger',
  LOGIN_RATE_LIMITED: 'danger',
  USER_DEACTIVATED: 'warn',
  TENANT_DEACTIVATED: 'warn',
  MEMBER_DEACTIVATED: 'warn',
  SUPER_ADMIN_GRANTED: 'info',
  SUPER_ADMIN_REVOKED: 'info',
  PLATFORM_ADMIN_CHANGED: 'info',
  MEMBER_ROLE_CHANGED: 'info',
  PASSWORD_RESET: 'info',
  PATIENT_VIEWED: 'patient',
  PATIENT_RECORD_COPIED: 'patient',
  PATIENT_RECORD_COPY_PRINTED: 'patient',
  PATIENT_RECORD_COPY_PDF_SAVED: 'patient',
  PATIENT_ARRIVED: 'patient',
  PATIENT_ARRIVAL_UNDONE: 'patient',
  APPOINTMENT_BOOKED: 'patient',
  APPOINTMENT_MOVED: 'patient',
  APPOINTMENT_CANCELLED: 'patient',
  APPOINTMENT_LINKED: 'patient',
  APPOINTMENT_DONE: 'patient',
  TOKEN_GIVEN: 'patient',
  PATIENT_CARD_PRINTED: 'patient',
  PATIENT_CREATED: 'patient',
  PATIENT_REGISTERED_ANYWAY: 'info',
  PATIENT_MARKED_DUPLICATE: 'info',
  PATIENT_DUPLICATE_UNDONE: 'info',
  PATIENT_RECORD_CLOSED: 'info',
  PATIENT_RECORD_REOPENED: 'info',
  PATIENT_UPDATED: 'patient',
  PATIENT_ASSIGNED: 'patient',
  PATIENT_SENSITIVITY_CHANGED: 'info',
  EMERGENCY_NOTE_ADDED: 'danger',
  TEMPLATE_APPROVED: 'info',
  PATIENT_RISK_CHANGED: 'warn',
  RISK_OVERRIDDEN: 'danger',
  RISK_OVERRIDE_REMOVED: 'info',
  CARE_PLAN_CREATED: 'patient',
  CARE_PLAN_VIEWED: 'patient',
  CARE_PLAN_CHANGED: 'patient',
  CARE_PLAN_PRINTED: 'patient',
  CONSENTS_VIEWED: 'patient',
  CONSENT_FORM_PRINTED: 'patient',
  CONSENT_SIGNED_RECORDED: 'patient',
  CONSENT_SCAN_ADDED: 'patient',
  CONSENT_SCAN_OPENED: 'patient',
  CONSENT_FORM_APPROVED: 'info',
  PRESCRIPTION_SET_APPROVED: 'info',
  LAB_PACKAGE_APPROVED: 'info',
  VISITS_VIEWED: 'patient',
  VISIT_VIEWED: 'patient',
  VISIT_CREATED: 'patient',
  VISIT_UPDATED: 'patient',
  VISIT_CANCELLED: 'info',
  VISIT_SIGNED: 'patient',
  ADMISSIONS_VIEWED: 'patient',
  ADMISSION_VIEWED: 'patient',
  ADMISSION_CREATED: 'patient',
  ADMISSION_UPDATED: 'patient',
  ADMISSION_BED_CHANGED: 'patient',
  BEDS_VIEWED: 'patient',
  DISCHARGES_VIEWED: 'patient',
  PATIENT_DISCHARGED: 'patient',
  DOCUMENT_CREATED: 'patient',
  DOCUMENT_VIEWED: 'patient',
  DOCUMENT_UPDATED: 'patient',
  DOCUMENT_SIGNED: 'patient',
  DOCUMENT_ADDITION_ADDED: 'patient',
  DOCUMENT_CANCELLED: 'patient',
  DOCUMENT_PRINTED: 'patient',
  NURSING_ENTRY_ADDED: 'patient',
  NURSING_ENTRY_CANCELLED: 'patient',
  VISIT_ADDITION_ADDED: 'patient',
  PRESCRIPTION_UPDATED: 'patient',
  PRESCRIPTION_PRINTED: 'patient',
  PRESCRIPTION_PDF_SAVED: 'patient',
  PRESCRIPTION_SENT_WHATSAPP: 'patient',
  VISIT_SUMMARY_SENT_WHATSAPP: 'patient',
  VISIT_SUMMARY_PRINTED: 'patient',
  VISIT_SUMMARY_PDF_SAVED: 'patient',
  WORKLIST_VIEWED: 'patient',
  INPATIENTS_VIEWED: 'patient',
  LAB_ORDER_CREATED: 'patient',
  LAB_ORDER_VIEWED: 'patient',
  LAB_RESULTS_VIEWED: 'patient',
  LAB_SAMPLE_COLLECTED: 'patient',
  LAB_SAMPLE_RECEIVED: 'patient',
  LAB_RESULTS_SAVED: 'patient',
  LAB_RESULTS_REPORTED: 'patient',
  LAB_RESULTS_AMENDED: 'patient',
  LAB_REPORT_UPLOADED: 'patient',
  LAB_REPORT_OPENED: 'patient',
  LAB_RESULTS_REVIEWED: 'patient',
  LAB_ORDER_CANCELLED: 'patient',
  REFERRAL_CREATED: 'patient',
  REFERRAL_VIEWED: 'patient',
  REFERRAL_UPDATED: 'patient',
  REFERRAL_LINKED: 'patient',
  REFERRAL_BOOKED: 'patient',
  REFERRAL_ATTACHMENT_ADDED: 'patient',
  REFERRAL_ATTACHMENT_OPENED: 'patient',
  REFERRAL_SHARING_ANSWERED: 'patient',
  REFERRAL_NOTE_SAVED: 'patient',
  REFERRAL_NOTE_SIGNED: 'patient',
  REFERRAL_NOTE_ADDITION_ADDED: 'patient',
  REFERRAL_PDF_RELEASED: 'patient',
  REFERRAL_PDF_OPENED: 'patient',
  REFERRAL_MESSAGE_SENT: 'patient',
  REFERRAL_REVIEW_ADDED: 'patient',
  REFERRAL_CLOSED: 'patient',
  REFERRAL_CANCELLED: 'patient',
  REFERRAL_SUMMARY_VIEWED: 'patient',
  LAB_HOME_COLLECTION: 'patient',
  LAB_REPORT_VERIFIED: 'info',
  IMAGING_ORDERED: 'patient',
  IMAGING_VIEWED: 'patient',
  IMAGING_SCHEDULED: 'patient',
  IMAGING_DONE: 'patient',
  IMAGING_SAVED: 'patient',
  IMAGING_AMENDED: 'patient',
  IMAGING_SIGNED: 'patient',
  IMAGING_CANCELLED: 'patient',
  IMAGING_PRINTED: 'patient',
  LAB_QC_ACTION: 'info',
  ADMISSION_REQUESTED: 'patient',
  ADMISSION_REQUEST_CANCELLED: 'patient',
  ADMISSION_CHECKLIST_UPDATED: 'patient',
  ADMISSION_FORM_PRINTED: 'patient',
  WRISTBAND_PRINTED: 'patient',
  DISCHARGE_CLEARED: 'patient',
  GATE_PASS_PRINTED: 'patient',
  OPD_CASE_PAPER_PRINTED: 'patient',
  ADMISSION_RULES_CHANGED: 'info',
  QUEUE_TIME_SENT: 'patient',
  BILL_SENT_WHATSAPP: 'patient',
  LAB_REPORT_SENT_WHATSAPP: 'patient',
  CASH_HANDOVER_CONFIRMED: 'info',
  LAB_LABELS_PRINTED: 'patient',
  LAB_SAMPLE_REJECTED: 'patient',
  LAB_RESULTS_ENTERED: 'patient',
  LAB_RESULTS_VERIFIED: 'patient',
  LAB_RESULTS_SENT_BACK: 'patient',
  LAB_SENT_OUTSIDE: 'patient',
  LAB_OUTSIDE_RECEIVED: 'patient',
  LAB_REPORT_PRINTED: 'patient',
  LAB_ORDERS_SEARCHED: 'patient',
  LAB_REGISTER_VIEWED: 'patient',
  LAB_TEST_APPROVED: 'info',
  WORK_DONE_VIEWED: 'patient',
  WORK_DONE_RECORDED: 'patient',
  WORK_DONE_CANCELLED: 'patient',
  REGISTER_ENTRY_CREATED: 'patient',
  REGISTER_ENTRY_VIEWED: 'patient',
  REGISTER_ENTRY_SAVED: 'patient',
  REGISTER_ENTRY_SIGNED: 'patient',
  REGISTER_ENTRY_CANCELLED: 'patient',
  REGISTER_LIST_VIEWED: 'patient',
  REGISTER_PRINTED: 'patient',
  REGISTER_SCAN_ADDED: 'patient',
  REGISTER_SCAN_OPENED: 'patient',
  PATIENT_REMINDERS_CHANGED: 'patient',
  REMINDER_SENT_BY_HAND: 'patient',
  PORTAL_ACCESS_CREATED: 'patient',
  PORTAL_ACCESS_REVOKED: 'patient',
  PORTAL_LOGIN_SUCCESS: 'patient',
  PORTAL_VIEWED: 'patient',
  PORTAL_APPOINTMENT_BOOKED: 'patient',
  PORTAL_APPOINTMENT_CANCELLED: 'patient',
  PORTAL_SIGNUP_RECEIVED: 'patient',
  PORTAL_SIGNUP_APPROVED: 'patient',
  PORTAL_SIGNUP_REJECTED: 'warn',
  PORTAL_PASSWORD_CHANGED: 'patient',
  PORTAL_RECORDS_VIEWED: 'patient',
  PORTAL_PROFILE_UPDATED: 'patient',
  PORTAL_CHANGE_REQUESTED: 'patient',
  PORTAL_CHANGE_APPROVED: 'patient',
  PORTAL_CHANGE_REJECTED: 'patient',
  KEEPSAKE_CARD_PRINTED: 'patient',
  PORTAL_LOGIN_FAILED: 'warn',
  REMINDER_PREPARED: 'patient',
  AI_USED: 'patient',
  AI_QUESTION_ASKED: 'patient',
  AI_CHECK_PRINTED_ANYWAY: 'patient',
  RED_FLAG_RULES_APPROVED: 'info',
  MEDICINE_SAFETY_APPROVED: 'info',
  ABHA_VERIFIED: 'patient',
  ABHA_LINKED: 'patient',
  ABHA_CREATED: 'patient',
  ABHA_UNLINKED: 'patient',
  ABHA_VIEWED: 'patient',
  ABHA_CARD_PRINTED: 'patient',
  ABDM_SCAN_SHARE_RECEIVED: 'patient',
  ABDM_SCAN_SHARE_HANDLED: 'patient',
  ABDM_RECORDS_VIEWED: 'patient',
  ABDM_RECORDS_LINKED: 'patient',
  ABDM_RECORDS_DISCOVERED: 'patient',
  ABDM_CONSENT_RECEIVED: 'patient',
  ABDM_RECORDS_SHARED: 'patient',
  ABDM_SHARE_REFUSED: 'patient',
  ABDM_FETCH_REQUESTED: 'patient',
  ABDM_FETCH_ANSWERED: 'patient',
  ABDM_RECORDS_FETCHED: 'patient',
  ABDM_FETCHED_VIEWED: 'patient',
  ABDM_FETCHED_DELETED: 'patient',
  LOGIN_SUCCESS: 'muted',
  LOGOUT: 'muted',
  TENANT_SWITCHED: 'muted',
};

/*
 * The event as a pill (brand guide: a status is colour + icon + word, and status colours are earned).
 * Its own explicit map, not AUDIT_TONES: only events that need attention get a status colour.
 * Failed security events (failed and blocked sign-ins) and emergency access are "high", deactivations
 * "inactive". Risk events store no level, so they cannot show whether risk went up or down: they are
 * neutral record events, never the high/moderate risk pill. Everything else is a neutral tag – Lavender
 * for super admin and sensitive-record events – with a category icon where it helps scanning.
 * Returns props for <StatusPill>: { tone, icon? }.
 */
const STATUS_EVENTS = {
  LOGIN_FAILED: 'high',
  LOGIN_LOCKED: 'high',
  LOGIN_RATE_LIMITED: 'high',
  EMERGENCY_NOTE_ADDED: 'high',
  USER_DEACTIVATED: 'inactive',
  TENANT_DEACTIVATED: 'inactive',
  MEMBER_DEACTIVATED: 'inactive',
};
const BRAND_EVENTS = new Set(['SUPER_ADMIN_GRANTED', 'SUPER_ADMIN_REVOKED', 'PATIENT_SENSITIVITY_CHANGED', 'HOSPITAL_DATA_EXPORTED']);
const CATEGORY_ICONS = {
  PATIENT_VIEWED: FileText,
  PATIENT_RECORD_COPIED: Files,
  PATIENT_RECORD_COPY_PRINTED: Printer,
  PATIENT_RECORD_COPY_PDF_SAVED: FileDown,
  PATIENT_CREATED: FileText,
  PATIENT_REGISTERED_ANYWAY: FileText,
  PATIENT_MARKED_DUPLICATE: FileText,
  PATIENT_DUPLICATE_UNDONE: FileText,
  PATIENT_RECORD_CLOSED: Archive,
  PATIENT_RECORD_REOPENED: Archive,
  PATIENT_UPDATED: FileText,
  PATIENT_ASSIGNED: FileText,
  PATIENT_RISK_CHANGED: FileText,
  RISK_OVERRIDDEN: FileText,
  RISK_OVERRIDE_REMOVED: FileText,
  CARE_PLAN_CREATED: FileText,
  CARE_PLAN_VIEWED: FileText,
  CARE_PLAN_CHANGED: FileText,
  CARE_PLAN_PRINTED: Printer,
  CONSENTS_VIEWED: FileText,
  CONSENT_FORM_PRINTED: Printer,
  CONSENT_SIGNED_RECORDED: FileText,
  CONSENT_SCAN_ADDED: FileText,
  CONSENT_SCAN_OPENED: FileText,
  VISITS_VIEWED: FileText,
  VISIT_VIEWED: FileText,
  VISIT_CREATED: FileText,
  VISIT_UPDATED: FileText,
  VISIT_SIGNED: BadgeCheck,
  VISIT_ADDITION_ADDED: FileText,
  PRESCRIPTION_UPDATED: FileText,
  PRESCRIPTION_PRINTED: Printer,
  PRESCRIPTION_PDF_SAVED: FileDown,
  VISIT_SUMMARY_PRINTED: Printer,
  VISIT_SUMMARY_PDF_SAVED: FileDown,
  PRESCRIPTION_SENT_WHATSAPP: MessageCircle,
  VISIT_SUMMARY_SENT_WHATSAPP: MessageCircle,
  REFERRAL_MESSAGE_SENT: MessageCircle,
  REFERRAL_LINKED: Link2,
  REFERRAL_NOTE_SIGNED: BadgeCheck,
  REFERRAL_PDF_RELEASED: FileDown,
  LOGIN_SUCCESS: LogIn,
  LOGOUT: LogOut,
  TENANT_SWITCHED: Building2,
  ANALYTICS_VIEWED: ChartColumn,
  ANALYTICS_LIST_VIEWED: FileText,
  REPORT_VIEWED: ChartColumn,
  HOSPITAL_DATA_EXPORTED: FileDown,
  ABHA_LINKED: Link2,
  ABDM_RECORDS_LINKED: Link2,
  ABDM_RECORDS_SHARED: Send,
  ABDM_RECORDS_FETCHED: Download,
  ABDM_FETCHED_DELETED: Trash2,
};

/**
 * Who did it, for the "Done by" column: the person's e-mail address. An event of the person who runs the server (no
 * one signed in) says so instead of "Unknown". null when nobody is known.
 */
const SERVER_OPERATOR_EVENTS = new Set(['HOSPITAL_DATA_EXPORTED']);
export const doneBy = (entry) => entry.actorEmail ?? (SERVER_OPERATOR_EVENTS.has(entry.action) ? 'Server operator' : null);

export function auditPill(action) {
  const status = STATUS_EVENTS[action];
  if (status) return { tone: status };
  return { tone: BRAND_EVENTS.has(action) ? 'brand' : 'neutral', icon: CATEGORY_ICONS[action] ?? null };
}

// Pharmacy extras: numbers and counts only – never a supplier's or a buyer's name, a reason that was typed or a barcode.
const ORDER_STATUS_WORDS = { sent: 'sent', part_received: 'part received', received: 'received', cancelled: 'cancelled', draft: 'draft' };
const ORDER_NOT_COUNTED_WORDS = { cancelled: 'the order was cancelled at the same moment', closed: 'the order was closed at the same moment', busy: 'the order was being changed at the same moment' };
const SUPPLIER_RETURN_WORDS = { expired: 'expired', damaged: 'damaged', recalled: 'recalled', excess: 'excess stock', wrong_item: 'wrong item' };
const rupeesOf = (paise) => `₹${formatNumber(Math.floor((paise ?? 0) / 100))}${(paise ?? 0) % 100 ? `.${String((paise ?? 0) % 100).padStart(2, '0')}` : ''}`;

// Billing extras: the bill's number and the NAMES of the details changed – never an insurer, a number that was typed,
// an amount or a link. The super admin's log holds no bill number ("A bill").
const INSURANCE_FIELD_WORDS = { insurer: 'insurer', policyNumber: 'policy or member number', tpa: 'TPA', preAuthNumber: 'pre-authorisation number', claimNumber: 'claim number', pmjayId: 'PM-JAY ID', packageCode: 'package code', packageName: 'package name' };
const BILLING_SETTING_WORDS = { upiId: 'UPI ID', payeeName: 'payee name' };
// The Tally link: the NAMES of the settings' sections, batch and entry numbers, counts and status words – never an
// account name, an amount of one entry or a note typed. The super admin's log holds no batch or entry number.
const TALLY_SETTING_WORDS = { companyName: 'Tally company', booksFrom: 'day the books start', inpatientIssues: 'medicines issued to admitted patients', ledgers: 'account names', voucherTypes: 'voucher type names' };
const TALLY_STATUS_WORDS = { exported: 'waiting for Tally (sent again)', imported: 'imported', failed: 'refused by Tally', skipped: 'skipped' };
const TALLY_PART_WORDS = { vouchers: 'entries file', masters: 'account names file' };
const CLAIM_LAYOUT_WORDS = { claim: 'claim form', pmjay: 'PM-JAY claim sheet' };
const billOf = (d) => (d.number ? `Bill ${d.number}` : 'A bill');
const namesOf = (fields, words) => (Array.isArray(fields) ? fields.map((f) => words[f] ?? f).join(', ') : '');

// The parts of a description that are there, joined by " · "; the first one starts with a capital letter.
const joined = (...parts) => {
  const text = parts.filter(Boolean).join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
// The period of an export or a register: "1 Sep 2026 to 30 Sep 2026"
const periodOf = (d) => (d.from && d.to ? (d.from === d.to ? formatDate(d.from) : `${formatDate(d.from)} to ${formatDate(d.to)}`) : '');

// Billing: the bill's and the receipt's numbers and the amounts – never a reason that was typed, an item's name or a
// payment reference. The super admin's log holds no bill number and no amount ("A bill").
const PAYMENT_MODE_WORDS = { cash: 'cash', upi: 'UPI', card: 'card', insurance: 'insurance or scheme' };
const BILLING_EXPORT_WORDS = { items: 'Bill items', payments: 'Payments' };
const paidOf = (d) => [d.receipt ? `receipt ${d.receipt}` : '', d.amountPaise != null ? `${rupeesOf(d.amountPaise)}${PAYMENT_MODE_WORDS[d.mode] ? ` by ${PAYMENT_MODE_WORDS[d.mode]}` : ''}` : ''];

// Pharmacy: numbers, counts and amounts – never a medicine's, a supplier's or a customer's name, a batch number, a
// reason that was typed or a witness's name. A sale keeps its patient as an id only. The settings, medicine and
// supplier screens send every field when saving, so the names there are what was saved, not what changed.
const PHARMACY_SETTING_WORDS = { name: 'pharmacy name', gstin: 'GSTIN', licence20: 'drug licence (Form 20)', licence21: 'drug licence (Form 21)', rmi: 'NDPS recognition (RMI) number', pharmacistName: 'registered pharmacist', state: 'state', place: 'city or town', pin: 'PIN code' };
const SCHEDULE_WORDS = { G: 'Schedule G', H: 'Schedule H', H1: 'Schedule H1', X: 'Schedule X', narcotic: 'Narcotic (NDPS)' };
const PHARMACY_EXPORT_WORDS = { sales: 'Sales with GST', purchases: 'Purchases', supplier_returns: 'Returns to suppliers' };
const invoiceOf = (d) => (d.number ? `Invoice ${d.number}` : 'An invoice');
// A medicine or a supplier: added, or its details saved ("Stop using" and "Use again" send only `active`)
function listChangeText(what, d) {
  if (d.added) return joined(`a ${what} added`, SCHEDULE_WORDS[d.schedule], d.barcodes ? count(d.barcodes, 'barcode') : '');
  const onlyInUse = Array.isArray(d.fields) && d.fields.length === 1 && d.fields[0] === 'active';
  return joined(onlyInUse ? `a ${what} stopped or brought back into use` : `a ${what}'s details saved`, d.barcodes != null ? count(d.barcodes, 'barcode') : '');
}

// Referrals from other doctors: the record number (none before she is registered, and none in the super admin's log)
// and which part – the message, the PDF, her answer or the promise – never a name, a reason or what was written.
const REFERRAL_MESSAGE_WORDS = { reply: 'the reply', note: 'the consultant note', discharge: 'the discharge summary', other: 'another message' };
const REFERRAL_PDF_WORDS = { note: 'consultant note', discharge: 'discharge summary' };
const REFERRAL_ANSWER_WORDS = { yes: 'she agreed to share the note and discharge summary', no: 'she did not agree to share' };
const REFERRAL_PROMISE_WORDS = { reply: 'reply within 2 working hours', seen: 'seen in time', note: 'consultant note within 24 hours', discharge: 'discharge summary within 24 hours' };
const referralText = (d) =>
  joined(
    d.mrn ? record(d) : 'A referral',
    REFERRAL_MESSAGE_WORDS[d.what] ?? '',
    REFERRAL_MESSAGE_WORDS[d.what] ? '' : (REFERRAL_PDF_WORDS[d.kind] ?? ''), // a message already says which PDF
    REFERRAL_ANSWER_WORDS[d.answer] ?? '',
    REFERRAL_PROMISE_WORDS[d.promise] ? `promise: ${REFERRAL_PROMISE_WORDS[d.promise]}` : '',
  );
const REFERRAL_SETTING_WORDS = {
  centres: 'centres',
  deskNumber: 'referral desk number',
  consultantLines: "consultants' direct lines",
  workingHours: 'working hours',
  holidays: 'holidays',
  urgentCutoff: 'urgent cut-off time',
  urgentNextMorning: 'next-morning time for late urgent referrals',
};

const FAIL_REASONS = { wrong_password: 'wrong password', unknown_email: 'unknown email', inactive_account: 'account is deactivated', wrong_setup_code: 'wrong setup code for the first super admin' };

// Field names as people say them (the last part of the stored name, e.g. "pregnancy.lmp" -> "LMP").
const FIELD_LABELS = {
  ageYears: 'Age',
  lmp: 'LMP',
  edd: 'EDD',
  scanEdd: 'Scan EDD',
  effectiveEdd: 'EDD',
  heightCm: 'Height (cm)',
  weightKg: 'Weight (kg)',
  birthAt: 'Date and time of birth',
  birthWeightGrams: 'Birth weight (g)',
  council: 'Medical council',
  footer: 'Footer line',
  consentLanguage: 'Second language on consent forms',
  findings: 'Findings in this pregnancy', // which finding is never in the audit log
  newbornCare: 'Care after birth', // a baby's NICU or SNCU stay and feeding at discharge – never which part
  'abortion.findings': 'Findings of the pregnancy loss', // nor which one here, nor its value
};
const fieldLabel = (key) => {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]; // a whole name first ("abortion.findings")
  const last = String(key).split('.').pop();
  if (FIELD_LABELS[last]) return FIELD_LABELS[last];
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// The recorded value exactly as stored; only an empty value is shown as "(none)".
const shownValue = (v) => (v === null || v === undefined || v === '' ? '(none)' : String(v));

// Care-plan changes in plain words. The audit log holds only these words and record numbers: never item
// names, dates or reasons, and plan-level changes (booking date, protocol, EDD decision, close, reopen) are
// all "plan updated", so the log never reveals a pregnancy outcome.
const CARE_PLAN_CHANGES = {
  item_done: 'item marked done',
  item_reopened: 'item reopened',
  item_not_needed: 'item marked not needed',
  item_moved: 'item date moved',
  item_date_reset: 'item date reset',
  item_included: 'item included',
  item_include_removed: 'item inclusion removed',
  item_kept: 'item kept as planned',
  item_note: 'item note changed',
  item_added: 'item added',
  item_edited: 'added item edited',
  items_done_at_visit: 'items marked done at a visit',
  items_done_from_lab: 'items marked done from reviewed lab results',
  plan_changed: 'plan updated',
};

const VISIT_PARTS = { vitals: 'vital signs', details: 'visit details' };

// "1 patient", "12 patients"
const count = (n, one, many = `${one}s`) => `${formatNumber(n)} ${Number(n) === 1 ? one : many}`;

// The record an entry is about. The super admin's audit log never holds record numbers (it shows no patient),
// so there it reads "A patient record" – "A patient record was opened" instead of "Record P-000004".
const record = (d) => (d.mrn ? `Record ${d.mrn}` : 'A patient record');
// Why the lab rejected a sample (server/src/lab/labSetup.js REJECT_REASONS)
const LAB_REJECT_WORDS = { haemolysed: 'haemolysed', clotted: 'clotted', insufficient: 'too little sample', container: 'wrong container', label: 'not labelled', leaked: 'leaked or broken', delayed: 'arrived too late', other: 'other reason' };
const opened = (d) => (d.mrn ? `Record ${d.mrn}` : 'A patient record was opened');
// Analytics entries hold only which tab and whose numbers – never a number, a label or a filter.
const ANALYTICS_TABS = { overview: 'Overview', pregnancy: 'Pregnancy', risk: 'Risk & conditions', care: 'Care plans & visits', deliveries: 'Deliveries', newborn: 'Newborn', doctors: 'By doctor' };
const ANALYTICS_SCOPES = { hospital: 'Whole hospital', mine: 'My patients' };
function analyticsViewText(d) {
  const tab = ANALYTICS_TABS[d.section] ? `${ANALYTICS_TABS[d.section]} tab` : 'Analytics';
  let whose = ANALYTICS_SCOPES[d.scope] ?? '';
  if (d.scope === 'platform') whose = d.hospital === 'all' ? 'All hospitals' : 'One hospital';
  return whose ? `${tab} · ${whose}` : tab;
}

const accessText = (d) => (d.access ? ` (${String(d.access).replace('_', '-')} access)` : '');
// A printout for the patient with Marathi or Hindi next to the English (patient copy of the care plan, discharge card)
const PRINTED_LANGUAGES = { mr: 'Marathi', hi: 'Hindi' };
const printedIn = (d) => (PRINTED_LANGUAGES[d.language] ? `, in English and ${PRINTED_LANGUAGES[d.language]}` : '');

// ABDM (ABHA). M1: how an ABHA was linked. M2: counts only – never which records, what was sent or to whom.
const ABHA_METHOD_WORDS = { verified: 'verified by OTP', created: 'created at the desk', scan_share: 'from Scan & Share' };
const ABDM_SETTING_WORDS = { hfrId: 'HFR facility ID', hipId: 'HIP ID', counterCode: 'Scan & Share counter code' };
const CONSENT_STATUS_WORDS = { GRANTED: 'given', REVOKED: 'withdrawn', EXPIRED: 'expired', DENIED: 'refused' };
const SHARE_REFUSAL_WORDS = {
  unknown_consent: 'no consent was found for it',
  consent_revoked: 'the consent was withdrawn',
  consent_denied: 'the consent was refused',
  consent_expired: 'the consent had expired',
  consent_incomplete: 'the consent did not say its dates or until when it lasts',
  dates_outside_consent: 'the dates asked for were outside the consent',
  push_address: 'the address to send to was not allowed',
};
const practiceText = (d) => (d.practice ? ' (practice mode, nothing left the computer)' : '');
// M3: her answer, and why records from other hospitals were deleted
const FETCH_ANSWER_WORDS = { GRANTED: 'she agreed', DENIED: 'she refused', REVOKED: 'she withdrew her consent', EXPIRED: 'her consent ended' };
const FETCH_DELETED_WORDS = { expired: 'her consent ended', revoked: 'she withdrew her consent', replaced: 'asked again' };
const fetchPractice = (d) => (d.practice ? ' (practice mode)' : '');
function abdmText(action, d) {
  switch (action) {
    case 'ABHA_VERIFIED':
      return `${record(d)}${d.accounts != null ? ` · ${count(d.accounts, 'ABHA')} found` : ''}`;
    case 'ABHA_LINKED':
      return `${record(d)}${ABHA_METHOD_WORDS[d.method] ? ` · ${ABHA_METHOD_WORDS[d.method]}` : ''}${d.token ? ` · token ${d.token}` : ''}`;
    case 'ABHA_CREATED':
    case 'ABHA_UNLINKED':
    case 'ABHA_VIEWED':
    case 'ABHA_CARD_PRINTED':
      return record(d);
    case 'ABDM_SCAN_SHARE_RECEIVED':
      return `${d.token ? `Token ${d.token}` : ''}${d.practice ? ' – practice scan' : ''}`;
    case 'ABDM_SCAN_SHARE_HANDLED':
      return d.token ? `Token ${d.token} put aside` : '';
    case 'ABDM_SETTINGS_CHANGED':
      return namesOf(d.fields, ABDM_SETTING_WORDS);
    case 'ABDM_RECORDS_VIEWED':
      return `${opened(d)}${d.practice ? ' – what the practice clinic received' : ''}`;
    case 'ABDM_RECORDS_LINKED': {
      const how = d.via === 'patient' ? 'linked from her ABHA app' : 'linked by the hospital';
      const state = d.status === 'waiting' ? ' – waiting for ABDM' : d.status === 'refused' ? ' – ABDM refused' : '';
      return `${record(d)}: ${count(d.records ?? 0, 'record')} ${how}${state}${practiceText(d)}`;
    }
    case 'ABDM_RECORDS_DISCOVERED':
      return d.found ? `${record(d)}: ${count(d.offered ?? 0, 'record')} offered to link${practiceText(d)}` : `No record here has that ABHA${practiceText(d)}`;
    case 'ABDM_CONSENT_RECEIVED':
      return `${d.mrn ? `${record(d)}: ` : ''}consent ${CONSENT_STATUS_WORDS[d.status] ?? String(d.status ?? '').toLowerCase()}${d.records ? ` for ${count(d.records, 'record')}` : ''}${d.ignored ? ' – ignored, it had already ended' : ''}${practiceText(d)}`;
    case 'ABDM_RECORDS_SHARED':
      return `${record(d)}: ${count(d.records ?? 0, 'record')} sent (${count(d.documents ?? 0, 'document')})${d.heldBack ? `, ${formatNumber(d.heldBack)} held back` : ''}${practiceText(d)}`;
    case 'ABDM_SHARE_REFUSED':
      return `${d.mrn ? `${record(d)}: ` : ''}nothing sent – ${SHARE_REFUSAL_WORDS[d.refusal] ?? 'refused'}${practiceText(d)}`;
    case 'ABDM_FETCH_REQUESTED':
      return `${record(d)}: ${count(d.types ?? 0, 'kind')} of record, consent for ${count(d.days ?? 0, 'day')}${fetchPractice(d)}`;
    case 'ABDM_FETCH_ANSWERED':
      return `${record(d)}: ${FETCH_ANSWER_WORDS[d.status] ?? String(d.status ?? '').toLowerCase()}${d.status === 'GRANTED' ? ` – ${count(d.hospitals ?? 0, 'hospital')}` : ''}${fetchPractice(d)}`;
    case 'ABDM_RECORDS_FETCHED': {
      const extra = [d.files ? count(d.files, 'file') : '', d.withheld ? `${count(d.withheld, 'sentence')} withheld (PC-PNDT)` : '', d.failed ? `${formatNumber(d.failed)} could not be read` : ''].filter(Boolean).join(', ');
      return `${record(d)}: ${count(d.documents ?? 0, 'document')} received${extra ? ` – ${extra}` : ''}${fetchPractice(d)}`;
    }
    case 'ABDM_FETCHED_VIEWED':
      return `${opened(d)}${d.fileId ? ' – an attached file downloaded' : d.recordId ? ' – one document' : d.documents != null ? ` – the list (${count(d.documents, 'document')})` : ''}`;
    case 'ABDM_FETCHED_DELETED':
      return `${record(d)}: ${count(d.documents ?? 0, 'document')}${d.files ? ` and ${count(d.files, 'file')}` : ''} deleted – ${FETCH_DELETED_WORDS[d.why] ?? 'consent ended'}${fetchPractice(d)}`;
    default:
      return '';
  }
}

export function describeAudit(entry) {
  const d = entry.details || {};
  switch (entry.action) {
    case 'LOGIN_LOCKED':
      return [d.email, d.seconds ? `${Math.round(d.seconds / 60)} minutes` : ''].filter(Boolean).join(' · ');
    case 'LOGIN_FAILED':
      return `${d.email} (${FAIL_REASONS[d.reason] ?? d.reason})`;
    case 'LOGIN_RATE_LIMITED':
      return d.email ? `Email: ${d.email}` : '';
    case 'ROLE_CHANGED':
    case 'MEMBER_ROLE_CHANGED':
      return `was ${rolesLabel(d.from)}; now ${rolesLabel(d.to)}`;
    case 'MEMBER_ADDED':
      return `Roles: ${rolesLabel(d.roles ?? d.role)}`;
    case 'USER_UPDATED':
    case 'TENANT_UPDATED':
    case 'TENANT_SETTINGS_UPDATED':
    case 'PROFILE_UPDATED':
      return Object.entries(d.changes || {})
        .map(([k, v]) => `${fieldLabel(k)}: was ${shownValue(v?.from)}, now ${shownValue(v?.to)}`)
        .join('; ');
    case 'USER_CREATED':
      return d.superAdmin ? 'Super admin account' : '';
    case 'TENANT_CREATED':
      return d.name ?? '';
    case 'PATIENT_CREATED':
      return d.mrn ? record(d) : 'A patient record was added';
    // Duplicate records: record numbers and counts only (the platform's log has the counts alone)
    case 'PATIENT_REGISTERED_ANYWAY':
      return `${record(d)}${d.matches != null ? ` – ${count(d.matches, 'matching record')} ${Number(d.matches) === 1 ? 'was' : 'were'} shown` : ''}`;
    case 'PATIENT_MARKED_DUPLICATE':
      return `${record(d)}${d.mainMrn ? `: duplicate of ${d.mainMrn}` : ''}${d.appointmentsMoved ? ` – ${count(d.appointmentsMoved, 'appointment')} moved to the main record` : ''}`;
    case 'PATIENT_DUPLICATE_UNDONE':
      return `${record(d)}${d.mainMrn ? `: no longer a duplicate of ${d.mainMrn}` : ''}${d.appointmentsMoved ? ` – ${count(d.appointmentsMoved, 'appointment')} moved back` : ''}`;
    // A record closed by a doctor, and reopened: counts only – the log never says which record, or why
    case 'PATIENT_RECORD_CLOSED': {
      const done = [
        d.appointmentsCancelled ? `${count(d.appointmentsCancelled, 'appointment')} cancelled` : null,
        d.messagesCancelled ? `${count(d.messagesCancelled, 'waiting message')} stopped` : null,
        d.portalEnded ? 'patient portal access ended' : null,
      ].filter(Boolean);
      return done.length ? done.join(' · ') : 'Nothing booked or waiting';
    }
    case 'PATIENT_RECORD_REOPENED':
      return '';
    case 'PATIENT_ARRIVED':
    case 'PATIENT_ARRIVAL_UNDONE':
    case 'PATIENT_CARD_PRINTED':
      return d.mrn ? record(d) : '';
    // A copy of the whole record: which record only – never what the copy held
    case 'PATIENT_RECORD_COPIED':
    case 'PATIENT_RECORD_COPY_PRINTED':
    case 'PATIENT_RECORD_COPY_PDF_SAVED':
      return `${record(d)}${accessText(d)}`;
    // Appointments: the day and time only (ids are kept for the record, never shown as text)
    case 'APPOINTMENT_BOOKED':
      return `${d.date ?? ''}${d.start ? ` at ${d.start}` : d.date ? ' (time to be given)' : ''}${d.quick ? ' · new patient, not registered yet' : ''}${d.fromVisit ? ' · from the next visit' : ''}`;
    case 'APPOINTMENT_MOVED':
      return `${d.from?.date ? `${d.from.date}${d.from.start ? ` ${d.from.start}` : ''} → ` : ''}${d.date ?? ''}${d.start ? ` ${d.start}` : ''}`;
    case 'APPOINTMENT_CANCELLED':
      return `${d.date ?? ''}${d.reason ? ` · ${{ patient_asked: 'patient asked', doctor_leave: 'doctor on leave', other: 'other reason' }[d.reason] ?? d.reason}` : ''}`;
    case 'APPOINTMENT_LINKED':
      return d.date ?? '';
    case 'TOKEN_GIVEN':
      return d.token ? `Token ${d.token}` : '';
    case 'BEDS_ADDED':
      return `${d.count ?? 0} bed${d.count === 1 ? '' : 's'}${d.ward ? ` in ${d.ward}` : ''}`;
    case 'BED_UPDATED':
      return d.active === false ? 'Taken out of use' : '';
    case 'BEDS_VIEWED':
      return `${d.occupied ?? 0} bed${d.occupied === 1 ? '' : 's'} occupied`;
    case 'DISCHARGES_VIEWED':
      return `${d.goingHome ?? 0} going home · ${d.dischargedToday ?? 0} went home today`;
    case 'OPD_TIMINGS_CHANGED':
      return `${d.days ?? 0} day${d.days === 1 ? '' : 's'} a week${d.leave ? ` · ${d.leave} leave entr${d.leave === 1 ? 'y' : 'ies'}` : ''}`;
    case 'PATIENT_VIEWED':
      return `${opened(d)}${accessText(d)}`;
    case 'PATIENT_UPDATED':
      return `${record(d)}${d.fields?.length ? `: ${d.fields.map(fieldLabel).join(', ')}` : ''}`;
    case 'PATIENT_ASSIGNED':
      return record(d);
    case 'PATIENT_SENSITIVITY_CHANGED':
      return `${record(d)}: ${d.sensitive ? 'marked sensitive' : 'no longer sensitive'}`;
    case 'TEMPLATE_CREATED':
    case 'TEMPLATE_UPDATED':
    case 'TEMPLATE_APPROVED':
    case 'TEMPLATE_DEFAULT_SET':
    case 'TEMPLATE_DEFAULT_REMOVED':
      return `${d.name ?? ''}${d.version ? ` (version ${d.version})` : ''}`;
    // Risk entries deliberately hold no levels or reasons (medical details stay on the record).
    case 'PATIENT_RISK_CHANGED':
      return `${record(d)}${d.why ? ` (${d.why})` : ''}`;
    case 'RISK_OVERRIDDEN':
    case 'RISK_OVERRIDE_REMOVED':
      return record(d);
    case 'RISK_RECALCULATED':
      return `${d.name ? `${d.name}: ` : ''}${count(d.checked, 'patient')} checked, ${formatNumber(d.changed)} changed${d.skipped ? `, ${formatNumber(d.skipped)} to retry` : ''}`;
    case 'CARE_PLAN_CREATED':
      return record(d);
    case 'CARE_PLAN_VIEWED':
      // "No plan yet" only where the plan id can be shown (the platform log never has it).
      return d.mrn ? `Record ${d.mrn}${d.planId ? '' : ' (no plan yet)'}${accessText(d)}` : `${opened(d)}${accessText(d)}`;
    case 'CARE_PLAN_CHANGED':
      return `${record(d)}${d.change ? `: ${CARE_PLAN_CHANGES[d.change] ?? d.change}` : ''}`;
    case 'CONSENT_FORM_CREATED':
    case 'CONSENT_FORM_UPDATED':
    case 'CONSENT_FORM_APPROVED':
    case 'CONSENT_FORM_ACTIVATED':
    case 'CONSENT_FORM_DEACTIVATED':
      return `${d.title ?? ''}${d.version ? ` (version ${d.version})` : ''}`;
    case 'PRESCRIPTION_SET_CREATED':
    case 'PRESCRIPTION_SET_UPDATED':
    case 'PRESCRIPTION_SET_APPROVED':
    case 'PRESCRIPTION_SET_ACTIVATED':
    case 'PRESCRIPTION_SET_DEACTIVATED':
    case 'LAB_PACKAGE_CREATED':
    case 'LAB_PACKAGE_UPDATED':
    case 'LAB_PACKAGE_APPROVED':
    case 'LAB_PACKAGE_ACTIVATED':
    case 'LAB_PACKAGE_DEACTIVATED':
      return `${d.name ?? ''}${d.version ? ` (version ${d.version})` : ''}`;
    // A patient's consent forms: the record number only – never which form (it could reveal a procedure).
    case 'CONSENTS_VIEWED':
      return `${opened(d)}${accessText(d)}`;
    case 'CONSENT_FORM_PRINTED':
    case 'CONSENT_SIGNED_RECORDED':
    case 'CONSENT_SCAN_ADDED':
    case 'CONSENT_SCAN_OPENED':
      return record(d);
    // Visits: the record number and which parts were saved – never what was written.
    case 'VISITS_VIEWED':
    case 'VISIT_VIEWED':
      return `${opened(d)}${accessText(d)}`;
    case 'VISIT_UPDATED':
      return `${record(d)}${d.sections?.length ? `: ${d.sections.map((x) => VISIT_PARTS[x] ?? x).join(', ')}` : ''}`;
    // AI: which feature and the size of the request – never what was sent or written.
    case 'AI_USED':
      // A brief of Today or the calendar covers several patients: how many (their ids are kept, not shown here)
      return `${d.mrn ? `Record ${d.mrn}: ` : ''}${AI_FEATURES[d.feature] ?? d.feature ?? ''}${!d.mrn && d.results != null ? ` – ${count(d.results, 'patient')}` : ''}${d.model ? ` (${d.model})` : ''}`;
    case 'AI_CHECK_PRINTED_ANYWAY':
      return `${d.mrn ? `Record ${d.mrn}: ` : ''}${count(d.issues ?? 0, 'point')} raised`;
    case 'AI_QUESTION_ASKED':
      return `${count(d.results ?? 0, 'patient')} found`;
    case 'REMINDER_PREPARED':
    case 'VISIT_CREATED':
    case 'VISIT_CANCELLED':
    case 'ADMISSIONS_VIEWED':
    case 'ADMISSION_VIEWED':
    case 'ADMISSION_CREATED':
    case 'ADMISSION_UPDATED':
    case 'ADMISSION_BED_CHANGED':
    case 'PATIENT_DISCHARGED':
    case 'DOCUMENT_CREATED':
    case 'DOCUMENT_VIEWED':
    case 'DOCUMENT_UPDATED':
    case 'DOCUMENT_SIGNED':
    case 'DOCUMENT_ADDITION_ADDED':
    case 'DOCUMENT_CANCELLED':
    case 'NURSING_ENTRY_ADDED':
    case 'NURSING_ENTRY_CANCELLED':
    case 'VISIT_SIGNED':
    case 'VISIT_ADDITION_ADDED':
    case 'PRESCRIPTION_UPDATED':
    case 'PRESCRIPTION_PRINTED':
    case 'VISIT_SUMMARY_PRINTED':
    case 'LAB_ORDER_VIEWED':
    case 'LAB_RESULTS_VIEWED':
    case 'LAB_SAMPLE_COLLECTED':
    case 'LAB_SAMPLE_RECEIVED':
    case 'LAB_RESULTS_SAVED':
    case 'LAB_RESULTS_REPORTED':
    case 'LAB_RESULTS_AMENDED':
    case 'LAB_REPORT_UPLOADED':
    case 'LAB_REPORT_OPENED':
    case 'LAB_RESULTS_REVIEWED':
    case 'LAB_ORDER_CANCELLED':
    case 'LAB_LABELS_PRINTED':
    case 'LAB_RESULTS_ENTERED':
    case 'LAB_RESULTS_VERIFIED':
    case 'LAB_RESULTS_SENT_BACK':
    case 'WORK_DONE_VIEWED':
    case 'WORK_DONE_RECORDED':
    case 'WORK_DONE_CANCELLED':
      return record(d);
    case 'REFERRAL_CREATED':
    case 'REFERRAL_VIEWED':
    case 'REFERRAL_UPDATED':
    case 'REFERRAL_LINKED':
    case 'REFERRAL_BOOKED':
    case 'REFERRAL_ATTACHMENT_ADDED':
    case 'REFERRAL_ATTACHMENT_OPENED':
    case 'REFERRAL_SHARING_ANSWERED':
    case 'REFERRAL_NOTE_SAVED':
    case 'REFERRAL_NOTE_SIGNED':
    case 'REFERRAL_NOTE_ADDITION_ADDED':
    case 'REFERRAL_PDF_RELEASED':
    case 'REFERRAL_PDF_OPENED':
    case 'REFERRAL_MESSAGE_SENT':
    case 'REFERRAL_REVIEW_ADDED':
    case 'REFERRAL_CLOSED':
    case 'REFERRAL_CANCELLED':
      return referralText(d);
    // The referring doctor and the quarterly summary are kept as ids only
    case 'REFERRING_DOCTOR_ADDED':
    case 'REFERRING_DOCTOR_UPDATED':
    case 'REFERRAL_SUMMARY_VIEWED':
      return '';
    // Which settings – never a phone number or a holiday
    case 'REFERRAL_SETTINGS_CHANGED':
      return joined(namesOf(d.fields, REFERRAL_SETTING_WORDS));
    case 'QUEUE_TIME_SENT':
    case 'LAB_REPORT_SENT_WHATSAPP':
      return `${record(d)}${d.practice ? ' (practice – not really sent)' : ''}`;
    case 'BILL_SENT_WHATSAPP':
      return `${d.receipt ? `Receipt ${d.receipt}` : `Bill ${d.number ?? ''}`}${d.practice ? ' (practice – not really sent)' : ''}`;
    case 'CASH_HANDED_OVER':
      return `${d.day ?? ''}: ₹${((d.handedPaise ?? 0) / 100).toLocaleString('en-IN')} handed over (Perinexa counted ₹${((d.cashPaise ?? 0) / 100).toLocaleString('en-IN')})`;
    case 'CASH_HANDOVER_CONFIRMED':
      return `${d.day ?? ''}: ₹${((d.receivedPaise ?? 0) / 100).toLocaleString('en-IN')} received (₹${((d.handedPaise ?? 0) / 100).toLocaleString('en-IN')} handed over)`;
    case 'ADMISSION_REQUESTED':
    case 'ADMISSION_REQUEST_CANCELLED':
    case 'ADMISSION_FORM_PRINTED':
    case 'WRISTBAND_PRINTED':
    case 'GATE_PASS_PRINTED':
      return record(d);
    case 'ADMISSION_CHECKLIST_UPDATED':
      return `${record(d)}${d.complete ? ' – complete' : ' – not complete yet'}`;
    case 'DISCHARGE_CLEARED':
      return `${record(d)}${d.balancePaise > 0 ? ` – ₹${(d.balancePaise / 100).toLocaleString('en-IN')} still due` : ' – bill settled'}`;
    case 'OPD_CASE_PAPER_PRINTED':
      return `${record(d)}${d.opdNo ? ` – ${d.opdNo}` : ''}`;
    case 'ADMISSION_RULES_CHANGED':
      return `${d.requireAdmissionRequest ? "A doctor's request first" : 'No request needed'} · ${d.requireChecklist ? 'checklist required' : 'checklist not required'}`;
    case 'IMAGING_ORDERED':
    case 'IMAGING_VIEWED':
    case 'IMAGING_SCHEDULED':
    case 'IMAGING_DONE':
    case 'IMAGING_SAVED':
    case 'IMAGING_AMENDED':
    case 'IMAGING_SIGNED':
    case 'IMAGING_CANCELLED':
    case 'IMAGING_PRINTED':
      return record(d);
    case 'LAB_HOME_COLLECTION':
      return `${record(d)}${d.status ? ` – ${String(d.status).replace(/_/g, ' ')}` : ''}`;
    case 'LAB_QC_RUN':
      return d.status ? `Run ${d.status}` : '';
    case 'LAB_SAMPLE_REJECTED':
      return `${record(d)}${d.reason ? `: ${LAB_REJECT_WORDS[d.reason] ?? d.reason}` : ''}`;
    case 'LAB_SENT_OUTSIDE':
    case 'LAB_OUTSIDE_RECEIVED':
      return `${record(d)}${d.tests ? ` – ${count(d.tests, 'test')}` : ''}`;
    case 'LAB_REPORT_PRINTED':
      return `${record(d)}${d.confidential ? ' – with the confidential test' : ''}`;
    case 'LAB_ORDERS_SEARCHED':
      return count(d.results ?? 0, 'order') + ' listed';
    case 'LAB_REGISTER_VIEWED':
      return `${d.from ?? ''}${d.to && d.to !== d.from ? ` to ${d.to}` : ''}: ${count(d.results ?? 0, 'order')}`;
    case 'LAB_TEST_CREATED':
    case 'LAB_TEST_UPDATED':
    case 'LAB_TEST_APPROVED':
      return `${d.name ?? d.test ?? ''}${d.version ? ` (version ${d.version})` : ''}${d.ranges ? ' – values or ranges changed' : ''}`;
    case 'LAB_SETTINGS_CHANGED':
      // Who signs the report (report templates): how many signers – never a name or a signature
      if (d.signers != null) return `Who signs the lab report: ${count(d.signers, 'signer')}`;
      return d.verify ? `Results checked before the report${d.checkers ? ` (${count(d.checkers, 'chosen checker')})` : ' (any lab staff, doctor or RMO)'}` : 'Results not checked before the report';
    case 'PATIENT_REMINDERS_CHANGED':
      return `${record(d)}: ${d.consent ? `agreed (${d.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'})` : 'no reminders'}`;
    case 'REMINDER_SENT_BY_HAND':
    case 'PORTAL_ACCESS_CREATED':
    case 'PORTAL_ACCESS_REVOKED':
    case 'PORTAL_LOGIN_SUCCESS':
    case 'PORTAL_VIEWED':
    case 'PORTAL_APPOINTMENT_BOOKED':
    case 'PORTAL_APPOINTMENT_CANCELLED':
      return [d.mrn ? record(d) : '', LOGIN_METHOD_WORDS[d.method] ?? ''].filter(Boolean).join(' · ');
    case 'PORTAL_SIGNUP_APPROVED':
      return d.mrn ? `Linked to ${record(d)}` : '';
    case 'PORTAL_SIGNUP_REJECTED':
      return d.reason ?? '';
    case 'PORTAL_PASSWORD_CHANGED':
      return '';
    case 'KEEPSAKE_CARD_PRINTED':
      return d.mrn ? record(d) : '';
    case 'PORTAL_PROFILE_UPDATED':
    case 'PORTAL_CHANGE_REQUESTED':
    case 'PORTAL_CHANGE_APPROVED':
      return [d.mrn ? record(d) : '', profileFields(d)].filter(Boolean).join(' · ');
    case 'PORTAL_CHANGE_REJECTED':
      return d.mrn ? record(d) : '';
    case 'PORTAL_RECORDS_VIEWED':
      return [d.mrn ? record(d) : '', PORTAL_RECORD_WORDS[d.kind] ?? ''].filter(Boolean).join(' · ');
    case 'PORTAL_SIGNUP_RECEIVED':
      return 'Waiting for approval (Patients → Online sign-ups)';
    case 'PORTAL_LOGIN_FAILED':
      return d.reason === 'wrong_digits'
        ? 'Wrong mobile digits'
        : d.reason === 'expired_or_withdrawn'
          ? 'Code expired or withdrawn'
          : PORTAL_FAIL_WORDS[d.reason] ?? 'Unknown code';
    // Counts only. Since 4 Oct 2026 also the two general messages (missed appointment; check-up or test due).
    case 'REMINDERS_RUN':
      return [
        count(d.queued ?? 0, 'queued', 'queued'),
        d.missed ? count(d.missed, 'for a missed appointment', 'for missed appointments') : null,
        d.careDue ? count(d.careDue, 'for a check-up or test due', 'for check-ups or tests due') : null,
        count(d.sent ?? 0, 'sent', 'sent'),
        count(d.toSend ?? 0, 'to send by hand', 'to send by hand'),
        d.failed ? count(d.failed, 'failed', 'failed') : null,
        d.dropped ? count(d.dropped, 'cancelled as no longer needed', 'cancelled as no longer needed') : null,
        d.heldBack ? count(d.heldBack, 'held back (draft care plan)', 'held back (draft care plans)') : null,
        d.waiting ? count(d.waiting, 'waiting for the morning', 'waiting for the morning') : null,
      ]
        .filter(Boolean)
        .join(', ');
    // Registers (removed 2 Oct 2026, kept so old entries still display): which register and month; never a patient for MTP
    case 'REGISTER_ENTRY_CREATED':
    case 'REGISTER_ENTRY_VIEWED':
    case 'REGISTER_ENTRY_SAVED':
    case 'REGISTER_ENTRY_SIGNED':
    case 'REGISTER_ENTRY_CANCELLED':
    case 'REGISTER_LIST_VIEWED':
    case 'REGISTER_PRINTED':
    case 'REGISTER_SCAN_ADDED':
    case 'REGISTER_SCAN_OPENED':
      return `${REGISTER_WORDS[d.register] ?? 'Register'}${d.month ? ` · ${d.month}` : ''}${d.mrn ? ` · ${record(d)}` : ''}`;
    case 'LAB_ORDER_CREATED':
      return `${record(d)}${d.tests ? ` · ${count(d.tests, 'test')}` : ''}`;
    case 'PRESCRIPTION_SENT_WHATSAPP':
    case 'VISIT_SUMMARY_SENT_WHATSAPP':
      return `${record(d)}${d.practice ? ' – practice mode, nothing was sent' : ''}`;
    case 'PRESCRIPTION_PDF_SAVED':
    case 'VISIT_SUMMARY_PDF_SAVED':
      return `${record(d)}${d.via === 'whatsapp' ? ' – to send on WhatsApp' : ''}`;
    case 'CARE_PLAN_PRINTED':
      return `${record(d)}${d.copy === 'staff' ? ': staff copy' : d.copy === 'patient' ? ': patient copy' : ''}${printedIn(d)}`;
    // A discharge card (since 5 Oct 2026) may have been printed with Marathi or Hindi
    case 'DOCUMENT_PRINTED':
      return `${record(d)}${printedIn(d)}`;
    case 'RED_FLAG_RULES_UPDATED':
      return `Version ${d.version ?? ''}${d.rules != null ? ` (${count(d.rules, 'rule')})` : ''}${d.added ? ` – ${count(d.added, 'built-in rule')} added` : ''}`;
    case 'MEDICINE_SAFETY_UPDATED':
      return `Version ${d.version ?? ''}${d.entries != null ? ` (${count(d.entries, 'entry', 'entries')})` : ''}${d.added ? ` – ${count(d.added, 'built-in entry', 'built-in entries')} added` : ''}`;
    case 'MEDICINE_SAFETY_APPROVED':
    case 'RED_FLAG_RULES_APPROVED':
      return d.version ? `Version ${d.version}` : '';
    // Counts only – never names or medical details.
    case 'WORKLIST_VIEWED':
      return `${d.scope === 'mine' ? 'Own patients' : 'All patients'}: ${count(d.redFlags ?? 0, 'with red flags', 'with red flags')}, ${count(d.carePlan ?? 0, 'care plan to act on', 'care plans to act on')}, ${count(d.seenToday ?? 0, 'visit today', 'visits today')}${d.vaccinations != null ? `, ${count(d.vaccinations, 'baby with vaccinations overdue', 'babies with vaccinations overdue')}` : ''}`;
    case 'INPATIENTS_VIEWED':
      return `${count(d.admitted ?? 0, 'patient in hospital', 'patients in hospital')}, ${count(d.flagged ?? 0, 'with red flags', 'with red flags')}`;
    case 'EMERGENCY_NOTE_ADDED':
      return `${record(d)}${d.reason ? ` – reason: ${d.reason}` : ''}`;
    case 'ANALYTICS_VIEWED':
      return analyticsViewText(d);
    case 'REPORT_VIEWED':
      return `Monthly report${/^\d{4}-\d{2}$/.test(d.month ?? '') ? ` · ${monthWords(d.month)}` : ''}`;
    case 'ANALYTICS_LIST_VIEWED':
      return `${count(d.count ?? 0, 'record')} listed · page ${formatNumber(d.page ?? 1)}`;
    case 'PHARMACY_ORDER_CREATED':
    case 'PHARMACY_ORDER_CHANGED':
      return `${d.number ?? ''}${d.lines != null ? ` · ${count(d.lines, 'medicine')}` : ''}`;
    case 'PHARMACY_ORDER_SENT':
    case 'PHARMACY_ORDER_CLOSED':
    case 'PHARMACY_ORDER_CANCELLED':
    case 'PHARMACY_ORDER_PRINTED':
    case 'PHARMACY_DEBIT_NOTE_PRINTED':
      return d.number ?? '';
    case 'PHARMACY_ORDER_RECEIVED':
      // notCounted: the order was cancelled or closed while the purchase was being saved – the purchase stays without it
      if (d.notCounted) return `${d.number ?? ''}${d.purchase ? ` · purchase ${d.purchase}` : ''} · not counted: ${ORDER_NOT_COUNTED_WORDS[d.notCounted] ?? 'the order could not take it'}`;
      return `${d.number ?? ''}${d.purchase ? ` · purchase ${d.purchase}` : ''}${d.status ? ` · now ${ORDER_STATUS_WORDS[d.status] ?? d.status}` : ''}`;
    case 'PHARMACY_SUPPLIER_RETURNED':
      return `${d.number ?? ''}${d.qty != null ? ` · ${count(d.qty, 'unit')}` : ''}${d.lines != null ? ` in ${count(d.lines, 'batch', 'batches')}` : ''}${d.amountPaise != null ? ` · ${rupeesOf(d.amountPaise)}` : ''}${d.reason ? ` · ${SUPPLIER_RETURN_WORDS[d.reason] ?? d.reason}` : ''}${d.controlled ? ' · controlled medicine' : ''}`;
    case 'PHARMACY_SUPPLIER_RETURN_CANCELLED':
      return `${d.number ?? ''}${d.qty != null ? ` · ${count(d.qty, 'unit')} back in stock` : ''}${d.amountPaise != null ? ` · ${rupeesOf(d.amountPaise)}` : ''}${d.controlled ? ' · controlled medicine' : ''}`;
    case 'PHARMACY_EINVOICE_DOWNLOADED':
      return `${d.creditNote ? `Credit note ${d.creditNote} of invoice ${d.number ?? ''}` : `Invoice ${d.number ?? ''}`}`;
    case 'BILL_INSURANCE_CHANGED':
      return `${billOf(d)}${d.removed ? ' · details taken off' : namesOf(d.fields, INSURANCE_FIELD_WORDS) ? ` · ${namesOf(d.fields, INSURANCE_FIELD_WORDS)}` : ''}${d.via === 'payment' ? ' · noted from a payment by insurance' : ''}`;
    case 'CLAIM_FORM_PRINTED':
      return `${billOf(d)}${CLAIM_LAYOUT_WORDS[d.layout] ? ` · ${CLAIM_LAYOUT_WORDS[d.layout]}` : ''}`;
    case 'UPI_LINK_MADE':
      return billOf(d);
    case 'BILLING_SETTINGS_CHANGED': {
      // The log keeps no UPI ID. What it was set to – each change, with who and when – is with the settings themselves.
      const names = namesOf(d.fields, BILLING_SETTING_WORDS);
      return names ? `${names} · what it was set to is listed under Billing → Settings` : '';
    }
    case 'TALLY_SETTINGS_CHANGED':
      return joined(namesOf(d.fields, TALLY_SETTING_WORDS));
    case 'TALLY_BATCH_CREATED':
      return joined(d.number ? `Batch ${d.number}` : 'A batch', periodOf(d), d.vouchers != null ? count(d.vouchers, 'entry', 'entries') : '');
    case 'TALLY_FILE_DOWNLOADED':
      return joined(d.number ? `Batch ${d.number}` : 'A batch', TALLY_PART_WORDS[d.part] ?? '');
    case 'TALLY_VOUCHER_STATUS':
      return joined(d.key ? `Entry ${d.key}` : d.number ? `Batch ${d.number}` : 'Entries', TALLY_STATUS_WORDS[d.status] ?? d.status ?? '', d.count != null ? count(d.count, 'entry', 'entries') : '');
    case 'ABHA_VERIFIED':
    case 'ABHA_LINKED':
    case 'ABHA_CREATED':
    case 'ABHA_UNLINKED':
    case 'ABHA_VIEWED':
    case 'ABHA_CARD_PRINTED':
    case 'ABDM_SCAN_SHARE_RECEIVED':
    case 'ABDM_SCAN_SHARE_HANDLED':
    case 'ABDM_SETTINGS_CHANGED':
    case 'ABDM_RECORDS_VIEWED':
    case 'ABDM_RECORDS_LINKED':
    case 'ABDM_RECORDS_DISCOVERED':
    case 'ABDM_CONSENT_RECEIVED':
    case 'ABDM_RECORDS_SHARED':
    case 'ABDM_SHARE_REFUSED':
    case 'ABDM_FETCH_REQUESTED':
    case 'ABDM_FETCH_ANSWERED':
    case 'ABDM_RECORDS_FETCHED':
    case 'ABDM_FETCHED_VIEWED':
    case 'ABDM_FETCHED_DELETED':
      return abdmText(entry.action, d);
    // Counts only: how many patients, records and stored files were written to the folder
    case 'HOSPITAL_DATA_EXPORTED':
      return d.records != null ? `${count(d.patients ?? 0, 'patient')} – ${count(d.records, 'record')} in all and ${count(d.files ?? 0, 'stored file')}, written to a folder on the server` : '';
    // Billing: numbers and amounts only (see PAYMENT_MODE_WORDS)
    case 'BILL_VIEWED':
      return joined(billOf(d), d.claimForm ? 'claim form opened' : '');
    case 'BILL_ITEM_ADDED':
    case 'BILL_ITEM_REMOVED':
      return joined(billOf(d), d.amountPaise != null ? rupeesOf(d.amountPaise) : '');
    case 'DISCOUNT_GIVEN': {
      // A value of 0 takes the discount off
      if (d.value === 0) return joined(billOf(d), 'discount taken off');
      const amount = d.discountPaise != null ? rupeesOf(d.discountPaise) : '';
      return joined(billOf(d), d.mode === 'percent' && d.value != null ? `${formatNumber(d.value)}%${amount ? ` (${amount})` : ''}` : amount);
    }
    case 'PAYMENT_RECEIVED':
      return joined(billOf(d), ...paidOf(d), d.kind === 'deposit' ? 'deposit' : '', d.appointmentId ? 'taken with the appointment' : '');
    case 'REFUND_GIVEN':
      return joined(billOf(d), ...paidOf(d));
    // A correction: what it was and what it is now, and the reason (owner, 19 Oct 2026)
    case 'PAYMENT_CORRECTED':
      return joined(
        billOf(d),
        d.receipt ? `receipt ${d.receipt}` : '',
        d.before && d.after ? `${rupeesOf(d.before.amountPaise)} by ${PAYMENT_MODE_WORDS[d.before.mode] ?? d.before.mode} → ${rupeesOf(d.after.amountPaise)} by ${PAYMENT_MODE_WORDS[d.after.mode] ?? d.after.mode}` : '',
        d.timeChanged ? 'time changed' : '',
        d.reason ?? '',
      );
    case 'BILL_CANCELLED':
      return joined(billOf(d), d.totalPaise != null ? `total ${rupeesOf(d.totalPaise)}` : '');
    case 'BILL_PRINTED':
      return joined(billOf(d), d.receipt ? `receipt ${d.receipt}` : '');
    case 'PRICE_LIST_CHANGED': {
      // The item is kept as an id only
      let price = '';
      if (d.pricePaise != null) price = d.from != null && d.from !== d.pricePaise ? `price was ${rupeesOf(d.from)}, now ${rupeesOf(d.pricePaise)}` : `price ${rupeesOf(d.pricePaise)}`;
      return joined(d.added ? 'new item' : d.stopped ? 'item no longer used' : 'item changed', price);
    }
    case 'BILLING_EXPORTED':
      return joined(BILLING_EXPORT_WORDS[d.what] ?? 'export', periodOf(d), d.rows != null ? count(d.rows, 'row') : '');
    // Pharmacy (see PHARMACY_SETTING_WORDS)
    case 'PHARMACY_SETTINGS_CHANGED':
      return joined(namesOf(d.fields, PHARMACY_SETTING_WORDS));
    case 'PHARMACY_MEDICINE_CHANGED':
      return listChangeText('medicine', d);
    case 'PHARMACY_SUPPLIER_CHANGED':
      return listChangeText('supplier', d);
    case 'PHARMACY_PURCHASE_ENTERED':
      return joined(d.number, d.lines != null ? count(d.lines, 'batch', 'batches') : '', d.totalPaise != null ? rupeesOf(d.totalPaise) : '', d.order ? `order ${d.order}` : '');
    case 'PHARMACY_PURCHASE_CANCELLED':
      return d.number ?? '';
    case 'PHARMACY_STOCK_WRITTEN_OFF':
      return d.qty != null ? count(d.qty, 'unit') : '';
    case 'PHARMACY_STOCK_COUNTED':
      return joined(d.from != null && d.to != null ? `was ${count(d.from, 'unit')}, now ${formatNumber(d.to)}` : '', d.witness ? 'with a witness' : '');
    case 'PHARMACY_PRESCRIPTIONS_VIEWED':
      return joined(opened(d), d.prescriptions != null ? count(d.prescriptions, 'prescription') : '');
    case 'PHARMACY_SOLD':
    case 'PHARMACY_ISSUED':
      return joined(
        invoiceOf(d),
        d.lines != null ? count(d.lines, 'item') : '',
        d.amountPaise != null ? rupeesOf(d.amountPaise) : '',
        d.walkIn ? 'walk-in customer' : '',
        d.business ? 'business buyer' : '',
        d.controlled ? 'controlled medicine' : '',
      );
    case 'PHARMACY_INVOICE_VIEWED':
      return invoiceOf(d);
    case 'PHARMACY_RETURNED':
      return joined(d.creditNote ? `credit note ${d.creditNote}${d.number ? ` of invoice ${d.number}` : ''}` : invoiceOf(d), d.amountPaise != null ? rupeesOf(d.amountPaise) : '');
    case 'PHARMACY_PRINTED':
      return d.what === 'credit_note' ? `Credit note of ${d.number ? `invoice ${d.number}` : 'an invoice'}` : invoiceOf(d);
    case 'PHARMACY_REGISTER_VIEWED':
      return joined(`${SCHEDULE_WORDS[d.type] ?? 'Drug'} register`, periodOf(d));
    case 'PHARMACY_EXPORTED':
      return joined(PHARMACY_EXPORT_WORDS[d.what] ?? 'export', periodOf(d), d.rows != null ? count(d.rows, 'row') : '');
    default:
      return '';
  }
}

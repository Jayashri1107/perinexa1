// The audit log in plain words: entries of removed features still read sensibly. Fake data only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_LABELS, auditPill, describeAudit, doneBy } from './auditFormat.js';

describe('the audit log after the registers were removed (2 Oct 2026)', () => {
  it('old register entries still show their labels and details', () => {
    for (const action of ['REGISTER_ENTRY_CREATED', 'REGISTER_ENTRY_VIEWED', 'REGISTER_ENTRY_SAVED', 'REGISTER_ENTRY_SIGNED', 'REGISTER_ENTRY_CANCELLED', 'REGISTER_LIST_VIEWED', 'REGISTER_PRINTED', 'REGISTER_SCAN_ADDED', 'REGISTER_SCAN_OPENED']) {
      expect(AUDIT_LABELS[action], action).toMatch(/^(Register|Scan of a register)/);
    }
    expect(describeAudit({ action: 'REGISTER_ENTRY_SIGNED', details: { register: 'form_f', mrn: 'P-000001' } })).toBe('Form F (PC-PNDT) · Record P-000001');
    expect(describeAudit({ action: 'REGISTER_LIST_VIEWED', details: { register: 'mtp', month: '2026-09' } })).toBe('MTP register · 2026-09');
  });

  it('the monthly report reads "Monthly report opened · Monthly report · October 2026"', () => {
    expect(AUDIT_LABELS.REPORT_VIEWED).toBe('Monthly report opened');
    expect(describeAudit({ action: 'REPORT_VIEWED', details: { report: 'monthly', month: '2026-10' } })).toBe('Monthly report · October 2026');
    expect(describeAudit({ action: 'REPORT_VIEWED', details: {} })).toBe('Monthly report');
    expect(auditPill('REPORT_VIEWED')).toMatchObject({ tone: 'neutral' });
    expect(auditPill('REPORT_VIEWED').icon).toBeTruthy();
  });
});

describe('reminders and the worklist (4 Oct 2026)', () => {
  it('"Reminders sent now" counts the general messages too; older entries still read as before', () => {
    expect(describeAudit({ action: 'REMINDERS_RUN', details: { queued: 1, sent: 2, toSend: 0 } })).toBe('1 queued, 2 sent, 0 to send by hand');
    expect(describeAudit({ action: 'REMINDERS_RUN', details: { queued: 0, missed: 1, careDue: 2, heldBack: 3, dropped: 1, sent: 0, failed: 0, toSend: 3 } })).toBe(
      '0 queued, 1 for a missed appointment, 2 for check-ups or tests due, 0 sent, 3 to send by hand, 1 cancelled as no longer needed, 3 held back (draft care plans)',
    );
    expect(describeAudit({ action: 'REMINDERS_RUN', details: { queued: 0, missed: 0, careDue: 2, heldBack: 0, dropped: 0, waiting: 2, sent: 0, failed: 0, toSend: 0 } })).toBe(
      '0 queued, 2 for check-ups or tests due, 0 sent, 0 to send by hand, 2 waiting for the morning',
    );
  });

  it('"Worklist viewed" counts the babies with vaccinations overdue; older entries have no such count', () => {
    expect(describeAudit({ action: 'WORKLIST_VIEWED', details: { scope: 'all', redFlags: 1, carePlan: 2, seenToday: 0, vaccinations: 1 } })).toBe(
      'All patients: 1 with red flags, 2 care plans to act on, 0 visits today, 1 baby with vaccinations overdue',
    );
    expect(describeAudit({ action: 'WORKLIST_VIEWED', details: { scope: 'mine', redFlags: 0, carePlan: 0, seenToday: 0 } })).toBe('Own patients: 0 with red flags, 0 care plans to act on, 0 visits today');
  });

  it('"In hospital list viewed" has counts only: how many patients, how many with red flags', () => {
    expect(describeAudit({ action: 'INPATIENTS_VIEWED', details: { admitted: 3, flagged: 1 } })).toBe('3 patients in hospital, 1 with red flags');
    expect(describeAudit({ action: 'INPATIENTS_VIEWED', details: { admitted: 1, flagged: 0 } })).toBe('1 patient in hospital, 0 with red flags');
  });
});

describe('the medicine safety list in the audit log', () => {
  it('says the version, how many entries, and how many built-in entries a doctor added', () => {
    expect(describeAudit({ action: 'MEDICINE_SAFETY_UPDATED', details: { version: 3, entries: 108 } })).toBe('Version 3 (108 entries)');
    expect(describeAudit({ action: 'MEDICINE_SAFETY_UPDATED', details: { version: 2, entries: 108, added: 73 } })).toBe('Version 2 (108 entries) – 73 built-in entries added');
    expect(describeAudit({ action: 'MEDICINE_SAFETY_UPDATED', details: { version: 2, entries: 36, added: 1 } })).toBe('Version 2 (36 entries) – 1 built-in entry added');
  });
});

describe('pregnancy-loss findings in the audit log (5 Oct 2026)', () => {
  it('names the field in plain words – never which finding, nor its value', () => {
    expect(describeAudit({ action: 'PATIENT_UPDATED', details: { patientId: 'p1', mrn: 'P-000001', fields: ['abortion.findings'] } })).toBe('Record P-000001: Findings of the pregnancy loss');
    expect(describeAudit({ action: 'PATIENT_UPDATED', details: { patientId: 'p1', mrn: 'P-000001', fields: ['abortion.lmp', 'abortion.findings', 'pregnancy.findings'] } })).toBe(
      'Record P-000001: LMP, Findings of the pregnancy loss, Findings in this pregnancy',
    );
  });
});

describe('duplicate records in the audit log (4 Oct 2026)', () => {
  it('names the records by number, with counts – never a name, a phone number or the reason', () => {
    expect(AUDIT_LABELS.PATIENT_REGISTERED_ANYWAY).toBe('Registered as new although a record matched');
    expect(AUDIT_LABELS.PATIENT_MARKED_DUPLICATE).toBe('Record marked as a duplicate');
    expect(AUDIT_LABELS.PATIENT_DUPLICATE_UNDONE).toBe('Duplicate marking undone');
    expect(describeAudit({ action: 'PATIENT_REGISTERED_ANYWAY', details: { patientId: 'x', mrn: 'P-000002', matches: 1, matchIds: ['y'] } })).toBe('Record P-000002 – 1 matching record was shown');
    expect(describeAudit({ action: 'PATIENT_REGISTERED_ANYWAY', details: { mrn: 'P-000009', matches: 3 } })).toBe('Record P-000009 – 3 matching records were shown');
    expect(describeAudit({ action: 'PATIENT_MARKED_DUPLICATE', details: { mrn: 'P-000002', mainMrn: 'P-000001', appointmentsMoved: 0 } })).toBe('Record P-000002: duplicate of P-000001');
    expect(describeAudit({ action: 'PATIENT_MARKED_DUPLICATE', details: { mrn: 'P-000002', mainMrn: 'P-000001', appointmentsMoved: 2 } })).toBe('Record P-000002: duplicate of P-000001 – 2 appointments moved to the main record');
    expect(describeAudit({ action: 'PATIENT_DUPLICATE_UNDONE', details: { mrn: 'P-000002', mainMrn: 'P-000001', appointmentsMoved: 1 } })).toBe('Record P-000002: no longer a duplicate of P-000001 – 1 appointment moved back');
    // The super admin's log holds no record numbers
    expect(describeAudit({ action: 'PATIENT_MARKED_DUPLICATE', details: { appointmentsMoved: 1 } })).toBe('A patient record – 1 appointment moved to the main record');
    expect(describeAudit({ action: 'PATIENT_REGISTERED_ANYWAY', details: { matches: 2 } })).toBe('A patient record – 2 matching records were shown');
    expect(auditPill('PATIENT_MARKED_DUPLICATE')).toMatchObject({ tone: 'neutral' });
  });
});

describe('the copy of a whole record in the audit log', () => {
  it('says "Full record copied" with the record number and the access – never what the copy held', () => {
    expect(AUDIT_LABELS.PATIENT_RECORD_COPIED).toBe('Full record copied');
    expect(AUDIT_LABELS.PATIENT_RECORD_COPY_PRINTED).toBe('Copy of the whole record printed');
    expect(AUDIT_LABELS.PATIENT_RECORD_COPY_PDF_SAVED).toBe('Copy of the whole record saved as PDF');
    for (const action of ['PATIENT_RECORD_COPIED', 'PATIENT_RECORD_COPY_PRINTED', 'PATIENT_RECORD_COPY_PDF_SAVED']) {
      expect(describeAudit({ action, details: { patientId: 'abc', mrn: 'P-000007', access: 'full' } })).toBe('Record P-000007 (full access)');
      // the super admin's log has no record number
      expect(describeAudit({ action, details: { access: 'full' } })).toBe('A patient record (full access)');
      expect(auditPill(action)).toMatchObject({ tone: 'neutral' });
      expect(auditPill(action).icon).toBeTruthy();
    }
  });
});

describe('pharmacy extras in the audit log (4 Oct 2026)', () => {
  it('orders, returns to a supplier and the e-invoice file read in plain words – numbers only', () => {
    const actions = ['PHARMACY_ORDER_CREATED', 'PHARMACY_ORDER_CHANGED', 'PHARMACY_ORDER_SENT', 'PHARMACY_ORDER_RECEIVED', 'PHARMACY_ORDER_CLOSED', 'PHARMACY_ORDER_CANCELLED', 'PHARMACY_ORDER_PRINTED', 'PHARMACY_SUPPLIER_RETURNED', 'PHARMACY_SUPPLIER_RETURN_CANCELLED', 'PHARMACY_DEBIT_NOTE_PRINTED', 'PHARMACY_EINVOICE_DOWNLOADED'];
    for (const action of actions) expect(AUDIT_LABELS[action], action).toBeTruthy();
    expect(describeAudit({ action: 'PHARMACY_ORDER_CREATED', details: { orderId: 'x', number: 'PO-000001', supplierId: 's', lines: 3 } })).toBe('PO-000001 · 3 medicines');
    expect(describeAudit({ action: 'PHARMACY_ORDER_SENT', details: { orderId: 'x', number: 'PO-000001' } })).toBe('PO-000001');
    expect(describeAudit({ action: 'PHARMACY_ORDER_RECEIVED', details: { orderId: 'x', number: 'PO-000001', purchaseId: 'p', purchase: 'PU-000004', status: 'part_received' } })).toBe('PO-000001 · purchase PU-000004 · now part received');
    expect(describeAudit({ action: 'PHARMACY_SUPPLIER_RETURNED', details: { returnId: 'r', number: 'SR-000001', supplierId: 's', reason: 'expired', lines: 2, qty: 50, amountPaise: 3185050, controlled: true } })).toBe(
      'SR-000001 · 50 units in 2 batches · ₹31,850.50 · expired · controlled medicine',
    );
    expect(describeAudit({ action: 'PHARMACY_SUPPLIER_RETURNED', details: { number: 'SR-000002', reason: 'wrong_item', lines: 1, qty: 1, amountPaise: 1000, controlled: false } })).toBe('SR-000002 · 1 unit in 1 batch · ₹10 · wrong item');
    expect(describeAudit({ action: 'PHARMACY_DEBIT_NOTE_PRINTED', details: { returnId: 'r', number: 'SR-000001' } })).toBe('SR-000001');
    // A return entered by mistake and cancelled: its number, what came back and the amount – never the reason typed
    expect(describeAudit({ action: 'PHARMACY_SUPPLIER_RETURN_CANCELLED', details: { returnId: 'r', number: 'SR-000001', supplierId: 's', lines: 2, qty: 50, amountPaise: 3185050, controlled: true } })).toBe('SR-000001 · 50 units back in stock · ₹31,850.50 · controlled medicine');
    // A purchase saved while its order was cancelled or closed: said plainly
    expect(describeAudit({ action: 'PHARMACY_ORDER_RECEIVED', details: { orderId: 'x', number: 'PO-000001', purchaseId: 'p', purchase: 'PU-000004', status: 'cancelled', notCounted: 'cancelled' } })).toBe('PO-000001 · purchase PU-000004 · not counted: the order was cancelled at the same moment');
    expect(describeAudit({ action: 'PHARMACY_ORDER_RECEIVED', details: { number: 'PO-000002', purchase: 'PU-000005', status: 'part_received', notCounted: 'closed' } })).toBe('PO-000002 · purchase PU-000005 · not counted: the order was closed at the same moment');
    expect(describeAudit({ action: 'PHARMACY_EINVOICE_DOWNLOADED', details: { invoiceId: 'i', number: 'PH-000007', document: 'INV' } })).toBe('Invoice PH-000007');
    expect(describeAudit({ action: 'PHARMACY_EINVOICE_DOWNLOADED', details: { invoiceId: 'i', number: 'PH-000007', document: 'CRN', creditNote: 'CN-000002' } })).toBe('Credit note CN-000002 of invoice PH-000007');
    expect(auditPill('PHARMACY_SUPPLIER_RETURNED')).toMatchObject({ tone: 'neutral' });
  });
});

describe('the Tally link in the audit log (16 Oct 2026)', () => {
  it('batches, files and entry statuses read in plain words – numbers, counts and status words, never an account name or a note', () => {
    for (const action of ['TALLY_SETTINGS_CHANGED', 'TALLY_BATCH_CREATED', 'TALLY_FILE_DOWNLOADED', 'TALLY_VOUCHER_STATUS']) expect(AUDIT_LABELS[action], action).toBeTruthy();
    expect(describeAudit({ action: 'TALLY_SETTINGS_CHANGED', details: { fields: ['companyName', 'ledgers'] } })).toBe('Tally company, account names');
    expect(describeAudit({ action: 'TALLY_BATCH_CREATED', details: { batchId: 'x', number: 'TB-000001', from: '2026-09-01', to: '2026-09-28', vouchers: 5 } })).toBe('Batch TB-000001 · 1 Sep 2026 to 28 Sep 2026 · 5 entries');
    expect(describeAudit({ action: 'TALLY_FILE_DOWNLOADED', details: { batchId: 'x', number: 'TB-000001', part: 'masters' } })).toBe('Batch TB-000001 · account names file');
    expect(describeAudit({ action: 'TALLY_VOUCHER_STATUS', details: { voucherId: 'v', key: 'B-000001/CN1', status: 'failed' } })).toBe('Entry B-000001/CN1 · refused by Tally');
    expect(describeAudit({ action: 'TALLY_VOUCHER_STATUS', details: { batchId: 'x', number: 'TB-000001', status: 'imported', count: 5 } })).toBe('Batch TB-000001 · imported · 5 entries');
    // The super admin's log holds no batch or entry number
    expect(describeAudit({ action: 'TALLY_BATCH_CREATED', details: { from: '2026-09-01', to: '2026-09-28', vouchers: 1 } })).toBe('A batch · 1 Sep 2026 to 28 Sep 2026 · 1 entry');
    expect(describeAudit({ action: 'TALLY_VOUCHER_STATUS', details: { status: 'skipped' } })).toBe('Entries · skipped');
  });
});

describe('billing extras in the audit log (4 Oct 2026)', () => {
  it('insurance details, claim forms, UPI links and the billing settings read in plain words – names of details only', () => {
    for (const action of ['BILL_INSURANCE_CHANGED', 'CLAIM_FORM_PRINTED', 'UPI_LINK_MADE', 'BILLING_SETTINGS_CHANGED']) expect(AUDIT_LABELS[action], action).toBeTruthy();
    expect(describeAudit({ action: 'BILL_INSURANCE_CHANGED', details: { billId: 'b', number: 'B-000007', patientId: 'p', fields: ['insurer', 'policyNumber', 'pmjayId'] } })).toBe('Bill B-000007 · insurer, policy or member number, PM-JAY ID');
    expect(describeAudit({ action: 'BILL_INSURANCE_CHANGED', details: { billId: 'b', number: 'B-000007', patientId: 'p', fields: ['insurer'], removed: true } })).toBe('Bill B-000007 · details taken off');
    expect(describeAudit({ action: 'BILL_INSURANCE_CHANGED', details: { billId: 'b', number: 'B-000007', patientId: 'p', fields: ['insurer'], via: 'payment' } })).toBe('Bill B-000007 · insurer · noted from a payment by insurance');
    expect(describeAudit({ action: 'CLAIM_FORM_PRINTED', details: { billId: 'b', number: 'B-000007', patientId: 'p', layout: 'pmjay' } })).toBe('Bill B-000007 · PM-JAY claim sheet');
    expect(describeAudit({ action: 'CLAIM_FORM_PRINTED', details: { billId: 'b', number: 'B-000007', patientId: 'p', layout: 'claim' } })).toBe('Bill B-000007 · claim form');
    expect(describeAudit({ action: 'UPI_LINK_MADE', details: { billId: 'b', number: 'B-000007', patientId: 'p' } })).toBe('Bill B-000007');
    // No UPI ID in the log: the entry points to where each change is kept, with who made it and when
    expect(describeAudit({ action: 'BILLING_SETTINGS_CHANGED', details: { fields: ['upiId', 'payeeName'] } })).toBe('UPI ID, payee name · what it was set to is listed under Billing → Settings');
    expect(describeAudit({ action: 'BILLING_SETTINGS_CHANGED', details: {} })).toBe('');
    // The super admin's log holds no bill number
    expect(describeAudit({ action: 'UPI_LINK_MADE', details: {} })).toBe('A bill');
    expect(describeAudit({ action: 'BILL_INSURANCE_CHANGED', details: { fields: ['claimNumber'] } })).toBe('A bill · claim number');
    expect(auditPill('UPI_LINK_MADE')).toMatchObject({ tone: 'neutral' });
  });
});

describe('a record closed after a death, in the audit log (5 Oct 2026)', () => {
  it('is named in plain words with counts only – never which record, or why', () => {
    expect(AUDIT_LABELS.PATIENT_RECORD_CLOSED).toBe('Record closed by a doctor');
    expect(AUDIT_LABELS.PATIENT_RECORD_REOPENED).toBe('Closed record reopened (recorded in error)');
    expect(describeAudit({ action: 'PATIENT_RECORD_CLOSED', details: { appointmentsCancelled: 2, messagesCancelled: 1, portalEnded: 1 } })).toBe(
      '2 appointments cancelled · 1 waiting message stopped · patient portal access ended',
    );
    expect(describeAudit({ action: 'PATIENT_RECORD_CLOSED', details: { appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0 } })).toBe('Nothing booked or waiting');
    expect(describeAudit({ action: 'PATIENT_RECORD_REOPENED', details: {} })).toBe('');
    expect(auditPill('PATIENT_RECORD_CLOSED')).toMatchObject({ tone: 'neutral' });
    expect(auditPill('PATIENT_RECORD_CLOSED').icon).toBeTruthy();
    for (const [action, d] of [['PATIENT_RECORD_CLOSED', { appointmentsCancelled: 1 }], ['PATIENT_RECORD_REOPENED', {}]]) {
      expect(describeAudit({ action, details: d })).not.toMatch(/death|died|P-0/i);
    }
  });

  it('a change to a baby\'s care after birth is named as that one section', () => {
    expect(describeAudit({ action: 'PATIENT_UPDATED', details: { mrn: 'P-000009', fields: ['newbornCare'] } })).toMatch(/Care after birth/);
    expect(describeAudit({ action: 'PATIENT_UPDATED', details: { mrn: 'P-000009', fields: ['newbornCare'] } })).not.toMatch(/newbornCare|NICU/);
  });
});

describe('Analytics opened (Deliveries tab, 5 Oct 2026)', () => {
  it('names the tab and whose numbers – never a number', () => {
    expect(describeAudit({ action: 'ANALYTICS_VIEWED', details: { section: 'deliveries', scope: 'hospital' } })).toBe('Deliveries tab · Whole hospital');
    expect(describeAudit({ action: 'ANALYTICS_VIEWED', details: { section: 'deliveries', scope: 'platform', hospital: 'all' } })).toBe('Deliveries tab · All hospitals');
    expect(describeAudit({ action: 'ANALYTICS_VIEWED', details: { section: 'newborn', scope: 'mine' } })).toBe('Newborn tab · My patients');
  });
});

describe("a hospital's data taken out by the person who runs the server", () => {
  it('is named as the brief says, with counts only, and "Server operator" as who did it', () => {
    expect(AUDIT_LABELS.HOSPITAL_DATA_EXPORTED).toBe('Hospital data exported by the server operator');
    const entry = { action: 'HOSPITAL_DATA_EXPORTED', actorEmail: null, details: { patients: 3, records: 1240, files: 1, counts: { patients: 3, visits: 12 } } };
    expect(describeAudit(entry)).toBe('3 patients – 1,240 records in all and 1 stored file, written to a folder on the server');
    expect(describeAudit({ action: 'HOSPITAL_DATA_EXPORTED', details: {} })).toBe('');
    expect(doneBy(entry)).toBe('Server operator');
    // everyone else is still named by their e-mail address, or not at all
    expect(doneBy({ action: 'LOGIN_FAILED', actorEmail: null })).toBeNull();
    expect(doneBy({ action: 'PATIENT_VIEWED', actorEmail: 'doctor@example.com' })).toBe('doctor@example.com');
    expect(auditPill('HOSPITAL_DATA_EXPORTED')).toMatchObject({ tone: 'brand' });
    expect(auditPill('HOSPITAL_DATA_EXPORTED').icon).toBeTruthy();
  });
});

describe('printouts for the patient in Marathi or Hindi (5 Oct 2026)', () => {
  it('say when Marathi or Hindi was printed next to the English; older and English-only entries read as before', () => {
    expect(describeAudit({ action: 'CARE_PLAN_PRINTED', details: { mrn: 'P-000003', copy: 'patient' } })).toBe('Record P-000003: patient copy');
    expect(describeAudit({ action: 'CARE_PLAN_PRINTED', details: { mrn: 'P-000003', copy: 'patient', language: 'mr' } })).toBe('Record P-000003: patient copy, in English and Marathi');
    expect(describeAudit({ action: 'CARE_PLAN_PRINTED', details: { mrn: 'P-000003', copy: 'staff' } })).toBe('Record P-000003: staff copy');
    expect(describeAudit({ action: 'DOCUMENT_PRINTED', details: { mrn: 'P-000003', kind: 'discharge', language: 'hi' } })).toBe('Record P-000003, in English and Hindi');
    expect(describeAudit({ action: 'DOCUMENT_PRINTED', details: { mrn: 'P-000003', kind: 'round' } })).toBe('Record P-000003');
    // An unknown value is never shown as it is
    expect(describeAudit({ action: 'DOCUMENT_PRINTED', details: { mrn: 'P-000003', language: '<b>x</b>' } })).toBe('Record P-000003');
  });
});

describe('care-plan protocols in the audit log (5 Oct 2026)', () => {
  it("a doctor's default protocol: the protocol's name and version, never a patient", () => {
    expect(AUDIT_LABELS.TEMPLATE_DEFAULT_SET).toBe("Protocol made a doctor's default");
    expect(AUDIT_LABELS.TEMPLATE_DEFAULT_REMOVED).toBe("Protocol no longer a doctor's default");
    expect(describeAudit({ action: 'TEMPLATE_DEFAULT_SET', details: { templateId: 't1', name: 'Sample antenatal protocol', version: 2, careType: 'antenatal', replacedTemplateId: null } })).toBe(
      'Sample antenatal protocol (version 2)',
    );
    expect(describeAudit({ action: 'TEMPLATE_DEFAULT_REMOVED', details: { templateId: 't1', name: 'Sample antenatal protocol', version: 3 } })).toBe('Sample antenatal protocol (version 3)');
  });

  it('an edit of an item a doctor added: the record and plain words only', () => {
    expect(describeAudit({ action: 'CARE_PLAN_CHANGED', details: { patientId: 'p1', mrn: 'P-000001', planId: 'c1', change: 'item_edited', itemId: 'i1' } })).toBe('Record P-000001: added item edited');
    // every plan moved by "Update all plans" is one entry as a single update
    expect(describeAudit({ action: 'CARE_PLAN_CHANGED', details: { patientId: 'p1', mrn: 'P-000001', planId: 'c1', change: 'plan_changed' } })).toBe('Record P-000001: plan updated');
  });
});

describe('ABDM (ABHA) in the audit log', () => {
  it('every ABDM event has a label; M1 events read as the record and how', () => {
    const actions = ['ABHA_VERIFIED', 'ABHA_LINKED', 'ABHA_CREATED', 'ABHA_UNLINKED', 'ABHA_VIEWED', 'ABHA_CARD_PRINTED', 'ABDM_SCAN_SHARE_RECEIVED', 'ABDM_SCAN_SHARE_HANDLED', 'ABDM_SETTINGS_CHANGED', 'ABDM_RECORDS_VIEWED', 'ABDM_RECORDS_LINKED', 'ABDM_RECORDS_DISCOVERED', 'ABDM_CONSENT_RECEIVED', 'ABDM_RECORDS_SHARED', 'ABDM_SHARE_REFUSED'];
    for (const action of actions) expect(AUDIT_LABELS[action], action).toBeTruthy();
    expect(describeAudit({ action: 'ABHA_LINKED', details: { patientId: 'p', mrn: 'P-000003', method: 'verified' } })).toBe('Record P-000003 · verified by OTP');
    // The reason typed when unlinking is never shown
    expect(describeAudit({ action: 'ABHA_UNLINKED', details: { patientId: 'p', mrn: 'P-000003', reason: 'Wrong person' } })).toBe('Record P-000003');
    expect(describeAudit({ action: 'ABDM_SETTINGS_CHANGED', details: { fields: ['hipId', 'counterCode'] } })).toBe('HIP ID, Scan & Share counter code');
  });

  it('sharing her records: counts only – never which records, what was sent or to whom', () => {
    expect(describeAudit({ action: 'ABDM_RECORDS_LINKED', details: { mrn: 'P-000003', records: 3, via: 'hospital', status: 'linked', practice: true } })).toBe('Record P-000003: 3 records linked by the hospital (practice mode, nothing left the computer)');
    expect(describeAudit({ action: 'ABDM_RECORDS_LINKED', details: { mrn: 'P-000003', records: 1, via: 'patient', status: 'linked' } })).toBe('Record P-000003: 1 record linked from her ABHA app');
    expect(describeAudit({ action: 'ABDM_RECORDS_LINKED', details: { mrn: 'P-000003', records: 2, via: 'hospital', status: 'waiting' } })).toBe('Record P-000003: 2 records linked by the hospital – waiting for ABDM');
    expect(describeAudit({ action: 'ABDM_RECORDS_DISCOVERED', details: { found: false, offered: 0 } })).toBe('No record here has that ABHA');
    expect(describeAudit({ action: 'ABDM_CONSENT_RECEIVED', details: { mrn: 'P-000003', consentId: 'c', status: 'REVOKED', records: 3 } })).toBe('Record P-000003: consent withdrawn for 3 records');
    expect(describeAudit({ action: 'ABDM_CONSENT_RECEIVED', details: { mrn: 'P-000003', consentId: 'c', status: 'GRANTED', ignored: true, records: 3 } })).toBe('Record P-000003: consent given for 3 records – ignored, it had already ended');
    expect(describeAudit({ action: 'ABDM_SHARE_REFUSED', details: { mrn: 'P-000003', refusal: 'consent_incomplete' } })).toBe('Record P-000003: nothing sent – the consent did not say its dates or until when it lasts');
    expect(describeAudit({ action: 'ABDM_RECORDS_SHARED', details: { mrn: 'P-000003', consentId: 'c', records: 2, documents: 3, heldBack: 1 } })).toBe('Record P-000003: 2 records sent (3 documents), 1 held back');
    expect(describeAudit({ action: 'ABDM_SHARE_REFUSED', details: { mrn: 'P-000003', refusal: 'consent_expired' } })).toBe('Record P-000003: nothing sent – the consent had expired');
    // The super admin's log has no record number
    expect(describeAudit({ action: 'ABDM_RECORDS_SHARED', details: { records: 2, documents: 3 } })).toBe('A patient record: 2 records sent (3 documents)');
    expect(auditPill('ABDM_RECORDS_SHARED')).toMatchObject({ tone: 'neutral' });
    expect(auditPill('ABDM_RECORDS_SHARED').icon).toBeTruthy();
  });

  it('her records from other hospitals (M3): counts only – never which hospital or what the records say', () => {
    for (const action of ['ABDM_FETCH_REQUESTED', 'ABDM_FETCH_ANSWERED', 'ABDM_RECORDS_FETCHED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_DELETED']) expect(AUDIT_LABELS[action], action).toBeTruthy();
    expect(describeAudit({ action: 'ABDM_FETCH_REQUESTED', details: { mrn: 'P-000003', requestId: 'r', types: 5, days: 30, practice: true } })).toBe('Record P-000003: 5 kinds of record, consent for 30 days (practice mode)');
    expect(describeAudit({ action: 'ABDM_FETCH_ANSWERED', details: { mrn: 'P-000003', status: 'GRANTED', hospitals: 2 } })).toBe('Record P-000003: she agreed – 2 hospitals');
    expect(describeAudit({ action: 'ABDM_FETCH_ANSWERED', details: { mrn: 'P-000003', status: 'DENIED', hospitals: 0 } })).toBe('Record P-000003: she refused');
    expect(describeAudit({ action: 'ABDM_RECORDS_FETCHED', details: { mrn: 'P-000003', documents: 3, files: 1, withheld: 1, failed: 0 } })).toBe('Record P-000003: 3 documents received – 1 file, 1 sentence withheld (PC-PNDT)');
    expect(describeAudit({ action: 'ABDM_RECORDS_FETCHED', details: { mrn: 'P-000003', documents: 1, failed: 2 } })).toBe('Record P-000003: 1 document received – 2 could not be read');
    expect(describeAudit({ action: 'ABDM_FETCHED_VIEWED', details: { mrn: 'P-000003', documents: 5 } })).toBe('Record P-000003 – the list (5 documents)');
    expect(describeAudit({ action: 'ABDM_FETCHED_VIEWED', details: { mrn: 'P-000003', recordId: 'd' } })).toBe('Record P-000003 – one document');
    expect(describeAudit({ action: 'ABDM_FETCHED_VIEWED', details: { mrn: 'P-000003', recordId: 'd', fileId: 'f' } })).toBe('Record P-000003 – an attached file downloaded');
    expect(describeAudit({ action: 'ABDM_FETCHED_DELETED', details: { mrn: 'P-000003', documents: 3, files: 1, why: 'expired' } })).toBe('Record P-000003: 3 documents and 1 file deleted – her consent ended');
    expect(describeAudit({ action: 'ABDM_FETCHED_DELETED', details: { mrn: 'P-000003', documents: 2, why: 'revoked' } })).toBe('Record P-000003: 2 documents deleted – she withdrew her consent');
    // The super admin's log has no record number
    expect(describeAudit({ action: 'ABDM_FETCHED_DELETED', details: { documents: 2, why: 'expired' } })).toBe('A patient record: 2 documents deleted – her consent ended');
    expect(auditPill('ABDM_RECORDS_FETCHED').icon).toBeTruthy();
    for (const action of ['ABDM_FETCH_REQUESTED', 'ABDM_FETCHED_DELETED']) expect(AUDIT_LABELS[action]).not.toMatch(/!/);
  });
});

describe('billing in the audit log (5 Oct 2026)', () => {
  it('bills and payments read in plain words – numbers and amounts, never a reason that was typed', () => {
    const bill = { billId: 'b', number: 'B-000007', patientId: 'p' };
    expect(AUDIT_LABELS.PAYMENT_RECEIVED).toBe('Payment received');
    expect(AUDIT_LABELS.BILL_ITEM_REMOVED).toBe('Item taken off a bill');
    expect(describeAudit({ action: 'BILL_VIEWED', details: bill })).toBe('Bill B-000007');
    expect(describeAudit({ action: 'BILL_VIEWED', details: { ...bill, claimForm: true } })).toBe('Bill B-000007 · claim form opened');
    expect(describeAudit({ action: 'BILL_ITEM_ADDED', details: { ...bill, priceItemId: 'i', amountPaise: 50000 } })).toBe('Bill B-000007 · ₹500');
    expect(describeAudit({ action: 'BILL_ITEM_REMOVED', details: { ...bill, amountPaise: 120050, reason: 'Added by mistake' } })).toBe('Bill B-000007 · ₹1,200.50');
    expect(describeAudit({ action: 'DISCOUNT_GIVEN', details: { ...bill, mode: 'percent', value: 10, discountPaise: 5000, reason: 'Staff family' } })).toBe('Bill B-000007 · 10% (₹50)');
    expect(describeAudit({ action: 'DISCOUNT_GIVEN', details: { ...bill, mode: 'amount', value: 20000, discountPaise: 20000, reason: 'Staff family' } })).toBe('Bill B-000007 · ₹200');
    expect(describeAudit({ action: 'DISCOUNT_GIVEN', details: { ...bill, mode: 'amount', value: 0, discountPaise: 0, reason: '' } })).toBe('Bill B-000007 · discount taken off');
    expect(describeAudit({ action: 'PAYMENT_RECEIVED', details: { ...bill, receipt: 'R-000012', kind: 'payment', mode: 'upi', amountPaise: 75000 } })).toBe('Bill B-000007 · receipt R-000012 · ₹750 by UPI');
    expect(describeAudit({ action: 'PAYMENT_RECEIVED', details: { ...bill, receipt: 'R-000013', kind: 'deposit', mode: 'cash', amountPaise: 500000 } })).toBe('Bill B-000007 · receipt R-000013 · ₹5,000 by cash · deposit');
    // The fee taken when an appointment is booked
    expect(describeAudit({ action: 'PAYMENT_RECEIVED', details: { ...bill, appointmentId: 'a', receipt: 'R-000014', kind: 'payment', mode: 'card', amountPaise: 50000 } })).toBe('Bill B-000007 · receipt R-000014 · ₹500 by card · taken with the appointment');
    expect(describeAudit({ action: 'PAYMENT_CORRECTED', details: { ...bill, receipt: 'R-000015', before: { mode: 'upi', amountPaise: 50000 }, after: { mode: 'cash', amountPaise: 50000 }, timeChanged: false, reason: 'UPI failed' } })).toBe(
      'Bill B-000007 · receipt R-000015 · ₹500 by UPI → ₹500 by cash · UPI failed',
    );
    expect(describeAudit({ action: 'REFUND_GIVEN', details: { ...bill, receipt: 'R-000015', kind: 'refund', mode: 'cash', amountPaise: 20000 } })).toBe('Bill B-000007 · receipt R-000015 · ₹200 by cash');
    expect(describeAudit({ action: 'BILL_CANCELLED', details: { ...bill, reason: 'Opened for the wrong patient', totalPaise: 150000 } })).toBe('Bill B-000007 · total ₹1,500');
    expect(describeAudit({ action: 'BILL_PRINTED', details: bill })).toBe('Bill B-000007');
    expect(describeAudit({ action: 'BILL_PRINTED', details: { ...bill, receipt: 'R-000012' } })).toBe('Bill B-000007 · receipt R-000012');
  });

  it('the price list and the export for the accountant say what changed, the amounts and the period', () => {
    expect(describeAudit({ action: 'PRICE_LIST_CHANGED', details: { priceItemId: 'i', pricePaise: 50000, added: true } })).toBe('New item · price ₹500');
    expect(describeAudit({ action: 'PRICE_LIST_CHANGED', details: { priceItemId: 'i', from: 40000, pricePaise: 50000 } })).toBe('Item changed · price was ₹400, now ₹500');
    expect(describeAudit({ action: 'PRICE_LIST_CHANGED', details: { priceItemId: 'i', from: 50000, pricePaise: 50000, stopped: true } })).toBe('Item no longer used · price ₹500');
    expect(describeAudit({ action: 'BILLING_EXPORTED', details: { what: 'payments', from: '2026-09-01', to: '2026-09-30', rows: 42 } })).toBe('Payments · 1 Sep 2026 to 30 Sep 2026 · 42 rows');
    expect(describeAudit({ action: 'BILLING_EXPORTED', details: { what: 'items', from: '2026-10-05', to: '2026-10-05', rows: 1 } })).toBe('Bill items · 5 Oct 2026 · 1 row');
  });

  it("the super admin's log holds no bill number and no amount: it reads \"A bill\"", () => {
    for (const action of ['BILL_VIEWED', 'BILL_ITEM_ADDED', 'BILL_ITEM_REMOVED', 'DISCOUNT_GIVEN', 'PAYMENT_RECEIVED', 'REFUND_GIVEN', 'BILL_CANCELLED', 'BILL_PRINTED']) {
      expect(describeAudit({ action, details: {} }), action).toBe('A bill');
    }
  });
});

describe('the pharmacy in the audit log (5 Oct 2026)', () => {
  it('settings, medicines and suppliers: what was saved – never a name, a licence number or a barcode', () => {
    expect(describeAudit({ action: 'PHARMACY_SETTINGS_CHANGED', details: { fields: ['name', 'gstin', 'licence20', 'rmi', 'pin'] } })).toBe('Pharmacy name, GSTIN, drug licence (Form 20), NDPS recognition (RMI) number, PIN code');
    expect(describeAudit({ action: 'PHARMACY_MEDICINE_CHANGED', details: { medicineId: 'm', added: true, schedule: 'H1', barcodes: 2 } })).toBe('A medicine added · Schedule H1 · 2 barcodes');
    expect(describeAudit({ action: 'PHARMACY_MEDICINE_CHANGED', details: { medicineId: 'm', added: true, schedule: '' } })).toBe('A medicine added');
    expect(describeAudit({ action: 'PHARMACY_MEDICINE_CHANGED', details: { medicineId: 'm', fields: ['name', 'generic', 'form', 'strength', 'unit', 'hsn', 'gstRate', 'schedule', 'reorderLevel', 'barcodes'], barcodes: 1 } })).toBe("A medicine's details saved · 1 barcode");
    // "Stop using" or "Use again"
    expect(describeAudit({ action: 'PHARMACY_MEDICINE_CHANGED', details: { medicineId: 'm', fields: ['active'] } })).toBe('A medicine stopped or brought back into use');
    expect(describeAudit({ action: 'PHARMACY_SUPPLIER_CHANGED', details: { supplierId: 's', added: true } })).toBe('A supplier added');
    expect(describeAudit({ action: 'PHARMACY_SUPPLIER_CHANGED', details: { supplierId: 's', fields: ['name', 'gstin', 'drugLicence', 'phone', 'address'] } })).toBe("A supplier's details saved");
  });

  it('purchases and stock: numbers, counts and amounts – never the reason or the witness typed', () => {
    expect(describeAudit({ action: 'PHARMACY_PURCHASE_ENTERED', details: { purchaseId: 'p', number: 'PU-000004', lines: 3, totalPaise: 1234500, orderId: 'o', order: 'PO-000001' } })).toBe('PU-000004 · 3 batches · ₹12,345 · order PO-000001');
    expect(describeAudit({ action: 'PHARMACY_PURCHASE_ENTERED', details: { purchaseId: 'p', number: 'PU-000005', lines: 1, totalPaise: 9950 } })).toBe('PU-000005 · 1 batch · ₹99.50');
    expect(describeAudit({ action: 'PHARMACY_PURCHASE_CANCELLED', details: { purchaseId: 'p', number: 'PU-000004', reason: 'Entered twice' } })).toBe('PU-000004');
    expect(describeAudit({ action: 'PHARMACY_STOCK_WRITTEN_OFF', details: { medicineId: 'm', batchId: 'b', qty: 10, reason: 'Strips damaged' } })).toBe('10 units');
    expect(describeAudit({ action: 'PHARMACY_STOCK_COUNTED', details: { medicineId: 'm', batchId: 'b', from: 50, to: 48, reason: 'Counted again', witness: 'Sister Test' } })).toBe('Was 50 units, now 48 · with a witness');
    expect(describeAudit({ action: 'PHARMACY_STOCK_COUNTED', details: { medicineId: 'm', batchId: 'b', from: 1, to: 2, reason: 'Counted again' } })).toBe('Was 1 unit, now 2');
  });

  it('sales, issues, returns, printouts, registers and the export', () => {
    expect(describeAudit({ action: 'PHARMACY_PRESCRIPTIONS_VIEWED', details: { patientId: 'p', mrn: 'P-000003', prescriptions: 2 } })).toBe('Record P-000003 · 2 prescriptions');
    expect(describeAudit({ action: 'PHARMACY_SOLD', details: { invoiceId: 'i', number: 'PH-000007', walkIn: true, business: true, lines: 3, amountPaise: 45000, controlled: false } })).toBe('Invoice PH-000007 · 3 items · ₹450 · walk-in customer · business buyer');
    expect(describeAudit({ action: 'PHARMACY_ISSUED', details: { invoiceId: 'i', number: 'PH-000008', patientId: 'p', lines: 1, amountPaise: 12050, controlled: true } })).toBe('Invoice PH-000008 · 1 item · ₹120.50 · controlled medicine');
    expect(describeAudit({ action: 'PHARMACY_INVOICE_VIEWED', details: { invoiceId: 'i', number: 'PH-000007' } })).toBe('Invoice PH-000007');
    expect(describeAudit({ action: 'PHARMACY_RETURNED', details: { invoiceId: 'i', number: 'PH-000007', creditNote: 'CN-000002', amountPaise: 12000, reason: 'Wrong strength' } })).toBe('Credit note CN-000002 of invoice PH-000007 · ₹120');
    expect(describeAudit({ action: 'PHARMACY_PRINTED', details: { invoiceId: 'i', number: 'PH-000007', what: 'invoice' } })).toBe('Invoice PH-000007');
    expect(describeAudit({ action: 'PHARMACY_PRINTED', details: { invoiceId: 'i', number: 'PH-000007', what: 'credit_note' } })).toBe('Credit note of invoice PH-000007');
    expect(describeAudit({ action: 'PHARMACY_REGISTER_VIEWED', details: { type: 'narcotic', from: '2026-09-01', to: '2026-09-30' } })).toBe('Narcotic (NDPS) register · 1 Sep 2026 to 30 Sep 2026');
    expect(describeAudit({ action: 'PHARMACY_REGISTER_VIEWED', details: { type: 'H1', from: '2026-10-01', to: '2026-10-05' } })).toBe('Schedule H1 register · 1 Oct 2026 to 5 Oct 2026');
    expect(describeAudit({ action: 'PHARMACY_PATIENT_LOOKED_UP', details: { by: 'phone', patientIds: ['p1'], walkInBills: 2 } })).toBe('By phone number · 1 record · 2 walk-in bills');
    expect(describeAudit({ action: 'PHARMACY_EXPORTED', details: { what: 'supplier_returns', from: '2026-09-01', to: '2026-09-30', rows: 0 } })).toBe('Returns to suppliers · 1 Sep 2026 to 30 Sep 2026 · 0 rows');
    expect(describeAudit({ action: 'PHARMACY_EXPORTED', details: { what: 'sales', from: '2026-09-01', to: '2026-09-30', rows: 120 } })).toBe('Sales with GST · 1 Sep 2026 to 30 Sep 2026 · 120 rows');
  });

  it("the super admin's log holds no invoice or patient number", () => {
    for (const action of ['PHARMACY_SOLD', 'PHARMACY_ISSUED', 'PHARMACY_INVOICE_VIEWED', 'PHARMACY_RETURNED', 'PHARMACY_PRINTED']) {
      expect(describeAudit({ action, details: {} }), action).toBe('An invoice');
    }
    expect(describeAudit({ action: 'PHARMACY_PRESCRIPTIONS_VIEWED', details: {} })).toBe('A patient record was opened');
  });
});

describe('referrals from other doctors in the audit log (15 Oct 2026)', () => {
  it('names the record and which part – never a name, a phone number or what was written', () => {
    expect(describeAudit({ action: 'REFERRAL_CREATED', details: { referralId: 'r1', patientId: 'p1', mrn: 'P-000003' } })).toBe('Record P-000003');
    expect(describeAudit({ action: 'REFERRAL_CREATED', details: { referralId: 'r1' } })).toBe('A referral'); // before she is registered
    expect(describeAudit({ action: 'REFERRAL_VIEWED', details: {} })).toBe('A referral'); // the super admin's log: no record number
    expect(describeAudit({ action: 'REFERRAL_MESSAGE_SENT', details: { mrn: 'P-000003', what: 'reply' } })).toBe('Record P-000003 · the reply');
    expect(describeAudit({ action: 'REFERRAL_MESSAGE_SENT', details: { mrn: 'P-000003', what: 'discharge', fileId: 'f1' } })).toBe('Record P-000003 · the discharge summary');
    expect(describeAudit({ action: 'REFERRAL_PDF_RELEASED', details: { mrn: 'P-000003', kind: 'note', fileId: 'f1' } })).toBe('Record P-000003 · consultant note');
    expect(describeAudit({ action: 'REFERRAL_SHARING_ANSWERED', details: { mrn: 'P-000003', answer: 'no' } })).toBe('Record P-000003 · she did not agree to share');
    expect(describeAudit({ action: 'REFERRAL_REVIEW_ADDED', details: { mrn: 'P-000003', promise: 'seen' } })).toBe('Record P-000003 · promise: seen in time');
    expect(describeAudit({ action: 'REFERRING_DOCTOR_ADDED', details: { doctorId: 'd1' } })).toBe('');
    expect(describeAudit({ action: 'REFERRAL_SETTINGS_CHANGED', details: { fields: ['deskNumber', 'holidays'] } })).toBe('Referral desk number, holidays');
    expect(auditPill('REFERRAL_MESSAGE_SENT')).toMatchObject({ tone: 'neutral' });
    expect(auditPill('REFERRAL_MESSAGE_SENT').icon).toBeTruthy();
  });
});

// Every event the audit-log filter offers: AUDIT_ACTIONS in server/src/models/AuditLog.js without RETIRED_AUDIT_ACTIONS
// (server/src/routes/auditLogs.js). Keep this list in step with the server: when an event is added there, add it here
// and give it a plain name in AUDIT_LABELS. The last test below fails until the two lists match.
const FILTER_ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_RATE_LIMITED', 'LOGOUT', 'PASSWORD_CHANGED', 'USER_CREATED', 'USER_UPDATED', 'ROLE_CHANGED',
  'USER_ACTIVATED', 'USER_DEACTIVATED', 'PASSWORD_RESET', 'SUPER_ADMIN_GRANTED', 'SUPER_ADMIN_REVOKED', 'PLATFORM_ADMIN_CHANGED', 'LINKED_ACCOUNT_CHANGED', 'ACCOUNT_SWITCHED', 'ROLE_MODE_SWITCHED', 'LIST_EXPORTED', 'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_ACTIVATED',
  'TENANT_DEACTIVATED', 'TENANT_SWITCHED', 'MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED', 'PATIENT_CREATED', 'PATIENT_REGISTERED_ANYWAY',
  'PATIENT_MARKED_DUPLICATE', 'PATIENT_DUPLICATE_UNDONE', 'PATIENT_RECORD_CLOSED', 'PATIENT_RECORD_REOPENED', 'PATIENT_VIEWED', 'PATIENT_RECORD_COPIED', 'PATIENT_RECORD_COPY_PRINTED', 'PATIENT_RECORD_COPY_PDF_SAVED',
  'PATIENT_ARRIVED', 'PATIENT_ARRIVAL_UNDONE', 'ARRIVAL_EMERGENCY_CHANGED', 'PATIENT_LEFT_MARKED', 'FOLLOW_UP_ADDED', 'FOLLOW_UP_CANCELLED', 'APPOINTMENT_BOOKED', 'APPOINTMENT_MOVED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_LINKED', 'APPOINTMENT_DONE', 'TOKEN_GIVEN', 'OPD_TIMINGS_CHANGED', 'BEDS_ADDED', 'BED_UPDATED',
  'PATIENT_CARD_PRINTED', 'BILL_VIEWED', 'BILL_ITEM_ADDED', 'BILL_ITEM_REMOVED', 'DISCOUNT_GIVEN', 'PAYMENT_RECEIVED', 'REFUND_GIVEN', 'PAYMENT_CORRECTED', 'BILL_CANCELLED',
  'BILL_PRINTED', 'PRICE_LIST_CHANGED', 'BILLING_EXPORTED', 'BILL_INSURANCE_CHANGED', 'CLAIM_FORM_PRINTED', 'UPI_LINK_MADE', 'BILLING_SETTINGS_CHANGED', 'PHARMACY_SETTINGS_CHANGED',
  'PHARMACY_MEDICINE_CHANGED', 'PHARMACY_SUPPLIER_CHANGED', 'PHARMACY_PURCHASE_ENTERED', 'PHARMACY_PURCHASE_CANCELLED', 'PHARMACY_STOCK_WRITTEN_OFF', 'PHARMACY_STOCK_COUNTED', 'PHARMACY_OPENING_STOCK_IMPORTED', 'PHARMACY_PRESCRIPTIONS_VIEWED', 'PHARMACY_SOLD',
  'PHARMACY_ISSUED', 'PHARMACY_INVOICE_VIEWED', 'PHARMACY_RETURNED', 'PHARMACY_PRINTED', 'PHARMACY_REGISTER_VIEWED', 'PHARMACY_EXPORTED', 'PHARMACY_PATIENT_LOOKED_UP', 'PHARMACY_ORDER_CREATED', 'PHARMACY_ORDER_CHANGED',
  'PHARMACY_ORDER_SENT', 'PHARMACY_ORDER_RECEIVED', 'PHARMACY_ORDER_CLOSED', 'PHARMACY_ORDER_CANCELLED', 'PHARMACY_ORDER_PRINTED', 'PHARMACY_SUPPLIER_RETURNED', 'PHARMACY_SUPPLIER_RETURN_CANCELLED', 'PHARMACY_DEBIT_NOTE_PRINTED',
  'PHARMACY_EINVOICE_DOWNLOADED', 'TALLY_SETTINGS_CHANGED', 'TALLY_BATCH_CREATED', 'TALLY_FILE_DOWNLOADED', 'TALLY_VOUCHER_STATUS',
  'ABHA_VERIFIED', 'ABHA_LINKED', 'ABHA_CREATED', 'ABHA_UNLINKED', 'ABHA_VIEWED', 'ABHA_CARD_PRINTED', 'ABDM_SCAN_SHARE_RECEIVED',
  'ABDM_SCAN_SHARE_HANDLED', 'ABDM_SETTINGS_CHANGED', 'ABDM_RECORDS_VIEWED', 'ABDM_RECORDS_LINKED', 'ABDM_RECORDS_DISCOVERED', 'ABDM_CONSENT_RECEIVED', 'ABDM_RECORDS_SHARED', 'ABDM_SHARE_REFUSED',
  'ABDM_FETCH_REQUESTED', 'ABDM_FETCH_ANSWERED', 'ABDM_RECORDS_FETCHED', 'ABDM_FETCHED_VIEWED', 'ABDM_FETCHED_DELETED', 'TENANT_SETTINGS_UPDATED', 'PROFILE_UPDATED', 'PATIENT_UPDATED',
  'PATIENT_ASSIGNED', 'PATIENT_SENSITIVITY_CHANGED', 'EMERGENCY_NOTE_ADDED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'TEMPLATE_APPROVED', 'TEMPLATE_DEFAULT_SET', 'TEMPLATE_DEFAULT_REMOVED',
  'PATIENT_RISK_CHANGED', 'RISK_OVERRIDDEN', 'RISK_OVERRIDE_REMOVED', 'RISK_RECALCULATED', 'CARE_PLAN_CREATED', 'CARE_PLAN_VIEWED', 'CARE_PLAN_CHANGED', 'CARE_PLAN_PRINTED',
  'FERTILITY_PLAN_VIEWED', 'FERTILITY_PLAN_CREATED', 'FERTILITY_PLAN_EDITED', 'FERTILITY_PLAN_STATUS_CHANGED', 'FERTILITY_CYCLE_CHANGED', 'FERTILITY_CYCLE_PRINTED',
  'CONSENT_FORM_CREATED', 'CONSENT_FORM_UPDATED', 'CONSENT_FORM_APPROVED', 'CONSENT_FORM_ACTIVATED', 'CONSENT_FORM_DEACTIVATED', 'CONSENTS_VIEWED', 'CONSENT_FORM_PRINTED', 'CONSENT_SIGNED_RECORDED',
  'VISITS_VIEWED', 'VISIT_VIEWED', 'VISIT_CREATED', 'VISIT_UPDATED', 'VISIT_CANCELLED', 'VISIT_SIGNED', 'ADMISSIONS_VIEWED', 'ADMISSION_VIEWED',
  'ADMISSION_CREATED', 'ADMISSION_UPDATED', 'ADMISSION_BED_CHANGED', 'BEDS_VIEWED', 'DISCHARGES_VIEWED', 'PATIENT_DISCHARGED', 'DOCUMENT_CREATED', 'DOCUMENT_VIEWED', 'DOCUMENT_UPDATED', 'DOCUMENT_SIGNED', 'DOCUMENT_ADDITION_ADDED',
  'DOCUMENT_CANCELLED', 'DOCUMENT_PRINTED', 'NURSING_ENTRY_ADDED', 'NURSING_ENTRY_CANCELLED', 'VISIT_ADDITION_ADDED', 'PRESCRIPTION_UPDATED', 'PRESCRIPTION_PRINTED', 'PRESCRIPTION_PDF_SAVED',
  'PRESCRIPTION_SENT_WHATSAPP', 'VISIT_SUMMARY_SENT_WHATSAPP', 'VISIT_SUMMARY_PRINTED', 'VISIT_SUMMARY_PDF_SAVED', 'RED_FLAG_RULES_UPDATED', 'RED_FLAG_RULES_APPROVED', 'WORKLIST_VIEWED', 'INPATIENTS_VIEWED',
  'MEDICINE_SAFETY_UPDATED', 'MEDICINE_SAFETY_APPROVED', 'REMINDER_PREPARED', 'AI_USED', 'AI_QUESTION_ASKED', 'AI_CHECK_PRINTED_ANYWAY', 'PRESCRIPTION_SET_CREATED', 'PRESCRIPTION_SET_UPDATED',
  'PRESCRIPTION_SET_APPROVED', 'PRESCRIPTION_SET_ACTIVATED', 'PRESCRIPTION_SET_DEACTIVATED', 'LAB_PACKAGE_CREATED', 'LAB_PACKAGE_UPDATED', 'LAB_PACKAGE_APPROVED', 'LAB_PACKAGE_ACTIVATED', 'LAB_PACKAGE_DEACTIVATED',
  'ANALYTICS_VIEWED', 'ANALYTICS_LIST_VIEWED', 'LAB_ORDER_CREATED', 'LAB_ORDER_VIEWED', 'LAB_RESULTS_VIEWED', 'LAB_SAMPLE_COLLECTED', 'LAB_SAMPLE_RECEIVED', 'LAB_RESULTS_SAVED', 'LAB_RESULTS_REPORTED',
  'LAB_RESULTS_AMENDED', 'LAB_REPORT_UPLOADED', 'LAB_REPORT_OPENED', 'LAB_RESULTS_REVIEWED', 'LAB_ORDER_CANCELLED', 'LAB_HOME_COLLECTION', 'LAB_REPORT_VERIFIED', 'IMAGING_ORDERED', 'IMAGING_REQUESTED', 'IMAGING_CONFIRMED', 'IMAGING_VIEWED', 'IMAGING_SCHEDULED', 'IMAGING_DONE', 'IMAGING_SAVED', 'IMAGING_AMENDED', 'IMAGING_SIGNED', 'IMAGING_CANCELLED', 'IMAGING_PRINTED', 'IMAGING_IMAGE_ADDED', 'IMAGING_IMAGE_VIEWED', 'IMAGING_IMAGE_CHANGED', 'IMAGING_IMAGE_REMOVED', 'IMAGING_MACHINE_VIEWED', 'IMAGING_MACHINE_READINGS_USED', 'MACHINE_IMAGE_VIEWED', 'MACHINE_STUDY_LINKED', 'MACHINE_UNMATCHED_VIEWED', 'SCAN_BRIDGE_STUDY_RECEIVED', 'SCAN_BRIDGE_KEY_MADE', 'SCAN_BRIDGE_SWITCHED_OFF', 'PLATFORM_PATIENTS_LISTED', 'LAB_REFERRER_CHANGED', 'LAB_QC_LOT_CHANGED', 'LAB_QC_RUN', 'LAB_QC_ACTION', 'LAB_STOCK_CHANGED', 'ADMISSION_REQUESTED', 'ADMISSION_REQUEST_CANCELLED', 'ADMISSION_CHECKLIST_UPDATED', 'ADMISSION_FORM_PRINTED', 'WRISTBAND_PRINTED', 'DISCHARGE_CLEARED', 'GATE_PASS_PRINTED', 'OPD_CASE_PAPER_PRINTED', 'ADMISSION_RULES_CHANGED', 'QUEUE_TIME_SENT', 'BILL_SENT_WHATSAPP', 'LAB_REPORT_SENT_WHATSAPP', 'CASH_HANDED_OVER', 'EXPENSE_RECORDED', 'EXPENSE_CANCELLED', 'EXPENSE_BILL_ATTACHED', 'EXPENSE_HEADS_CHANGED', 'CASH_HANDOVER_CONFIRMED', 'LAB_LABELS_PRINTED', 'LAB_SAMPLE_REJECTED', 'LAB_RESULTS_ENTERED', 'LAB_RESULTS_VERIFIED', 'LAB_RESULTS_SENT_BACK', 'LAB_SENT_OUTSIDE', 'LAB_OUTSIDE_RECEIVED', 'LAB_REPORT_PRINTED', 'LAB_ORDERS_SEARCHED', 'LAB_REGISTER_VIEWED', 'LAB_TEST_CREATED', 'LAB_TEST_UPDATED', 'LAB_TEST_APPROVED', 'LAB_SETTINGS_CHANGED', 'REFERRAL_CREATED', 'REFERRAL_VIEWED', 'REFERRAL_UPDATED', 'REFERRAL_LINKED', 'REFERRAL_BOOKED', 'REFERRAL_ATTACHMENT_ADDED', 'REFERRAL_ATTACHMENT_OPENED', 'REFERRAL_SHARING_ANSWERED', 'REFERRAL_NOTE_SAVED', 'REFERRAL_NOTE_SIGNED', 'REFERRAL_NOTE_ADDITION_ADDED', 'REFERRAL_PDF_RELEASED', 'REFERRAL_PDF_OPENED', 'REFERRAL_MESSAGE_SENT', 'REFERRAL_REVIEW_ADDED', 'REFERRAL_CLOSED', 'REFERRAL_CANCELLED', 'REFERRING_DOCTOR_ADDED', 'REFERRING_DOCTOR_UPDATED', 'REFERRAL_SUMMARY_VIEWED', 'REFERRAL_SETTINGS_CHANGED', 'WORK_DONE_VIEWED', 'WORK_DONE_RECORDED', 'WORK_DONE_CANCELLED',
  'CONSENT_SCAN_ADDED', 'CONSENT_SCAN_OPENED', 'REPORT_VIEWED', 'PATIENT_REMINDERS_CHANGED', 'REMINDER_SENT_BY_HAND', 'REMINDERS_RUN', 'PORTAL_ACCESS_CREATED', 'PORTAL_ACCESS_REVOKED',
  'PORTAL_LOGIN_SUCCESS', 'PORTAL_LOGIN_FAILED', 'PORTAL_VIEWED', 'PORTAL_APPOINTMENT_BOOKED', 'PORTAL_APPOINTMENT_CANCELLED', 'PORTAL_SIGNUP_RECEIVED', 'PORTAL_SIGNUP_APPROVED', 'PORTAL_SIGNUP_REJECTED', 'PORTAL_PASSWORD_CHANGED', 'PORTAL_RECORDS_VIEWED', 'PORTAL_PROFILE_UPDATED', 'PORTAL_CHANGE_REQUESTED', 'PORTAL_CHANGE_APPROVED', 'PORTAL_CHANGE_REJECTED', 'KEEPSAKE_CARD_PRINTED', 'HOSPITAL_DATA_EXPORTED',
];

describe('every event in the audit log has a plain name', () => {
  it('each event offered in the filter has a label – never its code', () => {
    for (const action of FILTER_ACTIONS) {
      expect(AUDIT_LABELS[action], action).toBeTruthy();
      expect(AUDIT_LABELS[action], action).not.toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it('no two events have the same label (the filter would offer the same words twice)', () => {
    const labels = Object.values(AUDIT_LABELS);
    expect(labels.filter((label, i) => labels.indexOf(label) !== i)).toEqual([]);
  });

  it("the list above is the same as the server's", () => {
    const model = readFileSync(new URL('../../../server/src/models/AuditLog.js', import.meta.url), 'utf8');
    const listed = (name) => {
      const start = model.indexOf(`export const ${name} = `);
      return [...model.slice(start, model.indexOf('\n]', start)).matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
    };
    const retired = new Set(listed('RETIRED_AUDIT_ACTIONS'));
    const offered = listed('AUDIT_ACTIONS').filter((a) => !retired.has(a));
    expect(offered.length).toBeGreaterThan(150); // the server's file was read
    expect(offered.filter((a) => !FILTER_ACTIONS.includes(a)), 'on the server but missing from FILTER_ACTIONS').toEqual([]);
    expect(FILTER_ACTIONS.filter((a) => !offered.includes(a)), 'in FILTER_ACTIONS but not offered by the server').toEqual([]);
    // Events of removed features are no longer offered, but their old entries still show a label
    for (const action of retired) expect(AUDIT_LABELS[action], action).toBeTruthy();
  });
});

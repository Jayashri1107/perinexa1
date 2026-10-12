import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A document another hospital sent for a patient through ABDM with her consent (milestone M3), kept under her
// record ONLY until her consent ends: deleted automatically when it expires (expiresAt) or when she withdraws it
// (abdm/fetchRecords.js), as ABDM requires.
//
//  - Read-only. Never copied into Perinexa's own visits, lab results or documents, never shared on through ABDM
//    (M2 shares Perinexa's own records only), never in the hospital data export or the copy of the whole record.
//  - Seen only by those who may see this patient's medical details (her doctor, other doctors of a record that is
//    not sensitive, RMOs); every opening is in the audit log.
//  - What is kept is the READABLE content (fhirReader.js): plain lines per section, after the fetal-sex guard
//    (PC-PNDT) – a sentence that mentioned a baby's sex was never stored, only counted (withheld). The FHIR document
//    itself is not kept.
//  - Attached files (AbdmFetchedFile): only a PDF, JPEG or PNG that really is one, at most 10 MB, offered as a
//    download; deleted with the document.

const { ObjectId } = mongoose.Schema.Types;

const lineSchema = new mongoose.Schema({ text: { type: String, default: '' }, withheld: { type: Number, default: 0 }, sub: { type: Boolean, default: false } }, { _id: false });
const sectionSchema = new mongoose.Schema({ title: { type: String, default: '' }, lines: { type: [lineSchema], default: [] } }, { _id: false });

const fetchedRecordSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    requestId: { type: ObjectId, ref: 'AbdmFetchRequest', required: true },
    consentId: { type: String, required: true, maxlength: 100 }, // ABDM's consent artefact it came under
    transactionId: { type: String, default: '', maxlength: 100 },
    hipId: { type: String, default: '', maxlength: 100 },
    hipName: { type: String, default: '', maxlength: 200 }, // the hospital, as ABDM names it
    careContextReference: { type: String, default: '', maxlength: 200 },
    hiType: { type: String, default: '' },
    typeText: { type: String, default: '', maxlength: 200 },
    title: { type: String, default: '', maxlength: 200 },
    titleWithheld: { type: Boolean, default: false },
    date: { type: Date, default: null }, // the document's own date (null: it gives none – never when it was sent)
    // The other hospital's status of the whole document: '' final, or preliminary, amended, entered-in-error (said on
    // screen; older records: '')
    documentStatus: { type: String, enum: ['', 'preliminary', 'amended', 'entered-in-error'], default: '' },
    hospital: { type: String, default: '', maxlength: 200 }, // the hospital as the document names it
    authors: { type: [String], default: [] },
    nameInDocument: { type: String, default: '', maxlength: 200 }, // the patient's name in the document (to check)
    sections: { type: [sectionSchema], default: [] },
    withheld: { type: Number, default: 0 },
    truncated: { type: Boolean, default: false },
    files: { type: [new mongoose.Schema({ fileId: ObjectId, title: String, contentType: String, size: Number }, { _id: false })], default: [] },
    filesLeftOut: { type: [new mongoose.Schema({ title: String, contentType: String, why: String }, { _id: false })], default: [] },
    checksumOk: { type: Boolean, default: false }, // the sender's checksum matched what was decrypted
    expiresAt: { type: Date, required: true },
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
fetchedRecordSchema.plugin(tenantScoped);
fetchedRecordSchema.index({ tenantId: 1, patientId: 1, date: -1 });
fetchedRecordSchema.index({ tenantId: 1, consentId: 1 });
fetchedRecordSchema.index({ tenantId: 1, expiresAt: 1 });

export const AbdmFetchedRecord = mongoose.model('AbdmFetchedRecord', fetchedRecordSchema);

// An attached file of a fetched document (a PDF or a photo), deleted with it.
const fetchedFileSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    recordId: { type: ObjectId, ref: 'AbdmFetchedRecord', required: true },
    consentId: { type: String, required: true, maxlength: 100 },
    title: { type: String, default: '', maxlength: 200 },
    contentType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png'], required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
fetchedFileSchema.plugin(tenantScoped);
fetchedFileSchema.index({ tenantId: 1, recordId: 1 });
fetchedFileSchema.index({ tenantId: 1, consentId: 1 });
fetchedFileSchema.index({ tenantId: 1, expiresAt: 1 });

export const AbdmFetchedFile = mongoose.model('AbdmFetchedFile', fetchedFileSchema);

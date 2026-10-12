import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One request for a patient's records from other hospitals (ABDM milestone M3 – the hospital as a Health Information
// User). Her doctor or an RMO asks through ABDM (a "consent request": the purpose, the kinds of record, the period
// and how long the consent lasts); she answers in her ABHA app. When she agrees, ABDM gives one consent for each
// hospital that has records for her (a "consent artefact" – `hospitals` here), and each hospital sends its records,
// encrypted for this request only (abdm/fetchRecords.js).
//
// This is the hospital's own record of what was asked and what came – who asked, when, her answer, and COUNTS only.
// The records themselves are AbdmFetchedRecord, deleted when her consent ends or she withdraws it. Never deleted.
// Never holds a key: the private key that decrypts her records lives in the server's memory for one request only.

const { ObjectId } = mongoose.Schema.Types;

// One hospital that answered (ABDM's consent artefact for it)
const hospitalSchema = new mongoose.Schema(
  {
    consentId: { type: String, required: true, maxlength: 100 }, // ABDM's id of the consent artefact
    hipId: { type: String, default: '', maxlength: 100 },
    hipName: { type: String, default: '', maxlength: 200 },
    status: { type: String, enum: ['GRANTED', 'REVOKED', 'EXPIRED'], default: 'GRANTED' },
    hiTypes: { type: [String], default: [] },
    from: { type: Date, default: null }, // the dates of records she agreed to share (her app may narrow them)
    to: { type: Date, default: null },
    expiresAt: { type: Date, default: null }, // until when the records may be kept (the earlier of hers and ours)
    careContexts: { type: [String], default: [] }, // the references of the records in the consent
    // details: waiting for the consent's details from ABDM; asked: the records were asked for; received: they came;
    // failed: they could not be asked for or read (error says why); deleted: the consent ended and they were deleted
    step: { type: String, enum: ['details', 'asked', 'received', 'failed', 'deleted'], default: 'details' },
    fetchRequestId: { type: String, default: '' }, // our request id when asking ABDM for the consent's details
    dataRequestId: { type: String, default: '' }, // our request id when asking for the records (finds the key)
    transactionId: { type: String, default: '', maxlength: 100 }, // ABDM's id of the transfer
    askedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    pageCount: { type: Number, default: 0 },
    pagesReceived: { type: [Number], default: [] }, // pages that came (each kept once)
    pagesDone: { type: [Number], default: [] }, // pages read to the end (the transfer is finished when all are)
    refsReceived: { type: [String], default: [] }, // the records (references) read and kept
    refsFailed: { type: [String], default: [] }, // the records that came but could not be read
    documents: { type: Number, default: 0 },
    files: { type: Number, default: 0 },
    filesLeftOut: { type: Number, default: 0 },
    withheld: { type: Number, default: 0 }, // sentences withheld by the fetal-sex guard (PC-PNDT)
    failedEntries: { type: Number, default: 0 }, // documents that could not be read
    error: { type: String, default: '', maxlength: 300 },
    deletedAt: { type: Date, default: null },
    deletedWhy: { type: String, enum: ['expired', 'revoked', ''], default: '' },
  },
  { _id: false },
);

const fetchRequestSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    abhaNumber: { type: String, default: '' }, // her ABHA when asked
    abhaAddress: { type: String, default: '' },
    asked: {
      type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User', required: true }, byName: { type: String, default: '' }, at: { type: Date, required: true } }, { _id: false }),
      required: true,
    },
    purpose: { code: { type: String, default: 'CAREMGT' }, text: { type: String, default: 'Care management' } },
    hiTypes: { type: [String], default: [] },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    expiresAt: { type: Date, required: true }, // how long the consent should last (ABDM's dataEraseAt)
    days: { type: Number, default: 0 },
    clientRequestId: { type: String, default: '' }, // the page's id for this request (a double click asks once)
    initRequestId: { type: String, default: '' }, // our request id when asking ABDM (matches ABDM's answer)
    consentRequestId: { type: String, default: '', maxlength: 100 }, // ABDM's id of the consent request
    // requested: sent, ABDM's id not back yet; waiting: waiting for her answer; granted: she agreed; denied: she
    // refused; revoked: she withdrew it; expired: it ended (or she never answered); failed: ABDM refused the request
    status: { type: String, enum: ['requested', 'waiting', 'granted', 'denied', 'revoked', 'expired', 'failed'], required: true },
    error: { type: String, default: '', maxlength: 300 },
    hospitals: { type: [hospitalSchema], default: [] },
    history: { type: [new mongoose.Schema({ status: String, at: Date }, { _id: false })], default: [] },
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
fetchRequestSchema.plugin(tenantScoped);
fetchRequestSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
fetchRequestSchema.index({ tenantId: 1, initRequestId: 1 }, { partialFilterExpression: { initRequestId: { $gt: '' } } });
fetchRequestSchema.index({ tenantId: 1, consentRequestId: 1 }, { partialFilterExpression: { consentRequestId: { $gt: '' } } });
fetchRequestSchema.index({ tenantId: 1, 'hospitals.consentId': 1 });
fetchRequestSchema.index({ tenantId: 1, 'hospitals.transactionId': 1 });
fetchRequestSchema.index({ tenantId: 1, 'hospitals.fetchRequestId': 1 });
fetchRequestSchema.index({ tenantId: 1, 'hospitals.dataRequestId': 1 });
fetchRequestSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $gt: '' } } });
fetchRequestSchema.index({ tenantId: 1, 'hospitals.expiresAt': 1 });

export const AbdmFetchRequest = mongoose.model('AbdmFetchRequest', fetchRequestSchema);

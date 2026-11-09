import mongoose from 'mongoose';
import { COPY_WHATS, GIVEN_TO } from '../records/recordRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// The copies register (the medical records module, 9 Nov 2026): every time a copy of a record – the whole record,
// a discharge summary, particular documents – leaves the hospital: for whom, who received it, on what request or
// authorisation, when it was asked for and when it was given, and who gave it. Never deleted: an entry made by
// mistake is marked so, with a reason. A patient's record itself does not list these entries.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const issueSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    what: { type: String, enum: COPY_WHATS, required: true },
    whatNote: { type: String, default: '', maxlength: 300 }, // which documents, or what else
    givenTo: { type: String, enum: GIVEN_TO, required: true },
    receiverName: { type: String, default: '', trim: true, maxlength: 120 },
    authorisation: { type: String, default: '', maxlength: 300 }, // the written request, consent or order it rests on
    requestedOn: { type: Date, default: null },
    givenOn: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 500 },
    recorded: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: { type: String, required: true, maxlength: 300 } }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
issueSchema.plugin(tenantScoped);
issueSchema.index({ tenantId: 1, givenOn: -1 });
issueSchema.index({ tenantId: 1, patientId: 1 });
issueSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const RecordCopyIssue = mongoose.model('RecordCopyIssue', issueSchema);

import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One of a patient's records linked to her ABHA (ABDM milestone M2, "care context"): a signed visit, reviewed lab
// results or a confirmed discharge card. Linked by the hospital ("Link to ABHA", with her agreement recorded by the
// person who clicked), or by her from her ABHA app (discovery, confirmed with an OTP sent to her mobile). Kept as a
// record; never deleted. Whether it is still shared is decided again on every request from ABDM (abdm/shareRules.js),
// so a record marked sensitive later, or results changed after the review, are not sent.
//
// reference: what ABDM knows it by ("V-<visit id>", "L-<lab order id>", "D-<document id>") – never a name or a test.
// display: what her ABHA app shows ("OPD visit on 21 Sep 2026") – the kind and the date only.

const { ObjectId } = mongoose.Schema.Types;

const careContextSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['visit', 'lab', 'discharge'], required: true },
    sourceId: { type: ObjectId, required: true }, // the visit, lab order or inpatient document
    reference: { type: String, required: true, maxlength: 40 },
    display: { type: String, required: true, maxlength: 120 },
    hiTypes: { type: [{ type: String, enum: ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary'] }], default: [] },
    recordDate: { type: Date, required: true }, // the hospital's day of the record (midnight UTC)
    // The ABHA it was linked to (her record's ABHA at the time): nothing is shared once her record has another one
    abhaNumber: { type: String, required: true },
    abhaAddress: { type: String, default: '' },
    // waiting: the hospital asked ABDM and its answer has not come yet (sandbox or production only)
    status: { type: String, enum: ['waiting', 'linked', 'failed'], required: true },
    via: { type: String, enum: ['hospital', 'patient'], required: true },
    // via hospital: who recorded her agreement, and when; via patient: she confirmed with the OTP sent to her mobile
    agreement: {
      type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, default: '' }, at: Date }, { _id: false }),
      default: null,
    },
    linkedAt: { type: Date, default: null },
    // While waiting: ABDM's request id and the step ('token': the link token was asked for; 'link': the records were sent)
    requestId: { type: String, default: '' },
    step: { type: String, enum: ['token', 'link', ''], default: '' },
    error: { type: String, default: '', maxlength: 300 }, // ABDM's reason when it refused
    practice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
careContextSchema.plugin(tenantScoped);
careContextSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
careContextSchema.index({ tenantId: 1, patientId: 1 });
careContextSchema.index({ tenantId: 1, requestId: 1 }, { partialFilterExpression: { requestId: { $gt: '' } } });

export const AbdmCareContext = mongoose.model('AbdmCareContext', careContextSchema);

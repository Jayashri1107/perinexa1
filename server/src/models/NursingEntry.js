import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { NURSING_KINDS } from '../inpatient/docSchemas.js';

// The nursing chart of a stay (Version 2): vital signs, a medicine given, a note, a handover note for the next shift, or
// an escalation (the consultant was told) – with who and when. Never
// changed: an entry made by mistake is marked "entered in error" with a reason.

const { ObjectId } = mongoose.Schema.Types;
const entrySchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    kind: { type: String, enum: NURSING_KINDS, required: true },
    at: { type: Date, required: true },
    vitals: { bpSystolic: Number, bpDiastolic: Number, pulse: Number, temperatureF: Number, spo2: Number },
    medicine: { drug: String, dose: String, route: String },
    note: { type: String, default: '' },
    escalatedTo: { type: String, default: '' }, // escalation: whom the nurse or RMO told
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    cancelled: {
      type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }),
      default: null,
    },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
entrySchema.plugin(tenantScoped);
entrySchema.index({ tenantId: 1, admissionId: 1, at: -1 });
entrySchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const NursingEntry = mongoose.model('NursingEntry', entrySchema);

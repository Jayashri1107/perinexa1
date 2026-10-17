import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A doctor's request to admit a patient (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md): the doctor or an RMO asks
// from her record; reception sees it on the bed board and admits her from it (the stay then names the request). Open
// until she is admitted or the request is cancelled (with a reason). Never deleted. One open request per patient.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const requestSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    reasonCode: { type: String, required: true }, // inpatient/beds.js REASONS (what reception may see)
    reasonNote: { type: String, trim: true, maxlength: 120, default: '' },
    admissionType: { type: String, enum: ['planned', 'emergency', 'day_care'], default: 'planned' },
    ward: { type: String, trim: true, maxlength: 60, default: '' }, // the ward wanted ('' = any)
    expectedOn: { type: Date, default: null }, // the day she is expected (midnight UTC), null = today
    note: { type: String, trim: true, maxlength: 300, default: '' }, // a note for the desk (no medical details)
    status: { type: String, enum: ['open', 'admitted', 'cancelled'], default: 'open' },
    requested: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    admissionId: { type: ObjectId, ref: 'Admission', default: null },
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
requestSchema.plugin(tenantScoped);
requestSchema.index({ tenantId: 1, status: 1, expectedOn: 1 });
requestSchema.index({ tenantId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_request' });

export const AdmissionRequest = mongoose.model('AdmissionRequest', requestSchema);

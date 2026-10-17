import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// An imaging study (Lab version 2 part 8 – docs/LAB_V2_PLAN.md): USG and radiology. A doctor or RMO orders it; it is
// scheduled and done; the report (a DRAFT template's fields, findings and impression) is signed by a doctor. A signed
// report is changed only with a reason (the earlier one is kept). PCPNDT: no field holds the sex of a fetus.
const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stamp = () => ({ type: new mongoose.Schema(byFields, { _id: false }), default: null });
const reportSchema = new mongoose.Schema(
  { values: { type: mongoose.Schema.Types.Mixed, default: {} }, findings: { type: String, default: '' }, impression: { type: String, default: '' } },
  { _id: false, minimize: false },
);

const imagingSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    study: { type: String, required: true }, // imaging/templates.js STUDIES
    urgent: { type: Boolean, default: false },
    indication: { type: String, trim: true, maxlength: 300, default: '' }, // why it is asked for (clinical)
    status: { type: String, enum: ['ordered', 'scheduled', 'done', 'signed', 'cancelled'], default: 'ordered' },
    scheduledFor: { type: Date, default: null },
    ordered: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    scheduled: stamp(),
    done: stamp(),
    report: { type: reportSchema, default: null },
    saved: stamp(),
    signed: stamp(),
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
    amendments: { type: [new mongoose.Schema({ ...byFields, reason: String, report: reportSchema }, { _id: false })], default: [] },
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
imagingSchema.plugin(tenantScoped);
imagingSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
imagingSchema.index({ tenantId: 1, status: 1, scheduledFor: 1 });
imagingSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const ImagingOrder = mongoose.model('ImagingOrder', imagingSchema);

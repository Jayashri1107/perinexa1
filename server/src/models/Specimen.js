import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A specimen sent for histopathology or cytology (Clinical Requirements Group A, item 3 – PX-OT-04, register
// OBG-L-05 of PX-OBG-31). Logged when it is sent; the report is entered (and its file attached) when it comes back;
// a doctor or RMO reviews it and records that she was told. Over 21 days without a report it is on the overdue list.
// Never deleted: a specimen logged by mistake is cancelled with a reason. Both the time of each event (typed) and
// the time it was typed are stored (PX-X-04).

export const SPECIMEN_STATUSES = ['sent', 'reported', 'reviewed', 'cancelled'];
export const SPECIMEN_KINDS = ['histopathology', 'cytology', 'other'];

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const specimenSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', default: null },
    // The serial number in this hospital's register (OBG-L-05), per hospital
    serial: { type: Number, required: true },
    kind: { type: String, enum: SPECIMEN_KINDS, required: true },
    specimen: { type: String, required: true, trim: true, maxlength: 300 }, // what was sent, e.g. "Uterus with cervix"
    procedure: { type: String, trim: true, maxlength: 300, default: '' },
    collectedAt: { type: Date, required: true },
    sentAt: { type: Date, required: true },
    lab: { type: String, trim: true, maxlength: 200, default: '' },
    labReference: { type: String, trim: true, maxlength: 100, default: '' },
    status: { type: String, enum: SPECIMEN_STATUSES, default: 'sent' },
    report: {
      type: new mongoose.Schema(
        {
          receivedAt: Date,
          summary: { type: String, maxlength: 4000 },
          file: { fileId: ObjectId, fileName: String, mediaType: String, size: Number },
          ...stamp,
        },
        { _id: false },
      ),
      default: null,
    },
    review: { type: new mongoose.Schema({ note: { type: String, maxlength: 2000 }, informedAt: Date, ...stamp }, { _id: false }), default: null },
    cancelled: { type: new mongoose.Schema({ reason: String, ...stamp }, { _id: false }), default: null },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
specimenSchema.plugin(tenantScoped);
specimenSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
specimenSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
specimenSchema.index({ tenantId: 1, status: 1, sentAt: 1 });
specimenSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

export const Specimen = mongoose.model('Specimen', specimenSchema);

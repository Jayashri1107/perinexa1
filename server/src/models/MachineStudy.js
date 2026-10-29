import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// What the ultrasound machine sent through the hospital's scan bridge (docs/USG_MACHINE_PLAN.md): one study on the
// machine, its readings (from its structured reports) and its pictures. Kept only SCAN_BRIDGE_KEEP_DAYS (config.js),
// then deleted by the database itself (expiresAt): what the sonologist uses is copied into the scan's own record – the
// pictures as StoredFiles, the readings and how they were used in its report – and stays there.
// Matched to her by the scan order's number sent to the machine on its worklist (the DICOM accession number), or by
// her patient number typed on the machine; otherwise it waits on Scans → From the machine until staff link it.
// PC-PNDT: nothing about the sex of a fetus is kept (imaging/machineReadings.js drops it and only counts it).
const { ObjectId } = mongoose.Schema.Types;

const readingSchema = new mongoose.Schema(
  { key: String, fetus: String, value: Number, derived: { type: String, default: null }, srUid: String },
  { _id: false },
);
const unmatchedSchema = new mongoose.Schema(
  { code: String, meaning: String, value: Number, unit: String, fetus: String, srUid: String },
  { _id: false },
);

const machineStudySchema = new mongoose.Schema(
  {
    studyUid: { type: String, required: true, maxlength: 64 },
    accession: { type: String, default: '', maxlength: 64 },
    // As typed on the machine
    machinePatientId: { type: String, default: '', maxlength: 64 },
    patientName: { type: String, default: '', maxlength: 200 },
    studyAt: { type: Date, default: null },
    manufacturer: { type: String, default: '', maxlength: 64 },
    model: { type: String, default: '', maxlength: 64 },
    station: { type: String, default: '', maxlength: 64 },
    // Who it is: null until matched or linked by hand
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    imagingId: { type: ObjectId, ref: 'ImagingOrder', default: null },
    matchedBy: { type: String, enum: ['worklist', 'number', 'hand'], default: null },
    linked: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    srUids: { type: [String], default: [] },
    readings: { type: [readingSchema], default: [] },
    unmatched: { type: [unmatchedSchema], default: [] },
    droppedSex: { type: Number, default: 0 },
    images: {
      type: [
        new mongoose.Schema(
          { imageId: { type: ObjectId, required: true }, sopUid: String, mediaType: String, size: Number, at: Date, usedIn: { type: [ObjectId], default: [] } },
          { _id: false },
        ),
      ],
      default: [],
    },
    receivedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
machineStudySchema.plugin(tenantScoped);
machineStudySchema.index({ tenantId: 1, studyUid: 1 }, { unique: true });
machineStudySchema.index({ tenantId: 1, patientId: 1, receivedAt: -1 });
machineStudySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MachineStudy = mongoose.model('MachineStudy', machineStudySchema);

// A picture of a machine study (a JPEG or PNG the bridge made from the DICOM image), kept as long as its study.
const machineImageSchema = new mongoose.Schema({
  machineStudyId: { type: ObjectId, ref: 'MachineStudy', required: true },
  sopUid: { type: String, required: true, maxlength: 64 },
  mediaType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  expiresAt: { type: Date, required: true },
});
machineImageSchema.plugin(tenantScoped);
machineImageSchema.index({ tenantId: 1, machineStudyId: 1, sopUid: 1 }, { unique: true });
machineImageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MachineImage = mongoose.model('MachineImage', machineImageSchema);

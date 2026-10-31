import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// An imaging study (Lab version 2 part 8 – docs/LAB_V2_PLAN.md): USG and radiology. A doctor or RMO orders it (or
// reception books one a doctor asked for on paper, and a doctor or RMO confirms it – 31 Oct 2026); it is
// scheduled and done; the report (a DRAFT template's fields, findings and impression) is signed by a doctor. A signed
// report is changed only with a reason (the earlier one is kept). PCPNDT: no field holds the sex of a fetus.
const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stamp = () => ({ type: new mongoose.Schema(byFields, { _id: false }), default: null });
const reportSchema = new mongoose.Schema(
  {
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    findings: { type: String, default: '' },
    impression: { type: String, default: '' },
    // The readings from the ultrasound machine put in the values (docs/USG_MACHINE_PLAN.md): which machine study and
    // fetus, and per field the readings, which were ticked, the rule used and the value it gave. null: typed by hand.
    machine: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, minimize: false },
);

const imagingSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    study: { type: String, required: true }, // imaging/templates.js STUDIES
    urgent: { type: Boolean, default: false },
    indication: { type: String, trim: true, maxlength: 300, default: '' }, // why it is asked for (clinical)
    // requested: booked by reception, waiting for a doctor or RMO to confirm (not billed, not on the machine's worklist)
    status: { type: String, enum: ['requested', 'ordered', 'scheduled', 'done', 'signed', 'cancelled'], default: 'ordered' },
    scheduledFor: { type: Date, default: null },
    ordered: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    // Booked by reception: the doctor who asked for it (on paper), and who confirmed it
    requestedBy: { type: new mongoose.Schema({ doctorId: { type: ObjectId, ref: 'User' }, name: String }, { _id: false }), default: null },
    confirmed: stamp(),
    // Ordered from a scan due in her care plan: that plan and item (the plan shows the order beside the item)
    planItem: { type: new mongoose.Schema({ planId: { type: ObjectId, ref: 'CarePlan' }, key: { type: String, maxlength: 80 } }, { _id: false }), default: null },
    scheduled: stamp(),
    done: stamp(),
    report: { type: reportSchema, default: null },
    saved: stamp(),
    signed: stamp(),
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
    amendments: { type: [new mongoose.Schema({ ...byFields, reason: String, report: reportSchema }, { _id: false })], default: [] },
    // Pictures from the machine (24 Oct 2026): the file is a StoredFile (kind scan_image), never deleted; one taken off
    // the report keeps its record with who, when and why. inPrint: printed with the signed report.
    images: {
      type: [
        new mongoose.Schema(
          {
            fileId: { type: ObjectId, required: true },
            fileName: String,
            mediaType: String,
            size: Number,
            ...byFields,
            inPrint: { type: Boolean, default: true },
            removed: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // The scan number on the ultrasound machine's worklist (DICOM accession number, at most 16 characters): given the
    // first time the order goes to the machine (routes/scanBridge.js), e.g. US00000012. null: never sent.
    accession: { type: String, default: null },
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
imagingSchema.plugin(tenantScoped);
imagingSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
imagingSchema.index({ tenantId: 1, status: 1, scheduledFor: 1 });
imagingSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
imagingSchema.index({ tenantId: 1, accession: 1 }, { unique: true, partialFilterExpression: { accession: { $type: 'string' } } });

export const ImagingOrder = mongoose.model('ImagingOrder', imagingSchema);

import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { FLAGS } from '../lab/labTests.js';

// A lab order (Version 2, lab module): the tests a doctor or RMO ordered for a patient, and their results.
//   ordered → collected (sample taken) → reported (the lab finished the results) → reviewed (a doctor saw them).
// A change after the report needs a reason; the earlier results stay in `amendments` and the order goes back to
// "reported" so a doctor sees the change. Cancelled orders are kept (with who, when and why).

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stamp = () => ({ type: new mongoose.Schema(byFields, { _id: false }), default: null });

const valueSchema = new mongoose.Schema({ key: String, value: { type: String, default: '' }, flag: { type: String, enum: FLAGS, default: '' } }, { _id: false });
const testSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // a LAB_TESTS key, or 'other'
    name: { type: String, required: true },
    values: { type: [valueSchema], default: [] },
    text: { type: String, default: '' }, // the result in words (also the whole result of an 'other' test)
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    visitId: { type: ObjectId, ref: 'Visit', default: null },
    status: { type: String, enum: ['ordered', 'collected', 'reported', 'reviewed', 'cancelled'], default: 'ordered' },
    urgent: { type: Boolean, default: false },
    tests: { type: [testSchema], default: [] },
    noteToLab: { type: String, default: '' }, // what the doctor tells the lab (fasting, clinical question …)
    // The test packages chosen (models/LabPackage.js): { key, name, version, approved } as they were when ordered.
    packages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    labNote: { type: String, default: '' }, // the lab's remark on the report
    ordered: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    collected: stamp(),
    // The lab reported without marking the sample as collected: `collected` was stamped by the report, so the
    // sample was taken some time between the order and the report (the red flags work out a baby's age for a
    // bilirubin result from the order's time then, redflags/redFlags.js labReadings). Not set on older orders.
    collectedAtReport: { type: Boolean, default: false },
    reported: stamp(),
    reviewed: {
      type: new mongoose.Schema({ ...byFields, comment: { type: String, default: '' } }, { _id: false }),
      default: null,
    },
    cancelled: {
      type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }),
      default: null,
    },
    lastSaved: stamp(), // the latest save of results (also before the report)
    amendments: {
      type: [
        new mongoose.Schema(
          { ...byFields, reason: String, tests: [testSchema], labNote: String, reviewedByName: String, reviewedAt: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
    files: {
      type: [new mongoose.Schema({ fileId: ObjectId, fileName: String, mediaType: String, size: Number, ...byFields }, { _id: false })],
      default: [],
    },
    abnormal: { type: Boolean, default: false }, // any value flagged Low, High or Abnormal
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
orderSchema.plugin(tenantScoped);
orderSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
orderSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const LabOrder = mongoose.model('LabOrder', orderSchema);

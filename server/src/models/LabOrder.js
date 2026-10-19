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

// name, unit, range: as they were when the result was saved – the range that applied to this patient (her age,
// pregnancy; docs/LAB_LIMS_PLAN.md feature 3) and the hospital's own test's words. Not set on older results.
const valueSchema = new mongoose.Schema(
  {
    key: String,
    value: { type: String, default: '' },
    flag: { type: String, enum: FLAGS, default: '' },
    name: String,
    unit: String,
    range: String,
    // Lab version 2 (docs/LAB_V2_PLAN.md): the change from her earlier result of this value (per cent), and whether it
    // passed the hospital's limit for this value ("Big change")
    deltaPercent: { type: Number, default: null },
    bigChange: { type: Boolean, default: false },
  },
  { _id: false },
);
// A test sent to an outside lab (feature 7): which lab and its reference, when it was sent and when the result came.
const outsideSchema = new mongoose.Schema(
  { labName: String, ref: { type: String, default: '' }, sent: new mongoose.Schema(byFields, { _id: false }), received: { type: new mongoose.Schema(byFields, { _id: false }), default: null } },
  { _id: false },
);
const testSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // a LAB_TESTS key, or 'other'
    name: { type: String, required: true },
    values: { type: [valueSchema], default: [] },
    text: { type: String, default: '' }, // the result in words (also the whole result of an 'other' test)
    department: { type: String, default: '' }, // the lab department when ordered (lab/labSetup.js DEPARTMENTS)
    outside: { type: outsideSchema, default: null },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    visitId: { type: ObjectId, ref: 'Visit', default: null },
    // 'entered': the results are typed and wait for the lab's check (only when the hospital asks for one – LabSetup)
    status: { type: String, enum: ['ordered', 'collected', 'entered', 'reported', 'reviewed', 'cancelled'], default: 'ordered' },
    // The sample number printed with a barcode on the labels (lab/labSetup.js nextSampleNo). Not set on older orders
    // until a label is printed or the sample is taken.
    sampleNo: { type: String, default: null },
    // Lab version 2 (docs/LAB_V2_PLAN.md): who ordered – a hospital doctor or RMO ('doctor'), or the lab from an
    // outside prescription for a walk-in or referred patient ('walk_in') – and the referrer and prescription then
    source: { type: String, enum: ['doctor', 'walk_in'], default: 'doctor' },
    referrer: { type: new mongoose.Schema({ id: ObjectId, name: String, kind: String }, { _id: false }), default: null },
    prescription: { type: String, default: '' }, // e.g. "Dr Sample's prescription of 16 Oct", or "Self – no prescription"
    // The secret code of the report's QR code (a public page confirms the report is genuine)
    verifyToken: { type: String, default: null },
    // Collected at home: address, day and time, the collector and how it went
    home: {
      type: new mongoose.Schema(
        {
          address: String,
          on: Date,
          time: String,
          collectorId: ObjectId,
          collectorName: String,
          status: { type: String, enum: ['scheduled', 'on_the_way', 'collected', 'failed'], default: 'scheduled' },
          note: { type: String, default: '' },
          updated: new mongoose.Schema(byFields, { _id: false }),
        },
        { _id: false },
      ),
      default: null,
    },
    // Reported while the quality control of one of its tests was rejected today: the reason given
    qcOverride: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
    // The lab's stock taken for this order when it was reported (no double taking on a change)
    stockTaken: { type: Boolean, default: false },
    dueAt: { type: Date, default: null }, // when the report is due (the tests' turnaround times); null on older orders
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
    // The sample received in the lab (the eLabAssist-style accession step – owner, 17 Oct 2026): a sample the lab takes at
    // its counter is received at once; one taken on a ward by a nurse, or at home, is received when it reaches the lab
    // (Samples to receive, by scanning the label). Not set on older orders.
    received: stamp(),
    entered: stamp(), // who typed the results that were then checked (with the check on)
    verified: stamp(), // who checked them (with the check on); the report is then stamped with the same person and time
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
    // Samples the lab refused (the order went back to "sample to take") and results the checker sent back
    rejections: { type: [new mongoose.Schema({ ...byFields, reason: String, note: { type: String, default: '' } }, { _id: false })], default: [] },
    sentBack: { type: [new mongoose.Schema({ ...byFields, reason: String }, { _id: false })], default: [] },
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
orderSchema.index({ tenantId: 1, sampleNo: 1 });
orderSchema.index({ tenantId: 1, verifyToken: 1 });
orderSchema.index({ tenantId: 1, 'home.on': 1 });
orderSchema.index({ tenantId: 1, 'ordered.at': -1 });

export const LabOrder = mongoose.model('LabOrder', orderSchema);

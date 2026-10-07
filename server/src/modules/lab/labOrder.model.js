// A lab order (as in Perinexa): the tests a doctor or RMO ordered for a patient, and their results.
//   ordered → collected (sample taken) → reported (the lab finished the results) → reviewed (a doctor saw them).
// A change after the report needs a reason; the earlier results stay in `amendments` and the order goes back to
// "reported" so a doctor sees the change. Cancelled orders are kept, with who, when and why.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { FLAGS } from './labTests.js';

const { ObjectId } = mongoose.Schema.Types;
const stamp = () => ({
  type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, at: Date }, { _id: false }),
  default: null,
});

export const LAB_STATUSES = ['ordered', 'collected', 'reported', 'reviewed', 'cancelled'];

const valueSchema = new mongoose.Schema(
  { key: String, value: { type: String, trim: true, maxlength: 200, default: '' }, flag: { type: String, enum: FLAGS, default: '' } },
  { _id: false },
);
const testSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // a catalogue key, or 'other'
    name: { type: String, required: true, maxlength: 150 },
    values: { type: [valueSchema], default: [] },
    text: { type: String, trim: true, maxlength: 2000, default: '' }, // the result in words (the whole result of 'other')
  },
  { _id: false },
);

const labOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, immutable: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    status: { type: String, enum: LAB_STATUSES, default: 'ordered' },
    urgent: { type: Boolean, default: false },
    tests: { type: [testSchema], default: [] },
    packages: { type: [new mongoose.Schema({ key: String, name: String, approved: Boolean }, { _id: false })], default: [] },
    noteToLab: { type: String, trim: true, maxlength: 500, default: '' },
    labNote: { type: String, trim: true, maxlength: 1000, default: '' },
    ordered: { type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, at: Date }, { _id: false }), required: true },
    collected: stamp(),
    reported: stamp(),
    reviewed: stamp(),
    cancelled: {
      type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, at: Date, reason: { type: String, maxlength: 300 } }, { _id: false }),
      default: null,
    },
    amendments: {
      type: [new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, at: Date, reason: String, tests: [testSchema], labNote: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
labOrderSchema.plugin(hospitalScoped);
labOrderSchema.index({ hospitalId: 1, orderNumber: 1 }, { unique: true });
labOrderSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
labOrderSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });

export const LabOrder = mongoose.model('LabOrder', labOrderSchema, 'lab_orders');

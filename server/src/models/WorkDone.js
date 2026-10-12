import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A scan or procedure done for a patient (billing): recorded by the doctor, RMO or nurse who did it, from the
// hospital's price list, so its charge goes on her bill by itself. Not a clinical note: only what was done, the day
// and by whom – the findings belong in the visit. Never deleted: one entered in error is cancelled with a reason.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const workDoneSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    priceItemId: { type: ObjectId, ref: 'PriceItem', required: true },
    name: { type: String, required: true, maxlength: 120 }, // the item's name when it was done
    group: { type: String, enum: ['scan', 'procedure'], required: true },
    on: { type: Date, required: true }, // the day (midnight UTC)
    doctorId: { type: ObjectId, ref: 'User', default: null },
    clientRequestId: { type: String, required: true },
    done: { type: new mongoose.Schema(stamp, { _id: false }), required: true },
    cancelled: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
workDoneSchema.plugin(tenantScoped);
workDoneSchema.index({ tenantId: 1, patientId: 1, on: -1 });
workDoneSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const WorkDone = mongoose.model('WorkDone', workDoneSchema);

import mongoose from 'mongoose';
import { FORM_SCREEN_KEYS } from '../clinical/formRegister.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One version of a controlled form in the hospital's document register (Clinical Requirements Group C – PX-X-02).
// A draft is recorded by the quality lead or the admin and approved by a doctor; an approved version is in force from
// its day until a later approved version of the same screen starts. Never changed after approval and never deleted:
// a draft entered by mistake is withdrawn with a reason.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: ObjectId, byName: String, at: Date };
const formVersionSchema = new mongoose.Schema(
  {
    screen: { type: String, enum: FORM_SCREEN_KEYS, required: true },
    code: { type: String, required: true, trim: true, maxlength: 30 },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    version: { type: String, required: true, trim: true, maxlength: 20 },
    effectiveFrom: { type: String, required: true, maxlength: 10 }, // 'YYYY-MM-DD'
    reviewDue: { type: String, maxlength: 10, default: '' },
    note: { type: String, maxlength: 300, default: '' },
    status: { type: String, enum: ['draft', 'approved', 'withdrawn'], default: 'draft' },
    recorded: stamp,
    approved: { type: new mongoose.Schema(stamp, { _id: false }), default: null },
    withdrawn: { type: new mongoose.Schema({ ...stamp, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
formVersionSchema.plugin(tenantScoped);
formVersionSchema.index({ tenantId: 1, screen: 1, effectiveFrom: -1 });

export const FormVersion = mongoose.model('FormVersion', formVersionSchema);

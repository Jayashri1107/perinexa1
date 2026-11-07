import mongoose from 'mongoose';
import { PRIVILEGE_KEYS } from '../clinical/privileges.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A clinical privilege granted to a member of staff (Clinical Requirements Group C – PX-X-07; DRAFT list,
// clinical/privileges.js): which procedure, until when, who granted it. Never deleted: one that stops is ended, with
// who, when and why.

const { ObjectId } = mongoose.Schema.Types;
const privilegeSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    key: { type: String, enum: PRIVILEGE_KEYS, required: true },
    validUntil: { type: String, maxlength: 10, default: '' }, // 'YYYY-MM-DD' (the last day), '' = no end date
    note: { type: String, maxlength: 300, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    ended: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
  },
  { timestamps: true },
);
privilegeSchema.plugin(tenantScoped);
privilegeSchema.index({ tenantId: 1, userId: 1, key: 1 });

export const StaffPrivilege = mongoose.model('StaffPrivilege', privilegeSchema);

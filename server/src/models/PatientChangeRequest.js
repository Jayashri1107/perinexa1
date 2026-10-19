import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A patient's request, from her portal profile, to change her name, age, mobile number or email (owner, 19 Oct 2026:
// "contact details she changes herself; name via reception"). Reception checks who she is and approves (the record and
// her sign-in are changed then) or rejects with a reason. One request waits at a time: a new one replaces it.

const { ObjectId } = mongoose.Schema.Types;
const stamp = new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date, reason: { type: String, default: '' } }, { _id: false });

export const CHANGE_FIELDS = ['fullName', 'ageYears', 'phone', 'email'];
export const CHANGE_STATUSES = ['pending', 'approved', 'rejected', 'replaced'];

const changeRequestSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    accountId: { type: ObjectId, ref: 'PatientAccount', default: null }, // her own account (null: signed in with a paper code)
    changes: {
      fullName: { type: String, trim: true, maxlength: 150 },
      ageYears: { type: Number, min: 10, max: 120 },
      phone: { type: String, trim: true, maxlength: 30 },
      email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    },
    note: { type: String, trim: true, maxlength: 300, default: '' }, // why, in her words (e.g. "name after marriage")
    status: { type: String, enum: CHANGE_STATUSES, default: 'pending' },
    reviewed: { type: stamp, default: null },
  },
  { timestamps: true },
);
changeRequestSchema.plugin(tenantScoped);

export const PatientChangeRequest = mongoose.model('PatientChangeRequest', changeRequestSchema);

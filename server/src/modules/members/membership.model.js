// A person's place in one hospital: which roles they hold there, and whether that access is active.
// One person can be a member of several hospitals with one login.
import mongoose from '../../db/mongoose.js';
import { ROLE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const membershipSchema = new mongoose.Schema(
  {
    hospitalId: { type: ObjectId, ref: 'Hospital', required: true, immutable: true },
    userId: { type: ObjectId, ref: 'User', required: true, immutable: true },
    roles: {
      type: [{ type: String, enum: ROLE_KEYS }],
      validate: [(v) => v.length > 0, 'At least one role is needed'],
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

membershipSchema.index({ hospitalId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, isActive: 1 });
membershipSchema.index({ hospitalId: 1, isActive: 1, createdAt: -1 });

export const Membership = mongoose.model('Membership', membershipSchema, 'memberships');

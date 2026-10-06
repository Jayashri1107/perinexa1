import mongoose from '../../db/mongoose.js';

const { ObjectId } = mongoose.Schema.Types;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    isSuperAdmin: { type: Boolean, default: false },
    // the main super admin (the first one, made by the seed): only they manage super admin accounts,
    // and nobody else can change, deactivate or reset their account
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    // true until the person replaces their temporary password
    mustChangePassword: { type: Boolean, default: true },
    // raised to end every session of this person at once
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

// The user list is filtered by kind and status, newest first.
userSchema.index({ isSuperAdmin: 1, isActive: 1, createdAt: -1 });
// there can only ever be one main super admin
userSchema.index({ isPrimary: 1 }, { unique: true, partialFilterExpression: { isPrimary: true } });

export const User = mongoose.model('User', userSchema, 'users');

// Fields that are never sent to the browser from an aggregate.
export const HIDDEN_USER_FIELDS = { passwordHash: 0, tokenVersion: 0 };

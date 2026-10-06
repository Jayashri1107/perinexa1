import mongoose from '../../db/mongoose.js';
import { DENSITY_KEYS, TEXT_SIZE_KEYS } from '../../config/index.js';

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
    // the hospital the person last worked in; they land there at the next login
    lastHospitalId: { type: ObjectId, ref: 'Hospital', default: null },
    // printed on prescriptions (doctors and RMOs fill these in under My settings)
    professional: {
      qualification: { type: String, trim: true, maxlength: 150, default: '' },
      registrationNumber: { type: String, trim: true, maxlength: 60, default: '' },
      council: { type: String, trim: true, maxlength: 120, default: '' },
    },
    // each person's own look of the website (My settings → Appearance)
    preferences: {
      textSize: { type: String, enum: TEXT_SIZE_KEYS, default: TEXT_SIZE_KEYS[0] },
      density: { type: String, enum: DENSITY_KEYS, default: DENSITY_KEYS[0] },
    },
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

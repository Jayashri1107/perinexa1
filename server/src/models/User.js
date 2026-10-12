import mongoose from 'mongoose';
import { APPEARANCE_CHOICES, STANDARD_APPEARANCE } from '../utils/appearance.js';

// A person's login account. It is shared across hospitals: what they may do in each hospital
// is decided by their Membership there. Super admins manage the platform (hospitals and users)
// and are deliberately not members of any hospital, so they can't see patient data.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Never returned by queries unless explicitly asked for with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    isSuperAdmin: { type: Boolean, default: false },
    // Printed under a doctor's / RMO's name on prescriptions. Belongs to the person, not the hospital.
    professional: {
      qualification: { type: String, trim: true, maxlength: 150, default: '' }, // e.g. "MBBS, MS (OBGY)"
      registrationNumber: { type: String, trim: true, maxlength: 60, default: '' },
      council: { type: String, trim: true, maxlength: 120, default: '' }, // e.g. "Maharashtra Medical Council"
    },
    // How the app looks for this person (My settings → Appearance), on every computer they use.
    preferences: {
      appearance: Object.fromEntries(Object.entries(APPEARANCE_CHOICES).map(([k, values]) => [k, { type: String, enum: values, default: STANDARD_APPEARANCE[k] }])),
    },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    // The hospital the person was last working in; they land there at next login.
    lastTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
    // Increased whenever existing sessions must stop working (logout, password change, deactivation).
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Indexes for sorting and filtering long user lists.
userSchema.index({ createdAt: -1 });
userSchema.index({ name: 1 });
userSchema.index({ lastLoginAt: -1 });
userSchema.index({ isSuperAdmin: 1, isActive: 1 });

// Remove private fields whenever a user is turned into JSON for a response.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.lastTenantId;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

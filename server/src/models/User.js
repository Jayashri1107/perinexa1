import mongoose from 'mongoose';
import { APPEARANCE_CHOICES, STANDARD_APPEARANCE } from '../utils/appearance.js';

// What a platform admin may be allowed to change: hospitals (create, rename, activate), user accounts (not super
// admins or platform admins) and each hospital's setup (staff, letterhead, patient messages, OPD timings, ABDM).
export const PLATFORM_AREAS = ['hospitals', 'users', 'hospitalSetup', 'hospitalAdmins'];

// A person's login account. It is shared across hospitals: what they may do in each hospital
// is decided by their Membership there. Super admins manage the platform (hospitals and users)
// and are deliberately not members of any hospital, so they can't see patient data. Platform admins see what a
// super admin sees, view only, apart from the areas a super admin ticked for them.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Never returned by queries unless explicitly asked for with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    isSuperAdmin: { type: Boolean, default: false },
    // A platform admin: like a super admin never a member of any hospital, and never sees patient records.
    isPlatformAdmin: { type: Boolean, default: false },
    platformPermissions: { type: [{ type: String, enum: PLATFORM_AREAS }], default: [] },
    // A super admin's or platform admin's own hospital account (the same person as a doctor, say): "Switch to your
    // doctor account" signs them out and opens the sign-in with that account's email – its password is still asked.
    linkedAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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
userSchema.index({ isPlatformAdmin: 1, isActive: 1 });

// Remove private fields whenever a user is turned into JSON for a response.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.lastTenantId;
    if (ret.linkedAccountId) ret.linkedAccountId = ret.linkedAccountId.toString();
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

/** A super admin or a platform admin: works on the platform, never as a member of a hospital. */
export const isPlatformUser = (user) => Boolean(user?.isSuperAdmin || user?.isPlatformAdmin);

/** May this person change things in this platform area? Super admins everything; platform admins the ticked areas. */
export const canEditPlatform = (user, area) => Boolean(user?.isSuperAdmin || (user?.isPlatformAdmin && area && user.platformPermissions?.includes(area)));

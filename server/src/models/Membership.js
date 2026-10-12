import mongoose from 'mongoose';

// Roles a person can have inside one hospital. Only "admin" can manage that hospital's users.
// "rmo" = resident medical officer; "lab" = lab staff; "pharmacist" = the pharmacy (stock, counter, registers);
// "billing" = the billing department (bills, payments, billing reports – no medical details).
export const TENANT_ROLES = ['admin', 'doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'];

// What a hospital admin may do to the hospital's staff – only what the super admin gave them (owner, 12 Oct 2026):
// reset a password, remove or restore access, change roles, edit name and email. Without it they see who works there.
export const ADMIN_RIGHTS = ['resetPassword', 'access', 'roles', 'details'];

// Links a user to a hospital ("tagging"), with the roles they have there.
// One user can have memberships in several hospitals, and one or more roles in each
// (e.g. a doctor who is also the hospital admin).
const membershipSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roles: {
      type: [{ type: String, enum: TENANT_ROLES }],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'At least one role is required' },
    },
    isActive: { type: Boolean, default: true },
    // A hospital admin's rights over the staff (ADMIN_RIGHTS), set by the super admin
    adminRights: { type: [{ type: String, enum: ADMIN_RIGHTS }], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ tenantId: 1, roles: 1, isActive: 1 });

// Keep roles unique and in a fixed order.
membershipSchema.pre('validate', function () {
  if (Array.isArray(this.roles)) this.roles = TENANT_ROLES.filter((r) => this.roles.includes(r));
});

export const hasRole = (membership, ...roles) => Boolean(membership?.roles?.some((r) => roles.includes(r)));

export const Membership = mongoose.model('Membership', membershipSchema);

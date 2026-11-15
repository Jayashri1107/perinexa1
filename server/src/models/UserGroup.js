import mongoose from 'mongoose';
import { PAGE_LEVELS } from '../access/pages.js';
import { TENANT_ROLES } from './Membership.js';

// A user group (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part B): made by the super admin once, for every
// hospital. Not hospital data (no tenantId): it holds no patient data, only what a kind of staff may do.
//  - roles: what the group's people may do and which patient records they may open – the same roles and need-to-know
//    rules as before (utils/patientAccess.js); a member's roles in a hospital are the group's.
//  - pages: per menu item (access/pages.js) None or View; a menu item not listed is Edit.
//  - system: one of the 13 groups made from the old roles – it keeps its roles, its pages may be changed.
// Deactivated, never deleted. Every change is in the audit log.
const userGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    roles: {
      type: [{ type: String, enum: TENANT_ROLES }],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Choose at least one role' },
    },
    pages: { type: Map, of: { type: String, enum: PAGE_LEVELS }, default: {} },
    system: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Roles unique and in a fixed order (as on a membership)
userGroupSchema.pre('validate', function () {
  if (Array.isArray(this.roles)) this.roles = TENANT_ROLES.filter((r) => this.roles.includes(r));
});
userGroupSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
userGroupSchema.index({ roles: 1, isActive: 1 });

export const UserGroup = mongoose.model('UserGroup', userGroupSchema);

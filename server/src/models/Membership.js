import mongoose from 'mongoose';

// Roles a person can have inside one hospital. Only "admin" can manage that hospital's users.
// "rmo" = resident medical officer; "lab" = lab staff; "pharmacist" = the pharmacy (stock, counter, registers);
// "billing" = the billing department (bills, payments, billing reports – no medical details);
// "referral_desk" = the referral desk: logs referrals from other doctors, books appointments and sends replies – never
// the medical record (utils/patientAccess.js, routes/referrals.js; docs/REFERRALS_PLAN.md).
// "sonographer" = sonography staff (owner, 24 Oct 2026 – docs/IDEAS_FOR_LATER.md 17): the scan list, does scans, adds
// pictures and writes reports for a doctor to sign; never the rest of the medical record (routes/imaging.js).
// "followup_coordinator" = the newborn follow-up coordinator (Clinical Requirements Group A, item 4): the babies'
// screening and follow-up clinic dates and the defaulters to call – never the medical record (routes/newbornFollowUp.js).
// "quality" = the quality lead (Group A, item 6): reviews incidents, records their actions and closes them; reads the
// clinical audit's numbers – never the medical record (routes/incidents.js).
export const TENANT_ROLES = ['admin', 'doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'sonographer', 'pharmacist', 'billing', 'referral_desk', 'followup_coordinator', 'quality'];

// What a hospital admin may do to the hospital's staff – only what the super admin gave them (owner, 12 Oct 2026):
// reset a password, remove or restore access, change roles, edit name and email. Without it they see who works there.
// addPeople (22 Oct 2026): add new staff to the hospital – never another admin (only the super admin makes admins).
export const ADMIN_RIGHTS = ['addPeople', 'resetPassword', 'access', 'roles', 'details'];
// A doctor's department in this hospital (owner, 27 Oct 2026): registration shows the department first, then its
// doctors. Set by the hospital admin; the same list is in client/src/platform/departments.js. A doctor may work in more than
// one department (29 Oct 2026): departments; department is the first of them.
// The owner's 9 departments (9 Nov 2026, docs/DEPARTMENT_ACCESS_PLAN.md): a doctor sees only the patients of their
// departments (utils/patientAccess.js). They replace the 23 used before; OLD_DEPARTMENTS says where each old one went.
export const DEPARTMENTS = ['Obgy', 'Pediatric', 'Radiology', 'Anesthesia', 'Diet and yoga', 'Surgery', 'Fetal medicine', 'Counselling', 'Cardiology'];
// The departments before 9 Nov 2026 → the new one ('' = none: the admin chooses again). Used by
// scripts/move-departments.js and scripts/hospital-doctors.js.
export const OLD_DEPARTMENTS = {
  'Obstetrics & Gynaecology': 'Obgy',
  Paediatrics: 'Pediatric',
  Neonatology: 'Pediatric',
  Anaesthesia: 'Anesthesia',
  Dietetics: 'Diet and yoga',
  Yoga: 'Diet and yoga',
  'General Surgery': 'Surgery',
  'Genetic Counselling': 'Counselling',
  Radiology: 'Radiology',
  'Interventional Radiology': 'Radiology',
  Cardiology: 'Cardiology',
  General: '',
  'General Medicine': '',
  Gastroenterology: '',
  Lactation: '',
  Neurology: '',
  'Medical Oncology': '',
  'Surgical Oncology': '',
  Orthopaedics: '',
  Pathology: '',
  Physiotherapy: '',
  'Plastic & Reconstructive Surgery': '',
  Urology: '',
};
/** The new departments for a list of old (or already new) names, in the list's order, without repeats. PURE. */
export const newDepartments = (names = []) => {
  const mapped = names.map((n) => (DEPARTMENTS.includes(n) ? n : (OLD_DEPARTMENTS[n] ?? '')));
  return DEPARTMENTS.filter((d) => mapped.includes(d));
};

/** A doctor's departments, also on memberships saved before a doctor could have more than one. */
export const departmentsOf = (m) => (m?.departments?.length ? [...m.departments] : m?.department ? [m.department] : []);

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
    // A doctor's departments here (DEPARTMENTS); department: the first of them ('' = not set)
    department: { type: String, enum: ['', ...DEPARTMENTS], default: '' },
    departments: { type: [{ type: String, enum: DEPARTMENTS }], default: [] },
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

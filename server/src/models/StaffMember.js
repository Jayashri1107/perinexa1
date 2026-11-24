import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The payroll's staff list (docs/PAYROLL_BUILD_NOTE.md, Stage A): everyone the hospital pays a monthly salary –
// also people with no Perinexa login (attendants, cleaners, security). Separate from User on purpose: most people on
// a payroll have no login, a login is shared across hospitals and pay is not, and a login's JSON goes to many screens.
//  - userId is set by hand when the person also has a login – never matched by name or email. Nothing here gives or
//    takes a right, and deactivating a login does not end a staff member's pay (nor the reverse).
//  - pay[] is dated: a change of pay adds an entry. Money is in paise, whole numbers.
//  - The four numbers (PF number / UAN, ESI number, PAN, bank account) are kept sealed (payroll/secretBox.js) with
//    their last four characters, and are not selected unless a route asks for them: no list answer carries them and
//    the sealed text never leaves the server. Aadhaar has no field.
// Never deleted (isActive). Read by the accounts login and the hospital admin only (routes/payroll.js); not part of
// the hospital export.

const sealedSchema = new mongoose.Schema({ enc: { type: String, default: '' }, last4: { type: String, default: '' } }, { _id: false });
const sealed = () => ({ type: sealedSchema, select: false });
const applies = () => ({ applies: { type: Boolean, default: false } });

const payEntrySchema = new mongoose.Schema(
  {
    from: { type: Date, required: true }, // the first day this pay counts
    // key: one of the hospital's salary parts (Tenant.payroll.parts)
    parts: { type: [new mongoose.Schema({ key: { type: String, required: true, maxlength: 40 }, amountPaise: { type: Number, required: true, min: 0 } }, { _id: false })], default: [] },
    pf: applies(),
    esi: applies(),
    pt: applies(), // professional tax
    // Income tax taken from salary (decision 8): the monthly figure the accountant types – Perinexa never works it out
    tdsPaise: { type: Number, min: 0, default: 0 },
    byName: { type: String, default: '' },
    at: { type: Date, default: null },
  },
  { _id: false },
);

const staffSchema = new mongoose.Schema(
  {
    staffNumber: { type: String, required: true, trim: true, maxlength: 20 }, // the hospital's own
    name: { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, trim: true, maxlength: 80, default: '' },
    department: { type: String, trim: true, maxlength: 80, default: '' },
    joinedOn: { type: Date, default: null },
    leftOn: { type: Date, default: null }, // the last working day
    isActive: { type: Boolean, default: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The code or codes this person carries in the attendance machine's file or the sheet (Stage B matches on them)
    attendanceCodes: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    pay: { type: [payEntrySchema], default: [] },
    // Stage C: which table of professional tax slabs is this person's (the state's table differs for men and women).
    // Empty = not chosen: professional tax can't be worked out for them, and the month can't be locked.
    ptSlab: { type: String, enum: ['', 'men', 'women'], default: '' },
    uan: sealed(),
    esiNumber: sealed(),
    pan: sealed(),
    bank: {
      accountNumber: sealed(),
      ifsc: { type: String, trim: true, uppercase: true, maxlength: 11, default: '' },
      bankName: { type: String, trim: true, maxlength: 80, default: '' },
    },
    createdByName: { type: String, default: '' },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
staffSchema.plugin(tenantScoped);
staffSchema.index({ tenantId: 1, staffNumber: 1 }, { unique: true });
// One staff record per login within a hospital – only where a login is set
staffSchema.index({ tenantId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
staffSchema.index({ tenantId: 1, attendanceCodes: 1 });
staffSchema.index({ tenantId: 1, isActive: 1, name: 1 });

/** The sealed numbers, for the routes that show them masked or read one in full. */
export const WITH_NUMBERS = '+uan +esiNumber +pan +bank.accountNumber';

export const StaffMember = mongoose.model('StaffMember', staffSchema);

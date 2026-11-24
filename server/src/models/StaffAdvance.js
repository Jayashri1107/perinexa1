import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Payroll, Stage C (docs/PAYROLL_BUILD_NOTE.md section 5 C): an advance given to a staff member and taken back from
// their salary month by month. The date, the amount, the monthly instalment, the first month it is taken back from,
// a note. Money in paise, whole numbers.
//  - What each month took back is NOT kept here: a locked month keeps it (PayrollRun.recovered), so locking and
//    reopening a month is one write, and what is left of an advance is always the amount less the locked months.
//  - The amount and the date are never changed: an advance entered wrongly is stopped with a reason and entered
//    again. Never deleted.
// For the accounts login and the hospital admin only (routes/payrollAdvances.js); not part of the hospital export.
// Nothing here is written into Daily expenses.
const advanceSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffMember', required: true },
    givenOn: { type: Date, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    instalmentPaise: { type: Number, required: true, min: 0 }, // taken back each month; 0 = nothing until it is changed
    recoverFrom: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // the first month it is taken back from
    note: { type: String, trim: true, maxlength: 200, default: '' },
    // Stopped: nothing more is taken back (entered by mistake, or settled outside the salary)
    stopped: { type: new mongoose.Schema({ byName: { type: String, default: '' }, at: { type: Date, default: null }, reason: { type: String, default: '', maxlength: 200 } }, { _id: false }), default: null },
    createdByName: { type: String, default: '' },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
advanceSchema.plugin(tenantScoped);
advanceSchema.index({ tenantId: 1, staffId: 1, givenOn: 1 });

export const StaffAdvance = mongoose.model('StaffAdvance', advanceSchema);

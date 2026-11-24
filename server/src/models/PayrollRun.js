import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): one hospital's working sheet for one month.
//  - read: what the attendance files said, one entry per code (the counts of the month and, where the file is day by
//    day, each day's kind – so joining and leaving inside the month can be applied). Matching to staff is by code.
//  - leftOut: codes in a file that belong to nobody on the payroll, left out with a reason.
//  - corrections: a person's paid days typed by hand, with a reason – shown beside the file's figure, never in its place.
// While a month is 'draft' no amount is kept here: the sheet is worked out each time from the staff list, the
// settings, the rates and these days (payroll/payrollMath.js, payroll/payrollDeductions.js).
// Stage C – one person's month, each typed by the accounts person:
//  - tds: income tax for this month only, in place of the figure on the person's pay entry;
//  - lines: one-off additions and deductions (an arrear, a fine the hospital's rules allow), each saying what for;
//  - instalments: an advance's instalment changed for this month, with a reason.
// Stage D – locking:
//  - status 'locked' and versions[]: each lock keeps a full snapshot (payroll/payrollLists.js snapshotOf): every
//    person's days, pay entry, earnings, deductions, the hospital's shares, advances and take-home, the settings and
//    the rates used, who locked and when. A locked month is shown and printed from its snapshot only – a later
//    change of pay, rates or the staff list never changes it.
//  - recovered: what this locked month took back of each advance (emptied when the month is reopened);
//  - used: the pay entry (by its first day) each person of this locked month was paid with – such an entry can't
//    be corrected while the month is locked (routes/payroll.js); emptied when the month is reopened;
//  - reopened: who reopened which version, when and why (the hospital admin only); the version stays;
//  - downloads: which monthly lists were saved as files from which version.
// For the accounts login and the hospital admin only (routes/payrollRuns.js); not part of the hospital export.
const stamp = () => ({ byName: { type: String, default: '' }, at: { type: Date, default: null } });
const staffRef = () => ({ type: mongoose.Schema.Types.ObjectId, ref: 'StaffMember', required: true });
const readSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceFile', required: true },
    code: { type: String, required: true, maxlength: 40 },
    name: { type: String, default: '', maxlength: 120 }, // as written in the file – shown to help tie an unknown code
    row: { type: Number, default: 0 },
    counts: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    paidDaysGiven: { type: Number, default: null },
    days: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const runSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ['draft', 'locked'], default: 'draft' },
    read: { type: [readSchema], default: [] },
    leftOut: { type: [new mongoose.Schema({ code: { type: String, required: true, maxlength: 40 }, reason: { type: String, required: true, maxlength: 200 }, ...stamp() }, { _id: false })], default: [] },
    corrections: {
      type: [new mongoose.Schema({ staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffMember', required: true }, paidDays: { type: Number, required: true, min: 0, max: 31 }, reason: { type: String, required: true, maxlength: 200 }, ...stamp() }, { _id: false })],
      default: [],
    },
    tds: { type: [new mongoose.Schema({ staffId: staffRef(), tdsPaise: { type: Number, required: true, min: 0 }, ...stamp() }, { _id: false })], default: [] },
    lines: {
      type: [new mongoose.Schema({ staffId: staffRef(), kind: { type: String, enum: ['addition', 'deduction'], required: true }, label: { type: String, required: true, maxlength: 80 }, amountPaise: { type: Number, required: true, min: 1 }, ...stamp() }, { _id: false })],
      default: [],
    },
    instalments: {
      type: [new mongoose.Schema({ staffId: staffRef(), advanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffAdvance', required: true }, amountPaise: { type: Number, required: true, min: 0 }, reason: { type: String, required: true, maxlength: 200 }, ...stamp() }, { _id: false })],
      default: [],
    },
    recovered: { type: [new mongoose.Schema({ advanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffAdvance', required: true }, amountPaise: { type: Number, required: true, min: 1 } }, { _id: false })], default: [] },
    used: { type: [new mongoose.Schema({ staffId: staffRef(), payFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ } }, { _id: false })], default: [] },
    versions: {
      type: [new mongoose.Schema({ version: { type: Number, required: true }, lockedByName: { type: String, default: '' }, lockedAt: { type: Date, default: null }, people: { type: Number, default: 0 }, snapshot: { type: mongoose.Schema.Types.Mixed, required: true } }, { _id: false })],
      default: [],
    },
    reopened: { type: [new mongoose.Schema({ version: { type: Number, required: true }, reason: { type: String, required: true, maxlength: 300 }, ...stamp() }, { _id: false })], default: [] },
    downloads: { type: [new mongoose.Schema({ version: { type: Number, required: true }, list: { type: String, required: true, maxlength: 20 }, ...stamp() }, { _id: false })], default: [] },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
runSchema.plugin(tenantScoped);
runSchema.index({ tenantId: 1, month: 1 }, { unique: true });

export const PayrollRun = mongoose.model('PayrollRun', runSchema);

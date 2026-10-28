import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The day's expenses paid from the counter (owner, 27 Oct 2026): what was paid out – tea, courier, stationery, a petty
// cash advance – so the daily collection shows what is left after them. Never a patient's details. An expense is never
// deleted: one entered by mistake is cancelled with a reason and stays listed, struck through. Amounts are paise.
// Daily Expenses page (28 Oct 2026, like the hospital's old "Daily Expenses" screen): a head from the hospital's own
// list (ExpenseHead), the person paid, a voucher number, the time, cheque or wallet details, and the bill as a file.
// Expenses entered before then have a category instead of a head.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

export const EXPENSE_CATEGORIES = ['petty_cash', 'refreshments', 'stationery', 'courier', 'transport', 'cleaning', 'repairs', 'salary_advance', 'other'];
// 'upi' is UPI or a wallet (its name in walletName)
export const EXPENSE_MODES = ['cash', 'cheque', 'upi', 'bank', 'card'];

const expenseSchema = new mongoose.Schema(
  {
    day: { type: Date, required: true }, // the hospital's date (midnight UTC)
    time: { type: String, match: /^(([01]\d|2[0-3]):[0-5]\d)?$/, default: '' }, // 'HH:MM', the hospital's time
    category: { type: String, enum: EXPENSE_CATEGORIES }, // entries before 28 Oct 2026
    headId: { type: ObjectId, ref: 'ExpenseHead', default: null },
    head: { type: String, trim: true, maxlength: 60, default: '' }, // the head's name when entered
    description: { type: String, trim: true, maxlength: 200, default: '' }, // the reason
    paidTo: { type: String, trim: true, maxlength: 100, default: '' }, // the person's name
    voucherNo: { type: String, trim: true, maxlength: 30, default: '' },
    mode: { type: String, enum: EXPENSE_MODES, required: true },
    chequeNo: { type: String, trim: true, maxlength: 20, default: '' },
    bankName: { type: String, trim: true, maxlength: 80, default: '' },
    chequeDate: { type: Date, default: null },
    walletName: { type: String, trim: true, maxlength: 40, default: '' },
    amountPaise: { type: Number, required: true, min: 1 },
    file: { type: new mongoose.Schema({ fileId: ObjectId, fileName: String, mediaType: String, size: Number }, { _id: false }), default: null },
    added: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
expenseSchema.plugin(tenantScoped);
expenseSchema.index({ tenantId: 1, day: 1 });

export const Expense = mongoose.model('Expense', expenseSchema);

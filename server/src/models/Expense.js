import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The day's expenses paid from the counter (owner, 27 Oct 2026): what was paid out – tea, courier, stationery, a petty
// cash advance – so the daily collection shows what is left after them. Never a patient's details. An expense is never
// deleted: one entered by mistake is cancelled with a reason and stays listed, struck through. Amounts are paise.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

export const EXPENSE_CATEGORIES = ['petty_cash', 'refreshments', 'stationery', 'courier', 'transport', 'cleaning', 'repairs', 'salary_advance', 'other'];
export const EXPENSE_MODES = ['cash', 'upi', 'card', 'bank'];

const expenseSchema = new mongoose.Schema(
  {
    day: { type: Date, required: true }, // the hospital's date (midnight UTC)
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    paidTo: { type: String, trim: true, maxlength: 100, default: '' },
    mode: { type: String, enum: EXPENSE_MODES, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    added: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    cancelled: { type: new mongoose.Schema({ ...byFields, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
expenseSchema.plugin(tenantScoped);
expenseSchema.index({ tenantId: 1, day: 1 });

export const Expense = mongoose.model('Expense', expenseSchema);

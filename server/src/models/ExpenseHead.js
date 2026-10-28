import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The hospital's list of expense heads (Daily Expenses, 28 Oct 2026): what money is paid out for – diesel, the
// electricity bill, staff salary… The hospital admin adds, renames or switches off a head; a head is never deleted,
// because expenses keep the name it had when they were entered. A new hospital starts with DEFAULT_EXPENSE_HEADS
// (the heads of the hospital's old billing software).

export const DEFAULT_EXPENSE_HEADS = [
  'Diesel expenses',
  'Electricity bill',
  'Staff salary',
  'Salary advance',
  'Staff advance',
  'Tea, coffee and snacks',
  'Travelling expenses',
  'Oxygen cylinder bill',
  'Newspaper bill',
  'TV recharge',
  'Consultant charges',
  'Doctor charges',
  'Office expenses',
  'Hospital expenses',
  'Hospital rent',
  'Radiology department',
  'Pharmacy expenses',
  'Physiotherapy charges',
  'Cardiology charges',
  'Stationery',
  'Courier',
  'Cleaning',
  'Repairs',
  'Other',
];

const headSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
headSchema.plugin(tenantScoped);
headSchema.index({ tenantId: 1, order: 1 });

export const ExpenseHead = mongoose.model('ExpenseHead', headSchema);

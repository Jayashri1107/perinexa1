import mongoose from 'mongoose';
import { VOUCHER_KINDS, VOUCHER_STATUSES } from '../tally/tallyRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One entry written for Tally (docs/TALLY_PLAN.md): what the file holds for a bill, a receipt, a pharmacy invoice, a
// credit note or a debit note – its lines by account, and what became of it. Kept for good (the accounts' trail);
// never changed except its status. Lines hold a role (the account's job) and the account name used at the time, so
// the file of a batch can be written again unchanged, and so a later change to a document is worked out against what
// was sent (tally/events.js). No names of patients: only document numbers.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, default: '' }, at: { type: Date, default: null } };

const lineSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, maxlength: 200 }, // e.g. income:lab, patients, mode:cash, psales:5, buyer:<name>
    ledger: { type: String, required: true, maxlength: 200 }, // the account's name in Tally when the entry was written
    paise: { type: Number, required: true, min: 1 },
    side: { type: String, enum: ['dr', 'cr'], required: true },
  },
  { _id: false },
);

const voucherSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 40 }, // Tally's voucher number: B-000123, R-000045, PH-000321/P1, B-000123/CN1 …
    remoteId: { type: String, required: true, maxlength: 60 }, // Tally's REMOTEID: the same every time for this hospital and key
    kind: { type: String, enum: VOUCHER_KINDS, required: true },
    voucherType: { type: String, required: true, maxlength: 100 }, // the voucher type's name in Tally
    source: {
      model: { type: String, enum: ['Bill', 'PharmacyInvoice', 'SupplierReturn'], required: true },
      id: { type: ObjectId, required: true },
      number: { type: String, required: true },
      channel: { type: String, required: true, maxlength: 60 }, // main, deposits, payment:<receipt>, return:<CN>
    },
    date: { type: Date, required: true }, // the entry's day (midnight UTC)
    narration: { type: String, default: '', maxlength: 300 },
    lines: { type: [lineSchema], default: [] },
    amountPaise: { type: Number, required: true, min: 0 }, // the debits (= the credits)
    status: { type: String, enum: VOUCHER_STATUSES, default: 'exported' },
    batchId: { type: ObjectId, ref: 'TallyBatch', default: null }, // the batch whose file holds it (null: waiting for the next)
    batchNumber: { type: String, default: '' },
    batchIds: { type: [ObjectId], default: [] }, // every batch it was ever in (a failed entry goes into a later file again)
    note: { type: String, default: '', maxlength: 300 }, // Tally's words when it was refused, or why it was skipped
    handled: { type: new mongoose.Schema(stamp, { _id: false }), default: null }, // who last changed its status
    created: { type: new mongoose.Schema(stamp, { _id: false }), required: true },
  },
  { timestamps: true },
);
voucherSchema.plugin(tenantScoped);
voucherSchema.index({ tenantId: 1, key: 1 }, { unique: true });
voucherSchema.index({ tenantId: 1, 'source.model': 1, 'source.id': 1 });
voucherSchema.index({ tenantId: 1, status: 1, batchId: 1 });
voucherSchema.index({ tenantId: 1, batchId: 1 });
voucherSchema.index({ tenantId: 1, batchIds: 1 });
voucherSchema.index({ tenantId: 1, date: 1 });

export const TallyVoucher = mongoose.model('TallyVoucher', voucherSchema);

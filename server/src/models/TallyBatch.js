import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// One Tally file prepared by the hospital admin (docs/TALLY_PLAN.md): the period it covers, how many entries, which
// account names and voucher types it introduced (so the next batch introduces only new ones), and the fingerprint of
// its entries file. The file itself is written again from the entries (models/TallyVoucher.js) whenever it is
// downloaded – the same bytes every time, so a file given to the accountant can always be re-made.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, default: '' }, at: { type: Date, default: null } };

const batchSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // TB-000001
    company: { type: String, default: '' }, // the Tally company's name when the batch was made (its files never change)
    from: { type: Date, required: true }, // the first day of entries it could hold (the day after the batch before, or the day the books start)
    to: { type: Date, required: true }, // its last day; changes to earlier documents are dated this day
    vouchers: { type: Number, required: true, min: 0 },
    amountPaise: { type: Number, default: 0 }, // the debits of all its entries
    byKind: { type: Map, of: Number, default: {} },
    masters: { type: [new mongoose.Schema({ name: String, parent: String, gstin: { type: String, default: '' }, state: { type: String, default: '' } }, { _id: false })], default: [] },
    voucherTypes: { type: [new mongoose.Schema({ name: String, parent: String }, { _id: false })], default: [] },
    sha256: { type: String, default: '' }, // of the entries file when the batch was made
    downloads: { vouchers: { type: Number, default: 0 }, masters: { type: Number, default: 0 } },
    imported: { type: new mongoose.Schema(stamp, { _id: false }), default: null }, // the admin marked the whole batch imported
    created: { type: new mongoose.Schema(stamp, { _id: false }), required: true },
  },
  { timestamps: true },
);
batchSchema.plugin(tenantScoped);
batchSchema.index({ tenantId: 1, number: 1 }, { unique: true });
batchSchema.index({ tenantId: 1, createdAt: -1 });

export const TallyBatch = mongoose.model('TallyBatch', batchSchema);

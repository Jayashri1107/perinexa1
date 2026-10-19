import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The daily cash handover (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md; like Docterz's "Hisaab Kitaab"): at the end
// of the day the person who took payments (reception, the billing department) hands over the cash; a doctor or the
// hospital admin counts it and confirms what they received. One per person and day; it can be handed over again until
// it is confirmed. Amounts are paise. No patient data.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };

const handoverSchema = new mongoose.Schema(
  {
    day: { type: Date, required: true }, // the hospital's date (midnight UTC)
    userId: { type: ObjectId, ref: 'User', required: true }, // who took the payments and hands over
    userName: { type: String, required: true },
    // What Perinexa counted from her payments that day: cash in minus cash refunded, and every mode (net)
    cashPaise: { type: Number, required: true },
    byMode: { type: mongoose.Schema.Types.Mixed, default: {} }, // { cash: net, upi: net, card: net, insurance: net }
    payments: { type: Number, default: 0 }, // how many payments and refunds
    handedPaise: { type: Number, required: true, min: 0 }, // the cash she hands over
    note: { type: String, trim: true, maxlength: 300, default: '' },
    handed: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    received: {
      type: new mongoose.Schema({ ...byFields, receivedPaise: Number, note: { type: String, default: '' } }, { _id: false }),
      default: null,
    },
    // A payment of this person and day corrected after the handover was confirmed (by the hospital admin): shown on
    // the handover, which itself is not changed (owner, 19 Oct 2026)
    correctedAfter: {
      type: [new mongoose.Schema({ receipt: String, beforePaise: Number, afterPaise: Number, beforeMode: String, afterMode: String, ...byFields }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
handoverSchema.plugin(tenantScoped);
handoverSchema.index({ tenantId: 1, day: 1, userId: 1 }, { unique: true });

export const CashHandover = mongoose.model('CashHandover', handoverSchema);

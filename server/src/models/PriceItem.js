import mongoose from 'mongoose';
import { GROUPS } from '../billing/billingRules.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One item of a hospital's price list (billing). `key` links it to the work that charges it automatically
// (billing/builtInPrices.js); items the admin adds have none. Stopped, never deleted: old bills keep their prices.

const priceItemSchema = new mongoose.Schema(
  {
    key: { type: String, default: null, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    group: { type: String, enum: GROUPS, required: true },
    pricePaise: { type: Number, required: true, min: 0, default: 0 },
    // Bed charges: the ward this price is for ('' = the general ward, used for any ward not listed)
    ward: { type: String, trim: true, maxlength: 60, default: null },
    active: { type: Boolean, default: true },
    builtIn: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
priceItemSchema.plugin(tenantScoped);
priceItemSchema.index({ tenantId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
priceItemSchema.index({ tenantId: 1, group: 1, order: 1 });

export const PriceItem = mongoose.model('PriceItem', priceItemSchema);

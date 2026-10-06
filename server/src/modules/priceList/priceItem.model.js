// The hospital's price list: what each service costs. Bills take their lines from here.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { PRICE_GROUP_KEYS } from '../../config/index.js';

const priceItemSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    group: { type: String, enum: PRICE_GROUP_KEYS, required: true },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
priceItemSchema.plugin(hospitalScoped);
priceItemSchema.index({ hospitalId: 1, code: 1 }, { unique: true });
priceItemSchema.index({ hospitalId: 1, isActive: 1, group: 1, name: 1 });

export const PriceItem = mongoose.model('PriceItem', priceItemSchema, 'price_items');

// The pharmacy's medicine list.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { MEDICINE_FORM_KEYS, SCHEDULE_KEYS, config } from '../../config/index.js';

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true },
    generic: { type: String, trim: true, maxlength: 150, default: '' },
    form: { type: String, enum: MEDICINE_FORM_KEYS, required: true },
    strength: { type: String, trim: true, maxlength: 40, default: '' },
    schedule: { type: String, enum: SCHEDULE_KEYS, default: SCHEDULE_KEYS[0] },
    gstRate: { type: Number, enum: config.pharmacy.gstRates, required: true },
    hsn: { type: String, trim: true, maxlength: 10, default: '' },
    reorderLevel: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
medicineSchema.plugin(hospitalScoped);
medicineSchema.pre('validate', function () {
  if (this.name) this.nameKey = `${this.name} ${this.strength ?? ''} ${this.form ?? ''}`.trim().toLowerCase();
});
medicineSchema.index({ hospitalId: 1, nameKey: 1 }, { unique: true });
medicineSchema.index({ hospitalId: 1, isActive: 1, name: 1 });

export const Medicine = mongoose.model('Medicine', medicineSchema, 'medicines');

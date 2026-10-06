import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const text = (maxlength) => ({ type: String, trim: true, maxlength, default: '' });

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    nameKey: { type: String, required: true },
    gstin: text(20),
    drugLicence: text(80),
    phone: text(20),
    email: text(254),
    address: text(300),
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
supplierSchema.plugin(hospitalScoped);
supplierSchema.pre('validate', function () {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});
supplierSchema.index({ hospitalId: 1, nameKey: 1 }, { unique: true });

export const Supplier = mongoose.model('Supplier', supplierSchema, 'suppliers');

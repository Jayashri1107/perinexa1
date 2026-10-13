import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A bed in one of the hospital's wards (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): the hospital admin
// lists the wards and their beds; reception, doctors and RMOs admit a patient to a free bed; the bed board shows
// which beds are free. Whether a bed is occupied is not stored here – it is the stay (models/Admission.js, bedId)
// that is still open. A bed is never deleted, only taken out of use, so old stays keep pointing to it.
const bedSchema = new mongoose.Schema(
  {
    ward: { type: String, required: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
bedSchema.plugin(tenantScoped);
bedSchema.index({ tenantId: 1, ward: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const Bed = mongoose.model('Bed', bedSchema);

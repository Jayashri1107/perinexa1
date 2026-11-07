import mongoose from 'mongoose';
import { BED_KINDS, BED_LEVELS } from '../clinical/nicuAdmission.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A bed in one of the hospital's wards (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): the hospital admin
// lists the wards and their beds; reception, doctors and RMOs admit a patient to a free bed; the bed board shows
// which beds are free. Whether a bed is occupied is not stored here – it is the stay (models/Admission.js, bedId)
// that is still open. A bed is never deleted, only taken out of use, so old stays keep pointing to it.
const bedSchema = new mongoose.Schema(
  {
    ward: { type: String, required: true, trim: true, maxlength: 60 },
    // The floor it is on (29 Oct 2026), e.g. "1st floor"; '' = not said. The ward is the kind of room or ward (General
    // ward, NICU, Deluxe AC …), which also names its bed charge on the price list.
    floor: { type: String, trim: true, maxlength: 30, default: '' },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    active: { type: Boolean, default: true },
    // A NICU bed (Build 13, NEO-A-01 – set by the hospital admin on NICU units): which unit it belongs to, intensive or
    // step-down (the nurse:baby rule counts intensive beds) and the kind of bed. null = not a NICU bed. A baby in it is
    // an open NICU admission (models/NewbornCare.js, bedId) or a stay.
    nicu: {
      type: new mongoose.Schema(
        {
          unit: { type: String, required: true, maxlength: 30 },
          level: { type: String, enum: Object.keys(BED_LEVELS), required: true },
          kind: { type: String, enum: Object.keys(BED_KINDS), required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);
bedSchema.plugin(tenantScoped);
bedSchema.index({ tenantId: 1, ward: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const Bed = mongoose.model('Bed', bedSchema);

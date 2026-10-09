// A ward of the hospital (General ward, Private room, ICU, NICU, Labour room …) and its beds (owner, 8 Oct 2026).
// Kept by the hospital admin. A bed is never deleted (old stays name it): it is taken out of use instead. Which beds
// are booked is worked out from the stays in hospital now (admissions with status 'admitted').
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { config } from '../../config/index.js';

export const WARD_KINDS = config.wards.kinds.map((k) => k.key);

const bedSchema = new mongoose.Schema({ label: { type: String, required: true, trim: true, maxlength: 20 }, isActive: { type: Boolean, default: true } }, { _id: false });

const wardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: WARD_KINDS, required: true },
    floor: { type: String, trim: true, maxlength: 30, default: '' }, // e.g. Ground floor, 2nd floor (owner, 9 Oct 2026)
    beds: { type: [bedSchema], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
wardSchema.plugin(hospitalScoped);
wardSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

export const Ward = mongoose.model('Ward', wardSchema, 'wards');

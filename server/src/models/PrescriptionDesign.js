import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { RX_ACCENTS, RX_DESIGNS, RX_FONTS, RX_LINE_SPACINGS, RX_SHOW, RX_TITLES } from '../visits/rxCodes.js';

// How one doctor's (or RMO's) prescriptions look when printed at one hospital: one of the 10 designs, and
// their own choices (colour, text size, paper, language of the instructions, what to print, their
// specialities and timings, and margins for printing on their own pre-printed pad). Per hospital, because the
// letterhead and the paper can differ between hospitals. Holds no patient data.

const show = Object.fromEntries(RX_SHOW.map((k) => [k, { type: Boolean, default: true }]));
const titles = Object.fromEntries(RX_TITLES.map((k) => [k, { type: String, trim: true, maxlength: 40, default: '' }]));

const designSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    design: { type: String, enum: RX_DESIGNS, default: 'classic' },
    accent: { type: String, enum: RX_ACCENTS, default: 'indigo' },
    textSize: { type: String, enum: ['standard', 'large'], default: 'standard' },
    paper: { type: String, enum: ['A4', 'A5'], default: 'A4' },
    // Instructions printed in English, or in English with Marathi or Hindi under them.
    language: { type: String, enum: ['en', 'mr', 'hi'], default: 'en' },
    capitals: { type: Boolean, default: true }, // medicine names in CAPITALS (NMC advice for legible prescriptions)
    show: { type: new mongoose.Schema(show, { _id: false }), default: () => ({}) },
    specialities: { type: String, trim: true, maxlength: 200, default: '' }, // e.g. "Obstetrics & Gynaecology · Infertility"
    timings: { type: String, trim: true, maxlength: 200, default: '' }, // clinic timings
    footerNote: { type: String, trim: true, maxlength: 200, default: '' },
    // For the pre-printed pad: the space its printed header and footer take.
    marginTopMm: { type: Number, min: 0, max: 120, default: 45 },
    marginBottomMm: { type: Number, min: 0, max: 80, default: 20 },
    // Fine-tuning (null: as the design prints it)
    font: { type: String, enum: RX_FONTS, default: 'standard' },
    bodyPt: { type: Number, min: 8, max: 16, default: null }, // the text, in points (instead of Standard / Large)
    medicinePt: { type: Number, min: 8, max: 20, default: null }, // medicine names
    doctorPt: { type: Number, min: 10, max: 30, default: null }, // the doctor's name at the top
    lineSpacing: { type: String, enum: RX_LINE_SPACINGS, default: 'standard' },
    marginSideMm: { type: Number, min: 0, max: 40, default: null }, // left and right
    titles: { type: new mongoose.Schema(titles, { _id: false }), default: () => ({}) },
  },
  { timestamps: true },
);
designSchema.plugin(tenantScoped);
designSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export const PrescriptionDesign = mongoose.model('PrescriptionDesign', designSchema);

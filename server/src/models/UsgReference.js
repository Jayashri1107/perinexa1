import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Sonography stage 2 (docs/USG_APPS_REVIEW.md U1, U3, U5 – the owner's approval of 12 Nov 2026): the published
// reference tables the hospital's doctors choose – for each week, the 5th, 50th and 95th centile – copied in by a
// doctor from the named source and approved by a doctor. No table is built in: Perinexa never types a reference value
// from memory. Only an approved version is used (bands on the growth graphs, the second weight chart, Doppler marks).

export const USG_REFERENCE_KEYS = {
  bpd: { name: 'Biparietal diameter (BPD)', unit: 'mm' },
  hc: { name: 'Head circumference (HC)', unit: 'mm' },
  ac: { name: 'Abdominal circumference (AC)', unit: 'mm' },
  fl: { name: 'Femur length (FL)', unit: 'mm' },
  efw: { name: 'Estimated fetal weight – a second chart', unit: 'g' },
  uaPi: { name: 'Umbilical artery pulsatility index (UA PI)', unit: '' },
  mcaPi: { name: 'Middle cerebral artery pulsatility index (MCA PI)', unit: '' },
  utaPi: { name: 'Uterine arteries mean pulsatility index (UtA PI)', unit: '' },
  cpr: { name: 'Cerebroplacental ratio (CPR = MCA PI ÷ UA PI)', unit: '' },
  dvPi: { name: 'Ductus venosus pulsatility index (DV PIV)', unit: '' },
};

const stamp = { by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: Date };
const referenceSchema = new mongoose.Schema(
  {
    key: { type: String, enum: Object.keys(USG_REFERENCE_KEYS), required: true },
    source: { type: String, trim: true, maxlength: 300, default: '' }, // the published chart: authors, year, title
    rows: { type: [new mongoose.Schema({ week: Number, p5: Number, p50: Number, p95: Number }, { _id: false })], default: [] },
    version: { type: Number, default: 1 },
    approvedVersion: { type: Number, default: null },
    approved: { type: new mongoose.Schema(stamp, { _id: false }), default: null },
    // The approved copy in use while a newer DRAFT is being written
    inUse: { type: new mongoose.Schema({ source: String, rows: [new mongoose.Schema({ week: Number, p5: Number, p50: Number, p95: Number }, { _id: false })], version: Number }, { _id: false }), default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
referenceSchema.plugin(tenantScoped);
referenceSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const UsgReference = mongoose.model('UsgReference', referenceSchema);

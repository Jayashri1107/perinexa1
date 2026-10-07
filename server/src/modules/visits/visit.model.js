// One visit of a patient (as in Perinexa's models/Visit.js), in three parts that different people fill in, each saved
// on its own with its own version (rev), so a nurse saving the vitals never overwrites a doctor writing the
// prescription at the same moment:
//  - vitals: nurses, and her doctor or an RMO;
//  - details: findings, diagnosis, advice, next visit, and a private note (never printed, never shown to nurses);
//  - prescription: the medicines (her doctor or an RMO).
// Visits are never deleted: one entered by mistake is marked "entered in error". Once her doctor or an RMO signs it,
// nothing can change – a correction is added below it (who, when) and can itself never be changed.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { CARE_TYPE_KEYS } from '../../config/index.js';
import { FETAL_MOVEMENTS, OEDEMA_GRADES, PRESENTATIONS, RX_DURATION_UNITS, RX_FORMS, RX_FREQUENCIES, RX_ROUTES, RX_TIMINGS, URINE_GRADES } from './rxCodes.js';

const { ObjectId } = mongoose.Schema.Types;
const num = (min, max) => ({ type: Number, min, max, default: null });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });
const choice = (values) => ({ type: String, enum: values, default: '' });
const saved = { rev: { type: Number, default: 0 }, by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, default: null }, at: { type: Date, default: null } };

export const rxItemSchema = new mongoose.Schema({
  drug: { type: String, required: true, trim: true, maxlength: 120 },
  form: { type: String, enum: RX_FORMS, default: 'tab' },
  strength: text(40),
  dose: text(40),
  frequency: { type: String, enum: RX_FREQUENCIES, required: true },
  frequencyText: text(60),
  timing: choice(RX_TIMINGS),
  route: choice(RX_ROUTES),
  durationValue: { type: Number, min: 1, max: 365, default: null },
  durationUnit: choice(RX_DURATION_UNITS),
  instructions: text(200),
});

const visitSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    visitOn: { type: Date, required: true }, // the hospital's date of the visit (midnight UTC)
    careType: { type: String, enum: CARE_TYPE_KEYS, required: true },
    doctorId: { type: ObjectId, ref: 'User', default: null }, // her doctor at the time
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelled: { type: new mongoose.Schema({ reason: { type: String, required: true, maxlength: 300 }, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    signed: {
      type: new mongoose.Schema(
        { by: { type: ObjectId, ref: 'User', required: true }, byName: { type: String, required: true }, role: { type: String, required: true }, at: { type: Date, required: true } },
        { _id: false },
      ),
      default: null,
    },
    additions: {
      type: [new mongoose.Schema({ text: { type: String, required: true, trim: true, maxlength: 2000 }, by: { type: ObjectId, ref: 'User', required: true }, byName: String, at: Date })],
      default: [],
      validate: [(v) => v.length <= 50, 'A visit can have at most 50 additions.'],
    },
    // the same "new visit" sent twice (double click, retry) makes one visit
    clientRequestId: { type: String, required: true, maxlength: 64 },

    vitals: {
      weightKg: num(0.3, 300),
      heightCm: num(20, 250),
      bpSystolic: num(50, 260),
      bpDiastolic: num(30, 160),
      pulse: num(30, 220),
      temperatureF: num(90, 110),
      spo2: num(50, 100),
      hb: num(2, 25),
      urineAlbumin: choice(URINE_GRADES),
      urineSugar: choice(URINE_GRADES),
      ...saved,
    },
    details: {
      complaints: text(1000),
      fundalHeightCm: num(5, 50),
      fetalHeartRate: num(60, 220),
      presentation: choice(PRESENTATIONS),
      fetalMovements: choice(FETAL_MOVEMENTS),
      oedema: choice(OEDEMA_GRADES),
      examination: text(2000),
      diagnosis: text(500),
      investigations: text(1000),
      advice: text(2000),
      privateNote: text(2000),
      nextVisitOn: { type: Date, default: null },
      nextVisitNote: text(200),
      ...saved,
    },
    prescription: {
      items: { type: [rxItemSchema], default: [], validate: [(v) => v.length <= 40, 'A prescription can have at most 40 medicines.'] },
      notes: text(1000),
      // the doctor went ahead despite an Avoid or Allergy warning: the warning and the reason (never printed)
      warningReasons: {
        type: [
          new mongoose.Schema(
            { key: { type: String, required: true }, level: { type: String, enum: ['avoid', 'allergy'], required: true }, title: String, medicines: [String], reason: { type: String, required: true, maxlength: 300 } },
            { _id: false },
          ),
        ],
        default: [],
      },
      ...saved,
    },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);
visitSchema.plugin(hospitalScoped);
visitSchema.index({ hospitalId: 1, patientId: 1, visitOn: -1, createdAt: -1 });
visitSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });
visitSchema.index({ hospitalId: 1, visitOn: 1 });

export const Visit = mongoose.model('Visit', visitSchema, 'visits');

import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { CARE_TYPES } from './Patient.js';
import {
  FETAL_MOVEMENTS,
  OEDEMA_GRADES,
  PRESENTATIONS,
  RX_DURATION_UNITS,
  RX_FORMS,
  RX_FREQUENCIES,
  RX_ROUTES,
  RX_TIMINGS,
  URINE_GRADES,
} from '../visits/rxCodes.js';

// One visit of a patient (Feature 8), in three parts that different people fill in, each saved on its own
// with its own version number (rev), so a nurse saving the vitals never overwrites a doctor writing the
// prescription at the same moment:
//  - vitals: nurses, doctors and RMOs;
//  - details: the doctor's findings, diagnosis, advice, next visit, and a private note (never printed, not
//    shown to nurses);
//  - prescription: the medicines (doctors and RMOs).
// Visits are never deleted: a visit entered by mistake is marked "entered in error" (status 'cancelled').
// Signed and finished: the treating doctor or an RMO signs the visit; from then on nothing in it can be changed –
// a correction or addition is added below it (who, when), and can itself never be changed or removed.
// There is deliberately no fetal-sex field anywhere (PCPNDT Act).

const { ObjectId } = mongoose.Schema.Types;
const num = (min, max) => ({ type: Number, min, max, default: null });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });
const choice = (values) => ({ type: String, enum: values, default: '' });
// Who last saved a part, and its version.
const saved = { rev: { type: Number, default: 0 }, by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, default: null }, at: { type: Date, default: null } };

// One medicine as written (also used by the ready-made prescription sets, models/PrescriptionSet.js).
export const rxItemSchema = new mongoose.Schema({
  drug: { type: String, required: true, trim: true, maxlength: 120 }, // as the doctor wrote it (generic or brand)
  form: { type: String, enum: RX_FORMS, default: 'tab' },
  strength: text(40), // e.g. "5 mg"
  dose: text(40), // e.g. "1", "½", "10 ml"
  frequency: { type: String, enum: RX_FREQUENCIES, required: true },
  frequencyText: text(60), // the doctor's own words for "custom"
  timing: choice(RX_TIMINGS),
  route: choice(RX_ROUTES),
  durationValue: { type: Number, min: 1, max: 365, default: null },
  durationUnit: choice(RX_DURATION_UNITS),
  instructions: text(200),
}); // keeps its own _id: a stable key for the website

const visitSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    visitOn: { type: Date, required: true }, // the hospital's date of the visit (midnight UTC)
    careType: { type: String, enum: CARE_TYPES, required: true }, // the type of care at the time
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelled: {
      type: new mongoose.Schema({ reason: { type: String, required: true, maxlength: 300 }, by: ObjectId, byName: String, at: Date }, { _id: false }),
      default: null,
    },
    signed: {
      type: new mongoose.Schema(
        {
          by: { type: ObjectId, ref: 'User', required: true },
          byName: { type: String, required: true },
          role: { type: String, enum: ['doctor', 'rmo'], required: true },
          at: { type: Date, required: true },
          // The version of each part that was signed (what the signer saw).
          revs: { vitals: Number, details: Number, prescription: Number },
        },
        { _id: false },
      ),
      default: null,
    },
    additions: {
      type: [
        new mongoose.Schema({
          text: { type: String, required: true, trim: true, maxlength: 2000 },
          by: { type: ObjectId, ref: 'User', required: true },
          byName: { type: String, required: true },
          at: { type: Date, required: true },
        }),
      ],
      default: [],
      validate: [(v) => v.length <= 50, 'A visit can have at most 50 additions.'],
    },
    // The same "new visit" sent twice (double click, retry) creates one visit.
    clientRequestId: { type: String, required: true, maxlength: 64 },

    vitals: {
      weightKg: num(0.3, 300),
      bpSystolic: num(50, 260),
      bpDiastolic: num(30, 160),
      pulse: num(30, 220),
      temperatureF: num(90, 110), // °F, as usually recorded in Indian OPDs
      spo2: num(50, 100),
      hb: num(2, 25), // g/dL (point-of-care)
      urineAlbumin: choice(URINE_GRADES),
      urineSugar: choice(URINE_GRADES),
      ...saved,
    },

    details: {
      complaints: text(1000),
      // Pregnancy check (antenatal)
      fundalHeightCm: num(5, 50),
      fetalHeartRate: num(60, 220),
      presentation: choice(PRESENTATIONS),
      fetalMovements: choice(FETAL_MOVEMENTS),
      oedema: choice(OEDEMA_GRADES),
      examination: text(2000),
      diagnosis: text(500),
      investigations: text(1000), // tests advised
      advice: text(2000),
      privateNote: text(2000), // the doctor's own note: never printed, not shown to nurses
      nextVisitOn: { type: Date, default: null },
      nextVisitNote: text(200), // e.g. "with reports"
      ...saved,
    },

    prescription: {
      items: { type: [rxItemSchema], default: [], validate: [(v) => v.length <= 40, 'A prescription can have at most 40 medicines.'] },
      notes: text(1000), // general instructions printed under the medicines
      // The doctor went ahead despite an Avoid or Allergy warning of the medicine safety check: the warning as shown
      // and the doctor's reason (medico-legal record; never printed).
      warningReasons: {
        type: [
          new mongoose.Schema(
            {
              key: { type: String, required: true, maxlength: 200 },
              level: { type: String, enum: ['avoid', 'allergy'], required: true },
              title: { type: String, required: true, maxlength: 300 },
              medicines: { type: [{ type: String, maxlength: 120 }], default: [] },
              reason: { type: String, required: true, trim: true, maxlength: 300 },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      ...saved,
    },

    // The AI check before printing (Smart features): which saved version was checked, how many points it raised, and
    // what the doctor did ('clean': nothing found; 'printed_anyway': printed without changing). Never the AI's text.
    aiCheck: {
      key: { type: String, default: null },
      at: { type: Date, default: null },
      issues: { type: Number, default: 0 },
      decision: { type: String, enum: ['clean', 'pending', 'printed_anyway', null], default: null },
    },

    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);
visitSchema.plugin(tenantScoped);
visitSchema.index({ tenantId: 1, patientId: 1, visitOn: -1, createdAt: -1 });
visitSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
visitSchema.index({ tenantId: 1, 'prescription.by': 1, 'prescription.at': -1 }); // a doctor's recent medicines
visitSchema.index({ tenantId: 1, 'details.nextVisitOn': 1 }); // the calendar's booked visits
visitSchema.index({ tenantId: 1, visitOn: 1 }); // Analytics: a hospital's visits in a date range
visitSchema.index({ tenantId: 1, status: 1, visitOn: 1 }); // Analytics: active, or entered in error, in a date range

export const Visit = mongoose.model('Visit', visitSchema);

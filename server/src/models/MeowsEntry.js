import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { CONTEXTS, FREQUENCIES } from '../clinical/meows.js';

// One set of MEOWS observations on a stay (Clinical Requirements Group B, item 8 – OBG-F-05 v1.0, clinical/meows.js).
// `at` is the clinical time (what was typed); when it was typed is createdAt (PX-X-04 – a late entry is worked out from
// the two, utils/lateEntry.js). The bands, counts, level and escalation are worked out by the server when it is saved
// and kept as they were, with the rules' source (sets saved before OBG-F-05 keep their CEMACH bands, "yellow").
// Escalation tasks (E1, E2) live on the set that raised them, each with its due time and who did it when.
// Never changed or deleted: one written by mistake is marked "entered in error". Follow-up times (antibiotic,
// antihypertensive, pathway chosen) are added once, by whom and when, for the monthly dashboard.

const { ObjectId } = mongoose.Schema.Types;
const BANDS = ['red', 'amber', 'yellow', 'normal', null];
const band = { type: String, enum: BANDS, default: null };
const num = { type: Number, default: null };
export const MEOWS_TASKS = {
  resident_review: { rule: 'E1', label: 'Resident at the bedside', minutes: 30 },
  consultant_bedside: { rule: 'E2', label: 'Consultant at the bedside', minutes: 30 },
  anaesthetist_informed: { rule: 'E2', label: 'Anaesthetist informed', minutes: 30 },
};
export const PATHWAYS = {
  sepsis: { label: 'Sepsis six', code: 'OBG-ALG-07' },
  pph: { label: 'PPH', code: 'OBG-ALG-01' },
  severe_htn: { label: 'Severe hypertension', code: 'OBG-ALG-02' },
};
const taskSchema = new mongoose.Schema(
  {
    key: { type: String, enum: Object.keys(MEOWS_TASKS), required: true },
    rule: { type: String, enum: ['E1', 'E2'], required: true },
    dueAt: { type: Date, required: true },
    doneAt: { type: Date, default: null },
    by: { type: ObjectId, default: null },
    byName: { type: String, default: null },
  },
  { _id: false },
);
const signed = { type: new mongoose.Schema({ at: Date, by: ObjectId, byName: String, recordedAt: Date }, { _id: false }), default: null };
const entrySchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    at: { type: Date, required: true }, // the clinical time
    values: {
      rr: num,
      spo2: num,
      tempC: num,
      sbp: num,
      dbp: num,
      hr: num,
      avpu: { type: String, enum: ['A', 'V', 'P', 'U', null], default: null },
      urine4h: num,
      confusion: { type: Boolean, default: null },
      pain: num,
      lochia: { type: String, enum: ['normal', 'heavy', 'offensive', 'heavy_and_offensive', 'na', null], default: null },
      fundus: { type: String, enum: ['firm', 'soft', 'rising', 'na', null], default: null },
      wound: { type: String, enum: ['normal', 'concern', 'na', null], default: null },
      nurseConcern: { type: Boolean, default: null },
    },
    bands: Object.fromEntries(['rr', 'spo2', 'tempC', 'sbp', 'dbp', 'hr', 'avpu', 'urine4h', 'pain', 'lochia', 'fundus', 'nurseConcern'].map((k) => [k, band])),
    reds: num,
    ambers: num,
    level: { type: String, enum: ['trigger', 'watch', 'normal'], required: true },
    shockIndex: num,
    hypertensiveEmergency: { type: Boolean, default: false },
    escalation: { type: [{ type: String, enum: ['E1', 'E2', 'E3'] }], default: [] },
    e2Reason: { type: String, enum: ['two_red', 'no_improvement', null], default: null },
    tasks: { type: [taskSchema], default: [] },
    actionTaken: { type: String, maxlength: 1000, default: '' },
    doctorInformedAt: { type: Date, default: null },
    escalatedTo: { type: String, maxlength: 150, default: '' },
    note: { type: String, maxlength: 1000, default: '' },
    // Follow-up for the monthly dashboard (OBG-A-05): the pathway chosen, the first antibiotic, the antihypertensive
    pathway: { type: new mongoose.Schema({ key: { type: String, enum: Object.keys(PATHWAYS) }, at: Date, by: ObjectId, byName: String }, { _id: false }), default: null },
    antibioticAt: signed,
    antihypertensiveAt: signed,
    source: { type: String, required: true },
    by: { type: ObjectId, ref: 'User', required: true }, // recorded by
    byName: { type: String, required: true },
    cancelled: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
entrySchema.plugin(tenantScoped);
entrySchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
entrySchema.index({ tenantId: 1, admissionId: 1, at: -1 });
entrySchema.index({ tenantId: 1, at: -1 });

export const MeowsEntry = mongoose.model('MeowsEntry', entrySchema);

// The chart's header for one stay (OBG-F-05): the context, the diagnosis or procedure, how often the doctor ordered
// the observations, and two facts copied from other forms when they exist – the blood loss at delivery (the signed
// delivery note, OBG-F-08) and whether LMWH is prescribed (the VTE score, OBG-F-10) – which the doctor can correct.
const chartSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    context: { type: String, enum: Object.keys(CONTEXTS), required: true },
    contextDetail: { type: String, maxlength: 150, default: '' },
    diagnosis: { type: String, maxlength: 300, default: '' },
    frequencyMinutes: { type: Number, enum: FREQUENCIES, required: true },
    bloodLossMl: num,
    bloodLossFrom: { type: String, enum: ['delivery_note', 'typed', null], default: null },
    lmwhPrescribed: { type: Boolean, default: false },
    startedAt: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
  },
  { timestamps: true },
);
chartSchema.plugin(tenantScoped);
chartSchema.index({ tenantId: 1, admissionId: 1 }, { unique: true });

export const MeowsChartHeader = mongoose.model('MeowsChartHeader', chartSchema);

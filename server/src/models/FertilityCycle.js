import mongoose from 'mongoose';
import { CANCEL_REASONS, CLINICAL_RESULTS, CYCLE_STATUSES, ENDOMETRIUM_PATTERNS, MAX_ENTRIES, MAX_FOLLICLES, PROTOCOL_KINDS, TEST_RESULTS, TIMING_KINDS } from '../fertility/cycleFields.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One treatment cycle (a follicular study) under a fertility treatment plan (docs/FERTILITY_PLAN.md section 7): day 1,
// the medicines of the cycle, the scan days with each ovary's follicles and the endometrium, the trigger, timed
// intercourse or IUI, luteal support, a cancellation with its reason, and the outcome. The state is worked out from
// what is filled in (cycleFields.js statusOf). A completed cycle is added once to the record's cycle counter
// (`counted`), so the treatment-plan suggestions count it. Staff ids leave only as names.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stamp = () => ({ type: new mongoose.Schema(byFields, { _id: false }), default: null });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });
const num = (min, max) => ({ type: Number, min, max, default: null });
const choice = (keys) => ({ type: String, enum: [...keys, ''], default: '' });

const entrySchema = new mongoose.Schema(
  {
    on: { type: Date, required: true }, // the day of the scan (midnight UTC)
    right: { type: [Number], default: [], validate: [(v) => v.length <= MAX_FOLLICLES, 'Too many follicles'] }, // mm
    left: { type: [Number], default: [], validate: [(v) => v.length <= MAX_FOLLICLES, 'Too many follicles'] },
    endometriumMm: num(0, 40),
    pattern: choice(ENDOMETRIUM_PATTERNS),
    e2: num(0, 20000),
    lh: num(0, 500),
    p4: num(0, 500),
    given: text(200), // the medicine given or advised that day
    note: text(300),
    ...byFields,
  },
  { _id: false },
);

const fertilityCycleSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    planId: { type: ObjectId, ref: 'FertilityPlan', required: true },
    number: { type: Number, required: true, min: 1 }, // her cycles, counted across plans
    step: { type: String, default: null }, // the plan's ladder step when the cycle started
    day1: { type: Date, required: true }, // the first day of the period (midnight UTC)
    protocol: {
      kind: choice(PROTOCOL_KINDS),
      drug: text(120),
      dose: text(120),
      days: text(60), // e.g. "day 3 to 7"
    },
    entries: { type: [entrySchema], default: [], validate: [(v) => v.length <= MAX_ENTRIES, 'Too many scan days'] },
    trigger: { drug: text(120), dose: text(60), at: { type: Date, default: null } },
    timing: { kind: choice(TIMING_KINDS), on: { type: Date, default: null }, postWashMillions: num(0, 500), note: text(300) },
    luteal: text(200),
    cancelled: { type: new mongoose.Schema({ reason: { type: String, enum: CANCEL_REASONS }, note: text(300), ...byFields }, { _id: false }), default: null },
    outcome: {
      test: choice(TEST_RESULTS),
      testOn: { type: Date, default: null },
      betaHcg: num(0, 500000),
      betaHcgOn: { type: Date, default: null },
      clinical: choice(CLINICAL_RESULTS),
      scanOn: { type: Date, default: null },
      note: text(300),
    },
    status: { type: String, enum: CYCLE_STATUSES, default: 'monitoring' },
    counted: { type: Boolean, default: false },
    created: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    lastEdited: stamp(),
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
fertilityCycleSchema.plugin(tenantScoped);
fertilityCycleSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
fertilityCycleSchema.index({ tenantId: 1, planId: 1 });
fertilityCycleSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const FertilityCycle = mongoose.model('FertilityCycle', fertilityCycleSchema);

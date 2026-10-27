import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A fertility treatment plan (docs/FERTILITY_PLAN.md): built from one or more protocols of
// fertility/protocols.js that the doctor chose from the suggestions, then edited as free text per section.
//   draft → active (a doctor confirmed it) → completed (pregnant, or moved to the next step as planned)
//   draft or active → stopped (no response, the couple's choice, discarded, other)
// One plan at a time per patient (draft or active); the earlier ones stay as her history. Every save keeps the
// previous text in `versions` (the last 30), so nothing a doctor wrote is lost. Staff ids leave only as names.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stamp = () => ({ type: new mongoose.Schema(byFields, { _id: false }), default: null });

export const PLAN_STATUSES = ['draft', 'active', 'completed', 'stopped'];
export const OUTCOME_KINDS = ['pregnant', 'next_step', 'no_response', 'patient_choice', 'discarded', 'other'];
// Which outcomes end a plan as completed, and which as stopped
export const COMPLETED_KINDS = ['pregnant', 'next_step'];
export const STOPPED_KINDS = ['no_response', 'patient_choice', 'discarded', 'other'];
export const MAX_SECTION_TEXT = 8000;
export const MAX_VERSIONS = 30;

const sectionSchema = new mongoose.Schema(
  { key: { type: String, required: true, maxlength: 40 }, title: { type: String, required: true, maxlength: 100 }, text: { type: String, default: '', maxlength: MAX_SECTION_TEXT } },
  { _id: false },
);
const versionSchema = new mongoose.Schema(
  { at: Date, byName: String, title: String, startOn: Date, reviewOn: Date, sections: { type: [sectionSchema], default: [] } },
  { _id: false },
);

const fertilityPlanSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    status: { type: String, enum: PLAN_STATUSES, default: 'draft' },
    protocolKeys: { type: [String], default: [] },
    libraryVersion: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    startOn: { type: Date, default: null }, // the day the plan starts (midnight UTC)
    reviewOn: { type: Date, default: null }, // the agreed review date
    sections: { type: [sectionSchema], default: [] },
    sources: { type: [new mongoose.Schema({ key: String, label: String, bodies: String }, { _id: false })], default: [] },
    // The plan this one was switched from (the ladder: follicular study → IUI → IVF, or a procedure), when it was
    switchedFrom: { type: new mongoose.Schema({ planId: { type: ObjectId, ref: 'FertilityPlan' }, title: String, at: Date }, { _id: false }), default: null },
    // What the rules suggested when the plan was built (keys and fit only), so the choice can be read later
    suggested: { type: [new mongoose.Schema({ key: String, fit: String }, { _id: false })], default: [] },
    outcome: { type: new mongoose.Schema({ kind: { type: String, enum: OUTCOME_KINDS }, note: { type: String, default: '', maxlength: 500 }, ...byFields }, { _id: false }), default: null },
    created: { type: new mongoose.Schema(byFields, { _id: false }), required: true },
    activated: stamp(),
    lastEdited: stamp(),
    versions: { type: [versionSchema], default: [] },
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
fertilityPlanSchema.plugin(tenantScoped);
fertilityPlanSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
fertilityPlanSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const FertilityPlan = mongoose.model('FertilityPlan', fertilityPlanSchema);

import mongoose from 'mongoose';
import { AVOIDABLE, CAUSES, CORRECTABLE, DELAY_ANSWERS, NEAR_MISS_KEYS, REVIEW_KINDS } from '../clinical/caseReview.js';
import { tenantScoped } from '../utils/tenantScope.js';

// A maternal death or near-miss review (Clinical Requirements Group C – PX-OBG-30; DRAFT lists, clinical/caseReview.js)
// with corrections and sealing (PX-X-05): a draft is changed freely by the review team; a doctor signs it and it is
// SEALED – never changed again. A mistake found later is a correction added on top (which part, what it should say,
// why, who, when); the sealed text stays as it was signed. Confidential: kept out of the patient's record.

const { ObjectId } = mongoose.Schema.Types;
const stamp = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const delay = new mongoose.Schema({ answer: { type: String, enum: [...Object.keys(DELAY_ANSWERS), ''], default: '' }, note: { type: String, maxlength: 500, default: '' } }, { _id: false });

const reviewSchema = new mongoose.Schema(
  {
    serial: { type: Number, required: true },
    kind: { type: String, enum: Object.keys(REVIEW_KINDS), required: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    eventAt: { type: Date, required: true },
    summary: { type: String, maxlength: 3000, default: '' },
    criteria: { type: [{ type: String, enum: NEAR_MISS_KEYS }], default: [] },
    cause: { type: String, enum: [...Object.keys(CAUSES), ''], default: '' },
    causeDetail: { type: String, maxlength: 500, default: '' },
    delays: { delay1: { type: delay, default: () => ({}) }, delay2: { type: delay, default: () => ({}) }, delay3: { type: delay, default: () => ({}) } },
    avoidable: { type: String, enum: [...Object.keys(AVOIDABLE), ''], default: '' },
    factors: { type: String, maxlength: 2000, default: '' },
    lessons: { type: String, maxlength: 2000, default: '' },
    actions: { type: [new mongoose.Schema({ text: { type: String, maxlength: 300 }, owner: { type: String, maxlength: 150 }, dueOn: { type: String, maxlength: 10 } }, { _id: false })], default: [] },
    meetingOn: { type: String, maxlength: 10, default: '' },
    members: { type: String, maxlength: 500, default: '' },
    status: { type: String, enum: ['draft', 'sealed'], default: 'draft' },
    started: stamp,
    lastSaved: stamp,
    sealed: { type: new mongoose.Schema(stamp, { _id: false }), default: null },
    corrections: {
      type: [new mongoose.Schema({ part: { type: String, enum: Object.keys(CORRECTABLE) }, should: { type: String, maxlength: 1000 }, reason: { type: String, maxlength: 300 }, ...stamp })],
      default: [],
    },
  },
  { timestamps: true },
);
// Sealing, enforced here as well as in the route: once sealed (as loaded), only corrections may be added.
reviewSchema.post('init', function remember() {
  this.$locals.wasSealed = this.status === 'sealed';
});
reviewSchema.pre('save', function guard() {
  if (!this.$locals.wasSealed) return;
  const changed = this.modifiedPaths({ includeChildren: false }).filter((p) => !p.startsWith('corrections') && p !== 'updatedAt');
  if (changed.length) throw new Error(`A sealed review cannot be changed (${changed.join(', ')}) – add a correction.`);
});
reviewSchema.plugin(tenantScoped);
reviewSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
reviewSchema.index({ tenantId: 1, patientId: 1 });

export const CaseReview = mongoose.model('CaseReview', reviewSchema);

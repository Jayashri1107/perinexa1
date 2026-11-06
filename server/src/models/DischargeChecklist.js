import mongoose from 'mongoose';
import { DISCHARGE_ITEMS, TEACH_BACK_BY, TEACHING_LANGUAGES } from '../clinical/postnatalDischarge.js';
import { tenantScoped } from '../utils/tenantScope.js';

// The postnatal discharge checklist of a stay (Clinical Requirements Group B, item 14 – DRAFT,
// clinical/postnatalDischarge.js): the checks answered, the danger signs explained, the teach-back, the next visit.
// Saved as a draft by whoever fills it; marked complete once nothing is missing – then locked (who, when). One per
// stay; one filled in by mistake is marked "entered in error" with a reason and a new one can be started.

const { ObjectId } = mongoose.Schema.Types;
const checklistSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    items: Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, { type: String, enum: ['', 'yes', 'no', 'na'], default: '' }])),
    itemNotes: { type: String, maxlength: 1000, default: '' },
    dangerSigns: { type: [String], default: [] },
    teachBack: {
      done: { type: Boolean, default: false },
      by: { type: String, enum: ['', ...Object.keys(TEACH_BACK_BY)], default: '' },
      language: { type: String, enum: ['', ...Object.keys(TEACHING_LANGUAGES)], default: '' },
      note: { type: String, maxlength: 500, default: '' },
    },
    followUpOn: { type: Date, default: null },
    status: { type: String, enum: ['draft', 'complete'], default: 'draft' },
    rev: { type: Number, default: 0 },
    savedByName: { type: String, default: null },
    savedAt: { type: Date, default: null },
    completed: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    source: { type: String, required: true },
    live: { type: Boolean, default: true }, // false once marked entered in error (for the one-per-stay index)
    cancelled: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
  },
  { timestamps: true, minimize: false },
);
checklistSchema.plugin(tenantScoped);
// One live checklist per stay (one marked entered in error does not count)
checklistSchema.index({ tenantId: 1, admissionId: 1 }, { unique: true, partialFilterExpression: { live: true } });

export const DischargeChecklist = mongoose.model('DischargeChecklist', checklistSchema);

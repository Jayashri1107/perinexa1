// A patient's care plan (as in Perinexa's models/CarePlan.js): the items of an APPROVED template – visits, tests, scans,
// vaccinations, medicines and advice – with their timing, and what staff recorded on each. One current plan per
// patient; closed plans stay as earlier, read-only plans. The risk level (antenatal) is kept with the plan, worked
// out from the approved risk rules each time the plan is read, with the doctor's override and reason.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;
const actor = { byName: { type: String, required: true }, by: { type: ObjectId, ref: 'User' }, at: { type: Date, required: true } };
const nested = (def) => ({ type: new mongoose.Schema(def, { _id: false }), default: null });

export const ITEM_KINDS = ['visit', 'investigation', 'scan', 'vaccination', 'medication', 'advice'];
export const NOT_NEEDED_REASONS = ['not_indicated', 'declined', 'covered', 'window_passed', 'unavailable', 'other'];
export const CLOSE_REASONS = ['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere', 'other'];

const itemSchema = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 80 },
  origin: { type: String, enum: ['template', 'custom'], default: 'template' },
  kind: { type: String, enum: ITEM_KINDS, required: true },
  name: { type: String, required: true, maxlength: 200 },
  patientText: { type: String, maxlength: 300, default: '' },
  source: { type: String, maxlength: 1000, default: '' },
  appliesWhen: { type: String, maxlength: 60, default: '' },
  atBooking: { type: Boolean, default: false },
  fromWeek: { type: Number, default: null },
  toWeek: { type: Number, default: null },
  after: nested({ key: String, weeks: Number }),
  date: { type: Date, default: null }, // an item the doctor added: its date
  state: { type: String, enum: ['open', 'done', 'not_needed'], default: 'open' },
  done: nested({ on: { type: Date, required: true }, note: { type: String, maxlength: 500, default: '' }, ...actor }),
  notNeeded: nested({ reason: { type: String, enum: NOT_NEEDED_REASONS, required: true }, note: { type: String, maxlength: 300, default: '' }, ...actor }),
  forceInclude: nested({ reason: { type: String, required: true, maxlength: 300 }, ...actor }), // "only when" judged to apply
  remindedAt: { type: Date, default: null }, // a check-up reminder was sent for this item (Calendar → Check-ups due)
});

const carePlanSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    careType: { type: String, required: true },
    template: { key: String, name: String, version: Number },
    bookedOn: { type: Date, required: true }, // the day the plan was started (booking)
    startOn: { type: Date, default: null }, // week 0 chosen by the doctor (care other than pregnancy and newborn)
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    closed: nested({ reason: { type: String, enum: CLOSE_REASONS }, note: String, ...actor }),
    items: { type: [itemSchema], default: [] },
    riskOverride: nested({ level: { type: String, enum: ['high', 'moderate', 'low'], required: true }, reason: { type: String, required: true, maxlength: 300 }, ...actor }),
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);
carePlanSchema.plugin(hospitalScoped);
carePlanSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
carePlanSchema.index({ hospitalId: 1, status: 1 });
carePlanSchema.index({ hospitalId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_current_plan' });

export const CarePlan = mongoose.model('CarePlan', carePlanSchema, 'care_plans');

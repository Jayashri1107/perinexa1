import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { APPLIES_WHEN, ITEM_KINDS, TEMPLATE_CARE_TYPES } from './CarePlanTemplate.js';

// A patient's care plan: the template's visits, tests, scans, vaccinations, medicines and advice, with due
// dates worked out from the EDD, plus everything staff recorded on each item. One CURRENT plan per patient
// and type of care (V1 builds antenatal plans only); closed plans stay as earlier, read-only plans.
//
// Who writes what:
//  - item content, origin, notInTemplate, possibleDuplicate, addedOn, source: plan creation, template merge, custom add
//    ("Keep as planned" clears possibleDuplicate);
//  - state, done, notNeeded, manualDate, forceInclude, note, staffBasis, added, history, bookedOn, closed:
//    ONLY actions by people (never the automatic sync);
//  - auto.* and basis.syncedAt: ONLY the plan engine (careplans/planEngine.js derivePlan).
// There is deliberately no fetal-sex field anywhere (PCPNDT Act).

const { ObjectId, Mixed } = mongoose.Schema.Types;
const nested = (def) => ({ type: new mongoose.Schema(def, { _id: false }), default: null });
const actor = { by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, required: true, maxlength: 150 }, at: { type: Date, required: true } };

export const PLAN_STATUSES = ['active', 'paused', 'closed'];
export const CLOSE_REASONS = ['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere', 'new_pregnancy', 'other'];
export const USER_CLOSE_REASONS = CLOSE_REASONS.filter((r) => r !== 'new_pregnancy'); // new pregnancy goes through the EDD decision
export const NOT_NEEDED_REASONS = ['not_indicated', 'declined', 'covered', 'window_passed', 'unavailable', 'other'];
export const PHASES = ['open', 'waiting', 'check', 'decide', 'lapsed', 'on_hold', 'not_applicable', 'done', 'not_needed', 'inactive'];
export const FLAGS = ['check_date', 'outside_window', 'no_longer_indicated', 'possible_duplicate'];

const historyEntry = new mongoose.Schema({
  at: { type: Date, required: true }, by: { type: ObjectId, default: null }, byName: { type: String, required: true },
  action: { type: String, required: true, maxlength: 40 }, from: Mixed, to: Mixed, reason: { type: String, maxlength: 300, default: '' },
}, { _id: false });

const logEntry = new mongoose.Schema({
  at: { type: Date, required: true }, by: { type: ObjectId, default: null }, byName: { type: String, required: true },
  action: { type: String, required: true, maxlength: 40 }, text: { type: String, maxlength: 300, default: '' }, auto: { type: Boolean, default: false },
}, { _id: false });

const itemSchema = new mongoose.Schema({            // keeps its own _id = the stable item id for the API and audit
  key: { type: String, required: true, maxlength: 80 },          // template key; custom: 'custom_' + 8 hex
  origin: { type: String, enum: ['template', 'custom'], required: true },
  rev: { type: Number, default: 0 },
  revByName: { type: String, default: null },                    // who or what last raised rev ('Automatic' for sync)
  revAt: { type: Date, default: null },
  clientRequestId: { type: String, maxlength: 64, default: null },
  // content: copied from the template, or the doctor's custom item
  kind: { type: String, enum: ITEM_KINDS, required: true },
  name: { type: String, required: true, maxlength: 200 },
  patientText: { type: String, maxlength: 300, default: '' },
  source: { type: String, maxlength: 400, default: '' },
  appliesWhen: { type: String, enum: APPLIES_WHEN, default: 'always' },
  timing: {
    atBooking: { type: Boolean, default: false },
    fromWeek: { type: Number, min: 0, max: 900, default: null },
    toWeek: { type: Number, min: 0, max: 900, default: null },
    after: { key: { type: String, maxlength: 80, default: null }, weeks: { type: Number, min: 1, max: 520, default: null } },
    date: { type: Date, default: null },     // custom, fixed dates
    dateBy: { type: Date, default: null },
  },
  addedOn: { type: Date, default: null },     // hospital date the item joined an existing plan (merge/switch/custom); null = built with the plan
  notInTemplate: nested({ since: Date, templateName: String, version: Number }),
  // Added by a template change while the plan already had an item that may be the same (same kind, overlapping dates
  // or the same name): which one, for the "May repeat …" flag. null = none (also on plans saved before 5 Oct 2026).
  possibleDuplicate: nested({ withItemId: String, withName: { type: String, maxlength: 200 }, at: Date }),
  // staff-owned: ONLY explicit actions by a person write these
  state: { type: String, enum: ['open', 'done', 'not_needed'], default: 'open' },
  done: nested({ on: { type: Date, required: true }, elsewhere: { type: Boolean, default: false }, result: { type: String, maxlength: 500, default: '' },
    note: { type: String, maxlength: 1000, default: '' }, via: { type: String, enum: ['manual', 'visit', 'lab'], default: 'manual' }, visitId: { type: ObjectId, default: null }, labOrderId: { type: ObjectId, default: null }, ...actor }),
  notNeeded: nested({ reasonCode: { type: String, enum: NOT_NEEDED_REASONS, required: true }, reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  manualDate: nested({ dueFrom: { type: Date, required: true }, dueBy: { type: Date, required: true }, reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  forceInclude: nested({ reason: { type: String, required: true, minlength: 5, maxlength: 300 }, ...actor }),
  note: nested({ text: { type: String, required: true, maxlength: 1000 }, ...actor }),
  staffBasis: nested({ edd: Date, bookedOn: Date, timingKey: String, applies: { type: String, enum: ['yes', 'no', 'unknown'] }, at: Date }),
  added: nested({ reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  history: { type: [historyEntry], default: [] },
  // engine-owned: ONLY derivePlan writes these (all date-independent)
  auto: {
    applies: { type: String, enum: ['yes', 'no', 'unknown'], default: 'yes' },
    why: { type: String, default: null },
    riskBased: { type: Boolean, default: false },                // applicability depends on high_risk (own or inherited)
    windowFrom: { type: Date, default: null }, windowTo: { type: Date, default: null },
    dueFrom: { type: Date, default: null }, dueBy: { type: Date, default: null },
    dateSource: { type: String, enum: ['window', 'booking', 'after_done', 'catch_up', 'manual', 'fixed', null], default: null },
    lateStart: { type: String, enum: ['lapsed', 'covered', 'decide', 'catch_up', null], default: null },
    // What the window had ended before: the booking, the day the item was added, or the day the finding of this
    // pregnancy that makes it apply was ticked.
    lateFrom: { type: String, enum: ['booking', 'added', 'finding', null], default: null },
    anchor: nested({ state: { type: String, enum: ['waiting', 'not_needed', 'missing', 'loop'] }, key: String }),
    flags: { type: [{ type: String, enum: FLAGS }], default: [] },
    phase: { type: String, enum: PHASES, default: 'open' },
    listable: { type: Boolean, default: false },
  },
});

const planSchema = new mongoose.Schema({
  patientId: { type: ObjectId, ref: 'Patient', required: true },
  careType: { type: String, enum: TEMPLATE_CARE_TYPES, required: true },   // V1 builds 'antenatal' only
  current: { type: Boolean, default: true },                               // false once closed
  status: { type: String, enum: PLAN_STATUSES, default: 'active' },
  pausedReason: { type: String, enum: ['care_type_changed', 'no_edd', null], default: null },
  closed: nested({ reason: { type: String, enum: CLOSE_REASONS, required: true }, note: { type: String, maxlength: 500, default: '' }, auto: { type: Boolean, default: false }, ...actor }),
  replacesPlanId: { type: ObjectId, default: null },
  source: {
    templateId: { type: ObjectId, ref: 'CarePlanTemplate', required: true },
    templateName: { type: String, required: true },
    templateKind: { type: String, enum: ['standard', 'personal'], required: true },
    ownerName: { type: String, default: null },
    version: { type: Number, required: true },
    itemsHash: { type: String, required: true },
    chosenBy: nested({ ...actor }),                                          // null = automatic (standard)
  },
  basis: {                                                                   // medical facts: never sent to the browser or audited
    // edd: antenatal – the EDD in use; other types – week 0 (delivery, birth or start, startOn) + 280 days, so the
    // engine's weeks count from startOn (eddSource 'start').
    key: { type: String, required: true }, edd: { type: Date, required: true }, eddSource: { type: String, enum: ['scan', 'lmp', 'start'], required: true },
    startOn: { type: Date, default: null },
    patientVersion: { type: Number, required: true }, engineVersion: { type: Number, required: true }, syncedAt: { type: Date, required: true },
  },
  eddReview: nested({ fromEdd: Date, toEdd: Date, detectedAt: Date }),      // EDD moved > 56 d: plan on hold
  bookedOn: { type: Date, required: true },
  bookedOnSetBy: nested({ ...actor }),                                       // null = automatic default
  items: { type: [itemSchema], default: [], validate: [(v) => v.length <= 400, 'A care plan can have at most 400 items.'] },
  log: { type: [logEntry], default: [] },
  createdBy: { by: { type: ObjectId, default: null }, byName: { type: String, required: true } },   // 'Automatic'
}, { timestamps: true, optimisticConcurrency: true });
planSchema.plugin(tenantScoped);
// At most one current plan per patient and type of care (two requests building a plan at once: one wins).
planSchema.index({ tenantId: 1, patientId: 1, careType: 1 }, { unique: true, partialFilterExpression: { current: true } });
planSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
export const CarePlan = mongoose.model('CarePlan', planSchema);

import mongoose from 'mongoose';
import { ANAESTHESIA, CASE_STATUS, URGENCY } from '../clinical/whoChecklist.js';
import { tenantScoped } from '../utils/tenantScope.js';

// One operation on the theatre list, with its WHO Surgical Safety Checklist (Clinical Requirements Group B, item 16 –
// clinical/whoChecklist.js). The list is per day and theatre, in order. Each phase of the checklist (sign in, time out,
// sign out) is confirmed once by a member of the team (who, when) and then locked; confirming sign in puts the case
// "in theatre", sign out makes it "done". Never deleted: a case taken off the list is cancelled with a reason.

const { ObjectId } = mongoose.Schema.Types;
const phaseSchema = new mongoose.Schema(
  {
    answers: { type: mongoose.Schema.Types.Mixed, default: {} }, // { itemKey: 'yes' | 'no' | 'na' }
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
    confirmed: { type: new mongoose.Schema({ by: ObjectId, byName: String, role: String, at: Date }, { _id: false }), default: null },
    // Sign out: the second person who checked the counts (Group C, PX-X-06)
    witness: { type: new mongoose.Schema({ by: ObjectId, byName: String, role: String, at: Date }, { _id: false }), default: null },
  },
  { _id: false, minimize: false },
);
const caseSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', default: null },
    listDate: { type: Date, required: true }, // the day (midnight UTC of the hospital's date)
    theatre: { type: String, trim: true, maxlength: 40, default: 'Theatre 1' },
    order: { type: Number, default: 1 },
    procedure: { type: String, required: true, trim: true, maxlength: 300 },
    site: { type: String, trim: true, maxlength: 100, default: '' },
    urgency: { type: String, enum: Object.keys(URGENCY), default: 'elective' },
    surgeon: { type: String, trim: true, maxlength: 150, default: '' },
    assistant: { type: String, trim: true, maxlength: 150, default: '' },
    anaesthetist: { type: String, trim: true, maxlength: 150, default: '' },
    anaesthesia: { type: String, enum: ['', ...Object.keys(ANAESTHESIA)], default: '' },
    status: { type: String, enum: Object.keys(CASE_STATUS), default: 'planned' },
    checklist: {
      signIn: { type: phaseSchema, default: () => ({}) },
      timeOut: { type: phaseSchema, default: () => ({}) },
      signOut: { type: phaseSchema, default: () => ({}) },
    },
    createdByName: { type: String, required: true },
    cancelled: { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
caseSchema.plugin(tenantScoped);
caseSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
caseSchema.index({ tenantId: 1, listDate: 1, theatre: 1, order: 1 });
caseSchema.index({ tenantId: 1, patientId: 1, listDate: -1 });

export const TheatreCase = mongoose.model('TheatreCase', caseSchema);

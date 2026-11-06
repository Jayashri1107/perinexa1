import mongoose from 'mongoose';
import { ASA, COMORBIDITIES, FITNESS, MALLAMPATI, NAUSEA, PLANNED_ANAESTHESIA, POSS } from '../clinical/anaesthesia.js';
import { tenantScoped } from '../utils/tenantScope.js';

// The pre-anaesthesia check-up (PAC) and the pain chart (Clinical Requirements Group B, items 9 and 10 – DRAFT,
// clinical/anaesthesia.js). A PAC is written and signed in one go by a doctor or an RMO (who, role, when); a pain entry
// belongs to a stay. Both are never changed or deleted: one written by mistake is marked "entered in error".

const { ObjectId } = mongoose.Schema.Types;
const cancel = { type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }), default: null };
const keys = (o) => Object.keys(o).map(String);

const pacSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    assessedAt: { type: Date, required: true },
    procedure: { type: String, maxlength: 300, default: '' },
    asa: { type: String, enum: keys(ASA), required: true },
    emergency: { type: Boolean, default: false }, // the "E" of the ASA grade
    weightKg: { type: Number, default: null },
    airwayMallampati: { type: String, enum: keys(MALLAMPATI), required: true },
    mouthOpeningOk: { type: Boolean, default: true },
    neckMovementOk: { type: Boolean, default: true },
    comorbidities: { type: [{ type: String, enum: Object.keys(COMORBIDITIES) }], default: [] },
    comorbidityNote: { type: String, maxlength: 500, default: '' },
    medicines: { type: String, maxlength: 1000, default: '' },
    allergies: { type: String, maxlength: 500, default: '' },
    previousAnaesthesia: { type: String, maxlength: 500, default: '' },
    lastSolidAt: { type: Date, default: null },
    lastClearAt: { type: Date, default: null },
    investigations: { type: String, maxlength: 1000, default: '' },
    plannedAnaesthesia: { type: String, enum: Object.keys(PLANNED_ANAESTHESIA), required: true },
    risksExplained: { type: Boolean, required: true },
    fitness: { type: String, enum: Object.keys(FITNESS), required: true },
    fitnessNote: { type: String, maxlength: 1000, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    role: { type: String, required: true },
    source: { type: String, required: true },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
pacSchema.plugin(tenantScoped);
pacSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
pacSchema.index({ tenantId: 1, patientId: 1, assessedAt: -1 });
export const PacAssessment = mongoose.model('PacAssessment', pacSchema);

const painSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    at: { type: Date, required: true },
    score: { type: Number, min: 0, max: 10, required: true },
    poss: { type: String, enum: ['', ...keys(POSS)], default: '' },
    nausea: { type: String, enum: ['', ...Object.keys(NAUSEA)], default: '' },
    action: { type: String, maxlength: 300, default: '' },
    escalatedTo: { type: String, maxlength: 150, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
painSchema.plugin(tenantScoped);
painSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
painSchema.index({ tenantId: 1, admissionId: 1, at: -1 });
export const PainEntry = mongoose.model('PainEntry', painSchema);

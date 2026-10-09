// Inpatients (as in Perinexa's Admission, ClinicalDocument and NursingEntry models):
//  - a stay: admitted on a date, in a ward and bed, for a reason; discharged when a doctor signs the discharge card.
//    One current stay per patient. Never deleted.
//  - its documents: admission note, round notes, delivery note, operation note, discharge card – written as a draft,
//    then signed (admission and round notes by a doctor or RMO; the others by a doctor). Signed: locked; corrections
//    are added below. One written by mistake is marked "entered in error".
//  - its nursing chart: vital signs, a medicine given, or a note, with who and when. Never changed; an entry made by
//    mistake is marked "entered in error" with a reason. Since 9 Oct 2026 also the nurse's work on the doctor's orders
//    (wardCare/careOrder.model.js): a dose given or not, an IV fluid started / paused / completed, a care task done or
//    not; intake and output; and the shift handover.
// PC-PNDT: no fetal sex anywhere – a baby's sex is written only in the delivery note, after the birth.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;
const cancelledSchema = new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false });

export const DOC_KINDS = ['admission', 'round', 'delivery', 'operation', 'discharge'];
// Who signs each kind of document.
export const SIGNED_BY = { admission: ['doctor', 'rmo'], round: ['doctor', 'rmo'], delivery: ['doctor'], operation: ['doctor'], discharge: ['doctor'] };
export const NURSING_KINDS = ['vitals', 'medicine', 'note', 'dose', 'iv', 'task', 'io', 'handover'];
// A dose of a medicine order: given (on time or late), or not given and why. A care task: done or not done.
export const DOSE_OUTCOMES = ['given', 'late', 'refused', 'withheld', 'missed'];
export const TASK_OUTCOMES = ['done', 'not_done'];
// An IV fluid order: started, paused, resumed, completed (finished or stopped), or the site checked.
export const IV_ACTIONS = ['started', 'paused', 'resumed', 'completed', 'site_check'];

const admissionSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    // ADM-000001 … (stays admitted before 7 Oct 2026 have none)
    admissionNumber: { type: String, default: '' },
    careType: { type: String, required: true },
    admittedAt: { type: Date, required: true },
    wardId: { type: ObjectId, ref: 'Ward', default: null }, // the ward (Hospital admin → Wards and beds); stays before 8 Oct 2026 have none
    ward: { type: String, trim: true, maxlength: 100, default: '' }, // its name (and floor) when admitted
    bed: { type: String, trim: true, maxlength: 30, default: '' },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    doctorId: { type: ObjectId, ref: 'User', default: null }, // her doctor when admitted
    status: { type: String, enum: ['admitted', 'discharged'], default: 'admitted' },
    dischargedAt: { type: Date, default: null },
    admittedBy: { type: ObjectId, ref: 'User', required: true },
    admittedByName: { type: String, required: true },
    dischargedByName: { type: String, default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
admissionSchema.plugin(hospitalScoped);
admissionSchema.index({ hospitalId: 1, patientId: 1, admittedAt: -1 });
admissionSchema.index({ hospitalId: 1, status: 1 });
// One patient per bed: two stays in hospital now can never have the same ward and bed.
admissionSchema.index({ hospitalId: 1, wardId: 1, bed: 1 }, { unique: true, partialFilterExpression: { status: 'admitted', wardId: { $type: 'objectId' } }, name: 'one_patient_per_bed' });
admissionSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });
admissionSchema.index({ hospitalId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'admitted' }, name: 'one_current_stay' });
export const Admission = mongoose.model('Admission', admissionSchema, 'admissions');

const documentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    kind: { type: String, enum: DOC_KINDS, required: true },
    status: { type: String, enum: ['draft', 'signed', 'cancelled'], default: 'draft' },
    content: { type: mongoose.Schema.Types.Mixed, default: {} },
    rev: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
    savedByName: { type: String, default: null },
    savedAt: { type: Date, default: null },
    signed: { type: new mongoose.Schema({ by: ObjectId, byName: String, role: String, at: Date }, { _id: false }), default: null },
    // A draft checked complete and marked ready for review (discharge summary); any later change takes it back to draft.
    readyForReview: { type: new mongoose.Schema({ by: ObjectId, byName: String, at: Date }, { _id: false }), default: null },
    cancelled: { type: cancelledSchema, default: null },
    additions: { type: [new mongoose.Schema({ text: { type: String, required: true, maxlength: 2000 }, by: ObjectId, byName: String, at: Date })], default: [] },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
documentSchema.plugin(hospitalScoped);
documentSchema.index({ hospitalId: 1, admissionId: 1, createdAt: 1 });
documentSchema.index({ hospitalId: 1, status: 1, kind: 1 });
documentSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });
export const InpatientDocument = mongoose.model('InpatientDocument', documentSchema, 'inpatient_documents');

const nursingSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    kind: { type: String, enum: NURSING_KINDS, required: true },
    at: { type: Date, required: true },
    vitals: { bpSystolic: Number, bpDiastolic: Number, pulse: Number, temperatureF: Number, spo2: Number, respRate: Number, painScore: Number, glucoseMgDl: Number },
    medicine: { drug: String, dose: String, route: String },
    // work on a doctor's order (dose, iv, task): the order, the time it was due (dose and task), what happened, why
    orderId: { type: ObjectId, ref: 'CareOrder', default: null },
    dueAt: { type: Date, default: null },
    outcome: { type: String, enum: ['', ...DOSE_OUTCOMES, ...TASK_OUTCOMES], default: '' },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    iv: { action: { type: String, enum: IV_ACTIONS }, site: String, volumeMl: Number },
    // intake and output, in ml
    io: { oralMl: Number, ivMl: Number, urineMl: Number, otherOutMl: Number },
    note: { type: String, default: '' },
    by: { type: ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    cancelled: { type: cancelledSchema, default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
nursingSchema.plugin(hospitalScoped);
nursingSchema.index({ hospitalId: 1, admissionId: 1, at: -1 });
nursingSchema.index({ hospitalId: 1, admissionId: 1, kind: 1, at: -1 });
nursingSchema.index({ hospitalId: 1, orderId: 1, dueAt: 1 });
nursingSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });
export const NursingEntry = mongoose.model('NursingEntry', nursingSchema, 'nursing_entries');

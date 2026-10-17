import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { ID_PROOF_TYPES, PAYER_TYPES } from './Patient.js';

// A stay in hospital (Version 2, inpatients): admitted on a date, in a ward and bed, for a reason; discharged when
// a doctor confirms the discharge card. Its documents (models/ClinicalDocument.js) and nursing chart
// (models/NursingEntry.js) belong to it. One stay at a time per patient. Never deleted.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
// The admission checklist at the desk (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md). The ID proof's number is
// never kept: only its type and last 4 digits. null on older stays.
const checklistSchema = new mongoose.Schema(
  {
    idProof: { type: String, enum: [...ID_PROOF_TYPES, ''], default: '' }, // as on her record (models/Patient.js)
    idLast4: { type: String, default: '' },
    attendantName: { type: String, trim: true, maxlength: 100, default: '' },
    attendantRelation: { type: String, trim: true, maxlength: 40, default: '' },
    attendantPhone: { type: String, trim: true, maxlength: 20, default: '' },
    payer: { type: String, enum: [...PAYER_TYPES, ''], default: '' },
    payerName: { type: String, trim: true, maxlength: 100, default: '' }, // the insurer or the scheme
    consentSigned: { type: Boolean, default: false }, // the general consent for admission, signed on paper
    complete: { type: Boolean, default: false },
    ...byFields,
  },
  { _id: false },
);
const admissionSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    careType: { type: String, required: true }, // the type of care when admitted
    admittedAt: { type: Date, required: true },
    ward: { type: String, trim: true, maxlength: 60, default: '' },
    bed: { type: String, trim: true, maxlength: 30, default: '' },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    // A bed from the hospital's list (models/Bed.js), when one was chosen; ward and bed above then hold its names.
    // Older stays, and stays admitted without the list, have only the typed ward and bed.
    bedId: { type: ObjectId, ref: 'Bed', default: null },
    // Admitted at the desk (reception): the reason chosen from the short list (inpatient/beds.js REASONS)
    reasonCode: { type: String, default: null },
    // Planned, emergency or day care, and whether it is a medico-legal case (owner, 14 Oct 2026 – as other hospitals'
    // admission and insurance forms ask). Not set on older stays.
    admissionType: { type: String, enum: ['planned', 'emergency', 'day_care', null], default: null },
    mlc: { type: Boolean, default: false },
    // HIMS-style admission (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md): the IPD number (IP-2026-000001), the
    // checklist, the police station of a medico-legal case, the doctor's request it came from, and the clearance for
    // leaving after the discharge (the bill settled, or why not) with the gate pass number. Not set on older stays.
    ipdNo: { type: String, default: null },
    checklist: { type: checklistSchema, default: null },
    mlcPolice: { type: String, trim: true, maxlength: 120, default: '' },
    requestId: { type: ObjectId, ref: 'AdmissionRequest', default: null },
    withoutRequest: { type: Boolean, default: false }, // an emergency admitted at the desk while requests are required
    clearance: {
      type: new mongoose.Schema({ ...byFields, balancePaise: Number, note: { type: String, default: '' }, passNo: String }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: ['admitted', 'discharged'], default: 'admitted' },
    dischargedAt: { type: Date, default: null },
    admittedBy: { type: ObjectId, ref: 'User', required: true },
    admittedByName: { type: String, required: true },
    dischargedByName: { type: String, default: null }, // the doctor who confirmed the discharge card
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
admissionSchema.plugin(tenantScoped);
admissionSchema.index({ tenantId: 1, patientId: 1, admittedAt: -1 });
admissionSchema.index({ tenantId: 1, status: 1 });
admissionSchema.index({ tenantId: 1, ipdNo: 1 });
admissionSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
// At most one current stay per patient
admissionSchema.index({ tenantId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'admitted' }, name: 'one_current_stay' });
// At most one current stay per bed
admissionSchema.index({ tenantId: 1, bedId: 1 }, { unique: true, partialFilterExpression: { status: 'admitted', bedId: { $type: 'objectId' } }, name: 'one_patient_per_bed' });

export const Admission = mongoose.model('Admission', admissionSchema);

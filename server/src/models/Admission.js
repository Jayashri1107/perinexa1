import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A stay in hospital (Version 2, inpatients): admitted on a date, in a ward and bed, for a reason; discharged when
// a doctor confirms the discharge card. Its documents (models/ClinicalDocument.js) and nursing chart
// (models/NursingEntry.js) belong to it. One stay at a time per patient. Never deleted.

const { ObjectId } = mongoose.Schema.Types;
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
admissionSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
// At most one current stay per patient
admissionSchema.index({ tenantId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'admitted' }, name: 'one_current_stay' });
// At most one current stay per bed
admissionSchema.index({ tenantId: 1, bedId: 1 }, { unique: true, partialFilterExpression: { status: 'admitted', bedId: { $type: 'objectId' } }, name: 'one_patient_per_bed' });

export const Admission = mongoose.model('Admission', admissionSchema);

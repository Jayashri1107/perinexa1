// A patient of one hospital. Demographics (who she is, how to reach her) and clinical details (type of care,
// pregnancy dates …) are kept apart in the views, so each role sees only what it needs (patientAccess.js).
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { CARE_TYPE_KEYS, SEX_KEYS, config } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;
const text = (maxlength) => ({ type: String, trim: true, maxlength, default: '' });

const patientSchema = new mongoose.Schema(
  {
    patientNumber: { type: String, required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true }, // lower-case name, for the duplicate check and search
    birthDate: { type: Date, default: null },
    birthDateApprox: { type: Boolean, default: false }, // true when only the age was given
    sex: { type: String, enum: SEX_KEYS, required: true },
    phone: text(20),
    alternatePhone: text(20),
    address: { line: text(200), city: text(80), state: text(80), pincode: text(6) },
    abhaNumber: text(20),
    // Whom to call in an emergency (a relative or attendant).
    emergencyContact: { name: text(100), relation: text(50), phone: text(20) },
    // The ID proof reception saw: its type and number – for Aadhaar only the last 4 digits, never the whole number.
    // last4: how it was kept before 8 Oct 2026 (the last 4 characters of any ID). TODO before real use: encrypt `number`.
    idProof: { kind: { type: String, enum: ['', ...config.patients.idProofTypes.map((t) => t.key)], default: '' }, number: text(30), last4: text(4) },
    consentMessages: { type: Boolean, default: false }, // agreed to receive reminders
    assignedDoctorId: { type: ObjectId, ref: 'User', default: null },

    // clinical
    careType: { type: String, enum: CARE_TYPE_KEYS, default: CARE_TYPE_KEYS[0] },
    lmp: { type: Date, default: null },
    edd: { type: Date, default: null },
    gravida: { type: Number, min: 0, max: 20, default: null },
    para: { type: Number, min: 0, max: 20, default: null },
    bloodGroup: { type: String, enum: ['', ...config.patients.bloodGroups], default: '' },
    allergies: text(300),
    notes: text(2000),
    isSensitive: { type: Boolean, default: false }, // only her doctor, RMOs (and emergency access) can open it

    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    registeredBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
patientSchema.plugin(hospitalScoped);
patientSchema.pre('validate', function () {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

patientSchema.index({ hospitalId: 1, patientNumber: 1 }, { unique: true });
patientSchema.index({ hospitalId: 1, createdAt: -1 });
patientSchema.index({ hospitalId: 1, phone: 1 });
patientSchema.index({ hospitalId: 1, nameKey: 1 });
patientSchema.index({ hospitalId: 1, assignedDoctorId: 1, createdAt: -1 });
patientSchema.index({ hospitalId: 1, careType: 1, edd: 1 });

export const Patient = mongoose.model('Patient', patientSchema, 'patients');

// A doctor's emergency access to a record that is not theirs: with a written reason, for a limited time, audited.
const emergencySchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
emergencySchema.plugin(hospitalScoped);
emergencySchema.index({ hospitalId: 1, patientId: 1, userId: 1, expiresAt: -1 });

export const EmergencyAccess = mongoose.model('EmergencyAccess', emergencySchema, 'emergency_access');

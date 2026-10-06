import mongoose from '../../db/mongoose.js';
import { LANGUAGE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;
const text = (maxlength) => ({ type: String, trim: true, maxlength, default: '' });

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    // lower-case copy of the name: two hospitals cannot share a name, whatever the capitals
    nameKey: { type: String, required: true, unique: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, immutable: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: {
      line: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      pincode: { type: String, trim: true, default: '' },
    },
    // master data items of the type config.masterData.hospitalDepartmentType
    departments: [{ type: ObjectId, ref: 'MasterData' }],

    // The hospital's own settings, kept by its hospital admin (Hospital settings). The super admin's screens never
    // show them (HOSPITAL_SETTINGS_FIELDS below).
    // Printed at the top and bottom of prescriptions, care plans and other documents.
    letterhead: {
      name: text(150), // printed name (the hospital name when empty)
      tagline: text(150),
      address: text(300),
      phone: text(60),
      email: text(254),
      registrationNumber: text(80),
      footer: text(300),
      // the language printed next to English on patient papers
      consentLanguage: { type: String, enum: LANGUAGE_KEYS, default: LANGUAGE_KEYS[0] },
    },
    // Patient messages: switched on here, used by the reminder and portal modules when they are built.
    messaging: {
      remindersEnabled: { type: Boolean, default: false },
      portalEnabled: { type: Boolean, default: false },
      portalBooking: { type: Boolean, default: false },
      whatsappDocuments: { type: Boolean, default: false },
    },
    // ABDM: the Health Facility Registry ID, the HIP ID and the Scan & Share counter code.
    abdm: {
      hfrId: text(60),
      hipId: text(60),
      counterCode: text(40),
    },
    // The pharmacy's details printed on its tax invoices (Pharmacy → Settings).
    pharmacy: {
      name: text(150),
      gstin: text(20),
      licence20: text(80),
      licence21: text(80),
      rmi: text(80),
      pharmacistName: text(150),
      state: text(60),
      place: text(50),
      pin: text(6),
    },
    // Billing → Settings: the hospital's UPI ID for payment links. It decides where patients' money goes, so every
    // change is kept (who, when, what) and only the admin changes it.
    billing: {
      upiId: text(100),
      payeeName: text(80),
      updatedByName: text(100),
      updatedAt: { type: Date, default: null },
      history: {
        type: [
          new mongoose.Schema(
            { upiId: { type: String, default: '' }, payeeName: { type: String, default: '' }, byName: { type: String, default: '' }, at: { type: Date, default: null } },
            { _id: false },
          ),
        ],
        default: [],
      },
    },
    settingsUpdatedAt: { type: Date, default: null },
    settingsUpdatedBy: { type: ObjectId, ref: 'User', default: null },

    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

hospitalSchema.pre('validate', function () {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

hospitalSchema.index({ isActive: 1, name: 1 });
hospitalSchema.index({ departments: 1 });

export const Hospital = mongoose.model('Hospital', hospitalSchema, 'hospitals');

// The hospital's own settings – left out of every platform (super admin) view.
export const HOSPITAL_SETTINGS_FIELDS = ['letterhead', 'messaging', 'abdm', 'pharmacy', 'billing', 'settingsUpdatedAt', 'settingsUpdatedBy'];

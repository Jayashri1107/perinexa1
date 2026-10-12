import mongoose from 'mongoose';

// A hospital (or clinic). Each hospital's data is kept separate using its id as "tenantId".
const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    // Lower-case copy of the name, used to stop two hospitals having the same name.
    nameKey: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    // Letterhead printed on prescriptions, care plans and other documents (set by the hospital admin).
    letterhead: {
      name: { type: String, trim: true, maxlength: 150, default: '' }, // printed name (defaults to the hospital name)
      tagline: { type: String, trim: true, maxlength: 150, default: '' }, // e.g. "Maternity & Women's Care"
      address: { type: String, trim: true, maxlength: 300, default: '' },
      phone: { type: String, trim: true, maxlength: 60, default: '' },
      email: { type: String, trim: true, maxlength: 254, default: '' },
      registrationNumber: { type: String, trim: true, maxlength: 80, default: '' }, // hospital registration
      // PC-PNDT number removed 2 Oct 2026: old stored values are never read.
      footer: { type: String, trim: true, maxlength: 300, default: '' },
      // The language printed next to English on consent forms (the doctor can choose the other when printing).
      consentLanguage: { type: String, enum: ['mr', 'hi'], default: 'mr' },
    },
    // The pharmacy's details printed on its tax invoices (Pharmacy → Settings): its name, GSTIN, drug licence numbers
    // (Forms 20 and 21) and the NDPS recognition (RMI) number for narcotic medicines.
    pharmacy: {
      name: { type: String, trim: true, maxlength: 150, default: '' },
      gstin: { type: String, trim: true, maxlength: 20, default: '' },
      licence20: { type: String, trim: true, maxlength: 80, default: '' },
      licence21: { type: String, trim: true, maxlength: 80, default: '' },
      rmi: { type: String, trim: true, maxlength: 80, default: '' },
      pharmacistName: { type: String, trim: true, maxlength: 150, default: '' },
      state: { type: String, trim: true, maxlength: 60, default: '' },
      // The pharmacy's city or town and PIN code: needed in the e-invoice file of a sale to a business (4 Oct 2026).
      place: { type: String, trim: true, maxlength: 50, default: '' },
      pin: { type: String, trim: true, maxlength: 6, default: '' },
    },
    // Billing settings (Billing → Settings, the hospital admin): the hospital's own UPI ID and the name it is
    // registered under, for the UPI payment link of a bill (4 Oct 2026). Empty = no UPI links. Not a secret, but it
    // decides where patients' money goes: only the admin changes it, and who changed it last is kept.
    billing: {
      upiId: { type: String, trim: true, maxlength: 100, default: '' },
      payeeName: { type: String, trim: true, maxlength: 80, default: '' },
      updatedByName: { type: String, trim: true, maxlength: 100, default: '' },
      updatedAt: { type: Date, default: null },
      // Every change of the UPI ID or the payee name, oldest first (the last 50): what they were set to, by whom and
      // when. The UPI ID decides where patients' money goes, so it must be possible to see which account the links of
      // a given day pointed to. Kept here with the settings – the audit log holds no values – and sent to the hospital
      // admin only (routes/billing.js).
      history: {
        type: [new mongoose.Schema({ upiId: { type: String, default: '' }, payeeName: { type: String, default: '' }, byName: { type: String, default: '' }, at: { type: Date, default: null } }, { _id: false })],
        default: [],
      },
    },
    // ABDM linking (M1): the hospital's Health Facility Registry ID (also its ABDM HIP ID) and the Scan & Share counter
    // code of the QR at the reception desk. The client ID and secret stay in server/.env.
    abdm: {
      hfrId: { type: String, trim: true, maxlength: 60, default: '' },
      hipId: { type: String, trim: true, maxlength: 60, default: '' },
      counterCode: { type: String, trim: true, maxlength: 40, default: '' },
    },
    // Patient messages (Version 2), switched on by the hospital admin: automatic reminders and the patient portal.
    messaging: {
      remindersEnabled: { type: Boolean, default: false },
      portalEnabled: { type: Boolean, default: false },
      // Patients may book and cancel their own appointment in the portal (4 Oct 2026); needs the portal on.
      portalBooking: { type: Boolean, default: false },
      // Staff may send a prescription or visit summary to the patient on WhatsApp in one click (4 Oct 2026); it
      // also needs WHATSAPP_MODE in server/.env and the patient's agreement to WhatsApp messages.
      whatsappDocuments: { type: Boolean, default: false },
      // The waiting-room screen: a secret in its web address (no login on the TV). null = switched off.
      displayKey: { type: String, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

tenantSchema.index({ name: 1 });
tenantSchema.index({ createdAt: -1 });
tenantSchema.index({ 'messaging.displayKey': 1 }, { unique: true, partialFilterExpression: { 'messaging.displayKey': { $type: 'string' } } });

tenantSchema.pre('validate', function () {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

tenantSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.nameKey;
    if (ret.letterhead) delete ret.letterhead.pcpndtRegistration; // removed 2 Oct 2026: kept in the database, never sent
    delete ret.billing; // the UPI ID leaves only through the billing routes (never to the platform's lists of hospitals)
    return ret;
  },
});

export const Tenant = mongoose.model('Tenant', tenantSchema);

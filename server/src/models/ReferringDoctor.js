import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A doctor outside the hospital who sends patients (Referrals, docs/REFERRALS_PLAN.md): kept by the referral desk,
// doctors and RMOs. Not patient data – a name, a clinic, a WhatsApp number to send the reply and notes to. Never
// deleted: made inactive, so the referrals they sent still show who sent them. Real names and numbers are entered by
// the hospital, never put in the code.
// partner: what the doctor joined of the guide's Clinical Partner Programme (page 7) – recorded only; Case of the
// Month and CME invitations are not sent from Perinexa in this version.

const { ObjectId } = mongoose.Schema.Types;
const stamp = new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, byName: String, at: Date }, { _id: false });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });

const referringDoctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    nameKey: { type: String, required: true, maxlength: 150 }, // the name in small letters, for search
    qualification: text(150),
    clinic: text(150),
    area: text(150),
    phone: text(30), // the WhatsApp number the desk sends to
    email: text(150),
    registrationNumber: text(60),
    notes: text(500),
    partner: {
      type: new mongoose.Schema(
        { joined: { type: Boolean, default: false }, caseOfMonth: { type: Boolean, default: false }, cme: { type: Boolean, default: false }, quarterlySummary: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: () => ({}),
    },
    isActive: { type: Boolean, default: true },
    created: { type: stamp, required: true },
    updated: { type: stamp, default: null },
  },
  { timestamps: true },
);
referringDoctorSchema.plugin(tenantScoped);
referringDoctorSchema.index({ tenantId: 1, nameKey: 1 });
referringDoctorSchema.index({ tenantId: 1, isActive: 1, nameKey: 1 });

export const ReferringDoctor = mongoose.model('ReferringDoctor', referringDoctorSchema);

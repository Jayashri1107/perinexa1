import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A Scan & Share registration (ABDM linking, M1): a patient scanned the hospital's QR code in her ABHA app and ABDM sent
// her ABHA details. It waits on reception's Today page with a token number until reception links it to her record (or
// registers her), or puts it aside. Kept as a record; never deleted.

const shareSchema = new mongoose.Schema(
  {
    on: { type: Date, required: true }, // the hospital's day
    token: { type: Number, required: true }, // 1, 2, 3 … per day
    source: { type: String, enum: ['abdm', 'practice'], required: true },
    requestId: { type: String, default: '' }, // ABDM's request id (to acknowledge)
    context: { type: String, default: '' }, // the counter code of the QR scanned
    profile: {
      abhaNumber: { type: String, required: true },
      abhaAddress: { type: String, default: '' },
      name: { type: String, default: '' },
      gender: { type: String, default: '' },
      yearOfBirth: { type: Number, default: null },
      mobile: { type: String, default: '' },
      address: { type: String, default: '' },
    },
    status: { type: String, enum: ['waiting', 'linked', 'dismissed'], default: 'waiting' },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    handled: { type: new mongoose.Schema({ by: mongoose.Schema.Types.ObjectId, byName: String, at: Date }, { _id: false }), default: null },
  },
  { timestamps: true },
);
shareSchema.plugin(tenantScoped);
shareSchema.index({ tenantId: 1, on: -1, token: 1 });
export const ScanShare = mongoose.model('ScanShare', shareSchema);

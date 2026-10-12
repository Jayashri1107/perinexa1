import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Notes attached to a patient. For now: emergency treatment notes written by a doctor who is not the
// patient's assigned doctor (they have read-only access otherwise). A reason is always required.
// Notes can never be edited or deleted – they are part of the medical record.
const patientNoteSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['emergency'], required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    text: { type: String, required: true, trim: true, maxlength: 5000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
  },
  { timestamps: true },
);
patientNoteSchema.plugin(tenantScoped);
patientNoteSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne']) {
  patientNoteSchema.pre(op, function () {
    throw new Error('Patient notes cannot be changed or deleted');
  });
}

patientNoteSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const PatientNote = mongoose.model('PatientNote', patientNoteSchema);

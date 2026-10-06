import mongoose from '../../db/mongoose.js';
import { AUDIT_ACTION_KEYS } from './audit.actions.js';

const { ObjectId } = mongoose.Schema.Types;

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, enum: AUDIT_ACTION_KEYS, required: true },
    actor: { type: ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: null },
    target: { type: ObjectId, default: null },
    targetEmail: { type: String, default: null },
    hospitalId: { type: ObjectId, ref: 'Hospital', default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The list is read newest first, filtered by event or hospital.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ hospitalId: 1, createdAt: -1 });

// The audit log can only be added to – never changed or deleted through the app.
const BLOCKED = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
for (const op of BLOCKED) {
  auditLogSchema.pre(op, () => {
    throw new Error('The audit log cannot be changed or deleted.');
  });
}

export const AuditLog = mongoose.model('AuditLog', auditLogSchema, 'audit_logs');

import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A notification for one person in one hospital (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): the bell in the top
// bar. A new appointment or an arrival for a doctor, a checkup marked done for reception, lab results to review, an
// admission request. Only to people who may see that patient's name in their work; the text is short and never
// clinical. Kept 30 days.
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['appointment', 'arrived', 'done', 'lab', 'admission'], required: true },
    text: { type: String, required: true, maxlength: 300 },
    link: { type: String, default: '/', maxlength: 200 },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { timestamps: false },
);
notificationSchema.plugin(tenantScoped);
notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const Notification = mongoose.model('Notification', notificationSchema);

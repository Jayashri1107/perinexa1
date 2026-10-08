// A notification for one person in one hospital (owner, 8 Oct 2026): a new appointment for a doctor, a patient who
// has arrived, a new admission, a discharge card ready for reception … Short words only – the patient's name and
// number at most, never medical details. Read ones are kept; old ones are removed after config.notifications.keepDays.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { config } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;
export const NOTIFICATION_TYPES = ['NEW_APPOINTMENT', 'PATIENT_ARRIVED', 'NEW_ADMISSION', 'DISCHARGE_READY', 'FINAL_BILL'];

const notificationSchema = new mongoose.Schema(
  {
    recipientId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 120 },
    message: { type: String, default: '', maxlength: 300 },
    link: { type: String, default: '', maxlength: 200 }, // a page of the website to open
    isRead: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.plugin(hospitalScoped);
notificationSchema.index({ hospitalId: 1, recipientId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: config.notifications.keepDays * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema, 'notifications');

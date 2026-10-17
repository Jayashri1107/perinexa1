import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { isClosed } from '../patients/deathRules.js';
import { queueMessage } from '../reminders/messages.js';
import { mobileNumber } from '../reminders/phone.js';
import { queuesOf } from '../routes/appointments.js';
import { audit } from '../utils/audit.js';
import { textSender, whatsappStatus } from '../visits/whatsappSender.js';
import { SLOT_MINUTES } from './appointmentRules.js';
import { hospitalMinutes, minutesOf } from './slots.js';

// The queue time on WhatsApp (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md): when reception marks her arrived –
// with a walk-in token or for her booking – she gets her token (or time), how many are before her with that doctor
// and about when she goes in. The estimate: now plus one slot (SLOT_MINUTES) for each patient before her, never
// before her booked time. Only when the hospital admin switched it on, WhatsApp is set up and she agreed to WhatsApp
// messages; never from a closed record. Never fails the arrival: a message that could not go is only reported back.
// The audit log gets ids only.

const clock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The estimate for the patient at `index` in a doctor's waiting list: { ahead, eta: "HH:MM" }. */
export function queueEstimate(waiting, index, nowMinutes, slotMinutes = SLOT_MINUTES) {
  const v = waiting[index];
  const byQueue = nowMinutes + index * slotMinutes;
  const booked = v.kind !== 'token' && v.start ? minutesOf(v.start) : 0;
  return { ahead: index, eta: clock(Math.max(byQueue, booked)) };
}

/** Sends her queue time. Returns { sent, reason?, practice?, ahead?, eta? }. */
export async function sendQueueTime(req, patientId, appointmentId) {
  try {
    const tenant = await Tenant.findById(req.tenantId, { name: 1, letterhead: 1, messaging: 1 }).lean();
    if (!tenant?.messaging?.whatsappQueue) return { sent: false, reason: 'switched_off' };
    const sender = textSender();
    if (!sender) return { sent: false, reason: 'not_set_up' };
    const p = await Patient.findOne({ tenantId: req.tenantId, _id: patientId }, { mrn: 1, phone: 1, reminders: 1, 'death.on': 1 }).lean();
    if (!p || isClosed(p)) return { sent: false, reason: 'record_closed' };
    if (!(p.reminders?.consent && p.reminders?.channel === 'whatsapp')) return { sent: false, reason: 'no_agreement' };
    const to = mobileNumber(p.phone);
    if (!to) return { sent: false, reason: 'no_mobile' };
    const { queues } = await queuesOf(req.tenantId, req.now);
    const q = queues.find((x) => x.waiting.some((v) => v.id === String(appointmentId)));
    if (!q) return { sent: false, reason: 'not_waiting' };
    const index = q.waiting.findIndex((v) => v.id === String(appointmentId));
    const v = q.waiting[index];
    const { ahead, eta } = queueEstimate(q.waiting, index, hospitalMinutes(req.now));
    const hospital = tenant.letterhead?.name || tenant.name;
    const text = queueMessage({ hospital, doctor: q.doctor.name, token: v.kind === 'token' ? v.token : null, start: v.start, ahead, eta, lang: p.reminders.language ?? 'en' });
    await sender.send({ channel: 'whatsapp', to, text, hospital });
    const practice = whatsappStatus().mode === 'practice';
    await audit(req, 'QUEUE_TIME_SENT', { details: { patientId: String(p._id), mrn: p.mrn, appointmentId: String(appointmentId), ...(practice ? { practice: true } : {}) } });
    return { sent: true, practice, ahead, eta };
  } catch (err) {
    console.error('WhatsApp: the queue time could not be sent:', err?.message ?? err);
    return { sent: false, reason: 'failed' };
  }
}

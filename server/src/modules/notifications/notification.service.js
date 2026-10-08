// Notifications: created by other modules (notify, notifyRoles) and read by each person (their bell).
// Creating one never fails the work that caused it: a problem is logged and the work goes on.
import { config } from '../../config/index.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { notFoundError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { Admission, InpatientDocument } from '../admissions/admission.model.js';
import { Appointment } from '../appointments/appointment.model.js';
import { utcDay } from '../appointments/slots.js';
import { Membership } from '../members/membership.model.js';
import { Notification } from './notification.model.js';

/** Sends one notification to these people (user ids) of this hospital – never to the person who caused it. */
export async function notify(req, recipientIds, { type, title, message = '', link = '' }) {
  try {
    const me = String(req.user?._id ?? '');
    const ids = [...new Set(recipientIds.filter(Boolean).map(String))].filter((id) => id !== me);
    if (!ids.length) return;
    await Notification.insertMany(ids.map((id) => ({ hospitalId: req.hospitalId, recipientId: id, type, title, message, link })));
  } catch (err) {
    console.error('Notification not created:', err.message);
  }
}

/** Sends it to everyone active in this hospital with one of these roles. */
export async function notifyRoles(req, roles, notification) {
  try {
    const members = await Membership.find({ hospitalId: req.hospitalId, isActive: true, roles: { $in: roles } }).select('userId').lean();
    await notify(req, members.map((m) => m.userId), notification);
  } catch (err) {
    console.error('Notification not created:', err.message);
  }
}

const view = (n) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, link: n.link, isRead: n.isRead, createdAt: n.createdAt });

// ---------- The day's summary (owner, 8 Oct 2026) ----------
// The first time a person's bell is checked on a day, a doctor gets "Your day today" (her appointments, her patients
// admitted today and in hospital) and reception gets "Discharges today" (discharged today, discharge cards being
// prepared). Sent once a day (its key), and only when there is something to tell. Counts only – no names.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function doctorDay(hid, userId, start, end) {
  const day = utcDay(todayLocal());
  const [booked, waiting, admittedToday, inHospital] = await Promise.all([
    Appointment.countDocuments({ hospitalId: hid, doctorId: userId, on: day, status: { $ne: 'cancelled' } }),
    Appointment.countDocuments({ hospitalId: hid, doctorId: userId, on: day, status: 'arrived' }),
    Admission.countDocuments({ hospitalId: hid, doctorId: userId, admittedAt: { $gte: start, $lt: end } }),
    Admission.countDocuments({ hospitalId: hid, doctorId: userId, status: 'admitted' }),
  ]);
  const parts = [];
  if (booked) parts.push(`${plural(booked, 'appointment')}${waiting ? ` (${waiting} waiting)` : ''}`);
  if (admittedToday) parts.push(`${admittedToday} admitted today`);
  if (inHospital) parts.push(`${inHospital} in hospital`);
  return parts.length ? { type: 'TODAY_SUMMARY', title: 'Your day today', message: parts.join(' · '), link: booked ? '/hospital/appointments' : '/hospital' } : null;
}

async function dischargeDay(hid, start, end) {
  const stillIn = await Admission.find({ hospitalId: hid, status: 'admitted' }).select('_id').lean();
  const [discharged, preparing] = await Promise.all([
    Admission.countDocuments({ hospitalId: hid, dischargedAt: { $gte: start, $lt: end } }),
    stillIn.length
      ? InpatientDocument.countDocuments({ hospitalId: hid, kind: 'discharge', status: 'draft', admissionId: { $in: stillIn.map((s) => s._id) } })
      : 0,
  ]);
  const parts = [];
  if (discharged) parts.push(`${discharged} discharged`);
  if (preparing) parts.push(`${plural(preparing, 'discharge card')} being prepared`);
  return parts.length ? { type: 'TODAY_SUMMARY', title: 'Discharges today', message: parts.join(' · '), link: '/hospital/discharges' } : null;
}

async function sendDaySummaries(req) {
  const hid = toObjectId(req.hospitalId);
  const roles = req.membership?.roles ?? [];
  const date = todayLocal();
  const wanted = [
    roles.includes(config.opd.doctorRole) && { key: `today-${date}-doctor`, make: (s, e) => doctorDay(hid, req.user._id, s, e) },
    roles.some((r) => config.access.registrationMenu.includes(r)) && { key: `today-${date}-discharges`, make: (s, e) => dischargeDay(hid, s, e) },
  ].filter(Boolean);
  if (!wanted.length) return;
  const [start, end] = dayRange(date);
  for (const { key, make } of wanted) {
    if (await Notification.exists({ hospitalId: hid, recipientId: req.user._id, key })) continue;
    const n = await make(start, end);
    if (!n) continue;
    // two tabs asking at once: the unique key keeps it to one
    await Notification.updateOne({ hospitalId: hid, recipientId: req.user._id, key }, { $setOnInsert: { ...n, isRead: false } }, { upsert: true }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
}

export async function myNotifications(req) {
  try {
    await sendDaySummaries(req);
  } catch (err) {
    console.error('Day summary not created:', err.message);
  }
  const mine = { hospitalId: toObjectId(req.hospitalId), recipientId: req.user._id };
  const [items, unread] = await Promise.all([
    Notification.find(mine).sort({ createdAt: -1 }).limit(config.notifications.listSize).lean(),
    Notification.countDocuments({ ...mine, isRead: false }),
  ]);
  return { items: items.map(view), unread };
}

export async function markRead(req, id) {
  const n = await Notification.findOneAndUpdate({ hospitalId: req.hospitalId, recipientId: req.user._id, _id: id }, { $set: { isRead: true } }, { returnDocument: 'after' });
  if (!n) throw notFoundError('Notification');
  return myNotifications(req);
}

export async function markAllRead(req) {
  await Notification.updateMany({ hospitalId: req.hospitalId, recipientId: req.user._id, isRead: false }, { $set: { isRead: true } });
  return myNotifications(req);
}

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
import { User } from '../users/user.model.js';
import { Notification } from './notification.model.js';

// The super admins (owner, 8 Oct 2026: they receive every notification of the hospitals they work in), looked up at
// most once a minute.
let superAdmins = { ids: [], at: 0 };
async function superAdminIds() {
  if (!config.access.superAdminInHospitals) return [];
  if (Date.now() - superAdmins.at > 60_000) {
    const users = await User.find({ isSuperAdmin: true, isActive: true }).select('_id').lean();
    superAdmins = { ids: users.map((u) => String(u._id)), at: Date.now() };
  }
  return superAdmins.ids;
}

/**
 * Sends one notification to these people (user ids) of this hospital – never to the person who caused it – and to
 * every super admin (even the one who caused it: they see everything that happens). One event sent to several roles
 * reaches a super admin once (remembered on the request).
 */
export async function notify(req, recipientIds, { type, title, message = '', link = '' }) {
  try {
    const me = String(req.user?._id ?? '');
    const staff = [...new Set(recipientIds.filter(Boolean).map(String))].filter((id) => id !== me);
    req.notifiedSuperAdmins ??= new Set();
    const event = `${type}|${title}|${message}`;
    const supers = (await superAdminIds()).filter((id) => !staff.includes(id) && !req.notifiedSuperAdmins.has(`${event}|${id}`));
    supers.forEach((id) => req.notifiedSuperAdmins.add(`${event}|${id}`));
    const ids = [...staff, ...supers];
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
    await notify(req, members.map((m) => m.userId), notification); // also reaches the super admins (notify)
  } catch (err) {
    console.error('Notification not created:', err.message);
  }
}

const view = (n) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, link: n.link, isRead: n.isRead, createdAt: n.createdAt });

// ---------- The day's summary (owner, 8 Oct 2026) ----------
// When a person's bell is checked, each part of their day is its own notification (so each counts on the bell): a
// doctor gets "N appointments today", "N admitted today" and "N in hospital"; reception gets "N discharged today" and
// "N discharge cards being prepared". Each part is sent once a day (its own key), and only once there is something to
// tell. Counts only – no names.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function doctorDay(hid, userId, start, end) {
  const day = utcDay(todayLocal());
  const [booked, waiting, admittedToday, inHospital] = await Promise.all([
    Appointment.countDocuments({ hospitalId: hid, doctorId: userId, on: day, status: { $ne: 'cancelled' } }),
    Appointment.countDocuments({ hospitalId: hid, doctorId: userId, on: day, status: 'arrived' }),
    Admission.countDocuments({ hospitalId: hid, doctorId: userId, admittedAt: { $gte: start, $lt: end } }),
    Admission.countDocuments({ hospitalId: hid, doctorId: userId, status: 'admitted' }),
  ]);
  return [
    booked && { part: 'appointments', type: 'TODAY_APPOINTMENTS', title: `${plural(booked, 'appointment')} today`, message: waiting ? `${waiting} waiting now` : 'Your OPD day', link: '/hospital/appointments' },
    admittedToday && { part: 'admitted', type: 'TODAY_ADMISSIONS', title: `${admittedToday} of your patients admitted today`, message: '', link: '/hospital' },
    inHospital && { part: 'in-hospital', type: 'TODAY_ADMISSIONS', title: `${plural(inHospital, 'patient')} of yours in hospital`, message: '', link: '/hospital' },
  ].filter(Boolean);
}

async function dischargeDay(hid, start, end) {
  const stillIn = await Admission.find({ hospitalId: hid, status: 'admitted' }).select('_id').lean();
  const [discharged, preparing] = await Promise.all([
    Admission.countDocuments({ hospitalId: hid, dischargedAt: { $gte: start, $lt: end } }),
    stillIn.length
      ? InpatientDocument.countDocuments({ hospitalId: hid, kind: 'discharge', status: 'draft', admissionId: { $in: stillIn.map((s) => s._id) } })
      : 0,
  ]);
  return [
    discharged && { part: 'discharged', type: 'TODAY_DISCHARGES', title: `${plural(discharged, 'patient')} discharged today`, message: 'Print the discharge cards', link: '/hospital/discharges' },
    preparing && { part: 'preparing', type: 'TODAY_DISCHARGES', title: `${plural(preparing, 'discharge card')} being prepared`, message: 'Going home soon', link: '/hospital/admissions' },
  ].filter(Boolean);
}

async function sendDaySummaries(req) {
  const hid = toObjectId(req.hospitalId);
  const roles = req.membership?.roles ?? [];
  const date = todayLocal();
  const makers = [
    roles.includes(config.opd.doctorRole) && ((s, e) => doctorDay(hid, req.user._id, s, e)),
    roles.some((r) => config.access.registrationMenu.includes(r)) && ((s, e) => dischargeDay(hid, s, e)),
  ].filter(Boolean);
  if (!makers.length) return;
  const [start, end] = dayRange(date);
  const parts = (await Promise.all(makers.map((make) => make(start, end)))).flat();
  for (const { part, ...n } of parts) {
    const key = `today-${date}-${part}`;
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
  const [items, unread, byType] = await Promise.all([
    Notification.find(mine).sort({ createdAt: -1 }).limit(config.notifications.listSize).lean(),
    Notification.countDocuments({ ...mine, isRead: false }),
    // the unread count of each kind (the bell's tabs)
    Notification.aggregate([{ $match: { ...mine, isRead: false } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  return { items: items.map(view), unread, unreadByType: Object.fromEntries(byType.map((t) => [t._id, t.n])) };
}

export async function markRead(req, id) {
  const n = await Notification.findOneAndUpdate({ hospitalId: req.hospitalId, recipientId: req.user._id, _id: id }, { $set: { isRead: true } }, { returnDocument: 'after' });
  if (!n) throw notFoundError('Notification');
  return myNotifications(req);
}

// types: only these kinds (the bell's open tab); none – all
export async function markAllRead(req, types = []) {
  await Notification.updateMany({ hospitalId: req.hospitalId, recipientId: req.user._id, isRead: false, ...(types.length && { type: { $in: types } }) }, { $set: { isRead: true } });
  return myNotifications(req);
}

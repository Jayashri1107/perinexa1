// Notifications: created by other modules (notify, notifyRoles) and read by each person (their bell).
// Creating one never fails the work that caused it: a problem is logged and the work goes on.
import { config } from '../../config/index.js';
import { notFoundError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
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

export async function myNotifications(req) {
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

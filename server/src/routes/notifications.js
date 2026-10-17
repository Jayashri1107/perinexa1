import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { objectId, parse } from '../utils/validate.js';

// The bell in the top bar (/api/notifications – owner, 17 Oct 2026): this person's latest notifications in this
// hospital and how many are unread; mark one or all read. Only one's own.

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const mine = { tenantId: req.tenantId, userId: req.user._id };
  const [list, unread] = await Promise.all([Notification.find(mine).sort({ createdAt: -1, _id: -1 }).limit(30).lean(), Notification.countDocuments({ ...mine, readAt: null })]);
  res.json({ unread, notifications: list.map((n) => ({ id: String(n._id), kind: n.kind, text: n.text, link: n.link, at: n.createdAt, read: Boolean(n.readAt) })) });
});

notificationsRouter.post('/read', async (req, res) => {
  const body = parse(z.object({ ids: z.array(objectId).max(100).optional() }).strict(), req.body ?? {});
  const filter = { tenantId: req.tenantId, userId: req.user._id, readAt: null, ...(body.ids ? { _id: { $in: body.ids } } : {}) };
  const r = await Notification.updateMany(filter, { $set: { readAt: req.now ?? new Date() } });
  res.json({ read: r.modifiedCount });
});

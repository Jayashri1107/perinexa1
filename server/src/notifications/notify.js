// Notifications (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): who gets told what, in a few words. Never fails the
// work that caused it (a failure is logged without any patient detail). Not to the person who did it.
import { Membership } from '../models/Membership.js';
import { Notification } from '../models/Notification.js';

/**
 * Notifies people: to.userIds (e.g. the doctor) and/or everyone active with one of to.roles (e.g. reception), except
 * the person acting (req.user). kind: Notification kinds; text: short, no clinical detail; link: where to open.
 */
export async function notify(req, to, { kind, text, link = '/' }) {
  try {
    const ids = new Set((to.userIds ?? []).filter(Boolean).map(String));
    if (to.roles?.length) {
      const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: to.roles } }, { userId: 1 }).lean();
      for (const m of members) ids.add(String(m.userId));
    }
    if (req.user?._id) ids.delete(String(req.user._id));
    if (!ids.size) return 0;
    const at = req.now ?? new Date();
    await Notification.insertMany([...ids].map((userId) => ({ tenantId: req.tenantId, userId, kind, text: text.slice(0, 300), link, createdAt: at })));
    return ids.size;
  } catch (err) {
    console.error('A notification could not be saved:', err?.message ?? err);
    return 0;
  }
}

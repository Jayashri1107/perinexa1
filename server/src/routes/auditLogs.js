import { Router } from 'express';
import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AuditLog, RETIRED_AUDIT_ACTIONS } from '../models/AuditLog.js';
import { Tenant } from '../models/Tenant.js';
import { auditEntryJSON } from '../utils/auditDetails.js';
import { escapeRegex, objectId, pageParams, paged, parse } from '../utils/validate.js';

const listSchema = z
  .object({
    category: z.enum(Object.keys(AUDIT_CATEGORIES)).optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    tenantId: objectId.optional(),
    userId: objectId.optional(), // entries done BY or TO this person
    search: z.string().trim().max(100).default(''),
    from: z.iso.datetime('Invalid start date').optional(),
    to: z.iso.datetime('Invalid end date').optional(),
    ...pageParams,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'End date must be after start date' });

/**
 * Audit log viewer.
 * - scope "platform": super admins see everything and can filter by hospital or person, but never which
 *   patient an entry was about (no record number, patient id, type of care or care-plan id).
 * - scope "tenant": hospital admins see only entries for the hospital they're working in.
 */
export function auditLogsRouter({ scope }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = parse(listSchema, req.query);
    const and = [];
    if (scope === 'tenant') and.push({ tenantId: req.tenantId });
    else if (q.tenantId) and.push({ tenantId: q.tenantId });
    if (q.action) and.push({ action: q.action });
    if (q.category) and.push({ action: { $in: AUDIT_CATEGORIES[q.category] } });
    if (q.userId) and.push({ $or: [{ actor: q.userId }, { target: q.userId }] });
    if (q.from || q.to) {
      const createdAt = {};
      if (q.from) createdAt.$gte = new Date(q.from);
      if (q.to) createdAt.$lte = new Date(q.to);
      and.push({ createdAt });
    }
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), 'i');
      and.push({ $or: [{ actorEmail: rx }, { targetEmail: rx }] });
    }
    const filter = and.length ? { $and: and } : {};

    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      AuditLog.countDocuments(filter),
    ]);

    // Show hospital names next to entries.
    const tenantIds = [...new Set(entries.map((e) => e.tenantId?.toString()).filter(Boolean))];
    const tenants = await Tenant.find({ _id: { $in: tenantIds } }, { name: 1 }).lean();
    const names = new Map(tenants.map((t) => [t._id.toString(), t.name]));

    res.json({
      // Medical details trimmed; on the platform also every patient key (utils/auditDetails.js) – and so for a super
      // admin or platform admin reading a hospital's own log: they never see which patient an entry was about.
      entries: entries.map((e) => auditEntryJSON(e, names, { scope: req.membership?.platform ? 'platform' : scope })),
      // The choices for the action filter: actions of removed features are left out (their old entries still show).
      actions: (q.category ? AUDIT_CATEGORIES[q.category] : AUDIT_ACTIONS).filter((a) => !RETIRED_AUDIT_ACTIONS.has(a)),
      ...paged(q, total),
    });
  });

  return router;
}

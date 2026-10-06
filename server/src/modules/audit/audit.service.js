import { lookupOne, withId } from '../../core/aggregate.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText } from '../../core/validate.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { AUDIT_CATEGORIES } from './audit.actions.js';
import { AuditLog } from './auditLog.model.js';

// Records "who did what, to whom, and when". Never stores passwords. A failure to write is logged but never
// breaks the action itself.
export async function recordAudit(req, action, { actor, target, hospitalId = null, details = {} } = {}) {
  const who = actor ?? req.user ?? null;
  try {
    await AuditLog.create({
      action,
      actor: who?._id ?? null,
      actorEmail: who?.email ?? null,
      target: target?._id ?? null,
      targetEmail: target?.email ?? null,
      hospitalId,
      details,
      ip: req.ip ?? null,
      userAgent: req.get?.('user-agent')?.slice(0, 300) ?? null,
    });
  } catch (err) {
    console.error('Failed to write audit log entry', action, err);
  }
}

export async function listAuditLogs(q) {
  const match = {};
  if (q.action) match.action = q.action;
  else if (q.category) match.action = { $in: AUDIT_CATEGORIES.find((c) => c.key === q.category).actions };
  if (q.hospitalId) match.hospitalId = q.hospitalId;
  if (q.from || q.to) {
    match.createdAt = {};
    if (q.from) match.createdAt.$gte = q.from;
    if (q.to) match.createdAt.$lte = q.to;
  }
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ actorEmail: text }, { targetEmail: text }];
  }

  return paginate(AuditLog, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [
      ...lookupOne({ from: Hospital.collection.name, localField: 'hospitalId', as: 'hospital', fields: ['name', 'code'] }),
      { $project: { userAgent: 0 } },
      ...withId(),
    ],
  });
}

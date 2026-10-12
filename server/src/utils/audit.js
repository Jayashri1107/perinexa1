import { AuditLog } from '../models/AuditLog.js';

// Records "who did what, to whom, and when". Never stores passwords.
export async function audit(req, action, { actor, target, tenantId, details } = {}) {
  const who = actor ?? req.user ?? null;
  try {
    await AuditLog.create({
      action,
      tenantId: tenantId === undefined ? (req.tenantId ?? null) : tenantId,
      actor: who?._id ?? null,
      actorEmail: who?.email ?? null,
      target: target?._id ?? null,
      targetEmail: target?.email ?? null,
      details: details ?? {},
      ip: req.ip ?? null,
      userAgent: req.get?.('user-agent')?.slice(0, 300) ?? null,
    });
  } catch (err) {
    console.error('Failed to write audit log entry', action, err);
  }
}

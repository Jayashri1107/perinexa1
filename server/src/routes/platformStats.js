import { Router } from 'express';
import { AUDIT_CATEGORIES, AuditLog } from '../models/AuditLog.js';
import { Membership } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { auditEntryJSON } from '../utils/auditDetails.js';
import { platformTenantView } from './platformTenants.js';

// Numbers for the super admin Overview page.
export const platformStatsRouter = Router();

platformStatsRouter.get('/', async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [tenantsTotal, tenantsActive, usersActive, usersInactive, superAdmins, pendingFirstLogin, securityEvents24h, failedLogins24h, recent] =
    await Promise.all([
      Tenant.countDocuments({}),
      Tenant.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: false }),
      User.countDocuments({ isSuperAdmin: true, isActive: true }),
      User.countDocuments({ isActive: true, mustChangePassword: true }),
      AuditLog.countDocuments({ action: { $in: AUDIT_CATEGORIES.security }, createdAt: { $gte: since } }),
      AuditLog.countDocuments({ action: { $in: ['LOGIN_FAILED', 'LOGIN_RATE_LIMITED'] }, createdAt: { $gte: since } }),
      AuditLog.find({}).sort({ createdAt: -1, _id: -1 }).limit(8),
    ]);

  // Active hospitals that have no active admin yet (they need attention).
  const withAdmin = await Membership.distinct('tenantId', { roles: 'admin', isActive: true });
  const noAdminFilter = { isActive: true, _id: { $nin: withAdmin } };
  const [tenantsWithoutAdmin, withoutAdminSample] = await Promise.all([
    Tenant.countDocuments(noAdminFilter),
    Tenant.find(noAdminFilter).sort({ createdAt: -1 }).limit(5),
  ]);

  const tenantIds = [...new Set(recent.map((e) => e.tenantId?.toString()).filter(Boolean))];
  const names = new Map((await Tenant.find({ _id: { $in: tenantIds } }, { name: 1 }).lean()).map((t) => [t._id.toString(), t.name]));

  res.json({
    tenants: { total: tenantsTotal, active: tenantsActive, withoutAdmin: tenantsWithoutAdmin },
    users: { active: usersActive, inactive: usersInactive, superAdmins, pendingFirstLogin },
    security: { events24h: securityEvents24h, failedLogins24h },
    tenantsWithoutAdmin: withoutAdminSample.map(platformTenantView),
    // The same trimmed details as the platform audit log (no medical information and no patient numbers).
    recentActivity: recent.map((e) => auditEntryJSON(e, names, { scope: 'platform' })),
  });
});

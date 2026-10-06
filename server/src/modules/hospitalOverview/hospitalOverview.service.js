// The hospital admin's consolidated view of their hospital: staff numbers, OPD timings still missing, which settings
// are filled in, and recent activity – grouped aggregates run together.
import { config } from '../../config/index.js';
import { lookupOne } from '../../core/aggregate.js';
import { notFoundError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { AUDIT_ACTIONS } from '../audit/audit.actions.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Membership } from '../members/membership.model.js';
import { doctorsWithoutTimings } from '../opdTimings/opdTimings.service.js';
import { User } from '../users/user.model.js';

const countIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });

// One pass over the hospital's staff: totals, and staff per role (active only).
const staffStats = (hospitalId) =>
  Membership.aggregate([
    { $match: { hospitalId } },
    ...lookupOne({ from: User.collection.name, localField: 'userId', as: 'user', fields: ['isActive', 'mustChangePassword'] }),
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: countIf('$isActive'),
              pendingFirstLogin: countIf({ $and: ['$isActive', '$user.isActive', '$user.mustChangePassword'] }),
            },
          },
        ],
        byRole: [{ $match: { isActive: true } }, { $unwind: '$roles' }, { $group: { _id: '$roles', count: { $sum: 1 } } }],
      },
    },
  ]);

const filled = (v) => typeof v === 'string' && v.trim() !== '';

export async function getOverview(hospitalId) {
  const hid = toObjectId(hospitalId);
  const [hospital, [stats], opd, activity] = await Promise.all([
    Hospital.findById(hid).select('name code address letterhead messaging abdm').lean(),
    staffStats(hid),
    doctorsWithoutTimings(hid),
    AuditLog.find({ hospitalId: hid })
      .sort({ createdAt: -1 })
      .limit(config.dashboard.recentActivityCount)
      .select('action actorEmail targetEmail createdAt')
      .lean(),
  ]);
  if (!hospital) throw notFoundError('Hospital');

  const totals = stats.totals[0] ?? { total: 0, active: 0, pendingFirstLogin: 0 };
  const roleCounts = Object.fromEntries(stats.byRole.map((r) => [r._id, r.count]));
  const { letterhead = {}, messaging = {}, abdm = {} } = hospital;

  return {
    hospital: { id: hospital._id.toString(), name: hospital.name, code: hospital.code, address: hospital.address },
    staff: {
      active: totals.active,
      inactive: totals.total - totals.active,
      pendingFirstLogin: totals.pendingFirstLogin,
      admins: roleCounts[config.adminRole] ?? 0,
      byRole: config.roles.map((r) => ({ role: r.key, label: r.label, count: roleCounts[r.key] ?? 0 })),
    },
    opd,
    // A checklist of the settings: done or still to do.
    setup: [
      { key: 'letterhead', label: 'Print letterhead', done: filled(letterhead.address) && filled(letterhead.phone) },
      { key: 'registration', label: 'Hospital registration number', done: filled(letterhead.registrationNumber) },
      { key: 'opd', label: 'OPD timings for every doctor', done: opd.doctors > 0 && opd.withoutTimings === 0 },
      { key: 'abdm', label: 'ABDM facility ID (HFR)', done: filled(abdm.hfrId) },
    ],
    messaging: {
      remindersEnabled: Boolean(messaging.remindersEnabled),
      portalEnabled: Boolean(messaging.portalEnabled),
    },
    recentActivity: activity.map((a) => ({
      id: a._id.toString(),
      label: AUDIT_ACTIONS[a.action] ?? a.action,
      actorEmail: a.actorEmail,
      targetEmail: a.targetEmail,
      createdAt: a.createdAt,
    })),
  };
}

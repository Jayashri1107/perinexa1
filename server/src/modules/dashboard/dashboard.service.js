// The consolidated view for the main admin: platform totals in a handful of grouped aggregates, run together.
import { config } from '../../config/index.js';
import { lookupOne } from '../../core/aggregate.js';
import { AUDIT_ACTIONS } from '../audit/audit.actions.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { MasterData } from '../masterData/masterData.model.js';
import { Membership } from '../members/membership.model.js';
import { User } from '../users/user.model.js';

const countIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });

const hospitalTotals = () =>
  Hospital.aggregate([{ $group: { _id: null, total: { $sum: 1 }, active: countIf('$isActive') } }]);

const userTotals = () =>
  User.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: countIf('$isActive'),
        pendingFirstLogin: countIf({ $and: ['$isActive', '$mustChangePassword'] }),
        superAdmins: countIf({ $and: ['$isActive', '$isSuperAdmin'] }),
      },
    },
  ]);

const staffByRole = () =>
  Membership.aggregate([{ $match: { isActive: true } }, { $unwind: '$roles' }, { $group: { _id: '$roles', count: { $sum: 1 } } }]);

const largestHospitals = () =>
  Membership.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$hospitalId', staff: { $sum: 1 } } },
    { $sort: { staff: -1 } },
    { $limit: config.dashboard.topHospitalsCount },
    ...lookupOne({ from: Hospital.collection.name, localField: '_id', as: 'hospital', fields: ['name', 'code', 'isActive'] }),
    { $project: { _id: 0, staff: 1, hospital: 1 } },
  ]);

const masterDataTotals = () =>
  MasterData.aggregate([{ $group: { _id: '$type', total: { $sum: 1 }, active: countIf('$isActive') } }]);

const recentActivity = () =>
  AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(config.dashboard.recentActivityCount)
    .select('action actorEmail targetEmail createdAt')
    .lean();

const first = (rows, fallback) => {
  const { _id, ...rest } = rows[0] ?? {};
  return { ...fallback, ...rest };
};

export async function getSummary() {
  const [hospitals, users, roles, topHospitals, masters, activity] = await Promise.all([
    hospitalTotals(),
    userTotals(),
    staffByRole(),
    largestHospitals(),
    masterDataTotals(),
    recentActivity(),
  ]);

  const hospitalStats = first(hospitals, { total: 0, active: 0 });
  const roleCounts = Object.fromEntries(roles.map((r) => [r._id, r.count]));
  const masterCounts = Object.fromEntries(masters.map((m) => [m._id, m]));

  return {
    hospitals: { ...hospitalStats, inactive: hospitalStats.total - hospitalStats.active },
    users: first(users, { total: 0, active: 0, pendingFirstLogin: 0, superAdmins: 0 }),
    staffByRole: config.roles.map((r) => ({ role: r.key, label: r.label, count: roleCounts[r.key] ?? 0 })),
    topHospitals,
    masterData: config.masterData.types.map((t) => ({
      type: t.key,
      label: t.label,
      total: masterCounts[t.key]?.total ?? 0,
      active: masterCounts[t.key]?.active ?? 0,
    })),
    recentActivity: activity.map((a) => ({
      id: a._id.toString(),
      action: a.action,
      label: AUDIT_ACTIONS[a.action] ?? a.action,
      actorEmail: a.actorEmail,
      targetEmail: a.targetEmail,
      createdAt: a.createdAt,
    })),
  };
}

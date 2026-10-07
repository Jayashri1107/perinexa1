import { lookupOne, withId } from '../../core/aggregate.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText } from '../../core/validate.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Patient } from '../patients/patient.model.js';
import { User } from '../users/user.model.js';
import { AUDIT_CATEGORIES, ROUTINE_ACTIONS } from './audit.actions.js';
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

// What an entry is about, in words: the account (its email, also for older entries that kept only the id), the
// patient (her number – only in a hospital's own log), or the bill / invoice / item / setting named in the details.
const aboutStages = (withPatients) => [
  ...lookupOne({ from: User.collection.name, localField: 'actor', as: 'actorUser', fields: ['name'] }),
  ...lookupOne({ from: User.collection.name, localField: 'target', as: 'targetUser', fields: ['name', 'email'] }),
  ...(withPatients
    ? [
        {
          $lookup: {
            from: Patient.collection.name,
            let: { pid: { $convert: { input: '$details.patientId', to: 'objectId', onError: null, onNull: null } }, hid: '$hospitalId' },
            pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$pid'] }, { $eq: ['$hospitalId', '$$hid'] }] } } }, { $project: { patientNumber: 1 } }],
            as: 'patientRef',
          },
        },
        { $set: { patientNumber: { $first: '$patientRef.patientNumber' } } },
      ]
    : []),
  {
    $set: {
      actorName: '$actorUser.name',
      targetEmail: { $ifNull: ['$targetEmail', '$targetUser.email'] },
      targetName: '$targetUser.name',
      about: {
        $ifNull: [
          { $cond: [{ $ifNull: ['$patientNumber', false] }, { $concat: ['Patient ', '$patientNumber'] }, null] },
          { $cond: [{ $ifNull: ['$details.billNumber', false] }, { $concat: ['Bill ', '$details.billNumber'] }, null] },
          { $cond: [{ $ifNull: ['$details.invoiceNumber', false] }, { $concat: ['Invoice ', '$details.invoiceNumber'] }, null] },
          { $ifNull: ['$targetUser.name', null] },
          '$details.name',
          '$details.medicine',
          '$details.code',
          '$details.section',
        ],
      },
    },
  },
  { $unset: ['actorUser', 'targetUser', 'patientRef', 'patientNumber', 'userAgent'] },
];

// withPatients: name the patient (by number) – a hospital's own log only.
export async function listAuditLogs(q, { withPatients = false } = {}) {
  const match = {};
  if (q.action) match.action = q.action;
  else if (q.category) match.action = { $in: AUDIT_CATEGORIES.find((c) => c.key === q.category).actions.filter((a) => q.everything === 'true' || !ROUTINE_ACTIONS.includes(a)) };
  else if (q.everything !== 'true') match.action = { $nin: ROUTINE_ACTIONS };
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
      ...aboutStages(withPatients),
      ...withId(),
    ],
  });
}

// A short summary of a period: how many changes, failed sign-ins and routine entries, and the changes by group.
export async function auditSummary({ from, hospitalId }) {
  const match = { ...(from && { createdAt: { $gte: from } }), ...(hospitalId && { hospitalId }) };
  const rows = await AuditLog.aggregate([{ $match: match }, { $group: { _id: '$action', count: { $sum: 1 } } }]);
  const count = (pick) => rows.filter((r) => pick(r._id)).reduce((n, r) => n + r.count, 0);
  return {
    changes: count((a) => !ROUTINE_ACTIONS.includes(a) && a !== 'LOGIN_FAILED' && a !== 'LOGIN_RATE_LIMITED'),
    failedLogins: count((a) => a === 'LOGIN_FAILED' || a === 'LOGIN_RATE_LIMITED'),
    routine: count((a) => ROUTINE_ACTIONS.includes(a)),
    byGroup: AUDIT_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: count((a) => c.actions.includes(a) && !ROUTINE_ACTIONS.includes(a)) })).filter((g) => g.count > 0),
  };
}

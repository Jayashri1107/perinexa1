// OPD timings: the doctors of a hospital with a summary of their week, and one doctor's full timings.
import { config } from '../../config/index.js';
import { lookupOne } from '../../core/aggregate.js';
import { HttpError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Membership } from '../members/membership.model.js';
import { User } from '../users/user.model.js';
import { OpdSchedule } from './opdSchedule.model.js';

const { doctorRole, visitTypes } = config.opd;
const DEFAULT_LENGTHS = Object.fromEntries(visitTypes.map((v) => [v.key, v.defaultMinutes]));

const doctorJoin = lookupOne({ from: User.collection.name, localField: 'userId', as: 'doctor', fields: ['name', 'email'] });

// Each doctor's timings in this hospital, summarised: days with sessions, hours a week, leave from today on.
const scheduleSummary = (hospitalId) => [
  {
    $lookup: {
      from: OpdSchedule.collection.name,
      localField: 'userId',
      foreignField: 'doctorId',
      as: 'schedule',
      pipeline: [{ $match: { hospitalId } }],
    },
  },
  { $set: { schedule: { $first: '$schedule' } } },
  {
    $project: {
      _id: 0,
      id: '$_id', // the staff membership (one per doctor here)
      doctor: 1,
      hasTimings: { $gt: ['$schedule', null] },
      daysWithSessions: { $size: { $filter: { input: { $ifNull: ['$schedule.week', []] }, cond: { $gt: [{ $size: '$$this.sessions' }, 0] } } } },
      sessions: { $ifNull: ['$schedule.week', []] },
      upcomingLeave: {
        $size: { $filter: { input: { $ifNull: ['$schedule.leave', []] }, cond: { $gte: ['$$this.to', '$$NOW'] } } },
      },
      updatedAt: '$schedule.updatedAt',
    },
  },
];

export async function listDoctors(hospitalId, q) {
  const hid = toObjectId(hospitalId);
  const match = { hospitalId: hid, isActive: true, roles: doctorRole };
  const text = q.search && containsText(q.search);
  return paginate(Membership, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    preStages: text ? [...doctorJoin, { $match: { $or: [{ 'doctor.name': text }, { 'doctor.email': text }] } }] : [],
    pageStages: [...(text ? [] : doctorJoin), ...scheduleSummary(hid)],
  });
}

// The person must be an active doctor of this hospital.
async function findDoctorOr404(hospitalId, doctorId) {
  const member = await Membership.findOne({ hospitalId, userId: doctorId, isActive: true, roles: doctorRole });
  if (!member) throw new HttpError(404, 'This doctor does not work in this hospital.', 'NOT_FOUND');
  return User.findById(doctorId).select('name email');
}

export async function getSchedule(hospitalId, doctorId) {
  const doctor = await findDoctorOr404(hospitalId, doctorId);
  const schedule = await OpdSchedule.findOne({ hospitalId, doctorId }).populate('updatedBy', 'name').lean();
  return {
    doctor: { id: doctor._id.toString(), name: doctor.name, email: doctor.email },
    week: schedule?.week ?? [],
    lengths: { ...DEFAULT_LENGTHS, ...schedule?.lengths },
    leave: schedule?.leave ?? [],
    updatedAt: schedule?.updatedAt ?? null,
    updatedByName: schedule?.updatedBy?.name ?? null,
  };
}

export async function saveSchedule(req, hospitalId, doctorId, data) {
  const doctor = await findDoctorOr404(hospitalId, doctorId);
  const week = data.week
    .map((d) => ({ day: d.day, sessions: [...d.sessions].sort((a, b) => a.from.localeCompare(b.from)) }))
    .sort((a, b) => a.day - b.day);
  const leave = [...data.leave].sort((a, b) => a.from - b.from);

  await OpdSchedule.findOneAndUpdate(
    { hospitalId, doctorId },
    { $set: { week, lengths: data.lengths, leave, updatedBy: req.user._id } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  await recordAudit(req, 'OPD_TIMINGS_UPDATED', {
    target: doctor,
    hospitalId,
    details: { days: week.filter((d) => d.sessions.length).length, leavePeriods: leave.length },
  });
  return getSchedule(hospitalId, doctorId);
}

// For the hospital overview: active doctors with no timings yet.
export async function doctorsWithoutTimings(hospitalId) {
  const hid = toObjectId(hospitalId);
  const [doctors, withTimings] = await Promise.all([
    Membership.distinct('userId', { hospitalId: hid, isActive: true, roles: doctorRole }),
    OpdSchedule.distinct('doctorId', { hospitalId: hid }),
  ]);
  const has = new Set(withTimings.map(String));
  return { doctors: doctors.length, withoutTimings: doctors.filter((d) => !has.has(String(d))).length };
}

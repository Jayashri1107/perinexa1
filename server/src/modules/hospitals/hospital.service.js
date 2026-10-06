// Hospitals: one aggregate per screen, with departments and staff numbers joined for the rows shown.
import { config } from '../../config/index.js';
import { countsByKey, lookupMany, statusMatch, withId } from '../../core/aggregate.js';
import { fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { MasterData } from '../masterData/masterData.model.js';
import { activeIdsOfType } from '../masterData/masterData.service.js';
import { addMember } from '../members/member.service.js';
import { Membership } from '../members/membership.model.js';
import { findUserByEmail } from '../users/user.service.js';
import { HOSPITAL_SETTINGS_FIELDS, Hospital } from './hospital.model.js';

const departmentType = config.masterData.hospitalDepartmentType;

// Departments by name, and the number of active staff and admins.
const detailStages = [
  ...lookupMany({ from: MasterData.collection.name, localField: 'departments', as: 'departments', fields: ['code', 'name', 'isActive'] }),
  {
    $lookup: {
      from: Membership.collection.name,
      localField: '_id',
      foreignField: 'hospitalId',
      as: 'staffStats',
      pipeline: [
        { $match: { isActive: true } },
        {
          $group: {
            _id: null,
            staff: { $sum: 1 },
            admins: { $sum: { $cond: [{ $in: [config.adminRole, '$roles'] }, 1, 0] } },
          },
        },
      ],
    },
  },
  {
    $set: {
      staffCount: { $ifNull: [{ $first: '$staffStats.staff' }, 0] },
      adminCount: { $ifNull: [{ $first: '$staffStats.admins' }, 0] },
    },
  },
  { $unset: ['staffStats', 'nameKey', ...HOSPITAL_SETTINGS_FIELDS] },
  ...withId(),
];

export async function listHospitals(q) {
  const match = { ...statusMatch(q.status) };
  if (q.departmentId) match.departments = q.departmentId;
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ name: text }, { code: text }, { 'address.city': text }];
  }
  return paginate(Hospital, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: detailStages });
}

// The consolidated view of one hospital: its details, departments, staff numbers and staff per role.
export async function getHospital(id) {
  const hospitalId = toObjectId(id);
  const [[hospital], roleRows] = await Promise.all([
    Hospital.aggregate([{ $match: { _id: hospitalId } }, ...detailStages]),
    Membership.aggregate([
      { $match: { hospitalId, isActive: true } },
      { $unwind: '$roles' },
      { $group: { _id: '$roles', count: { $sum: 1 } } },
    ]),
  ]);
  if (!hospital) throw notFoundError('Hospital');
  const counts = countsByKey(roleRows);
  hospital.staffByRole = config.roles.map((r) => ({ role: r.key, label: r.label, count: counts[r.key] ?? 0 }));
  return hospital;
}

// Active hospitals for drop-downs.
export async function hospitalOptions() {
  const rows = await Hospital.find({ isActive: true }).sort({ name: 1 }).select('name code').lean();
  return rows.map((r) => ({ id: r._id.toString(), code: r.code, name: r.name }));
}

async function findHospitalOr404(id) {
  const hospital = await Hospital.findById(id);
  if (!hospital) throw notFoundError('Hospital');
  return hospital;
}

// Departments must exist in master data, be active and be of the department list.
async function checkDepartments(ids) {
  const unique = [...new Set(ids)];
  const valid = await activeIdsOfType(departmentType, unique);
  if (valid.size !== unique.length) throw fieldError('departments', 'One or more departments are not available.');
  return unique;
}

export async function createHospital(req, { firstAdmin, ...data }) {
  data.departments = await checkDepartments(data.departments);
  // Checked before anything is saved, so a refused admin never leaves a hospital without one.
  if (firstAdmin && (await findUserByEmail(firstAdmin.email))?.isSuperAdmin) {
    throw fieldError('firstAdmin.email', 'A super admin cannot be a hospital admin. Use a separate account.', 'SUPER_ADMIN');
  }
  const hospital = await Hospital.create({ ...data, createdBy: req.user._id });
  await recordAudit(req, 'HOSPITAL_CREATED', { hospitalId: hospital._id, details: { name: hospital.name, code: hospital.code } });

  let admin = null;
  if (firstAdmin) {
    const { temporaryPassword, existingUser } = await addMember(req, hospital._id, { ...firstAdmin, roles: [config.adminRole] });
    admin = { email: firstAdmin.email, temporaryPassword, existingUser };
  }
  return { hospital: await getHospital(hospital._id), admin };
}

export async function updateHospital(req, id, data) {
  const hospital = await findHospitalOr404(id);
  data.departments = await checkDepartments(data.departments);
  hospital.set(data);
  await hospital.save();
  await recordAudit(req, 'HOSPITAL_UPDATED', { hospitalId: hospital._id, details: { name: hospital.name } });
  return getHospital(id);
}

export async function setHospitalStatus(req, id, isActive) {
  const hospital = await findHospitalOr404(id);
  if (hospital.isActive !== isActive) {
    hospital.isActive = isActive;
    await hospital.save();
    await recordAudit(req, isActive ? 'HOSPITAL_ACTIVATED' : 'HOSPITAL_DEACTIVATED', { hospitalId: hospital._id, details: { name: hospital.name } });
  }
  return getHospital(id);
}

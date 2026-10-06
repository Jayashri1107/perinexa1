// Accounts: list (one aggregate with each person's hospitals and roles), read, create, update, status, reset.
import { lookupOne, withId } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { generateTemporaryPassword, hashPassword } from '../../core/password.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { Membership } from '../members/membership.model.js';
import { HIDDEN_USER_FIELDS, User } from './user.model.js';

const STATUS_MATCH = {
  active: { isActive: true },
  inactive: { isActive: false },
  pending: { isActive: true, mustChangePassword: true },
};

// Each person's hospitals and roles, joined for the rows on the page only.
const membershipStages = [
  {
    $lookup: {
      from: Membership.collection.name,
      localField: '_id',
      foreignField: 'userId',
      as: 'memberships',
      pipeline: [
        ...lookupOne({ from: Hospital.collection.name, localField: 'hospitalId', as: 'hospital', fields: ['name', 'code', 'isActive'] }),
        { $project: { _id: 0, id: '$_id', roles: 1, isActive: 1, hospital: 1 } },
      ],
    },
  },
  { $project: HIDDEN_USER_FIELDS },
  ...withId(),
];

export async function listUsers(q) {
  const match = { ...(q.status && STATUS_MATCH[q.status]) };
  if (q.kind) match.isSuperAdmin = q.kind === 'superAdmin';
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ name: text }, { email: text }];
  }
  if (q.hospitalId) match._id = { $in: await Membership.distinct('userId', { hospitalId: q.hospitalId }) };

  return paginate(User, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: membershipStages });
}

export async function getUser(id) {
  const [user] = await User.aggregate([{ $match: { _id: toObjectId(id) } }, ...membershipStages]);
  if (!user) throw notFoundError('User');
  return user;
}

export async function findUserOr404(id) {
  const user = await User.findById(id);
  if (!user) throw notFoundError('User');
  return user;
}

export const findUserByEmail = (email) => User.findOne({ email });

// Creates a login with a temporary password, shown once to the person who created it.
export async function createAccount(req, { name, email, isSuperAdmin = false, hospitalId = null }) {
  if (isSuperAdmin) assertCanCreateSuperAdmin(req);
  if (await findUserByEmail(email)) throw fieldError('email', 'A user with this email already exists.', 'DUPLICATE');
  const temporaryPassword = generateTemporaryPassword();
  const user = await User.create({
    name,
    email,
    isSuperAdmin,
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
    createdBy: req.user?._id ?? null,
  });
  await recordAudit(req, 'USER_CREATED', { target: user, hospitalId, details: { name, isSuperAdmin } });
  return { user, temporaryPassword };
}

export async function updateUser(req, id, data) {
  const user = await findUserOr404(id);
  assertCanManage(req, user);
  const changed = [];
  if (user.name !== data.name) changed.push('name');
  if (user.email !== data.email) {
    const taken = await User.exists({ email: data.email, _id: { $ne: user._id } });
    if (taken) throw fieldError('email', 'A user with this email already exists.', 'DUPLICATE');
    changed.push('email');
    user.tokenVersion += 1; // a new login name: they sign in again with it
  }
  if (!changed.length) return getUser(id);
  user.name = data.name;
  user.email = data.email;
  await user.save();
  await recordAudit(req, 'USER_UPDATED', { target: user, details: { changed } });
  return getUser(id);
}

const isSelf = (req, user) => req.user._id.equals(user._id);

// Who may change whose account:
// - nobody else may change the main super admin's account;
// - only the main super admin may change other super admin accounts;
// - any super admin may change hospital staff accounts.
function assertCanManage(req, user) {
  if (isSelf(req, user)) return;
  if (user.isPrimary) {
    throw new HttpError(403, 'The main super admin account is protected. Only its owner can change it.', 'PROTECTED_ACCOUNT');
  }
  if (user.isSuperAdmin && !req.user.isPrimary) {
    throw new HttpError(403, 'Only the main super admin can change super admin accounts.', 'PRIMARY_ONLY');
  }
}

// Only the main super admin may create another super admin.
export function assertCanCreateSuperAdmin(req) {
  if (!req.user.isPrimary) {
    throw new HttpError(403, 'Only the main super admin can create super admin accounts.', 'PRIMARY_ONLY');
  }
}

// There must always be at least one active super admin who can manage the platform.
async function assertAnotherSuperAdmin(user) {
  const others = await User.countDocuments({ _id: { $ne: user._id }, isSuperAdmin: true, isActive: true });
  if (others === 0) throw new HttpError(400, 'There must always be at least one active super admin.', 'LAST_SUPER_ADMIN');
}

// Deactivate instead of delete: the history stays, and the person is signed out at once.
export async function setUserStatus(req, id, isActive) {
  const user = await findUserOr404(id);
  if (isSelf(req, user)) throw new HttpError(400, 'You cannot change the status of your own account.', 'SELF_ACTION');
  assertCanManage(req, user);
  if (user.isActive === isActive) return getUser(id);
  if (!isActive && user.isSuperAdmin) await assertAnotherSuperAdmin(user);

  user.isActive = isActive;
  if (!isActive) user.tokenVersion += 1;
  await user.save();
  await recordAudit(req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', { target: user });
  return getUser(id);
}

// A new temporary password, shown once; the person is signed out everywhere and must choose a new one.
export async function resetPassword(req, id) {
  const user = await findUserOr404(id);
  if (isSelf(req, user)) {
    throw new HttpError(400, 'To change your own password, use "Change password" instead.', 'SELF_ACTION');
  }
  assertCanManage(req, user);
  const temporaryPassword = await issueTemporaryPassword(req, user);
  return { user: await getUser(id), temporaryPassword };
}

// Gives the person a new temporary password and signs them out everywhere. Used by the super admin's Users page and
// the hospital admin's Staff page (hospitalId: where it was done, for the audit log).
export async function issueTemporaryPassword(req, user, hospitalId = null) {
  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tokenVersion += 1;
  await user.save();
  await recordAudit(req, 'PASSWORD_RESET', { target: user, hospitalId });
  return temporaryPassword;
}

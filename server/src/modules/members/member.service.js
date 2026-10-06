// Hospital staff: who works in a hospital and with which roles.
import { config } from '../../config/index.js';
import { lookupOne, statusMatch, withId } from '../../core/aggregate.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { User } from '../users/user.model.js';
import { createAccount, findUserByEmail, issueTemporaryPassword } from '../users/user.service.js';
import { Membership } from './membership.model.js';

const userJoin = lookupOne({
  from: User.collection.name,
  localField: 'userId',
  as: 'user',
  fields: ['name', 'email', 'isActive', 'mustChangePassword', 'lastLoginAt', 'professional'],
});

// The person's active access to an active hospital, or null.
export async function findActiveMembership(userId, hospitalId) {
  const membership = await Membership.findOne({ userId, hospitalId, isActive: true });
  if (!membership) return null;
  const hospital = await Hospital.findOne({ _id: hospitalId, isActive: true });
  return hospital ? { membership, hospital } : null;
}

// The super admin working inside a hospital (owner's decision, config.access.superAdminInHospitals): every role there,
// or only the admin role when config.access.superAdminPatientAccess is off. Every patient record opened is audited.
export const superAdminRoles = () => (config.access.superAdminPatientAccess ? config.roles.map((r) => r.key) : [config.adminRole]);

export async function superAdminAccess(hospitalId) {
  if (!config.access.superAdminInHospitals) return null;
  const hospital = await Hospital.findOne({ _id: hospitalId, isActive: true });
  return hospital ? { hospital, membership: { roles: superAdminRoles(), isSuperAdminAccess: true } } : null;
}

// For the super admin's hospital switcher: every active hospital, shaped like a membership.
export async function superAdminMemberships() {
  if (!config.access.superAdminInHospitals) return [];
  const hospitals = await Hospital.find({ isActive: true }).sort({ name: 1 }).select('name code isActive').lean();
  const roles = superAdminRoles();
  return hospitals.map((h) => ({ id: h._id, roles, hospital: { id: h._id, name: h.name, code: h.code, isActive: h.isActive } }));
}

// Nobody changes their own access: an admin cannot lock themselves out or give themselves roles.
function assertNotSelf(req, member) {
  if (member.userId.equals(req.user._id)) {
    throw new HttpError(400, 'You cannot change your own access. Ask another admin.', 'SELF_ACTION');
  }
}

async function findHospitalOr404(hospitalId) {
  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw notFoundError('Hospital');
  return hospital;
}

async function findMemberOr404(hospitalId, memberId) {
  const member = await Membership.findOne({ _id: memberId, hospitalId });
  if (!member) throw notFoundError('Staff member');
  return member;
}

export async function getMember(hospitalId, memberId) {
  const [member] = await Membership.aggregate([
    { $match: { _id: toObjectId(memberId), hospitalId: toObjectId(hospitalId) } },
    ...userJoin,
    ...withId(),
  ]);
  if (!member) throw notFoundError('Staff member');
  return member;
}

export async function listMembers(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId), ...statusMatch(q.status) };
  if (q.role) match.roles = q.role;

  // Searching by name or email needs the person first; without a search the join runs for the page only.
  const searching = Boolean(q.search);
  const text = searching && containsText(q.search);
  return paginate(Membership, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    preStages: searching ? [...userJoin, { $match: { $or: [{ 'user.name': text }, { 'user.email': text }] } }] : [],
    pageStages: [...(searching ? [] : userJoin), ...withId()],
  });
}

// The hospitals a person works in (for their own session).
export function listUserMemberships(userId) {
  return Membership.aggregate([
    { $match: { userId: toObjectId(userId), isActive: true } },
    ...lookupOne({ from: Hospital.collection.name, localField: 'hospitalId', as: 'hospital', fields: ['name', 'code', 'isActive'] }),
    { $match: { 'hospital.isActive': true } },
    { $project: { _id: 0, id: '$_id', roles: 1, hospital: 1 } },
  ]);
}

// Adds a person to a hospital. A new email gets an account with a temporary password; an existing person
// simply gains access to this hospital too (same login, no new password).
export async function addMember(req, hospitalId, { name, email, roles }) {
  const hospital = await findHospitalOr404(hospitalId);
  if (!hospital.isActive) throw new HttpError(400, 'This hospital is deactivated. Activate it first.', 'HOSPITAL_INACTIVE');

  let user = await findUserByEmail(email);
  let temporaryPassword = null;
  if (user) {
    if (user.isSuperAdmin) {
      throw fieldError('email', 'A super admin cannot be added to a hospital. Use a separate account.', 'SUPER_ADMIN');
    }
    const existing = await Membership.findOne({ hospitalId: hospital._id, userId: user._id });
    if (existing) {
      const message = existing.isActive
        ? 'This person is already a member of this hospital.'
        : 'This person is already a member of this hospital but deactivated. Activate them instead.';
      throw new HttpError(409, message, 'ALREADY_MEMBER', { email: message });
    }
  } else {
    if (!name) throw fieldError('name', 'Name is required for a new person.');
    ({ user, temporaryPassword } = await createAccount(req, { name, email, hospitalId: hospital._id }));
  }

  const member = await Membership.create({ hospitalId: hospital._id, userId: user._id, roles, createdBy: req.user._id });
  await recordAudit(req, 'MEMBER_ADDED', { target: user, hospitalId: hospital._id, details: { roles } });
  return { member, temporaryPassword, existingUser: !temporaryPassword };
}

// A hospital must always keep at least one active admin.
async function assertAnotherAdmin(member) {
  const others = await Membership.countDocuments({
    hospitalId: member.hospitalId,
    _id: { $ne: member._id },
    isActive: true,
    roles: config.adminRole,
  });
  if (others === 0) throw new HttpError(400, 'This hospital must always have at least one active admin.', 'LAST_ADMIN');
}

const isAdmin = (roles) => roles.includes(config.adminRole);

export async function updateRoles(req, hospitalId, memberId, roles) {
  const member = await findMemberOr404(hospitalId, memberId);
  assertNotSelf(req, member);
  const before = [...member.roles];
  if (member.isActive && isAdmin(before) && !isAdmin(roles)) await assertAnotherAdmin(member);

  member.roles = roles;
  await member.save();
  await recordAudit(req, 'MEMBER_ROLES_CHANGED', { target: { _id: member.userId }, hospitalId: member.hospitalId, details: { from: before, to: roles } });
  return getMember(hospitalId, memberId);
}

export async function setMemberStatus(req, hospitalId, memberId, isActive) {
  const member = await findMemberOr404(hospitalId, memberId);
  assertNotSelf(req, member);
  if (member.isActive === isActive) return getMember(hospitalId, memberId);
  if (!isActive && isAdmin(member.roles)) await assertAnotherAdmin(member);

  member.isActive = isActive;
  await member.save();
  await recordAudit(req, isActive ? 'MEMBER_ACTIVATED' : 'MEMBER_DEACTIVATED', { target: { _id: member.userId }, hospitalId: member.hospitalId });
  return getMember(hospitalId, memberId);
}

// A hospital admin resets the password of someone working in their hospital (never their own – that is
// "Change password"). The person gets a temporary password and is signed out everywhere.
export async function resetMemberPassword(req, hospitalId, memberId) {
  const member = await findMemberOr404(hospitalId, memberId);
  assertNotSelf(req, member);
  const user = await User.findById(member.userId);
  if (!user) throw notFoundError('Staff member');
  if (user.isSuperAdmin) throw new HttpError(403, 'You do not have permission to do this.', 'FORBIDDEN');
  const temporaryPassword = await issueTemporaryPassword(req, user, member.hospitalId);
  return { email: user.email, temporaryPassword };
}

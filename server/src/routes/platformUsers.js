import { Router } from 'express';
import { z } from 'zod';
import { Membership, TENANT_ROLES } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { PLATFORM_AREAS, User, canEditPlatform, isPlatformUser } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, idParams, objectId, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';
import { generateTemporaryPassword, hashPassword } from '../utils/password.js';
import { capitalizeName } from '../utils/personName.js';

const name = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long').transform(capitalizeName);
const email = z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address').max(254));

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  // "pending" = active accounts that haven't chosen their own password yet.
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  type: z.enum(['superadmin', 'platformadmin', 'member']).optional(),
  // Staff by role: people with this role (and / or working at this hospital) – an active place at an active hospital
  role: z.enum(TENANT_ROLES).optional(),
  tenantId: objectId.optional(),
  sort: sortParam(['name', 'email', 'createdAt', 'lastLoginAt'], '-createdAt'),
  ...pageParams,
});
// A new account (as in the earlier Perinexa1): hospital staff are made with their hospital and roles in one step;
// a super admin or a platform admin (view only to start) only by a super admin.
const createSchema = z
  .object({
    name,
    email,
    isSuperAdmin: z.boolean().default(false),
    accountType: z.enum(['staff', 'superAdmin', 'platformAdmin']).optional(),
    tenantId: objectId.optional(),
    roles: z.array(z.enum(TENANT_ROLES)).max(TENANT_ROLES.length).optional(),
  })
  .transform((d) => ({ ...d, accountType: d.accountType ?? (d.isSuperAdmin ? 'superAdmin' : 'staff') }))
  .refine((d) => d.accountType !== 'staff' || !d.tenantId || d.roles?.length, { path: ['roles'], message: 'Choose at least one role' });
const professional = z.object({
  qualification: z.string().trim().max(150).default(''),
  registrationNumber: z.string().trim().max(60).default(''),
  council: z.string().trim().max(120).default(''),
});
const updateSchema = z
  .object({ name: name.optional(), email: email.optional(), professional: professional.optional() })
  .refine((d) => d.name !== undefined || d.email !== undefined || d.professional !== undefined, 'Nothing to update');

// Every hospital each user is tagged to (including deactivated memberships), with hospital names.
async function hospitalsFor(userIds) {
  const memberships = await Membership.find({ userId: { $in: userIds } }).lean();
  const tenants = await Tenant.find({ _id: { $in: memberships.map((m) => m.tenantId) } }).lean();
  const tenantById = new Map(tenants.map((t) => [t._id.toString(), t]));
  const byUser = new Map();
  for (const m of memberships) {
    const t = tenantById.get(m.tenantId.toString());
    if (!t) continue;
    const list = byUser.get(m.userId.toString()) ?? [];
    list.push({
      memberId: m._id.toString(),
      tenantId: t._id.toString(),
      tenantName: t.name,
      tenantActive: t.isActive,
      roles: m.roles,
      isActive: m.isActive,
    });
    byUser.set(m.userId.toString(), list);
  }
  for (const list of byUser.values()) list.sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  return byUser;
}

async function findUserOr404(id) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.', 'NOT_FOUND');
  return user;
}

// There must always be at least one active super admin who can manage the platform.
async function assertAnotherSuperAdmin(user) {
  const others = await User.countDocuments({ _id: { $ne: user._id }, isSuperAdmin: true, isActive: true });
  if (others === 0) throw new HttpError(400, 'There must always be at least one active super admin.', 'LAST_SUPER_ADMIN');
}

const isSelf = (req, user) => req.user._id.equals(user._id);

// The people with an active place (with this role, at this hospital) at a hospital that is active.
async function staffIds({ role, tenantId } = {}) {
  const tenants = await Tenant.find(tenantId ? { _id: tenantId, isActive: true } : { isActive: true }, { _id: 1 }).lean();
  const match = { isActive: true, tenantId: { $in: tenants.map((t) => t._id) }, ...(role ? { roles: role } : {}) };
  return Membership.distinct('userId', match);
}

// Platform admins may be given "users" (to manage hospital staff accounts), but never power over the platform's own
// accounts: only a super admin creates, changes, deactivates or resets a super admin or a platform admin, and only a
// super admin hands out those rights.
function assertSuperAdmin(req) {
  if (!req.user.isSuperAdmin) throw new HttpError(403, 'Only a super admin can do this.', 'SUPER_ADMIN_ONLY');
}
async function assertMayChange(req, user) {
  if (isPlatformUser(user)) assertSuperAdmin(req);
  // A hospital admin's account: a platform admin also needs "Hospital admins' access"
  if (req.user.isPlatformAdmin && !canEditPlatform(req.user, 'hospitalAdmins') && (await Membership.exists({ userId: user._id, roles: 'admin' }))) {
    throw new HttpError(403, "Changing a hospital admin's access needs the super admin's permission (Hospital admins' access).", 'HOSPITAL_ADMIN_RIGHT');
  }
}

export const platformUsersRouter = Router();

platformUsersRouter.get('/', async (req, res) => {
  const q = parse(listSchema, req.query);
  const filter = {};
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  if (q.status === 'pending') Object.assign(filter, { isActive: true, mustChangePassword: true });
  else if (q.status) filter.isActive = q.status === 'active';
  if (q.type === 'superadmin') filter.isSuperAdmin = true;
  else if (q.type === 'platformadmin') filter.isPlatformAdmin = true;
  else if (q.type === 'member') Object.assign(filter, { isSuperAdmin: false, isPlatformAdmin: { $ne: true } });
  if (q.role || q.tenantId) filter._id = { $in: await staffIds({ role: q.role, tenantId: q.tenantId }) };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort(toMongoSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    User.countDocuments(filter),
  ]);
  const hospitals = await hospitalsFor(users.map((u) => u._id));
  res.json({
    users: users.map((u) => ({ ...u.toJSON(), hospitals: hospitals.get(u._id.toString()) ?? [] })),
    ...paged(q, total),
  });
});

platformUsersRouter.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  if (data.accountType !== 'staff') assertSuperAdmin(req);
  // Staff with a hospital: check the hospital and the rights first, so nothing is made half-way
  let tenant = null;
  const roles = data.accountType === 'staff' && data.tenantId ? TENANT_ROLES.filter((r) => data.roles.includes(r)) : [];
  if (roles.length) {
    tenant = await Tenant.findOne({ _id: data.tenantId, isActive: true });
    if (!tenant) throw new HttpError(404, 'This hospital does not exist or is deactivated.', 'NOT_FOUND');
    if (roles.includes('admin') && req.user.isPlatformAdmin && !canEditPlatform(req.user, 'hospitalAdmins')) {
      throw new HttpError(403, "Making a hospital admin needs the super admin's permission (Hospital admins' access).", 'HOSPITAL_ADMIN_RIGHT');
    }
  }
  if (await User.exists({ email: data.email })) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
  const temporaryPassword = generateTemporaryPassword();
  const user = await User.create({
    name: data.name,
    email: data.email,
    isSuperAdmin: data.accountType === 'superAdmin',
    isPlatformAdmin: data.accountType === 'platformAdmin',
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
  });
  await audit(req, 'USER_CREATED', { target: user, details: { name: user.name, superAdmin: user.isSuperAdmin, platformAdmin: user.isPlatformAdmin } });
  if (tenant) {
    await Membership.create({ tenantId: tenant._id, userId: user._id, roles, createdBy: req.user._id });
    await audit(req, 'MEMBER_ADDED', { target: user, tenantId: tenant._id, details: { roles } });
  }
  const hospitals = await hospitalsFor([user._id]);
  // The temporary password is shown once and is never stored in readable form.
  res.status(201).json({ user: { ...user.toJSON(), hospitals: hospitals.get(user._id.toString()) ?? [] }, temporaryPassword });
});

// Staff by role (the platform's "Staff by role" page): how many people have each role across active hospitals –
// or at one hospital – counted once per person (someone at two hospitals as a doctor is one doctor).
// Every hospital admin (active place at an active hospital) with the rights the super admin gave them
platformUsersRouter.get('/hospital-admins', async (_req, res) => {
  const tenants = await Tenant.find({ isActive: true }, { name: 1 }).lean();
  const names = new Map(tenants.map((t) => [String(t._id), t.name]));
  const places = await Membership.find({ tenantId: { $in: tenants.map((t) => t._id) }, roles: 'admin', isActive: true }).populate('userId').lean();
  res.json({
    admins: places
      .filter((m) => m.userId)
      .map((m) => ({
        memberId: String(m._id),
        tenantId: String(m.tenantId),
        tenantName: names.get(String(m.tenantId)),
        roles: m.roles,
        adminRights: m.adminRights ?? [],
        user: { id: String(m.userId._id), name: m.userId.name, email: m.userId.email, isActive: m.userId.isActive },
      }))
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.user.name.localeCompare(b.user.name)),
  });
});

platformUsersRouter.get('/role-counts', async (req, res) => {
  const { tenantId } = parse(z.object({ tenantId: objectId.optional() }), req.query);
  const counts = {};
  for (const role of TENANT_ROLES) counts[role] = (await staffIds({ role, tenantId })).length;
  res.json({ counts, people: (await staffIds({ tenantId })).length });
});

platformUsersRouter.get('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const user = await findUserOr404(id);
  const hospitals = await hospitalsFor([user._id]);
  res.json({ user: { ...user.toJSON(), hospitals: hospitals.get(user._id.toString()) ?? [] } });
});

platformUsersRouter.patch('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const data = parse(updateSchema, req.body);
  const user = await findUserOr404(id);
  await assertMayChange(req, user);

  const changes = {};
  for (const key of ['name', 'email']) {
    if (data[key] !== undefined && data[key] !== user[key]) {
      changes[key] = { from: user[key], to: data[key] };
      user[key] = data[key];
    }
  }
  if (data.professional) {
    const before = user.professional?.toObject?.() ?? {};
    for (const [k, v] of Object.entries(data.professional)) {
      if ((before[k] ?? '') !== v) changes[`professional.${k}`] = { from: before[k] ?? '', to: v };
    }
    user.professional = data.professional;
  }
  if (Object.keys(changes).length) {
    await user.save();
    await audit(req, 'USER_UPDATED', { target: user, details: { changes } });
  }
  res.json({ user });
});

// Deactivating an account blocks the person everywhere (all hospitals). Nothing is deleted.
platformUsersRouter.patch('/:id/status', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const { isActive } = parse(z.object({ isActive: z.boolean('isActive must be true or false') }), req.body);
  const user = await findUserOr404(id);
  await assertMayChange(req, user);

  if (isSelf(req, user)) throw new HttpError(400, "You can't deactivate or reactivate your own account.", 'SELF_ACTION');
  if (user.isActive === isActive) return res.json({ user });
  if (!isActive && user.isSuperAdmin) await assertAnotherSuperAdmin(user);

  user.isActive = isActive;
  if (!isActive) user.tokenVersion += 1; // signs them out immediately
  await user.save();
  await audit(req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', { target: user });
  res.json({ user });
});

platformUsersRouter.patch('/:id/super-admin', async (req, res) => {
  const { id } = parse(idParams, req.params);
  assertSuperAdmin(req);
  const { isSuperAdmin } = parse(z.object({ isSuperAdmin: z.boolean('isSuperAdmin must be true or false') }), req.body);
  const user = await findUserOr404(id);

  if (isSelf(req, user)) throw new HttpError(400, "You can't change your own super admin status.", 'SELF_ACTION');
  if (user.isSuperAdmin === isSuperAdmin) return res.json({ user });
  if (isSuperAdmin && (await Membership.exists({ userId: user._id }))) {
    throw new HttpError(
      400,
      'This person is tagged to one or more hospitals. Super admins must use a separate account with no hospital access.',
      'HAS_MEMBERSHIPS',
    );
  }
  if (!isSuperAdmin && user.isActive) await assertAnotherSuperAdmin(user);

  user.isSuperAdmin = isSuperAdmin;
  if (isSuperAdmin) Object.assign(user, { isPlatformAdmin: false, platformPermissions: [] }); // a super admin has every right
  user.tokenVersion += 1; // their permissions changed: start a fresh session
  await user.save();
  await audit(req, isSuperAdmin ? 'SUPER_ADMIN_GRANTED' : 'SUPER_ADMIN_REVOKED', { target: user });
  res.json({ user });
});

platformUsersRouter.post('/:id/reset-password', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const user = await findUserOr404(id);
  await assertMayChange(req, user);
  if (isSelf(req, user)) {
    throw new HttpError(400, 'To change your own password, use "Change password" instead.', 'SELF_ACTION');
  }

  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tokenVersion += 1; // signs them out everywhere
  await user.save();
  await audit(req, 'PASSWORD_RESET', { target: user });
  res.json({ user, temporaryPassword });
});

// A platform admin (super admins only): sees what a super admin sees, view only, and may change the ticked areas.
// Like a super admin, a platform admin is never a member of a hospital.
const platformAdminSchema = z.object({
  isPlatformAdmin: z.boolean('isPlatformAdmin must be true or false'),
  permissions: z.array(z.enum(PLATFORM_AREAS)).max(PLATFORM_AREAS.length).default([]),
});
platformUsersRouter.patch('/:id/platform-admin', async (req, res) => {
  assertSuperAdmin(req);
  const { id } = parse(idParams, req.params);
  const { isPlatformAdmin, permissions } = parse(platformAdminSchema, req.body);
  const user = await findUserOr404(id);
  if (isSelf(req, user)) throw new HttpError(400, "You can't change your own platform rights.", 'SELF_ACTION');
  if (user.isSuperAdmin) throw new HttpError(400, 'A super admin already has every right. Remove super admin first.', 'IS_SUPER_ADMIN');
  if (isPlatformAdmin && !user.isPlatformAdmin && (await Membership.exists({ userId: user._id }))) {
    throw new HttpError(
      400,
      'This person is tagged to one or more hospitals. Platform admins must use a separate account with no hospital access.',
      'HAS_MEMBERSHIPS',
    );
  }
  const nextPermissions = isPlatformAdmin ? [...new Set(permissions)].sort() : [];
  const before = { isPlatformAdmin: Boolean(user.isPlatformAdmin), permissions: [...(user.platformPermissions ?? [])].sort() };
  if (before.isPlatformAdmin === isPlatformAdmin && before.permissions.join() === nextPermissions.join()) return res.json({ user });
  user.isPlatformAdmin = isPlatformAdmin;
  user.platformPermissions = nextPermissions;
  if (!isPlatformAdmin) user.linkedAccountId = null;
  user.tokenVersion += 1; // their permissions changed: start a fresh session
  await user.save();
  await audit(req, 'PLATFORM_ADMIN_CHANGED', { target: user, details: { from: before, to: { isPlatformAdmin, permissions: nextPermissions } } });
  res.json({ user });
});

// "Switch to your doctor account" (super admins only set it): a super admin's or platform admin's own hospital account,
// by its email. The switch signs the person out and opens the sign-in with this email – the password is still asked.
const linkSchema = z.object({ email: email.nullable() });
platformUsersRouter.patch('/:id/linked-account', async (req, res) => {
  assertSuperAdmin(req);
  const { id } = parse(idParams, req.params);
  const { email: linkedEmail } = parse(linkSchema, req.body);
  const user = await findUserOr404(id);
  if (!isPlatformUser(user)) throw new HttpError(400, 'Only a super admin or a platform admin can have a linked hospital account.', 'NOT_PLATFORM');
  let linked = null;
  if (linkedEmail) {
    linked = await User.findOne({ email: linkedEmail });
    if (!linked) throw new HttpError(404, 'No account with this email.', 'NOT_FOUND');
    if (linked._id.equals(user._id) || isPlatformUser(linked)) {
      throw new HttpError(400, "Choose the person's hospital account (a doctor, say) – not a super admin or platform admin account.", 'NOT_HOSPITAL_ACCOUNT');
    }
  }
  const from = user.linkedAccountId ? String(user.linkedAccountId) : null;
  const to = linked ? String(linked._id) : null;
  if (from === to) return res.json({ user });
  user.linkedAccountId = linked?._id ?? null;
  await user.save();
  await audit(req, 'LINKED_ACCOUNT_CHANGED', { target: user, details: { linked: Boolean(linked), linkedEmail: linked?.email ?? null } });
  res.json({ user });
});

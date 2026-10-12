import { Router } from 'express';
import { z } from 'zod';
import { Membership } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, idParams, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';
import { generateTemporaryPassword, hashPassword } from '../utils/password.js';

const name = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
const email = z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address').max(254));

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  // "pending" = active accounts that haven't chosen their own password yet.
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  type: z.enum(['superadmin', 'member']).optional(),
  sort: sortParam(['name', 'email', 'createdAt', 'lastLoginAt'], '-createdAt'),
  ...pageParams,
});
const createSchema = z.object({ name, email, isSuperAdmin: z.boolean().default(false) });
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
  if (q.type) filter.isSuperAdmin = q.type === 'superadmin';

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
  const temporaryPassword = generateTemporaryPassword();
  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
  });
  await audit(req, 'USER_CREATED', { target: user, details: { name: user.name, superAdmin: user.isSuperAdmin } });
  // The temporary password is shown once and is never stored in readable form.
  res.status(201).json({ user: { ...user.toJSON(), hospitals: [] }, temporaryPassword });
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
  user.tokenVersion += 1; // their permissions changed: start a fresh session
  await user.save();
  await audit(req, isSuperAdmin ? 'SUPER_ADMIN_GRANTED' : 'SUPER_ADMIN_REVOKED', { target: user });
  res.json({ user });
});

platformUsersRouter.post('/:id/reset-password', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const user = await findUserOr404(id);
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

import { Router } from 'express';
import { z } from 'zod';
import { ADMIN_RIGHTS, DEPARTMENTS, Membership, TENANT_ROLES, departmentsOf } from '../models/Membership.js';
import { User, canEditPlatform, isPlatformUser } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';
import { generateTemporaryPassword, hashPassword } from '../utils/password.js';
import { capitalizeName } from '../utils/personName.js';

const role = z.enum(TENANT_ROLES, `Role must be one of: ${TENANT_ROLES.join(', ')}`);
const roles = z
  .array(role, 'Choose at least one role')
  .min(1, 'Choose at least one role')
  .max(TENANT_ROLES.length)
  .transform((list) => TENANT_ROLES.filter((r) => list.includes(r)));
const email = z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address').max(254));
const name = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long').transform(capitalizeName);

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  role: role.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const addSchema = z.object({ email, name: z.string().trim().max(100).transform(capitalizeName).optional(), roles });
const editSchema = z
  .object({ name: name.optional(), email: email.optional() })
  .refine((d) => d.name !== undefined || d.email !== undefined, 'Nothing to update');
const memberParams = z.object({ memberId: objectId });

// Turns a membership (with its user loaded) into what the website shows.
const toMember = (m, sharedUserIds = new Set()) => ({
  id: m._id.toString(),
  roles: m.roles,
  isActive: m.isActive,
  adminRights: m.roles.includes('admin') ? [...(m.adminRights ?? [])] : [],
  department: m.roles.includes('doctor') ? (departmentsOf(m)[0] ?? '') : '',
  departments: m.roles.includes('doctor') ? departmentsOf(m) : [],
  createdAt: m.createdAt,
  user: m.userId.toJSON(),
  // Also works in another hospital: only a super admin may change their name, email or password.
  sharedAccount: sharedUserIds.has(m.userId._id.toString()),
});

async function otherTenantUserIds(tenantId, userIds) {
  const ids = await Membership.distinct('userId', { userId: { $in: userIds }, tenantId: { $ne: tenantId } });
  return new Set(ids.map(String));
}

/**
 * Manage the people tagged to ONE hospital.
 * - resolveTenantId(req): which hospital (from the session for hospital admins, from the URL for super admins)
 * - allowAccountChanges: hospital admins may reset passwords / edit details only for people who work
 *   nowhere else (so one hospital can't lock someone out of another).
 */
export function membersRouter({ resolveTenantId, allowAccountChanges = false }) {
  const router = Router({ mergeParams: true });

  router.use(async (req, _res, next) => {
    req.scopeTenantId = await resolveTenantId(req);
    next();
  });

  // Every membership lookup includes the hospital id, so ids from other hospitals simply aren't found.
  async function findMember(req) {
    const { memberId } = parse(memberParams, req.params);
    const m = await Membership.findOne({ _id: memberId, tenantId: req.scopeTenantId }).populate('userId');
    if (!m || !m.userId) throw new HttpError(404, 'Member not found.', 'NOT_FOUND');
    return m;
  }

  const isSelf = (req, m) => req.user._id.equals(m.userId._id);

  // A hospital's own admin changes its staff only as far as the super admin allowed (owner, 12 Oct 2026). Super admins
  // and platform admins have their own rights (platform permissions).
  const RIGHT_WORDS = { addPeople: 'add people', resetPassword: 'reset passwords', access: "remove or restore someone's access", roles: 'change roles', details: 'edit names and emails' };

  // Only the super admin (or a platform admin given "Hospital admins' access") makes someone a hospital admin, or takes
  // it away (22 Oct 2026): a hospital's own admin – even with "Add people" or "Change roles" – never creates admins.
  function assertNotAdminRole(req, ...roleLists) {
    if (isPlatformUser(req.user)) return;
    if (roleLists.some((list) => list?.includes('admin'))) {
      throw new HttpError(403, 'Only the super admin makes someone a hospital admin, or takes it away.', 'ADMIN_ROLE_SUPER_ADMIN_ONLY');
    }
  }
  function assertAdminRight(req, right) {
    if (isPlatformUser(req.user)) return;
    if (!req.membership?.adminRights?.includes(right)) {
      throw new HttpError(403, `You need the super admin's permission to ${RIGHT_WORDS[right]}. Ask the super admin.`, 'NEEDS_PERMISSION');
    }
  }

  // A platform admin changes a hospital admin's access (adding one, their roles, deactivating, their details or
  // password) only when a super admin gave them "Hospital admins' access" (owner's request, 12 Oct 2026).
  function assertHospitalAdminRight(req, ...roleLists) {
    if (!req.user.isPlatformAdmin || canEditPlatform(req.user, 'hospitalAdmins')) return;
    if (roleLists.some((list) => list?.includes('admin'))) {
      throw new HttpError(403, "Changing a hospital admin's access needs the super admin's permission (Hospital admins' access).", 'HOSPITAL_ADMIN_RIGHT');
    }
  }

  // A hospital must always keep at least one active admin.
  async function assertAnotherActiveAdmin(req, m) {
    const others = await Membership.countDocuments({
      tenantId: req.scopeTenantId,
      roles: 'admin',
      isActive: true,
      _id: { $ne: m._id },
    });
    if (others === 0) {
      throw new HttpError(400, 'This hospital must always have at least one active admin.', 'LAST_ADMIN');
    }
  }

  async function assertNotShared(req, m) {
    if (m.userId.isSuperAdmin || m.userId.isPlatformAdmin || (await otherTenantUserIds(req.scopeTenantId, [m.userId._id])).size) {
      throw new HttpError(
        403,
        'This person also works at another hospital, so only a platform super admin can change their account details or password.',
        'SHARED_ACCOUNT',
      );
    }
  }

  // How many people have each role here (active places), for the hospital admin's dashboard
  router.get('/role-counts', async (req, res) => {
    const counts = {};
    for (const role of TENANT_ROLES) counts[role] = await Membership.countDocuments({ tenantId: req.scopeTenantId, isActive: true, roles: role });
    res.json({ counts, people: await Membership.countDocuments({ tenantId: req.scopeTenantId, isActive: true }) });
  });

  // A hospital admin's rights (super admins, and platform admins given "Hospital admins' access")
  router.patch('/:memberId/admin-rights', async (req, res) => {
    if (!isPlatformUser(req.user) || !canEditPlatform(req.user, 'hospitalAdmins')) {
      throw new HttpError(403, "Only the super admin gives a hospital admin's rights.", 'SUPER_ADMIN_ONLY');
    }
    const { rights } = parse(z.object({ rights: z.array(z.enum(ADMIN_RIGHTS)).max(ADMIN_RIGHTS.length) }), req.body);
    const m = await findMember(req);
    if (!m.roles.includes('admin')) throw new HttpError(400, 'This person is not a hospital admin here.', 'NOT_ADMIN');
    const from = [...(m.adminRights ?? [])].sort();
    const to = ADMIN_RIGHTS.filter((r) => rights.includes(r));
    if (from.join() === [...to].sort().join()) return res.json({ member: toMember(m) });
    m.adminRights = to;
    await m.save();
    await audit(req, 'MEMBER_ROLE_CHANGED', { target: m.userId, tenantId: req.scopeTenantId, details: { adminRights: { from, to } } });
    res.json({ member: toMember(m) });
  });

  router.get('/', async (req, res) => {
    const q = parse(listSchema, req.query);
    const filter = { tenantId: req.scopeTenantId };
    if (q.role) filter.roles = q.role;
    if (q.status) filter.isActive = q.status === 'active';
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), 'i');
      filter.userId = { $in: await User.find({ $or: [{ name: rx }, { email: rx }] }).distinct('_id') };
    }

    const [rows, total] = await Promise.all([
      Membership.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('userId'),
      Membership.countDocuments(filter),
    ]);
    const present = rows.filter((r) => r.userId);
    const shared = await otherTenantUserIds(req.scopeTenantId, present.map((r) => r.userId._id));
    res.json({
      members: present.map((r) => toMember(r, shared)),
      roles: TENANT_ROLES,
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    });
  });

  // Tag a person to this hospital. If they don't have an account yet, one is created with a
  // temporary password. If they already have one (e.g. from another hospital), it is simply linked.
  router.post('/', async (req, res) => {
    const data = parse(addSchema, req.body);
    // The super admin, a platform admin given "User accounts", or (22 Oct 2026) a hospital admin given "Add people"
    if (isPlatformUser(req.user)) {
      if (!canEditPlatform(req.user, 'users')) throw new HttpError(403, 'New people are added by the super admin (or an admin given "User accounts"). Ask the super admin.', 'ADD_PEOPLE_RIGHT');
    } else {
      assertAdminRight(req, 'addPeople');
      assertNotAdminRole(req, data.roles);
    }
    assertHospitalAdminRight(req, data.roles);
    let user = await User.findOne({ email: data.email });
    let temporaryPassword = null;

    if (user) {
      if (user.isSuperAdmin || user.isPlatformAdmin) {
        throw new HttpError(400, 'Platform super admins and platform admins cannot be added to a hospital. Use a separate account.', 'SUPER_ADMIN');
      }
      const existing = await Membership.findOne({ tenantId: req.scopeTenantId, userId: user._id });
      if (existing) {
        const message = existing.isActive
          ? 'This person is already a member of this hospital.'
          : 'This person is already a member of this hospital but deactivated. Reactivate them instead.';
        throw new HttpError(409, message, 'ALREADY_MEMBER');
      }
    } else {
      if (!data.name) {
        const message = 'Name is required for a new person.';
        return res.status(400).json({ error: { message, code: 'VALIDATION', fields: { name: message } } });
      }
      temporaryPassword = generateTemporaryPassword();
      user = await User.create({
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
      });
      await audit(req, 'USER_CREATED', { target: user, tenantId: req.scopeTenantId, details: { name: user.name } });
    }

    const membership = await Membership.create({
      tenantId: req.scopeTenantId,
      userId: user._id,
      roles: data.roles,
      createdBy: req.user._id,
    });
    await audit(req, 'MEMBER_ADDED', { target: user, tenantId: req.scopeTenantId, details: { roles: data.roles } });
    membership.userId = user;
    const shared = await otherTenantUserIds(req.scopeTenantId, [user._id]);
    res.status(201).json({ member: toMember(membership, shared), temporaryPassword, existingUser: !temporaryPassword });
  });

  // Replace the person's roles in this hospital (one or more).
  router.patch('/:memberId/roles', async (req, res) => {
    const { roles: newRoles } = parse(z.object({ roles }), req.body);
    const m = await findMember(req);
    if (isSelf(req, m)) throw new HttpError(400, "You can't change your own roles.", 'SELF_ACTION');
    assertAdminRight(req, 'roles');
    const from = [...m.roles];
    assertHospitalAdminRight(req, from, newRoles);
    if (from.includes('admin') !== newRoles.includes('admin')) assertNotAdminRole(req, ['admin']);
    if (from.join() === newRoles.join()) return res.json({ member: toMember(m) });
    if (from.includes('admin') && !newRoles.includes('admin') && m.isActive) await assertAnotherActiveAdmin(req, m);

    m.roles = newRoles;
    await m.save();
    await audit(req, 'MEMBER_ROLE_CHANGED', { target: m.userId, tenantId: req.scopeTenantId, details: { from, to: newRoles } });
    res.json({ member: toMember(m) });
  });

  // A doctor's departments here (owner, 27 Oct 2026; more than one from 29 Oct 2026): those who may change roles may set
  // them – { departments: [...] }, or { department } for one
  router.patch('/:memberId/department', async (req, res) => {
    const pick = z.enum(DEPARTMENTS, 'Choose a department from the list');
    const body = parse(z.union([z.object({ departments: z.array(pick).max(DEPARTMENTS.length) }).strict(), z.object({ department: z.enum(['', ...DEPARTMENTS], 'Choose a department from the list') }).strict()]), req.body);
    const wanted = body.departments ? DEPARTMENTS.filter((d) => body.departments.includes(d)) : body.department ? [body.department] : [];
    const m = await findMember(req);
    assertAdminRight(req, 'roles');
    if (!m.roles.includes('doctor')) throw new HttpError(400, 'Only a doctor has a department.', 'NOT_DOCTOR');
    const before = departmentsOf(m);
    if (before.join('|') === wanted.join('|')) return res.json({ member: toMember(m) });
    m.departments = wanted;
    m.department = wanted[0] ?? '';
    await m.save();
    await audit(req, 'MEMBER_ROLE_CHANGED', { target: m.userId, tenantId: req.scopeTenantId, details: { department: { from: before.join(', '), to: wanted.join(', ') } } });
    res.json({ member: toMember(m) });
  });

  // Deactivating a membership removes access to THIS hospital only; the person's other hospitals are unaffected.
  router.patch('/:memberId/status', async (req, res) => {
    const { isActive } = parse(z.object({ isActive: z.boolean('isActive must be true or false') }), req.body);
    const m = await findMember(req);
    if (isSelf(req, m)) throw new HttpError(400, "You can't deactivate or reactivate yourself.", 'SELF_ACTION');
    assertAdminRight(req, 'access');
    assertHospitalAdminRight(req, m.roles);
    if (m.isActive === isActive) return res.json({ member: toMember(m) });
    if (!isActive && m.roles.includes('admin')) await assertAnotherActiveAdmin(req, m);

    m.isActive = isActive;
    await m.save();
    await audit(req, isActive ? 'MEMBER_ACTIVATED' : 'MEMBER_DEACTIVATED', { target: m.userId, tenantId: req.scopeTenantId });
    res.json({ member: toMember(m) });
  });

  if (allowAccountChanges) {
    router.patch('/:memberId', async (req, res) => {
      const data = parse(editSchema, req.body);
      const m = await findMember(req);
      if (isSelf(req, m)) throw new HttpError(400, 'Ask a platform super admin to change your own details.', 'SELF_ACTION');
      assertAdminRight(req, 'details');
      assertHospitalAdminRight(req, m.roles);
      await assertNotShared(req, m);

      const user = m.userId;
      const changes = {};
      for (const key of ['name', 'email']) {
        if (data[key] !== undefined && data[key] !== user[key]) {
          changes[key] = { from: user[key], to: data[key] };
          user[key] = data[key];
        }
      }
      if (Object.keys(changes).length) {
        await user.save();
        await audit(req, 'USER_UPDATED', { target: user, tenantId: req.scopeTenantId, details: { changes } });
      }
      res.json({ member: toMember(m) });
    });

    router.post('/:memberId/reset-password', async (req, res) => {
      const m = await findMember(req);
      if (isSelf(req, m)) {
        throw new HttpError(400, 'To change your own password, use "Change password" instead.', 'SELF_ACTION');
      }
      assertAdminRight(req, 'resetPassword');
      assertHospitalAdminRight(req, m.roles);
      await assertNotShared(req, m);

      const user = await User.findById(m.userId._id);
      const temporaryPassword = generateTemporaryPassword();
      user.passwordHash = await hashPassword(temporaryPassword);
      user.mustChangePassword = true;
      user.tokenVersion += 1; // signs them out everywhere
      await user.save();
      await audit(req, 'PASSWORD_RESET', { target: user, tenantId: req.scopeTenantId });
      res.json({ member: toMember(m), temporaryPassword });
    });
  }

  return router;
}

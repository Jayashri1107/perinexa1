import { Router } from 'express';
import { z } from 'zod';
import { PAGES, PAGE_KEYS, PAGE_LEVELS, cleanPages } from '../access/pages.js';
import { Membership, TENANT_ROLES } from '../models/Membership.js';
import { UserGroup } from '../models/UserGroup.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, parse } from '../utils/validate.js';

// User groups (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part B): /api/platform/user-groups.
//  - GET /: every group with how many active people are in it (all hospitals), and the menu items (PAGES).
//  - POST /: a new group – name, description, roles, pages. Super admins only (requirePlatform: changes need it).
//  - PATCH /:id: name, description, pages; roles only while nobody is in the group, and never of a system group (the 13
//    made from the old roles) – a change of roles would change at once what its people may do and which records they
//    open in every hospital.
//  - PATCH /:id/status: deactivate (only when nobody is in it) or reactivate. Never deleted.
// Every change is in the audit log. A group holds no patient data.

export const userGroupsRouter = Router();

const pagesSchema = z.partialRecord(z.enum(PAGE_KEYS, 'Unknown menu item'), z.enum(PAGE_LEVELS)).default({});
const rolesSchema = z
  .array(z.enum(TENANT_ROLES), 'Choose at least one role')
  .min(1, 'Choose at least one role')
  .transform((list) => TENANT_ROLES.filter((r) => list.includes(r)));
const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long');
const description = z.string().trim().max(300, 'Description is too long');
const createSchema = z.object({ name, description: description.default(''), roles: rolesSchema, pages: pagesSchema });
const editSchema = z
  .object({ name: name.optional(), description: description.optional(), roles: rolesSchema.optional(), pages: pagesSchema.optional() })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nothing to update');

const plainPages = (g) => (g.pages instanceof Map ? Object.fromEntries(g.pages) : (g.pages ?? {}));
const toGroup = (g, members = 0) => ({
  id: String(g._id),
  name: g.name,
  description: g.description ?? '',
  roles: g.roles,
  pages: cleanPages(plainPages(g)),
  system: Boolean(g.system),
  isActive: g.isActive,
  members,
  updatedAt: g.updatedAt,
});

async function memberCounts(ids) {
  const rows = await Membership.aggregate([{ $match: { groupId: { $in: ids }, isActive: true } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function findGroup(req) {
  const { id } = parse(idParams, req.params);
  const group = await UserGroup.findById(id);
  if (!group) throw new HttpError(404, 'User group not found.', 'NOT_FOUND');
  return group;
}

const nameTaken = (err) => err?.code === 11000;
const takenError = () => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { name: 'A group with this name already exists.' } });

userGroupsRouter.get('/', async (_req, res) => {
  const groups = await UserGroup.find({}).sort({ isActive: -1, system: -1, name: 1 }).lean();
  const counts = await memberCounts(groups.map((g) => g._id));
  res.json({ groups: groups.map((g) => toGroup(g, counts.get(String(g._id)) ?? 0)), pages: PAGES, roles: TENANT_ROLES });
});

userGroupsRouter.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  let group;
  try {
    group = await UserGroup.create({ ...data, pages: cleanPages(data.pages), createdBy: req.user._id });
  } catch (err) {
    if (nameTaken(err)) throw takenError();
    throw err;
  }
  await audit(req, 'USER_GROUP_CREATED', { details: { groupId: String(group._id), name: group.name, roles: group.roles, pages: cleanPages(data.pages) } });
  res.status(201).json({ group: toGroup(group) });
});

userGroupsRouter.patch('/:id', async (req, res) => {
  const group = await findGroup(req);
  const data = parse(editSchema, req.body);
  const members = (await memberCounts([group._id])).get(String(group._id)) ?? 0;
  const changes = {};
  if (data.roles && data.roles.join() !== group.roles.join()) {
    if (group.system) throw new HttpError(400, "The roles of a group made from the old roles can't change. Make a new group instead.", 'SYSTEM_GROUP');
    // Inactive members count too: reactivating them must not bring different roles with it
    if (await Membership.exists({ groupId: group._id })) {
      throw new HttpError(400, 'People are in this group. Move them to another group first, or make a new group with these roles.', 'GROUP_IN_USE');
    }
    changes.roles = { from: [...group.roles], to: data.roles };
    group.roles = data.roles;
  }
  if (data.name !== undefined && data.name !== group.name) {
    changes.name = { from: group.name, to: data.name };
    group.name = data.name;
  }
  if (data.description !== undefined && data.description !== group.description) {
    changes.description = { from: group.description, to: data.description };
    group.description = data.description;
  }
  if (data.pages !== undefined) {
    const from = cleanPages(plainPages(group));
    const to = cleanPages(data.pages);
    const changed = PAGE_KEYS.filter((k) => (from[k] ?? 'edit') !== (to[k] ?? 'edit'));
    if (changed.length) {
      changes.pages = Object.fromEntries(changed.map((k) => [k, { from: from[k] ?? 'edit', to: to[k] ?? 'edit' }]));
      group.pages = new Map(Object.entries(to));
    }
  }
  if (!Object.keys(changes).length) return res.json({ group: toGroup(group, members) });
  try {
    await group.save();
  } catch (err) {
    if (nameTaken(err)) throw takenError();
    throw err;
  }
  await audit(req, 'USER_GROUP_CHANGED', { details: { groupId: String(group._id), name: group.name, changes } });
  res.json({ group: toGroup(group, members) });
});

userGroupsRouter.patch('/:id/status', async (req, res) => {
  const group = await findGroup(req);
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  if (group.isActive === isActive) return res.json({ group: toGroup(group) });
  if (!isActive && (await Membership.exists({ groupId: group._id, isActive: true }))) {
    throw new HttpError(400, 'People are in this group. Move them to another group first.', 'GROUP_IN_USE');
  }
  group.isActive = isActive;
  await group.save();
  await audit(req, isActive ? 'USER_GROUP_REACTIVATED' : 'USER_GROUP_DEACTIVATED', { details: { groupId: String(group._id), name: group.name } });
  res.json({ group: toGroup(group) });
});

import { Router } from 'express';
import { z } from 'zod';
import { Membership } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';
import { membersRouter } from './members.js';

const name = z.string().trim().min(2, 'Hospital name must be at least 2 characters').max(150, 'Name is too long');
const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['active', 'inactive']).optional(),
  sort: sortParam(['name', 'createdAt'], 'name'),
  ...pageParams,
});
const tenantParams = z.object({ tenantId: objectId });

// Number of active members and admins per hospital.
async function memberCounts(tenantIds) {
  const rows = await Membership.aggregate([
    { $match: { tenantId: { $in: tenantIds }, isActive: true } },
    { $group: { _id: '$tenantId', members: { $sum: 1 }, admins: { $sum: { $cond: [{ $in: ['admin', '$roles'] }, 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), { members: r.members, admins: r.admins }]));
}

// What the super admin sees of a hospital: only what the platform screens show. The hospital's own settings (letterhead,
// pharmacy GSTIN and drug licences, ABDM ids, patient messages and the secret address of the waiting-room screen) are
// the hospital's, so they are never sent here – a field added to Tenant later stays out unless it is listed.
export const platformTenantView = (t) => ({ id: t._id.toString(), name: t.name, isActive: t.isActive, createdAt: t.createdAt });

const withCounts = (tenant, counts) => ({ ...platformTenantView(tenant), ...(counts.get(tenant._id.toString()) ?? { members: 0, admins: 0 }) });

async function findTenant(req) {
  const { tenantId } = parse(tenantParams, req.params);
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new HttpError(404, 'Hospital not found.', 'NOT_FOUND');
  return tenant;
}

export const platformTenantsRouter = Router();

platformTenantsRouter.get('/', async (req, res) => {
  const q = parse(listSchema, req.query);
  const filter = {};
  if (q.search) filter.name = new RegExp(escapeRegex(q.search), 'i');
  if (q.status) filter.isActive = q.status === 'active';

  const [tenants, total] = await Promise.all([
    Tenant.find(filter)
      .sort(toMongoSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    Tenant.countDocuments(filter),
  ]);
  const counts = await memberCounts(tenants.map((t) => t._id));
  res.json({
    tenants: tenants.map((t) => withCounts(t, counts)),
    ...paged(q, total),
  });
});

platformTenantsRouter.post('/', async (req, res) => {
  const data = parse(z.object({ name }), req.body);
  const tenant = await Tenant.create({ name: data.name, createdBy: req.user._id });
  await audit(req, 'TENANT_CREATED', { tenantId: tenant._id, details: { name: tenant.name } });
  res.status(201).json({ tenant: { ...platformTenantView(tenant), members: 0, admins: 0 } });
});

platformTenantsRouter.get('/:tenantId', async (req, res) => {
  const tenant = await findTenant(req);
  res.json({ tenant: withCounts(tenant, await memberCounts([tenant._id])) });
});

platformTenantsRouter.patch('/:tenantId', async (req, res) => {
  const data = parse(z.object({ name }), req.body);
  const tenant = await findTenant(req);
  if (tenant.name !== data.name) {
    const from = tenant.name;
    tenant.name = data.name;
    await tenant.save();
    await audit(req, 'TENANT_UPDATED', { tenantId: tenant._id, details: { changes: { name: { from, to: data.name } } } });
  }
  res.json({ tenant: withCounts(tenant, await memberCounts([tenant._id])) });
});

// Deactivating a hospital immediately stops everyone from working in it. Nothing is deleted.
platformTenantsRouter.patch('/:tenantId/status', async (req, res) => {
  const { isActive } = parse(z.object({ isActive: z.boolean('isActive must be true or false') }), req.body);
  const tenant = await findTenant(req);
  if (tenant.isActive !== isActive) {
    tenant.isActive = isActive;
    await tenant.save();
    await audit(req, isActive ? 'TENANT_ACTIVATED' : 'TENANT_DEACTIVATED', { tenantId: tenant._id });
  }
  res.json({ tenant: withCounts(tenant, await memberCounts([tenant._id])) });
});

platformTenantsRouter.use(
  '/:tenantId/members',
  membersRouter({ resolveTenantId: async (req) => (await findTenant(req))._id }),
);

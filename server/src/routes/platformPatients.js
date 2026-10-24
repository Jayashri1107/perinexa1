import { Router } from 'express';
import { z } from 'zod';
import { CARE_TYPES, Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';

// Patients of every hospital for the super admin (owner, 24 Oct 2026 – docs/HANDOVER.md section 9): identity only –
// name, patient number, hospital, type of care, who added her and when. Never the phone, address, age or anything
// medical; her record opens inside her hospital, as before (audited there). Super admins only, not platform admins.
// Hospital separation stays: the query names every hospital it reads (tenantScoped refuses one that does not), and
// each list shown is written to the audit log of every hospital it lists (ids only).

export const platformPatientsRouter = Router();

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  tenantId: objectId.optional(),
  careType: z.enum(CARE_TYPES).optional(),
  sort: sortParam(['createdAt', 'fullName', 'mrn'], '-createdAt'),
  ...pageParams,
});

platformPatientsRouter.use((req, _res, next) => {
  if (!req.user?.isSuperAdmin) throw new HttpError(403, 'Only a super admin sees the patients of every hospital.', 'FORBIDDEN');
  next();
});

platformPatientsRouter.get('/', async (req, res) => {
  const q = parse(listSchema, req.query);
  const tenants = await Tenant.find(q.tenantId ? { _id: q.tenantId } : {}, { name: 1 }).lean();
  const names = new Map(tenants.map((t) => [String(t._id), t.name]));
  const filter = { tenantId: { $in: tenants.map((t) => t._id) }, duplicateOf: null }; // a record marked as a duplicate is left out, as in the hospital's lists
  if (q.careType) filter.careType = q.careType;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ fullName: rx }, { mrn: rx }];
  }
  const [rows, total] = await Promise.all([
    Patient.find(filter, { tenantId: 1, mrn: 1, fullName: 1, careType: 1, createdBy: 1, createdAt: 1 })
      .sort(toMongoSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Patient.countDocuments(filter),
  ]);
  const people = new Map((await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.createdBy)))] } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  // The list shown is in each listed hospital's audit log (how many of its patients, never who)
  const perHospital = new Map();
  for (const r of rows) perHospital.set(String(r.tenantId), (perHospital.get(String(r.tenantId)) ?? 0) + 1);
  await Promise.all([...perHospital].map(([tenantId, count]) => audit(req, 'PLATFORM_PATIENTS_LISTED', { tenantId, details: { count } })));
  res.json({
    patients: rows.map((r) => ({
      id: String(r._id),
      tenantId: String(r.tenantId),
      hospital: names.get(String(r.tenantId)) ?? '',
      mrn: r.mrn,
      fullName: r.fullName,
      careType: r.careType,
      addedBy: people.get(String(r.createdBy)) ?? '',
      createdAt: r.createdAt,
    })),
    hospitals: (await Tenant.find({}, { name: 1 }).sort({ name: 1 }).lean()).map((t) => ({ id: String(t._id), name: t.name })),
    ...paged(q, total),
  });
});

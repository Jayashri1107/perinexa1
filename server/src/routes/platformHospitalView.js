import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Bill } from '../models/Bill.js';
import { LabOrder } from '../models/LabOrder.js';
import { DEPARTMENTS, Membership, TENANT_ROLES, departmentsOf } from '../models/Membership.js';
import { CARE_TYPES, Patient } from '../models/Patient.js';
import { PharmacyInvoice } from '../models/Pharmacy.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, pageParams, paged, parse, sortParam, toMongoSort } from '../utils/validate.js';

// One hospital, everything, for the super admin (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part A):
//  - GET /:tenantId/departments: today's numbers for each of the owner's 9 departments and "No department", and for the
//    hospital's services (reception, lab, pharmacy, billing). Numbers only, never a patient. Super and platform admins.
//  - GET /:tenantId/staff: its staff grouped by department, then by role. Staff only. Super and platform admins.
//  - GET /:tenantId/patients?department=: its patients of one department, identity only – the same fields as
//    Platform → Patients (owner, 24 Oct 2026). Super admins only; the list shown is in the hospital's audit log.
// Every query names this one hospital (tenantScoped; each aggregate() starts with its own tenantId match).

export const platformHospitalViewRouter = Router();

const NONE = 'none'; // "No department" in the address ('' in the database)
const departmentParam = z.enum([...DEPARTMENTS, NONE]);
const tenantParams = z.object({ tenantId: objectId });
const patientsSchema = z.object({
  department: departmentParam.optional(),
  search: z.string().trim().max(100).default(''),
  careType: z.enum(CARE_TYPES).optional(),
  sort: sortParam(['createdAt', 'fullName', 'mrn'], '-createdAt'),
  ...pageParams,
});

async function findTenant(req) {
  const { tenantId } = parse(tenantParams, req.params);
  const tenant = await Tenant.findById(tenantId, { name: 1 }).lean();
  if (!tenant) throw new HttpError(404, 'Hospital not found.', 'NOT_FOUND');
  return tenant._id;
}

// Counts of a hospital's documents per patient department. The patient lookup names the same hospital too.
async function perDepartment(Model, tenantId, match) {
  const rows = await Model.aggregate([
    { $match: { tenantId, ...match } },
    {
      $lookup: {
        from: Patient.collection.name,
        let: { pid: '$patientId' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$pid'] }, { $eq: ['$tenantId', tenantId] }] } } }, { $project: { department: 1 } }],
        as: 'p',
      },
    },
    { $group: { _id: { $ifNull: [{ $first: '$p.department' }, ''] }, n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id || '', r.n]));
}

async function groupCount(Model, tenantId, match, field) {
  const rows = await Model.aggregate([{ $match: { tenantId, ...match } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id || '', r.n]));
}

platformHospitalViewRouter.get('/:tenantId/departments', async (req, res) => {
  const tenantId = await findTenant(req);
  const today = hospitalToday();
  const since = hospitalDayStart(today);
  const live = { duplicateOf: null };
  const [patients, newToday, visitsToday, inpatientsNow, labToday, appointmentsToday, pharmacy, billing, labReportedToday] = await Promise.all([
    groupCount(Patient, tenantId, live, 'department'),
    groupCount(Patient, tenantId, { ...live, createdAt: { $gte: since } }, 'department'),
    perDepartment(Visit, tenantId, { visitOn: today, status: 'active' }),
    groupCount(Admission, tenantId, { status: 'admitted' }, 'department'),
    perDepartment(LabOrder, tenantId, { createdAt: { $gte: since }, status: { $ne: 'cancelled' } }),
    perDepartment(Appointment, tenantId, { on: today, status: 'booked' }),
    PharmacyInvoice.aggregate([
      { $match: { tenantId, 'created.at': { $gte: since } } },
      { $group: { _id: '$kind', n: { $sum: 1 } } },
    ]),
    Bill.aggregate([
      { $match: { tenantId, 'payments.at': { $gte: since } } },
      { $unwind: '$payments' },
      { $match: { 'payments.at': { $gte: since } } },
      {
        $group: {
          _id: null,
          payments: { $sum: 1 },
          paise: { $sum: { $cond: [{ $eq: ['$payments.kind', 'refund'] }, { $multiply: ['$payments.amountPaise', -1] }, '$payments.amountPaise'] } },
        },
      },
    ]),
    LabOrder.countDocuments({ tenantId, status: { $ne: 'cancelled' }, 'reported.at': { $gte: since } }),
  ]);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const row = (key) => ({
    patients: patients.get(key) ?? 0,
    newToday: newToday.get(key) ?? 0,
    visitsToday: visitsToday.get(key) ?? 0,
    appointmentsToday: appointmentsToday.get(key) ?? 0,
    inpatientsNow: inpatientsNow.get(key) ?? 0,
    labOrdersToday: labToday.get(key) ?? 0,
  });
  const kinds = new Map(pharmacy.map((r) => [r._id, r.n]));
  res.json({
    today: today.toISOString().slice(0, 10),
    departments: [...DEPARTMENTS.map((d) => ({ key: d, label: d, ...row(d) })), { key: NONE, label: 'No department', ...row('') }],
    services: {
      registrationsToday: sum(newToday),
      appointmentsToday: sum(appointmentsToday),
      visitsToday: sum(visitsToday),
      inpatientsNow: sum(inpatientsNow),
      labOrdersToday: sum(labToday),
      labReportedToday,
      pharmacySalesToday: kinds.get('sale') ?? 0,
      pharmacyIssuesToday: kinds.get('issue') ?? 0,
      paymentsToday: billing[0]?.payments ?? 0,
      collectedTodayPaise: billing[0]?.paise ?? 0,
    },
  });
});

platformHospitalViewRouter.get('/:tenantId/staff', async (req, res) => {
  const tenantId = await findTenant(req);
  const members = await Membership.find({ tenantId }, { userId: 1, roles: 1, department: 1, departments: 1, isActive: 1 }).lean();
  const users = new Map(
    (await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1, email: 1, isActive: 1, lastLoginAt: 1 }).lean()).map((u) => [String(u._id), u]),
  );
  const people = members
    .map((m) => {
      const u = users.get(String(m.userId));
      if (!u) return null;
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        roles: TENANT_ROLES.filter((r) => m.roles?.includes(r)),
        departments: departmentsOf(m),
        active: Boolean(m.isActive && u.isActive),
        lastLoginAt: u.lastLoginAt ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  // A doctor in two departments is listed under both. Everyone without a department (pharmacy, reception, lab, nurses …,
  // and doctors not given one yet) under their role – their first role other than hospital admin.
  const mainRole = (p) => p.roles.find((r) => r !== 'admin') ?? p.roles[0] ?? '';
  const groups = [
    ...DEPARTMENTS.map((d) => ({ key: d, label: d, role: null, people: people.filter((p) => p.departments.includes(d)) })),
    ...TENANT_ROLES.map((r) => ({ key: `role:${r}`, label: '', role: r, people: people.filter((p) => !p.departments.length && mainRole(p) === r) })),
    { key: NONE, label: 'No role', role: null, people: people.filter((p) => !p.departments.length && !mainRole(p)) },
  ];
  res.json({ groups: groups.filter((g) => g.people.length), total: people.length });
});

platformHospitalViewRouter.get('/:tenantId/patients', async (req, res) => {
  if (!req.user?.isSuperAdmin) throw new HttpError(403, "Only a super admin sees a hospital's patients.", 'FORBIDDEN');
  const tenantId = await findTenant(req);
  const q = parse(patientsSchema, req.query);
  const filter = { tenantId, duplicateOf: null };
  if (q.department) filter.department = q.department === NONE ? '' : q.department;
  if (q.careType) filter.careType = q.careType;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ fullName: rx }, { mrn: rx }];
  }
  const [rows, total] = await Promise.all([
    Patient.find(filter, { mrn: 1, fullName: 1, careType: 1, department: 1, assignedDoctor: 1, createdAt: 1 })
      .sort(toMongoSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Patient.countDocuments(filter),
  ]);
  const doctorIds = [...new Set(rows.map((r) => r.assignedDoctor && String(r.assignedDoctor)).filter(Boolean))];
  const doctors = new Map((await User.find({ _id: { $in: doctorIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  // The list shown is in the hospital's audit log: how many of its patients, never who
  if (rows.length) await audit(req, 'PLATFORM_PATIENTS_LISTED', { tenantId, details: { count: rows.length } });
  res.json({
    patients: rows.map((r) => ({
      id: String(r._id),
      mrn: r.mrn,
      fullName: r.fullName,
      careType: r.careType,
      department: r.department || '',
      doctor: r.assignedDoctor ? (doctors.get(String(r.assignedDoctor)) ?? '') : '',
      createdAt: r.createdAt,
    })),
    ...paged(q, total),
  });
});

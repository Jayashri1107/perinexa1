import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { PRIVILEGES, PRIVILEGE_KEYS, PRIVILEGE_SOURCE } from '../clinical/privileges.js';
import { Membership, hasRole } from '../models/Membership.js';
import { StaffPrivilege } from '../models/StaffPrivilege.js';
import { User } from '../models/User.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Clinical privileges (Clinical Requirements Group C – PX-X-07, DRAFT list): /api/privileges.
//  - GET /: the register – each doctor, RMO and nurse of this hospital with the privileges in force and the ended ones;
//  - POST /: grant a privilege to a member of staff (until a day, or with no end date);
//  - POST /:id/end: end one (with a reason) – never deleted.
// Who: the hospital admin and the quality lead keep the register; doctors, RMOs and nurses read it. No patient data.

export const privilegesRouter = Router();
const READERS = ['admin', 'quality', 'doctor', 'rmo', 'nurse'];
const KEEPERS = ['admin', 'quality'];
const STAFF_ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const day = z.union([z.literal(''), z.iso.date('Please enter a valid date')]);

privilegesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The privileges register is for the hospital admin, the quality lead, doctors, RMOs and nurses.');
  next();
});

const isoDay = (d) => d.toISOString().slice(0, 10);
/** Whether a granted privilege is in force on a day ('YYYY-MM-DD'). */
export const inForce = (p, today) => !p.ended && (!p.validUntil || p.validUntil >= today);
const view = (p, today) => ({
  id: String(p._id),
  key: p.key,
  label: PRIVILEGES[p.key]?.label ?? p.key,
  validUntil: p.validUntil,
  note: p.note,
  byName: p.byName,
  at: p.createdAt,
  state: p.ended ? 'ended' : inForce(p, today) ? 'in_force' : 'lapsed',
  ended: p.ended ? { reason: p.ended.reason, byName: p.ended.byName, at: p.ended.at } : null,
});

privilegesRouter.get('/', async (req, res) => {
  const today = isoDay(hospitalToday(req.now ?? new Date()));
  const members = await Membership.find({ tenantId: req.tenantId, isActive: true, roles: { $in: STAFF_ROLES } }, { userId: 1, roles: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1 }).lean();
  const privs = await StaffPrivilege.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean();
  const byUser = new Map();
  for (const p of privs) byUser.set(String(p.userId), [...(byUser.get(String(p.userId)) ?? []), view(p, today)]);
  const roleOf = new Map(members.map((m) => [String(m.userId), m.roles.filter((r) => STAFF_ROLES.includes(r))]));
  res.json({
    staff: users
      .map((u) => ({ id: String(u._id), name: u.name, roles: roleOf.get(String(u._id)) ?? [], privileges: byUser.get(String(u._id)) ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    access: { keep: hasRole(req.membership, ...KEEPERS) },
    rules: { privileges: PRIVILEGES, source: PRIVILEGE_SOURCE },
    today,
  });
});

const grantBody = z
  .object({
    userId: objectId,
    key: z.enum(PRIVILEGE_KEYS, 'Choose the privilege'),
    validUntil: day.default(''),
    note: safeText('Note', 300).default(''),
  })
  .strict();

privilegesRouter.post('/', async (req, res) => {
  if (!hasRole(req.membership, ...KEEPERS)) throw forbidden('The hospital admin or the quality lead grants privileges.');
  const b = parse(grantBody, req.body);
  const member = await Membership.findOne({ tenantId: req.tenantId, userId: b.userId, isActive: true }).lean();
  const user = member ? await User.findOne({ _id: b.userId, isActive: true }, { name: 1 }).lean() : null;
  if (!user || !hasRole(member, ...STAFF_ROLES)) throw invalid({ userId: 'Choose a doctor, RMO or nurse of this hospital.' });
  const def = PRIVILEGES[b.key];
  if (def.role !== 'any' && !hasRole(member, def.role)) throw invalid({ key: `“${def.label}” is for a ${def.role}.` });
  const today = isoDay(hospitalToday(req.now ?? new Date()));
  if (b.validUntil && b.validUntil < today) throw invalid({ validUntil: 'This day has passed.' });
  const open = await StaffPrivilege.findOne({ tenantId: req.tenantId, userId: user._id, key: b.key, ended: null }).lean();
  if (open && inForce(open, today)) throw new HttpError(409, `${user.name} already holds “${def.label}”. End it first to grant it again.`, 'CONFLICT');
  const p = await StaffPrivilege.create({ tenantId: req.tenantId, userId: user._id, key: b.key, validUntil: b.validUntil, note: b.note.trim(), by: req.user._id, byName: req.user.name });
  await audit(req, 'PRIVILEGE_GRANTED', { target: user, details: { privilegeId: String(p._id), key: b.key, validUntil: b.validUntil || null } });
  res.status(201).json({ privilege: view(p, today) });
});

privilegesRouter.post('/:id/end', async (req, res) => {
  if (!hasRole(req.membership, ...KEEPERS)) throw forbidden('The hospital admin or the quality lead ends privileges.');
  const { id } = parse(z.object({ id: objectId }).strict(), req.params);
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((v) => v.trim().length >= 3, 'Write why it ends') }).strict(), req.body);
  const p = await StaffPrivilege.findOne({ _id: id, tenantId: req.tenantId });
  if (!p) throw new HttpError(404, 'This privilege was not found.', 'NOT_FOUND');
  if (p.ended) throw new HttpError(409, 'This privilege was already ended.', 'CONFLICT');
  p.ended = { reason: reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await p.save();
  await audit(req, 'PRIVILEGE_ENDED', { target: { _id: p.userId }, details: { privilegeId: String(p._id), key: p.key } });
  res.json({ privilege: view(p, isoDay(hospitalToday(req.now ?? new Date()))) });
});

/**
 * The privilege check for a theatre case: the person named (matched by name to an active member of this hospital)
 * and whether they hold the privilege on that day. → { state: 'in_force' | 'none' | 'not_staff' | 'not_set', label }.
 */
export async function privilegeCheck(tenantId, name, key, onDay) {
  if (!key) return { state: 'not_set', label: '' };
  const label = PRIVILEGES[key]?.label ?? key;
  const wanted = String(name ?? '').trim().toLowerCase().replace(/^dr\.?\s+/, '');
  if (!wanted) return { state: 'not_staff', label };
  const members = await Membership.find({ tenantId, isActive: true }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1 }).lean();
  const match = users.filter((u) => u.name.trim().toLowerCase().replace(/^dr\.?\s+/, '') === wanted);
  if (match.length !== 1) return { state: 'not_staff', label };
  const p = await StaffPrivilege.findOne({ tenantId, userId: match[0]._id, key, ended: null }).sort({ createdAt: -1 }).lean();
  return { state: p && inForce(p, onDay) ? 'in_force' : 'none', label, validUntil: p?.validUntil ?? '' };
}

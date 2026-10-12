// A doctor's default protocol (care plans, 5 Oct 2026): one of the doctor's own APPROVED protocols, per type of
// care, that new care plans of the patients assigned to that doctor start from instead of the hospital standard
// template. Choosing, changing or removing it never touches a plan that already exists.
//
// It is used only while it can safely stand in for the standard template:
//  - its current items are exactly what a doctor approved (a protocol edited since is a draft again);
//  - it has items;
//  - its doctor still works in this hospital as a doctor (an active account and an active doctor membership).
// Otherwise the choice is kept (the doctor sees why it is not used on the template pages) and new plans start from
// the hospital standard template, as before.

import { CarePlanTemplate } from '../models/CarePlanTemplate.js';
import { Membership } from '../models/Membership.js';
import { User } from '../models/User.js';
import { contentApproved } from './hashes.js';

/**
 * Why a protocol marked as its doctor's default is (not) used for new plans – PURE. t: the template (with items,
 * status and approvals); ownerActive: its doctor works here as a doctor. Returns null when the protocol is not a
 * default, 'in_use', 'draft' (not approved as it is now), 'no_items' or 'owner_inactive'.
 */
export function defaultState(t, { ownerActive }) {
  if (!t?.ownerDefault || t.kind !== 'personal') return null;
  if (t.status !== 'approved' || !contentApproved(t)) return 'draft';
  if (!t.items?.length) return 'no_items';
  if (!ownerActive) return 'owner_inactive';
  return 'in_use';
}

/** The ids (strings) of these people who work in this hospital as doctors now (account and membership active). */
export async function activeDoctorIds(tenantId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const members = await Membership.find({ tenantId, userId: { $in: ids }, isActive: true, roles: 'doctor' }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { _id: 1 }).lean();
  return new Set(users.map((u) => String(u._id)));
}

/**
 * defaultState for each of these templates (Map id → state; templates that are not a default are left out). The
 * templates need items, status and approvals (approvalsOf).
 */
export async function defaultStates(tenantId, templates) {
  const defaults = templates.filter((t) => t.ownerDefault && t.kind === 'personal');
  const active = await activeDoctorIds(tenantId, defaults.map((t) => t.owner));
  return new Map(defaults.map((t) => [String(t._id), defaultState(t, { ownerActive: active.has(String(t.owner)) })]));
}

/**
 * The protocol a new care plan of a patient assigned to this doctor starts from, for this type of care: the doctor's
 * default when it is in use, otherwise null (the hospital standard template is used).
 */
export async function defaultProtocolFor(tenantId, doctorId, careType) {
  if (!doctorId) return null;
  const t = await CarePlanTemplate.findOne({ tenantId, kind: 'personal', owner: doctorId, careType, ownerDefault: true });
  if (!t) return null;
  const active = await activeDoctorIds(tenantId, [t.owner]);
  return defaultState(t, { ownerActive: active.has(String(t.owner)) }) === 'in_use' ? t : null;
}

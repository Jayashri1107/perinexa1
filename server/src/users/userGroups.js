// User groups (developer, 14 Nov 2026 – docs/USER_GROUPS_PLAN.md Part B): the 13 groups made from the old roles, and
// moving every member into a group. Run at every start (index.js); a second run finds nothing to do.
//  - One system group per role ("Doctor", "Receptionist" …) with that role and every menu item Edit: nobody gains or
//    loses anything on the day of the change.
//  - A member with one role joins that role's group. A member with several (a doctor who is also the hospital admin)
//    joins the group made for that mix of roles ("Doctor + Hospital admin"), made once with those roles.
// Each group made and each member moved is in the audit log.
import { AuditLog } from '../models/AuditLog.js';
import { Membership, TENANT_ROLES } from '../models/Membership.js';
import { UserGroup } from '../models/UserGroup.js';

// The same words as the website's role names (client/src/components/ui.jsx ROLE_LABELS)
export const ROLE_NAMES = {
  admin: 'Hospital admin',
  doctor: 'Doctor',
  rmo: 'RMO',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  lab: 'Lab staff',
  sonographer: 'Sonography',
  pharmacist: 'Pharmacist',
  billing: 'Billing',
  referral_desk: 'Referral desk',
  followup_coordinator: 'Newborn follow-up coordinator',
  quality: 'Quality lead',
  records: 'Medical records',
};

/** A group's name for a mix of roles: "Doctor + Hospital admin" (clinical roles first). PURE. */
export const nameForRoles = (roles) => {
  const sorted = TENANT_ROLES.filter((r) => roles.includes(r));
  return [...sorted.filter((r) => r !== 'admin'), ...sorted.filter((r) => r === 'admin')].map((r) => ROLE_NAMES[r] ?? r).join(' + ');
};

const sameRoles = (a, b) => a.length === b.length && a.every((r) => b.includes(r));

/** The active group with exactly these roles – a system group first – or a new one made for them. */
export async function groupForRoles(roles, { createdBy = null } = {}) {
  const wanted = TENANT_ROLES.filter((r) => roles.includes(r));
  const candidates = await UserGroup.find({ roles: { $all: wanted, $size: wanted.length }, isActive: true }).sort({ system: -1, createdAt: 1 });
  const found = candidates.find((g) => sameRoles(g.roles, wanted));
  if (found) return { group: found, made: false };
  let name = nameForRoles(wanted);
  if (await UserGroup.exists({ name })) name = `${name} (${new Date().toISOString().slice(0, 10)})`;
  const group = await UserGroup.create({ name, roles: wanted, system: wanted.length === 1, createdBy, description: wanted.length === 1 ? '' : 'Made for staff who had these roles together.' });
  return { group, made: true };
}

/** Makes the 13 system groups and moves every member without a group. Returns { groupsMade, membersMoved }. */
export async function moveToUserGroups() {
  let groupsMade = 0;
  const made = [];
  for (const role of TENANT_ROLES) {
    const { group, made: isNew } = await groupForRoles([role]);
    if (isNew) {
      groupsMade += 1;
      made.push(group);
    }
  }
  let membersMoved = 0;
  const moved = [];
  const waiting = await Membership.find({ groupId: null }, { roles: 1, tenantId: 1, userId: 1 }).lean();
  const byMix = new Map();
  for (const m of waiting) {
    const roles = TENANT_ROLES.filter((r) => m.roles?.includes(r));
    if (!roles.length) continue;
    const key = roles.join(',');
    if (!byMix.has(key)) {
      const { group, made: isNew } = await groupForRoles(roles);
      if (isNew) {
        groupsMade += 1;
        made.push(group);
      }
      byMix.set(key, group);
    }
    const group = byMix.get(key);
    const r = await Membership.updateOne({ _id: m._id, groupId: null }, { $set: { groupId: group._id } });
    if (r.modifiedCount) {
      membersMoved += 1;
      moved.push({ m, group });
    }
  }
  const entries = [
    ...made.map((g) => ({ action: 'USER_GROUP_CREATED', details: { groupId: String(g._id), name: g.name, roles: g.roles, by: 'move-to-groups' } })),
    ...moved.map(({ m, group }) => ({ action: 'MEMBER_GROUP_CHANGED', tenantId: m.tenantId, target: m.userId, details: { from: '', to: group.name, by: 'move-to-groups' } })),
  ];
  if (entries.length) await AuditLog.insertMany(entries);
  return { groupsMade, membersMoved };
}

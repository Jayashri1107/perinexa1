// The hospital admin's staff page: the same staff logic as the super admin's (members module), always for the hospital
// of the session – an admin can never reach another hospital's staff.
import { z } from 'zod';
import { objectId, parse, statusBody } from '../../core/validate.js';
import * as members from '../members/member.service.js';
import { addMemberBody, memberListQuery, rolesBody } from '../members/member.validation.js';

const memberParams = z.object({ memberId: objectId });

export async function list(req, res) {
  res.json(await members.listMembers(req.hospitalId, parse(memberListQuery, req.query)));
}

export async function add(req, res) {
  const { member, temporaryPassword, existingUser } = await members.addMember(req, req.hospitalId, parse(addMemberBody, req.body));
  res.status(201).json({ member: await members.getMember(req.hospitalId, member._id), temporaryPassword, existingUser });
}

export async function updateRoles(req, res) {
  const { memberId } = parse(memberParams, req.params);
  const { roles } = parse(rolesBody, req.body);
  res.json({ member: await members.updateRoles(req, req.hospitalId, memberId, roles) });
}

export async function setStatus(req, res) {
  const { memberId } = parse(memberParams, req.params);
  const { isActive } = parse(statusBody, req.body);
  res.json({ member: await members.setMemberStatus(req, req.hospitalId, memberId, isActive) });
}

export async function resetPassword(req, res) {
  const { memberId } = parse(memberParams, req.params);
  res.json(await members.resetMemberPassword(req, req.hospitalId, memberId));
}

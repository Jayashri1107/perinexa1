import { parse, statusBody } from '../../core/validate.js';
import * as service from './member.service.js';
import { addMemberBody, hospitalParams, memberListQuery, memberParams, rolesBody } from './member.validation.js';

export async function list(req, res) {
  const { hospitalId } = parse(hospitalParams, req.params);
  res.json(await service.listMembers(hospitalId, parse(memberListQuery, req.query)));
}

export async function add(req, res) {
  const { hospitalId } = parse(hospitalParams, req.params);
  const { member, temporaryPassword, existingUser } = await service.addMember(req, hospitalId, parse(addMemberBody, req.body));
  res.status(201).json({ member: await service.getMember(hospitalId, member._id), temporaryPassword, existingUser });
}

export async function updateRoles(req, res) {
  const { hospitalId, memberId } = parse(memberParams, req.params);
  const { roles } = parse(rolesBody, req.body);
  res.json({ member: await service.updateRoles(req, hospitalId, memberId, roles) });
}

export async function setStatus(req, res) {
  const { hospitalId, memberId } = parse(memberParams, req.params);
  const { isActive } = parse(statusBody, req.body);
  res.json({ member: await service.setMemberStatus(req, hospitalId, memberId, isActive) });
}

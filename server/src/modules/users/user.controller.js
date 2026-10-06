import { idParams, parse, statusBody } from '../../core/validate.js';
import { addMember } from '../members/member.service.js';
import * as service from './user.service.js';
import { createUserBody, updateUserBody, userListQuery } from './user.validation.js';

export async function list(req, res) {
  res.json(await service.listUsers(parse(userListQuery, req.query)));
}

export async function get(req, res) {
  const { id } = parse(idParams, req.params);
  res.json({ user: await service.getUser(id) });
}

// A staff account is created by adding the person to their hospital; a super admin account stands alone.
export async function create(req, res) {
  const data = parse(createUserBody, req.body);
  if (data.accountType === 'staff') {
    const { member, temporaryPassword } = await addMember(req, data.hospitalId, data);
    return res.status(201).json({ user: await service.getUser(member.userId), temporaryPassword });
  }
  const { user, temporaryPassword } = await service.createAccount(req, { ...data, isSuperAdmin: true });
  res.status(201).json({ user: await service.getUser(user._id), temporaryPassword });
}

export async function update(req, res) {
  const { id } = parse(idParams, req.params);
  res.json({ user: await service.updateUser(req, id, parse(updateUserBody, req.body)) });
}

export async function setStatus(req, res) {
  const { id } = parse(idParams, req.params);
  const { isActive } = parse(statusBody, req.body);
  res.json({ user: await service.setUserStatus(req, id, isActive) });
}

export async function resetPassword(req, res) {
  const { id } = parse(idParams, req.params);
  res.json(await service.resetPassword(req, id));
}

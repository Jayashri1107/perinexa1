import { clearSessionCookie, setSessionCookie } from '../../core/session.js';
import { parse } from '../../core/validate.js';
import * as service from './auth.service.js';
import { changePasswordBody, loginBody } from './auth.validation.js';

export async function login(req, res) {
  const user = await service.login(req, parse(loginBody, req.body));
  setSessionCookie(res, user);
  res.json(await service.sessionInfo(user));
}

export async function logout(req, res) {
  await service.logout(req);
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json(await service.sessionInfo(req.user));
}

export async function changePassword(req, res) {
  const user = await service.changePassword(req, parse(changePasswordBody, req.body));
  setSessionCookie(res, user); // a fresh cookie for this browser; the other sessions are ended
  res.json(await service.sessionInfo(user));
}

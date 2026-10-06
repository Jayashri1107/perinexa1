import { clearSessionCookie, setSessionCookie } from '../../core/session.js';
import { parse } from '../../core/validate.js';
import * as service from './auth.service.js';
import { changePasswordBody, loginBody, switchHospitalBody } from './auth.validation.js';

// Sets the cookie for the session's hospital and answers with the session.
function sendSession(res, session) {
  setSessionCookie(res, session.user, session.hospitalId);
  res.json(service.sessionBody(session));
}

export async function login(req, res) {
  sendSession(res, await service.login(req, parse(loginBody, req.body)));
}

export async function logout(req, res) {
  await service.logout(req);
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  sendSession(res, await service.currentSession(req));
}

export async function changePassword(req, res) {
  const user = await service.changePassword(req, parse(changePasswordBody, req.body));
  req.user = user; // a fresh cookie for this browser; the other sessions are ended
  sendSession(res, await service.currentSession(req));
}

export async function leaveHospital(req, res) {
  sendSession(res, await service.leaveHospital(req));
}

export async function switchHospital(req, res) {
  const { hospitalId } = parse(switchHospitalBody, req.body);
  sendSession(res, await service.switchHospital(req, hospitalId));
}

// Two-step sign-in with an authenticator app (health check H4; owner's decision of 17 Nov 2026). All fake sample data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { codeAt, checkCode, base32, fromBase32, matchRecovery, newRecoveryCodes, openSecret, sealSecret, stepOf } from '../src/auth/totp.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { PASSWORD, addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, resetTestDb } from './helpers.js';

const required = createApp({ twoStepForAdmins: true }); // as on the live server
beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

const codeNow = (secret, offset = 0) => codeAt(secret, stepOf(new Date()) + offset);
const login = (agent, user, password = PASSWORD) => agent.post('/api/auth/login').send({ email: user.email, password });

describe('the codes (RFC 6238)', () => {
  it('match the standard test values, and a code works once, within one step of the clock', () => {
    const secret = base32(Buffer.from('12345678901234567890'));
    expect(fromBase32(secret).toString()).toBe('12345678901234567890');
    expect(codeAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(secret, Math.floor(2000000000 / 30))).toBe('279037');
    const now = new Date(1111111109 * 1000);
    const step = checkCode(secret, '081 804', { now });
    expect(step).toBe(Math.floor(1111111109 / 30));
    expect(checkCode(secret, '081804', { now, after: step })).toBeNull(); // not twice
    expect(checkCode(secret, codeAt(secret, step - 3), { now })).toBeNull(); // too old
    expect(checkCode(secret, 'abcdef', { now })).toBeNull();
    // The secret is kept encrypted; recovery codes as hashes, each matching once in any spelling
    const sealed = sealSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed)).toBe(secret);
    expect(openSecret('garbage')).toBeNull();
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(matchRecovery(codes[3].toLowerCase().replace('-', ' '), hashes)).toBe(3);
    expect(matchRecovery('NOPE-NOPE', hashes)).toBe(-1);
  });
});

describe('signing in with two steps', () => {
  it('an admin sets it up at the first sign-in, then signs in with the code; the ticket is never a session', async () => {
    const hospital = await createTenant('Sample Hospital');
    const admin = await createUser();
    await addMember(admin, hospital, 'admin');
    const agent = request.agent(required);
    let res = await login(agent, admin);
    expect(res.status).toBe(200);
    expect(res.body.twoStep).toMatchObject({ step: 'setup' });
    expect(res.body.user).toBeUndefined(); // no session yet
    expect(res.headers['set-cookie']).toBeUndefined();
    const { ticket, secret, uri } = res.body.twoStep;
    expect(uri).toContain(`otpauth://totp/Perinexa%3A${encodeURIComponent(admin.email)}?secret=${secret}`);
    // The ticket cannot be used as a session cookie
    expect((await request(required).get('/api/auth/me').set('Cookie', `perinexa_session=${ticket}`)).status).toBe(401);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    // A wrong code, then the right one: two-step sign-in is on, the session starts, the recovery codes are shown once
    res = await agent.post('/api/auth/login/two-step').send({ ticket, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_CODE');
    res = await agent.post('/api/auth/login/two-step').send({ ticket, code: codeNow(secret) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(8);
    expect(res.body.user.twoStep).toMatchObject({ enabled: true });
    expect(res.body.twoStepRequired).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    const recovery = res.body.recoveryCodes;
    expect(await AuditLog.countDocuments({ action: 'TWO_STEP_ENABLED' })).toBe(1);

    // Next time: password, then the code (a fresh one – the one just used is refused)
    const next = request.agent(required);
    res = await login(next, admin);
    expect(res.body.twoStep).toMatchObject({ step: 'code' });
    expect(res.body.twoStep.secret).toBeUndefined();
    const t2 = res.body.twoStep.ticket;
    const used = (await User.findById(admin._id)).twoStep.lastStep;
    const fresh = codeAt(secret, used + 1);
    res = await next.post('/api/auth/login/two-step').send({ ticket: t2, code: fresh });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recoveryCodes).toBeUndefined();
    expect(await AuditLog.findOne({ action: 'LOGIN_SUCCESS', 'details.twoStep': 'code' })).toBeTruthy();

    // A lost phone: a recovery code signs in, once
    const third = request.agent(required);
    const t3 = (await login(third, admin)).body.twoStep.ticket;
    res = await third.post('/api/auth/login/two-step').send({ ticket: t3, code: recovery[0] });
    expect(res.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'TWO_STEP_RECOVERY_USED' })).toBe(1);
    const fourth = request.agent(required);
    const t4 = (await login(fourth, admin)).body.twoStep.ticket;
    expect((await fourth.post('/api/auth/login/two-step').send({ ticket: t4, code: recovery[0] })).status).toBe(400);

    // An admin cannot turn it off; signing out everywhere ends an open ticket
    const off = await agent.post('/api/auth/me/two-step/off').send({ password: PASSWORD, code: recovery[1] });
    expect(off.status).toBe(403);
    await User.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    expect((await fourth.post('/api/auth/login/two-step').send({ ticket: t4, code: recovery[2] })).body.error.code).toBe('TWO_STEP_TICKET_ENDED');
  });

  it('three wrong codes lock the second step for 2 minutes, apart from the password', async () => {
    const sa = await createSuperAdmin();
    const agent = request.agent(required);
    const { ticket } = (await login(agent, sa)).body.twoStep;
    for (let i = 0; i < 2; i += 1) expect((await agent.post('/api/auth/login/two-step').send({ ticket, code: '111111' })).status).toBe(400);
    expect((await agent.post('/api/auth/login/two-step').send({ ticket, code: '111111' })).status).toBe(429);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILED', 'details.reason': 'wrong_two_step_setup_code' })).toBe(3);
  });

  it('staff without an admin role sign in as before, and may turn it on and off themselves', async () => {
    const hospital = await createTenant('Sample Hospital');
    const doctor = await createUser();
    await addMember(doctor, hospital, 'doctor');
    const agent = request.agent(required);
    let res = await login(agent, doctor);
    expect(res.body.twoStep).toBeUndefined();
    expect(res.body.twoStepRequired).toBe(false);
    // Turn on: the password, then the code
    expect((await agent.post('/api/auth/me/two-step/setup').send({ password: 'wrong' })).status).toBe(400);
    res = await agent.post('/api/auth/me/two-step/setup').send({ password: PASSWORD });
    expect(res.status).toBe(200);
    const { secret } = res.body;
    res = await agent.post('/api/auth/me/two-step/confirm').send({ code: codeNow(secret) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(8);
    // Now the code is asked at sign-in
    expect((await login(request.agent(required), doctor)).body.twoStep.step).toBe('code');
    // Off: password and a recovery code
    res = await agent.post('/api/auth/me/two-step/off').send({ password: PASSWORD, code: res.body.recoveryCodes[0] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.twoStep.enabled).toBe(false);
    expect((await login(request.agent(required), doctor)).body.twoStep).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: { $in: ['TWO_STEP_ENABLED', 'TWO_STEP_DISABLED'] } })).toBe(2);
  });

  it('the super admin resets it for someone who lost their phone; they set it up again at the next sign-in', async () => {
    const hospital = await createTenant('Sample Hospital');
    const admin = await createUser();
    await addMember(admin, hospital, 'admin');
    const a = request.agent(required);
    const setup = (await login(a, admin)).body.twoStep;
    await a.post('/api/auth/login/two-step').send({ ticket: setup.ticket, code: codeNow(setup.secret) });
    // The super admin (with their own two-step sign-in) resets it
    const sa = await createSuperAdmin();
    const s = request.agent(required);
    const sSetup = (await login(s, sa)).body.twoStep;
    expect((await s.post('/api/auth/login/two-step').send({ ticket: sSetup.ticket, code: codeNow(sSetup.secret) })).status).toBe(200);
    const res = await s.post(`/api/platform/users/${admin._id}/reset-two-step`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.twoStep.enabled).toBe(false);
    expect((await a.get('/api/auth/me')).status).toBe(401); // signed out everywhere
    expect((await login(request.agent(required), admin)).body.twoStep.step).toBe('setup');
    expect(await AuditLog.countDocuments({ action: 'TWO_STEP_RESET' })).toBe(1);
    // Never for oneself
    expect((await s.post(`/api/platform/users/${sa._id}/reset-two-step`)).status).toBe(400);
  });

  it('the secret, the pending secret and the recovery codes never leave the server', async () => {
    const sa = await createSuperAdmin();
    const agent = request.agent(required);
    const { ticket, secret } = (await login(agent, sa)).body.twoStep;
    const res = await agent.post('/api/auth/login/two-step').send({ ticket, code: codeNow(secret) });
    const stored = await User.findById(sa._id).select('+twoStep.secret +twoStep.recovery').lean();
    expect(stored.twoStep.secret).not.toContain(secret);
    expect(stored.twoStep.recovery).toHaveLength(8);
    expect(stored.twoStep.recovery).not.toContain(res.body.recoveryCodes[0]);
    const me = (await agent.get('/api/auth/me')).body;
    expect(me.user.twoStep).toEqual({ enabled: true, enabledAt: expect.any(String) });
    expect(JSON.stringify(me)).not.toMatch(/secret|recovery|pending/i);
  });
});

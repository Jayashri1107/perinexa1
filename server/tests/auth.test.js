import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LoginLock } from '../src/models/LoginLock.js';
import { User } from '../src/models/User.js';
import { COOKIE_NAME } from '../src/middleware/auth.js';
import {
  PASSWORD,
  addMember,
  connectTestDb,
  createSuperAdmin,
  createTenant,
  createUser,
  disconnectTestDb,
  loginAs,
  resetTestDb,
} from './helpers.js';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

describe('POST /api/auth/login', () => {
  it('logs in with correct details and sets an httpOnly, sameSite cookie', async () => {
    const user = await createUser();
    const tenant = await createTenant();
    await addMember(user, tenant, 'nurse');
    const res = await request(app).post('/api/auth/login').send({ email: user.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.activeTenantId).toBe(tenant._id.toString());
    expect(res.body.memberships).toEqual([{ tenantId: tenant._id.toString(), tenantName: tenant.name, roles: ['nurse'], adminSwitch: false, adminRights: [], joinedAt: expect.any(String) }]);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith(`${COOKIE_NAME}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);

    expect((await User.findById(user._id)).lastLoginAt).toBeInstanceOf(Date);
    const entry = await AuditLog.findOne({ action: 'LOGIN_SUCCESS' });
    expect(entry.tenantId.toString()).toBe(tenant._id.toString());
  });

  it('lands in the hospital the person last worked in', async () => {
    const [a, b] = [await createTenant('Alpha Hospital'), await createTenant('Beta Hospital')];
    const user = await createUser({ lastTenantId: b._id });
    await addMember(user, a);
    await addMember(user, b);
    const s = await loginAs(user, { app });
    expect(s.activeTenantId).toBe(b._id.toString());
    expect(s.body.memberships.map((m) => m.tenantName)).toEqual(['Alpha Hospital', 'Beta Hospital']);
  });

  it('skips hospitals that were deactivated or where access was removed', async () => {
    const [a, b, c] = [await createTenant('A'), await createTenant('B'), await createTenant('C')];
    b.isActive = false;
    await b.save();
    const user = await createUser({ lastTenantId: b._id });
    await addMember(user, a, 'doctor', { isActive: false });
    await addMember(user, b);
    await addMember(user, c);
    const s = await loginAs(user, { app });
    expect(s.activeTenantId).toBe(c._id.toString());
    expect(s.body.memberships).toHaveLength(1);
  });

  it('lets a person with no hospital log in, but without a hospital selected', async () => {
    const user = await createUser();
    const s = await loginAs(user, { app });
    expect(s.activeTenantId).toBeNull();
    expect(s.body.memberships).toEqual([]);
  });

  it('logs a super admin in without a hospital', async () => {
    const admin = await createSuperAdmin();
    const s = await loginAs(admin, { app });
    expect(s.body.user.isSuperAdmin).toBe(true);
    expect(s.activeTenantId).toBeNull();
  });

  it('rejects a wrong password with a generic message and logs it', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password.');
    expect(res.headers['set-cookie']).toBeUndefined();
    const entry = await AuditLog.findOne({ action: 'LOGIN_FAILED' });
    expect(entry.details.reason).toBe('wrong_password');
  });

  it('gives the same answer for an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password.');
  });

  it('does not let a deactivated user log in', async () => {
    const user = await createUser({ isActive: false });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('email');
    expect(res.body.error.fields).toHaveProperty('password');
  });

  // Owner, 19 Oct 2026: 3 wrong passwords in a row lock the email for 2 minutes, with the seconds to count down
  it('locks the email for 2 minutes after 3 wrong passwords – also an unknown email – and a right one clears the count', async () => {
    const user = await createUser();
    const login = (password, email = user.email) => request(app).post('/api/auth/login').send({ email, password });
    expect((await login('wrong-1')).status).toBe(401);
    const second = await login('wrong-2');
    expect(second.body.error.message).toMatch(/One more wrong try/);
    const third = await login('wrong-3');
    expect(third.status).toBe(429);
    expect(third.body.error).toMatchObject({ code: 'LOGIN_LOCKED', retryAfterSeconds: 120 });
    expect(third.headers['retry-after']).toBe('120');
    expect((await AuditLog.findOne({ action: 'LOGIN_LOCKED' }).lean()).details).toMatchObject({ email: user.email, seconds: 120 });
    // Locked: even the right password waits, and is not checked
    const right = await login(PASSWORD);
    expect(right.status).toBe(429);
    expect(right.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(right.headers['set-cookie']).toBeUndefined();
    // Two minutes later: the right password signs in and the count starts again
    await LoginLock.updateOne({ key: `staff:${user.email}` }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(PASSWORD)).status).toBe(200);
    expect(await LoginLock.countDocuments({ key: `staff:${user.email}` })).toBe(0);
    // An unknown email gets exactly the same answers (nothing shows whether an account exists)
    for (let i = 0; i < 2; i++) expect((await login('x', 'nobody@example.com')).status).toBe(401);
    expect((await login('x', 'nobody@example.com')).body.error.code).toBe('LOGIN_LOCKED');
  });

  it('limits repeated login attempts', async () => {
    const limitedApp = createApp({ loginRateLimitMax: 3 });
    for (let i = 0; i < 3; i++) {
      await request(limitedApp).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope' });
    }
    const res = await request(limitedApp).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope' });
    expect(res.status).toBe(429);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_RATE_LIMITED' })).toBe(1);
  });
});

describe('public sign-up', () => {
  it('does not exist', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: PASSWORD });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/auth/me', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('returns the current user, hospitals and selected hospital', async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await addMember(user, tenant, 'receptionist');
    const s = await loginAs(user, { app });
    const res = await s.agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user._id.toString());
    expect(res.body.activeTenantId).toBe(tenant._id.toString());
    expect(res.body.memberships[0].roles).toEqual(['receptionist']);
    expect(res.body.sessionTimeoutMinutes).toBe(30);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it('rejects a forged cookie', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=not-a-real-token`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session so the old cookie no longer works', async () => {
    const user = await createUser();
    const s = await loginAs(user, { app });
    const me = await s.agent.get('/api/auth/me');
    const oldCookie = me.headers['set-cookie'].find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];

    expect((await s.agent.post('/api/auth/logout')).status).toBe(200);
    expect((await s.agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'LOGOUT' })).toBe(1);
  });
});

describe('forced password change', () => {
  it('blocks other pages until the password is changed', async () => {
    const admin = await createSuperAdmin({ mustChangePassword: true });
    const s = await loginAs(admin, { app });

    expect((await s.agent.get('/api/auth/me')).status).toBe(200);
    const blocked = await s.agent.get('/api/platform/tenants');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const res = await s.agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass123' });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    expect((await s.agent.get('/api/platform/tenants')).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'PASSWORD_CHANGED' })).toBe(1);
  });

  it('keeps the selected hospital after changing the password', async () => {
    const tenant = await createTenant();
    const user = await createUser({ mustChangePassword: true });
    await addMember(user, tenant);
    const s = await loginAs(user, { app });
    await s.agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass123' });
    expect((await s.get('/api/patients')).status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const user = await createUser();
    const s = await loginAs(user, { app });
    const res = await s.agent.post('/api/auth/change-password').send({ currentPassword: 'wrong-one-123', newPassword: 'BrandNewPass123' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('currentPassword');
  });

  it('rejects a weak or unchanged new password', async () => {
    const user = await createUser();
    const s = await loginAs(user, { app });
    const weak = await s.agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.fields).toHaveProperty('newPassword');
    const same = await s.agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
  });
});

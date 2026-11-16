// Health check M3 (16 Nov 2026): tries sent all at once are counted before they are checked, so no more than 3 wrong
// tries in a row are ever checked before the 2-minute lock – however many arrive together.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { LOGIN_TRIES } from '../src/auth/loginLock.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PASSWORD, connectTestDb, createUser, disconnectTestDb, resetTestDb } from './helpers.js';

const app = createApp();
beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

describe('many wrong tries at once (health check M3, 16 Nov 2026)', () => {
  it('staff sign-in: at most 3 passwords are checked, the rest wait out the lock – the right password too', async () => {
    const user = await createUser();
    const tries = await Promise.all(Array.from({ length: 12 }, (_, i) => request(app).post('/api/auth/login').send({ email: user.email, password: `wrong-guess-${i}` })));
    const checked = tries.filter((r) => r.body.error?.code === 'INVALID_LOGIN').length;
    const locked = tries.filter((r) => r.status === 429 && r.body.error?.code === 'LOGIN_LOCKED').length;
    expect(checked).toBeLessThanOrEqual(LOGIN_TRIES - 1); // the third wrong one already answers "locked"
    expect(checked + locked).toBe(12);
    // Each password actually checked and found wrong is in the audit log: never more than 3 (before: all 12)
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILED', 'details.email': user.email })).toBeLessThanOrEqual(LOGIN_TRIES);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(429);
  });

  it('a right password after fewer than 3 wrong ones still signs in, and starts the count again', async () => {
    const user = await createUser();
    const login = (password) => request(app).post('/api/auth/login').send({ email: user.email, password });
    expect((await login('wrong-1')).status).toBe(401);
    expect((await login('wrong-2')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(200);
    expect((await login('wrong-3')).status).toBe(401);
    expect((await login('wrong-4')).status).toBe(401);
    expect((await login('wrong-5')).status).toBe(429);
  });
});

// Health check M2 (16 Nov 2026): a session ends SESSION_MAX_HOURS after signing in, however busy, and the lists a page
// reads again by itself do not keep it alive – only a change, or the website's "still here" call (GET /api/auth/me).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { COOKIE_NAME } from '../src/middleware/auth.js';
import { PASSWORD, connectTestDb, createUser, disconnectTestDb, resetTestDb } from './helpers.js';

const app = createApp();
beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

const sessionCookie = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
const claims = (cookie) => jwt.decode(cookie.split(';')[0].slice(COOKIE_NAME.length + 1));

async function signIn() {
  const user = await createUser();
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { user, cookie: sessionCookie(res).split(';')[0] };
}

describe('how long a session lasts (health check M2, 16 Nov 2026)', () => {
  it('remembers when she signed in, and keeps that time as the session is renewed', async () => {
    const { cookie } = await signIn();
    const signedIn = claims(cookie).at;
    expect(Number.isInteger(signedIn)).toBe(true);
    const renewed = sessionCookie(await request(app).get('/api/auth/me').set('Cookie', cookie));
    expect(claims(renewed).at).toBe(signedIn);
  });

  it('is renewed by the "still here" call, not by a list read again in the background', async () => {
    const { cookie } = await signIn();
    expect(sessionCookie(await request(app).get('/api/auth/me').set('Cookie', cookie))).toBeTruthy();
    const background = await request(app).get('/api/me/shortcuts').set('Cookie', cookie);
    expect(background.status).toBe(200);
    expect(sessionCookie(background)).toBeUndefined();
  });

  it(`ends ${config.SESSION_MAX_HOURS} hours after signing in, even while still in use`, async () => {
    const { user } = await signIn();
    const now = Math.floor(Date.now() / 1000);
    const token = (at) => jwt.sign({ sub: String(user._id), tv: user.tokenVersion, at, tid: null }, config.JWT_SECRET, { expiresIn: 30 * 60 });
    const fresh = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=${token(now - 60)}`);
    expect(fresh.status).toBe(200);
    const old = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=${token(now - config.SESSION_MAX_HOURS * 3600 - 60)}`);
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('a session from before this change (no sign-in time) starts its clock now', async () => {
    const { user } = await signIn();
    const legacy = jwt.sign({ sub: String(user._id), tv: user.tokenVersion, tid: null }, config.JWT_SECRET, { expiresIn: 30 * 60 });
    const res = await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=${legacy}`);
    expect(res.status).toBe(200);
    expect(Math.abs(claims(sessionCookie(res)).at - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });
});

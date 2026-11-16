// Going live (20 Oct 2026): many staff of one hospital share one internet address, so the request limit counts per
// signed-in person and the per-address sign-in limit counts wrong tries only; the health check reports the database.
// 21 Oct 2026: the live server's security header lets the website's own WebAssembly and file pictures work, and the
// live server refuses a typed or example secret.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { productionProblems } from '../src/config.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

describe('many staff behind one internet address (a hospital)', () => {
  it('counts the request limit per signed-in person, not per address', async () => {
    const tenant = await createTenant('Shared Address Hospital');
    const busyApp = createApp({ apiRateLimitMax: 5 });
    const a = await createUser();
    const b = await createUser();
    for (const u of [a, b]) await addMember(u, tenant, 'nurse');
    const sa = await loginAs(a, { app: busyApp });
    const sb = await loginAs(b, { app: busyApp });
    for (let i = 0; i < 5; i += 1) expect((await sa.get('/api/auth/me')).status).toBe(200);
    expect((await sa.get('/api/auth/me')).status).toBe(429); // a used up her own budget
    expect((await sb.get('/api/auth/me')).status).toBe(200); // b, same address, is not affected
  });

  it('counts only wrong sign-in tries towards the per-address limit', async () => {
    const limitedApp = createApp({ loginRateLimitMax: 2 });
    const users = [await createUser(), await createUser(), await createUser(), await createUser()];
    for (const u of users) expect((await request(limitedApp).post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(200);
    await request(limitedApp).post('/api/auth/login').send({ email: users[0].email, password: 'wrong-1' });
    await request(limitedApp).post('/api/auth/login').send({ email: users[1].email, password: 'wrong-2' });
    expect((await request(limitedApp).post('/api/auth/login').send({ email: users[2].email, password: PASSWORD })).status).toBe(429);
  });

  it('answers the health check with the database state', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('the live server (21 Oct 2026)', () => {
  it("sends a strict security header that still lets the app's own WebAssembly and file pictures work", async () => {
    const csp = (await request(createApp()).get('/api/health')).headers['content-security-policy'];
    const rule = (name) => csp.split(';').find((d) => d.trim().startsWith(`${name} `)).trim();
    expect(rule('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'"); // never 'unsafe-eval' or 'unsafe-inline'
    expect(rule('img-src')).toBe("img-src 'self' data: blob:");
    expect(rule('default-src')).toBe("default-src 'self'");
    expect(rule('object-src')).toBe("object-src 'none'");
    expect(rule('frame-ancestors')).toBe("frame-ancestors 'self'");
  });

  it('refuses an http address, an insecure cookie and a typed or example secret; accepts random ones', () => {
    const good = { CLIENT_URL: 'https://app.example.in', JWT_SECRET: 'q7Vk2M9xPl4Rt8Wz1Cn6Bf3Hj5Dg0SyAuIoKvXbNmLw-_QeZTyJ', SETUP_CODE: '' }; // as randomBytes(…).toString('base64url') makes
    expect(productionProblems(good)).toEqual([]);
    expect(productionProblems({ ...good, SETUP_CODE: 'Hn3Kq8Zt1Vw6Rb4Ym9Lp2Xc7Jd5Fg0' })).toEqual([]);
    expect(productionProblems({ ...good, CLIENT_URL: 'http://app.example.in' })[0]).toMatch(/https/);
    expect(productionProblems({ ...good, COOKIE_SECURE: 'false' })[0]).toMatch(/COOKIE_SECURE/);
    for (const typed of ['replace-with-a-long-random-secret-at-least-32-characters', 'perinexa-perinexa-perinexa-perinexa', 'aaaaaaaabbbbbbbbccccccccdddddddd']) {
      expect(productionProblems({ ...good, JWT_SECRET: typed })[0], typed).toMatch(/JWT_SECRET looks typed/);
    }
    expect(productionProblems({ ...good, SETUP_CODE: '123456' })[0]).toMatch(/SETUP_CODE is too easy/);
  });
});

// Health check M11 (16 Nov 2026): a large body is read only for someone with a session, and the request limit comes
// before any body is read. A body that is not JSON shows which came first: read first, it would be refused as bad JSON
// (400); checked first, it is refused without being read.
describe('large bodies only after the session (health check M11, 16 Nov 2026)', () => {
  const notJson = 'x'.repeat(2 * 1024 * 1024);
  const upload = (agent) => agent.post('/api/patients/000000000000000000000000/documents').set('Content-Type', 'application/json').send(notJson);

  it('refuses a large upload without a session, or with a forged one, before reading it', async () => {
    const app = createApp();
    const none = await upload(request(app));
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('NOT_AUTHENTICATED');
    const forged = await request(app).post('/api/patients/000000000000000000000000/documents').set('Cookie', 'perinexa_session=not-a-real-token').set('Content-Type', 'application/json').send(notJson);
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('reads it for a signed-in person (bad JSON is then refused as such)', async () => {
    const app = createApp();
    const tenant = await createTenant('Upload Hospital');
    const nurse = await createUser();
    await addMember(nurse, tenant, 'nurse');
    const s = await loginAs(nurse, { app });
    expect((await upload(s)).status).toBe(400);
  });

  it('counts the request limit before reading the body', async () => {
    const app = createApp({ apiRateLimitMax: 1 });
    const post = () => request(app).post('/api/visits/whatever').set('Content-Type', 'application/json').send('{not json');
    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(429);
  });
});

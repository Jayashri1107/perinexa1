// Going live (20 Oct 2026): many staff of one hospital share one internet address, so the request limit counts per
// signed-in person and the per-address sign-in limit counts wrong tries only; the health check reports the database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
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

// Several copies of the server behind one address (20 Oct 2026): what one copy keeps, every copy sees.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { SharedState } from '../src/models/SharedState.js';
import { MongoRateLimitStore, drop, get, put, takeTurn } from '../src/utils/sharedState.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

describe('shared working state', () => {
  it('keeps a value until its time, and a secret one only encrypted', async () => {
    await put('t', 'a', { n: 1 }, Date.now() + 60_000);
    expect(await get('t', 'a')).toEqual({ n: 1 });
    await put('t', 's', { token: 'fake-token-123', name: 'Sample Mother' }, Date.now() + 60_000, { secret: true });
    expect(await get('t', 's')).toEqual({ token: 'fake-token-123', name: 'Sample Mother' });
    const raw = JSON.stringify(await SharedState.findById('t:s').lean());
    expect(raw).not.toMatch(/fake-token-123|Sample Mother/);
    await put('t', 'old', { n: 2 }, Date.now() - 1);
    expect(await get('t', 'old')).toBeNull();
    await drop('t', 'a');
    expect(await get('t', 'a')).toBeNull();
  });

  it('counts requests in one place, starting again when the window ends', async () => {
    const one = new MongoRateLimitStore('x');
    const two = new MongoRateLimitStore('x'); // another copy of the server
    one.init({ windowMs: 60_000 });
    two.init({ windowMs: 60_000 });
    expect((await one.increment('k')).totalHits).toBe(1);
    expect((await two.increment('k')).totalHits).toBe(2);
    await Promise.all([1, 2, 3].map(() => one.increment('k')));
    expect((await two.get('k')).totalHits).toBe(5);
    await two.decrement('k');
    expect((await one.get('k')).totalHits).toBe(4);
    await SharedState.updateOne({ _id: 'rl:x:k' }, { $set: { until: new Date(Date.now() - 1) } });
    expect((await one.increment('k')).totalHits).toBe(1);
  });

  it('gives each background-job round to one copy only', async () => {
    const rounds = await Promise.all([1, 2, 3, 4].map(() => takeTurn('test-job', 60_000)));
    expect(rounds.filter(Boolean)).toHaveLength(1);
    await SharedState.updateOne({ _id: 'job:test-job' }, { $set: { until: new Date(Date.now() - 1) } });
    expect(await takeTurn('test-job', 60_000)).toBe(true); // the round ended: taken again
  });
});

describe('two copies of the server share one request limit per person', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_STORE = 'database';
  });
  afterEach(() => {
    delete process.env.RATE_LIMIT_STORE;
  });

  it('a person who used her limit on one copy is limited on the other too', async () => {
    const tenant = await createTenant('Two Copies Hospital');
    const user = await createUser();
    await addMember(user, tenant, 'nurse');
    const copyA = createApp({ apiRateLimitMax: 4 });
    const copyB = createApp({ apiRateLimitMax: 4 });
    const session = await loginAs(user, { app: copyA });
    const cookie = (await request(copyA).post('/api/auth/login').send({ email: user.email, password: 'SamplePassw0rd!' })).headers['set-cookie'];
    for (let i = 0; i < 2; i += 1) expect((await session.get('/api/auth/me')).status).toBe(200);
    for (let i = 0; i < 2; i += 1) expect((await request(copyB).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((await request(copyB).get('/api/auth/me').set('Cookie', cookie)).status).toBe(429);
    expect((await session.get('/api/auth/me')).status).toBe(429);
  });
});

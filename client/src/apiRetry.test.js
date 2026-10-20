import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, retryDelay, shouldRetry } from './api.js';

describe('trying again while a server copy restarts (scaling out, 20 Oct 2026)', () => {
  beforeEach(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('tries again only when reading, after no answer or a restart answer, at most 3 times', () => {
    for (const status of [0, 502, 503, 504]) expect(shouldRetry('GET', status, 0)).toBe(true);
    expect(shouldRetry('GET', 503, 2)).toBe(true);
    expect(shouldRetry('GET', 503, 3)).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 429, 500]) expect(shouldRetry('GET', status, 0)).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(shouldRetry(method, 503, 0)).toBe(false); // never saves twice
    expect([0, 1, 2, 5].map(retryDelay)).toEqual([500, 1500, 3000, 3000]);
  });

  it('a page that loads while the server restarts gets its answer after the restart', async () => {
    vi.useFakeTimers();
    const answers = [new Response('', { status: 503 }), new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })];
    const fetchMock = vi.fn(async () => answers.shift());
    vi.stubGlobal('fetch', fetchMock);
    const pending = api('/health');
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('a save is sent once, even when the server is restarting', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/patients', { method: 'POST', body: {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

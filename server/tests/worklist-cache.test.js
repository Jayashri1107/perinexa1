// A person's worklist kept for a few seconds (load test, 20 Oct 2026): worked out once when asked several times
// together, kept per person, forgotten when that person saves something.
import { describe, expect, it } from 'vitest';
import { cachedWorklist, forgetWorklists } from '../src/utils/worklistCache.js';

describe('the short worklist memory', () => {
  it('works it out once for requests that come together, then keeps it for that person only', async () => {
    let runs = 0;
    const work = () => new Promise((r) => setTimeout(() => r({ n: (runs += 1) }), 20));
    const together = await Promise.all([1, 2, 3].map(() => cachedWorklist('u1|t1|', 15, work)));
    expect(together.map((d) => d.n)).toEqual([1, 1, 1]);
    expect((await cachedWorklist('u1|t1|', 15, work)).n).toBe(1); // kept
    expect((await cachedWorklist('u2|t1|', 15, work)).n).toBe(2); // another person: her own
    forgetWorklists('u1'); // u1 saved something
    expect((await cachedWorklist('u1|t1|', 15, work)).n).toBe(3);
    expect((await cachedWorklist('u2|t1|', 15, work)).n).toBe(2);
  });

  it('keeps nothing when switched off, and never keeps a failure', async () => {
    let runs = 0;
    const work = async () => ({ n: (runs += 1) });
    expect((await cachedWorklist('u3|t1|', 0, work)).n).toBe(1);
    expect((await cachedWorklist('u3|t1|', 0, work)).n).toBe(2);
    await expect(cachedWorklist('u4|t1|', 15, async () => { throw new Error('database down'); })).rejects.toThrow('database down');
    expect((await cachedWorklist('u4|t1|', 15, work)).n).toBe(3);
  });
});

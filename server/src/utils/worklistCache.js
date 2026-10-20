// A person's worklist for a few seconds (WORKLIST_CACHE_SECONDS, load test 20 Oct 2026): the whole-hospital list
// reads every pregnant patient's care plan (about 2 seconds for 500), so opening it again – or several tabs and
// screens asking at once – shares one answer instead of working it all out again. Per person and scope, so each
// person still sees only what they may see. Anything that person saves (any change request) forgets their lists at
// once, so their own changes always show; other people's changes show within those few seconds.
// In this copy's memory: a list is never shared between people or copies.

const lists = new Map(); // `${userId}|${tenantId}|${scope}` -> { at, value?: data, promise?: Promise<data> }

/** The worklist from the last few seconds, or worked out now (once, even when asked for several times together). */
export async function cachedWorklist(key, seconds, work) {
  if (!seconds) return work();
  const hit = lists.get(key);
  if (hit && (hit.promise || Date.now() - hit.at < seconds * 1000)) return hit.promise ?? hit.value;
  const promise = work();
  lists.set(key, { at: Date.now(), promise });
  try {
    const value = await promise;
    if (lists.get(key)?.promise === promise) lists.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    lists.delete(key);
    throw err;
  }
}

/** Forgets one person's lists (they saved something). */
export function forgetWorklists(userId) {
  const prefix = `${userId}|`;
  for (const key of lists.keys()) if (key.startsWith(prefix)) lists.delete(key);
}

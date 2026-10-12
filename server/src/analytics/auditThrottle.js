// "Analytics opened" is written at most once per person, hospital, section and scope every 10 minutes, so
// moving between tabs doesn't fill the audit log. Kept in memory (it starts afresh when the server restarts).

export const VIEW_LOG_INTERVAL_MS = 10 * 60 * 1000;
const lastLogged = new Map();

/** true when this view should be written to the audit log now (and remembers it). */
export function shouldLogView(key, now = new Date()) {
  const t = new Date(now).getTime();
  const last = lastLogged.get(key);
  if (last != null && t - last < VIEW_LOG_INTERVAL_MS) return false;
  lastLogged.set(key, t);
  if (lastLogged.size > 10_000) {
    for (const [k, v] of lastLogged) if (t - v >= VIEW_LOG_INTERVAL_MS) lastLogged.delete(k);
  }
  return true;
}

/** For tests. */
export const resetAnalyticsAuditThrottle = () => lastLogged.clear();

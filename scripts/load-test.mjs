// Many people using Perinexa at once – a check before going live (20 Oct 2026). FAKE DEMO ACCOUNTS ONLY.
//
//   node scripts/load-test.mjs [--users 40] [--seconds 60] [--think 1000] [--url http://localhost:4000]
//
// Each pretend user signs in with one of the demo accounts (`scripts/load-test-seed.mjs`, password DEMO_PASSWORD from
// server/.env) and opens the screens that person would open – Today, the worklist, patient lists and records, lab and
// scan lists – waiting about --think milliseconds between clicks (0 = as fast as possible). At the end: how many
// requests, how fast (half of them faster than "p50", 95 in 100 faster than "p95"), and any failures.
// Reads only: it never saves anything. Never point it at a server with real patients.
//
// Runs against the API directly (default http://localhost:4000), so the browser's own limits are not involved.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const USERS = Number(args.users ?? 40);
const SECONDS = Number(args.seconds ?? 60);
const THINK_MS = Number(args.think ?? 1000);
const BASE = (args.url ?? 'http://localhost:4000').replace(/\/$/, '');

function demoPassword() {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  const envFile = readFileSync(fileURLToPath(new URL('../server/.env', import.meta.url)), 'utf8');
  const line = envFile.split(/\r?\n/).find((l) => l.startsWith('DEMO_PASSWORD='));
  if (!line) throw new Error('DEMO_PASSWORD is not set in server/.env');
  return line.slice('DEMO_PASSWORD='.length).trim();
}

// What each kind of demo account opens (GET only)
const today = new Date().toISOString().slice(0, 10);
const SCREENS = {
  'demo.doctor@example.com': ['/auth/me', '/worklist', '/inpatients', '/lab/to-review', '/usg/to-confirm', '/today', '/patients?limit=1&risk=high&doctor=all', '/patients?limit=25', '/patients?limit=25&search=demo', 'RECORD'],
  'demo.doctor2@example.com': ['/auth/me', '/worklist', '/today', '/patients?limit=25&doctor=me', 'RECORD', 'RECORD'],
  'demo.rmo@example.com': ['/auth/me', '/worklist', '/inpatients', '/today', '/patients?limit=25', 'RECORD'],
  'demo.nurse@example.com': ['/auth/me', '/worklist', '/inpatients', '/patients?limit=25', 'RECORD'],
  'demo.reception@example.com': ['/auth/me', '/today', `/appointments/day?date=${today}`, '/appointments/queue', '/patients?limit=25&search=a', '/arrivals'],
  'demo.lab@example.com': ['/auth/me', '/lab/worklist', '/patients?limit=25&search=demo'],
  'demo.sonologist@example.com': ['/auth/me', '/usg/worklist', '/patients?limit=25&search=demo'],
  'demo.admin@example.com': ['/auth/me', '/tenant/members?limit=25', '/tenant/audit-logs?limit=25', '/billing/bills'],
};
const ACCOUNTS = Object.keys(SCREENS);

const timings = new Map(); // screen → [ms]
const failures = new Map(); // "screen status" → count
let refused = 0; // 4xx other than 429: the role may not open it (not a server problem)
const note = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

async function call(session, path, label = path) {
  const started = performance.now();
  let status = 0;
  let body = null;
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      headers: { Cookie: session.cookie, ...(session.tenantId ? { 'X-Tenant-Id': session.tenantId } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    status = 'timeout/no answer';
  }
  const ms = performance.now() - started;
  const key = label.replace(/[0-9a-f]{24}/g, ':id').replace(/search=[^&]*/, 'search=…');
  note(timings, key, ms);
  if (status === 429 || status === 'timeout/no answer' || status >= 500) count(failures, `${key} → ${status}`);
  else if (status >= 400) refused += 1;
  return body;
}

async function signIn(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (res.status !== 200) throw new Error(`Sign-in failed for ${email}: ${res.status} – run scripts/load-test-seed.mjs, and check DEMO_PASSWORD`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const data = await res.json();
  return { email, cookie, tenantId: data.activeTenantId, patientIds: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pretendUser(session, until) {
  const screens = SCREENS[session.email];
  while (Date.now() < until) {
    const screen = screens[Math.floor(Math.random() * screens.length)];
    if (screen === 'RECORD') {
      if (!session.patientIds.length) {
        const list = await call(session, '/patients?limit=25');
        session.patientIds = (list?.patients ?? list?.items ?? []).map((p) => p.id).filter(Boolean);
      }
      const id = session.patientIds[Math.floor(Math.random() * session.patientIds.length)];
      if (id) await call(session, `/patients/${id}`, '/patients/:id');
    } else {
      await call(session, screen);
    }
    if (THINK_MS) await sleep(THINK_MS * (0.5 + Math.random()));
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const fmt = (ms) => `${Math.round(ms)} ms`;

async function main() {
  const password = demoPassword();
  console.log(`Signing in ${USERS} pretend users (demo accounts) at ${BASE} …`);
  const sessions = [];
  const signInStarted = performance.now();
  const missing = new Set();
  for (let i = 0; i < USERS; i += 10) {
    const batch = Array.from({ length: Math.min(10, USERS - i) }, (_, k) => signIn(ACCOUNTS[(i + k) % ACCOUNTS.length], password));
    for (const r of await Promise.allSettled(batch)) {
      if (r.status === 'fulfilled') sessions.push(r.value);
      else missing.add(r.reason.message);
    }
  }
  for (const m of missing) console.log(`  skipped: ${m}`);
  if (!sessions.length) throw new Error('No demo account could sign in – run scripts/load-test-seed.mjs, and check DEMO_PASSWORD');
  console.log(`  ${sessions.length} signed in, ${fmt((performance.now() - signInStarted) / sessions.length)} each on average.`);
  console.log(`Using the app for ${SECONDS} seconds (about ${THINK_MS} ms between clicks) …`);
  const started = Date.now();
  await Promise.all(sessions.map((s) => pretendUser(s, started + SECONDS * 1000)));
  const took = (Date.now() - started) / 1000;

  const all = [...timings.values()].flat().sort((a, b) => a - b);
  const failed = [...failures.values()].reduce((a, b) => a + b, 0);
  console.log(`\nRequests: ${all.length} in ${took.toFixed(0)} s (${(all.length / took).toFixed(1)} a second)`);
  console.log(`All screens: p50 ${fmt(pct(all, 50))}, p95 ${fmt(pct(all, 95))}, p99 ${fmt(pct(all, 99))}, slowest ${fmt(all.at(-1) ?? 0)}`);
  console.log(`Failures (server errors, limits, no answer): ${failed}${refused ? `; refused for the role (expected): ${refused}` : ''}`);
  console.log('\nBy screen (slowest first):');
  const rows = [...timings.entries()].map(([k, v]) => {
    const s = [...v].sort((a, b) => a - b);
    return { k, n: s.length, p50: pct(s, 50), p95: pct(s, 95), max: s.at(-1) };
  });
  for (const r of rows.sort((a, b) => b.p95 - a.p95)) console.log(`  ${r.k.padEnd(48)} ${String(r.n).padStart(5)}×  p50 ${fmt(r.p50).padStart(7)}  p95 ${fmt(r.p95).padStart(7)}  max ${fmt(r.max).padStart(7)}`);
  if (failed) {
    console.log('\nFailures:');
    for (const [k, n] of failures) console.log(`  ${k}: ${n}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

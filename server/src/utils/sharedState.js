// Shared working state for every copy of the server (models/SharedState.js), so Perinexa can run as several copies
// behind one address and nothing depends on which copy answers a request.
//  - put / get / drop: short-lived values (with { secret: true } stored encrypted, AES-256-GCM, with a key derived
//    from JWT_SECRET – never the key itself in the database);
//  - MongoRateLimitStore: express-rate-limit's counts in the database instead of one server's memory;
//  - takeTurn: which copy runs a background job this round.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { SharedState } from '../models/SharedState.js';

const id = (ns, key) => `${ns}:${key}`;
// The computer's real time (Date may be frozen in tests), plus a day of margin, for MongoDB's own clean-up
const purgeAfter = (until) => new Date(performance.timeOrigin + performance.now() + Math.max(0, new Date(until) - Date.now()) + 24 * 3600 * 1000);
const cipherKey = () => createHmac('sha256', config.JWT_SECRET).update('perinexa-shared-state-v1').digest();

function seal(value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
function open(text) {
  const [iv, tag, data] = String(text).split('.').map((p) => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', cipherKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

/** Keeps `value` under ns/key until `until` (a Date or milliseconds since 1970). */
export async function put(ns, key, value, until, { secret = false } = {}) {
  const at = new Date(until);
  const kept = secret ? { value: null, secret: seal(value) } : { value, secret: null };
  await SharedState.updateOne({ _id: id(ns, key) }, { $set: { ...kept, until: at, purgeAt: purgeAfter(at) } }, { upsert: true });
}

/** The value under ns/key, or null when there is none or its time has passed. */
export async function get(ns, key) {
  const doc = await SharedState.findById(id(ns, key)).lean();
  if (!doc || doc.until <= new Date()) return null;
  try {
    return doc.secret ? open(doc.secret) : doc.value;
  } catch {
    return null; // sealed with another JWT_SECRET: as if gone
  }
}

export const drop = (ns, key) => SharedState.deleteOne({ _id: id(ns, key) });

/** Tests only: forgets a whole namespace, as a restart of a single server did. */
export const dropAll = (ns) => SharedState.deleteMany({ _id: { $regex: `^${ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:` } });

/**
 * express-rate-limit's store in the database: every copy of the server counts the same requests. One update per
 * request (an index lookup by id). The count starts again when its window ends.
 */
export class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = `rl:${prefix}`;
    this.localKeys = false; // shared between copies
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async get(key) {
    const doc = await SharedState.findById(id(this.prefix, key)).lean();
    if (!doc || doc.until <= new Date()) return undefined;
    return { totalHits: doc.count, resetTime: doc.until };
  }

  async increment(key) {
    const now = new Date();
    const _id = id(this.prefix, key);
    const resetAt = new Date(now.getTime() + this.windowMs);
    // A window that has ended starts again at 1 (in one step, so two copies never both reset it)
    const fresh = await SharedState.findOneAndUpdate(
      { _id, until: { $lte: now } },
      { $set: { count: 1, until: resetAt, purgeAt: purgeAfter(resetAt) } },
      { new: true },
    ).lean();
    if (fresh) return { totalHits: 1, resetTime: fresh.until };
    try {
      const doc = await SharedState.findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { until: resetAt, purgeAt: purgeAfter(resetAt) } }, { new: true, upsert: true }).lean();
      return { totalHits: doc.count, resetTime: doc.until };
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const doc = await SharedState.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { new: true }).lean(); // another copy made it first
      return { totalHits: doc.count, resetTime: doc.until };
    }
  }

  async decrement(key) {
    await SharedState.updateOne({ _id: id(this.prefix, key), count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async resetKey(key) {
    await SharedState.deleteOne({ _id: id(this.prefix, key) });
  }
}

/** Whether several copies of the server share this database (RATE_LIMIT_STORE=database, the live default). */
export const sharedAcrossCopies = () => (process.env.RATE_LIMIT_STORE || config.RATE_LIMIT_STORE) === 'database';

/** The store for a request limit: the database when RATE_LIMIT_STORE=database (several copies), else memory. */
export const rateLimitStore = (prefix) => (sharedAcrossCopies() ? new MongoRateLimitStore(prefix) : undefined);

// This copy's name for background-job turns
const COPY = randomUUID();

/**
 * Whether this copy runs `job` now: true for exactly one copy per round of `everyMs`. A copy that stops keeps its
 * turn only until the round ends, so another copy takes over by itself.
 */
export async function takeTurn(job, everyMs) {
  const now = new Date();
  const until = new Date(now.getTime() + Math.max(1000, everyMs - 5000));
  try {
    const res = await SharedState.updateOne(
      { _id: id('job', job), $or: [{ until: { $lte: now } }, { 'value.copy': COPY }] },
      { $set: { value: { copy: COPY, at: now }, until, purgeAt: purgeAfter(until) } },
      { upsert: true },
    );
    return res.modifiedCount + res.upsertedCount > 0;
  } catch (err) {
    if (err?.code === 11000) return false; // another copy has this round
    throw err;
  }
}

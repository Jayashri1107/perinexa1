import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/index.js';
import { readSessionToken, verifySessionToken } from '../core/session.js';

const minutes = (m) => m * 60 * 1000;
const addressKey = (req) => `ip:${ipKeyGenerator(req.ip)}`;

// The whole API, per signed-in person (per browser address before signing in). A hospital's computers usually reach
// the server through one internet address, so counting per address would make 30–50 colleagues share one limit and
// see "Too many requests" on a busy morning; counted per person, each has their own.
export const apiLimiter = rateLimit({
  windowMs: minutes(config.rateLimit.api.windowMinutes),
  limit: config.rateLimit.api.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const session = verifySessionToken(readSessionToken(req) ?? '');
    return session?.sub ? `user:${session.sub}` : addressKey(req);
  },
  message: { error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
});

// Login attempts. Per account and address (`max`): guessing one account's password is stopped, while colleagues
// signing in from the same hospital network are not. Per address for all accounts (`perAddressMax`): trying many
// accounts from one place is stopped too. onLimit is called once a limit is reached (the auth module writes the audit
// entry).
export function loginLimiter(onLimit) {
  const { windowMinutes, max, perAddressMax } = config.rateLimit.login;
  const options = (limit, keyGenerator) =>
    rateLimit({
      windowMs: minutes(windowMinutes),
      limit,
      keyGenerator,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: async (req, res) => {
        await onLimit(req);
        res.status(429).json({
          error: { message: `Too many login attempts. Please wait ${windowMinutes} minutes and try again.`, code: 'RATE_LIMITED' },
        });
      },
    });
  const email = (req) => String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
  return [options(perAddressMax, addressKey), options(max, (req) => `${addressKey(req)}|${email(req)}`)];
}

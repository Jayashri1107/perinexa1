import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

const minutes = (m) => m * 60 * 1000;

// The whole API, per browser address.
export const apiLimiter = rateLimit({
  windowMs: minutes(config.rateLimit.api.windowMinutes),
  limit: config.rateLimit.api.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
});

// Login attempts. onLimit is called once the limit is reached (the auth module writes the audit entry).
export function loginLimiter(onLimit) {
  const { windowMinutes, max } = config.rateLimit.login;
  return rateLimit({
    windowMs: minutes(windowMinutes),
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: async (req, res) => {
      await onLimit(req);
      res.status(429).json({
        error: { message: `Too many login attempts. Please wait ${windowMinutes} minutes and try again.`, code: 'RATE_LIMITED' },
      });
    },
  });
}

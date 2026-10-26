import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const handler = (_req, _res, next) => {
  next(ApiError.tooMany());
};

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  // Rate limits get in the way while developing locally.
  skip: () => env.isDev && process.env.DISABLE_RATE_LIMIT === 'true',
};

/** Broad protection for the whole API surface. */
export const generalLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 });

/** Tight limit on credential endpoints to blunt password guessing. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  // Count per email as well as per IP so one shared NAT does not lock out a
  // whole office, while a single targeted account is still protected.
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
});

export const writeLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 60 });

export const uploadLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 30 });

/** Checkout is both expensive and abuse-prone. */
export const checkoutLimiter = rateLimit({ ...base, windowMs: 10 * 60 * 1000, limit: 25 });

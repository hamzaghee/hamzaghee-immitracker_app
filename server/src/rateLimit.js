/**
 * Rate limiting.
 *
 * Two budgets are enforced on the endpoints that cost real work — 10 requests
 * per minute and 100 per 24 hours — because report generation runs a language
 * model and PDF rendering drives a browser. An uncapped expensive endpoint is a
 * denial-of-service invitation.
 *
 * Progress polling is deliberately on a separate, generous budget. The report
 * page polls job status roughly every 1.5s while the model works, so a single
 * two-minute report is ~80 status requests on its own. Counting those against
 * the 10/minute budget would break the app within seconds of the first report —
 * the limit is meant to stop abuse, not normal use.
 *
 * Counting is per-IP and in-memory, which is correct for a single instance. A
 * multi-instance deployment needs a shared store (Redis) or the budget is
 * effectively multiplied by the instance count.
 */

import rateLimit from 'express-rate-limit';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 10;
const PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY) || 100;
/** Enough headroom for several concurrent reports polling at ~1.5s. */
const POLL_PER_MINUTE = Number(process.env.RATE_LIMIT_POLL_PER_MINUTE) || 300;

/** Consistent JSON shape so the frontend can surface a useful message. */
const handler = (scope) => (req, res) => {
  const retryAfter = Number(res.getHeader('Retry-After')) || undefined;
  res.status(429).json({
    error:
      scope === 'day'
        ? `Daily limit of ${PER_DAY} requests reached. Try again later.`
        : `Rate limit reached (${PER_MINUTE} requests per minute). Please wait a moment.`,
    code: 'RATE_LIMITED',
    retryAfterSeconds: retryAfter,
  });
};

const base = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Don't spend budget on requests that failed for reasons outside the caller's
  // control; a 500 shouldn't also cost them their quota.
  skipFailedRequests: false,
};

/** 10/minute on the expensive, mutating endpoints. */
export const perMinuteLimiter = rateLimit({
  ...base,
  windowMs: MINUTE,
  limit: PER_MINUTE,
  handler: handler('minute'),
});

/** 100/day on the same endpoints. */
export const perDayLimiter = rateLimit({
  ...base,
  windowMs: DAY,
  limit: PER_DAY,
  handler: handler('day'),
});

/** Generous budget for job-status polling, which is automatic and frequent. */
export const pollLimiter = rateLimit({
  ...base,
  windowMs: MINUTE,
  limit: POLL_PER_MINUTE,
  handler: handler('minute'),
});

/** Both budgets, applied in order. */
export const costlyLimiters = [perMinuteLimiter, perDayLimiter];

/**
 * Login attempts. Tight on purpose: there is exactly one shared password, so
 * without a low ceiling it is guessable by brute force given enough tries.
 * Successful logins are not counted, so a legitimate operator is never locked
 * out by their own sessions.
 */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * MINUTE,
  limit: Number(process.env.RATE_LIMIT_LOGIN) || 8,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({
      error: 'Too many sign-in attempts. Try again shortly.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: Number(res.getHeader('Retry-After')) || undefined,
    }),
});

/**
 * Whether to trust X-Forwarded-For when identifying clients.
 *
 * Off by default and deliberately so: with a permissive setting behind no proxy,
 * a caller can spoof the header and reset their own counter, which defeats the
 * limiter entirely. Set TRUST_PROXY to the number of proxies in front of the
 * app when deploying behind one.
 */
export const trustProxySetting = () => {
  const v = process.env.TRUST_PROXY;
  if (v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};

/**
 * Single shared password for the production deployment.
 *
 * Not user accounts — one operator, one password. The important property is
 * that the gate sits on the **API**, not on the screen. A login page that only
 * hides the UI leaves every endpoint reachable by anyone who knows the URL,
 * which for this app means the uploaded case data.
 *
 * The session is a signed cookie rather than server-side state, so it survives
 * restarts and needs no store.
 */

import crypto from 'node:crypto';
import { isProduction } from './config.js';

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const COOKIE = 'immitracker_session';
const MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_HOURS || 12) * 60 * 60 * 1000;

/**
 * Refuse to start a production deployment without credentials.
 *
 * Falling back to a default password would be worse than failing: the app would
 * come up looking protected while being trivially accessible.
 */
export function assertAuthConfigured() {
  if (!isProduction()) return;
  const missing = [];
  if (!PASSWORD) missing.push('APP_PASSWORD');
  if (!SECRET) missing.push('SESSION_SECRET');
  if (missing.length) {
    throw new Error(
      `Production mode requires ${missing.join(' and ')}. ` +
        'Set them, or run the public demo with APP_MODE=demo.'
    );
  }
}

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

/** Compares without leaking length or position through timing. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const makeToken = () => {
  const payload = String(Date.now() + MAX_AGE_MS);
  return `${payload}.${sign(payload)}`;
};

function tokenValid(token) {
  if (!token || !SECRET) return false;
  const [payload, mac] = String(token).split('.');
  if (!payload || !mac) return false;
  // Verify the signature before trusting the expiry it carries.
  if (!safeEqual(mac, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/** Minimal cookie parsing — avoids a dependency for one header. */
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export const isAuthenticated = (req) => tokenValid(readCookie(req, COOKIE));

export function issueSession(res, { secure }) {
  const attrs = [
    `${COOKIE}=${makeToken()}`,
    'Path=/',
    'HttpOnly', // not readable from JavaScript, so XSS cannot exfiltrate it
    'SameSite=Lax', // blocks the cookie on cross-site POSTs
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export const checkPassword = (candidate) =>
  Boolean(PASSWORD) && typeof candidate === 'string' && safeEqual(candidate, PASSWORD);

/**
 * Guards the API. Open in demo mode; in production everything is protected
 * except health and the login route itself.
 */
export function requireAuth(openPaths = []) {
  const open = new Set(openPaths);
  return (req, res, next) => {
    if (!isProduction()) return next();
    // Compare against the full path. When this is mounted with
    // app.use('/api', …), req.path is relative to the mount point, so matching
    // on it would silently never match a '/api/…' entry.
    const fullPath = (req.originalUrl || req.url).split('?')[0];
    if (open.has(fullPath)) return next();
    if (isAuthenticated(req)) return next();

    next(
      Object.assign(new Error('Authentication required.'), {
        status: 401,
        code: 'AUTH_REQUIRED',
      })
    );
  };
}

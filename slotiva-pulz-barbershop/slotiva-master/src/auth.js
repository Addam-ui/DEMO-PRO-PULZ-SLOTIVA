import { config } from './config.js';
import { sign, safeEqual } from './crypto.js';
import { getUserRow } from './users.js';
import { AppError } from './errors.js';

const COOKIE_NAME = 'slotiva_session';
const MAX_AGE_MS = 30 * 24 * 3600_000;
const RENEW_BEFORE_MS = 7 * 24 * 3600_000;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* poškozená cookie – ignorovat */
    }
  }
  return out;
}

// SameSite=Lax: cookie musí přežít návrat z přihlášení Google (přesměrování z cizí domény).
// Proti CSRF chrání kontrola Origin a JSON u všech změn (http.js).
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/' });

export function startSession(res, user) {
  const payload = ['v1', user.id, user.session_version, Date.now() + MAX_AGE_MS].join('.');
  res.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, { ...cookieOptions(), maxAge: MAX_AGE_MS });
}

export function endSession(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Vrátí přihlášeného uživatele z cookie, nebo null. */
export function readSession(req) {
  const value = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const payload = value.slice(0, i);
  if (!safeEqual(value.slice(i + 1), sign(payload))) return null;
  const [version, id, sessionVersion, expires] = payload.split('.');
  if (version !== 'v1' || !(Number(expires) > Date.now())) return null;
  const user = getUserRow(Number(id));
  if (!user || user.session_version !== Number(sessionVersion)) return null;
  if (user.blocked_at) return null; // zablokovaný účet se chová jako odhlášený
  return { user, expires: Number(expires) };
}

export function requireUser(req, res, next) {
  const session = readSession(req);
  if (!session) return next(new AppError(401, 'Nejste přihlášeni.'));
  if (session.expires - Date.now() < RENEW_BEFORE_MS) startSession(res, session.user);
  req.user = session.user;
  next();
}

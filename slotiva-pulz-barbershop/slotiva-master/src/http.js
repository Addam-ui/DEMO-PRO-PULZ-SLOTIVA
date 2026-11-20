import { config } from './config.js';
import { AppError } from './errors.js';

/** Stránky, které nesmí být vložené do cizího webu (dashboard, přihlášení, úvod). */
const PRIVATE_PREFIXES = ['/app', '/api/app', '/api/auth', '/auth', '/prihlaseni', '/registrace', '/zapomenute-heslo', '/nove-heslo'];

function isPrivatePath(path) {
  return path === '/' || PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Bezpečnostní hlavičky. Rezervační stránky smí být ve <iframe> na povolených webech, dashboard nikdy. */
export function securityHeaders(req, res, next) {
  const isPrivate = isPrivatePath(req.path);
  const frameAncestors = isPrivate
    ? "'none'"
    : config.embedOrigins.includes('*') ? '*' : ["'self'", ...config.embedOrigins].join(' ');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; '));
  if (isPrivate) res.setHeader('X-Frame-Options', 'DENY');
  next();
}

/** Jednoduchý limit požadavků v paměti. */
export function rateLimit({ windowMs, max, message, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(new AppError(429, message || 'Příliš mnoho požadavků. Zkuste to prosím za chvíli.'));
    }
    next();
  };
}

/** Ochrana proti CSRF: změny přes API jen jako JSON ze stejného původu. */
export function sameOriginJson(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* neplatný origin */
    }
    if (originHost !== host) return next(new AppError(403, 'Neplatný původ požadavku.'));
  }
  if (req.headers['content-length'] !== '0' && req.body !== undefined && !req.is('application/json')) {
    return next(new AppError(415, 'Očekáván JSON.'));
  }
  next();
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neplatný JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Požadavek je příliš velký.' });
  console.error('✖  Neočekávaná chyba:', err);
  res.status(500).json({ error: 'Na serveru nastala chyba. Zkuste to prosím znovu.' });
}

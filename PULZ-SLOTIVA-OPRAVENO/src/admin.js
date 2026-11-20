/* Správcovská část – přehled celé platformy a správa uživatelských účtů.
   Vše tady vidí jen účet s příznakem is_admin (viz ADMIN_EMAILS v .env). */

import { config } from './config.js';
import { db, nowIso } from './db.js';
import { notFound, badRequest } from './errors.js';
import { randomToken, sha256 } from './crypto.js';
import { getUserRow, isAdminEmail } from './users.js';
import { getSettings } from './settings.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Souhrnná čísla za celou platformu. */
export function platformStats() {
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;
  const month = daysAgo(30);
  const now = nowIso();
  return {
    users: {
      total: one('SELECT COUNT(*) AS n FROM users'),
      new30: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', month),
      active30: one('SELECT COUNT(DISTINCT user_id) AS n FROM bookings WHERE created_at >= ?', month),
      blocked: one('SELECT COUNT(*) AS n FROM users WHERE blocked_at IS NOT NULL'),
      withCalendar: one("SELECT COUNT(*) AS n FROM google_connections WHERE status = 'ok'"),
    },
    bookings: {
      total: one('SELECT COUNT(*) AS n FROM bookings'),
      new30: one('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', month),
      upcoming: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND start_utc >= ?", now),
    },
    problems: {
      calendarLost: one("SELECT COUNT(*) AS n FROM google_connections WHERE status <> 'ok'"),
      unsynced: one('SELECT COUNT(*) AS n FROM bookings WHERE google_pending IS NOT NULL'),
    },
    server: {
      googleEnabled: config.google.enabled,
      registration: config.allowRegistration,
      baseUrl: config.baseUrl,
      adminEmails: config.adminEmails,
    },
  };
}

/** Nové účty a rezervace po dnech – podklad pro graf. */
export function platformTrend(days = 30) {
  const from = daysAgo(days - 1).slice(0, 10);
  const byDay = (table) => Object.fromEntries(
    db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM ${table} WHERE created_at >= ? GROUP BY day`)
      .all(from).map((r) => [r.day, r.n]),
  );
  const users = byDay('users');
  const bookings = byDay('bookings');
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = daysAgo(i).slice(0, 10);
    out.push({ day, users: users[day] || 0, bookings: bookings[day] || 0 });
  }
  return out;
}

const SORTS = {
  new: 'u.created_at DESC',
  name: 'u.name COLLATE NOCASE',
  bookings: 'bookings_total DESC, u.created_at DESC',
  active: 'u.last_login_at DESC',
};

function userRow(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    slug: r.slug,
    isAdmin: Boolean(r.is_admin),
    blocked: Boolean(r.blocked_at),
    hasPassword: Boolean(r.password_hash),
    viaGoogle: Boolean(r.google_sub),
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    note: r.note || '',
    bookings: { total: r.bookings_total, upcoming: r.bookings_upcoming, last30: r.bookings_30 },
    services: r.services_total,
    google: {
      connected: r.google_status === 'ok',
      status: r.google_status || null,
      email: r.google_email || '',
      calendarName: r.calendar_name || '',
      lastError: r.last_error || null,
    },
  };
}

const LIST_SQL = `
  SELECT u.*,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS bookings_total,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'confirmed' AND b.start_utc >= :now) AS bookings_upcoming,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.created_at >= :month) AS bookings_30,
    (SELECT COUNT(*) FROM services s WHERE s.user_id = u.id) AS services_total,
    g.status AS google_status, g.google_email, g.calendar_name, g.last_error
  FROM users u
  LEFT JOIN google_connections g ON g.user_id = u.id
`;

export function listUsers({ q = '', sort = 'new', filter = 'all', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = { now: nowIso(), month: daysAgo(30) };
  const search = String(q || '').trim();
  if (search) {
    where.push('(u.name LIKE :q OR u.email LIKE :q OR u.slug LIKE :q)');
    params.q = `%${search}%`;
  }
  if (filter === 'blocked') where.push('u.blocked_at IS NOT NULL');
  if (filter === 'calendar') where.push("g.status = 'ok'");
  if (filter === 'nocalendar') where.push("(g.status IS NULL OR g.status <> 'ok')");
  if (filter === 'admins') where.push('u.is_admin = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[sort] || SORTS.new;

  const countParams = search ? { q: params.q } : {};
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u LEFT JOIN google_connections g ON g.user_id = u.id ${clause}`)
    .get(countParams).n;
  const items = db.prepare(`${LIST_SQL} ${clause} ORDER BY ${order} LIMIT :limit OFFSET :offset`)
    .all({ ...params, limit: Math.min(Number(limit) || 50, 200), offset: Math.max(Number(offset) || 0, 0) })
    .map(userRow);
  return { items, total, offset: Number(offset) || 0 };
}

export function userDetail(id) {
  const row = db.prepare(`${LIST_SQL} WHERE u.id = :id`).get({ id: Number(id) || 0, now: nowIso(), month: daysAgo(30) });
  if (!row) throw notFound('Účet nebyl nalezen.');
  const settings = getSettings(row.id);
  const recent = db.prepare('SELECT code, service_name, start_utc, status, customer_name FROM bookings WHERE user_id = ? ORDER BY start_utc DESC LIMIT 5')
    .all(row.id);
  return {
    ...userRow(row),
    bookingUrl: `${config.baseUrl}/${row.slug}`,
    business: { name: settings.business.name, phone: settings.business.phone, email: settings.business.email },
    timezone: settings.timezone,
    recentBookings: recent.map((b) => ({
      code: b.code, serviceName: b.service_name, start: b.start_utc, status: b.status, customer: b.customer_name,
    })),
  };
}

export function setUserNote(id, note) {
  if (!getUserRow(id)) throw notFound('Účet nebyl nalezen.');
  db.prepare('UPDATE users SET note = ? WHERE id = ?').run(String(note || '').slice(0, 500), Number(id));
}

/** Vytvoří odkaz pro nastavení hesla. Používá se, když uživatel ztratil přístup. */
export function passwordLink(id) {
  const user = getUserRow(id);
  if (!user) throw notFound('Účet nebyl nalezen.');
  const token = randomToken(32);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), user.id, new Date(Date.now() + 24 * 3600_000).toISOString());
  return { user, url: `${config.baseUrl}/nove-heslo?token=${token}`, expiresHours: 24 };
}

/** Kontrola před smazáním – správce nesmí smazat sám sebe ani jiného správce. */
export function assertDeletable(id, currentUserId) {
  const user = getUserRow(id);
  if (!user) throw notFound('Účet nebyl nalezen.');
  if (user.id === currentUserId) throw badRequest('Vlastní účet nelze smazat odsud – použijte Nastavení.');
  if (user.is_admin) throw badRequest('Správcovský účet nejde smazat. Nejdřív odeberte e-mail z ADMIN_EMAILS.');
  if (isAdminEmail(user.email)) throw badRequest('Tento e-mail je uvedený v ADMIN_EMAILS.');
  return user;
}

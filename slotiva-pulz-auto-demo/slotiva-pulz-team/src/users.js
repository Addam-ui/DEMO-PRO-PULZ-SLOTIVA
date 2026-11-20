import { config } from './config.js';
import { db, nowIso, transaction } from './db.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './crypto.js';
import { AppError, badRequest, conflict, notFound } from './errors.js';
import { initSettings, forgetSettings } from './settings.js';
import { seedServices } from './services.js';
import * as v from './validate.js';

/** Adresy, které nemůže mít žádná rezervační stránka (kolidují se systémem). */
export const RESERVED_SLUGS = new Set([
  'app', 'admin', 'api', 'assets', 'auth', 'fonts', 'img', 'static', 'prihlaseni', 'registrace', 'odhlaseni',
  'zapomenute-heslo', 'nove-heslo', 'rezervace', 'widget.js', 'ukazka-webu', 'slotiva', 'dashboard', 'login',
  'signup', 'podminky', 'ochrana-udaju', 'ochrana-osobnich-udaju', 'soukromi', 'healthz', 'cenik', 'napoveda',
  'kontakt', 'blog', 'www', 'mail', 'favicon.ico',
  'favicon.svg', 'logo.svg', 'robots.txt', '404',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const getUserRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id) || 0) || null;
export const getUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim()) || null;
export const getUserBySlug = (slug) => db.prepare('SELECT * FROM users WHERE slug = ?').get(String(slug || '').toLowerCase()) || null;
export const getUserByGoogleSub = (sub) => (sub ? db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub) || null : null);

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    slug: row.slug,
    hasPassword: Boolean(row.password_hash),
    isAdmin: Boolean(row.is_admin),
    blocked: Boolean(row.blocked_at),
    createdAt: row.created_at,
  };
}

export function validateSlug(slug, { userId = null } = {}) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw badRequest('Adresa může obsahovat jen malá písmena bez diakritiky, číslice a pomlčky (3–40 znaků).', { field: 'slug' });
  }
  if (RESERVED_SLUGS.has(s)) throw conflict('Tuto adresu nelze použít, zvolte prosím jinou.', { field: 'slug' });
  const taken = getUserBySlug(s);
  if (taken && taken.id !== userId) throw conflict('Tahle adresa už je obsazená, zkuste jinou.', { field: 'slug' });
  return s;
}

export function uniqueSlug(base) {
  let root = slugify(base) || 'rezervace';
  if (root.length < 3) root = `${root}-rezervace`;
  let candidate = root;
  for (let i = 2; RESERVED_SLUGS.has(candidate) || getUserBySlug(candidate); i++) {
    candidate = `${root.slice(0, 36).replace(/-+$/, '')}-${i}`;
  }
  return candidate;
}

function validatePassword(password, field = 'password') {
  if (typeof password !== 'string' || password.length < 8) throw badRequest('Heslo musí mít alespoň 8 znaků.', { field });
  if (password.length > 200) throw badRequest('Heslo je příliš dlouhé.', { field });
  return password;
}

/* ───────────── správcovská práva ───────────── */

/** Je tenhle e-mail uvedený v ADMIN_EMAILS? */
export const isAdminEmail = (email) => config.adminEmails.includes(String(email || '').trim().toLowerCase());

/** Srovná příznak správce s ADMIN_EMAILS. Vrátí true, když se něco změnilo. */
export function syncAdminFlag(user) {
  const should = isAdminEmail(user.email) ? 1 : 0;
  if (Number(user.is_admin) === should) return false;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(should, user.id);
  return true;
}

/** Po startu serveru: e-maily z ADMIN_EMAILS dostanou správcovská práva, ostatní o ně přijdou. */
export function syncAllAdmins() {
  const changed = db.prepare('SELECT id, email, is_admin FROM users').all().filter(syncAdminFlag);
  return changed.map((u) => u.email);
}

export function setBlocked(userId, blocked) {
  const user = getUserRow(userId);
  if (!user) throw notFound('Účet nebyl nalezen.');
  if (blocked && user.is_admin) throw badRequest('Správcovský účet nelze zablokovat.');
  // Zvýšení verze relace okamžitě odhlásí uživatele na všech zařízeních.
  db.prepare('UPDATE users SET blocked_at = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?')
    .run(blocked ? nowIso() : null, nowIso(), userId);
  return getUserRow(userId);
}

/** Založí uživatele včetně výchozího nastavení a ukázkových služeb. */
export function createUser({ name, email, slug, passwordHash = null, googleSub = null, services }) {
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, name, slug, password_hash, google_sub) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, slug, passwordHash, googleSub);
    return Number(lastInsertRowid);
  });
  initSettings(id, { name, email });
  seedServices(id, services);
  const user = getUserRow(id);
  syncAdminFlag(user);
  return getUserRow(id);
}

export async function registerUser({ name, email, password, slug }) {
  const cleanName = v.text(name, { field: 'name', label: 'Jméno nebo název', required: true, max: 80 });
  const cleanEmail = v.email(email, { field: 'email', required: true });
  validatePassword(password);
  if (getUserByEmail(cleanEmail)) throw conflict('Účet s tímto e-mailem už existuje. Zkuste se přihlásit.', { field: 'email' });
  const cleanSlug = slug ? validateSlug(slug) : uniqueSlug(cleanName);
  const passwordHash = await hashPassword(password);
  return createUser({ name: cleanName, email: cleanEmail, slug: cleanSlug, passwordHash });
}

export async function authenticate(email, password) {
  const user = getUserByEmail(email);
  const valid = await verifyPassword(String(password || ''), user?.password_hash);
  if (!user || !valid) {
    if (user && !user.password_hash) throw new AppError(401, 'Tento účet používá přihlášení přes Google.');
    throw new AppError(401, 'Nesprávný e-mail nebo heslo.');
  }
  if (user.blocked_at) throw new AppError(403, 'Tento účet je zablokovaný. Ozvěte se prosím správci.');
  touchLogin(user.id);
  syncAdminFlag(user);
  return getUserRow(user.id);
}

export function touchLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
}

export function linkGoogleAccount(userId, googleSub) {
  db.prepare('UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?').run(googleSub, nowIso(), userId);
}

export function updateProfile(userId, input) {
  const user = getUserRow(userId);
  if (!user) throw notFound('Účet nebyl nalezen.');
  const name = v.text(input.name, { field: 'name', label: 'Jméno', required: true, max: 80 });
  const email = v.email(input.email, { field: 'email', required: true });
  const slug = validateSlug(input.slug, { userId });
  const owner = getUserByEmail(email);
  if (owner && owner.id !== userId) throw conflict('Tento e-mail už používá jiný účet.', { field: 'email' });
  db.prepare('UPDATE users SET name = ?, email = ?, slug = ?, updated_at = ? WHERE id = ?').run(name, email, slug, nowIso(), userId);
  syncAdminFlag(getUserRow(userId)); // změna e-mailu může práva dát i vzít
  return getUserRow(userId);
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = getUserRow(userId);
  if (user.password_hash && !(await verifyPassword(String(currentPassword || ''), user.password_hash))) {
    throw badRequest('Současné heslo není správné.', { field: 'currentPassword' });
  }
  validatePassword(newPassword, 'newPassword');
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?')
    .run(hash, nowIso(), userId);
  return getUserRow(userId);
}

export async function deleteAccount(userId, password) {
  const user = getUserRow(userId);
  if (!user) return;
  if (user.password_hash && !(await verifyPassword(String(password || ''), user.password_hash))) {
    throw badRequest('Heslo není správné.', { field: 'password' });
  }
  deleteUser(userId);
}

/** Smaže účet bez ověřování hesla – používá správce, který heslo uživatele nezná. */
export function deleteUser(userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  forgetSettings(userId);
}

/* ───────────── obnova hesla ───────────── */

export function createPasswordReset(email) {
  const user = getUserByEmail(email);
  if (!user) return null;
  const token = randomToken(32);
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, nowIso());
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), user.id, new Date(Date.now() + 60 * 60_000).toISOString());
  return { user, token };
}

export async function resetPassword(token, newPassword) {
  validatePassword(newPassword);
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token || ''));
  if (!row || row.used_at || row.expires_at < nowIso()) {
    throw badRequest('Odkaz pro obnovu hesla je neplatný nebo vypršel. Požádejte prosím o nový.');
  }
  const hash = await hashPassword(newPassword);
  transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?')
      .run(hash, nowIso(), row.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(nowIso(), row.token_hash);
  });
  return getUserRow(row.user_id);
}

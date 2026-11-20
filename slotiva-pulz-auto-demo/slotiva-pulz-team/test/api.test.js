/* Integrační test: spustí server s dočasnou databází a projde hlavní scénáře více uživatelů přes HTTP. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;
let output = '';

async function call(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* není JSON */
  }
  return { status: res.status, data, headers: res.headers, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slotiva-test-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      SKIP_ENV_FILE: '1',
      PORT: String(PORT),
      DATA_DIR: dataDir,
      SESSION_SECRET: 'x'.repeat(48),
      PUBLIC_BASE_URL: BASE,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      SMTP_HOST: '',
      ADMIN_EMAILS: 'sef@example.com',
      OPERATOR_NAME: 'Testovací Provozovatel',
      NODE_ENV: 'test',
    },
  });
  server.stdout.on('data', (d) => { output += d; });
  server.stderr.on('data', (d) => { output += d; });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/auth/session`)).ok) return;
    } catch {
      /* ještě neběží */
    }
    await new Promise((r) => setTimeout(r, 125));
  }
  throw new Error(`Server nenaběhl:\n${output}`);
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows může databázi chvíli držet */
  }
});

const jana = { name: 'Jana Nováková', email: 'jana@example.com', password: 'heslo-jany-123', cookie: '' };
const petr = { name: 'Petr Svoboda', email: 'petr@example.com', password: 'heslo-petra-123', cookie: '' };
const sef = { name: 'Šéf Slotivy', email: 'sef@example.com', password: 'heslo-sefa-123', cookie: '' };
const obet = { name: 'Karel Obětovaný', email: 'obet@example.com', password: 'heslo-karla-123', cookie: '' };
let slug;
let service;
let slot;
let janaBooking;

test('registrace a přihlášení', async () => {
  const session = await call('GET', '/api/auth/session');
  assert.equal(session.data.authenticated, false);
  assert.equal(session.data.registration, true);

  const weak = await call('POST', '/api/auth/register', { body: { ...jana, password: '123' } });
  assert.equal(weak.status, 400);
  assert.equal(weak.data.field, 'password');

  const registered = await call('POST', '/api/auth/register', { body: jana });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  assert.equal(registered.data.user.slug, 'jana-novakova');
  slug = registered.data.user.slug;
  jana.cookie = registered.cookie;

  assert.equal((await call('POST', '/api/auth/register', { body: jana })).status, 409, 'stejný e-mail podruhé nejde');
  assert.equal((await call('POST', '/api/auth/login', { body: { email: jana.email, password: 'spatne' } })).status, 401);
  const login = await call('POST', '/api/auth/login', { body: { email: 'JANA@example.com', password: jana.password } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  jana.cookie = login.cookie;
});

test('nový uživatel má výchozí služby a svou rezervační stránku', async () => {
  const meta = await call('GET', '/api/app/meta', { cookie: jana.cookie });
  assert.equal(meta.status, 200);
  assert.equal(meta.data.bookingUrl, `${BASE}/${slug}`);
  assert.equal(meta.data.google.state, 'unavailable');

  const page = await call('GET', `/api/public/pages/${slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.data.business.name, jana.name);
  assert.ok(page.data.services.length >= 1);
  service = page.data.services[0];

  assert.equal((await call('GET', '/api/public/pages/neexistujici-stranka')).status, 404);
});

test('zákazník si zarezervuje termín, dvojitá rezervace neprojde', async () => {
  const { data: page } = await call('GET', `/api/public/pages/${slug}`);
  const availability = await call('GET', `/api/public/pages/${slug}/availability?serviceId=${service.id}&from=${addDays(page.today, 2)}&to=${addDays(page.today, 16)}`);
  assert.equal(availability.status, 200);
  const day = Object.entries(availability.data.days).find(([, times]) => times.length >= 3);
  assert.ok(day, 'musí existovat den s volnými časy');
  slot = { date: day[0], times: day[1] };

  const body = { serviceId: service.id, date: slot.date, time: slot.times[0], name: 'Zákazník', email: 'zakaznik@example.com', phone: '777 123 456', consent: true };
  const created = await call('POST', `/api/public/pages/${slug}/bookings`, { body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  janaBooking = created.data.booking;
  assert.equal(janaBooking.bookingPageUrl, `${BASE}/${slug}`);

  assert.equal((await call('POST', `/api/public/pages/${slug}/bookings`, { body })).status, 409);
  assert.equal((await call('POST', `/api/public/pages/${slug}/bookings`, { body: { ...body, time: slot.times[2], email: 'x' } })).data.field, 'email');
  assert.equal((await call('POST', `/api/public/pages/${slug}/bookings`, { body: { ...body, time: slot.times[2] }, headers: { origin: 'https://cizi-web.cz' } })).status, 403);
});

test('uživatelé nevidí data ostatních', async () => {
  const registered = await call('POST', '/api/auth/register', { body: petr });
  assert.equal(registered.status, 201);
  petr.cookie = registered.cookie;

  const janaList = await call('GET', '/api/app/bookings?scope=all', { cookie: jana.cookie });
  assert.equal(janaList.data.total, 1);
  const id = janaList.data.items[0].id;

  assert.equal((await call('GET', '/api/app/bookings?scope=all', { cookie: petr.cookie })).data.total, 0);
  assert.equal((await call('GET', `/api/app/bookings/${id}`, { cookie: petr.cookie })).status, 404);
  assert.equal((await call('PATCH', `/api/app/bookings/${id}`, { cookie: petr.cookie, body: { action: 'status', status: 'cancelled' } })).status, 404);
  assert.equal((await call('PUT', `/api/app/services/${service.id}`, { cookie: petr.cookie, body: { name: 'Hack', durationMin: 30, price: 0, colorId: '9' } })).status, 404);

  // Petrův termín ve stejný čas nekoliduje s Janiným kalendářem.
  const petrService = (await call('GET', `/api/public/pages/petr-svoboda`)).data.services[0];
  const petrBooking = await call('POST', '/api/public/pages/petr-svoboda/bookings', {
    body: { serviceId: petrService.id, date: slot.date, time: slot.times[0], name: 'Jiný zákazník', email: 'jiny@example.com', phone: '777000111', consent: true },
  });
  assert.equal(petrBooking.status, 201, JSON.stringify(petrBooking.data));
  assert.equal((await call('POST', `/api/public/pages/${slug}/bookings`, { body: { serviceId: petrService.id, date: slot.date, time: slot.times[2], name: 'X', email: 'x@example.com', phone: '777000111', consent: true } })).status, 404, 'cizí služba na mé stránce nejde');
});

test('dashboard: přehled, ruční rezervace, přesun, CSV, nastavení', async () => {
  const overview = await call('GET', '/api/app/overview', { cookie: jana.cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.stats.series.length, 34);
  assert.equal(overview.data.onboarding.steps.share, true);

  const created = await call('POST', '/api/app/bookings', { cookie: jana.cookie, body: { serviceId: service.id, date: slot.date, time: slot.times[1], name: 'Z telefonu' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await call('POST', '/api/app/bookings', { cookie: jana.cookie, body: { serviceId: service.id, date: slot.date, time: slot.times[1], name: 'Kolize' } })).status, 409);

  const moved = await call('PATCH', `/api/app/bookings/${created.data.booking.id}`, { cookie: jana.cookie, body: { action: 'reschedule', date: addDays(slot.date, 7), time: '07:05', force: true } });
  assert.equal(moved.data.booking.time, '07:05');

  const csv = await fetch(`${BASE}/api/app/bookings.csv?scope=all`, { headers: { cookie: jana.cookie } }).then((r) => r.text());
  assert.match(csv, /Z telefonu/);

  const { data } = await call('GET', '/api/app/settings', { cookie: jana.cookie });
  assert.equal((await call('PUT', '/api/app/settings', { cookie: jana.cookie, body: { ...data.settings, bufferMin: 10 } })).data.settings.bufferMin, 10);
  assert.equal((await call('PUT', '/api/app/settings', { cookie: jana.cookie, body: { ...data.settings, workingHours: { 1: [{ from: '12:00', to: '10:00' }] } } })).status, 400);
});

test('zákazník zruší rezervaci přes odkaz', async () => {
  const token = janaBooking.manageUrl.split('/').pop();
  assert.equal((await call('GET', `/api/public/bookings/${token}`)).status, 200);
  const ics = await fetch(`${BASE}/api/public/bookings/${token}/ics`).then((r) => r.text());
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.equal((await call('POST', `/api/public/bookings/${token}/cancel`)).data.booking.status, 'cancelled');
});

test('profil: změna adresy stránky a hesla', async () => {
  assert.equal((await call('PUT', '/api/app/profile', { cookie: jana.cookie, body: { name: jana.name, email: jana.email, slug: 'app' } })).status, 409, 'rezervovaná adresa');
  assert.equal((await call('PUT', '/api/app/profile', { cookie: jana.cookie, body: { name: jana.name, email: jana.email, slug: 'petr-svoboda' } })).status, 409, 'obsazená adresa');
  const renamed = await call('PUT', '/api/app/profile', { cookie: jana.cookie, body: { name: jana.name, email: jana.email, slug: 'kadernictvi-jana' } });
  assert.equal(renamed.status, 200);
  assert.equal((await call('GET', '/api/public/pages/kadernictvi-jana')).status, 200);
  assert.equal((await call('GET', `/api/public/pages/${slug}`)).status, 404);
  slug = 'kadernictvi-jana';

  const oldCookie = jana.cookie;
  const changed = await call('POST', '/api/app/password', { cookie: jana.cookie, body: { currentPassword: jana.password, newPassword: 'nove-heslo-456' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/api/app/meta', { cookie: oldCookie })).status, 401, 'staré přihlášení po změně hesla neplatí');
  jana.cookie = changed.cookie;
  assert.equal((await call('GET', '/api/app/meta', { cookie: jana.cookie })).status, 200);
});

test('smazání účtu', async () => {
  assert.equal((await call('DELETE', '/api/app/account', { cookie: petr.cookie, body: { password: 'spatne' } })).status, 400);
  assert.equal((await call('DELETE', '/api/app/account', { cookie: petr.cookie, body: { password: petr.password } })).status, 200);
  assert.equal((await call('GET', '/api/app/meta', { cookie: petr.cookie })).status, 401);
  assert.equal((await call('GET', '/api/public/pages/petr-svoboda')).status, 404);
});

test('správce: práva podle ADMIN_EMAILS a jen pro něj', async () => {
  const registered = await call('POST', '/api/auth/register', { body: sef });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.isAdmin, true, 'e-mail z ADMIN_EMAILS dostane práva správce');
  sef.cookie = registered.cookie;

  const janaMeta = await call('GET', '/api/app/meta', { cookie: jana.cookie });
  assert.equal(janaMeta.data.user.isAdmin, false);

  assert.equal((await call('GET', '/api/admin/users')).status, 401, 'bez přihlášení nic');
  assert.equal((await call('GET', '/api/admin/users', { cookie: jana.cookie })).status, 403, 'běžný uživatel nesmí do správy');
  assert.equal((await call('GET', '/api/admin/overview', { cookie: jana.cookie })).status, 403);

  const overview = await call('GET', '/api/admin/overview', { cookie: sef.cookie });
  assert.equal(overview.status, 200);
  assert.ok(overview.data.stats.users.total >= 2);
  assert.equal(overview.data.trend.length, 30);

  const list = await call('GET', '/api/admin/users?q=jana', { cookie: sef.cookie });
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].email, jana.email);
  assert.equal((await call('GET', '/api/admin/users?filter=admins', { cookie: sef.cookie })).data.total, 1);
});

test('správce: zablokování, odkaz na heslo a smazání účtu', async () => {
  const registered = await call('POST', '/api/auth/register', { body: obet });
  assert.equal(registered.status, 201);
  obet.cookie = registered.cookie;
  const id = registered.data.user.id;

  const blocked = await call('POST', `/api/admin/users/${id}`, { cookie: sef.cookie, body: { action: 'block' } });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.user.blocked, true);
  assert.equal((await call('POST', '/api/auth/login', { body: obet })).status, 403, 'zablokovaný se nepřihlásí');
  assert.equal((await call('GET', '/api/app/meta', { cookie: obet.cookie })).status, 401, 'a je rovnou odhlášený');

  const unblocked = await call('POST', `/api/admin/users/${id}`, { cookie: sef.cookie, body: { action: 'unblock' } });
  assert.equal(unblocked.data.user.blocked, false);
  assert.equal((await call('POST', '/api/auth/login', { body: obet })).status, 200);

  const note = await call('POST', `/api/admin/users/${id}`, { cookie: sef.cookie, body: { action: 'note', note: 'Ozval se kvůli faktuře' } });
  assert.equal(note.data.user.note, 'Ozval se kvůli faktuře');

  const link = await call('POST', `/api/admin/users/${id}`, { cookie: sef.cookie, body: { action: 'password-link' } });
  assert.ok(link.data.url.includes('/nove-heslo?token='), 'odkaz na heslo');

  const sefId = (await call('GET', '/api/admin/users?filter=admins', { cookie: sef.cookie })).data.items[0].id;
  assert.equal((await call('DELETE', `/api/admin/users/${sefId}`, { cookie: sef.cookie })).status, 400, 'sám sebe smazat nejde');
  assert.equal((await call('DELETE', `/api/admin/users/${id}`, { cookie: jana.cookie })).status, 403, 'běžný uživatel mazat nesmí');

  assert.equal((await call('DELETE', `/api/admin/users/${id}`, { cookie: sef.cookie })).status, 200);
  assert.equal((await call('GET', `/api/public/pages/karel-obetovany`)).status, 404);
});

test('stránky, přesměrování a bezpečnostní hlavičky', async () => {
  assert.equal((await fetch(`${BASE}/`)).status, 200);
  assert.equal((await fetch(`${BASE}/prihlaseni`)).status, 200);

  const anonymous = await fetch(`${BASE}/app/`, { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/prihlaseni');

  const dashboard = await fetch(`${BASE}/app/`, { headers: { cookie: jana.cookie }, redirect: 'manual' });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.headers.get('x-frame-options'), 'DENY');

  const bookingPage = await fetch(`${BASE}/${slug}`);
  assert.equal(bookingPage.status, 200);
  assert.match(bookingPage.headers.get('content-security-policy'), /frame-ancestors \*/);

  for (const path of ['/podminky', '/ochrana-osobnich-udaju', '/healthz', '/robots.txt']) {
    assert.equal((await fetch(BASE + path)).status, 200, `${path} musí odpovídat`);
  }
  const operator = await call('GET', '/api/public/operator');
  assert.equal(operator.data.name, 'Testovací Provozovatel');

  assert.equal((await fetch(`${BASE}/widget.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/neexistujici-stranka-xyz`)).status, 404);
});

import express from 'express';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { db } from '../db.js';
import { badRequest } from '../errors.js';
import { requireUser, startSession, endSession } from '../auth.js';
import { getSettings, updateSettings, patchSettings, GOOGLE_COLORS, SLOT_STEPS } from '../settings.js';
import { listServices, createService, updateService, deleteService, reorderServices } from '../services.js';
import * as users from '../users.js';
import * as bookings from '../bookings.js';
import * as google from '../google.js';
import { mailEnabled, verifyMail, sendMail } from '../mailer.js';
import { getDashboardStats } from '../stats.js';

export const appRouter = express.Router();

appRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
appRouter.use(requireUser);

const uid = (req) => req.user.id;
const bookingUrl = (user) => `${config.baseUrl}/${user.slug}`;

function onboarding(userId) {
  const s = getSettings(userId);
  const total = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?').get(userId).n;
  const state = google.googleState(userId);
  return {
    dismissed: s.onboardingDismissed,
    steps: {
      calendar: state === 'connected',
      calendarAvailable: state !== 'unavailable',
      profile: s.settingsSaved,
      services: s.servicesEdited,
      share: s.linkShared || total > 0,
    },
  };
}

/* ── účet a přehled ── */

appRouter.get('/meta', (req, res) => {
  const s = getSettings(uid(req));
  res.json({
    user: users.publicUser(req.user),
    bookingUrl: bookingUrl(req.user),
    businessName: s.business.name,
    brandColor: s.brandColor,
    timezone: s.timezone,
    today: DateTime.now().setZone(s.timezone).toISODate(),
    baseUrl: config.baseUrl,
    google: bookings.getGoogleStatus(uid(req)),
    mailEnabled: mailEnabled(),
    colors: GOOGLE_COLORS,
    onboarding: onboarding(uid(req)),
  });
});

appRouter.get('/overview', (req, res) => {
  res.json({ stats: getDashboardStats(uid(req)), google: bookings.getGoogleStatus(uid(req)), onboarding: onboarding(uid(req)) });
});

appRouter.post('/onboarding', (req, res) => {
  const patch = {};
  if (req.body?.dismissed !== undefined) patch.onboardingDismissed = Boolean(req.body.dismissed);
  if (req.body?.linkShared) patch.linkShared = true;
  patchSettings(uid(req), patch);
  res.json({ onboarding: onboarding(uid(req)) });
});

appRouter.put('/profile', (req, res) => {
  const user = users.updateProfile(uid(req), req.body || {});
  res.json({ user: users.publicUser(user), bookingUrl: bookingUrl(user) });
});

appRouter.post('/password', async (req, res) => {
  const user = await users.changePassword(uid(req), req.body || {});
  startSession(res, user); // verze relace se změnila → vydat novou cookie
  res.json({ ok: true });
});

appRouter.delete('/account', async (req, res) => {
  const user = users.getUserRow(uid(req));
  if (user.password_hash) await users.deleteAccount(user.id, req.body?.password); // ověří heslo před čímkoliv dalším
  await google.disconnect(user.id);
  if (!user.password_hash) await users.deleteAccount(user.id);
  endSession(res);
  console.log(`✖  Smazaný účet: ${user.email}`);
  res.json({ ok: true });
});

/* ── rezervace ── */

appRouter.get('/bookings', (req, res) => {
  res.json(bookings.listBookings(uid(req), req.query));
});

const STATUS_LABELS = { confirmed: 'Potvrzeno', cancelled: 'Zrušeno', no_show: 'Nedostavil(a) se' };
const SOURCE_LABELS = { web: 'Web', admin: 'Dashboard', demo: 'Ukázka' };

appRouter.get('/bookings.csv', (req, res) => {
  const { items } = bookings.listBookings(uid(req), { ...req.query, limit: 5000, offset: 0 });
  const cell = (value) => {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // ochrana proti CSV injection v Excelu
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Kód', 'Datum', 'Od', 'Do', 'Služba', 'Cena (Kč)', 'Klient', 'E-mail', 'Telefon', 'Poznámka', 'Stav', 'Zdroj', 'Vytvořeno'];
  const lines = items.map((b) => [
    b.code, b.date, b.time, b.endTime, b.serviceName, b.price, b.customer.name, b.customer.email, b.customer.phone,
    b.note, STATUS_LABELS[b.status] || b.status, SOURCE_LABELS[b.source] || b.source, b.createdAt,
  ].map(cell).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rezervace-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(String.fromCharCode(0xfeff) + [header.join(';'), ...lines].join('\r\n'));
});

appRouter.get('/bookings/:id', (req, res) => {
  res.json({ booking: bookings.adminBookingView(bookings.getBookingRow(uid(req), req.params.id)) });
});

appRouter.post('/bookings', async (req, res) => {
  const row = await bookings.createBooking(uid(req), req.body || {}, { source: 'admin' });
  res.status(201).json({ booking: bookings.adminBookingView(row) });
});

appRouter.patch('/bookings/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const actions = {
    reschedule: () => bookings.rescheduleBooking(uid(req), id, body),
    status: () => bookings.setBookingStatus(uid(req), id, body.status, { notifyCustomer: Boolean(body.notifyCustomer) }),
    details: () => bookings.updateBookingDetails(uid(req), id, body),
    resync: () => bookings.pushToGoogle(uid(req), id),
  };
  if (!actions[body.action]) throw badRequest('Neznámá akce.');
  res.json({ booking: bookings.adminBookingView(await actions[body.action]()) });
});

appRouter.get('/availability', async (req, res) => {
  res.json(await bookings.getAvailability(uid(req), {
    serviceId: req.query.serviceId,
    from: String(req.query.from || ''),
    to: String(req.query.to || ''),
    applyRules: false,
    excludeBookingId: req.query.excludeBookingId ? Number(req.query.excludeBookingId) : null,
  }));
});

appRouter.get('/calendar', async (req, res) => {
  res.json(await bookings.getCalendarRange(uid(req), String(req.query.from || ''), String(req.query.to || '')));
});

/* ── služby ── */

appRouter.get('/services', (req, res) => {
  const upcoming = Object.fromEntries(
    db.prepare("SELECT service_id AS id, COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND end_utc >= ? GROUP BY service_id")
      .all(uid(req), new Date().toISOString())
      .map((r) => [r.id, r.n]),
  );
  res.json({ services: listServices(uid(req)).map((s) => ({ ...s, upcomingCount: upcoming[s.id] || 0 })), colors: GOOGLE_COLORS });
});

appRouter.post('/services', (req, res) => {
  const service = createService(uid(req), req.body || {});
  patchSettings(uid(req), { servicesEdited: true });
  res.status(201).json({ service });
});

appRouter.post('/services/reorder', (req, res) => {
  reorderServices(uid(req), req.body?.ids);
  res.json({ ok: true });
});

appRouter.put('/services/:id', (req, res) => {
  const service = updateService(uid(req), req.params.id, req.body || {});
  patchSettings(uid(req), { servicesEdited: true });
  bookings.invalidateBusyCache(uid(req));
  res.json({ service });
});

appRouter.delete('/services/:id', (req, res) => {
  deleteService(uid(req), req.params.id);
  patchSettings(uid(req), { servicesEdited: true });
  res.json({ ok: true });
});

/* ── nastavení ── */

appRouter.get('/settings', (req, res) => {
  res.json({ settings: getSettings(uid(req)), slotSteps: SLOT_STEPS, user: users.publicUser(req.user), baseUrl: config.baseUrl });
});

appRouter.put('/settings', (req, res) => {
  const settings = updateSettings(uid(req), req.body || {});
  bookings.invalidateBusyCache(uid(req));
  res.json({ settings });
});

/* ── Google Kalendář ── */

appRouter.get('/google', async (req, res) => {
  const status = bookings.getGoogleStatus(uid(req));
  let calendars = [];
  let calendarsError = null;
  if (status.state === 'connected') {
    try {
      calendars = await google.listCalendars(uid(req));
    } catch (err) {
      calendarsError = google.describeGoogleError(err);
    }
  }
  res.json({ ...bookings.getGoogleStatus(uid(req)), redirectUri: config.google.redirectUri, calendars, calendarsError });
});

appRouter.put('/google/calendars', async (req, res) => {
  const calendars = await google.listCalendars(uid(req));
  const target = calendars.find((c) => c.id === req.body?.calendarId);
  if (!target) throw badRequest('Vybraný kalendář nebyl nalezen.', { field: 'calendarId' });
  if (!target.canWrite) throw badRequest('Do tohoto kalendáře nemáte oprávnění zapisovat. Vyberte jiný.', { field: 'calendarId' });
  const known = new Set(calendars.map((c) => c.id));
  const busyCalendarIds = (Array.isArray(req.body?.busyCalendarIds) ? req.body.busyCalendarIds : []).filter((id) => known.has(id));
  await bookings.changeCalendar(uid(req), { calendarId: target.id, calendarName: target.name, busyCalendarIds });
  res.json(bookings.getGoogleStatus(uid(req)));
});

appRouter.post('/google/check', async (req, res) => {
  res.json(await google.checkConnection(uid(req)));
});

appRouter.post('/google/test-write', async (req, res) => {
  if (!google.isGoogleActive(uid(req))) throw badRequest('Google Kalendář není připojený.');
  try {
    await google.testWrite(uid(req));
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: google.describeGoogleError(err) });
  }
});

appRouter.post('/google/sync', async (req, res) => {
  res.json(await bookings.syncWithGoogle(uid(req)));
});

appRouter.delete('/google', async (req, res) => {
  await google.disconnect(uid(req));
  db.prepare('UPDATE bookings SET google_pending = NULL, google_error = NULL WHERE user_id = ?').run(uid(req));
  bookings.invalidateBusyCache(uid(req));
  res.json(bookings.getGoogleStatus(uid(req)));
});

/* ── napojení na web a e-maily ── */

appRouter.get('/integration', (req, res) => {
  res.json({
    baseUrl: config.baseUrl,
    slug: req.user.slug,
    bookingUrl: bookingUrl(req.user),
    embedOrigins: config.embedOrigins,
    mail: { enabled: mailEnabled(), notifyEmail: getSettings(uid(req)).notifyEmail || req.user.email },
    services: listServices(uid(req), { activeOnly: true }).map(({ id, name }) => ({ id, name })),
  });
});

appRouter.post('/mail/test', async (req, res) => {
  const status = await verifyMail();
  if (!status.enabled) throw badRequest('E-maily nejsou na serveru nastavené.');
  if (!status.ok) return res.json({ ok: false, error: status.error });
  const to = getSettings(uid(req)).notifyEmail || req.user.email;
  const ok = await sendMail({ to, subject: 'Test e-mailu – Slotiva', text: 'Pokud čtete tuto zprávu, e-maily ze Slotivy fungují.' });
  res.json({ ok, to, error: ok ? null : 'Odeslání selhalo – podrobnosti najdete ve výpisu serveru.' });
});

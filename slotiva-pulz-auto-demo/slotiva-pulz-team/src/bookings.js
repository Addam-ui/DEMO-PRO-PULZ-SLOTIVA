import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { db, transaction, nowIso } from './db.js';
import { getSettings, colorHex } from './settings.js';
import { getServiceRow } from './services.js';
import { getUserRow } from './users.js';
import { computeSlots, findSlot, localDateTime } from './availability.js';
import * as google from './google.js';
import * as emails from './emails.js';
import { sendMail } from './mailer.js';
import { badRequest, conflict, notFound, unavailable } from './errors.js';
import { localParts, fmtDateLong, fmtPrice } from './format.js';
import * as v from './validate.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

/* ───────────────────────── pomocné funkce ───────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 znaků, bez 0/O a 1/I
const generateCode = () => [...crypto.randomBytes(6)].map((b) => CODE_ALPHABET[b % 32]).join('');
const generateToken = () => crypto.randomBytes(24).toString('base64url');

export function getBookingRow(userId, id) {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(Number(id) || 0, Number(userId));
  if (!row) throw notFound('Rezervace nebyla nalezena.');
  return row;
}

export function getBookingByToken(token) {
  const row = typeof token === 'string' && token.length >= 20
    ? db.prepare('SELECT * FROM bookings WHERE cancel_token = ?').get(token)
    : null;
  if (!row) throw notFound('Rezervace nebyla nalezena. Zkontrolujte prosím odkaz z potvrzení.');
  return row;
}

/** Připojení s Google, u kterého má smysl rezervaci zařadit do fronty pro zápis (i když je dočasně odpojené). */
const hasGoogleLink = (userId) => !['unavailable', 'disconnected'].includes(google.googleState(userId));

export function adminBookingView(row, settings = getSettings(row.user_id)) {
  const tz = settings.timezone;
  const start = localParts(row.start_utc, tz);
  const end = localParts(row.end_utc, tz);
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    source: row.source,
    serviceId: row.service_id,
    serviceName: row.service_name,
    colorId: row.color_id,
    color: colorHex(row.color_id),
    price: row.price,
    start: row.start_utc,
    end: row.end_utc,
    date: start.date,
    time: start.time,
    endTime: end.time,
    durationMin: Math.round((Date.parse(row.end_utc) - Date.parse(row.start_utc)) / MINUTE),
    customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    note: row.note,
    internalNote: row.internal_note,
    google: { eventId: row.google_event_id, pending: row.google_pending, error: row.google_error },
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    manageUrl: emails.manageUrl(row),
  };
}

export function publicBookingView(row) {
  const settings = getSettings(row.user_id);
  const owner = getUserRow(row.user_id);
  const tz = settings.timezone;
  const startMs = Date.parse(row.start_utc);
  const cancelDeadline = startMs - settings.cancelLimitHours * HOUR;
  const start = localParts(row.start_utc, tz);
  return {
    code: row.code,
    status: row.status,
    serviceName: row.service_name,
    price: row.price,
    priceLabel: fmtPrice(row.price),
    date: start.date,
    time: start.time,
    endTime: localParts(row.end_utc, tz).time,
    dateLabel: fmtDateLong(row.start_utc, tz),
    start: row.start_utc,
    end: row.end_utc,
    timezone: tz,
    customerName: row.customer_name,
    isPast: startMs < Date.now(),
    canCancel: row.status === 'confirmed' && Date.now() <= cancelDeadline,
    cancelDeadline: iso(cancelDeadline),
    cancelLimitHours: settings.cancelLimitHours,
    manageUrl: emails.manageUrl(row),
    icsUrl: `${config.baseUrl}/api/public/bookings/${row.cancel_token}/ics`,
    bookingPageUrl: `${config.baseUrl}/${owner?.slug || ''}`,
    brandColor: settings.brandColor,
    business: {
      name: settings.business.name,
      address: settings.business.address,
      phone: settings.business.phone,
      email: settings.business.email,
    },
  };
}

function notify(message) {
  if (message?.to) sendMail(message);
}

/* ───────────────────────── stav napojení na Google ───────────────────────── */

const transientErrors = new Map();

function recordGoogleOk(userId) {
  transientErrors.delete(Number(userId));
}

function recordGoogleError(userId, message) {
  transientErrors.set(Number(userId), { at: nowIso(), error: message });
  console.error(`⚠  [uživatel ${userId}] ${message}`);
}

google.onConnectionLost((userId, reason) => {
  const user = getUserRow(userId);
  console.error(`⚠  [uživatel ${userId}] Google Kalendář se odpojil: ${reason}`);
  if (user) notify(emails.googleDisconnectedEmail(user, reason));
});

export function getGoogleStatus(userId) {
  const state = google.googleState(userId);
  const connection = google.getConnection(userId);
  const transient = transientErrors.get(Number(userId));
  return {
    available: google.oauthEnabled(),
    state,
    email: connection?.email || '',
    calendarId: connection?.calendarId || '',
    calendarName: connection?.calendarName || '',
    busyCalendarIds: connection?.busyCalendarIds || [],
    lastSync: connection?.lastSync || null,
    error: (state === 'connected' ? transient?.error : connection?.lastError) || null,
    pending: db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND google_pending IS NOT NULL').get(Number(userId)).n,
  };
}

/* ───────────────────────── obsazenost ───────────────────────── */

const busyCache = new Map();
const CACHE_TTL = 30_000;

export function invalidateBusyCache(userId) {
  for (const key of busyCache.keys()) if (key.startsWith(`${userId}:`)) busyCache.delete(key);
}

/** Aplikuje změnu z Google Kalendáře na rezervaci (smazaná událost → zrušeno, přesunutá → nový čas). */
function applyEventToBooking(row, event, settings) {
  if (!event || event.status === 'cancelled') {
    const now = nowIso();
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'google', updated_at = ? WHERE id = ?")
      .run(now, now, row.id);
    console.log(`↺  Rezervace ${row.code} byla smazána v Google Kalendáři → zrušena.`);
    return 'cancelled';
  }
  const interval = google.eventInterval(event, settings.timezone);
  if (interval && !interval.allDay) {
    const start = iso(interval.start);
    const end = iso(interval.end);
    if (start !== row.start_utc || end !== row.end_utc) {
      db.prepare('UPDATE bookings SET start_utc = ?, end_utc = ?, updated_at = ? WHERE id = ?').run(start, end, nowIso(), row.id);
      console.log(`↺  Rezervace ${row.code} byla přesunuta v Google Kalendáři → nový čas.`);
      return 'moved';
    }
  }
  return null;
}

/** Rezervace, které se synchronizují z Google (potvrzené, neskončené, bez čekající změny). */
function syncableRows(userId, fromMs, toMs) {
  return db.prepare(`
    SELECT * FROM bookings
    WHERE user_id = ? AND status = 'confirmed' AND google_event_id IS NOT NULL AND google_pending IS NULL
      AND end_utc > ? AND start_utc < ? AND end_utc > ?
  `).all(Number(userId), nowIso(), iso(toMs), iso(fromMs));
}

async function fetchGoogleWindow(userId, fromMs, toMs, { fresh }) {
  const key = `${userId}:${fromMs}:${toMs}`;
  const cached = busyCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  const [events, extra] = await Promise.all([
    google.listEvents(userId, fromMs, toMs),
    google.queryFreeBusy(userId, fromMs, toMs),
  ]);
  const settings = getSettings(userId);
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const row of syncableRows(userId, fromMs, toMs)) {
    const event = byId.get(row.google_event_id);
    if (event) applyEventToBooking(row, event, settings);
  }

  const data = { events, byId, extraBusy: extra.busy };
  busyCache.set(key, { at: Date.now(), data });
  if (busyCache.size > 500) busyCache.delete(busyCache.keys().next().value);
  recordGoogleOk(userId);
  return data;
}

/**
 * Obsazené intervaly uživatele v rozsahu.
 * S Google: události z kalendáře + lokální rezervace, které v kalendáři ještě nejsou.
 * Bez Google: jen rezervace ve Slotivě.
 */
export async function getBusy(userId, fromMs, toMs, { fresh = false, excludeBookingId = null } = {}) {
  const settings = getSettings(userId);
  const googleMode = google.isGoogleActive(userId);
  const busy = [];
  let seenEventIds = new Set();
  const exclude = excludeBookingId ? getBookingRow(userId, excludeBookingId) : null;

  if (googleMode) {
    let data;
    try {
      data = await fetchGoogleWindow(userId, fromMs, toMs, { fresh });
    } catch (err) {
      const message = google.describeGoogleError(err);
      if (google.isGoogleActive(userId)) {
        recordGoogleError(userId, message);
        throw unavailable('Nepodařilo se načíst volné termíny z kalendáře. Zkuste to prosím za chvíli znovu.', { detail: message });
      }
      data = null; // přístup byl právě zrušen → pokračovat jen s rezervacemi ve Slotivě
    }
    if (data) {
      seenEventIds = new Set(data.byId.keys());
      for (const event of data.events) {
        if (exclude?.google_event_id && event.id === exclude.google_event_id) continue;
        const interval = google.eventInterval(event, settings.timezone);
        if (google.isBlockingEvent(event, interval, settings)) busy.push({ start: interval.start, end: interval.end });
      }
      busy.push(...data.extraBusy);
    }
  }

  const trustGoogle = googleMode && google.isGoogleActive(userId);
  const recent = iso(Date.now() - 2 * MINUTE);
  const rows = db.prepare(`
    SELECT id, start_utc, end_utc, google_event_id, google_pending, created_at FROM bookings
    WHERE user_id = ? AND status = 'confirmed' AND start_utc < ? AND end_utc > ?
  `).all(Number(userId), iso(toMs), iso(fromMs));
  for (const r of rows) {
    if (r.id === exclude?.id) continue;
    const inCalendar = trustGoogle && r.google_event_id && !r.google_pending && r.created_at < recent;
    if (!inCalendar) busy.push({ start: Date.parse(r.start_utc), end: Date.parse(r.end_utc) });
  }

  return { busy, seenEventIds };
}

export async function getAvailability(userId, { serviceId, from, to, applyRules = true, excludeBookingId = null }) {
  const settings = getSettings(userId);
  const service = getServiceRow(userId, serviceId);
  if (applyRules && !service.active) throw notFound('Tato služba není dostupná.');
  v.date(from, { field: 'from' });
  v.date(to, { field: 'to' });

  const tz = settings.timezone;
  const fromDt = DateTime.fromISO(from, { zone: tz });
  const toDt = DateTime.fromISO(to, { zone: tz });
  if (!fromDt.isValid || !toDt.isValid || toDt < fromDt) throw badRequest('Neplatný rozsah dat.');
  if (toDt.diff(fromDt, 'days').days > 62) throw badRequest('Rozsah může mít nejvýše 62 dní.');

  const today = DateTime.now().setZone(tz).startOf('day');
  const fetchFrom = applyRules ? DateTime.max(fromDt, today) : fromDt;
  const fetchTo = applyRules ? DateTime.min(toDt, today.plus({ days: settings.maxAdvanceDays })) : toDt;

  let busy = [];
  if (fetchFrom <= fetchTo) {
    ({ busy } = await getBusy(userId, fetchFrom.toMillis() - DAY, fetchTo.plus({ days: 1 }).toMillis() + DAY, { excludeBookingId }));
  }

  const days = computeSlots({ settings, durationMin: service.duration_min, fromDate: from, toDate: to, busy, applyRules });
  return {
    timezone: tz,
    serviceId: service.id,
    durationMin: service.duration_min,
    days: Object.fromEntries(Object.entries(days).map(([date, slots]) => [date, slots.map((s) => s.time)])),
  };
}

/** Ověří rezervace, které by kolidovaly, ale jejich událost jsme v Google neviděli (přesun mimo rozsah / smazání). */
async function refreshUnseenConflicts(userId, startMs, endMs, seenEventIds, excludeId) {
  if (!google.isGoogleActive(userId)) return;
  const settings = getSettings(userId);
  const buffer = settings.bufferMin * MINUTE;
  const rows = syncableRows(userId, startMs - buffer, endMs + buffer)
    .filter((r) => r.id !== excludeId && !seenEventIds.has(r.google_event_id));
  for (const row of rows) {
    try {
      applyEventToBooking(row, await google.getEvent(userId, row.google_event_id), settings);
    } catch (err) {
      recordGoogleError(userId, google.describeGoogleError(err));
    }
  }
}

function findLocalClash(userId, startMs, endMs, { excludeId = null } = {}) {
  const buffer = getSettings(userId).bufferMin * MINUTE;
  return db.prepare(`
    SELECT id FROM bookings
    WHERE user_id = ? AND status = 'confirmed' AND id != ? AND start_utc < ? AND end_utc > ?
    LIMIT 1
  `).get(Number(userId), excludeId ?? 0, iso(endMs + buffer), iso(startMs - buffer));
}

/* ───────────────────────── zápis do Google Kalendáře ───────────────────────── */

/** Propíše aktuální stav rezervace do Google Kalendáře (vytvoří / upraví / smaže událost). */
export async function pushToGoogle(userId, id) {
  const row = getBookingRow(userId, id);
  // Ukázková data (npm run demo) se do Google Kalendáře nikdy nezapisují.
  if (row.source === 'demo' || !google.isGoogleActive(userId)) return row;
  const settings = getSettings(userId);
  try {
    let eventId = row.google_event_id;
    if (row.status === 'cancelled') {
      if (eventId && row.cancelled_by !== 'google') await google.deleteEvent(userId, eventId);
    } else if (eventId) {
      eventId = await google.updateEvent(userId, eventId, row, settings);
    } else {
      eventId = await google.insertEvent(userId, row, settings);
    }
    db.prepare('UPDATE bookings SET google_event_id = ?, google_pending = NULL, google_error = NULL, updated_at = ? WHERE id = ?')
      .run(eventId, nowIso(), row.id);
    recordGoogleOk(userId);
  } catch (err) {
    const message = google.describeGoogleError(err);
    const pending = row.status === 'cancelled' ? 'delete' : row.google_event_id ? 'update' : 'create';
    db.prepare('UPDATE bookings SET google_pending = ?, google_error = ?, updated_at = ? WHERE id = ?').run(pending, message, nowIso(), row.id);
    recordGoogleError(userId, `Rezervace ${row.code}: ${message}`);
  }
  invalidateBusyCache(userId);
  return getBookingRow(userId, id);
}

function markPending(userId, id, kind) {
  db.prepare("UPDATE bookings SET google_pending = CASE WHEN source = 'demo' THEN NULL ELSE ? END, updated_at = ? WHERE id = ?")
    .run(hasGoogleLink(userId) ? kind : null, nowIso(), id);
}

/** Po připojení kalendáře zapíše i rezervace, které vznikly předtím. */
export function onGoogleConnected(userId) {
  db.prepare(`
    UPDATE bookings SET google_pending = 'create'
    WHERE user_id = ? AND status = 'confirmed' AND google_event_id IS NULL AND end_utc > ? AND source <> 'demo'
  `).run(Number(userId), nowIso());
  invalidateBusyCache(userId);
  syncWithGoogle(userId).catch(() => {});
}

/** Změna kalendáře pro rezervace: budoucí události se přesunou do nového kalendáře. */
export async function changeCalendar(userId, selection) {
  const current = google.getConnection(userId);
  const moving = current && current.calendarId !== selection.calendarId;
  if (moving) {
    const rows = db.prepare(`
      SELECT id, google_event_id FROM bookings
      WHERE user_id = ? AND status = 'confirmed' AND google_event_id IS NOT NULL AND end_utc > ?
    `).all(Number(userId), nowIso());
    for (const row of rows) {
      try {
        await google.deleteEvent(userId, row.google_event_id);
      } catch {
        /* stará událost se nepovedla smazat – nevadí, vytvoří se nová */
      }
    }
    db.prepare(`
      UPDATE bookings SET google_event_id = NULL, google_pending = 'create'
      WHERE user_id = ? AND status = 'confirmed' AND end_utc > ? AND source <> 'demo'
    `).run(Number(userId), nowIso());
  }
  google.setCalendars(userId, selection);
  invalidateBusyCache(userId);
  if (moving) await syncWithGoogle(userId);
}

/* ───────────────────────── vytvoření rezervace ───────────────────────── */

function validateCustomer(input, settings, { admin }) {
  return {
    name: v.text(input.name, { field: 'name', label: 'Jméno a příjmení', required: true, max: 100 }),
    email: v.email(input.email, { field: 'email', required: !admin }),
    phone: v.phone(input.phone, { field: 'phone', required: settings.requirePhone && !admin }),
    note: v.text(input.note, { field: 'note', label: 'Poznámka', max: 1000, multiline: true }),
  };
}

function slotTakenError(admin) {
  return conflict(
    admin
      ? 'Tento čas není volný nebo je mimo otevírací dobu. Pokud chcete rezervaci přesto vytvořit, zaškrtněte „Ignorovat kolize“.'
      : 'Tento termín už bohužel není volný. Vyberte si prosím jiný čas.',
    { code: 'SLOT_TAKEN' },
  );
}

export async function createBooking(userId, input, { source = 'web' } = {}) {
  const settings = getSettings(userId);
  const admin = source === 'admin';
  const force = admin && v.bool(input.force);
  const service = getServiceRow(userId, input.serviceId);
  if (!admin && !service.active) throw badRequest('Tato služba už není k dispozici.', { field: 'serviceId' });

  const date = v.date(input.date, { field: 'date' });
  const time = v.time(input.time, { field: 'time' });
  const customer = validateCustomer(input, settings, { admin });
  if (!admin && !v.bool(input.consent)) {
    throw badRequest('Pro dokončení rezervace je potřeba souhlas se zpracováním osobních údajů.', { field: 'consent' });
  }

  const startDt = localDateTime(date, time, settings.timezone);
  if (!startDt.isValid) throw badRequest('Neplatné datum nebo čas.', { field: 'time' });
  const start = startDt.toMillis();
  const end = start + service.duration_min * MINUTE;

  if (!force) {
    const { busy, seenEventIds } = await getBusy(userId, start - DAY, end + DAY, { fresh: true });
    if (!findSlot({ settings, durationMin: service.duration_min, date, time, busy, applyRules: !admin })) throw slotTakenError(admin);
    await refreshUnseenConflicts(userId, start, end, seenEventIds, null);
  }

  const id = transaction(() => {
    if (!force && findLocalClash(userId, start, end)) throw slotTakenError(admin);
    const insert = db.prepare(`
      INSERT INTO bookings (user_id, code, cancel_token, service_id, service_name, color_id, price, start_utc, end_utc,
        customer_name, customer_email, customer_phone, note, source, google_pending)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let attempt = 0; ; attempt++) {
      try {
        return insert.run(
          Number(userId), generateCode(), generateToken(), service.id, service.name, service.color_id, service.price, iso(start), iso(end),
          customer.name, customer.email, customer.phone, customer.note, source, hasGoogleLink(userId) ? 'create' : null,
        ).lastInsertRowid;
      } catch (err) {
        if (attempt < 3 && /UNIQUE/.test(err.message)) continue;
        throw err;
      }
    }
  });

  invalidateBusyCache(userId);
  const row = await pushToGoogle(userId, id);
  const owner = getUserRow(userId);

  if (!admin || v.bool(input.notifyCustomer)) notify(emails.customerConfirmation(row, settings));
  if (!admin) notify(emails.ownerNewBooking(row, settings, owner));
  console.log(`✔  [${owner.slug}] Nová rezervace ${row.code}: ${row.service_name}, ${row.start_utc}`);
  return row;
}

/* ───────────────────────── změny rezervace ───────────────────────── */

export async function cancelBooking(userId, id, { by, notifyCustomer = false }) {
  const row = getBookingRow(userId, id);
  if (row.status === 'cancelled') return row;
  const now = nowIso();
  db.prepare(`
    UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ?,
      google_pending = CASE WHEN google_event_id IS NOT NULL THEN 'delete' ELSE NULL END
    WHERE id = ?
  `).run(now, by, now, row.id);
  invalidateBusyCache(userId);

  const updated = await pushToGoogle(userId, id);
  const settings = getSettings(userId);
  const owner = getUserRow(userId);
  if (by === 'customer') {
    notify(emails.customerCancelled(updated, settings, { byCustomer: true, slug: owner.slug }));
    notify(emails.ownerCancelled(updated, settings, owner));
  } else if (by === 'admin' && notifyCustomer) {
    notify(emails.customerCancelled(updated, settings, { byCustomer: false, slug: owner.slug }));
  }
  return updated;
}

export async function cancelByToken(token) {
  const row = getBookingByToken(token);
  if (row.status === 'cancelled') return row;
  if (!publicBookingView(row).canCancel) {
    const hours = getSettings(row.user_id).cancelLimitHours;
    throw badRequest(`Rezervaci už nelze zrušit online (nejpozději ${hours} h před začátkem). Kontaktujte nás prosím telefonicky.`);
  }
  return cancelBooking(row.user_id, row.id, { by: 'customer' });
}

export async function rescheduleBooking(userId, id, input) {
  const row = getBookingRow(userId, id);
  if (row.status === 'cancelled') throw badRequest('Zrušenou rezervaci nelze přesunout. Nejdřív ji obnovte.');
  const settings = getSettings(userId);
  const force = v.bool(input.force);
  const date = v.date(input.date, { field: 'date' });
  const time = v.time(input.time, { field: 'time' });

  const service = input.serviceId && Number(input.serviceId) !== row.service_id ? getServiceRow(userId, input.serviceId) : null;
  const durationMin = service ? service.duration_min : Math.round((Date.parse(row.end_utc) - Date.parse(row.start_utc)) / MINUTE);

  const startDt = localDateTime(date, time, settings.timezone);
  if (!startDt.isValid) throw badRequest('Neplatné datum nebo čas.', { field: 'time' });
  const start = startDt.toMillis();
  const end = start + durationMin * MINUTE;

  if (!force) {
    const { busy, seenEventIds } = await getBusy(userId, start - DAY, end + DAY, { fresh: true, excludeBookingId: id });
    if (!findSlot({ settings, durationMin, date, time, busy, applyRules: false })) throw slotTakenError(true);
    await refreshUnseenConflicts(userId, start, end, seenEventIds, row.id);
  }

  transaction(() => {
    if (!force && findLocalClash(userId, start, end, { excludeId: row.id })) throw slotTakenError(true);
    db.prepare('UPDATE bookings SET start_utc = ?, end_utc = ?, updated_at = ? WHERE id = ?').run(iso(start), iso(end), nowIso(), row.id);
    if (service) {
      db.prepare('UPDATE bookings SET service_id = ?, service_name = ?, color_id = ?, price = ? WHERE id = ?')
        .run(service.id, service.name, service.color_id, service.price, row.id);
    }
  });
  markPending(userId, row.id, row.google_event_id ? 'update' : 'create');
  invalidateBusyCache(userId);

  const updated = await pushToGoogle(userId, id);
  if (v.bool(input.notifyCustomer)) notify(emails.customerRescheduled(updated, settings));
  return updated;
}

export async function setBookingStatus(userId, id, status, { notifyCustomer = false } = {}) {
  v.oneOf(status, ['confirmed', 'cancelled', 'no_show'], { field: 'status', label: 'Stav' });
  const row = getBookingRow(userId, id);
  if (status === row.status) return row;
  if (status === 'cancelled') return cancelBooking(userId, id, { by: 'admin', notifyCustomer });

  if (row.status === 'cancelled') {
    const start = Date.parse(row.start_utc);
    const end = Date.parse(row.end_utc);
    const { busy } = await getBusy(userId, start - DAY, end + DAY, { fresh: true, excludeBookingId: id });
    const clash = busy.some((b) => b.start < end && b.end > start) || findLocalClash(userId, start, end, { excludeId: row.id });
    if (clash) throw conflict('Rezervaci nelze obnovit – termín je mezitím obsazený. Přesuňte ji prosím na jiný čas.');
    db.prepare('UPDATE bookings SET status = ?, cancelled_at = NULL, cancelled_by = NULL, updated_at = ? WHERE id = ?').run(status, nowIso(), row.id);
    markPending(userId, row.id, row.google_event_id ? 'update' : 'create');
    invalidateBusyCache(userId);
    return pushToGoogle(userId, id);
  }

  db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), row.id);
  return getBookingRow(userId, id);
}

export async function updateBookingDetails(userId, id, input) {
  const row = getBookingRow(userId, id);
  const customer = validateCustomer(input, getSettings(userId), { admin: true });
  const internalNote = v.text(input.internalNote, { field: 'internalNote', label: 'Interní poznámka', max: 2000, multiline: true });
  db.prepare(`
    UPDATE bookings SET customer_name = ?, customer_email = ?, customer_phone = ?, note = ?, internal_note = ?, updated_at = ?
    WHERE id = ?
  `).run(customer.name, customer.email, customer.phone, customer.note, internalNote, nowIso(), row.id);

  const visibleChanged = customer.name !== row.customer_name || customer.email !== row.customer_email
    || customer.phone !== row.customer_phone || customer.note !== row.note;
  if (visibleChanged && row.status !== 'cancelled' && row.google_event_id) {
    markPending(userId, row.id, 'update');
    return pushToGoogle(userId, id);
  }
  return getBookingRow(userId, id);
}

/* ───────────────────────── výpis pro dashboard ───────────────────────── */

const SCOPES = {
  upcoming: { where: "status = 'confirmed' AND end_utc >= :now", order: 'start_utc ASC' },
  past: { where: "status IN ('confirmed', 'no_show') AND end_utc < :now", order: 'start_utc DESC' },
  cancelled: { where: "status = 'cancelled'", order: 'start_utc DESC' },
  attention: { where: 'google_pending IS NOT NULL', order: 'start_utc ASC' },
  all: { where: '1 = 1', order: 'start_utc DESC' },
};

export function listBookings(userId, { scope = 'upcoming', q = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const settings = getSettings(userId);
  const tz = settings.timezone;
  const def = SCOPES[scope] || SCOPES.upcoming;
  const where = ['user_id = :uid', def.where];
  const params = { uid: Number(userId), now: nowIso() };

  const search = String(q || '').trim().slice(0, 100);
  if (search) {
    where.push(`(customer_name LIKE :q ESCAPE '!' OR customer_email LIKE :q ESCAPE '!' OR customer_phone LIKE :q ESCAPE '!'
      OR code LIKE :q ESCAPE '!' OR service_name LIKE :q ESCAPE '!')`);
    params.q = `%${search.replace(/[!%_]/g, (m) => `!${m}`)}%`;
  }
  if (from && v.DATE_RE.test(from)) {
    where.push('start_utc >= :from');
    params.from = iso(DateTime.fromISO(from, { zone: tz }).toMillis());
  }
  if (to && v.DATE_RE.test(to)) {
    where.push('start_utc < :to');
    params.to = iso(DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toMillis());
  }

  const whereSql = where.join(' AND ');
  const used = (sql) => Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes(`:${k}`)));
  const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ${whereSql}`).get(used(whereSql)).n;
  const rows = db.prepare(`SELECT * FROM bookings WHERE ${whereSql} ORDER BY ${def.order} LIMIT :limit OFFSET :offset`).all({
    ...used(whereSql),
    limit: Math.min(Math.max(Number(limit) || 50, 1), 5000),
    offset: Math.max(Number(offset) || 0, 0),
  });

  const counts = Object.fromEntries(Object.entries(SCOPES).map(([key, s]) => {
    const sql = `user_id = :uid AND ${s.where}`;
    return [key, db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ${sql}`).get(used(sql)).n];
  }));

  return { total, counts, items: rows.map((r) => adminBookingView(r, settings)) };
}

/** Data pro týdenní kalendář: rezervace + ostatní události z Google Kalendáře. */
export async function getCalendarRange(userId, from, to) {
  const settings = getSettings(userId);
  const tz = settings.timezone;
  v.date(from, { field: 'from' });
  v.date(to, { field: 'to' });
  const fromMs = DateTime.fromISO(from, { zone: tz }).toMillis();
  const toMs = DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toMillis();

  const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? AND start_utc < ? AND end_utc > ? ORDER BY start_utc')
    .all(Number(userId), iso(toMs), iso(fromMs))
    .map((r) => adminBookingView(r, settings));

  const result = { timezone: tz, bookings, events: [], googleError: null };
  if (google.isGoogleActive(userId)) {
    try {
      const data = await fetchGoogleWindow(userId, fromMs, toMs, { fresh: false });
      const bookingEventIds = new Set(bookings.map((b) => b.google.eventId).filter(Boolean));
      for (const event of data.events) {
        if (event.status === 'cancelled' || google.isAppEvent(event) || bookingEventIds.has(event.id)) continue;
        const interval = google.eventInterval(event, tz);
        if (!interval) continue;
        result.events.push({
          id: event.id,
          title: event.summary || '(bez názvu)',
          start: iso(interval.start),
          end: iso(interval.end),
          allDay: interval.allDay,
          blocking: google.isBlockingEvent(event, interval, settings),
        });
      }
    } catch (err) {
      result.googleError = google.describeGoogleError(err);
    }
  }
  return result;
}

/* ───────────────────────── synchronizace ───────────────────────── */

const syncRunning = new Map();

export function syncWithGoogle(userId) {
  const id = Number(userId);
  if (!syncRunning.has(id)) syncRunning.set(id, runSync(id).finally(() => syncRunning.delete(id)));
  return syncRunning.get(id);
}

async function runSync(userId) {
  if (!google.isGoogleActive(userId)) return { enabled: false };
  const settings = getSettings(userId);
  const result = { enabled: true, ok: true, pushed: 0, failed: 0, moved: 0, cancelled: 0, error: null };
  try {
    // 1) Dokončit zápisy, které se dřív nepovedly (nebo vznikly před připojením kalendáře).
    const pending = db.prepare('SELECT id FROM bookings WHERE user_id = ? AND google_pending IS NOT NULL ORDER BY start_utc LIMIT 100').all(userId);
    for (const { id } of pending) {
      const row = await pushToGoogle(userId, id);
      if (row.google_pending) result.failed++;
      else result.pushed++;
      if (!google.isGoogleActive(userId)) throw new Error('Přístup ke Google Kalendáři byl zrušen.');
    }

    // 2) Načíst změny provedené přímo v Google Kalendáři.
    const now = Date.now();
    const events = await google.listEvents(userId, now - DAY, now + (settings.maxAdvanceDays + 2) * DAY);
    const byId = new Map(events.map((e) => [e.id, e]));
    const rows = db.prepare(`
      SELECT * FROM bookings
      WHERE user_id = ? AND status = 'confirmed' AND google_event_id IS NOT NULL AND google_pending IS NULL AND end_utc > ?
    `).all(userId, iso(now));
    for (const row of rows) {
      const event = byId.has(row.google_event_id) ? byId.get(row.google_event_id) : await google.getEvent(userId, row.google_event_id);
      const change = applyEventToBooking(row, event, settings);
      if (change === 'moved') result.moved++;
      if (change === 'cancelled') result.cancelled++;
    }
    recordGoogleOk(userId);
  } catch (err) {
    result.ok = false;
    result.error = err.code || err.response ? google.describeGoogleError(err) : err.message;
    recordGoogleError(userId, result.error);
  }
  invalidateBusyCache(userId);
  if (google.getConnection(userId)) google.recordSync(userId, result);
  return result;
}

export function startBackgroundSync() {
  if (!google.oauthEnabled()) return;
  const tick = async () => {
    for (const userId of google.connectedUserIds()) {
      await syncWithGoogle(userId).catch(() => {});
    }
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, 5 * MINUTE).unref();
}

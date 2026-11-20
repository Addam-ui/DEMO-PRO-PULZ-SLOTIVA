import { calendar as calendarFactory, auth as googleAuth } from '@googleapis/calendar';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { db, nowIso } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { fmtPrice } from './format.js';

export const APP_TAG = 'slotiva';
const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const iso = (ms) => new Date(ms).toISOString();

/* ───────────── OAuth ───────────── */

export const oauthEnabled = () => config.google.enabled;

function oauthClient() {
  return new googleAuth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

/** Adresa, na kterou se uživatel přesměruje pro souhlas s přístupem ke kalendáři. */
export function authorizationUrl({ state, loginHint }) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [...LOGIN_SCOPES, ...CALENDAR_SCOPES],
    state,
    login_hint: loginHint || undefined,
  });
}

/** Vymění autorizační kód za tokeny a ověří identitu uživatele. */
export async function exchangeCode(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const p = ticket.getPayload();
  return {
    tokens,
    profile: { sub: p.sub, email: p.email, emailVerified: Boolean(p.email_verified), name: p.name || p.email },
  };
}

/* ───────────── uložené připojení ───────────── */

const connectionRow = (userId) => db.prepare('SELECT * FROM google_connections WHERE user_id = ?').get(Number(userId)) || null;
const hasCalendarScope = (scope) => CALENDAR_SCOPES.every((s) => String(scope || '').includes(s));

export function getConnection(userId) {
  const row = connectionRow(userId);
  if (!row) return null;
  return {
    email: row.google_email,
    calendarId: row.calendar_id,
    calendarName: row.calendar_name,
    busyCalendarIds: JSON.parse(row.busy_calendar_ids || '[]'),
    status: row.status,
    lastError: row.last_error,
    lastSync: row.last_sync ? JSON.parse(row.last_sync) : null,
    connectedAt: row.connected_at,
  };
}

/**
 * Stav napojení uživatele:
 * unavailable (platforma nemá nastavené OAuth) · disconnected · noscope (chybí oprávnění) · revoked · connected
 */
export function googleState(userId) {
  if (!oauthEnabled()) return 'unavailable';
  const row = connectionRow(userId);
  if (!row) return 'disconnected';
  if (row.status === 'revoked' || row.status === 'noscope') return row.status;
  return 'connected';
}

export const isGoogleActive = (userId) => googleState(userId) === 'connected';

export function saveConnection(userId, { tokens, profile }) {
  const existing = connectionRow(userId);
  const refreshToken = tokens.refresh_token || (existing ? decrypt(existing.refresh_token) : null);
  if (!refreshToken) {
    throw new Error('Google nevrátil přístupový token. V účtu Google odeberte Slotivě přístup a připojte kalendář znovu.');
  }
  const sameAccount = existing && existing.google_email === profile.email;
  const status = hasCalendarScope(tokens.scope) ? 'ok' : 'noscope';
  db.prepare(`
    INSERT INTO google_connections (user_id, google_email, refresh_token, scope, calendar_id, calendar_name, busy_calendar_ids, status, last_error, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      google_email = excluded.google_email, refresh_token = excluded.refresh_token, scope = excluded.scope,
      calendar_id = excluded.calendar_id, calendar_name = excluded.calendar_name, busy_calendar_ids = excluded.busy_calendar_ids,
      status = excluded.status, last_error = NULL, updated_at = excluded.updated_at
  `).run(
    Number(userId), profile.email, encrypt(refreshToken), tokens.scope || '',
    sameAccount ? existing.calendar_id : 'primary',
    sameAccount ? existing.calendar_name : profile.email,
    sameAccount ? existing.busy_calendar_ids : '[]',
    status, nowIso(), nowIso(),
  );
  dropClient(userId);
  return getConnection(userId);
}

export function setCalendars(userId, { calendarId, calendarName, busyCalendarIds }) {
  db.prepare('UPDATE google_connections SET calendar_id = ?, calendar_name = ?, busy_calendar_ids = ?, updated_at = ? WHERE user_id = ?')
    .run(calendarId, calendarName, JSON.stringify(busyCalendarIds.filter((id) => id !== calendarId)), nowIso(), Number(userId));
}

export function markConnection(userId, status, error = null) {
  db.prepare('UPDATE google_connections SET status = ?, last_error = ?, updated_at = ? WHERE user_id = ?')
    .run(status, error, nowIso(), Number(userId));
}

export function recordSync(userId, result) {
  db.prepare('UPDATE google_connections SET last_sync = ?, last_error = ? WHERE user_id = ?')
    .run(JSON.stringify({ at: nowIso(), ...result }), result.ok ? null : result.error, Number(userId));
}

export async function disconnect(userId) {
  const row = connectionRow(userId);
  if (!row) return;
  try {
    await oauthClient().revokeToken(decrypt(row.refresh_token));
  } catch {
    /* token už mohl být zrušený – nevadí */
  }
  db.prepare('DELETE FROM google_connections WHERE user_id = ?').run(Number(userId));
  dropClient(userId);
}

export function connectedUserIds() {
  if (!oauthEnabled()) return [];
  return db.prepare("SELECT user_id FROM google_connections WHERE status = 'ok'").all().map((r) => r.user_id);
}

/* ───────────── volání Calendar API ───────────── */

const clients = new Map();

function api(userId) {
  const id = Number(userId);
  let entry = clients.get(id);
  if (!entry) {
    const row = connectionRow(id);
    if (!row) throw Object.assign(new Error('Google Kalendář není připojený.'), { code: 'NOT_CONNECTED' });
    const client = oauthClient();
    client.setCredentials({ refresh_token: decrypt(row.refresh_token) });
    client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        db.prepare('UPDATE google_connections SET refresh_token = ?, updated_at = ? WHERE user_id = ?').run(encrypt(tokens.refresh_token), nowIso(), id);
      }
    });
    entry = { calendar: calendarFactory({ version: 'v3', auth: client, timeout: 15000 }) };
    clients.set(id, entry);
  }
  return entry.calendar;
}

export function dropClient(userId) {
  clients.delete(Number(userId));
}

export function errorStatus(err) {
  return Number(err?.status ?? err?.response?.status ?? err?.code) || 0;
}

function errorText(err) {
  const data = err?.response?.data;
  const apiError = data?.error;
  return {
    reason: apiError?.errors?.[0]?.reason || '',
    message: (typeof apiError === 'object' ? apiError?.message : data?.error_description || apiError) || err?.message || String(err),
  };
}

const isRevoked = (err) => /invalid_grant|unauthorized_client|expired or revoked/i.test(`${errorText(err).message} ${err?.message}`);
const isMissingScope = (err) => errorStatus(err) === 403 && /insufficientPermissions|insufficient authentication scopes/i.test(`${errorText(err).reason} ${errorText(err).message}`);

/** Přeloží chybu z Google API do srozumitelné české hlášky. */
export function describeGoogleError(err) {
  const status = errorStatus(err);
  const { reason, message } = errorText(err);
  if (err?.code === 'NOT_CONNECTED') return 'Google Kalendář není připojený.';
  if (isRevoked(err)) return 'Přístup ke Google Kalendáři vypršel nebo byl zrušen. Připojte prosím kalendář znovu.';
  if (isMissingScope(err)) return 'Slotiva nemá oprávnění ke kalendáři. Připojte Google znovu a povolte přístup ke kalendáři.';
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message)) {
    return 'V Google Cloud projektu platformy není zapnuté „Google Calendar API“.';
  }
  if (status === 404) return 'Vybraný kalendář nebyl nalezen. V sekci Napojení vyberte jiný kalendář.';
  if (status === 403 && /requiredAccessLevel|forbidden|writer access/i.test(`${reason} ${message}`)) {
    return 'Do vybraného kalendáře nelze zapisovat. V sekci Napojení vyberte kalendář, který vlastníte.';
  }
  if (status === 403 && /rateLimit|quota/i.test(`${reason} ${message}`)) {
    return 'Google Kalendář dočasně omezil počet požadavků. Zkuste to prosím za chvíli znovu.';
  }
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|timeout/i.test(`${err?.code} ${message}`)) {
    return 'Nepodařilo se spojit s Google Kalendářem (výpadek sítě nebo timeout).';
  }
  return `Google Kalendář: ${message}`;
}

const lostListeners = [];
/** Zaregistruje funkci, která se zavolá, když uživateli přestane fungovat přístup ke kalendáři. */
export const onConnectionLost = (fn) => lostListeners.push(fn);

/** Zavolá API a při zrušeném přístupu označí napojení jako neplatné. */
async function call(userId, fn) {
  try {
    return await fn(api(userId));
  } catch (err) {
    if (isRevoked(err) || isMissingScope(err)) {
      const wasOk = connectionRow(userId)?.status === 'ok';
      const message = describeGoogleError(err);
      markConnection(userId, isRevoked(err) ? 'revoked' : 'noscope', message);
      dropClient(userId);
      if (wasOk) lostListeners.forEach((listener) => listener(Number(userId), message));
    }
    throw err;
  }
}

const isGone = (err) => [404, 410].includes(errorStatus(err));
const calendarIdOf = (userId) => connectionRow(userId)?.calendar_id || 'primary';

/** Převede událost na interval v ms. Celodenní události se počítají v časovém pásmu firmy. */
export function eventInterval(event, timezone) {
  if (event.start?.dateTime && event.end?.dateTime) {
    return { start: Date.parse(event.start.dateTime), end: Date.parse(event.end.dateTime), allDay: false };
  }
  if (event.start?.date && event.end?.date) {
    return {
      start: DateTime.fromISO(event.start.date, { zone: timezone }).toMillis(),
      end: DateTime.fromISO(event.end.date, { zone: timezone }).toMillis(),
      allDay: true,
    };
  }
  return null;
}

/** Blokuje událost čas? Zrušené ne, „volné“ ne; celodenní podle nastavení. */
export function isBlockingEvent(event, interval, settings) {
  if (!interval || event.status === 'cancelled') return false;
  if (interval.allDay) return settings.allDayEventsBlock || event.transparency !== 'transparent';
  return event.transparency !== 'transparent';
}

export const isAppEvent = (event) => event.extendedProperties?.private?.rsApp === APP_TAG;

export async function listCalendars(userId) {
  return call(userId, async (calendar) => {
    const { data } = await calendar.calendarList.list({
      minAccessRole: 'freeBusyReader',
      maxResults: 250,
      fields: 'items(id,summary,summaryOverride,primary,accessRole,backgroundColor)',
    });
    return (data.items || [])
      .map((c) => ({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        primary: Boolean(c.primary),
        canWrite: ['owner', 'writer'].includes(c.accessRole),
        color: c.backgroundColor || null,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, 'cs'));
  });
}

/** Všechny události hlavního kalendáře v rozsahu (včetně zrušených – kvůli synchronizaci). */
export async function listEvents(userId, fromMs, toMs) {
  return call(userId, async (calendar) => {
    const items = [];
    let pageToken;
    do {
      const { data } = await calendar.events.list({
        calendarId: calendarIdOf(userId),
        timeMin: iso(fromMs),
        timeMax: iso(toMs),
        singleEvents: true,
        showDeleted: true,
        maxResults: 2500,
        pageToken,
        fields: 'nextPageToken,items(id,status,summary,start,end,transparency,extendedProperties)',
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  });
}

/** Obsazenost dalších vybraných kalendářů uživatele. */
export async function queryFreeBusy(userId, fromMs, toMs) {
  const ids = getConnection(userId)?.busyCalendarIds || [];
  if (!ids.length) return { busy: [], errors: [] };
  return call(userId, async (calendar) => {
    const { data } = await calendar.freebusy.query({
      requestBody: { timeMin: iso(fromMs), timeMax: iso(toMs), items: ids.map((id) => ({ id })) },
    });
    const busy = [];
    const errors = [];
    for (const [id, cal] of Object.entries(data.calendars || {})) {
      if (cal.errors?.length) errors.push(`${id}: ${cal.errors.map((e) => e.reason).join(', ')}`);
      for (const b of cal.busy || []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
    return { busy, errors };
  });
}

function eventBody(booking, settings) {
  const description = [
    `Rezervace ${booking.code} přes Slotivu`,
    '',
    `Služba: ${booking.service_name}`,
    `Cena: ${fmtPrice(booking.price)}`,
    `Klient: ${booking.customer_name}`,
    booking.customer_phone ? `Telefon: ${booking.customer_phone}` : null,
    booking.customer_email ? `E-mail: ${booking.customer_email}` : null,
    booking.note ? `Poznámka: ${booking.note}` : null,
    '',
    `Detail: ${config.baseUrl}/app/#/rezervace/${booking.id}`,
  ].filter((line) => line !== null);

  return {
    summary: `${booking.service_name} – ${booking.customer_name}`,
    description: description.join('\n'),
    location: settings.business.address || undefined,
    start: { dateTime: iso(Date.parse(booking.start_utc)), timeZone: settings.timezone },
    end: { dateTime: iso(Date.parse(booking.end_utc)), timeZone: settings.timezone },
    colorId: booking.color_id,
    transparency: 'opaque',
    extendedProperties: { private: { rsApp: APP_TAG, rsBookingId: String(booking.id), rsCode: booking.code } },
  };
}

export async function insertEvent(userId, booking, settings) {
  return call(userId, async (calendar) => {
    const { data } = await calendar.events.insert({
      calendarId: calendarIdOf(userId), requestBody: eventBody(booking, settings), sendUpdates: 'none', fields: 'id',
    });
    return data.id;
  });
}

export async function updateEvent(userId, eventId, booking, settings) {
  try {
    await call(userId, (calendar) => calendar.events.patch({
      calendarId: calendarIdOf(userId), eventId, requestBody: { ...eventBody(booking, settings), status: 'confirmed' }, sendUpdates: 'none', fields: 'id',
    }));
    return eventId;
  } catch (err) {
    if (isGone(err)) return insertEvent(userId, booking, settings); // událost mezitím zmizela → vytvořit novou
    throw err;
  }
}

export async function deleteEvent(userId, eventId) {
  try {
    await call(userId, (calendar) => calendar.events.delete({ calendarId: calendarIdOf(userId), eventId, sendUpdates: 'none' }));
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

export async function getEvent(userId, eventId) {
  try {
    const { data } = await call(userId, (calendar) => calendar.events.get({
      calendarId: calendarIdOf(userId), eventId, fields: 'id,status,summary,start,end,transparency,extendedProperties',
    }));
    return data;
  } catch (err) {
    if (isGone(err)) return null;
    throw err;
  }
}

/** Ověří přístup k vybranému kalendáři. */
export async function checkConnection(userId) {
  try {
    const data = await call(userId, async (calendar) => (await calendar.calendars.get({ calendarId: calendarIdOf(userId), fields: 'summary,timeZone' })).data);
    return { ok: true, calendarName: data.summary, calendarTimeZone: data.timeZone };
  } catch (err) {
    return { ok: false, error: describeGoogleError(err) };
  }
}

/** Vytvoří a hned smaže testovací událost – ověří oprávnění k zápisu. */
export async function testWrite(userId) {
  const start = Date.now() + 24 * 3600_000;
  const id = await call(userId, async (calendar) => (await calendar.events.insert({
    calendarId: calendarIdOf(userId),
    requestBody: {
      summary: 'Slotiva – test zápisu',
      description: 'Tuto událost vytvořil test připojení a hned ji zase smazal.',
      start: { dateTime: iso(start) },
      end: { dateTime: iso(start + 15 * 60_000) },
      transparency: 'transparent',
    },
    sendUpdates: 'none',
    fields: 'id',
  })).data.id);
  await deleteEvent(userId, id);
}

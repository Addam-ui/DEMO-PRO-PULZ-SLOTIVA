import express from 'express';
import crypto from 'node:crypto';
import { hashPassword } from '../crypto.js';
import { teamForOwner, teamOwner, memberFor } from '../team.js';
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

// Účty zaměstnanců vidí jen své údaje; majitel může vybrat člena týmu.
const uid = (req) => req.teamTarget || req.user.id;
appRouter.use((req,res,next)=>{
  const membership=db.prepare('SELECT active FROM team_members WHERE member_id=?').get(req.user.id);
  if(membership && !membership.active) return next(badRequest('Účet zaměstnance je deaktivovaný.'));
  const target = req.get('X-Slotiva-Barber');
  if (target && teamOwner(req.user.id) === req.user.id) {
    try { req.teamTarget = memberFor(req.user.id, Number(target)); } catch(e) { return next(e); }
  }
  next();
});

appRouter.get('/team', (req,res)=>{
  const ownerId = teamOwner(req.user.id);
  res.json({isOwner:ownerId===req.user.id, ownerId, members: teamForOwner(ownerId)});
});
appRouter.post('/team', async (req,res)=>{
  if (teamOwner(req.user.id)!==req.user.id) throw badRequest('Tým může spravovat jen majitel.');
  const {name,email,password}=req.body||{};
  if (!['Kikin','Honza'].includes(String(name||'').trim()) && !String(name||'').trim()) throw badRequest('Vyplňte jméno.');
  const member=await users.registerUser({name,email,password});
  db.prepare('INSERT INTO team_members(owner_id,member_id,display_name) VALUES(?,?,?)').run(req.user.id,member.id,member.name);
  db.prepare('DELETE FROM services WHERE user_id=?').run(member.id);
  for (const [label,price,duration] of [['Pánský střih',390,30],['Dětský střih',290,25],['Combo',590,45]]) createService(member.id,{name:label,price,durationMin:duration,description:'',colorId:'9'});
  res.status(201).json({ok:true});
});
appRouter.post('/team/demo', (req,res)=>{
  if (teamOwner(req.user.id)!==req.user.id) throw badRequest('Demo může spustit jen majitel.');
  const members=teamForOwner(req.user.id).filter(m=>m.active);
  if(!members.length) throw badRequest('Nejdřív vytvořte účty barberů.');
  const names=['Petr Dvořák','Jakub Novák','Martin Svoboda','Tomáš Beneš','David Král','Filip Marek','Adam Dvořák','Lukáš Černý'];
  let created=0;
  for(const member of members){
    const marker=`pulz-team-demo:${member.id}`;
    if(db.prepare('SELECT 1 FROM kv WHERE key=?').get(marker))continue;
    const services=db.prepare('SELECT * FROM services WHERE user_id=? AND active=1').all(member.id);
    if(!services.length)continue;
    const insert=db.prepare(`INSERT INTO bookings (user_id,code,cancel_token,service_id,service_name,color_id,price,start_utc,end_utc,customer_name,customer_email,status,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'demo')`);
    for(let offset=-21;offset<=14;offset++){
      const date=new Date();date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()+offset);
      if([0,6].includes(date.getUTCDay()))continue;
      for(let slot=0;slot<4;slot++){
        if((offset+slot+member.id)%5===0)continue;
        const service=services[(offset+slot+1000)%services.length];
        const start=new Date(date);start.setUTCHours(8+slot*2,0,0,0);
        const end=new Date(start.getTime()+service.duration_min*60000);
        const person=names[(offset+slot+member.id+1000)%names.length];
        const status=offset<0 && slot===3 && offset%4===0?'cancelled':'confirmed';
        insert.run(member.id,crypto.randomBytes(6).toString('hex').toUpperCase(),crypto.randomBytes(24).toString('base64url'),service.id,service.name,service.color_id,service.price,start.toISOString(),end.toISOString(),person,`demo${created}@example.com`,status);
        created++;
      }
    }
    db.prepare('INSERT INTO kv(key,value) VALUES(?,?)').run(marker,new Date().toISOString());
  }
  res.json({ok:true,created});
});

// Majitel nastaví skutečný přihlašovací e-mail a heslo demo zaměstnanci.
appRouter.post('/team/:id/activate', async (req,res)=>{
  if(teamOwner(req.user.id)!==req.user.id) throw badRequest('Účty může aktivovat jen majitel.');
  const memberId=Number(req.params.id);
  if(!db.prepare('SELECT 1 FROM team_members WHERE owner_id=? AND member_id=?').get(req.user.id,memberId)) throw badRequest('Člen týmu neexistuje.');
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=req.body?.password;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254) throw badRequest('Zadejte platný e-mail.');
  if(typeof password!=='string'||password.length<8||password.length>200) throw badRequest('Heslo musí mít 8–200 znaků.');
  const existing=users.getUserByEmail(email);
  if(existing&&existing.id!==memberId) throw badRequest('Tento e-mail už někdo používá.');
  const hash=await hashPassword(password);
  db.prepare('UPDATE users SET email=?,password_hash=?,session_version=session_version+1 WHERE id=?').run(email,hash,memberId);
  res.json({ok:true});
});

appRouter.patch('/team/:id', (req,res)=>{
  if (teamOwner(req.user.id)!==req.user.id) throw badRequest('Tým může spravovat jen majitel.');
  const memberId=Number(req.params.id);
  const member=db.prepare('SELECT * FROM team_members WHERE owner_id=? AND member_id=?').get(req.user.id,memberId);
  if(!member) throw badRequest('Člen týmu neexistuje.');
  const name=String(req.body?.name??member.display_name).trim().slice(0,80);
  if(!name) throw badRequest('Jméno je povinné.');
  const active=req.body?.active===undefined?member.active:(req.body.active?1:0);
  db.prepare('UPDATE team_members SET display_name=?,active=? WHERE owner_id=? AND member_id=?').run(name,active,req.user.id,memberId);
  res.json({ok:true});
});

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
    team: {isOwner: teamOwner(req.user.id)===req.user.id, members: teamForOwner(teamOwner(req.user.id)), selectedId:uid(req)},
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
  const user = users.updateProfile(req.user.id, req.body || {});
  res.json({ user: users.publicUser(user), bookingUrl: bookingUrl(user) });
});

appRouter.post('/password', async (req, res) => {
  const user = await users.changePassword(req.user.id, req.body || {});
  startSession(res, user); // verze relace se změnila → vydat novou cookie
  res.json({ ok: true });
});

appRouter.delete('/account', async (req, res) => {
  const user = users.getUserRow(req.user.id);
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

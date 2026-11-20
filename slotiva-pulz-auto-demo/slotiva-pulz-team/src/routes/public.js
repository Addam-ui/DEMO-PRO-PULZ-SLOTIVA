import express from 'express';
import { publicBarbers, memberFor } from '../team.js';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { listServices } from '../services.js';
import { getUserBySlug } from '../users.js';
import * as bookings from '../bookings.js';
import { bookingIcs } from '../emails.js';
import { mailEnabled } from '../mailer.js';
import { rateLimit } from '../http.js';
import { badRequest, notFound } from '../errors.js';

export const publicRouter = express.Router();

/** Údaje provozovatele pro právní stránky – doplní je legal.js. */
publicRouter.get('/site', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ appName: config.appName, demoSlug: config.demoSlug, registration: config.allowRegistration });
});

publicRouter.get('/operator', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.json(config.operator);
});

publicRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function ownerOf(slug) {
  const user = getUserBySlug(slug);
  if (!user) throw notFound('Tato rezervační stránka neexistuje.');
  return user;
}

publicRouter.get('/pages/:slug', (req, res) => {
  const user = ownerOf(req.params.slug);
  const s = getSettings(user.id);
  res.json({
    slug: user.slug,
    barbers: publicBarbers(user.id),
    business: s.business,
    brandColor: s.brandColor,
    timezone: s.timezone,
    today: DateTime.now().setZone(s.timezone).toISODate(),
    maxAdvanceDays: s.maxAdvanceDays,
    minNoticeHours: s.minNoticeHours,
    cancelLimitHours: s.cancelLimitHours,
    requirePhone: s.requirePhone,
    confirmationMessage: s.confirmationMessage,
    emailsEnabled: mailEnabled(),
    services: (publicBarbers(user.id).length ? publicBarbers(user.id).map(b=>b.id) : [user.id]).flatMap(barberId =>
      listServices(barberId,{activeOnly:true}).map(({id,name,description,durationMin,price,color})=>({
        id,name,description,durationMin,price,color,barberId,
      }))),
  });
});

publicRouter.get('/pages/:slug/availability', rateLimit({ windowMs: 60_000, max: 90 }), async (req, res) => {
  const user = ownerOf(req.params.slug);
  const barberId = req.query.barberId ? memberFor(user.id,req.query.barberId) : user.id;
  res.json(await bookings.getAvailability(barberId, {
    serviceId: req.query.serviceId,
    from: String(req.query.from || ''),
    to: String(req.query.to || ''),
  }));
});

publicRouter.post(
  '/pages/:slug/bookings',
  rateLimit({ windowMs: 15 * 60_000, max: 8, message: 'Z tohoto zařízení bylo odesláno příliš mnoho rezervací. Zkuste to prosím později.' }),
  async (req, res) => {
    const body = req.body || {};
    if (body.website) throw badRequest('Rezervaci se nepodařilo odeslat.'); // skryté pole pro roboty
    const user = ownerOf(req.params.slug);
    const barberId = body.barberId ? memberFor(user.id,body.barberId) : user.id;
    const row = await bookings.createBooking(barberId, body, { source: 'web' });
    res.status(201).json({ booking: bookings.publicBookingView(row) });
  },
);

publicRouter.get('/bookings/:token', (req, res) => {
  res.json({ booking: bookings.publicBookingView(bookings.getBookingByToken(req.params.token)) });
});

publicRouter.post('/bookings/:token/cancel', rateLimit({ windowMs: 15 * 60_000, max: 20 }), async (req, res) => {
  const row = await bookings.cancelByToken(req.params.token);
  res.json({ booking: bookings.publicBookingView(row) });
});

publicRouter.get('/bookings/:token/ics', (req, res) => {
  const row = bookings.getBookingByToken(req.params.token);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rezervace-${row.code}.ics"`);
  res.send(bookingIcs(row, getSettings(row.user_id)));
});

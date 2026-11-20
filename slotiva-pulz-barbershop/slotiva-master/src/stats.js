import { DateTime } from 'luxon';
import { db } from './db.js';
import { getSettings, colorHex } from './settings.js';
import { openMinutes } from './availability.js';
import { adminBookingView } from './bookings.js';
import { localParts } from './format.js';

const iso = (dt) => new Date(dt.toMillis()).toISOString();
const ACTIVE = "status IN ('confirmed', 'no_show')";

export function getDashboardStats(userId) {
  const uid = Number(userId);
  const settings = getSettings(uid);
  const tz = settings.timezone;
  const now = DateTime.now().setZone(tz);
  const nowIso = new Date().toISOString();
  const today = now.startOf('day');
  const tomorrow = today.plus({ days: 1 });
  const week = now.startOf('week');
  const month = now.startOf('month');

  const one = (sql, ...params) => db.prepare(sql).get(uid, ...params);
  const countBetween = (from, to, where = ACTIVE) =>
    one(`SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND ${where} AND start_utc >= ? AND start_utc < ?`, iso(from), iso(to)).n;
  const revenueBetween = (from, to) =>
    one("SELECT COALESCE(SUM(price), 0) AS s FROM bookings WHERE user_id = ? AND status = 'confirmed' AND start_utc >= ? AND start_utc < ?", iso(from), iso(to)).s;
  const createdBetween = (from, to = now) =>
    one('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND created_at >= ? AND created_at < ?', iso(from), iso(to)).n;

  const next = one(
    "SELECT * FROM bookings WHERE user_id = ? AND status = 'confirmed' AND start_utc >= ? AND start_utc < ? ORDER BY start_utc LIMIT 1",
    nowIso, iso(tomorrow),
  );

  const bookedMinutes = one(
    `SELECT COALESCE(SUM((julianday(end_utc) - julianday(start_utc)) * 1440), 0) AS m
     FROM bookings WHERE user_id = ? AND ${ACTIVE} AND start_utc >= ? AND start_utc < ?`,
    iso(week), iso(week.plus({ weeks: 1 })),
  ).m;
  const weekOpenMinutes = openMinutes(settings, week.toISODate(), week.plus({ days: 6 }).toISODate());

  const created30 = createdBetween(now.minus({ days: 30 }));
  const cancelled30 = one("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'cancelled' AND created_at >= ?", iso(now.minus({ days: 30 }))).n;

  // Rezervace po dnech: 20 dní zpět + dnes + 13 dní dopředu
  const seriesFrom = today.minus({ days: 20 });
  const seriesTo = today.plus({ days: 14 });
  const buckets = new Map();
  for (const row of db.prepare(`SELECT start_utc, price FROM bookings WHERE user_id = ? AND ${ACTIVE} AND start_utc >= ? AND start_utc < ?`)
    .all(uid, iso(seriesFrom), iso(seriesTo))) {
    const { date } = localParts(row.start_utc, tz);
    const bucket = buckets.get(date) || { count: 0, revenue: 0 };
    bucket.count++;
    bucket.revenue += row.price;
    buckets.set(date, bucket);
  }
  const series = [];
  for (let d = seriesFrom; d < seriesTo; d = d.plus({ days: 1 })) {
    const date = d.toISODate();
    series.push({
      date,
      weekday: d.weekday,
      count: buckets.get(date)?.count || 0,
      revenue: buckets.get(date)?.revenue || 0,
      isToday: date === today.toISODate(),
      isFuture: d > today,
    });
  }

  const services = db.prepare(`
    SELECT service_name AS name, color_id AS colorId, COUNT(*) AS count, COALESCE(SUM(price), 0) AS revenue
    FROM bookings WHERE user_id = ? AND ${ACTIVE} AND start_utc >= ?
    GROUP BY service_name ORDER BY count DESC, name LIMIT 8
  `).all(uid, iso(today.minus({ days: 90 }))).map((s) => ({ ...s, color: colorHex(s.colorId) }));

  const upcoming = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND status = 'confirmed' AND end_utc >= ? ORDER BY start_utc LIMIT 6")
    .all(uid, nowIso)
    .map((r) => adminBookingView(r, settings));

  return {
    generatedAt: nowIso,
    timezone: tz,
    totalBookings: one('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?').n,
    today: {
      count: countBetween(today, tomorrow),
      remaining: countBetween(now, tomorrow, "status = 'confirmed'"),
      next: next ? adminBookingView(next, settings) : null,
    },
    week: {
      count: countBetween(week, week.plus({ weeks: 1 })),
      previous: countBetween(week.minus({ weeks: 1 }), week),
    },
    revenue: {
      month: revenueBetween(month, month.plus({ months: 1 })),
      previousMonth: revenueBetween(month.minus({ months: 1 }), month),
      monthLabel: month.setLocale('cs').toFormat('LLLL'),
    },
    occupancy: {
      bookedMinutes: Math.round(bookedMinutes),
      openMinutes: weekOpenMinutes,
      ratio: weekOpenMinutes > 0 ? Math.min(1, bookedMinutes / weekOpenMinutes) : 0,
    },
    created: {
      last7: createdBetween(now.minus({ days: 7 })),
      previous7: createdBetween(now.minus({ days: 14 }), now.minus({ days: 7 })),
    },
    cancellations: { last30: cancelled30, rate: created30 > 0 ? cancelled30 / created30 : 0 },
    series,
    services,
    upcoming,
    attention: one('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND google_pending IS NOT NULL').n,
  };
}

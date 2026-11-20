/**
 * Ukázková data pro jeden účet – ať je vidět, jak dashboard vypadá v provozu.
 *
 *   npm run demo -- --email vas@email.cz            přidá služby a rezervace (6 týdnů zpět, 3 týdny dopředu)
 *   npm run demo -- --email vas@email.cz --smazat   ukázková data zase odstraní
 *
 * Ukázkové rezervace mají zdroj „demo“ a do Google Kalendáře se nikdy nezapisují.
 * Nastavení účtu (název, otevírací doba…) skript nemění.
 */

import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { db, transaction, nowIso } from '../src/db.js';
import { getUserByEmail } from '../src/users.js';
import { getSettings } from '../src/settings.js';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const email = option('--email');
if (!email) {
  console.error('\n  Použití: npm run demo -- --email vas@email.cz [--smazat]\n');
  process.exit(1);
}
const user = getUserByEmail(email);
if (!user) {
  console.error(`\n  ✖ Účet ${email} neexistuje. Založte ho registrací nebo příkazem: npm run admin -- --heslo ${email}\n`);
  process.exit(1);
}

const KV_KEY = `demo:${user.id}`;
const stored = db.prepare('SELECT value FROM kv WHERE key = ?').get(KV_KEY);

/* ───────────── smazání ───────────── */

function remove() {
  const info = stored ? JSON.parse(stored.value) : { serviceIds: [] };
  const result = transaction(() => {
    const bookings = db.prepare("DELETE FROM bookings WHERE user_id = ? AND source = 'demo'").run(user.id).changes;
    const deleteService = db.prepare('DELETE FROM services WHERE id = ? AND user_id = ?');
    let services = 0;
    for (const id of info.serviceIds) services += Number(deleteService.run(id, user.id).changes);
    db.prepare('DELETE FROM kv WHERE key = ?').run(KV_KEY);
    return { bookings: Number(bookings), services };
  });
  console.log(`\n  ✔ Ukázková data u účtu ${user.email} smazána: ${result.bookings} rezervací, ${result.services} služeb.\n`);
}

/* ───────────── vytvoření ───────────── */

const SERVICES = [
  { name: 'Pánský střih', description: 'Střih nůžkami i strojkem, mytí a styling.', duration: 45, price: 450, color: '9', weight: 5 },
  { name: 'Střih + úprava vousů', description: 'Kompletní péče: střih, vousy, horký ručník.', duration: 60, price: 650, color: '2', weight: 3 },
  { name: 'Úprava vousů', description: 'Tvarování, zkrácení a olej na vousy.', duration: 30, price: 300, color: '6', weight: 3 },
  { name: 'Dětský střih', description: 'Pro kluky do 12 let.', duration: 30, price: 300, color: '5', weight: 1 },
  { name: 'Konzultace', description: 'Nezávazná domluva nového stylu.', duration: 15, price: 0, color: '7', weight: 1 },
];

const PEOPLE = [
  'Petr Dvořák', 'Martin Beneš', 'Tomáš Král', 'Jakub Marek', 'Jan Černý', 'Lukáš Pokorný', 'David Svoboda', 'Ondřej Fiala',
  'Filip Růžička', 'Michal Zeman', 'Adam Kopecký', 'Vojtěch Hájek', 'Eva Nováková', 'Lucie Horáková', 'Tereza Veselá', 'Klára Bílá',
];
const NOTES = ['Prosím kratší po stranách.', 'Přijdu možná o pár minut později.', 'Jsem u vás poprvé.', 'Stejně jako minule.'];

// Deterministický generátor – opakované spuštění dá podobný rozpis.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ascii = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => [...crypto.randomBytes(6)].map((b) => CODE_ALPHABET[b % 32]).join('');
const token = () => crypto.randomBytes(24).toString('base64url');

function seed() {
  if (stored) {
    console.error(`\n  ✖ Účet ${user.email} už ukázková data má. Nejdřív je smažte: npm run demo -- --email ${user.email} --smazat\n`);
    process.exitCode = 1;
    return;
  }

  const rnd = random(user.id * 7919 + 17);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const settings = getSettings(user.id);
  const tz = settings.timezone;
  const now = DateTime.now().setZone(tz);
  const nowMs = now.toMillis();

  // Otevírací doba účtu; když žádná není, rezervace se rozloží do Po–Pá 9–17.
  const hoursFor = (weekday) => {
    const own = settings.workingHours?.[weekday] || settings.workingHours?.[String(weekday)] || [];
    const anyOpen = Object.values(settings.workingHours || {}).some((d) => d.length);
    if (anyOpen) return own;
    return weekday <= 5 ? [{ from: '09:00', to: '17:00' }] : [];
  };

  // Skutečné rezervace, se kterými se ukázkové nesmí překrývat
  const from = now.startOf('day').minus({ days: 42 });
  const to = now.startOf('day').plus({ days: 22 });
  const taken = db.prepare(`
    SELECT start_utc, end_utc FROM bookings
    WHERE user_id = ? AND status IN ('confirmed', 'no_show') AND start_utc < ? AND end_utc > ?
  `).all(user.id, to.toUTC().toISO(), from.toUTC().toISO()).map((r) => [Date.parse(r.start_utc), Date.parse(r.end_utc)]);
  const clashes = (s, e) => taken.some(([ts, te]) => ts < e && te > s);

  const totalWeight = SERVICES.reduce((sum, s) => sum + s.weight, 0);
  const pickService = (list) => {
    let r = rnd() * totalWeight;
    for (const s of list) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return list[0];
  };

  const counts = { confirmed: 0, cancelled: 0, no_show: 0 };

  const serviceIds = transaction(() => {
    const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM services WHERE user_id = ?').get(user.id);
    const insertService = db.prepare(
      'INSERT INTO services (user_id, name, description, duration_min, price, color_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const created = SERVICES.map((s, i) => ({
      ...s,
      id: Number(insertService.run(user.id, s.name, s.description, s.duration, s.price, s.color, next + i).lastInsertRowid),
    }));

    const insertBooking = db.prepare(`
      INSERT INTO bookings (user_id, code, cancel_token, service_id, service_name, color_id, price, start_utc, end_utc,
        customer_name, customer_email, customer_phone, note, status, source, cancelled_at, cancelled_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?)
    `);

    for (let day = from; day < to; day = day.plus({ days: 1 })) {
      const offset = Math.round(day.diff(now.startOf('day'), 'days').days);
      // Minulost je plnější, budoucnost řídne – tak to v provozu obvykle vypadá
      const fill = offset < 0 ? 0.5 + rnd() * 0.3 : Math.max(0.12, 0.62 - (offset / 21) * 0.45 + rnd() * 0.12);

      for (const interval of hoursFor(day.weekday)) {
        const [fh, fm] = interval.from.split(':').map(Number);
        const [th, tm] = interval.to.split(':').map(Number);
        let cursor = day.set({ hour: fh, minute: fm });
        const end = day.set({ hour: th, minute: tm });

        while (cursor < end) {
          const service = pickService(created);
          const startMs = cursor.toMillis();
          const endMs = startMs + service.duration * 60_000;
          if (rnd() < fill && endMs <= end.toMillis() && !clashes(startMs, endMs)) {
            const person = pick(PEOPLE);
            const [first, last] = ascii(person).split(' ');
            const past = endMs < nowMs;
            const r = rnd();
            const status = past ? (r < 0.05 ? 'no_show' : r < 0.13 ? 'cancelled' : 'confirmed') : (r < 0.07 ? 'cancelled' : 'confirmed');
            const createdMs = Math.min(startMs - Math.round((1 + rnd() * 13) * 86_400_000 * rnd() + 3_600_000), nowMs - 300_000);
            const cancelledMs = status === 'cancelled' ? Math.max(createdMs + 600_000, Math.min(startMs - 3_600_000, nowMs - 60_000)) : null;
            const phone = `+420 7${String(Math.floor(rnd() * 100)).padStart(2, '0')} ${String(Math.floor(rnd() * 1000)).padStart(3, '0')} ${String(Math.floor(rnd() * 1000)).padStart(3, '0')}`;

            for (let attempt = 0; ; attempt++) {
              try {
                insertBooking.run(
                  user.id, code(), token(), service.id, service.name, service.color, service.price,
                  new Date(startMs).toISOString(), new Date(endMs).toISOString(),
                  person, `${first}.${last}@example.com`, phone, rnd() < 0.18 ? pick(NOTES) : '',
                  status,
                  cancelledMs ? new Date(cancelledMs).toISOString() : null,
                  cancelledMs ? (rnd() < 0.7 ? 'customer' : 'admin') : null,
                  new Date(createdMs).toISOString(),
                  new Date(cancelledMs ?? createdMs).toISOString(),
                );
                break;
              } catch (err) {
                if (attempt < 3 && /UNIQUE/.test(err.message)) continue;
                throw err;
              }
            }
            counts[status]++;
            if (status !== 'cancelled') taken.push([startMs, endMs]);
            cursor = cursor.plus({ minutes: service.duration });
          } else {
            cursor = cursor.plus({ minutes: 30 });
          }
        }
      }
    }

    const ids = created.map((s) => s.id);
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(KV_KEY, JSON.stringify({ serviceIds: ids, createdAt: nowIso() }));
    return ids;
  });

  const total = counts.confirmed + counts.cancelled + counts.no_show;
  console.log('');
  console.log(`  ✔ Ukázková data přidána k účtu ${user.email} (/${user.slug})`);
  console.log(`    služby:     ${serviceIds.length}`);
  console.log(`    rezervace:  ${total} (potvrzené ${counts.confirmed}, zrušené ${counts.cancelled}, nedostavil se ${counts.no_show})`);
  console.log(`    období:     ${from.toISODate()} – ${to.minus({ days: 1 }).toISODate()}`);
  console.log('    Do Google Kalendáře se nezapisují.');
  console.log(`    Smazání:    npm run demo -- --email ${user.email} --smazat`);
  console.log('');
}

if (args.includes('--smazat')) remove();
else seed();

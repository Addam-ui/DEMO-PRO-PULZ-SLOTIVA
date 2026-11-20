import { DateTime } from 'luxon';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function localDateTime(date, time, timezone) {
  return DateTime.fromISO(`${date}T${time}`, { zone: timezone });
}

function overlaps(blocks, start, end) {
  for (const b of blocks) {
    if (b.start >= end) break; // bloky jsou seřazené podle začátku
    if (b.end > start) return true;
  }
  return false;
}

/**
 * Spočítá volné časy pro službu v rozsahu dní.
 *
 * @param {object}  opts
 * @param {object}  opts.settings    nastavení (otevírací doba, krok, pauza, předstih…)
 * @param {number}  opts.durationMin délka služby v minutách
 * @param {string}  opts.fromDate    první den (RRRR-MM-DD, v časovém pásmu firmy)
 * @param {string}  opts.toDate      poslední den včetně
 * @param {Array<{start:number,end:number}>} opts.busy obsazené intervaly (ms od epochy)
 * @param {number}  [opts.now]       aktuální čas (ms) – kvůli testům
 * @param {boolean} [opts.applyRules] false = ignoruje minimální předstih a limit dní dopředu (pro admina)
 * @returns {Record<string, Array<{time:string,start:number,end:number}>>}
 */
export function computeSlots({ settings, durationMin, fromDate, toDate, busy = [], now = Date.now(), applyRules = true }) {
  const tz = settings.timezone;
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  const lastDay = today.plus({ days: settings.maxAdvanceDays });
  const earliestStart = now + settings.minNoticeHours * HOUR;
  const stepMin = settings.slotStep > 0 ? settings.slotStep : durationMin;
  const buffer = settings.bufferMin * MINUTE;
  const durationMs = durationMin * MINUTE;

  const blocks = busy
    .map((b) => ({ start: b.start - buffer, end: b.end + buffer }))
    .sort((a, b) => a.start - b.start);

  const result = {};
  let day = DateTime.fromISO(fromDate, { zone: tz }).startOf('day');
  const last = DateTime.fromISO(toDate, { zone: tz }).startOf('day');

  while (day <= last) {
    const date = day.toISODate();
    const slots = [];
    const inWindow = !applyRules || (day >= today && day <= lastDay);

    if (inWindow) {
      for (const { from, to } of settings.workingHours[String(day.weekday)] || []) {
        const intervalEnd = localDateTime(date, to, tz).toMillis();
        let t = localDateTime(date, from, tz);
        while (t.toMillis() + durationMs <= intervalEnd) {
          const start = t.toMillis();
          const end = start + durationMs;
          if ((!applyRules || start >= earliestStart) && !overlaps(blocks, start, end)) {
            slots.push({ time: t.toFormat('HH:mm'), start, end });
          }
          t = t.plus({ minutes: stepMin });
        }
      }
    }

    result[date] = slots;
    day = day.plus({ days: 1 });
  }
  return result;
}

/** Najde konkrétní volný termín (datum + čas), nebo vrátí null. */
export function findSlot({ date, time, ...opts }) {
  const slots = computeSlots({ ...opts, fromDate: date, toDate: date })[date] || [];
  return slots.find((s) => s.time === time) || null;
}

/** Součet otevíracích minut v rozsahu dní (pro výpočet vytíženosti). */
export function openMinutes(settings, fromDate, toDate) {
  const tz = settings.timezone;
  let total = 0;
  let day = DateTime.fromISO(fromDate, { zone: tz }).startOf('day');
  const last = DateTime.fromISO(toDate, { zone: tz }).startOf('day');
  while (day <= last) {
    const date = day.toISODate();
    for (const { from, to } of settings.workingHours[String(day.weekday)] || []) {
      total += (localDateTime(date, to, tz).toMillis() - localDateTime(date, from, tz).toMillis()) / MINUTE;
    }
    day = day.plus({ days: 1 });
  }
  return total;
}

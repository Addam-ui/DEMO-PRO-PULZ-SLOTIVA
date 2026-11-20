import { DateTime } from 'luxon';

export function toMs(value) {
  return typeof value === 'number' ? value : Date.parse(value);
}

export function zoned(value, timezone) {
  return DateTime.fromMillis(toMs(value), { zone: timezone }).setLocale('cs');
}

/** „pátek 11. září 2026“ */
export const fmtDateLong = (value, tz) => zoned(value, tz).toFormat('cccc d. MMMM yyyy');
/** „11. 9. 2026“ */
export const fmtDateShort = (value, tz) => zoned(value, tz).toFormat('d. M. yyyy');
/** „14:30“ */
export const fmtTime = (value, tz) => zoned(value, tz).toFormat('HH:mm');

export function localParts(value, tz) {
  const d = zoned(value, tz);
  return { date: d.toISODate(), time: d.toFormat('HH:mm') };
}

const priceFormatter = new Intl.NumberFormat('cs-CZ');
export function fmtPrice(price) {
  return price > 0 ? `${priceFormatter.format(price)} Kč` : 'Zdarma';
}

export function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

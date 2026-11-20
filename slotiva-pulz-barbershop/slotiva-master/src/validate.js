import { badRequest } from './errors.js';

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function fail(field, message) {
  return badRequest(message, { field });
}

/** Ořízne text, odstraní řídicí znaky a zkontroluje délku. */
export function text(value, { field, label, max = 200, required = false, multiline = false } = {}) {
  let s = value == null ? '' : String(value);
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    : s.replace(/[\x00-\x1F\x7F]/g, ' ');
  s = s.trim();
  if (required && !s) throw fail(field, `Vyplňte prosím pole „${label}“.`);
  if (s.length > max) throw fail(field, `Pole „${label}“ může mít nejvýše ${max} znaků.`);
  return s;
}

export function email(value, { field, label = 'E-mail', required = false } = {}) {
  const s = text(value, { field, label, max: 160, required });
  if (s && !EMAIL_RE.test(s)) throw fail(field, 'Zadejte prosím platnou e-mailovou adresu.');
  return s.toLowerCase();
}

export function phone(value, { field, label = 'Telefon', required = false } = {}) {
  const s = text(value, { field, label, max: 30, required });
  if (s && !/^\+?[\d\s()./-]{6,}$/.test(s)) throw fail(field, 'Zadejte prosím platné telefonní číslo.');
  if (s && s.replace(/\D/g, '').length < 6) throw fail(field, 'Telefonní číslo je příliš krátké.');
  return s;
}

export function integer(value, { field, label, min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw fail(field, `Pole „${label}“ musí být celé číslo v rozsahu ${min}–${max}.`);
  }
  return n;
}

export function oneOf(value, allowed, { field, label } = {}) {
  if (!allowed.includes(value)) throw fail(field, `Neplatná hodnota pole „${label}“.`);
  return value;
}

export function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

export function time(value, { field, label = 'Čas' } = {}) {
  if (typeof value !== 'string' || !TIME_RE.test(value)) throw fail(field, `Pole „${label}“ musí být čas ve formátu HH:MM.`);
  return value;
}

export function date(value, { field, label = 'Datum' } = {}) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw fail(field, `Pole „${label}“ musí být datum ve formátu RRRR-MM-DD.`);
  return value;
}

export function hexColor(value, { field, label = 'Barva' } = {}) {
  if (typeof value !== 'string' || !HEX_RE.test(value)) throw fail(field, `Pole „${label}“ musí být barva ve formátu #RRGGBB.`);
  return value.toLowerCase();
}

export function url(value, { field, label = 'Web' } = {}) {
  const s = text(value, { field, label, max: 300 });
  if (!s) return '';
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw fail(field, `Pole „${label}“ musí být platná adresa začínající https://`);
  }
}

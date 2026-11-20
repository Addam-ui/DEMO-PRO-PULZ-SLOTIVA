import { DateTime } from 'luxon';
import { db } from './db.js';
import { badRequest } from './errors.js';
import * as v from './validate.js';

/** Barvy událostí Google Kalendáře (colorId → barva), aby barvy v dashboardu a v kalendáři seděly. */
export const GOOGLE_COLORS = [
  { id: '9', name: 'Borůvková', hex: '#3f51b5' },
  { id: '7', name: 'Paví', hex: '#039be5' },
  { id: '2', name: 'Šalvějová', hex: '#33b679' },
  { id: '10', name: 'Bazalková', hex: '#0b8043' },
  { id: '5', name: 'Banánová', hex: '#f6bf26' },
  { id: '6', name: 'Mandarinková', hex: '#f4511e' },
  { id: '4', name: 'Plameňáková', hex: '#e67c73' },
  { id: '11', name: 'Rajčatová', hex: '#d50000' },
  { id: '3', name: 'Hroznová', hex: '#8e24aa' },
  { id: '1', name: 'Levandulová', hex: '#7986cb' },
  { id: '8', name: 'Grafitová', hex: '#616161' },
];
export const COLOR_IDS = GOOGLE_COLORS.map((c) => c.id);
export const SLOT_STEPS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
export const DEFAULT_BRAND = '#0a7c80';
/** Původní fialová výchozí barva – účty, které si ji nezměnily, dostanou novou výchozí. */
const LEGACY_DEFAULT_BRAND = '#5b47f5';
/** Původní výchozí děkovný text odkazoval na e-mail – teď je odkaz na zrušení přímo na obrazovce. */
const LEGACY_CONFIRMATION = 'Děkujeme za rezervaci, těšíme se na vás! Pokud nemůžete přijít, zrušte prosím termín pomocí odkazu v potvrzení.';

export function colorHex(colorId) {
  return (GOOGLE_COLORS.find((c) => c.id === String(colorId)) || GOOGLE_COLORS[0]).hex;
}

export function defaultSettings(user = {}) {
  const weekday = [{ from: '09:00', to: '17:00' }];
  return {
    business: {
      name: user.name || 'Moje rezervace',
      tagline: 'Vyberte si termín, který vám vyhovuje.',
      description: '',
      address: '',
      phone: '',
      email: user.email || '',
      website: '',
    },
    brandColor: DEFAULT_BRAND,
    timezone: 'Europe/Prague',
    workingHours: { 1: weekday, 2: weekday, 3: weekday, 4: weekday, 5: weekday, 6: [], 7: [] },
    slotStep: 30,
    bufferMin: 0,
    minNoticeHours: 2,
    maxAdvanceDays: 60,
    cancelLimitHours: 24,
    allDayEventsBlock: true,
    requirePhone: true,
    notifyEmail: user.email || '',
    confirmationMessage: 'Děkujeme za rezervaci a těšíme se na vás!',
    // Průvodce prvními kroky
    onboardingDismissed: false,
    settingsSaved: false,
    servicesEdited: false,
    linkShared: false,
  };
}

const cache = new Map();

function merge(defaults, stored) {
  return {
    ...defaults,
    ...stored,
    business: { ...defaults.business, ...(stored.business || {}) },
    workingHours: { ...defaults.workingHours, ...(stored.workingHours || {}) },
  };
}

export function getSettings(userId) {
  const id = Number(userId);
  if (cache.has(id)) return cache.get(id);
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(id) || {};
  const row = db.prepare('SELECT data FROM user_settings WHERE user_id = ?').get(id);
  const settings = merge(defaultSettings(user), row ? JSON.parse(row.data) : {});
  if (String(settings.brandColor).toLowerCase() === LEGACY_DEFAULT_BRAND) settings.brandColor = DEFAULT_BRAND;
  if (settings.confirmationMessage === LEGACY_CONFIRMATION) settings.confirmationMessage = defaultSettings(user).confirmationMessage;
  cache.set(id, settings);
  return settings;
}

function save(userId, settings) {
  db.prepare('INSERT INTO user_settings (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data')
    .run(Number(userId), JSON.stringify(settings));
  cache.set(Number(userId), settings);
  return settings;
}

export function initSettings(userId, user) {
  return save(userId, defaultSettings(user));
}

export function patchSettings(userId, patch) {
  return save(userId, { ...getSettings(userId), ...patch });
}

export function forgetSettings(userId) {
  cache.delete(Number(userId));
}

function validateWorkingHours(input) {
  const result = {};
  for (let day = 1; day <= 7; day++) {
    const intervals = Array.isArray(input?.[day]) ? input[day] : [];
    if (intervals.length > 6) throw badRequest('Jeden den může mít nejvýše 6 časových bloků.', { field: 'workingHours' });
    const clean = intervals
      .map((it) => ({
        from: v.time(it?.from, { field: 'workingHours', label: 'Otevírací doba od' }),
        to: v.time(it?.to, { field: 'workingHours', label: 'Otevírací doba do' }),
      }))
      .sort((a, b) => a.from.localeCompare(b.from));
    clean.forEach((it, i) => {
      if (it.from >= it.to) throw badRequest(`Otevírací doba: čas „od“ (${it.from}) musí být dřív než „do“ (${it.to}).`, { field: 'workingHours' });
      if (i > 0 && clean[i - 1].to > it.from) throw badRequest('Otevírací doba: časové bloky v jednom dni se nesmí překrývat.', { field: 'workingHours' });
    });
    result[day] = clean;
  }
  return result;
}

function validateSettings(input, current) {
  const b = input.business || {};
  const timezone = v.text(input.timezone ?? current.timezone, { field: 'timezone', label: 'Časové pásmo', required: true, max: 64 });
  if (!DateTime.now().setZone(timezone).isValid) throw badRequest('Neplatné časové pásmo.', { field: 'timezone' });

  return {
    business: {
      name: v.text(b.name, { field: 'business.name', label: 'Název', required: true, max: 80 }),
      tagline: v.text(b.tagline, { field: 'business.tagline', label: 'Podnadpis', max: 160 }),
      description: v.text(b.description, { field: 'business.description', label: 'Popis', max: 1000, multiline: true }),
      address: v.text(b.address, { field: 'business.address', label: 'Adresa', max: 200 }),
      phone: v.text(b.phone, { field: 'business.phone', label: 'Telefon', max: 40 }),
      email: v.email(b.email, { field: 'business.email' }),
      website: v.url(b.website, { field: 'business.website', label: 'Web' }),
    },
    brandColor: v.hexColor(input.brandColor, { field: 'brandColor', label: 'Hlavní barva' }),
    timezone,
    workingHours: validateWorkingHours(input.workingHours),
    slotStep: v.oneOf(Number(input.slotStep), SLOT_STEPS, { field: 'slotStep', label: 'Krok nabízených časů' }),
    bufferMin: v.integer(Number(input.bufferMin), { field: 'bufferMin', label: 'Pauza mezi termíny', min: 0, max: 240 }),
    minNoticeHours: v.integer(Number(input.minNoticeHours), { field: 'minNoticeHours', label: 'Minimální předstih', min: 0, max: 720 }),
    maxAdvanceDays: v.integer(Number(input.maxAdvanceDays), { field: 'maxAdvanceDays', label: 'Rezervace dopředu', min: 1, max: 365 }),
    cancelLimitHours: v.integer(Number(input.cancelLimitHours), { field: 'cancelLimitHours', label: 'Zrušení nejpozději', min: 0, max: 720 }),
    allDayEventsBlock: v.bool(input.allDayEventsBlock),
    requirePhone: v.bool(input.requirePhone),
    notifyEmail: v.email(input.notifyEmail, { field: 'notifyEmail', label: 'E-mail pro upozornění' }),
    confirmationMessage: v.text(input.confirmationMessage, { field: 'confirmationMessage', label: 'Text po rezervaci', max: 1000, multiline: true }),
    onboardingDismissed: typeof input.onboardingDismissed === 'boolean' ? input.onboardingDismissed : current.onboardingDismissed,
    settingsSaved: true,
    servicesEdited: current.servicesEdited,
    linkShared: current.linkShared,
  };
}

export function updateSettings(userId, input) {
  return save(userId, validateSettings(input || {}, getSettings(userId)));
}

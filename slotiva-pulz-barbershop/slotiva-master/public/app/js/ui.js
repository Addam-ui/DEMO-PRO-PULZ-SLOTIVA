/* Sdílené UI prvky dashboardu: elementy, ikony, formátování, modální okna, toasty. */

export const $ = (selector, root = document) => root.querySelector(selector);

/** Vytvoří element; textové potomky jsou vždy text (bezpečné vůči XSS). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    } else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value; // jen pro statické SVG ikony
    else if (key === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  overview: '<rect x="3" y="3" width="7.5" height="9" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.8"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.8"/><rect x="3" y="15" width="7.5" height="6" rx="1.8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  calendarCheck: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 15l2 2 4-4"/>',
  calendarMove: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 15.5h6M13 13.5l2 2-2 2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"/>',
  shield: '<path d="M12 3l7.5 3v5.4c0 4.5-3 8.2-7.5 9.6-4.5-1.4-7.5-5.1-7.5-9.6V6L12 3z"/><path d="M9 12l2 2 4-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  more: '<circle cx="12" cy="5" r="0.9"/><circle cx="12" cy="12" r="0.9"/><circle cx="12" cy="19" r="0.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  userX: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 8l4 4M21 8l-4 4"/>',
  phone: '<path d="M5.2 3h3.2l1.6 4.4-2.1 1.4a11 11 0 0 0 5.3 5.3l1.4-2.1 4.4 1.6v3.2a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3.2 5.2 2 2 0 0 1 5.2 3z"/>',
  mobile: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  tag: '<path d="M3 12.6V4.2A1.2 1.2 0 0 1 4.2 3h8.4L21 11.4 12.4 20z"/><circle cx="7.6" cy="7.6" r="1.4"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  cloudOff: '<path d="M3 3l18 18M8 7.5A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2.3 7.3M16 19H7a5 5 0 0 1-2.3-9.4"/>',
  shield: '<path d="M12 3l8 3.5v5c0 5-3.4 8.4-8 9.5-4.6-1.1-8-4.5-8-9.5v-5z"/><path d="M8.8 12l2.3 2.3 4.2-4.3"/>',
  unlink: '<path d="M3 3l18 18M9.5 14.5a4.5 4.5 0 0 1 0-6.4l1-1M14.5 9.5a4.5 4.5 0 0 1 0 6.4l-1 1"/>',
  calendarPlus: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M12 13v5M9.5 15.5h5"/>',
};

/** Adresa pro připojení Google Kalendáře (běžný odkaz – přesměruje na souhlas u Googlu). */
export const GOOGLE_CONNECT_URL = '/auth/google/start?intent=connect';

const GOOGLE_LOGO = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

export function googleMark() {
  return h('span', { class: 'google-mark', 'aria-hidden': 'true', html: GOOGLE_LOGO });
}

export function icon(name, size = 16) {
  return h('span', {
    class: 'ico',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`,
  });
}

/* ───────────── formátování ───────────── */

let TZ = 'Europe/Prague';
export function setTimezone(tz) {
  TZ = tz || TZ;
}

const numberFormatter = new Intl.NumberFormat('cs-CZ');
const utcDate = (date) => new Date(`${date}T12:00:00Z`);
const dtf = (options) => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC', ...options });

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const fmt = {
  number: (n) => numberFormatter.format(n),
  money: (n) => `${numberFormatter.format(n)} Kč`,
  price: (n) => (n > 0 ? `${numberFormatter.format(n)} Kč` : 'Zdarma'),
  duration(min) {
    if (min < 60) return `${min} min`;
    const hours = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  },
  /** „pondělí 14. září 2026“ */
  dateLong: (date) => dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(utcDate(date)),
  /** „pondělí 14. září“ */
  dateLongNoYear: (date) => dtf({ weekday: 'long', day: 'numeric', month: 'long' }).format(utcDate(date)),
  /** „po 14. 9.“ */
  dateMedium: (date) => dtf({ weekday: 'short', day: 'numeric', month: 'numeric' }).format(utcDate(date)),
  /** „14. 9.“ */
  dayMonth: (date) => dtf({ day: 'numeric', month: 'numeric' }).format(utcDate(date)),
  weekdayShort: (date) => dtf({ weekday: 'short' }).format(utcDate(date)),
  monthYear: (date) => dtf({ month: 'long', year: 'numeric' }).format(utcDate(date)),
  /** Čas z ISO v časovém pásmu firmy: „11. 9. 2026 16:30“ */
  datetime: (iso) => new Intl.DateTimeFormat('cs-CZ', {
    timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)),
  relativeDay(date, today) {
    if (date === today) return 'Dnes';
    if (date === addDays(today, 1)) return 'Zítra';
    if (date === addDays(today, -1)) return 'Včera';
    return fmt.dateMedium(date);
  },
};

export function plural(n, [one, few, many], withNumber = true) {
  const word = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return withNumber ? `${fmt.number(n)} ${word}` : word;
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Datum a čas z ISO řetězce v časovém pásmu firmy. */
export function localParts(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function readableInk(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#0b0b0b' : '#ffffff';
}

/* ───────────── stav rezervace ───────────── */

export function statusInfo(booking) {
  if (booking.status === 'cancelled') return { label: 'Zrušeno', cls: 'badge-critical', dot: 'critical' };
  if (booking.status === 'no_show') return { label: 'Nedostavil(a) se', cls: 'badge-warning', dot: 'warning' };
  if (Date.parse(booking.end) < Date.now()) return { label: 'Proběhlo', cls: '', dot: '' };
  return { label: 'Potvrzeno', cls: 'badge-good', dot: 'good' };
}

export function statusBadge(booking) {
  const s = statusInfo(booking);
  return h('span', { class: `badge ${s.cls}` }, h('span', { class: `dot ${s.dot}` }), s.label);
}

export const SOURCE_LABELS = { web: 'Web', admin: 'Dashboard', demo: 'Ukázková data' };
export const CANCELLED_BY = { customer: 'klientem', admin: 'v dashboardu', google: 'v Google Kalendáři' };

/* ───────────── drobné prvky ───────────── */

export function toast(message, { error = false, timeout = 3500 } = {}) {
  const el = h('div', { class: `toast${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' },
    icon(error ? 'alert' : 'check', 16), h('span', {}, message));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), timeout);
}

export async function copyText(text, message = 'Zkopírováno do schránky') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Kopírování se nepovedlo – označte text a zkopírujte ho ručně.', { error: true });
  }
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function field(label, control, { hint, wide = false, id } = {}) {
  if (id && control.setAttribute) control.id = id;
  return h('div', { class: `field${wide ? ' span-2' : ''}` },
    h('label', { for: id || null }, label),
    control,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

export function switchControl({ checked, onChange, label, ariaLabel, disabled = false }) {
  const input = h('input', { type: 'checkbox', checked, disabled, 'aria-label': ariaLabel || null, onChange: (e) => onChange?.(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), label ? h('span', {}, label) : null);
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, 20)),
    h('div', { class: 'empty-title' }, title),
    text ? h('div', {}, text) : null,
    action || null);
}

export function alertBox(type, title, text, actions) {
  const iconName = { info: 'info', warning: 'alert', critical: 'alert', good: 'check' }[type];
  return h('div', { class: `alert alert-${type}`, role: type === 'critical' ? 'alert' : null },
    icon(iconName, 18),
    h('div', { class: 'alert-body' }, title ? h('div', { class: 'alert-title' }, title) : null, text ? h('div', { class: 'alert-text' }, text) : null),
    actions ? h('div', { class: 'alert-actions' }, actions) : null);
}

/* Otevřená nabídka je vždy nejvýš jedna – zavře ji kliknutí kamkoliv, Escape i posun stránky. */
let closeOpenMenu = null;
const dismissMenu = () => {
  if (!closeOpenMenu) return;
  const close = closeOpenMenu;
  closeOpenMenu = null;
  close();
};
document.addEventListener('click', dismissMenu);
document.addEventListener('scroll', dismissMenu, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissMenu();
});

/**
 * Tlačítko „…“ s nabídkou akcí. Položky: { label, icon, danger, onClick }.
 * Nabídka je position: fixed, aby ji neořízl posuvník tabulky.
 */
export function actionMenu(items, { label = 'Další akce' } = {}) {
  const list = items.filter(Boolean);
  const menu = h('div', { class: 'action-menu', role: 'menu', hidden: true });
  const trigger = h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-icon btn-sm',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': label,
    title: label,
  }, icon('more', 16));

  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = !menu.hidden;
    dismissMenu();
    if (wasOpen) return;

    menu.replaceChildren(...list.map((item) => h('button', {
      type: 'button',
      role: 'menuitem',
      class: item.danger ? 'danger' : null,
      onClick: (event) => {
        event.stopPropagation();
        dismissMenu();
        item.onClick();
      },
    }, item.icon ? icon(item.icon, 15) : null, h('span', {}, item.label))));

    menu.hidden = false;
    const box = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    const below = box.bottom + 6;
    menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, box.top - menu.offsetHeight - 6) : below}px`;
    trigger.setAttribute('aria-expanded', 'true');
    closeOpenMenu = close;
  });

  return h('span', { class: 'action-menu-wrap', onClick: (e) => e.stopPropagation() }, trigger, menu);
}

/** Po dobu běhu async funkce zablokuje tlačítko a ukáže spinner. */
export async function withBusy(button, fn) {
  if (!button || button.disabled) return undefined;
  const original = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ...original.filter((n) => !n.classList?.contains('ico')));
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.replaceChildren(...original);
  }
}

/* ───────────── vrstvy: modální okna a panely ───────────── */

const layers = [];

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layers.length) {
    e.preventDefault();
    layers.at(-1).close();
  }
});

function pushLayer(el, { onClose } = {}) {
  const previousFocus = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  let closed = false;
  const entry = {
    close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      el.remove();
      layers.splice(layers.indexOf(entry), 1);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      onClose?.();
    },
  };
  overlay.addEventListener('click', entry.close);
  document.body.append(overlay, el);
  layers.push(entry);
  requestAnimationFrame(() => {
    const target = el.querySelector('[autofocus]') || el.querySelector('input:not([type=hidden]), select, textarea') || el.querySelector('button');
    target?.focus({ preventScroll: true });
  });
  return entry;
}

export function openModal({ title, size = '', onClose } = {}) {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const closeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Zavřít' }, icon('x'));
  const modal = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), closeBtn), body, foot);
  const wrap = h('div', { class: 'modal-wrap' }, modal);
  const entry = pushLayer(wrap, { onClose });
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) entry.close();
  });
  closeBtn.addEventListener('click', entry.close);
  return { body, foot, modal, close: entry.close };
}

export function openDrawer({ label = 'Detail', onClose } = {}) {
  const head = h('div', { class: 'drawer-head' });
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, head, body, foot);
  const entry = pushLayer(drawer, { onClose });
  return { head, body, foot, el: drawer, close: entry.close };
}

/** Potvrzovací dialog. Vrací null (zrušeno) nebo { checked } (potvrzeno). */
export function confirmDialog({ title, message, confirmLabel = 'Potvrdit', danger = false, checkbox = null }) {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({ title, size: 'modal-sm', onClose: () => resolve(result) });
    m.body.append(h('p', { class: 'secondary' }, message));
    let input = null;
    if (checkbox) {
      input = h('input', { type: 'checkbox', checked: Boolean(checkbox.checked) });
      m.body.append(h('label', { class: 'check' }, input, h('span', {}, checkbox.label)));
    }
    const confirm = h('button', {
      type: 'button',
      class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`,
      onClick: () => {
        result = { checked: input ? input.checked : false };
        m.close();
      },
    }, confirmLabel);
    m.foot.append(h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => m.close() }, 'Zpět'), confirm);
    requestAnimationFrame(() => confirm.focus());
  });
}

/* Sdílené pomocné funkce pro veřejné stránky (rezervace, správa rezervace). */

export const $ = (selector, root = document) => root.querySelector(selector);

/** Vytvoří element. Textové potomky vkládá jako text (bezpečné vůči XSS). */
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
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value; // jen pro statické ikony
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  tag: '<path d="M3 12.6V4.2A1.2 1.2 0 0 1 4.2 3h8.4L21 11.4 12.4 20z"/><circle cx="7.6" cy="7.6" r="1.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  mapPin: '<path d="M12 21s-7-6.1-7-11.4A7 7 0 0 1 19 9.6C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.6" r="2.5"/>',
  phone: '<path d="M5.2 3h3.2l1.6 4.4-2.1 1.4a11 11 0 0 0 5.3 5.3l1.4-2.1 4.4 1.6v3.2a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3.2 5.2 2 2 0 0 1 5.2 3z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};

export function icon(name, size = 18) {
  return h('span', {
    class: 'ico',
    'aria-hidden': 'true',
    style: { display: 'inline-flex' },
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`,
  });
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/public${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Něco se pokazilo. Zkuste to prosím znovu.'), { status: res.status, data });
  return data;
}

/** Nastaví barvu značky a k ní čitelnou barvu textu. */
export function applyBrand(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  const root = document.documentElement.style;
  root.setProperty('--brand', hex);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  root.setProperty('--brand-ink', luminance > 0.45 ? '#15151a' : '#ffffff');
}

const priceFormatter = new Intl.NumberFormat('cs-CZ');

export const fmt = {
  price: (n) => (n > 0 ? `${priceFormatter.format(n)} Kč` : 'Zdarma'),
  duration(min) {
    if (min < 60) return `${min} min`;
    const hours = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  },
  /** 'RRRR-MM-DD' → „pátek 11. září“ (bez posunu časového pásma) */
  dateLong(date, withYear = false) {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
    }).format(d);
  },
  dateShort(date) {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(d);
  },
  monthYear(year, month) {
    const d = new Date(Date.UTC(year, month - 1, 15));
    return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  },
};

/** Hlásí výšku stránky rodičovskému oknu (pro automatickou výšku iframe ve widgetu). */
export function reportHeightToParent() {
  if (window.parent === window) return;
  let last = 0;
  const send = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - last) > 1) {
      last = height;
      window.parent.postMessage({ type: 'slotiva:resize', height }, '*');
    }
  };
  new ResizeObserver(send).observe(document.body);
  window.addEventListener('load', send);
  send();
}

export function postToParent(message) {
  if (window.parent !== window) window.parent.postMessage(message, '*');
}

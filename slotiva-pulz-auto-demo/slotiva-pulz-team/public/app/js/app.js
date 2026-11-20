import { get, authPost } from './api.js';
import { $, h, icon, toast, setTimezone, copyText, openModal, GOOGLE_CONNECT_URL } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import * as overview from './views/overview.js';
import * as bookings from './views/bookings.js';
import * as calendar from './views/calendar.js';
import * as services from './views/services.js';
import * as settings from './views/settings.js';
import * as integration from './views/integration.js';
import * as admin from './views/admin.js';
import * as team from './views/team.js';

const ROUTES = [
  { path: 'prehled', title: 'Přehled', icon: 'overview', view: overview },
  { path: 'rezervace', title: 'Rezervace', icon: 'list', view: bookings },
  { path: 'kalendar', title: 'Kalendář', icon: 'calendar', view: calendar },
  { path: 'tym', title: 'Správa týmu', icon: 'user', view: team },
  { path: 'sluzby', title: 'Služby', icon: 'layers', view: services, group: 'Nastavení' },
  { path: 'nastaveni', title: 'Nastavení', icon: 'sliders', view: settings },
  { path: 'napojeni', title: 'Kalendář a web', icon: 'plug', view: integration },
  { path: 'sprava', title: 'Správa platformy', icon: 'shield', view: admin, group: 'Správce', adminOnly: true },
];

/** Trasy dostupné přihlášenému uživateli – správcovská sekce jen pro správce. */
const routes = () => ROUTES.filter((r) => !r.adminOnly || app.meta?.user?.isAdmin);

export const LOGO = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><defs><linearGradient id="lg-app" x1="6" y1="4" x2="44" y2="46" gradientUnits="userSpaceOnUse"><stop stop-color="#1ec8bf"/><stop offset="1" stop-color="#0a7c80"/></linearGradient></defs><rect width="48" height="48" rx="14" fill="url(#lg-app)"/><rect x="11" y="11.5" width="18" height="7" rx="3.5" fill="#fff" fill-opacity=".38"/><rect x="11" y="20.5" width="26" height="7" rx="3.5" fill="#fff"/><rect x="19" y="29.5" width="18" height="7" rx="3.5" fill="#fff" fill-opacity=".38"/></svg>';

const GOOGLE_RESULTS = {
  pripojeno: ['Google Kalendář je připojený. Rezervace se do něj budou zapisovat automaticky.', false],
  'bez-kalendare': ['Přihlášení proběhlo, ale nepovolili jste přístup ke kalendáři. Připojte ho prosím znovu a zaškrtněte oprávnění.', true],
  zamitnuto: ['Připojení Google Kalendáře bylo zrušeno.', true],
  'google-chyba': ['Připojení Google Kalendáře se nepovedlo. Zkuste to prosím znovu.', true],
  'neplatny-pozadavek': ['Platnost připojení vypršela. Zkuste to prosím znovu.', true],
  'ucet-pouzity': ['Tento účet Google už používá jiný uživatel Slotivy.', true],
  'bez-tokenu': ['Google nevrátil potřebná oprávnění. Zkuste to prosím znovu.', true],
};

/** Sdílený stav aplikace pro jednotlivé pohledy. */
export const app = {
  meta: null,
  counts: null,
  async refreshMeta() {
    try {
      const [meta, list] = await Promise.all([get('/meta'), get('/bookings?limit=1')]);
      app.meta = meta;
      app.counts = list.counts;
      setTimezone(meta.timezone);
      renderSidebar();
    } catch {
      /* obnoví se při další akci */
    }
  },
};

const root = $('#root');
let current = null;

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'S';

/* ───────────── motiv ───────────── */

const isDark = () => (document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches);

function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('rs-theme', next);
  } catch {
    /* nevadí */
  }
  renderSidebar();
}

async function logout() {
  await authPost('/logout').catch(() => {});
  location.href = '/prihlaseni';
}

/* ───────────── rozvržení ───────────── */

function userMenu() {
  const menu = h('div', { class: 'user-menu', role: 'menu', hidden: true },
    h('a', { href: '#/nastaveni', role: 'menuitem' }, icon('user', 16), 'Profil a účet'),
    h('a', { href: app.meta.bookingUrl, target: '_blank', rel: 'noopener', role: 'menuitem' }, icon('external', 16), 'Moje rezervační stránka'),
    h('button', { type: 'button', role: 'menuitem', onClick: toggleTheme }, icon(isDark() ? 'sun' : 'moon', 16), isDark() ? 'Světlý režim' : 'Tmavý režim'),
    h('div', { class: 'user-menu-sep' }),
    h('button', { type: 'button', role: 'menuitem', class: 'danger', onClick: logout }, icon('logout', 16), 'Odhlásit se'));
  const trigger = h('button', {
    type: 'button',
    class: 'user-chip',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onClick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    },
  },
  h('span', { class: 'avatar' }, initials(app.meta.user.name)),
  h('span', { class: 'user-chip-text' }, h('b', {}, app.meta.user.name), h('span', {}, app.meta.user.email)),
  icon('chevronUp', 14));
  document.addEventListener('click', () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });
  return h('div', { class: 'user' }, menu, trigger);
}

function googlePill() {
  const g = app.meta.google;
  let dot = 'neutral';
  let title = 'Google Kalendář';
  let sub = '';
  if (g.state === 'unavailable') [dot, sub] = ['neutral', 'Na serveru není zapnutý'];
  else if (g.state === 'disconnected') [dot, title, sub] = ['warning', 'Kalendář nepřipojen', 'Připojit jedním kliknutím'];
  else if (g.state === 'revoked' || g.state === 'noscope') [dot, title, sub] = ['critical', 'Kalendář odpojen', 'Připojte ho znovu'];
  else if (g.error) [dot, title, sub] = ['critical', 'Chyba synchronizace', 'Zobrazit podrobnosti'];
  else [dot, sub] = ['good', g.calendarName || g.email || 'Připojeno'];
  return h('a', { class: 'gstatus', href: '#/napojeni' },
    h('span', { class: `dot ${dot}` }),
    h('div', { style: { minWidth: '0' } }, h('div', { class: 'gstatus-title' }, title), h('div', { class: 'gstatus-sub' }, sub)));
}

function renderShell() {
  let lastGroup = null;
  const nav = h('nav', { class: 'nav', 'aria-label': 'Hlavní navigace' });
  for (const r of routes()) {
    if (r.group && r.group !== lastGroup) nav.append(h('div', { class: 'nav-label' }, r.group));
    lastGroup = r.group || lastGroup;
    nav.append(h('a', { href: `#/${r.path}`, 'data-path': r.path }, icon(r.icon, 18), h('span', {}, r.title), h('span', { class: 'count', hidden: true })));
  }

  root.replaceChildren(h('div', { class: 'app', id: 'app' },
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#/prehled', 'aria-label': 'Slotiva – přehled' },
        h('span', { class: 'brand-logo', html: LOGO }),
        h('span', { class: 'brand-word' }, 'Slotiva')),
      nav,
      h('div', { class: 'sidebar-foot', id: 'sidebar-foot' })),
    h('div', { class: 'content' },
      h('header', { class: 'topbar' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon menu-btn', 'aria-label': 'Menu', onClick: () => $('#app').classList.toggle('nav-open') }, icon('menu', 18)),
        h('div', { style: { minWidth: '0' } }, h('h1', { id: 'page-title' }), h('div', { class: 'subtitle', id: 'page-subtitle' })),
        h('div', { class: 'topbar-actions', id: 'page-actions' })),
      h('main', { class: 'view', id: 'view' }))));

  $('#app').addEventListener('click', (e) => {
    if (e.target === $('#app') || e.target.closest('.nav a')) $('#app').classList.remove('nav-open');
  });
  renderSidebar();
}

function renderSidebar() {
  const foot = $('#sidebar-foot');
  if (!app.meta || !foot) return;
  const url = app.meta.bookingUrl;
  foot.replaceChildren(
    h('div', { class: 'page-card' },
      h('div', { class: 'page-card-label' }, 'Vaše rezervační stránka'),
      h('a', { class: 'page-card-url', href: url, target: '_blank', rel: 'noopener', title: url }, url.replace(/^https?:\/\//, '')),
      h('div', { class: 'page-card-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onClick: () => copyText(url, 'Odkaz zkopírován') }, icon('copy', 14), 'Kopírovat'),
        h('a', { class: 'btn btn-sm btn-ghost btn-icon', href: url, target: '_blank', rel: 'noopener', 'aria-label': 'Otevřít stránku' }, icon('external', 15)))),
    googlePill(),
    userMenu(),
  );

  const counts = app.counts;
  const badge = document.querySelector('.nav a[data-path="rezervace"] .count');
  if (counts && badge) {
    const attention = counts.attention > 0;
    badge.hidden = !(attention || counts.upcoming);
    badge.textContent = attention ? `${counts.attention} !` : counts.upcoming;
    badge.classList.toggle('is-warning', attention);
  }
}

/* ───────────── uvítání a výsledky přihlášení Google ───────────── */

function handleQuery() {
  const params = new URLSearchParams(location.search);
  if (!params.size) return;
  const google = GOOGLE_RESULTS[params.get('google')];
  if (google) toast(google[0], { error: google[1], timeout: 6000 });
  if (params.get('vitejte')) showWelcome();
  history.replaceState(null, '', `/app/${location.hash}`);
}

function showWelcome() {
  const { user, google, bookingUrl } = app.meta;
  const m = openModal({ title: '', size: 'modal-welcome' });
  const needsCalendar = google.state === 'disconnected';
  const connected = google.state === 'connected';
  m.body.append(
    h('div', { class: 'welcome-logo', html: LOGO }),
    h('h2', { class: 'welcome-title' }, `Vítejte ve Slotivě, ${user.name.split(' ')[0]}!`),
    h('p', { class: 'welcome-text' }, connected
      ? 'Kalendář je připojený a rezervační stránka připravená. Zbývají dvě maličkosti.'
      : 'Vaše rezervační stránka je připravená. Stačí pár kroků a můžete přijímat první rezervace.'),
    h('div', { class: 'welcome-url' }, icon('link', 16), h('span', {}, bookingUrl.replace(/^https?:\/\//, ''))),
    h('ol', { class: 'welcome-steps' },
      h('li', { class: connected ? 'done' : '' },
        h('b', {}, connected ? 'Google Kalendář je připojený' : 'Připojte Google Kalendář'),
        h('span', {}, connected ? 'Rezervace se do něj budou zapisovat samy.' : 'Rezervace se do něj samy zapíšou a obsazené časy se klientům nenabídnou.')),
      h('li', {}, h('b', {}, 'Nastavte otevírací dobu a služby'), h('span', {}, 'Kdy pracujete, co nabízíte a za kolik.')),
      h('li', {}, h('b', {}, 'Sdílejte odkaz nebo vložte na web'), h('span', {}, 'Klienti si začnou rezervovat sami.'))),
  );
  m.foot.append(
    h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => m.close() }, needsCalendar ? 'Připojím později' : 'Rozhlédnout se'),
    needsCalendar
      ? h('a', { class: 'btn btn-primary', href: GOOGLE_CONNECT_URL }, icon('calendarCheck'), 'Připojit Google Kalendář')
      : h('a', { class: 'btn btn-primary', href: '#/nastaveni', onClick: () => m.close() }, 'Nastavit otevírací dobu'),
  );
}

/* ───────────── směrování ───────────── */

function parseHash() {
  const [path = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { route: routes().find((r) => r.path === path), params };
}

async function route() {
  const { route: r, params } = parseHash();
  if (!r) {
    location.replace('#/prehled');
    return;
  }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.path === r.path));

  if (current?.route === r) {
    current.instance?.update?.({ params });
    return;
  }

  current?.instance?.cleanup?.();
  const view = $('#view');
  const actions = $('#page-actions');
  view.replaceChildren();
  view.classList.remove('is-loading');
  actions.replaceChildren();
  $('#page-title').textContent = r.title;
  $('#page-subtitle').textContent = '';
  document.title = `${r.title} – Slotiva`;
  window.scrollTo(0, 0);

  const entry = { route: r, instance: null };
  current = entry;
  try {
    const instance = await r.view.mount({
      view,
      actions,
      params,
      app,
      setTitle: (t) => { $('#page-title').textContent = t; },
      setSubtitle: (t) => { $('#page-subtitle').textContent = t; },
    });
    if (current === entry) entry.instance = instance;
    else instance?.cleanup?.();
  } catch (err) {
    if (err.status === 401) return;
    console.error(err);
    view.replaceChildren(h('div', { class: 'alert alert-critical' }, icon('alert', 18),
      h('div', { class: 'alert-body' }, h('div', { class: 'alert-title' }, 'Stránku se nepodařilo načíst'), h('div', { class: 'alert-text' }, err.message))));
  }
}

window.addEventListener('auth:required', () => {
  location.href = '/prihlaseni';
});

(async () => {
  try {
    const [meta, list] = await Promise.all([get('/meta'), get('/bookings?limit=1')]);
    app.meta = meta;
    app.counts = list.counts;
    setTimezone(meta.timezone);
  } catch (err) {
    if (err.status === 401) return;
    // Na telefonu se stane, že vypadne signál – nabídneme rovnou další pokus.
    root.replaceChildren(h('div', { class: 'boot' },
      h('div', { class: 'stack', style: { gap: '14px', maxWidth: '380px' } },
        h('div', { class: 'alert alert-critical' }, icon('alert', 18),
          h('div', { class: 'alert-body' },
            h('div', { class: 'alert-title' }, 'Dashboard se nepodařilo načíst'),
            h('div', { class: 'alert-text' }, err.message))),
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => location.reload() }, icon('refresh'), 'Zkusit znovu'))));
    return;
  }
  renderShell();
  window.addEventListener('hashchange', route);
  await route();
  handleQuery();
  registerServiceWorker();
})();

import { adminGet, adminPost, adminDel, query } from '../api.js';
import {
  h, icon, fmt, plural, emptyState, debounce, alertBox, toast, copyText,
  openDrawer, confirmDialog, withBusy,
} from '../ui.js';
import { dailyBookingsChart } from '../charts.js';

const PAGE_SIZE = 50;
const USER_FORMS = ['uživatel', 'uživatelé', 'uživatelů'];

const FILTERS = [
  { key: 'all', label: 'Všichni' },
  { key: 'calendar', label: 'S kalendářem' },
  { key: 'nocalendar', label: 'Bez kalendáře' },
  { key: 'blocked', label: 'Zablokovaní' },
  { key: 'admins', label: 'Správci' },
];

const SORTS = [
  { value: 'new', label: 'Nejnovější' },
  { value: 'active', label: 'Naposledy přihlášení' },
  { value: 'bookings', label: 'Nejvíc rezervací' },
  { value: 'name', label: 'Podle jména' },
];

/** replaceChildren(null) vykreslí text „null“ – proto vždy filtrujeme. */
const paint = (target, ...nodes) => target.replaceChildren(...nodes.filter(Boolean));

const dt = (text) => h('dt', {}, text);
const dd = (...children) => h('dd', {}, ...children);
const section = (title, ...children) => h('section', { class: 'detail-section' }, h('h3', {}, title), ...children);

const dateTime = (iso) => (iso ? fmt.datetime(iso) : '—');

function calendarBadge(google) {
  if (google.connected) {
    return h('span', { class: 'badge badge-good', title: google.calendarName || google.email }, icon('check', 12), 'Připojen');
  }
  if (google.status) {
    return h('span', { class: 'badge badge-critical', title: google.lastError || 'Přístup ke kalendáři vypršel' }, icon('alert', 12), 'Odpojen');
  }
  return h('span', { class: 'muted' }, '—');
}

function stat(label, value, ...meta) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-meta' }, ...meta.filter(Boolean)));
}

/* ───────────── detail uživatele ───────────── */

function openUserDrawer(id, { onChange } = {}) {
  const drawer = openDrawer({ label: 'Detail uživatele' });
  let user = null;

  drawer.body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  drawer.head.append(h('button', {
    type: 'button', class: 'btn btn-ghost btn-icon btn-sm', style: { marginLeft: 'auto' }, 'aria-label': 'Zavřít', onClick: drawer.close,
  }, icon('x')));

  const load = () => adminGet(`/users/${id}`)
    .then((data) => {
      user = data.user;
      render();
    })
    .catch((err) => drawer.body.replaceChildren(alertBox('critical', 'Účet se nepodařilo načíst', err.message)));

  async function act(body, message) {
    const data = await adminPost(`/users/${id}`, body);
    user = data.user;
    render();
    onChange?.();
    if (message) toast(message);
  }

  async function passwordLink(button, send) {
    const data = await adminPost(`/users/${id}`, { action: 'password-link', send });
    if (data.sent) {
      toast(`Odkaz jsme poslali na ${data.email}.`);
      return;
    }
    await copyText(data.url, `Odkaz zkopírován – platí ${data.expiresHours} h. Pošlete ho uživateli.`);
  }

  async function remove() {
    const confirmed = await confirmDialog({
      title: 'Smazat účet?',
      message: `Účet ${user.email} se smaže i se všemi rezervacemi, službami a nastavením. Tohle nejde vrátit zpět.`,
      confirmLabel: 'Smazat účet',
      danger: true,
    });
    if (!confirmed) return;
    await adminDel(`/users/${id}`);
    toast('Účet byl smazán.');
    drawer.close();
    onChange?.();
  }

  function render() {
    drawer.head.replaceChildren(
      h('div', { style: { minWidth: '0' } },
        h('h2', { class: 'drawer-title' }, user.name),
        h('div', { class: 'drawer-sub' }, user.email)),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm', style: { marginLeft: 'auto' }, 'aria-label': 'Zavřít', onClick: drawer.close,
      }, icon('x')),
    );

    const note = h('textarea', {
      class: 'input', rows: '2', maxlength: '500', placeholder: 'Interní poznámka (vidíte jen vy)',
    });
    note.value = user.note || '';

    paint(drawer.body,
      user.blocked ? alertBox('warning', 'Účet je zablokovaný', 'Uživatel se nemůže přihlásit. Rezervační stránka zůstává funkční.') : null,
      user.isAdmin ? alertBox('info', 'Správcovský účet', 'Práva se řídí proměnnou ADMIN_EMAILS v nastavení serveru.') : null,
      section('Účet',
        h('dl', { class: 'dl' },
          dt('Rezervační stránka'), dd(h('a', { href: user.bookingUrl, target: '_blank', rel: 'noopener' }, `/${user.slug}`)),
          dt('Název pro klienty'), dd(user.business.name),
          dt('Registrace'), dd(dateTime(user.createdAt)),
          dt('Poslední přihlášení'), dd(dateTime(user.lastLoginAt)),
          dt('Přihlašování'), dd([user.hasPassword ? 'heslem' : null, user.viaGoogle ? 'přes Google' : null].filter(Boolean).join(' a ') || '—'),
          dt('Časové pásmo'), dd(user.timezone))),
      section('Čísla',
        h('div', { class: 'mini-stats' },
          h('div', {}, h('b', {}, fmt.number(user.bookings.total)), h('span', {}, 'rezervací celkem')),
          h('div', {}, h('b', {}, fmt.number(user.bookings.upcoming)), h('span', {}, 'nadcházejících')),
          h('div', {}, h('b', {}, fmt.number(user.bookings.last30)), h('span', {}, 'za 30 dní')),
          h('div', {}, h('b', {}, fmt.number(user.services)), h('span', {}, 'služeb')))),
      section('Google Kalendář',
        h('dl', { class: 'dl' },
          dt('Stav'), dd(calendarBadge(user.google)),
          user.google.email ? dt('Účet') : null, user.google.email ? dd(user.google.email) : null,
          user.google.calendarName ? dt('Kalendář') : null, user.google.calendarName ? dd(user.google.calendarName) : null,
          user.google.lastError ? dt('Chyba') : null, user.google.lastError ? dd(h('span', { class: 'danger-text' }, user.google.lastError)) : null)),
      user.recentBookings.length
        ? section('Poslední rezervace',
          h('ul', { class: 'plain-list' }, user.recentBookings.map((b) => h('li', {},
            h('span', {}, fmt.datetime(b.start)),
            h('span', { class: 'muted' }, ` · ${b.serviceName}${b.status === 'cancelled' ? ' (zrušeno)' : ''}`)))))
        : null,
      section('Poznámka',
        note,
        h('button', {
          type: 'button', class: 'btn btn-secondary btn-sm', style: { marginTop: '8px' },
          onClick: (e) => withBusy(e.currentTarget, () => act({ action: 'note', note: note.value }, 'Poznámka uložena')),
        }, 'Uložit poznámku')),
    );

    paint(drawer.foot,
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onClick: (e) => withBusy(e.currentTarget, () => passwordLink(e.currentTarget, false)),
      }, icon('link', 15), 'Odkaz na heslo'),
      user.isAdmin ? null : h('button', {
        type: 'button', class: `btn ${user.blocked ? 'btn-secondary' : 'btn-danger'}`,
        onClick: (e) => withBusy(e.currentTarget, () => act(
          { action: user.blocked ? 'unblock' : 'block' },
          user.blocked ? 'Účet odblokován' : 'Účet zablokován',
        )),
      }, icon(user.blocked ? 'undo' : 'userX', 15), user.blocked ? 'Odblokovat' : 'Zablokovat'),
      user.isAdmin ? null : h('button', {
        type: 'button', class: 'btn btn-danger-solid', style: { marginLeft: 'auto' },
        onClick: (e) => withBusy(e.currentTarget, remove),
      }, icon('trash', 15), 'Smazat'),
    );
  }

  load();
}

/* ───────────── přehled platformy ───────────── */

export async function mount({ view, actions, setSubtitle, app }) {
  if (!app.meta.user.isAdmin) {
    view.append(emptyState('alert', 'Sem nemáte přístup', 'Tato část je jen pro správce Slotivy.'));
    return;
  }

  const state = { q: '', filter: 'all', sort: 'new', offset: 0, users: null, series: 'bookings' };
  let overview = null;
  let requestId = 0;

  setSubtitle('Celá platforma z ptačí perspektivy');
  actions.append(h('button', {
    type: 'button', class: 'btn btn-secondary',
    onClick: (e) => withBusy(e.currentTarget, async () => {
      await Promise.all([loadOverview(), loadUsers()]);
      toast('Načteno znovu');
    }),
  }, icon('refresh'), h('span', { class: 'btn-label' }, 'Obnovit')));

  const statsRow = h('div', { class: 'kpis' });
  const alertRow = h('div', {});
  const chartCard = h('section', { class: 'card' });
  const usersCard = h('div', { class: 'card' });

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Hledat jméno, e-mail nebo adresu stránky…', 'aria-label': 'Hledat uživatele' });
  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Filtr uživatelů' });
  const sortSelect = h('select', { class: 'input', 'aria-label': 'Řazení', style: { width: 'auto' },
    onChange: (e) => {
      state.sort = e.target.value;
      state.offset = 0;
      loadUsers();
    } }, SORTS.map((s) => h('option', { value: s.value }, s.label)));

  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    state.offset = 0;
    loadUsers();
  }, 250));

  view.append(
    alertRow,
    statsRow,
    chartCard,
    h('div', { class: 'toolbar' }, tabs, h('div', { class: 'search grow' }, icon('search', 15), search), sortSelect),
    usersCard,
  );

  function renderTabs() {
    tabs.replaceChildren(...FILTERS.map((f) => h('button', {
      type: 'button',
      role: 'tab',
      class: state.filter === f.key ? 'is-active' : null,
      'aria-selected': String(state.filter === f.key),
      onClick: () => {
        state.filter = f.key;
        state.offset = 0;
        loadUsers();
      },
    }, f.label)));
  }

  function renderOverview() {
    const { users, bookings, problems, server } = overview.stats;
    statsRow.replaceChildren(
      stat('Uživatelé', fmt.number(users.total), users.new30 ? h('span', { class: 'delta up' }, icon('arrowUp', 12), `${fmt.number(users.new30)} za 30 dní`) : 'žádný nový za 30 dní'),
      stat('Aktivní za 30 dní', fmt.number(users.active30), users.total ? `z ${plural(users.total, USER_FORMS)}` : null),
      stat('S Google Kalendářem', fmt.number(users.withCalendar), users.total ? `${Math.round((users.withCalendar / users.total) * 100)} % uživatelů` : null),
      stat('Rezervace celkem', fmt.number(bookings.total), `${fmt.number(bookings.upcoming)} nadcházejících`),
    );

    const problemList = [];
    if (problems.calendarLost) problemList.push(`${plural(problems.calendarLost, ['uživateli', 'uživatelům', 'uživatelům'])} vypršel přístup ke Google Kalendáři`);
    if (problems.unsynced) problemList.push(`${plural(problems.unsynced, ['rezervace čeká', 'rezervace čekají', 'rezervací čeká'])} na zápis do kalendáře`);
    if (!server.googleEnabled) problemList.push('Google OAuth není na serveru nastavené (chybí GOOGLE_CLIENT_ID a GOOGLE_CLIENT_SECRET)');
    if (!server.adminEmails.length) problemList.push('ADMIN_EMAILS není nastavené – po restartu serveru přijdete o práva správce');

    alertRow.replaceChildren(problemList.length
      ? alertBox('warning', 'Vyžaduje pozornost', problemList.join(' · '))
      : alertBox('good', 'Vše běží, jak má', `${plural(users.total, USER_FORMS)}, ${fmt.number(bookings.new30)} rezervací za posledních 30 dní.`));

    const today = app.meta.today;
    const series = overview.trend.map((d) => ({ date: d.day, count: state.series === 'users' ? d.users : d.bookings, isToday: d.day === today }));
    const totalInSeries = series.reduce((sum, d) => sum + d.count, 0);

    const toggle = h('div', { class: 'segmented segmented-sm', role: 'tablist', 'aria-label': 'Co zobrazit v grafu' },
      [['bookings', 'Rezervace'], ['users', 'Nové účty']].map(([key, label]) => h('button', {
        type: 'button',
        role: 'tab',
        class: state.series === key ? 'is-active' : null,
        'aria-selected': String(state.series === key),
        onClick: () => {
          state.series = key;
          renderOverview();
        },
      }, label)));

    chartCard.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', { class: 'card-title' }, state.series === 'users' ? 'Nové účty' : 'Rezervace na platformě'),
          h('div', { class: 'card-sub' }, `Posledních 30 dní · celkem ${fmt.number(totalInSeries)}`)),
        toggle),
      totalInSeries
        ? dailyBookingsChart(series)
        : h('div', { class: 'card-body' }, emptyState('overview', 'Zatím není co kreslit', 'Graf se objeví, jakmile přibudou první data.')),
    );
  }

  function renderUsers() {
    const { items, total } = state.users;
    if (!items.length) {
      const filtered = state.q || state.filter !== 'all';
      usersCard.replaceChildren(emptyState(
        filtered ? 'search' : 'user',
        filtered ? 'Nikoho jsme nenašli' : 'Zatím tu není žádný účet',
        filtered ? 'Zkuste jiné hledání nebo filtr.' : 'Jakmile se někdo zaregistruje, objeví se tady.',
      ));
      return;
    }

    const rows = items.map((u) => h('tr', {
      tabindex: '0',
      class: u.blocked ? 'is-cancelled' : null,
      onClick: () => openUserDrawer(u.id, { onChange: () => { loadUsers(); loadOverview(); } }),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openUserDrawer(u.id, { onChange: () => { loadUsers(); loadOverview(); } });
        }
      },
    },
    h('td', {},
      h('div', { class: 'cell-main' }, u.name, u.isAdmin ? h('span', { class: 'badge badge-brand', style: { marginLeft: '8px' } }, 'správce') : null),
      h('div', { class: 'cell-sub' }, u.email)),
    h('td', { class: 'hide-sm' }, h('span', { class: 'mono' }, `/${u.slug}`)),
    h('td', { class: 'num' },
      h('div', { class: 'cell-main' }, fmt.number(u.bookings.total)),
      h('div', { class: 'cell-sub' }, `${fmt.number(u.bookings.upcoming)} příštích`)),
    h('td', {}, calendarBadge(u.google)),
    h('td', { class: 'hide-sm' },
      h('div', { class: 'cell-main' }, u.lastLoginAt ? fmt.dateMedium(u.lastLoginAt.slice(0, 10)) : '—'),
      h('div', { class: 'cell-sub' }, `reg. ${fmt.dateMedium(u.createdAt.slice(0, 10))}`)),
    h('td', {}, u.blocked ? h('span', { class: 'badge badge-critical' }, 'zablokován') : h('span', { class: 'muted' }, '—'))));

    const end = Math.min(state.offset + PAGE_SIZE, total);
    paint(usersCard,
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Uživatel'),
            h('th', { scope: 'col', class: 'hide-sm' }, 'Stránka'),
            h('th', { scope: 'col', class: 'num' }, 'Rezervace'),
            h('th', { scope: 'col' }, 'Kalendář'),
            h('th', { scope: 'col', class: 'hide-sm' }, 'Přihlášení'),
            h('th', { scope: 'col' }, 'Stav'))),
          h('tbody', {}, rows))),
      h('div', { class: 'pager' },
        h('span', {}, total > PAGE_SIZE ? `${state.offset + 1}–${end} z ${fmt.number(total)}` : plural(total, USER_FORMS)),
        total > PAGE_SIZE
          ? h('div', { class: 'input-group' },
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: state.offset === 0, onClick: () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); loadUsers(); } }, icon('chevronLeft', 14), 'Předchozí'),
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: end >= total, onClick: () => { state.offset += PAGE_SIZE; loadUsers(); } }, 'Další', icon('chevronRight', 14)))
          : null),
    );
  }

  async function loadOverview() {
    overview = await adminGet('/overview');
    renderOverview();
  }

  async function loadUsers() {
    const id = ++requestId;
    renderTabs();
    if (state.users) usersCard.style.opacity = '0.55';
    try {
      const data = await adminGet(`/users${query({ q: state.q, filter: state.filter, sort: state.sort, limit: PAGE_SIZE, offset: state.offset })}`);
      if (id !== requestId) return;
      state.users = data;
      renderUsers();
    } catch (err) {
      if (id === requestId) usersCard.replaceChildren(h('div', { class: 'card-body' }, alertBox('critical', 'Uživatele se nepodařilo načíst', err.message)));
    } finally {
      if (id === requestId) usersCard.style.opacity = '';
    }
  }

  sortSelect.value = state.sort;
  await Promise.all([loadOverview(), loadUsers()]);
}

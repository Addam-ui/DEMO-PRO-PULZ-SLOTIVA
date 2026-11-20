import { get, query } from '../api.js';
import { h, icon, fmt, plural, capitalize, statusBadge, emptyState, debounce, alertBox, actionMenu, toast } from '../ui.js';
import { cancelBooking, setBookingStatus, isPast } from './booking-actions.js';
import { openBookingDrawer } from './booking-drawer.js';
import { openNewBookingModal } from './new-booking.js';

const PAGE_SIZE = 50;
const BOOKING_FORMS = ['rezervace', 'rezervace', 'rezervací'];

const SCOPES = [
  { key: 'upcoming', label: 'Nadcházející' },
  { key: 'past', label: 'Proběhlé' },
  { key: 'cancelled', label: 'Zrušené' },
  { key: 'attention', label: 'K vyřešení', onlyWhenNeeded: true },
  { key: 'all', label: 'Vše' },
];

const EMPTY = {
  upcoming: ['Žádné nadcházející rezervace', 'Nové rezervace z webu se tu objeví automaticky.'],
  past: ['Zatím žádné proběhlé rezervace', 'Tady uvidíte historii všech termínů.'],
  cancelled: ['Žádné zrušené rezervace', 'Skvělé – nikdo nic nerušil.'],
  attention: ['Vše je propsané', 'Žádná rezervace nečeká na zápis do Google Kalendáře.'],
  all: ['Zatím žádné rezervace', 'Pošlete lidem odkaz na rezervační stránku nebo ji vložte na web.'],
};

export async function mount({ view, actions, params, app }) {
  const state = { scope: params[0] === 'k-vyreseni' ? 'attention' : 'upcoming', q: '', from: '', to: '', offset: 0, data: null };
  let requestId = 0;

  const exportLink = h('a', { class: 'btn btn-secondary', download: '' }, icon('download'), h('span', { class: 'btn-label' }, 'Export CSV'));
  actions.append(
    exportLink,
    h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openNewBookingModal({ app, onCreated: load }) }, icon('plus'), h('span', { class: 'btn-label' }, 'Nová rezervace')),
  );

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Filtr rezervací' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Hledat jméno, e-mail, telefon nebo kód…', 'aria-label': 'Hledat rezervace' });
  const from = h('input', { class: 'input', type: 'date', 'aria-label': 'Od data', title: 'Od data', style: { width: '150px' } });
  const to = h('input', { class: 'input', type: 'date', 'aria-label': 'Do data', title: 'Do data', style: { width: '150px' } });
  const clear = h('button', {
    type: 'button',
    class: 'btn btn-ghost',
    hidden: true,
    onClick: () => {
      search.value = '';
      from.value = '';
      to.value = '';
      Object.assign(state, { q: '', from: '', to: '', offset: 0 });
      load();
    },
  }, icon('x'), 'Zrušit filtry');
  const card = h('div', { class: 'card' });

  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    state.offset = 0;
    load();
  }, 250));
  from.addEventListener('change', () => { state.from = from.value; state.offset = 0; load(); });
  to.addEventListener('change', () => { state.to = to.value; state.offset = 0; load(); });

  view.append(
    h('div', { class: 'toolbar' },
      tabs,
      h('div', { class: 'search grow' }, icon('search', 15), search),
      h('div', { class: 'input-group' }, from, h('span', { class: 'muted' }, '–'), to),
      clear),
    card,
  );

  const filtered = () => Boolean(state.q || state.from || state.to);
  const filterQuery = (extra = {}) => query({ scope: state.scope, q: state.q, from: state.from, to: state.to, ...extra });

  function renderTabs() {
    const counts = state.data?.counts || app.counts || {};
    tabs.replaceChildren(...SCOPES
      .filter((s) => !s.onlyWhenNeeded || counts[s.key] > 0 || state.scope === s.key)
      .map((s) => h('button', {
        type: 'button',
        role: 'tab',
        class: state.scope === s.key ? 'is-active' : null,
        'aria-selected': String(state.scope === s.key),
        onClick: () => {
          state.scope = s.key;
          state.offset = 0;
          load();
        },
      }, s.label, s.key !== 'all' && counts[s.key] != null ? h('span', { class: 'count' }, fmt.number(counts[s.key])) : null)));
  }

  function googleCell(b) {
    if (app.meta.google.state !== 'connected' && !b.google.eventId) return h('span', { class: 'muted', title: 'Google Kalendář není připojený' }, '—');
    if (b.google.pending) return h('span', { class: 'badge badge-warning', title: b.google.error || 'Čeká na zápis do Google Kalendáře' }, icon('alert', 12), h('span', { class: 'sr-only' }, 'Čeká na zápis'));
    if (b.google.eventId && b.status !== 'cancelled') return h('span', { title: 'Propsáno do Google Kalendáře', style: { color: 'var(--good-text)', display: 'inline-flex' } }, icon('check', 15), h('span', { class: 'sr-only' }, 'Propsáno'));
    return h('span', { class: 'muted' }, '—');
  }

  function rowMenu(b) {
    const googleActive = app.meta.google.state === 'connected';
    const mailEnabled = Boolean(app.meta.mailEnabled);
    const run = async (fn) => {
      try {
        await fn();
        await load();
        app.refreshMeta?.();
      } catch (err) {
        toast(err.message, { error: true });
      }
    };

    const items = [
      { label: 'Otevřít detail', icon: 'external', onClick: () => openBooking(b.id) },
    ];
    if (b.status === 'confirmed' && !isPast(b)) {
      items.push({ label: 'Přesunout termín', icon: 'calendarMove', onClick: () => openBooking(b.id) });
    }
    if (b.status === 'confirmed' && isPast(b)) {
      items.push({
        label: 'Nedostavil(a) se',
        icon: 'userX',
        onClick: () => run(() => setBookingStatus(b, 'no_show', 'Označeno: nedostavil(a) se')),
      });
    }
    if (b.status === 'no_show') {
      items.push({
        label: 'Vrátit na „proběhlo“',
        icon: 'undo',
        onClick: () => run(() => setBookingStatus(b, 'confirmed', 'Stav vrácen')),
      });
    }
    if (b.status === 'cancelled') {
      items.push({
        label: 'Obnovit rezervaci',
        icon: 'undo',
        onClick: () => run(() => setBookingStatus(b, 'confirmed', 'Rezervace obnovena')),
      });
    } else {
      items.push({
        label: 'Zrušit rezervaci',
        icon: 'x',
        danger: true,
        onClick: () => run(() => cancelBooking(b, { mailEnabled, googleActive })),
      });
    }
    return actionMenu(items, { label: `Akce pro rezervaci ${b.customer.name}` });
  }

  function openBooking(id) {
    history.replaceState(null, '', `#/rezervace/${id}`);
    openBookingDrawer(id, {
      app,
      onChange: load,
      onClose: () => {
        if (/^#\/rezervace\/\d+/.test(location.hash)) history.replaceState(null, '', '#/rezervace');
      },
    });
  }

  function renderTable() {
    const { items, total } = state.data;
    if (!items.length) {
      const [title, text] = filtered() ? ['Nic jsme nenašli', 'Zkuste upravit hledání nebo rozsah dat.'] : EMPTY[state.scope];
      card.replaceChildren(emptyState(filtered() ? 'search' : 'calendar', title, text));
      return;
    }

    const thisYear = app.meta.today.slice(0, 4);
    const rows = items.map((b) => h('tr', {
      class: b.status === 'cancelled' ? 'is-cancelled' : null,
      tabindex: '0',
      onClick: () => openBooking(b.id),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBooking(b.id);
        }
      },
    },
    h('td', {},
      h('div', { class: 'cell-main nowrap' }, `${capitalize(fmt.dateMedium(b.date))}${b.date.slice(0, 4) !== thisYear ? ` ${b.date.slice(0, 4)}` : ''}`),
      h('div', { class: 'cell-sub num' }, `${b.time}–${b.endTime}`)),
    h('td', {},
      h('div', { class: 'cell-main' }, b.customer.name),
      h('div', { class: 'cell-sub' }, b.customer.phone || b.customer.email || '—')),
    h('td', { class: 'hide-sm' },
      h('div', { class: 'svc' }, h('span', { class: 'swatch', style: { background: b.color } }), h('span', {}, b.serviceName)),
      h('div', { class: 'cell-sub' }, fmt.duration(b.durationMin))),
    h('td', { class: 'num hide-sm' }, fmt.price(b.price)),
    h('td', {}, statusBadge(b)),
    h('td', { class: 'hide-sm', style: { width: '48px', textAlign: 'center' } }, googleCell(b)),
    h('td', { class: 'actions' }, rowMenu(b))));

    const end = Math.min(state.offset + PAGE_SIZE, total);
    card.replaceChildren(
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Termín'),
            h('th', { scope: 'col' }, 'Klient'),
            h('th', { scope: 'col', class: 'hide-sm' }, 'Služba'),
            h('th', { scope: 'col', class: 'num hide-sm' }, 'Cena'),
            h('th', { scope: 'col' }, 'Stav'),
            h('th', { scope: 'col', class: 'hide-sm', style: { textAlign: 'center' }, title: 'Google Kalendář' }, 'Google'),
            h('th', { scope: 'col', class: 'actions' }, h('span', { class: 'sr-only' }, 'Akce')))),
          h('tbody', {}, rows))),
      h('div', { class: 'pager' },
        h('span', {}, total > PAGE_SIZE ? `${state.offset + 1}–${end} z ${fmt.number(total)}` : plural(total, BOOKING_FORMS)),
        total > PAGE_SIZE
          ? h('div', { class: 'input-group' },
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: state.offset === 0, onClick: () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); load(); } }, icon('chevronLeft', 14), 'Předchozí'),
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: end >= total, onClick: () => { state.offset += PAGE_SIZE; load(); } }, 'Další', icon('chevronRight', 14)))
          : null),
    );
  }

  async function load() {
    const id = ++requestId;
    exportLink.href = `/api/app/bookings.csv${filterQuery()}`;
    clear.hidden = !filtered();
    renderTabs();
    if (state.data) card.style.opacity = '0.55';
    try {
      const data = await get(`/bookings${filterQuery({ limit: PAGE_SIZE, offset: state.offset })}`);
      if (id !== requestId) return;
      state.data = data;
      renderTabs();
      renderTable();
    } catch (err) {
      if (id === requestId) card.replaceChildren(h('div', { class: 'card-body' }, alertBox('critical', 'Rezervace se nepodařilo načíst', err.message)));
    } finally {
      if (id === requestId) card.style.opacity = '';
    }
  }

  await load();
  if (/^\d+$/.test(params[0] || '')) openBooking(Number(params[0]));

  return {
    update({ params: next }) {
      if (/^\d+$/.test(next[0] || '')) openBooking(Number(next[0]));
      else if (next[0] === 'k-vyreseni' && state.scope !== 'attention') {
        state.scope = 'attention';
        state.offset = 0;
        load();
      }
    },
  };
}

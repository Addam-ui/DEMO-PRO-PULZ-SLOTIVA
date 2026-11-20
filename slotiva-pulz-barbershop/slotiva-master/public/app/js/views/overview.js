import { get, post } from '../api.js';
import { h, icon, fmt, plural, capitalize, alertBox, emptyState, copyText, GOOGLE_CONNECT_URL } from '../ui.js';
import { dailyBookingsChart, serviceBarsChart, dataTable } from '../charts.js';
import { openBookingDrawer } from './booking-drawer.js';
import { openNewBookingModal } from './new-booking.js';

const hours = (min) => `${fmt.number(Math.round((min / 60) * 10) / 10)} h`;

function delta(current, previous, formatter = fmt.number) {
  if (!current && !previous) return null;
  const diff = current - previous;
  if (diff === 0) return h('span', { class: 'delta flat' }, 'beze změny');
  const up = diff > 0;
  return h('span', { class: `delta ${up ? 'up' : 'down'}` }, icon(up ? 'arrowUp' : 'arrowDown', 12), formatter(Math.abs(diff)));
}

function stat(label, value, ...meta) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-meta' }, ...meta));
}

function cardHead(title, sub, action) {
  return h('div', { class: 'card-head' },
    h('div', {}, h('h2', { class: 'card-title' }, title), sub ? h('div', { class: 'card-sub' }, sub) : null),
    action || null);
}

export async function mount({ view, actions, setTitle, setSubtitle, app }) {
  const firstName = app.meta.user.name.split(' ')[0];
  const hour = new Date().getHours();
  setTitle(`${hour < 10 ? 'Dobré ráno' : hour >= 18 ? 'Dobrý večer' : 'Dobrý den'}, ${firstName}`);
  setSubtitle(capitalize(fmt.dateLong(app.meta.today)));
  actions.append(
    h('a', { class: 'btn btn-secondary', href: app.meta.bookingUrl, target: '_blank', rel: 'noopener' }, icon('external'), h('span', { class: 'btn-label' }, 'Moje stránka')),
    h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openNewBookingModal({ app, onCreated: load }) }, icon('plus'), h('span', { class: 'btn-label' }, 'Nová rezervace')),
  );

  let tableMode = false;
  let loaded = false;
  const openBooking = (id) => openBookingDrawer(id, { app, onChange: load });

  function onboardingCard(onboarding, google) {
    const s = onboarding.steps;
    if (onboarding.dismissed) return null;
    const steps = [
      {
        done: s.calendar,
        title: 'Připojte Google Kalendář',
        text: s.calendarAvailable
          ? 'Rezervace se budou samy zapisovat a obsazené časy se klientům nenabídnou.'
          : 'Na tomto serveru zatím není zapnuté přihlášení přes Google (viz README).',
        action: s.calendarAvailable && !s.calendar
          ? h('a', { class: 'btn btn-primary btn-sm', href: GOOGLE_CONNECT_URL }, icon('calendarCheck', 14), google.state === 'disconnected' ? 'Připojit' : 'Připojit znovu')
          : null,
      },
      { done: s.profile, title: 'Nastavte otevírací dobu a údaje', text: 'Kdy pracujete, kde vás klienti najdou a jak dlouho dopředu se mohou objednat.', action: s.profile ? null : h('a', { class: 'btn btn-secondary btn-sm', href: '#/nastaveni' }, 'Nastavit') },
      { done: s.services, title: 'Upravte své služby', text: 'Připravili jsme ukázkové služby – přejmenujte je a doplňte délku a cenu.', action: s.services ? null : h('a', { class: 'btn btn-secondary btn-sm', href: '#/sluzby' }, 'Upravit služby') },
      {
        done: s.share,
        title: 'Sdílejte svou rezervační stránku',
        text: 'Pošlete odkaz klientům, dejte ho na sociální sítě nebo vložte rezervace na svůj web.',
        action: s.share ? null : h('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: async () => {
            await copyText(app.meta.bookingUrl, 'Odkaz zkopírován – pošlete ho klientům');
            await post('/onboarding', { linkShared: true }).catch(() => {});
            load();
          },
        }, icon('copy', 14), 'Kopírovat odkaz'),
      },
    ];
    const doneCount = steps.filter((st) => st.done).length;
    if (doneCount === steps.length) return null;

    return h('section', { class: 'card onboarding' },
      h('div', { class: 'onboarding-head' },
        h('div', {},
          h('h2', { class: 'card-title' }, 'Začínáme se Slotivou'),
          h('div', { class: 'card-sub' }, `${doneCount} ze ${steps.length} kroků hotovo`)),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          onClick: async () => {
            await post('/onboarding', { dismissed: true }).catch(() => {});
            load();
          },
        }, 'Skrýt')),
      h('div', { class: 'meter onboarding-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(doneCount) },
        h('span', { style: { width: `${(doneCount / steps.length) * 100}%` } })),
      h('ol', { class: 'onboarding-steps' }, steps.map((st) => h('li', { class: st.done ? 'is-done' : '' },
        h('span', { class: 'step-check', 'aria-hidden': 'true' }, st.done ? icon('check', 14) : null),
        h('div', { class: 'step-text' }, h('b', {}, st.title), h('span', {}, st.text)),
        st.action))));
  }

  function alerts(stats, google, onboarding) {
    const list = [];
    if (google.state === 'revoked' || google.state === 'noscope') {
      list.push(alertBox('critical', 'Google Kalendář je potřeba připojit znovu', google.error || 'Přístup ke kalendáři vypršel nebo byl zrušen.',
        h('a', { class: 'btn btn-secondary btn-sm', href: GOOGLE_CONNECT_URL }, 'Připojit znovu')));
    } else if (google.state === 'connected' && google.error) {
      list.push(alertBox('critical', 'Synchronizace s Google Kalendářem hlásí chybu', google.error,
        h('a', { class: 'btn btn-secondary btn-sm', href: '#/napojeni' }, 'Podrobnosti')));
    } else if (google.state === 'disconnected' && onboarding.dismissed) {
      list.push(alertBox('info', 'Google Kalendář není připojený', 'Rezervace se zatím nezapisují do kalendáře a obsazenost se počítá jen z rezervací ve Slotivě.',
        h('a', { class: 'btn btn-secondary btn-sm', href: GOOGLE_CONNECT_URL }, 'Připojit')));
    }
    if (stats.attention && google.state === 'connected') {
      list.push(alertBox('warning',
        `${plural(stats.attention, ['rezervace čeká', 'rezervace čekají', 'rezervací čeká'])} na zápis do Google Kalendáře`,
        'Slotiva to automaticky zkouší znovu každých 5 minut.',
        h('a', { class: 'btn btn-secondary btn-sm', href: '#/rezervace/k-vyreseni' }, 'Zobrazit')));
    }
    return list.length ? h('div', { class: 'stack' }, list) : null;
  }

  function kpis(stats) {
    const { today, week, revenue, occupancy } = stats;
    const ratio = Math.round(occupancy.ratio * 100);
    return h('div', { class: 'kpis' },
      stat('Dnes', fmt.number(today.count),
        today.next
          ? h('button', { type: 'button', class: 'link-btn', onClick: () => openBooking(today.next.id) }, `Další v ${today.next.time} · ${today.next.customer.name}`)
          : today.count ? 'Pro dnešek hotovo' : 'Žádné rezervace'),
      stat('Tento týden', fmt.number(week.count), delta(week.count, week.previous), h('span', {}, 'oproti minulému týdnu')),
      stat(`Tržby · ${revenue.monthLabel}`, fmt.money(revenue.month), delta(revenue.month, revenue.previousMonth, fmt.money), h('span', {}, 'oproti minulému měsíci')),
      h('div', { class: 'card stat' },
        h('div', { class: 'stat-label' }, 'Vytíženost tohoto týdne'),
        h('div', { class: 'stat-value' }, `${ratio} %`),
        h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(ratio), 'aria-label': 'Vytíženost' },
          h('span', { style: { width: `${ratio}%` } })),
        h('div', { class: 'stat-meta' }, occupancy.openMinutes ? `${hours(occupancy.bookedMinutes)} z ${hours(occupancy.openMinutes)} otevírací doby` : 'Nastavte otevírací dobu')));
  }

  function chartCard(stats) {
    const total = stats.series.reduce((sum, d) => sum + d.count, 0);
    const body = h('div', { class: 'card-body' });
    const chartBtn = h('button', { type: 'button' }, 'Graf');
    const tableBtn = h('button', { type: 'button' }, 'Tabulka');
    const paint = () => {
      chartBtn.classList.toggle('is-active', !tableMode);
      tableBtn.classList.toggle('is-active', tableMode);
      chartBtn.setAttribute('aria-pressed', String(!tableMode));
      tableBtn.setAttribute('aria-pressed', String(tableMode));
      if (tableMode) {
        body.replaceChildren(dataTable([
          { key: 'date', label: 'Den', format: (d, row) => `${capitalize(fmt.dateMedium(d))}${row.isToday ? ' (dnes)' : ''}` },
          { key: 'count', label: 'Rezervace', num: true },
          { key: 'revenue', label: 'Tržby', num: true, format: fmt.money },
        ], stats.series));
      } else if (!total) {
        body.replaceChildren(emptyState('calendar', 'Zatím žádné rezervace', 'Jakmile si klienti začnou rezervovat, uvidíte tu jejich počty po dnech.'));
      } else {
        body.replaceChildren(dailyBookingsChart(stats.series));
      }
    };
    chartBtn.addEventListener('click', () => { tableMode = false; paint(); });
    tableBtn.addEventListener('click', () => { tableMode = true; paint(); });
    paint();
    return h('section', { class: 'card' },
      cardHead('Rezervace po dnech', `Posledních 20 dní a následujících 14 dní · celkem ${plural(total, ['rezervace', 'rezervace', 'rezervací'])}`,
        h('div', { class: 'segmented table-toggle' }, chartBtn, tableBtn)),
      body);
  }

  function upcomingCard(stats) {
    const items = stats.upcoming;
    return h('section', { class: 'card' },
      cardHead('Nejbližší rezervace', null, h('a', { class: 'btn btn-ghost btn-sm', href: '#/rezervace' }, 'Všechny', icon('chevronRight', 14))),
      items.length
        ? h('div', { class: 'list', style: { margin: '10px 0 6px' } }, items.map((b) => h('button', { type: 'button', class: 'list-item', onClick: () => openBooking(b.id) },
          h('div', { class: 'when' }, h('b', {}, b.time), h('span', {}, fmt.relativeDay(b.date, app.meta.today))),
          h('div', { class: 'who' },
            h('b', {}, b.customer.name),
            h('span', {}, h('i', { class: 'swatch', style: { background: b.color } }), `${b.serviceName} · ${fmt.duration(b.durationMin)}`)),
          h('span', { class: 'secondary num' }, fmt.price(b.price)))))
        : h('div', { class: 'card-body' }, emptyState('calendarCheck', 'Žádné nadcházející rezervace', 'Pošlete klientům odkaz na svou rezervační stránku.',
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => copyText(app.meta.bookingUrl, 'Odkaz zkopírován') }, icon('copy', 14), 'Kopírovat odkaz'))));
  }

  function servicesCard(stats) {
    return h('section', { class: 'card' },
      cardHead('Oblíbené služby', 'Rezervace za posledních 90 dní včetně nadcházejících'),
      h('div', { class: 'card-body' },
        stats.services.length ? serviceBarsChart(stats.services) : emptyState('layers', 'Zatím bez dat', 'Statistika se ukáže po prvních rezervacích.')));
  }

  async function load() {
    if (loaded) view.classList.add('is-loading');
    try {
      const { stats, google, onboarding } = await get('/overview');
      view.replaceChildren(h('div', { class: 'stack' },
        onboardingCard(onboarding, google),
        alerts(stats, google, onboarding),
        kpis(stats),
        chartCard(stats),
        h('div', { class: 'grid-3-2' }, upcomingCard(stats), servicesCard(stats))));
      loaded = true;
      app.refreshMeta();
    } finally {
      view.classList.remove('is-loading');
    }
  }

  await load();
  const timer = setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 60_000);
  return { cleanup: () => clearInterval(timer) };
}

import { get } from '../api.js';
import { h, icon, fmt, addDays, localParts, readableInk, alertBox, switchControl } from '../ui.js';
import { openBookingDrawer } from './booking-drawer.js';
import { openNewBookingModal } from './new-booking.js';

const HOUR_PX = 52;
const pad = (n) => String(n).padStart(2, '0');
const toMinutes = (time) => {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
};
const weekdayOf = (date) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = pondělí
const mondayOf = (date) => addDays(date, 1 - weekdayOf(date));

function weekLabel(start, end) {
  const f = (opts, date) => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))}.–${f({ day: 'numeric', month: 'long', year: 'numeric' }, end)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${f({ day: 'numeric', month: 'long' }, start)} – ${f({ day: 'numeric', month: 'long', year: 'numeric' }, end)}`;
  return `${f({ day: 'numeric', month: 'long', year: 'numeric' }, start)} – ${f({ day: 'numeric', month: 'long', year: 'numeric' }, end)}`;
}

/** Rozdělí překrývající se položky do sloupců („drah“). */
function layoutLanes(items) {
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      item.lane = lane;
    }
    for (const item of cluster) item.lanes = laneEnds.length;
    cluster = [];
  };
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
}

export async function mount({ view, actions, app }) {
  const state = { week: mondayOf(app.meta.today), showGoogle: true, settings: null, data: null };

  actions.append(h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openNewBookingModal({ app, onCreated: load }) }, icon('plus'), h('span', { class: 'btn-label' }, 'Nová rezervace')));

  const range = h('div', { class: 'week-range', 'aria-live': 'polite' });
  const notice = h('div');
  const card = h('div', { class: 'card week' });
  const legend = h('div', { class: 'legend', style: { marginTop: '12px' } });

  view.append(
    h('div', { class: 'week-toolbar' },
      h('div', { class: 'input-group' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Předchozí týden', onClick: () => shift(-7) }, icon('chevronLeft')),
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => { state.week = mondayOf(app.meta.today); load(); } }, 'Dnes'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Další týden', onClick: () => shift(7) }, icon('chevronRight'))),
      range,
      h('div', { style: { flex: '1' } }),
      app.meta.google.state === 'connected'
        ? switchControl({ checked: true, label: 'Události z Google Kalendáře', onChange: (value) => { state.showGoogle = value; render(); } })
        : null),
    notice,
    card,
    legend,
  );

  ({ settings: state.settings } = await get('/settings'));

  function shift(days) {
    state.week = addDays(state.week, days);
    load();
  }

  async function load() {
    const end = addDays(state.week, 6);
    range.textContent = weekLabel(state.week, end);
    if (state.data) card.style.opacity = '0.55';
    try {
      state.data = await get(`/calendar?from=${state.week}&to=${end}`);
      render();
    } catch (err) {
      notice.replaceChildren(alertBox('critical', 'Kalendář se nepodařilo načíst', err.message));
    } finally {
      card.style.opacity = '';
    }
  }

  function render() {
    const { bookings, events, googleError } = state.data;
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.week, i));
    const today = app.meta.today;
    const workingHours = state.settings.workingHours;

    notice.replaceChildren(...(googleError ? [alertBox('warning', 'Události z Google Kalendáře se nepodařilo načíst', googleError)] : []));

    const timed = Object.fromEntries(days.map((d) => [d, []]));
    const allDay = Object.fromEntries(days.map((d) => [d, []]));

    for (const b of bookings) {
      if (b.status === 'cancelled' || !timed[b.date]) continue;
      const start = toMinutes(b.time);
      const end = b.endTime > b.time ? toMinutes(b.endTime) : 1440;
      timed[b.date].push({ kind: 'booking', start, end: Math.max(end, start + 15), booking: b });
    }

    if (state.showGoogle) {
      for (const e of events) {
        const s = localParts(e.start);
        const en = localParts(e.end);
        for (const d of days) {
          if (e.allDay) {
            if (d >= s.date && d < en.date) allDay[d].push(e);
            continue;
          }
          if (d < s.date || d > en.date) continue;
          const start = d === s.date ? s.minutes : 0;
          const end = d === en.date ? en.minutes : 1440;
          if (end > start) timed[d].push({ kind: 'event', start, end, event: e });
        }
      }
    }

    // Rozsah hodin: otevírací doba + vše, co v týdnu je.
    let minHour = 24;
    let maxHour = 0;
    for (const d of days) {
      for (const it of workingHours[weekdayOf(d)] || []) {
        minHour = Math.min(minHour, Math.floor(toMinutes(it.from) / 60));
        maxHour = Math.max(maxHour, Math.ceil(toMinutes(it.to) / 60));
      }
      for (const it of timed[d]) {
        minHour = Math.min(minHour, Math.floor(it.start / 60));
        maxHour = Math.max(maxHour, Math.ceil(it.end / 60));
      }
    }
    if (minHour >= maxHour) [minHour, maxHour] = [8, 18];
    const height = (maxHour - minHour) * HOUR_PX;
    const y = (minutes) => ((minutes - minHour * 60) / 60) * HOUR_PX;

    const head = h('div', { class: 'week-head' },
      h('div'),
      days.map((d) => h('div', { class: `week-day${d === today ? ' is-today' : ''}` },
        h('div', { class: 'dow' }, fmt.weekdayShort(d)),
        h('div', { class: 'dom' }, h('span', {}, String(Number(d.slice(8))))))));

    const allDayRow = days.some((d) => allDay[d].length)
      ? h('div', { class: 'week-allday' },
        h('div', { class: 'label' }, 'Celý den'),
        days.map((d) => h('div', {}, allDay[d].map((e) => h('div', { class: 'allday-event', title: e.title }, e.title)))))
      : null;

    const hoursColumn = h('div', { class: 'week-hours', style: { height: `${height}px` } },
      Array.from({ length: maxHour - minHour + 1 }, (_, i) => h('div', { class: 'week-hour-label', style: { top: `${i * HOUR_PX}px` } }, `${pad(minHour + i)}:00`)));

    const nowMinutes = localParts(new Date().toISOString()).minutes;

    const columns = days.map((d) => {
      const col = h('div', { class: `week-col${d === today ? ' is-today' : ''}`, style: { height: `${height}px` } });

      // Mimo otevírací dobu
      let cursor = minHour * 60;
      const open = (workingHours[weekdayOf(d)] || []).map((it) => [toMinutes(it.from), toMinutes(it.to)]);
      for (const [from, to] of open) {
        if (from > cursor) col.append(h('div', { class: 'closed', style: { top: `${y(cursor)}px`, height: `${y(from) - y(cursor)}px` } }));
        cursor = Math.max(cursor, to);
      }
      if (cursor < maxHour * 60) col.append(h('div', { class: 'closed', style: { top: `${y(cursor)}px`, height: `${y(maxHour * 60) - y(cursor)}px` } }));

      for (let m = minHour * 60 + 30; m < maxHour * 60; m += 30) {
        col.append(h('div', { class: `hour-line${m % 60 ? ' half' : ''}`, style: { top: `${y(m)}px` } }));
      }

      // Kliknutím do prázdného místa vytvořit rezervaci
      for (let m = minHour * 60; m < maxHour * 60; m += 30) {
        const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        col.append(h('div', {
          class: 'week-click',
          style: { top: `${y(m)}px`, height: `${HOUR_PX / 2}px` },
          title: `Nová rezervace – ${fmt.dateMedium(d)} ${time}`,
          onClick: () => openNewBookingModal({ app, date: d, time, onCreated: load }),
        }));
      }

      const items = timed[d].sort((a, b) => a.start - b.start || b.end - a.end);
      layoutLanes(items);
      for (const it of items) {
        const top = y(it.start);
        const blockHeight = Math.max(20, y(it.end) - top - 2);
        const width = 100 / it.lanes;
        const style = {
          top: `${top + 1}px`,
          height: `${blockHeight}px`,
          left: `calc(${it.lane * width}% + 2px)`,
          width: `calc(${width}% - 4px)`,
        };
        if (it.kind === 'booking') {
          const b = it.booking;
          col.append(h('button', {
            type: 'button',
            class: `ev${b.status === 'no_show' ? ' is-noshow' : ''}`,
            style: { ...style, background: b.color, color: readableInk(b.color) },
            title: `${b.time}–${b.endTime} · ${b.customer.name} · ${b.serviceName}`,
            onClick: () => openBookingDrawer(b.id, { app, onChange: load }),
          },
          h('b', {}, b.customer.name),
          blockHeight > 34 ? h('span', {}, `${b.time}–${b.endTime}`) : null,
          blockHeight > 52 ? h('span', {}, b.serviceName) : null));
        } else {
          const e = it.event;
          col.append(h('div', {
            class: `ev ev-busy${e.blocking ? '' : ' is-free'}`,
            style,
            title: `${e.title} · ${e.blocking ? 'blokuje rezervace' : 'označeno jako volno – neblokuje'}`,
          },
          h('b', {}, e.title),
          blockHeight > 34 ? h('span', {}, `${localParts(e.start).time}–${localParts(e.end).time}`) : null));
        }
      }

      if (d === today && nowMinutes >= minHour * 60 && nowMinutes <= maxHour * 60) {
        col.append(h('div', { class: 'now-line', style: { top: `${y(nowMinutes)}px` }, 'aria-hidden': 'true' }));
      }
      return col;
    });

    card.replaceChildren(h('div', { class: 'week-inner' }, head, allDayRow, h('div', { class: 'week-body' }, hoursColumn, columns)));

    const servicesInWeek = new Map();
    for (const b of bookings) if (b.status !== 'cancelled') servicesInWeek.set(b.serviceName, b.color);
    legend.replaceChildren(...[
      ...[...servicesInWeek].map(([name, color]) => h('span', {}, h('span', { class: 'swatch', style: { background: color } }), name)),
      state.showGoogle && app.meta.google.configured
        ? h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--busy-fill)', boxShadow: 'inset 0 0 0 1px var(--axis)' } }), 'Obsazeno v Google Kalendáři')
        : null,
      h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--line)' } }), 'Mimo otevírací dobu'),
      h('span', { class: 'muted' }, 'Kliknutím do volného místa vytvoříte rezervaci'),
    ].filter(Boolean));
  }

  await load();
  const timer = setInterval(() => state.data && render(), 60_000);
  return { cleanup: () => clearInterval(timer) };
}

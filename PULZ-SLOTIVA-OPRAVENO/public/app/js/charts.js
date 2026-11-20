/* Grafy dashboardu – čisté SVG/HTML, bez knihoven.
   Jedna datová řada = jedna barva (--accent), tenké sloupce se zaobleným koncem,
   vlasové mřížky, tooltip na najetí i klávesnici, tabulka jako přístupná alternativa. */

import { h, fmt, plural, capitalize } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOOKING_FORMS = ['rezervace', 'rezervace', 'rezervací'];

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
  for (const child of children) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}

function niceScale(max) {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : Math.ceil(max / 5 / 5) * 5;
  const top = Math.max(step * 2, Math.ceil(max / step) * step);
  return { top, step };
}

/** Sloupec se zaobleným horním koncem (4px) a rovnou základnou. */
function barPath(x, y, w, height, radius = 4) {
  const r = Math.min(radius, w / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + height}Z`;
}

function positionTooltip(tooltip, container, x, y) {
  tooltip.hidden = false;
  const half = tooltip.offsetWidth / 2;
  const left = Math.min(Math.max(x, half + 2), container.clientWidth - half - 2);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${y}px`;
}

/** Sloupcový graf počtu rezervací po dnech. */
export function dailyBookingsChart(series) {
  const root = h('div', { class: 'chart' });
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true });
  const HEIGHT = 230;
  const M = { top: 16, right: 4, bottom: 28, left: 34 };
  let width = 0;
  let geo = null;
  let hover = -1;
  const todayIndex = series.findIndex((d) => d.isToday);

  function setHover(index) {
    if (!geo) return;
    hover = index >= 0 && index < series.length ? index : -1;
    root.classList.toggle('has-hover', hover >= 0);
    geo.bars.forEach((bar, i) => bar?.classList.toggle('is-hover', i === hover));
    if (hover < 0) {
      tooltip.hidden = true;
      return;
    }
    const d = series[hover];
    tooltip.replaceChildren(...[
      h('div', { class: 'tt-value' }, plural(d.count, BOOKING_FORMS)),
      h('div', { class: 'tt-label' }, `${capitalize(fmt.dateLongNoYear(d.date))}${d.isToday ? ' · dnes' : ''}`),
      d.revenue > 0 ? h('div', { class: 'tt-row' }, h('span', { class: 'tt-key' }), fmt.money(d.revenue)) : null,
    ].filter(Boolean));
    const cx = M.left + geo.band * (hover + 0.5);
    positionTooltip(tooltip, root, cx, d.count ? geo.y(d.count) : geo.baseline);
  }

  function draw() {
    width = root.clientWidth;
    if (!width) return;
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;
    const { top, step } = niceScale(Math.max(0, ...series.map((d) => d.count)));
    const band = innerW / series.length;
    const barW = Math.max(3, Math.min(24, band * 0.62));
    const y = (v) => M.top + innerH - (v / top) * innerH;
    const baseline = M.top + innerH;

    const svg = s('svg', {
      width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, tabindex: '0', role: 'img',
      'aria-label': `Rezervace po dnech. Celkem ${plural(series.reduce((a, d) => a + d.count, 0), BOOKING_FORMS)}. Šipkami lze procházet jednotlivé dny.`,
    });

    for (let v = step; v <= top; v += step) {
      svg.append(s('line', { class: 'gridline', x1: M.left, x2: width - M.right, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 }));
    }
    for (let v = 0; v <= top; v += step) {
      svg.append(s('text', { class: 'tick', x: M.left - 10, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, fmt.number(v)));
    }

    const bars = series.map((d, i) => {
      if (!d.count) return null;
      const x = M.left + band * i + (band - barW) / 2;
      const bar = s('path', { class: 'bar', d: barPath(x, y(d.count), barW, baseline - y(d.count)) });
      svg.append(bar);
      return bar;
    });

    svg.append(s('line', { class: 'baseline', x1: M.left, x2: width - M.right, y1: Math.round(baseline) + 0.5, y2: Math.round(baseline) + 0.5 }));

    series.forEach((d, i) => {
      const cx = M.left + band * (i + 0.5);
      if (d.isToday) {
        svg.append(s('text', { class: 'tick tick-strong', x: cx, y: HEIGHT - 8, 'text-anchor': 'middle' }, 'Dnes'));
      } else if (d.weekday === 1 && (todayIndex < 0 || Math.abs(i - todayIndex) * band > 44)) {
        svg.append(s('text', { class: 'tick', x: cx, y: HEIGHT - 8, 'text-anchor': 'middle' }, fmt.dayMonth(d.date)));
      }
    });

    svg.addEventListener('pointermove', (e) => {
      const px = e.clientX - svg.getBoundingClientRect().left;
      setHover(px < M.left || px > width - M.right ? -1 : Math.floor((px - M.left) / band));
    });
    svg.addEventListener('pointerleave', () => setHover(-1));
    svg.addEventListener('focus', () => setHover(todayIndex >= 0 ? todayIndex : series.length - 1));
    svg.addEventListener('blur', () => setHover(-1));
    svg.addEventListener('keydown', (e) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      if (e.key in moves) {
        e.preventDefault();
        setHover(Math.min(series.length - 1, Math.max(0, (hover < 0 ? todayIndex : hover) + moves[e.key])));
      } else if (e.key === 'Escape') setHover(-1);
    });

    geo = { band, y, baseline, bars };
    root.replaceChildren(svg, tooltip);
    if (hover >= 0) setHover(hover);
  }

  new ResizeObserver(() => {
    if (root.clientWidth !== width) draw();
  }).observe(root);
  return root;
}

/** Vodorovné pruhy – počet rezervací podle služby. */
export function serviceBarsChart(items) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const list = h('div', { class: 'hbars' });
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true });
  const root = h('div', { class: 'chart' }, list, tooltip);

  for (const item of items) {
    const fill = h('span', { class: 'hbar-fill', style: { width: `calc((100% - 48px) * ${item.count / max})` } });
    const row = h('div', {
      class: 'hbar',
      tabindex: '0',
      'aria-label': `${item.name}: ${plural(item.count, BOOKING_FORMS)}, ${fmt.money(item.revenue)}`,
    },
    h('div', { class: 'hbar-label' }, h('span', { class: 'swatch', style: { background: item.color } }), h('span', {}, item.name)),
    h('div', { class: 'hbar-track' }, fill, h('span', { class: 'hbar-value' }, fmt.number(item.count))));

    const show = () => {
      list.classList.add('has-hover');
      row.classList.add('is-hover');
      tooltip.replaceChildren(
        h('div', { class: 'tt-value' }, plural(item.count, BOOKING_FORMS)),
        h('div', { class: 'tt-label' }, item.name),
        h('div', { class: 'tt-row' }, h('span', { class: 'tt-key' }), fmt.money(item.revenue)),
      );
      const rootBox = root.getBoundingClientRect();
      const fillBox = fill.getBoundingClientRect();
      positionTooltip(tooltip, root, fillBox.right - rootBox.left, fillBox.top - rootBox.top);
    };
    const hide = () => {
      list.classList.remove('has-hover');
      row.classList.remove('is-hover');
      tooltip.hidden = true;
    };
    row.addEventListener('pointerenter', show);
    row.addEventListener('pointerleave', hide);
    row.addEventListener('focus', show);
    row.addEventListener('blur', hide);
    list.append(row);
  }
  return root;
}

/** Tabulkové zobrazení dat grafu (přístupná alternativa). */
export function dataTable(columns, rows) {
  return h('div', { class: 'chart-table-wrap' },
    h('table', { class: 'chart-table' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.format ? c.format(r[c.key], r) : r[c.key])))))));
}

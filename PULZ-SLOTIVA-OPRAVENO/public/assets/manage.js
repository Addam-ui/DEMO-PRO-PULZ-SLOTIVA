import { $, h, icon, api, applyBrand } from './common.js';

const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const state = { booking: null, config: null, message: null, error: null, busy: false };

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'R';

function statusBadge(b) {
  if (b.status === 'cancelled') return h('span', { class: 'status-badge status-cancelled' }, icon('x', 14), 'Zrušeno');
  if (b.isPast) return h('span', { class: 'status-badge status-past' }, icon('check', 14), 'Proběhlo');
  return h('span', { class: 'status-badge status-confirmed' }, icon('check', 14), 'Potvrzeno');
}

function render() {
  const b = state.booking;
  const biz = b.business;
  const row = (label, value) => h('div', { class: 'ticket-row' }, h('span', {}, label), h('span', {}, value));
  const active = b.status === 'confirmed' && !b.isPast;

  $('#main').replaceChildren(...[
    h('div', { class: 'manage-head' },
      h('div', { class: 'biz-mark', 'aria-hidden': 'true' }, initials(biz.name)),
      h('div', { class: 'biz-name' }, biz.name)),
    state.message ? h('div', { class: 'alert alert-info', role: 'status' }, icon('check', 18), state.message) : null,
    state.error ? h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert', 18), state.error) : null,
    statusBadge(b),
    h('h2', {}, b.serviceName),
    h('div', { class: 'ticket' },
      row('Datum', capitalize(b.dateLabel)),
      row('Čas', `${b.time}–${b.endTime}`),
      row('Cena', b.priceLabel),
      row('Jméno', b.customerName),
      biz.address ? row('Adresa', biz.address) : null,
      row('Kód rezervace', h('span', { class: 'ticket-code' }, b.code))),
    h('div', { class: 'manage-actions' },
      b.canCancel ? h('button', { type: 'button', class: 'btn btn-danger', disabled: state.busy, onClick: () => $('#cancel-dialog').showModal() },
        state.busy ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('x', 16), 'Zrušit rezervaci') : null,
      b.status === 'cancelled' ? h('a', { class: 'btn btn-primary', href: b.bookingPageUrl }, icon('calendar', 16), 'Vybrat nový termín') : null),
    b.canCancel
      ? h('p', { class: 'manage-note' }, `Když rezervaci zrušíte, termín se uvolní a zmizí i z kalendáře ${biz.name}. Zrušit můžete nejpozději ${b.cancelLimitHours} h před začátkem.`)
      : null,
    active && !b.canCancel
      ? h('p', { class: 'manage-note' },
        `Online zrušení je možné nejpozději ${b.cancelLimitHours} h před začátkem. Pokud nemůžete přijít, kontaktujte nás prosím.`)
      : null,
    h('div', { class: 'manage-contact' },
      biz.address ? h('span', {}, icon('mapPin', 15), biz.address) : null,
      biz.phone ? h('a', { href: `tel:${biz.phone.replace(/\s/g, '')}` }, icon('phone', 15), biz.phone) : null,
      biz.email ? h('a', { href: `mailto:${biz.email}` }, icon('mail', 15), biz.email) : null),
  ].filter(Boolean));
}

async function cancel() {
  $('#cancel-dialog').close();
  state.busy = true;
  state.error = null;
  render();
  try {
    const { booking } = await api(`/bookings/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
    state.booking = booking;
    state.message = 'Rezervace je zrušená. Termín se uvolnil a z našeho kalendáře zmizel. Děkujeme, že jste dali vědět.';
  } catch (err) {
    state.error = err.message;
  }
  state.busy = false;
  render();
}

async function init() {
  $('#cancel-dialog [data-close]').addEventListener('click', () => $('#cancel-dialog').close());
  $('#cancel-dialog [data-confirm]').addEventListener('click', cancel);
  try {
    const { booking } = await api(`/bookings/${encodeURIComponent(token)}`);
    applyBrand(booking.brandColor);
    state.booking = booking;
    document.title = `Rezervace ${booking.code} – ${booking.business.name}`;
    render();
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'fatal' },
      h('h2', {}, 'Rezervaci se nepodařilo najít'),
      h('p', {}, err.message),
      h('p', { style: { marginTop: '18px' } }, h('a', { class: 'btn btn-secondary', href: '/' }, 'Přejít na rezervace'))));
  }
}

init();

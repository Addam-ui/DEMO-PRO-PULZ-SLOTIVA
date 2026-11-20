import { get, post } from '../api.js';
import { h, icon, fmt, openModal, field, withBusy, alertBox, emptyState, toast } from '../ui.js';

/** Modální okno pro ruční vytvoření rezervace (např. po telefonu). */
export async function openNewBookingModal({ app, date, time, onCreated } = {}) {
  const m = openModal({ title: 'Nová rezervace' });
  m.body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));

  let services;
  try {
    ({ services } = await get('/services'));
  } catch (err) {
    m.body.replaceChildren(alertBox('critical', null, err.message));
    return;
  }
  if (!services.length) {
    m.body.replaceChildren(emptyState('layers', 'Nejdřív přidejte službu', 'Rezervace se vždy vytváří pro konkrétní službu.',
      h('a', { class: 'btn btn-primary btn-sm', href: '#/sluzby', onClick: () => m.close() }, 'Přejít na služby')));
    return;
  }

  const state = {
    serviceId: (services.find((s) => s.active) || services[0]).id,
    date: date || app.meta.today,
    time: null,
    preferTime: time || null,
    custom: false,
  };

  const error = h('div');
  const serviceSelect = h('select', { class: 'select', id: 'nb-service' },
    services.map((s) => h('option', { value: String(s.id), selected: s.id === state.serviceId },
      `${s.name} · ${fmt.duration(s.durationMin)} · ${fmt.price(s.price)}${s.active ? '' : ' (skrytá)'}`)));
  const dateInput = h('input', { class: 'input', type: 'date', id: 'nb-date', value: state.date });
  const slotsBox = h('div');
  const customTime = h('input', { class: 'input', type: 'time', step: '300', value: time || '' });
  const force = h('input', { type: 'checkbox' });
  const customBox = h('div', { class: 'stack', style: { gap: '10px' }, hidden: true }, customTime,
    h('label', { class: 'check' }, force, h('span', {}, 'Ignorovat kolize a otevírací dobu')));
  const toggle = h('button', { type: 'button', class: 'link-btn', onClick: () => setCustom(!state.custom) }, 'Zadat vlastní čas');
  const name = h('input', { class: 'input', id: 'nb-name', autocomplete: 'off', maxlength: '100' });
  const email = h('input', { class: 'input', id: 'nb-email', type: 'email', autocomplete: 'off' });
  const phone = h('input', { class: 'input', id: 'nb-phone', type: 'tel', autocomplete: 'off' });
  const note = h('textarea', { class: 'textarea', id: 'nb-note', rows: '2' });
  const notify = h('input', { type: 'checkbox', checked: true });

  function setCustom(value) {
    state.custom = value;
    customBox.hidden = !value;
    slotsBox.hidden = value;
    toggle.textContent = value ? 'Vybrat z volných časů' : 'Zadat vlastní čas';
  }

  async function loadSlots() {
    slotsBox.replaceChildren(h('div', { class: 'muted' }, 'Načítám volné časy…'));
    try {
      const data = await get(`/availability?serviceId=${state.serviceId}&from=${state.date}&to=${state.date}`);
      const slots = data.days[state.date] || [];
      if (state.preferTime) {
        if (slots.includes(state.preferTime)) state.time = state.preferTime;
        else setCustom(true);
        state.preferTime = null;
      } else if (!slots.includes(state.time)) {
        state.time = null;
      }
      slotsBox.replaceChildren(slots.length
        ? h('div', { class: 'slot-picker' }, slots.map((t) => h('button', {
          type: 'button',
          class: t === state.time ? 'is-selected' : null,
          onClick: (e) => {
            state.time = t;
            slotsBox.querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-selected', btn === e.currentTarget));
          },
        }, t)))
        : h('div', { class: 'muted' }, 'V tento den nejsou volné časy – můžete zadat vlastní čas.'));
    } catch (err) {
      slotsBox.replaceChildren(h('div', { class: 'field-error' }, err.message));
    }
  }

  serviceSelect.addEventListener('change', () => {
    state.serviceId = Number(serviceSelect.value);
    loadSlots();
  });
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value;
    if (state.date) loadSlots();
  });

  m.body.replaceChildren(error, h('div', { class: 'form-grid' },
    field('Služba', serviceSelect, { wide: true }),
    field('Datum', dateInput, { wide: true }),
    h('div', { class: 'field span-2' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span', { class: 'label' }, 'Čas'), toggle),
      slotsBox,
      customBox),
    field('Jméno a příjmení klienta', name, { wide: true }),
    field('E-mail', email),
    field('Telefon', phone),
    field('Poznámka', note, { wide: true }),
    app.meta.mailEnabled
      ? h('label', { class: 'check span-2' }, notify, h('span', {}, 'Poslat klientovi potvrzení e-mailem (když vyplníte e-mail)'))
      : null));

  const submit = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    onClick: (e) => {
      const chosen = state.custom ? customTime.value : state.time;
      if (!chosen) {
        error.replaceChildren(alertBox('warning', null, 'Vyberte čas rezervace.'));
        return;
      }
      if (!name.value.trim()) {
        error.replaceChildren(alertBox('warning', null, 'Vyplňte jméno klienta.'));
        name.focus();
        return;
      }
      withBusy(e.currentTarget, async () => {
        try {
          const { booking } = await post('/bookings', {
            serviceId: state.serviceId,
            date: state.date,
            time: chosen,
            force: state.custom && force.checked,
            name: name.value,
            email: email.value,
            phone: phone.value,
            note: note.value,
            notifyCustomer: app.meta.mailEnabled && notify.checked && Boolean(email.value.trim()),
          });
          m.close();
          toast(`Rezervace vytvořena · ${fmt.relativeDay(booking.date, app.meta.today)} ${booking.time}`);
          app.refreshMeta();
          onCreated?.(booking);
        } catch (err) {
          error.replaceChildren(alertBox('critical', null, err.message));
          m.modal.scrollIntoView({ block: 'start' });
        }
      });
    },
  }, icon('check'), 'Vytvořit rezervaci');

  m.foot.append(h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => m.close() }, 'Zrušit'), submit);
  loadSlots();
}

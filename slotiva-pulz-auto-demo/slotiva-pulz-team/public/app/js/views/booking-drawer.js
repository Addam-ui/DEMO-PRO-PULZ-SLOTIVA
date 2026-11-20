import { get, patch } from '../api.js';
import {
  h, icon, fmt, capitalize, statusBadge, SOURCE_LABELS, CANCELLED_BY,
  openDrawer, toast, copyText, withBusy, alertBox, field, GOOGLE_CONNECT_URL,
} from '../ui.js';
import { cancelBooking } from './booking-actions.js';

const dt = (text) => h('dt', {}, text);
const dd = (...children) => h('dd', {}, ...children);
const section = (title, ...children) => h('section', { class: 'detail-section' }, h('h3', {}, title), ...children);

/** Boční panel s detailem rezervace a akcemi (přesunout, zrušit, upravit…). */
export function openBookingDrawer(id, { app, onChange, onClose } = {}) {
  const drawer = openDrawer({ label: 'Detail rezervace', onClose });
  const mailEnabled = Boolean(app?.meta?.mailEnabled);
  const googleState = app?.meta?.google?.state || 'unavailable';
  const googleActive = googleState === 'connected';
  let booking = null;
  let mode = 'detail';

  drawer.body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  drawer.head.append(h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', style: { marginLeft: 'auto' }, 'aria-label': 'Zavřít', onClick: drawer.close }, icon('x')));

  get(`/bookings/${id}`)
    .then((data) => {
      booking = data.booking;
      render();
    })
    .catch((err) => drawer.body.replaceChildren(alertBox('critical', 'Rezervaci se nepodařilo načíst', err.message)));

  async function update(body, message) {
    const data = await patch(`/bookings/${booking.id}`, body);
    booking = data.booking;
    mode = 'detail';
    render();
    onChange?.(booking);
    app?.refreshMeta?.();
    if (message) toast(message);
    return booking;
  }

  /** Obal akce: spinner na tlačítku + chyba jako toast. */
  const act = (fn) => (event) => withBusy(event.currentTarget, async () => {
    try {
      await fn();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  function render() {
    drawer.head.replaceChildren(
      statusBadge(booking),
      h('span', { class: 'muted code' }, booking.code),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '2px' } },
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Kopírovat odkaz pro klienta', 'aria-label': 'Kopírovat odkaz pro klienta',
          onClick: () => copyText(booking.manageUrl, 'Odkaz pro klienta zkopírován'),
        }, icon('link')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Zavřít', onClick: drawer.close }, icon('x'))),
    );
    if (mode === 'reschedule') renderReschedule();
    else if (mode === 'edit') renderEdit();
    else renderDetail();
    drawer.body.scrollTop = 0;
  }

  function googleCell(b) {
    if (b.google.pending) return h('span', { class: 'badge badge-warning' }, icon('alert', 12), b.status === 'cancelled' ? 'Čeká na smazání' : 'Čeká na zápis');
    if (b.status === 'cancelled') return h('span', { class: 'muted' }, b.google.eventId ? 'Událost odstraněna' : '—');
    if (b.google.eventId) return h('span', { class: 'badge badge-good' }, icon('check', 12), 'V kalendáři');
    if (googleState === 'disconnected' || googleState === 'unavailable') return h('span', { class: 'muted' }, 'Kalendář není připojený');
    if (googleState === 'revoked' || googleState === 'noscope') return h('span', { class: 'badge badge-critical' }, 'Kalendář odpojen');
    return h('span', { class: 'muted' }, 'Zatím nezapsáno');
  }

  function renderDetail() {
    const b = booking;
    const past = Date.parse(b.end) < Date.now();
    const missingInCalendar = b.status === 'confirmed' && !b.google.eventId && !b.google.pending && b.source !== 'demo';

    const internal = h('textarea', { class: 'textarea', rows: '3', placeholder: 'Poznámka jen pro vás – klient ji neuvidí', value: b.internalNote });
    const saveNote = h('button', {
      type: 'button', class: 'btn btn-secondary btn-sm', hidden: true,
      onClick: act(() => update({
        action: 'details', name: b.customer.name, email: b.customer.email, phone: b.customer.phone, note: b.note, internalNote: internal.value,
      }, 'Poznámka uložena')),
    }, 'Uložit poznámku');
    internal.addEventListener('input', () => { saveNote.hidden = internal.value === b.internalNote; });

    drawer.body.replaceChildren(...[
      h('div', { class: 'detail-hero' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'swatch', style: { background: b.color } }), h('span', { class: 'secondary' }, b.serviceName)),
        h('h2', { class: 'num' }, `${b.time}–${b.endTime}`),
        h('div', { class: 'detail-when' }, `${capitalize(fmt.dateLong(b.date))} · ${fmt.duration(b.durationMin)} · ${fmt.price(b.price)}`)),
      b.status === 'cancelled'
        ? alertBox('critical', `Zrušeno ${CANCELLED_BY[b.cancelledBy] || ''}`.trim(), b.cancelledAt ? fmt.datetime(b.cancelledAt) : null)
        : null,
      b.google.pending
        ? alertBox('warning', 'Nepropsáno do Google Kalendáře', b.google.error || 'Čeká na synchronizaci.',
          h('button', {
            type: 'button', class: 'btn btn-secondary btn-sm',
            onClick: act(async () => {
              const r = await update({ action: 'resync' });
              toast(r.google.pending ? 'Zápis se znovu nepovedl' : 'Propsáno do Google Kalendáře', { error: Boolean(r.google.pending) });
            }),
          }, icon('refresh', 14), 'Zkusit znovu'))
        : null,
      missingInCalendar && (googleState === 'revoked' || googleState === 'noscope')
        ? alertBox('warning', 'Rezervace není v Google Kalendáři', 'Připojte kalendář znovu a rezervace se do něj zapíše.',
          h('a', { class: 'btn btn-secondary btn-sm', href: GOOGLE_CONNECT_URL }, 'Připojit'))
        : null,
      section('Klient', h('dl', { class: 'dl' },
        dt('Jméno'), dd(b.customer.name),
        dt('Telefon'), dd(b.customer.phone ? h('a', { href: `tel:${b.customer.phone.replace(/\s/g, '')}` }, b.customer.phone) : '—'),
        dt('E-mail'), dd(b.customer.email ? h('a', { href: `mailto:${b.customer.email}` }, b.customer.email) : '—'))),
      b.note ? section('Poznámka od klienta', h('div', { class: 'note-box' }, b.note)) : null,
      section('Interní poznámka', internal, h('div', {}, saveNote)),
      section('Informace', h('dl', { class: 'dl' },
        dt('Kód rezervace'), dd(h('span', { class: 'code' }, b.code)),
        dt('Zdroj'), dd(SOURCE_LABELS[b.source] || b.source),
        dt('Vytvořeno'), dd(fmt.datetime(b.createdAt)),
        dt('Google Kalendář'), dd(googleCell(b)))),
    ].filter(Boolean));

    const buttons = [];
    if (googleActive && missingInCalendar) {
      buttons.push(h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        onClick: act(async () => {
          const r = await update({ action: 'resync' });
          toast(r.google.eventId ? 'Přidáno do Google Kalendáře' : 'Zápis se nepovedl', { error: !r.google.eventId });
        }),
      }, icon('calendarPlus'), 'Přidat do kalendáře'));
    }
    if (b.status === 'confirmed' && !past) {
      buttons.push(h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => { mode = 'reschedule'; render(); } }, icon('calendarMove'), 'Přesunout'));
    }
    if (b.status === 'confirmed' && past) {
      buttons.push(h('button', { type: 'button', class: 'btn btn-secondary', onClick: act(() => update({ action: 'status', status: 'no_show' }, 'Označeno: nedostavil(a) se')) }, icon('userX'), 'Nedostavil(a) se'));
    }
    if (b.status === 'no_show') {
      buttons.push(h('button', { type: 'button', class: 'btn btn-secondary', onClick: act(() => update({ action: 'status', status: 'confirmed' }, 'Stav vrácen')) }, icon('undo'), 'Vrátit na „proběhlo“'));
    }
    if (b.status !== 'cancelled') {
      buttons.push(h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => { mode = 'edit'; render(); } }, icon('edit'), 'Upravit údaje'));
    }
    if (b.status === 'cancelled') {
      buttons.push(h('button', { type: 'button', class: 'btn btn-primary', onClick: act(() => update({ action: 'status', status: 'confirmed' }, 'Rezervace obnovena')) }, icon('undo'), 'Obnovit rezervaci'));
    }
    if (b.status !== 'cancelled') {
      buttons.push(h('button', { type: 'button', class: 'btn btn-danger', style: { marginLeft: 'auto' }, onClick: cancel }, icon('x'), 'Zrušit rezervaci'));
    }
    drawer.foot.replaceChildren(...buttons);
  }

  async function cancel() {
    try {
      const updated = await cancelBooking(booking, { mailEnabled, googleActive });
      if (!updated) return;
      booking = updated;
      mode = 'detail';
      render();
      onChange?.(booking);
      app?.refreshMeta?.();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  function renderReschedule() {
    const b = booking;
    let date = b.date;
    let time = null;
    let custom = !b.serviceId;

    const error = h('div');
    const dateInput = h('input', { class: 'input', type: 'date', value: date });
    const slotsBox = h('div');
    const customTime = h('input', { class: 'input', type: 'time', step: '300', value: b.time });
    const force = h('input', { type: 'checkbox' });
    const customBox = h('div', { class: 'stack', style: { gap: '10px' } }, customTime,
      h('label', { class: 'check' }, force, h('span', {}, 'Ignorovat kolize a otevírací dobu')));
    const notify = h('input', { type: 'checkbox', checked: true });
    const toggle = h('button', { type: 'button', class: 'link-btn', onClick: () => setCustom(!custom) });

    function setCustom(value) {
      custom = value;
      customBox.hidden = !custom;
      slotsBox.hidden = custom;
      toggle.textContent = custom ? 'Vybrat z volných časů' : 'Zadat vlastní čas';
      toggle.hidden = !b.serviceId;
    }

    async function loadSlots() {
      if (!b.serviceId) return;
      slotsBox.replaceChildren(h('div', { class: 'muted' }, 'Načítám volné časy…'));
      try {
        const data = await get(`/availability?serviceId=${b.serviceId}&from=${date}&to=${date}&excludeBookingId=${b.id}`);
        const slots = data.days[date] || [];
        if (!slots.includes(time)) time = null;
        slotsBox.replaceChildren(slots.length
          ? h('div', { class: 'slot-picker' }, slots.map((t) => h('button', {
            type: 'button',
            class: t === time ? 'is-selected' : null,
            onClick: (e) => {
              time = t;
              slotsBox.querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-selected', btn === e.currentTarget));
            },
          }, t)))
          : h('div', { class: 'muted' }, 'V tento den nejsou volné časy. Můžete zadat vlastní čas.'));
      } catch (err) {
        slotsBox.replaceChildren(h('div', { class: 'field-error' }, err.message));
      }
    }

    dateInput.addEventListener('change', () => {
      date = dateInput.value;
      if (date) loadSlots();
    });

    drawer.body.replaceChildren(...[
      h('div', { class: 'detail-hero' },
        h('h2', {}, 'Přesunout rezervaci'),
        h('div', { class: 'detail-when' }, `Nyní: ${capitalize(fmt.dateLongNoYear(b.date))}, ${b.time}–${b.endTime}`)),
      error,
      field('Nový den', dateInput),
      h('div', { class: 'field' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span', { class: 'label' }, 'Nový čas'), toggle),
        slotsBox,
        customBox),
      mailEnabled && b.customer.email ? h('label', { class: 'check' }, notify, h('span', {}, 'Poslat klientovi e-mail o změně termínu')) : null,
    ].filter(Boolean));

    drawer.foot.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => { mode = 'detail'; render(); } }, 'Zpět'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          const chosen = custom ? customTime.value : time;
          if (!date || !chosen) {
            error.replaceChildren(alertBox('warning', null, 'Vyberte nový den a čas.'));
            return;
          }
          try {
            await update({ action: 'reschedule', date, time: chosen, force: custom && force.checked, notifyCustomer: mailEnabled && notify.checked }, 'Rezervace přesunuta');
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, icon('check'), 'Uložit nový termín'));

    setCustom(custom);
    loadSlots();
  }

  function renderEdit() {
    const b = booking;
    const error = h('div');
    const name = h('input', { class: 'input', value: b.customer.name, maxlength: '100' });
    const email = h('input', { class: 'input', type: 'email', value: b.customer.email });
    const phone = h('input', { class: 'input', type: 'tel', value: b.customer.phone });
    const note = h('textarea', { class: 'textarea', rows: '3', value: b.note });

    drawer.body.replaceChildren(...[
      h('div', { class: 'detail-hero' }, h('h2', {}, 'Upravit údaje klienta')),
      error,
      field('Jméno a příjmení', name, { id: 'edit-name' }),
      field('E-mail', email, { id: 'edit-email' }),
      field('Telefon', phone, { id: 'edit-phone' }),
      field('Poznámka od klienta', note, { id: 'edit-note' }),
      googleActive && b.google.eventId ? h('p', { class: 'muted' }, 'Změny se propíšou i do události v Google Kalendáři.') : null,
    ].filter(Boolean));

    drawer.foot.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => { mode = 'detail'; render(); } }, 'Zpět'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          try {
            await update({ action: 'details', name: name.value, email: email.value, phone: phone.value, note: note.value, internalNote: b.internalNote }, 'Údaje uloženy');
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, icon('check'), 'Uložit'));
  }

  return drawer;
}

import { $, h, icon, api, applyBrand, fmt, reportHeightToParent, postToParent } from './common.js';

const params = new URLSearchParams(location.search);
const isEmbed = params.has('embed');
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || '');
const pageApi = `/pages/${encodeURIComponent(slug)}`;
if (isEmbed) document.body.classList.add('embed');
if (params.has('popup')) document.body.classList.add('popup');

const STEPS = ['service', 'time', 'details', 'done'];
const FIELDS = ['name', 'email', 'phone', 'note', 'consent'];

const state = {
  config: null,
  step: 'service',
  service: null,
  barberId: null,
  month: null, // { year, month }
  availability: {}, // `${serviceId}:${RRRR-MM}` → { 'RRRR-MM-DD': ['09:00', …] }
  loading: false,
  loadError: null,
  requestId: 0,
  date: null,
  time: null,
  notice: null,
  form: { name: '', email: '', phone: '', note: '', consent: false },
  errors: {},
  submitError: null,
  submitting: false,
  booking: null,
};

/* ───────────── datum ───────────── */

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthOf = (date) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
const monthIndex = ({ year, month }) => year * 12 + month - 1;
const monthFromIndex = (i) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthKey = () => `${state.barberId}:${state.service?.id}:${state.month.year}-${pad(state.month.month)}`;
const maxDate = () => addDays(state.config.today, state.config.maxAdvanceDays);

function endTime(time, durationMin) {
  const [hh, mm] = time.split(':').map(Number);
  const total = (hh * 60 + mm + durationMin) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function plural(n, one, few, many) {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'R';
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────────── akce ───────────── */

function go(step) {
  state.step = step;
  state.submitError = null;
  render();
  if (!isEmbed) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectService(service) {
  if (state.service?.id !== service.id) {
    state.date = null;
    state.time = null;
  }
  state.service = service;
  state.month = monthOf(state.date || state.config.today);
  state.notice = null;
  go('time');
  loadMonth({ autoAdvance: !state.date });
}

function changeMonth(delta) {
  state.month = monthFromIndex(monthIndex(state.month) + delta);
  render();
  loadMonth();
}

function selectDate(date) {
  if (state.date !== date) state.time = null;
  state.date = date;
  render();
}

function selectTime(time) {
  state.time = time;
  render();
  $('#continue')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function loadMonth({ autoAdvance = false, force = false } = {}) {
  const key = monthKey();
  const requestId = ++state.requestId;
  const { year, month } = state.month;
  const today = state.config.today;
  const last = maxDate();

  if (!state.availability[key] || force) {
    const first = `${year}-${pad(month)}-01`;
    const end = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    const from = first < today ? today : first;
    const to = end > last ? last : end;

    state.loading = true;
    state.loadError = null;
    render();
    try {
      const data = from <= to
        ? await api(`${pageApi}/availability?serviceId=${state.service.id}&from=${from}&to=${to}`)
        : { days: {} };
      state.availability[key] = data.days;
    } catch (err) {
      if (requestId === state.requestId) state.loadError = err.message;
    }
    if (requestId !== state.requestId) return; // mezitím uživatel přepnul měsíc/službu
    state.loading = false;
  }

  const days = state.availability[key];
  if (!days) return render();

  const available = Object.keys(days).filter((d) => days[d].length).sort();
  const canGoNext = monthIndex(state.month) < monthIndex(monthOf(last));
  if (!available.length && autoAdvance && canGoNext) {
    state.month = monthFromIndex(monthIndex(state.month) + 1);
    return loadMonth({ autoAdvance: false });
  }
  if (!state.date || !days[state.date]?.length) {
    // Vybraný den v tomto měsíci není (nebo už nemá volno) → předvybrat první volný den.
    state.date = available[0] || null;
    state.time = null;
  } else if (state.time && !days[state.date].includes(state.time)) {
    state.time = null;
  }
  render();
}

function validateLocal() {
  const f = state.form;
  const errors = {};
  if (!f.name.trim()) errors.name = 'Vyplňte prosím jméno a příjmení.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) errors.email = 'Zadejte prosím platnou e-mailovou adresu.';
  if (state.config.requirePhone && f.phone.replace(/\D/g, '').length < 6) errors.phone = 'Zadejte prosím telefonní číslo.';
  if (!f.consent) errors.consent = 'Pro dokončení rezervace potřebujeme váš souhlas.';
  return errors;
}

async function submit(event) {
  event.preventDefault();
  if (state.submitting) return;
  const honeypot = $('input[name="website"]')?.value || '';

  state.errors = validateLocal();
  if (Object.keys(state.errors).length) {
    render();
    $(`#f-${Object.keys(state.errors)[0]}`)?.focus();
    return;
  }

  state.submitting = true;
  state.submitError = null;
  render();
  try {
    const { booking } = await api(`${pageApi}/bookings`, {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        barberId: state.barberId || state.service.barberId,
        date: state.date,
        time: state.time,
        ...state.form,
        website: honeypot,
      },
    });
    state.booking = booking;
    state.step = 'done';
    postToParent({ type: 'slotiva:booked', code: booking.code, service: booking.serviceName, date: booking.date, time: booking.time });
  } catch (err) {
    if (err.status === 409) {
      // Termín mezitím někdo obsadil → zpět na výběr času s čerstvými daty.
      Object.keys(state.availability).filter((k) => k.startsWith(`${state.service.id}:`)).forEach((k) => delete state.availability[k]);
      state.time = null;
      state.notice = err.message;
      state.step = 'time';
      state.submitting = false;
      loadMonth({ force: true });
      return;
    }
    if (FIELDS.includes(err.data?.field)) state.errors = { [err.data.field]: err.message };
    else state.submitError = err.message;
  } finally {
    state.submitting = false;
  }
  render();
  if (!isEmbed) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function reset() {
  Object.assign(state, { step: 'service', service: null, date: null, time: null, booking: null, errors: {}, notice: null, availability: {} });
  state.form.note = '';
  state.form.consent = false;
  render();
}

/* ───────────── vykreslení ───────────── */

function alertBox(type, message, action) {
  return h('div', { class: `alert alert-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : 'info', 18),
    h('div', { style: { flex: '1' } }, message),
    action || null);
}

function emptyState(iconName, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 22)), h('div', {}, text), action || null);
}

function summaryRow(iconName, label, value, isSet) {
  return h('div', { class: `summary-row${isSet ? ' is-set' : ''}` },
    h('div', { class: 'summary-icon' }, icon(iconName, 17)),
    h('div', {}, h('div', { class: 'summary-label' }, label), h('div', { class: 'summary-value' }, value)));
}

function renderAside() {
  const { business } = state.config;
  const s = state.service;
  $('#aside').replaceChildren(...[
    !isEmbed && business.website ? h('a', { class: 'back-link', href: business.website }, icon('arrowLeft', 16), 'Zpět na web') : null,
    h('div', { class: 'biz' },
      h('div', { class: 'biz-mark', 'aria-hidden': 'true' }, initials(business.name)),
      h('div', {},
        h('h1', { class: 'biz-name' }, business.name),
        business.tagline ? h('p', { class: 'biz-tagline' }, business.tagline) : null)),
    business.description ? h('p', { class: 'biz-desc' }, business.description) : null,
    h('div', { class: 'summary' },
      h('div', { class: 'summary-title' }, 'Vaše rezervace'),
      summaryRow('tag', 'Služba', s ? `${s.name} · ${fmt.duration(s.durationMin)}` : 'Zatím nevybráno', Boolean(s)),
      summaryRow('calendar', 'Datum', state.date && state.step !== 'service' ? capitalize(fmt.dateLong(state.date)) : 'Zatím nevybráno', Boolean(state.date && state.step !== 'service')),
      summaryRow('clock', 'Čas', state.time && s ? `${state.time}–${endTime(state.time, s.durationMin)}` : 'Zatím nevybráno', Boolean(state.time)),
      s && s.price > 0 ? summaryRow('tag', 'Cena', fmt.price(s.price), true) : null),
    h('div', { class: 'contact' },
      business.address ? h('span', {}, icon('mapPin', 16), business.address) : null,
      business.phone ? h('a', { href: `tel:${business.phone.replace(/\s/g, '')}` }, icon('phone', 16), business.phone) : null,
      business.email ? h('a', { href: `mailto:${business.email}` }, icon('mail', 16), business.email) : null,
      h('a', { class: 'powered', href: '/', target: '_blank', rel: 'noopener' }, 'Rezervace přes ', h('b', {}, 'Slotiva'))),
  ].filter(Boolean));
}

function stepper() {
  const labels = { service: 'Služba', time: 'Termín', details: 'Údaje' };
  const current = STEPS.indexOf(state.step);
  return h('ol', { class: 'stepper' }, Object.entries(labels).map(([key, label], i) => {
    const content = [h('span', { class: 'step-num' }, i < current ? icon('check', 13) : String(i + 1)), h('span', { class: 'step-label' }, label)];
    const done = i < current;
    return h('li', { class: i === current ? 'is-active' : done ? 'is-done' : '', 'aria-current': i === current ? 'step' : null },
      done ? h('button', { type: 'button', 'aria-label': `Zpět na krok ${label}`, onClick: () => go(key) }, ...content) : content);
  }));
}

function viewService() {
  const { services } = state.config;
  const barbers=state.config.barbers||[];
  const available=barbers.length&&!state.barberId?[]:state.barberId?services.filter(s=>s.barberId===state.barberId):services;
  return h('section', { class: 'view' },
    barbers.length ? h('div',{style:{marginBottom:'18px'}},
      h('h3',{},'Vyberte barbera'),
      h('div',{class:'service-list'},barbers.map(b=>h('button',{type:'button',class:`service-card${state.barberId===b.id?' is-selected':''}`,onClick:()=>{state.barberId=b.id;state.service=null;state.date=null;state.time=null;state.availability={};render();}},b.name)))) : null,
    h('div', { class: 'panel-head' },
      h('h2', {}, 'Vyberte službu'),
      h('p', {}, 'Po výběru služby uvidíte volné termíny.')),
    available.length
      ? h('div', { class: 'service-list' }, available.map((s) => h('button', {
        type: 'button',
        class: `service-card${state.service?.id === s.id ? ' is-selected' : ''}`,
        style: { '--service-color': s.color },
        'data-focus-key': `service-${s.id}`,
        onClick: () => selectService(s),
      },
      h('div', {},
        h('div', { class: 'service-name' }, s.name),
        s.description ? h('div', { class: 'service-desc' }, s.description) : null,
        h('div', { class: 'service-meta' },
          h('span', { class: 'chip' }, icon('clock', 14), fmt.duration(s.durationMin)),
          h('span', { class: 'chip' }, icon('tag', 14), fmt.price(s.price)))),
      h('span', { class: 'service-arrow', 'aria-hidden': 'true' }, icon('chevronRight', 18)))))
      : emptyState('calendar', 'Momentálně nejsou k dispozici žádné služby.'));
}

function calendar(days) {
  const { year, month } = state.month;
  const today = state.config.today;
  const last = maxDate();
  const loadingFresh = state.loading && !days;
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

  const cells = Array.from({ length: firstWeekday }, () => h('span', { 'aria-hidden': 'true' }));
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    const count = days?.[date]?.length || 0;
    const inWindow = date >= today && date <= last;
    const classes = ['cal-day',
      count && 'has-slots',
      date === today && 'is-today',
      date === state.date && count && 'is-selected',
      loadingFresh && inWindow && 'is-loading'].filter(Boolean).join(' ');
    cells.push(h('button', {
      type: 'button',
      class: classes,
      disabled: !count,
      'aria-pressed': date === state.date ? 'true' : 'false',
      'aria-label': `${fmt.dateLong(date)}${count ? `, ${plural(count, 'volný čas', 'volné časy', 'volných časů')}` : ', bez volných termínů'}`,
      'data-focus-key': `day-${date}`,
      onClick: () => selectDate(date),
    }, String(d)));
  }

  const canPrev = monthIndex(state.month) > monthIndex(monthOf(today));
  const canNext = monthIndex(state.month) < monthIndex(monthOf(last));

  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' },
      h('div', { class: 'cal-title', 'aria-live': 'polite' }, fmt.monthYear(year, month)),
      h('div', { class: 'cal-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Předchozí měsíc', disabled: !canPrev, 'data-focus-key': 'prev', onClick: () => changeMonth(-1) }, icon('chevronLeft')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Další měsíc', disabled: !canNext, 'data-focus-key': 'next', onClick: () => changeMonth(1) }, icon('chevronRight')))),
    h('div', { class: `cal-grid${state.loading && days ? ' is-refreshing' : ''}`, role: 'group', 'aria-label': 'Výběr dne' },
      ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((d) => h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, d)),
      cells),
    h('div', { class: 'cal-legend' }, h('span', {}, h('i'), 'Den s volnými termíny')));
}

function slots(days) {
  if (state.loading && !days) {
    return h('div', { class: 'slots', 'aria-busy': 'true' },
      h('div', { class: 'slots-head' }, h('div', { class: 'slots-title' }, 'Hledám volné časy…')),
      h('div', { class: 'skeleton-slots' }, Array.from({ length: 9 }, () => h('span'))));
  }
  if (!days) return h('div', { class: 'slots' });

  const canNext = monthIndex(state.month) < monthIndex(monthOf(maxDate()));
  if (!Object.values(days).some((list) => list.length)) {
    return h('div', { class: 'slots' }, emptyState('calendar', 'V tomto měsíci už nejsou volné termíny.',
      canNext ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => changeMonth(1) }, 'Zobrazit další měsíc', icon('chevronRight', 16)) : null));
  }
  if (!state.date || !days[state.date]?.length) {
    return h('div', { class: 'slots' }, emptyState('calendar', 'Vyberte v kalendáři den, který vám vyhovuje.'));
  }

  const list = days[state.date];
  const groups = [
    ['Dopoledne', (t) => t < '12:00'],
    ['Odpoledne', (t) => t >= '12:00' && t < '17:00'],
    ['Večer', (t) => t >= '17:00'],
  ];
  return h('div', { class: 'slots' },
    h('div', { class: 'slots-head' },
      h('div', { class: 'slots-title' }, fmt.dateLong(state.date)),
      h('span', { class: 'slots-count' }, plural(list.length, 'volný čas', 'volné časy', 'volných časů'))),
    groups.map(([label, test]) => {
      const items = list.filter(test);
      if (!items.length) return null;
      return h('div', { class: 'slot-group' },
        h('h3', {}, label),
        h('div', { class: 'slot-grid' }, items.map((t) => h('button', {
          type: 'button',
          class: `slot${t === state.time ? ' is-selected' : ''}`,
          'aria-pressed': t === state.time ? 'true' : 'false',
          'data-focus-key': `slot-${t}`,
          onClick: () => selectTime(t),
        }, t))));
    }));
}

function viewTime() {
  const s = state.service;
  const days = state.availability[monthKey()];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return h('section', { class: 'view' },
    h('div', { class: 'panel-head' },
      h('h2', {}, 'Vyberte termín'),
      h('p', {}, `${s.name} · ${fmt.duration(s.durationMin)} · ${fmt.price(s.price)}`)),
    state.notice ? alertBox('warning', state.notice) : null,
    state.loadError ? alertBox('error', state.loadError,
      h('button', { type: 'button', class: 'btn btn-secondary', style: { minHeight: '34px', padding: '0 12px' }, onClick: () => loadMonth({ force: true }) }, 'Zkusit znovu')) : null,
    h('div', { class: 'picker' }, calendar(days), slots(days)),
    browserTz && browserTz !== state.config.timezone
      ? h('p', { class: 'tz-note' }, icon('globe', 14), `Časy jsou uvedené v časovém pásmu ${state.config.timezone}.`)
      : null,
    h('div', { class: 'footer-bar' },
      state.config.services.length > 1
        ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go('service') }, icon('arrowLeft', 16), 'Změnit službu')
        : h('span'),
      h('button', { type: 'button', id: 'continue', class: 'btn btn-primary', disabled: !state.time, onClick: () => go('details') },
        'Pokračovat', icon('arrowRight', 16))));
}

function viewDetails() {
  const f = state.form;
  const s = state.service;
  const { requirePhone } = state.config;

  const onInput = (name) => (event) => {
    f[name] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (state.errors[name]) {
      delete state.errors[name];
      const field = event.target.closest('.field');
      field?.classList.remove('has-error');
      field?.querySelector('.field-error')?.remove();
    }
  };

  const field = (name, label, control, { optional = false, wide = false } = {}) => h('div', { class: `field${wide ? ' span-2' : ''}${state.errors[name] ? ' has-error' : ''}` },
    h('label', { for: `f-${name}` }, label, optional ? h('span', { class: 'opt' }, ' (nepovinné)') : null),
    control,
    state.errors[name] ? h('div', { class: 'field-error', id: `e-${name}` }, state.errors[name]) : null);

  const input = (name, attrs) => h('input', {
    class: 'input',
    id: `f-${name}`,
    name,
    value: f[name],
    'aria-invalid': state.errors[name] ? 'true' : null,
    'aria-describedby': state.errors[name] ? `e-${name}` : null,
    onInput: onInput(name),
    ...attrs,
  });

  return h('section', { class: 'view' },
    h('div', { class: 'panel-head' },
      h('h2', {}, 'Vaše údaje'),
      h('p', {}, 'Už jen poslední krok – vyplňte kontakt, ať vám můžeme rezervaci potvrdit.')),
    h('div', { class: 'recap' },
      h('span', {}, icon('tag', 16), s.name),
      h('span', {}, icon('calendar', 16), capitalize(fmt.dateLong(state.date))),
      h('span', {}, icon('clock', 16), `${state.time}–${endTime(state.time, s.durationMin)}`)),
    state.submitError ? alertBox('error', state.submitError) : null,
    h('form', { id: 'booking-form', class: 'form', novalidate: true, onSubmit: submit },
      field('name', 'Jméno a příjmení', input('name', { autocomplete: 'name', maxlength: '100', required: true }), { wide: true }),
      field('email', 'E-mail', input('email', { type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: '160', required: true })),
      field('phone', 'Telefon', input('phone', { type: 'tel', autocomplete: 'tel', maxlength: '30', required: requirePhone }), { optional: !requirePhone }),
      field('note', 'Poznámka', h('textarea', {
        class: 'textarea', id: 'f-note', name: 'note', maxlength: '1000', rows: '3',
        placeholder: 'Chcete nám něco sdělit předem?', onInput: onInput('note'),
      }, f.note), { optional: true, wide: true }),
      h('input', { class: 'hp', type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
      h('div', { class: `field span-2${state.errors.consent ? ' has-error' : ''}` },
        h('label', { class: 'check', for: 'f-consent' },
          h('input', { type: 'checkbox', id: 'f-consent', checked: f.consent, onChange: onInput('consent') }),
          h('span', {}, `Souhlasím se zpracováním osobních údajů firmou ${state.config.business.name} za účelem vyřízení rezervace.`)),
        state.errors.consent ? h('div', { class: 'field-error' }, state.errors.consent) : null)),
    h('div', { class: 'footer-bar' },
      h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go('time') }, icon('arrowLeft', 16), 'Zpět'),
      h('button', { type: 'submit', form: 'booking-form', class: 'btn btn-primary', disabled: state.submitting },
        state.submitting ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('check', 16),
        state.submitting ? 'Odesílám…' : 'Potvrdit rezervaci')));
}

function viewDone() {
  const b = state.booking;
  const { business, emailsEnabled, confirmationMessage } = state.config;
  const row = (label, value) => h('div', { class: 'ticket-row' }, h('span', {}, label), h('span', {}, value));
  const copyLabel = h('span', {}, 'Kopírovat odkaz');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(b.manageUrl);
    } catch {
      // Starší prohlížeče nebo vložený rámeček bez práva na schránku
      const field = h('textarea', { style: { position: 'fixed', opacity: '0' } }, b.manageUrl);
      document.body.append(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    copyLabel.textContent = 'Odkaz zkopírován';
    setTimeout(() => { copyLabel.textContent = 'Kopírovat odkaz'; }, 2500);
  }

  return h('section', { class: 'view success' },
    h('div', { class: 'success-mark' }, icon('check', 38)),
    h('h2', {}, 'Hotovo, těšíme se na vás!'),
    h('p', {}, emailsEnabled
      ? `Rezervace je potvrzená. Shrnutí s odkazem na správu termínu jsme poslali na ${state.form.email}.`
      : 'Rezervace je potvrzená a termín máte jistý. Nic dalšího dělat nemusíte.'),
    h('div', { class: 'ticket' },
      row('Služba', b.serviceName),
      row('Datum', capitalize(b.dateLabel)),
      row('Čas', `${b.time}–${b.endTime}`),
      row('Cena', b.priceLabel),
      business.address ? row('Adresa', business.address) : null,
      row('Kód rezervace', h('span', { class: 'ticket-code' }, b.code))),
    confirmationMessage ? h('p', { class: 'success-note' }, confirmationMessage) : null,
    b.canCancel
      ? h('div', { class: 'manage-box' },
        h('div', { class: 'manage-box-text' },
          h('strong', {}, 'Nemůžete přijít?'),
          h('span', {},
            'Rezervaci si zrušíte sami jedním kliknutím, bez volání. Termín se uvolní a zmizí i z našeho kalendáře.',
            b.cancelLimitHours > 0 ? ` Zrušit jde nejpozději ${b.cancelLimitHours} h před začátkem.` : '')),
        h('div', { class: 'manage-box-actions' },
          h('a', { class: 'btn btn-primary', href: b.manageUrl, target: '_blank', rel: 'noopener' }, icon('external', 16), 'Zobrazit nebo zrušit rezervaci'),
          h('button', { type: 'button', class: 'btn btn-secondary', onClick: copyLink }, icon('link', 16), copyLabel)),
        h('p', { class: 'manage-box-hint' }, emailsEnabled
          ? 'Stejný odkaz najdete i v potvrzovacím e-mailu.'
          : 'Tip: odkaz si zkopírujte nebo tuto stránku uložte do záložek.'))
      // Termín je blíž, než dovoluje online zrušení – nabídnout kontakt místo tlačítka
      : h('div', { class: 'manage-box' },
        h('div', { class: 'manage-box-text' },
          h('strong', {}, 'Nemůžete přijít?'),
          h('span', {}, `Termín je za méně než ${b.cancelLimitHours} h, online už ho zrušit nejde. Dejte nám prosím vědět${business.phone ? ' na telefonu níže' : business.email ? ' e-mailem' : ''}, ať termín můžeme nabídnout někomu jinému.`)),
        business.phone || business.email
          ? h('div', { class: 'manage-box-actions' },
            business.phone ? h('a', { class: 'btn btn-primary', href: `tel:${business.phone.replace(/\s/g, '')}` }, icon('phone', 16), business.phone) : null,
            business.email ? h('a', { class: 'btn btn-secondary', href: `mailto:${business.email}` }, icon('mail', 16), 'Napsat e-mail') : null)
          : null),
    h('div', { style: { marginTop: '22px' } },
      h('button', { type: 'button', class: 'btn btn-ghost', onClick: reset }, 'Vytvořit další rezervaci')));
}

let lastRenderedStep = null;

function render() {
  const focusKey = document.activeElement?.dataset?.focusKey;
  renderAside();
  const view = { service: viewService, time: viewTime, details: viewDetails, done: viewDone }[state.step]();
  // Animace prolnutí jen při změně kroku – ne při každém kliknutí na den nebo čas.
  if (state.step === lastRenderedStep) view.style.animation = 'none';
  lastRenderedStep = state.step;
  $('#main').replaceChildren(...[state.step === 'done' ? null : stepper(), view].filter(Boolean));
  if (focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

async function init() {
  if (isEmbed) reportHeightToParent();
  try {
    state.config = await api(pageApi);
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'fatal' },
      h('h2', {}, 'Rezervace se nepodařilo načíst'),
      h('p', {}, err.message),
      h('p', { style: { marginTop: '16px' } }, h('button', { class: 'btn btn-secondary', onClick: () => location.reload() }, 'Načíst znovu'))));
    return;
  }

  applyBrand(state.config.brandColor);
  document.title = `Online rezervace – ${state.config.business.name}`;
  state.month = monthOf(state.config.today);

  const preselected = params.get('service') || params.get('sluzba');
  const service = state.config.services.find((s) => String(s.id) === preselected)
    || (state.config.services.length === 1 ? state.config.services[0] : null);
  if (service) { state.barberId=service.barberId||null; selectService(service); }
  else render();
}

init();

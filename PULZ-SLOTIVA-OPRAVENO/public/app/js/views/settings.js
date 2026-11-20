import { get, put, post, del } from '../api.js';
import { h, icon, field, switchControl, toast, withBusy, alertBox, openModal } from '../ui.js';

const DAYS = [[1, 'Pondělí'], [2, 'Úterý'], [3, 'Středa'], [4, 'Čtvrtek'], [5, 'Pátek'], [6, 'Sobota'], [7, 'Neděle']];
const BRAND_PRESETS = ['#0a7c80', '#9f1239', '#be185d', '#c2410c', '#15803d', '#0369a1', '#1f1d2e'];

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

function nextInterval(last) {
  if (!last) return { from: '09:00', to: '12:00' };
  const [hh, mm] = last.to.split(':').map(Number);
  const start = Math.min(hh * 60 + mm + 60, 22 * 60);
  return { from: toHHMM(start), to: toHHMM(Math.min(start + 180, 23 * 60 + 55)) };
}

export async function mount({ view, setSubtitle, app }) {
  setSubtitle('Účet, firma, otevírací doba a pravidla rezervací');
  const data = await get('/settings');
  const { slotSteps, baseUrl } = data;
  let settings = data.settings;
  let user = data.user;
  let draft = structuredClone(settings);
  let savebarVisible = null;

  const root = h('div', { class: 'settings' });
  const savebarHost = h('div');
  view.append(root, savebarHost);

  const isDirty = () => JSON.stringify(draft) !== JSON.stringify(settings);

  function refreshSavebar() {
    const dirty = isDirty();
    if (dirty === savebarVisible) return;
    savebarVisible = dirty;
    savebarHost.replaceChildren(...(dirty ? [savebar()] : []));
  }

  /** Propojí vstupní pole s hodnotou v `draft` podle cesty (např. "business.name"). */
  function bind(path, input, { number = false } = {}) {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = () => keys.reduce((obj, key) => obj[key], draft);
    const value = parent()[last];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
    input.id = input.id || `set-${path.replace(/\./g, '-')}`;
    input.dataset.field = path;
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      parent()[last] = number ? (input.value === '' ? '' : Number(input.value)) : input.value;
      input.classList.remove('is-invalid');
      refreshSavebar();
    });
    return input;
  }

  const bound = (label, path, control, options = {}) =>
    field(label, bind(path, control, options), { ...options, id: `set-${path.replace(/\./g, '-')}` });

  function numberField(label, path, suffix, { min, max, step = 1, hint }) {
    const input = bind(path, h('input', { class: 'input', type: 'number', min: String(min), max: String(max), step: String(step) }), { number: true });
    return h('div', { class: 'field' },
      h('label', { for: input.id }, label),
      h('div', { class: 'input-suffix' }, input, h('span', {}, suffix)),
      hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function switchRow(path, title, description) {
    return h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
      switchControl({ checked: draft[path], ariaLabel: title, onChange: (value) => { draft[path] = value; refreshSavebar(); } }),
      h('div', {}, h('div', { style: { fontWeight: '600' } }, title), h('div', { class: 'hint', style: { color: 'var(--ink-3)', fontSize: '13px' } }, description)));
  }

  function section(title, description, ...content) {
    return h('section', { class: 'card settings-section' },
      h('header', {}, h('h2', {}, title), h('p', {}, description)),
      h('div', { class: 'stack', style: { gap: '14px', minWidth: '0' } }, ...content.filter(Boolean)));
  }

  /* ── profil a adresa stránky ── */

  function profileSection() {
    const error = h('div');
    const name = h('input', { class: 'input', id: 'pr-name', value: user.name, maxlength: '80' });
    const email = h('input', { class: 'input', id: 'pr-email', type: 'email', value: user.email });
    const slug = h('input', { class: 'input', id: 'pr-slug', value: user.slug, maxlength: '40', spellcheck: 'false' });
    slug.addEventListener('input', () => { slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); });

    return section('Účet a adresa stránky', 'Vaše jméno, přihlašovací e-mail a adresa, na které klienti najdou rezervace.',
      error,
      h('div', { class: 'form-grid' },
        field('Jméno', name, { id: 'pr-name' }),
        field('Přihlašovací e-mail', email, { id: 'pr-email' }),
        h('div', { class: 'field span-2' },
          h('label', { for: 'pr-slug' }, 'Adresa rezervační stránky'),
          h('div', { class: 'prefix-input' }, h('span', {}, `${baseUrl.replace(/^https?:\/\//, '')}/`), slug),
          h('div', { class: 'hint' }, 'Po změně adresy přestane fungovat ta původní – nezapomeňte ji upravit i na svém webu.'))),
      h('div', {}, h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          error.replaceChildren();
          try {
            const res = await put('/profile', { name: name.value, email: email.value, slug: slug.value });
            user = res.user;
            toast('Účet uložen');
            app.refreshMeta();
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, icon('check'), 'Uložit účet')));
  }

  /* ── firma ── */

  function businessSection() {
    const picker = h('input', { type: 'color', value: draft.brandColor, 'aria-label': 'Výběr hlavní barvy' });
    const hex = h('input', { class: 'input', style: { width: '112px' }, value: draft.brandColor, maxlength: '7', 'data-field': 'brandColor', 'aria-label': 'Hlavní barva (hex)' });
    const presets = h('div', { class: 'color-picker' });

    const setColor = (value, source) => {
      draft.brandColor = value;
      if (source !== 'picker' && /^#[0-9a-f]{6}$/i.test(value)) picker.value = value;
      if (source !== 'hex') hex.value = value;
      hex.classList.remove('is-invalid');
      paintPresets();
      refreshSavebar();
    };
    const paintPresets = () => presets.replaceChildren(...BRAND_PRESETS.map((c) => h('button', {
      type: 'button',
      title: c,
      'aria-label': `Použít barvu ${c}`,
      class: c === draft.brandColor.toLowerCase() ? 'is-selected' : null,
      style: { background: c, width: '26px', height: '26px' },
      onClick: () => setColor(c),
    })));
    picker.addEventListener('input', () => setColor(picker.value, 'picker'));
    hex.addEventListener('input', () => setColor(hex.value.trim(), 'hex'));
    paintPresets();

    return section('Jak se ukazujete klientům', 'Tyhle údaje vidí klienti na vaší rezervační stránce a v e-mailech.',
      h('div', { class: 'form-grid' },
        bound('Název', 'business.name', h('input', { class: 'input', maxlength: '80' }), { wide: true }),
        bound('Podnadpis', 'business.tagline', h('input', { class: 'input', maxlength: '160' }), { wide: true, hint: 'Krátká věta pod názvem.' }),
        bound('Popis', 'business.description', h('textarea', { class: 'textarea', rows: '3', maxlength: '1000' }), { wide: true }),
        bound('Adresa', 'business.address', h('input', { class: 'input', maxlength: '200' }), { wide: true, hint: 'Objeví se i v události v kalendáři.' }),
        bound('Telefon', 'business.phone', h('input', { class: 'input', type: 'tel', maxlength: '40' })),
        bound('E-mail', 'business.email', h('input', { class: 'input', type: 'email' })),
        bound('Web', 'business.website', h('input', { class: 'input', type: 'url', placeholder: 'https://' }), { wide: true, hint: 'Na rezervační stránce se zobrazí odkaz „Zpět na web“.' }),
        h('div', { class: 'field span-2' },
          h('span', { class: 'label' }, 'Hlavní barva'),
          h('div', { class: 'color-field', style: { flexWrap: 'wrap' } }, picker, hex, presets),
          h('div', { class: 'hint' }, 'Barva tlačítek a zvýraznění na rezervační stránce.'))));
  }

  /* ── otevírací doba ── */

  function hoursSection() {
    const list = h('div', { class: 'hours' });

    const timeInput = (interval, key, label) => {
      const input = h('input', { class: 'input input-sm', type: 'time', step: '300', value: interval[key], 'aria-label': label, 'data-field': 'workingHours' });
      input.addEventListener('change', () => {
        interval[key] = input.value;
        refreshSavebar();
      });
      return input;
    };

    const paint = () => list.replaceChildren(...DAYS.map(([day, label]) => {
      const intervals = draft.workingHours[day] || [];
      return h('div', { class: 'hours-row' },
        h('div', { class: 'hours-day' }, switchControl({
          checked: intervals.length > 0,
          label,
          onChange: (open) => {
            draft.workingHours[day] = open ? [{ from: '09:00', to: '17:00' }] : [];
            paint();
            refreshSavebar();
          },
        })),
        intervals.length
          ? h('div', { class: 'hours-intervals' },
            intervals.map((interval, i) => h('div', { class: 'hours-interval' },
              timeInput(interval, 'from', `${label} od`),
              h('span', { class: 'muted' }, '–'),
              timeInput(interval, 'to', `${label} do`),
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Odebrat blok', 'aria-label': `Odebrat blok ${interval.from}–${interval.to}`,
                onClick: () => {
                  intervals.splice(i, 1);
                  paint();
                  refreshSavebar();
                },
              }, icon('x', 14)))),
            intervals.length < 6
              ? h('div', {}, h('button', {
                type: 'button',
                class: 'link-btn',
                onClick: () => {
                  intervals.push(nextInterval(intervals.at(-1)));
                  paint();
                  refreshSavebar();
                },
              }, '+ Přidat další blok'))
              : null)
          : h('div', { class: 'hours-closed' }, 'Zavřeno'));
    }));
    paint();

    return section('Otevírací doba', 'Kdy se k vám klienti mohou objednat. Pauzu na oběd uděláte dvěma bloky. Dovolenou stačí zapsat do Google Kalendáře – ten čas se zablokuje sám.',
      list,
      h('div', {}, h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        onClick: () => {
          for (const day of [2, 3, 4, 5]) draft.workingHours[day] = structuredClone(draft.workingHours[1] || []);
          paint();
          refreshSavebar();
          toast('Pondělí zkopírováno na úterý až pátek');
        },
      }, icon('copy', 14), 'Použít pondělí pro úterý–pátek')));
  }

  /* ── pravidla ── */

  function rulesSection() {
    const zones = Intl.supportedValuesOf?.('timeZone') || ['Europe/Prague'];
    const step = bind('slotStep', h('select', { class: 'select' },
      slotSteps.map((s) => h('option', { value: String(s) }, s === 0 ? 'Podle délky služby' : `Každých ${s} min`))), { number: true });

    return section('Pravidla rezervací', 'Jak daleko dopředu a s jakým předstihem se lze objednat.',
      h('div', { class: 'form-grid' },
        field('Nabízet časy', step, { id: step.id, hint: 'Jak často začínají nabízené termíny (9:00, 9:30, 10:00…).' }),
        numberField('Pauza mezi termíny', 'bufferMin', 'min', { min: 0, max: 240, step: 5, hint: 'Čas na úklid nebo přípravu mezi rezervacemi.' }),
        numberField('Minimální předstih', 'minNoticeHours', 'h', { min: 0, max: 720, hint: 'Nejkratší doba mezi rezervací a začátkem termínu.' }),
        numberField('Rezervace dopředu', 'maxAdvanceDays', 'dní', { min: 1, max: 365, hint: 'Kolik dní dopředu je kalendář otevřený.' }),
        numberField('Zrušení online', 'cancelLimitHours', 'h', { min: 0, max: 720, hint: 'Nejpozději kolik hodin před začátkem může klient sám zrušit.' }),
        bound('Časové pásmo', 'timezone', h('input', { class: 'input', list: 'tz-list', spellcheck: 'false' })),
        h('datalist', { id: 'tz-list' }, zones.map((z) => h('option', { value: z }))),
        h('div', { class: 'span-2 stack', style: { gap: '14px', marginTop: '4px' } },
          switchRow('requirePhone', 'Telefon je povinný', 'Klient musí při rezervaci vyplnit telefonní číslo.'),
          switchRow('allDayEventsBlock', 'Celodenní události v Google Kalendáři blokují celý den',
            'Hodí se pro dovolenou a svátky. Vypněte, pokud máte v kalendáři celodenní připomínky, které nemají nic blokovat.'))));
  }

  function notificationsSection() {
    return section('Upozornění a texty', 'E-maily se odesílají, jen když je na serveru nastavené SMTP.',
      app.meta.mailEnabled ? null : alertBox('info', 'E-maily jsou vypnuté', 'Rezervace fungují i bez nich. Podrobnosti najdete v sekci Kalendář a web.'),
      h('div', { class: 'form-grid' },
        bound('E-mail pro upozornění', 'notifyEmail', h('input', { class: 'input', type: 'email', placeholder: user.email }),
          { wide: true, hint: 'Sem přijde upozornění na každou novou nebo zrušenou rezervaci. Prázdné = váš přihlašovací e-mail.' }),
        bound('Text po dokončení rezervace', 'confirmationMessage', h('textarea', { class: 'textarea', rows: '3', maxlength: '1000' }),
          { wide: true, hint: 'Zobrazí se klientovi po rezervaci a v potvrzovacím e-mailu.' })));
  }

  /* ── heslo a smazání účtu ── */

  function passwordSection() {
    const error = h('div');
    const current = h('input', { class: 'input', id: 'pw-current', type: 'password', autocomplete: 'current-password' });
    const next = h('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password' });

    return section(user.hasPassword ? 'Změna hesla' : 'Nastavení hesla',
      user.hasPassword
        ? 'Po změně hesla se odhlásíte na ostatních zařízeních.'
        : 'Přihlašujete se přes Google. Můžete si nastavit i heslo pro přihlášení e-mailem.',
      error,
      h('div', { class: 'form-grid' },
        user.hasPassword ? field('Současné heslo', current, { id: 'pw-current' }) : null,
        field('Nové heslo', next, { id: 'pw-new', hint: 'Alespoň 8 znaků.' })),
      h('div', {}, h('button', {
        type: 'button',
        class: 'btn btn-secondary',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          error.replaceChildren();
          try {
            await post('/password', { currentPassword: current.value, newPassword: next.value });
            current.value = '';
            next.value = '';
            user = { ...user, hasPassword: true };
            toast('Heslo uloženo');
            render();
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, icon('check'), 'Uložit heslo')));
  }

  function deleteSection() {
    return h('section', { class: 'card settings-section danger-zone' },
      h('header', {}, h('h2', {}, 'Smazání účtu'), h('p', {}, 'Nevratně smaže účet, rezervační stránku, služby i všechny rezervace.')),
      h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', { class: 'secondary' }, 'Události, které už jsou v Google Kalendáři, zůstanou. Přístup Slotivy ke kalendáři se zruší.'),
        h('div', {}, h('button', { type: 'button', class: 'btn btn-danger', onClick: confirmDelete }, icon('trash'), 'Smazat účet'))));
  }

  function confirmDelete() {
    const m = openModal({ title: 'Opravdu smazat účet?', size: 'modal-sm' });
    const error = h('div');
    const password = h('input', { class: 'input', id: 'del-pw', type: 'password', autocomplete: 'current-password' });
    const confirmEmail = h('input', { class: 'input', id: 'del-email', placeholder: user.email, autocomplete: 'off' });
    m.body.append(
      h('p', { class: 'secondary' }, 'Všechna data budou nenávratně smazána.'),
      error,
      user.hasPassword
        ? field('Pro potvrzení zadejte heslo', password, { id: 'del-pw' })
        : field('Pro potvrzení napište svůj e-mail', confirmEmail, { id: 'del-email' }),
    );
    m.foot.append(
      h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => m.close() }, 'Zpět'),
      h('button', {
        type: 'button',
        class: 'btn btn-danger-solid',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          if (!user.hasPassword && confirmEmail.value.trim().toLowerCase() !== user.email.toLowerCase()) {
            error.replaceChildren(alertBox('warning', null, 'E-mail nesouhlasí.'));
            return;
          }
          try {
            await del('/account', { password: password.value });
            location.href = '/';
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, 'Smazat účet navždy'),
    );
  }

  /* ── ukládání nastavení ── */

  function savebar() {
    return h('div', { class: 'savebar', role: 'region', 'aria-label': 'Neuložené změny' },
      h('span', {}, 'Máte neuložené změny'),
      h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { draft = structuredClone(settings); render(); } }, 'Zahodit'),
      h('button', { type: 'button', class: 'btn btn-primary', onClick: (e) => withBusy(e.currentTarget, save) }, icon('check'), 'Uložit změny'));
  }

  async function save() {
    try {
      ({ settings } = await put('/settings', draft));
      draft = structuredClone(settings);
      render();
      toast('Nastavení uloženo');
      app.refreshMeta();
    } catch (err) {
      toast(err.message, { error: true });
      const target = err.data?.field && root.querySelector(`[data-field="${CSS.escape(err.data.field)}"]`);
      if (target) {
        target.classList.add('is-invalid');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus({ preventScroll: true });
      }
    }
  }

  function render() {
    root.replaceChildren(profileSection(), businessSection(), hoursSection(), rulesSection(), notificationsSection(), passwordSection(), deleteSection());
    savebarVisible = null;
    refreshSavebar();
  }

  const beforeUnload = (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  render();
  return { cleanup: () => window.removeEventListener('beforeunload', beforeUnload) };
}

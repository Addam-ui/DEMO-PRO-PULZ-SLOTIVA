/* Přihlášení, registrace a obnova hesla. */

const MODES = { '/prihlaseni': 'login', '/registrace': 'register', '/zapomenute-heslo': 'forgot', '/nove-heslo': 'reset' };
const mode = MODES[location.pathname.replace(/\/+$/, '')] || 'login';
const params = new URLSearchParams(location.search);
const card = document.getElementById('auth-card');
const paint = (...nodes) => card.replaceChildren(...nodes.filter(Boolean));

const GOOGLE_ERRORS = {
  zamitnuto: 'Přihlášení přes Google bylo zrušeno.',
  'google-chyba': 'Přihlášení přes Google se nepovedlo. Zkuste to prosím znovu.',
  'neplatny-pozadavek': 'Platnost přihlášení vypršela. Zkuste to prosím znovu.',
  'neovereny-email': 'E-mail u vašeho účtu Google není ověřený.',
  'registrace-vypnuta': 'Registrace nových účtů je momentálně vypnutá.',
  'google-vypnuto': 'Přihlášení přes Google není na tomto serveru zapnuté.',
  'bez-tokenu': 'Google nevrátil potřebná oprávnění. Zkuste to prosím znovu.',
  'ucet-zablokovan': 'Tento účet je zablokovaný. Ozvěte se prosím správci.',
};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value; // jen statické ikony
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const GOOGLE_ICON = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

async function api(path, body) {
  const res = await fetch(`/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) throw Object.assign(new Error('Nepodařilo se spojit se serverem.'), { data: {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Něco se pokazilo. Zkuste to prosím znovu.'), { data });
  return data;
}

const slugify = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');

function field(name, label, input, { extra, hint } = {}) {
  input.id = `f-${name}`;
  input.name = name;
  return h('div', { class: 'field', 'data-field': name },
    h('label', { for: input.id }, label, extra || null),
    input,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

function showErrors(form, err) {
  form.querySelectorAll('.field-error').forEach((el) => el.remove());
  form.querySelectorAll('.field.has-error').forEach((el) => el.classList.remove('has-error'));
  const box = form.querySelector('[data-alert]');
  const target = err.data?.field && form.querySelector(`[data-field="${err.data.field}"]`);
  if (target) {
    target.classList.add('has-error');
    target.append(h('div', { class: 'field-error', role: 'alert' }, err.message));
    target.querySelector('input')?.focus();
    box.replaceChildren();
  } else {
    box.replaceChildren(h('div', { class: 'alert alert-error', role: 'alert' }, err.message));
  }
}

async function submitting(form, fn) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  try {
    await fn();
  } catch (err) {
    showErrors(form, err);
    button.disabled = false;
    button.replaceChildren(label);
  }
}

function googleButton(text) {
  return h('a', { class: 'btn btn-google btn-block btn-lg', href: '/auth/google/start' }, h('span', { html: GOOGLE_ICON, style: 'display:inline-flex' }), text);
}

function renderLogin(session) {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, autofocus: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const error = GOOGLE_ERRORS[params.get('chyba')];
  const form = h('form', {
    class: 'auth-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      submitting(form, async () => {
        await api('/login', { email: email.value, password: password.value });
        location.href = '/app/';
      });
    },
  },
  h('div', { 'data-alert': '' }, error ? h('div', { class: 'alert alert-error', role: 'alert' }, error) : null),
  field('email', 'E-mail', email),
  field('password', 'Heslo', password, { extra: session.passwordReset ? h('a', { href: '/zapomenute-heslo' }, 'Zapomenuté heslo?') : null }),
  h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Přihlásit se'));

  paint(
    h('h1', {}, 'Vítejte zpět'),
    h('p', { class: 'sub' }, 'Přihlaste se ke svému účtu Slotiva.'),
    session.googleLogin ? h('div', { class: 'auth-form' }, googleButton('Pokračovat přes Google'), h('div', { class: 'divider' }, 'nebo e-mailem')) : null,
    form,
    session.registration ? h('p', { class: 'auth-switch' }, 'Nemáte účet? ', h('a', { href: '/registrace' }, 'Zaregistrujte se zdarma')) : null,
  );
}

function renderRegister(session) {
  if (!session.registration) {
    paint(h('h1', {}, 'Registrace je vypnutá'), h('p', { class: 'sub' }, 'Nové účty teď nelze vytvářet.'), h('a', { class: 'btn btn-primary', href: '/prihlaseni' }, 'Přihlásit se'));
    return;
  }
  const name = h('input', { class: 'input', autocomplete: 'name', required: true, maxlength: '80', autofocus: true, placeholder: 'Např. Jana Nováková nebo Studio Krása' });
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const slug = h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'vase-jmeno' });
  const honeypot = h('input', { class: 'hp', type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  let slugTouched = false;
  name.addEventListener('input', () => {
    if (!slugTouched) slug.value = slugify(name.value);
  });
  slug.addEventListener('input', () => {
    slugTouched = true;
    slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  });

  const slugField = field('slug', 'Adresa vaší rezervační stránky', slug, { hint: 'Můžete ji kdykoliv změnit v nastavení.' });
  const slugPrefix = h('div', { class: 'input-prefix' }, h('span', {}, `${location.host}/`));
  slug.replaceWith(slugPrefix); // vstup se přesune dovnitř rámečku s adresou
  slugPrefix.append(slug);

  const connectCalendar = h('input', { type: 'checkbox', checked: true });
  const calendarChoice = session.googleLogin
    ? h('label', { class: 'check-line' },
      connectCalendar,
      h('span', {}, h('b', {}, 'Rovnou připojit Google Kalendář'), h('em', {}, 'Hned po registraci vás přesměrujeme ke Googlu. Rezervace se pak budou samy zapisovat do kalendáře.')))
    : null;

  const form = h('form', {
    class: 'auth-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      submitting(form, async () => {
        await api('/register', { name: name.value, email: email.value, password: password.value, slug: slug.value, website: honeypot.value });
        location.href = session.googleLogin && connectCalendar.checked
          ? '/auth/google/start?intent=connect&vitejte=1'
          : '/app/?vitejte=1';
      });
    },
  },
  h('div', { 'data-alert': '' }),
  field('name', 'Jméno nebo název firmy', name),
  field('email', 'E-mail', email),
  field('password', 'Heslo', password, { hint: 'Alespoň 8 znaků.' }),
  slugField,
  calendarChoice,
  honeypot,
  h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Vytvořit účet'));

  paint(
    h('h1', {}, 'Vytvořte si účet'),
    h('p', { class: 'sub' }, 'Za minutu budete mít vlastní rezervační stránku.'),
    session.googleLogin
      ? h('div', { class: 'auth-form' }, googleButton('Registrovat přes Google'), h('p', { class: 'hint', style: 'text-align:center;margin-top:-6px' }, 'Rovnou se připojí i váš Google Kalendář.'), h('div', { class: 'divider' }, 'nebo e-mailem'))
      : null,
    form,
    h('p', { class: 'legal' }, 'Vytvořením účtu souhlasíte s ', h('a', { href: '/podminky' }, 'podmínkami používání'), ' a berete na vědomí ', h('a', { href: '/ochrana-osobnich-udaju' }, 'zpracování osobních údajů'), '.'),
    h('p', { class: 'auth-switch' }, 'Už máte účet? ', h('a', { href: '/prihlaseni' }, 'Přihlaste se')),
  );
}

function renderForgot(session) {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, autofocus: true });
  const form = h('form', {
    class: 'auth-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      submitting(form, async () => {
        await api('/forgot-password', { email: email.value });
        paint(
          h('h1', {}, 'Zkontrolujte e-mail'),
          h('p', { class: 'sub' }, `Pokud k adrese ${email.value} existuje účet, poslali jsme na ni odkaz pro nastavení nového hesla. Odkaz platí hodinu.`),
          h('a', { class: 'btn btn-ghost btn-block btn-lg', href: '/prihlaseni' }, 'Zpět na přihlášení'),
        );
      });
    },
  },
  h('div', { 'data-alert': '' }),
  field('email', 'E-mail', email),
  h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Poslat odkaz'));

  paint(
    h('h1', {}, 'Zapomenuté heslo'),
    h('p', { class: 'sub' }, 'Pošleme vám odkaz pro nastavení nového hesla.'),
    session.passwordReset
      ? form
      : h('div', { class: 'alert alert-info' }, 'Obnova hesla e-mailem není na tomto serveru zapnutá. Pokud se přihlašujete přes Google, použijte na přihlašovací stránce tlačítko „Pokračovat přes Google“.'),
    h('p', { class: 'auth-switch' }, h('a', { href: '/prihlaseni' }, 'Zpět na přihlášení')),
  );
}

function renderReset() {
  const token = params.get('token') || '';
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', autofocus: true });
  const confirm = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const form = h('form', {
    class: 'auth-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      submitting(form, async () => {
        if (password.value !== confirm.value) throw Object.assign(new Error('Hesla se neshodují.'), { data: { field: 'confirm' } });
        await api('/reset-password', { token, password: password.value });
        location.href = '/app/';
      });
    },
  },
  h('div', { 'data-alert': '' }, token ? null : h('div', { class: 'alert alert-error' }, 'V odkazu chybí token. Otevřete prosím odkaz z e-mailu znovu.')),
  field('password', 'Nové heslo', password, { hint: 'Alespoň 8 znaků.' }),
  field('confirm', 'Nové heslo znovu', confirm),
  h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', disabled: !token }, 'Uložit heslo a přihlásit se'));

  paint(h('h1', {}, 'Nastavte si nové heslo'), h('p', { class: 'sub' }, 'Po uložení vás rovnou přihlásíme.'), form);
}

(async () => {
  const titles = { login: 'Přihlášení', register: 'Registrace', forgot: 'Zapomenuté heslo', reset: 'Nové heslo' };
  document.title = `${titles[mode]} – Slotiva`;
  let session;
  try {
    session = await api('/session');
  } catch (err) {
    paint(h('div', { class: 'alert alert-error' }, err.message));
    return;
  }
  if (session.authenticated && (mode === 'login' || mode === 'register')) {
    location.replace('/app/');
    return;
  }
  ({ login: renderLogin, register: renderRegister, forgot: renderForgot, reset: renderReset })[mode](session);
})();

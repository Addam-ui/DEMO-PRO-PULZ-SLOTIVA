import { get, post, put, del } from '../api.js';
import { h, icon, fmt, alertBox, copyText, withBusy, toast, confirmDialog, googleMark, GOOGLE_CONNECT_URL } from '../ui.js';
import { isInstalled, isApple, isMobile, canInstall, install } from '../pwa.js';

function syncSummary(r) {
  const parts = [];
  if (r.pushed) parts.push(`${r.pushed}× zapsáno do kalendáře`);
  if (r.moved) parts.push(`${r.moved}× přesunuto podle kalendáře`);
  if (r.cancelled) parts.push(`${r.cancelled}× zrušeno v kalendáři`);
  if (r.failed) parts.push(`${r.failed}× se zápis nepovedl`);
  return parts.length ? parts.join(', ') : 'vše je v pořádku';
}

function codeBlock(code) {
  return h('div', { class: 'code-block' },
    h('pre', {}, h('code', {}, code)),
    h('button', { type: 'button', class: 'btn btn-sm', onClick: () => copyText(code, 'Kód zkopírován') }, icon('copy', 14), 'Kopírovat'));
}

function statusHead(tone, iconName, title, subtitle, badge) {
  const style = tone === 'neutral' ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' } : null;
  return h('div', { class: 'status-line' },
    h('div', { class: `status-icon ${tone}`, style }, iconName === 'google' ? googleMark() : icon(iconName, 20)),
    h('div', { style: { minWidth: '0' } }, h('h2', { class: 'card-title' }, title), subtitle ? h('div', { class: 'card-sub' }, subtitle) : null),
    badge || null);
}

export async function mount({ view, setSubtitle, app }) {
  setSubtitle('Google Kalendář, e-maily a vložení rezervací na váš web');
  const root = h('div', { class: 'integration' });
  view.append(root);

  const [integration, googleData] = await Promise.all([get('/integration'), get('/google')]);
  let google = googleData;

  const run = (target, fn) => (event) => withBusy(event.currentTarget, async () => {
    try {
      target.replaceChildren(await fn());
    } catch (err) {
      target.replaceChildren(alertBox('critical', 'Akce selhala', err.message));
    }
  });

  async function reloadGoogle() {
    google = await get('/google');
    app.refreshMeta();
    render();
  }

  /* ── Google Kalendář ── */

  function connectPanel(title, text) {
    return h('div', { class: 'gconnect' },
      h('div', {},
        h('h3', {}, title),
        h('p', { class: 'secondary', style: { marginTop: '6px' } }, text),
        h('ul', {},
          h('li', {}, icon('check', 16), 'Rezervace se zapíšou do kalendáře samy'),
          h('li', {}, icon('check', 16), 'Obsazené časy se klientům vůbec nenabídnou'),
          h('li', {}, icon('check', 16), 'Změny v kalendáři se propíšou zpět do Slotivy'))),
      h('div', { class: 'stack', style: { gap: '10px', alignItems: 'center' } },
        h('a', { class: 'btn btn-google', href: GOOGLE_CONNECT_URL }, googleMark(), 'Připojit Google Kalendář'),
        h('p', { class: 'muted', style: { fontSize: '12px', maxWidth: '220px', textAlign: 'center' } }, 'Přístup můžete kdykoliv zrušit tady nebo v účtu Google.'),
        // Z aplikace na ploše iPhonu otevře Apple přihlášení Googlu v Safari a návrat zpět se nedokončí.
        isInstalled() && isApple()
          ? h('p', { class: 'muted', style: { fontSize: '12px', maxWidth: '220px', textAlign: 'center' } }, 'Na iPhonu kalendář připojte v Safari, ne v aplikaci na ploše.')
          : null));
  }

  function calendarPicker() {
    const writable = google.calendars.filter((c) => c.canWrite);
    const select = h('select', { class: 'select', id: 'cal-main' },
      writable.map((c) => h('option', { value: c.id, selected: c.id === google.calendarId }, c.primary ? `${c.name} (hlavní)` : c.name)));
    const busyBox = h('div', { class: 'cal-options' });
    const result = h('div');

    const paintBusy = () => busyBox.replaceChildren(...google.calendars
      .filter((c) => c.id !== select.value)
      .map((c) => h('label', { class: 'cal-option' },
        h('input', { type: 'checkbox', value: c.id, checked: google.busyCalendarIds.includes(c.id) }),
        c.color ? h('span', { class: 'swatch', style: { background: c.color } }) : null,
        h('span', {}, c.name),
        c.canWrite ? null : h('small', {}, 'jen čtení'))));
    select.addEventListener('change', paintBusy);
    paintBusy();

    return h('div', { class: 'stack', style: { gap: '14px' } },
      h('div', { class: 'field' },
        h('label', { for: 'cal-main' }, 'Kalendář pro rezervace'),
        select,
        h('div', { class: 'hint' }, 'Sem se zapisují nové rezervace. Při změně se budoucí rezervace přesunou do nového kalendáře.')),
      google.calendars.length > 1
        ? h('div', { class: 'field' },
          h('span', { class: 'label' }, 'Kontrolovat obsazenost i v těchto kalendářích'),
          busyBox,
          h('div', { class: 'hint' }, 'Události v zaškrtnutých kalendářích zablokují čas, ale rezervace se do nich nezapisují.'))
        : null,
      h('div', {}, h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: run(result, async () => {
          const busyCalendarIds = [...busyBox.querySelectorAll('input:checked')].map((i) => i.value);
          await put('/google/calendars', { calendarId: select.value, busyCalendarIds });
          await reloadGoogle();
          toast('Výběr kalendářů uložen');
          return alertBox('good', 'Uloženo', 'Rezervace se budou zapisovat do vybraného kalendáře.');
        }),
      }, icon('check'), 'Uložit výběr kalendářů')),
      result);
  }

  function googleCard() {
    const result = h('div');
    const card = h('section', { class: 'card card-pad stack' });

    if (google.state === 'unavailable') {
      card.append(
        statusHead('warning', 'cloudOff', 'Připojení Google Kalendáře není na serveru zapnuté',
          'Správce Slotivy musí v souboru .env vyplnit GOOGLE_CLIENT_ID a GOOGLE_CLIENT_SECRET (návod je v README.md).'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Adresa pro přesměrování'), h('dd', {},
          h('code', {}, google.redirectUri), ' ',
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Kopírovat', 'aria-label': 'Kopírovat adresu', onClick: () => copyText(google.redirectUri) }, icon('copy', 14)))),
      );
      return card;
    }

    if (google.state === 'disconnected') {
      card.append(
        statusHead('neutral', 'google', 'Google Kalendář', 'Zatím není připojený – rezervace se ukládají jen do Slotivy.'),
        connectPanel('Připojte svůj Google Kalendář', 'Jedno kliknutí a souhlas v účtu Google. Potom se rezervace zapisují samy.'),
      );
      return card;
    }

    if (google.state === 'revoked' || google.state === 'noscope') {
      card.append(
        statusHead('critical', 'alert', 'Google Kalendář je odpojený', google.error || 'Přístup ke kalendáři vypršel nebo byl zrušen.'),
        connectPanel('Připojte kalendář znovu', google.state === 'noscope'
          ? 'Při přihlášení nebylo povolené oprávnění ke kalendáři. Zkuste to prosím znovu a zaškrtněte přístup ke kalendáři.'
          : 'Rezervace zatím fungují, ale nezapisují se do kalendáře. Po připojení se dopíšou automaticky.'),
      );
      return card;
    }

    const last = google.lastSync;
    card.append(
      statusHead('good', 'calendarCheck', `Připojeno k účtu ${google.email}`,
        'Rezervace se zapisují automaticky. Změny provedené v kalendáři se do Slotivy promítnou do 5 minut.'),
      google.error ? alertBox('critical', 'Poslední akce hlásila chybu', google.error) : null,
      google.calendarsError ? alertBox('warning', 'Seznam kalendářů se nepodařilo načíst', google.calendarsError) : null,
      google.calendars.length ? calendarPicker() : null,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Poslední synchronizace'), h('dd', {}, last
          ? `${fmt.datetime(last.at)} · ${last.ok ? syncSummary(last) : `chyba: ${last.error}`}`
          : h('span', { class: 'muted' }, 'zatím neproběhla')),
        h('dt', {}, 'Čeká na zápis'), h('dd', {}, google.pending ? `${google.pending} rezervací` : 'nic')),
      h('div', { class: 'input-group', style: { flexWrap: 'wrap' } },
        h('button', {
          type: 'button', class: 'btn btn-secondary',
          onClick: run(result, async () => {
            const r = await post('/google/check');
            return r.ok
              ? alertBox('good', `Spojení funguje – kalendář „${r.calendarName}“`, `Časové pásmo kalendáře: ${r.calendarTimeZone}`)
              : alertBox('critical', 'Spojení selhalo', r.error);
          }),
        }, icon('refresh'), 'Otestovat připojení'),
        h('button', {
          type: 'button', class: 'btn btn-secondary',
          onClick: run(result, async () => {
            const r = await post('/google/test-write');
            return r.ok
              ? alertBox('good', 'Zápis do kalendáře funguje', 'Testovací událost se vytvořila a hned zase smazala.')
              : alertBox('critical', 'Zápis selhal', r.error);
          }),
        }, icon('edit'), 'Otestovat zápis'),
        h('button', {
          type: 'button', class: 'btn btn-secondary',
          onClick: run(result, async () => {
            const r = await post('/google/sync');
            await reloadGoogle();
            return r.ok ? alertBox('good', 'Synchronizace dokončena', syncSummary(r)) : alertBox('critical', 'Synchronizace selhala', r.error);
          }),
        }, icon('calendarCheck'), 'Synchronizovat teď'),
        h('button', {
          type: 'button', class: 'btn btn-danger', style: { marginLeft: 'auto' },
          onClick: async () => {
            const confirmed = await confirmDialog({
              title: 'Odpojit Google Kalendář?',
              message: 'Rezervace zůstanou ve Slotivě, ale přestanou se zapisovat do kalendáře a nebude se kontrolovat obsazenost. Události, které už v kalendáři jsou, zůstanou.',
              confirmLabel: 'Odpojit',
              danger: true,
            });
            if (!confirmed) return;
            await del('/google').catch((err) => toast(err.message, { error: true }));
            await reloadGoogle();
            toast('Google Kalendář odpojen');
          },
        }, icon('unlink'), 'Odpojit')),
      result,
    );
    return card;
  }

  /* ── e-maily ── */

  function mailCard() {
    const m = integration.mail;
    const result = h('div');
    return h('section', { class: 'card card-pad stack' },
      statusHead(m.enabled ? 'good' : 'warning', 'mail',
        m.enabled ? 'E-maily jsou zapnuté' : 'E-maily jsou vypnuté',
        m.enabled
          ? 'Klientům chodí potvrzení rezervace, vám upozornění na nové a zrušené rezervace.'
          : 'Rezervace fungují i bez nich – jen klientům neodejde potvrzení a vám upozornění.'),
      h('dl', { class: 'kv' }, h('dt', {}, 'Upozornění chodí na'), h('dd', {}, m.notifyEmail)),
      m.enabled
        ? h('div', {}, h('button', {
          type: 'button', class: 'btn btn-secondary',
          onClick: run(result, async () => {
            const r = await post('/mail/test');
            return r.ok ? alertBox('good', 'Testovací e-mail odeslán', `Zkontrolujte schránku ${r.to}.`) : alertBox('critical', 'Odeslání selhalo', r.error);
          }),
        }, icon('send'), 'Poslat testovací e-mail'))
        : h('p', { class: 'muted' }, 'Zapíná je správce serveru vyplněním SMTP údajů v souboru .env (viz README.md).'),
      result);
  }

  /* ── aplikace v telefonu ── */

  function phoneCard() {
    const appUrl = `${integration.baseUrl}/app/`;

    if (isInstalled()) {
      return h('section', { class: 'card card-pad stack' },
        statusHead('good', 'mobile', 'Slotiva běží jako aplikace',
          'Máte ji na ploše zařízení a otevírá se na celou obrazovku. Přihlášení zůstává, stačí klepnout na ikonu.'));
    }

    const steps = isApple()
      ? ['Otevřete tuto stránku na iPhonu v Safari – v jiném prohlížeči to nejde.',
        'Klepněte dole uprostřed na ikonu Sdílet.',
        'Sjeďte níž a vyberte „Přidat na plochu“.']
      : ['Otevřete tuto stránku v telefonu v Chromu.',
        'Klepněte na tři tečky vpravo nahoře.',
        'Vyberte „Přidat na plochu“ nebo „Nainstalovat aplikaci“.'];

    return h('section', { class: 'card card-pad stack' },
      statusHead('neutral', 'mobile', 'Slotiva v telefonu',
        'Přidejte si Slotivu na plochu. Otevře se jako aplikace bez adresního řádku a zůstanete v ní přihlášení.'),
      canInstall()
        ? h('div', {}, h('button', {
          type: 'button', class: 'btn btn-primary',
          onClick: async (e) => withBusy(e.currentTarget, async () => {
            const outcome = await install();
            if (outcome === 'accepted') toast('Hotovo – Slotiva je na ploše');
          }),
        }, icon('download'), 'Přidat na plochu'))
        : null,
      h('div', { class: 'field' },
        h('span', { class: 'label' }, canInstall() ? 'Nebo ručně' : 'Jak na to'),
        h('ol', { class: 'install-steps' }, steps.map((step) => h('li', {}, step)))),
      isMobile()
        ? null
        : h('div', { class: 'field' },
          h('span', { class: 'label' }, 'Adresa pro telefon'),
          h('div', { class: 'copy-field' },
            h('input', { class: 'input', readonly: true, value: appUrl, 'aria-label': 'Adresa dashboardu', onFocus: (e) => e.target.select() }),
            h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => copyText(appUrl, 'Adresa zkopírována') }, icon('copy'), 'Kopírovat')),
          h('div', { class: 'hint' }, 'Otevřete ji v telefonu a přihlaste se, pak přidejte na plochu.')),
      alertBox('info', null, 'Aplikace potřebuje internet – rezervace se vždy načítají ze serveru. Bez signálu se sice otevře, ale přehled nenačte.'));
  }

  /* ── vložení na web ── */

  function embedCard() {
    const { baseUrl, slug, bookingUrl } = integration;
    const color = app.meta.brandColor;
    let serviceId = '';
    const select = h('select', { class: 'select', id: 'embed-service', style: { width: 'auto', minWidth: '240px' } },
      h('option', { value: '' }, 'Žádná – klient si vybere sám'),
      integration.services.map((s) => h('option', { value: String(s.id) }, s.name)));
    const snippets = h('div', { class: 'stack', style: { gap: '24px' } });

    const option = (title, description, content, preview) => h('div', { class: 'stack', style: { gap: '10px' } },
      h('div', {}, h('h3', { class: 'card-title' }, title), h('div', { class: 'card-sub' }, description)),
      preview ? h('div', { class: 'embed-option' }, content, h('div', { class: 'preview-box' }, preview)) : content);

    function paint() {
      const attr = serviceId ? ` data-service="${serviceId}"` : '';
      const url = serviceId ? `${bookingUrl}?service=${serviceId}` : bookingUrl;
      const buttonCss = `display:inline-block;padding:12px 22px;border-radius:999px;background:${color};color:#fff;font:600 15px/1.2 system-ui,sans-serif;text-decoration:none`;

      snippets.replaceChildren(
        option('1. Odkaz na rezervační stránku', 'Nejjednodušší varianta – pošlete ho klientům, dejte na Instagram, Facebook nebo do profilu Firmy na Googlu.',
          h('div', { class: 'copy-field' },
            h('input', { class: 'input', readonly: true, value: url, 'aria-label': 'Odkaz na rezervace', onFocus: (e) => e.target.select() }),
            h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => copyText(url, 'Odkaz zkopírován') }, icon('copy'), 'Kopírovat'),
            h('a', { class: 'btn btn-secondary', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Otevřít'))),
        option('2. Tlačítko s přesměrováním', 'Tlačítko na vašem webu, které klienta pošle na rezervační stránku.',
          codeBlock(`<a href="${url}" style="${buttonCss}">Rezervovat termín</a>`),
          h('a', {
            href: url, target: '_blank', rel: 'noopener',
            style: { display: 'inline-block', padding: '12px 22px', borderRadius: '999px', background: color, color: '#fff', font: '600 15px/1.2 system-ui, sans-serif', textDecoration: 'none' },
          }, 'Rezervovat termín')),
        option('3. Formulář přímo ve stránce', 'Rezervace se zobrazí uvnitř vašeho webu, výška se přizpůsobí obsahu.',
          codeBlock(`<div data-slotiva="${slug}"${attr}></div>\n<script src="${baseUrl}/widget.js" async></script>`)),
        option('4. Vyskakovací okno', 'Libovolné tlačítko na webu otevře rezervaci v okně nad stránkou.',
          codeBlock(`<button type="button" data-slotiva-open="${slug}"${attr}>Rezervovat termín</button>\n<script src="${baseUrl}/widget.js" async></script>`)),
        option('5. Plovoucí tlačítko', 'Tlačítko „Rezervovat termín“ vpravo dole na každé stránce webu.',
          codeBlock(`<script src="${baseUrl}/widget.js" data-slotiva-user="${slug}" data-floating-button="Rezervovat termín" data-color="${color}"${attr} async></script>`)),
      );
    }
    select.addEventListener('change', () => {
      serviceId = select.value;
      paint();
    });
    paint();

    return h('section', { class: 'card card-pad stack', style: { gap: '20px' } },
      statusHead('neutral', 'code', 'Rezervace na vašem webu',
        'Vyberte způsob, zkopírujte kód a vložte ho na web. Funguje s WordPressem (blok „Vlastní HTML“), Wixem, Webnode i ručně psaným webem.'),
      h('div', { class: 'input-group', style: { flexWrap: 'wrap', gap: '10px' } },
        h('label', { class: 'label', for: 'embed-service' }, 'Předvybraná služba'),
        select,
        h('a', { class: 'btn btn-ghost', href: `/ukazka-webu?u=${slug}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Ukázkový web se všemi variantami')),
      snippets,
      integration.embedOrigins.includes('*')
        ? alertBox('info', null, 'Vkládání je povolené na jakémkoliv webu. Správce serveru to může omezit proměnnou ALLOWED_EMBED_ORIGINS.')
        : alertBox('info', null, `Vkládání je povolené jen na: ${integration.embedOrigins.join(', ')}`));
  }

  function render() {
    root.replaceChildren(googleCard(), mailCard(), phoneCard(), embedCard());
  }

  render();
  // Když prohlížeč nabídne přidání na plochu (nebo se aplikace nainstaluje), karta se překreslí.
  const onPwaChange = () => render();
  window.addEventListener('pwa:change', onPwaChange);
  return { cleanup: () => window.removeEventListener('pwa:change', onPwaChange) };
}

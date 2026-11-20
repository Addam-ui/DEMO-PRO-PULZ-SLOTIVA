/* Ukázkový web: ukazuje, jak rezervace vypadají vložené na cizí stránce.
   Adresa rezervační stránky se bere z ?u=, jinak z nastavení serveru (DEMO_SLUG)
   a nakonec z účtu právě přihlášeného uživatele. */
(function () {
  var priceFormat = new Intl.NumberFormat('cs-CZ');
  var clean = function (value) { return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, ''); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function json(url) {
    return fetch(url).then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); });
  }

  function resolveSlug() {
    var fromQuery = clean(new URLSearchParams(location.search).get('u'));
    if (fromQuery) return Promise.resolve(fromQuery);
    return json('/api/public/site')
      .then(function (site) { return clean(site.demoSlug); })
      .catch(function () { return ''; })
      .then(function (slug) {
        if (slug) return slug;
        return json('/api/auth/session')
          .then(function (s) { return s.authenticated ? clean(s.user.slug) : ''; })
          .catch(function () { return ''; });
      });
  }

  function missing() {
    var box = document.querySelector('[data-demo-services]');
    box.replaceChildren();
    var note = el('p', null, 'Ukázka potřebuje vědět, kterou rezervační stránku má zobrazit. Přihlaste se a otevřete ji z dashboardu (Kalendář a web), nebo doplňte adresu do odkazu, například /ukazka-webu?u=vase-adresa.');
    box.appendChild(note);
    document.querySelectorAll('[data-demo-link]').forEach(function (node) { node.href = '/registrace'; });
  }

  function start(slug) {
    document.querySelectorAll('[data-slotiva]').forEach(function (node) { node.setAttribute('data-slotiva', slug); });
    document.querySelectorAll('[data-slotiva-open]').forEach(function (node) { node.setAttribute('data-slotiva-open', slug); });
    document.querySelectorAll('[data-demo-link]').forEach(function (node) { node.href = '/' + slug; });
    document.querySelectorAll('[data-demo-slug]').forEach(function (node) { node.textContent = '/' + slug; });

    var widget = document.createElement('script');
    widget.src = '/widget.js';
    widget.async = true;
    widget.setAttribute('data-slotiva-user', slug);
    widget.setAttribute('data-floating-button', 'Rezervovat termín');
    widget.setAttribute('data-color', '#2b211b');
    document.body.appendChild(widget);

    json('/api/public/pages/' + encodeURIComponent(slug))
      .then(function (page) {
        document.title = page.business.name + ' – ukázkový web s rezervacemi';
        document.querySelectorAll('[data-demo-name]').forEach(function (node) { node.textContent = page.business.name; });
        var box = document.querySelector('[data-demo-services]');
        box.replaceChildren();
        page.services.slice(0, 6).forEach(function (service) {
          var card = el('article', 'service');
          card.appendChild(el('h3', null, service.name));
          card.appendChild(el('p', null, service.description || ''));
          card.appendChild(el('span', 'price', service.durationMin + ' min · ' + (service.price > 0 ? priceFormat.format(service.price) + ' Kč' : 'zdarma')));
          var button = el('button', 'btn btn-dark', 'Rezervovat');
          button.setAttribute('data-slotiva-open', slug);
          button.setAttribute('data-service', String(service.id));
          card.appendChild(button);
          box.appendChild(card);
        });
      })
      .catch(function () {
        var box = document.querySelector('[data-demo-services]');
        box.replaceChildren(el('p', null, 'Rezervační stránka /' + slug + ' neexistuje nebo zatím nemá žádné služby.'));
      });
  }

  resolveSlug().then(function (slug) { return slug ? start(slug) : missing(); });
})();

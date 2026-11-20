/* Doplní do právních stránek údaje provozovatele z nastavení serveru (.env),
   aby se kvůli změně adresy nebo IČO nemuselo sahat do HTML. */
(function () {
  var fill = function (selector, value, asLink) {
    if (!value) return;
    document.querySelectorAll(selector).forEach(function (node) {
      node.textContent = value;
      if (asLink && node.tagName === 'A') node.setAttribute('href', 'mailto:' + value);
    });
  };

  fill('[data-host]', location.host);

  fetch('/api/public/operator')
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (o) {
      fill('[data-operator-name]', o.name);
      fill('[data-operator-address]', o.address);
      fill('[data-operator-id]', o.id);
      fill('[data-operator-email]', o.email, true);
      fill('[data-hosting]', o.hosting);
      fill('[data-pricing]', o.pricing);
      fill('[data-updated]', o.updated);
      if (o.name) {
        document.querySelectorAll('.legal-box').forEach(function (box) { box.classList.remove('is-todo'); });
      }
    })
    .catch(function () { /* stránka zůstane s výchozím textem */ });
})();

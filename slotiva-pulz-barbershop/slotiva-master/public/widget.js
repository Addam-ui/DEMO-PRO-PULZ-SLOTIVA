/*!
 * Slotiva widget – vloží online rezervace na libovolný web.
 *
 * Vložený formulář:     <div data-slotiva="vase-adresa"></div>
 * Vyskakovací okno:     <button data-slotiva-open="vase-adresa">Rezervovat</button>
 * Plovoucí tlačítko:    <script src=".../widget.js" data-slotiva-user="vase-adresa" data-floating-button="Rezervovat termín" async></script>
 * Předvybraná služba:   data-service="ID" (u kteréhokoliv z prvků výše)
 * Barva tlačítka:       data-color="#0a7c80" (na <script>)
 * Událost po rezervaci: window.addEventListener('slotiva:booked', (e) => console.log(e.detail))
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var list = document.querySelectorAll('script[src*="widget.js"]');
    return list[list.length - 1];
  })();
  if (!script || window.Slotiva) return;

  var ORIGIN = new URL(script.src, location.href).origin;
  var DEFAULT_USER = script.getAttribute('data-slotiva-user') || '';
  var COLOR = script.getAttribute('data-color') || '#0a7c80';
  var frames = [];
  var overlay = null;
  var popupFrame = null;
  var lastFocus = null;

  var CSS = [
    '.slotiva-frame{display:block;width:100%;min-height:420px;border:0;background:transparent;color-scheme:light;transition:height .2s ease}',
    '.slotiva-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,18,43,.55);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s}',
    '.slotiva-overlay.slotiva-open{opacity:1;visibility:visible}',
    '.slotiva-modal{position:relative;width:100%;max-width:1080px;height:min(880px,100%);background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(20,18,43,.6);transform:translateY(14px) scale(.985);transition:transform .25s ease}',
    '.slotiva-overlay.slotiva-open .slotiva-modal{transform:none}',
    '.slotiva-modal iframe{display:block;width:100%;height:100%;border:0}',
    '.slotiva-close{position:absolute;top:14px;right:14px;z-index:2;width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 2px 12px rgba(0,0,0,.16);color:#14122b;cursor:pointer}',
    '.slotiva-close:hover{background:#fff}',
    '.slotiva-lock,.slotiva-lock body{overflow:hidden!important}',
    '.slotiva-fab{position:fixed;right:22px;bottom:22px;z-index:2147482000;display:inline-flex;align-items:center;gap:10px;padding:14px 22px 14px 18px;border:0;border-radius:999px;background:' + COLOR + ';color:#fff;font:650 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 14px 34px -12px rgba(20,18,43,.55);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}',
    '.slotiva-fab:hover{transform:translateY(-2px);box-shadow:0 18px 40px -12px rgba(20,18,43,.6)}',
    '@media (max-width:640px){.slotiva-overlay{padding:0}.slotiva-modal{height:100%;border-radius:0}.slotiva-fab{right:14px;bottom:14px;padding:13px 18px 13px 15px}}',
  ].join('');

  var ICON_CALENDAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
  var ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function bookingUrl(user, options) {
    var params = new URLSearchParams({ embed: '1' });
    if (options.popup) params.set('popup', '1');
    if (options.service) params.set('service', options.service);
    return ORIGIN + '/' + encodeURIComponent(user) + '?' + params.toString();
  }

  function createFrame(url, title) {
    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = title || 'Online rezervace';
    iframe.setAttribute('allow', 'clipboard-write');
    frames.push(iframe);
    return iframe;
  }

  function mountInline(el) {
    if (el.getAttribute('data-slotiva-mounted')) return;
    var user = el.getAttribute('data-slotiva') || DEFAULT_USER;
    if (!user) return console.warn('Slotiva: u prvku data-slotiva chybí adresa rezervační stránky.');
    el.setAttribute('data-slotiva-mounted', '1');
    var iframe = createFrame(bookingUrl(user, { service: el.getAttribute('data-service') }), el.getAttribute('data-title'));
    iframe.className = 'slotiva-frame';
    iframe.style.height = (parseInt(el.getAttribute('data-height'), 10) || 720) + 'px';
    el.appendChild(iframe);
  }

  function open(user, service) {
    user = user || DEFAULT_USER;
    if (!user) return console.warn('Slotiva: chybí adresa rezervační stránky (data-slotiva-open="vase-adresa").');
    lastFocus = document.activeElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'slotiva-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Online rezervace');
      overlay.innerHTML = '<div class="slotiva-modal"><button type="button" class="slotiva-close" aria-label="Zavřít">' + ICON_CLOSE + '</button></div>';
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      overlay.querySelector('.slotiva-close').addEventListener('click', close);
      document.body.appendChild(overlay);
    }
    var url = bookingUrl(user, { popup: true, service: service });
    if (!popupFrame || popupFrame.getAttribute('data-url') !== url || popupFrame.getAttribute('data-done')) {
      if (popupFrame) popupFrame.remove();
      popupFrame = createFrame(url);
      popupFrame.setAttribute('data-url', url);
      overlay.querySelector('.slotiva-modal').appendChild(popupFrame);
    }
    overlay.classList.add('slotiva-open');
    document.documentElement.classList.add('slotiva-lock');
    setTimeout(function () { overlay.querySelector('.slotiva-close').focus(); }, 60);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('slotiva-open');
    document.documentElement.classList.remove('slotiva-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function mountAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-slotiva]'), mountInline);
  }

  function init() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var fabLabel = script.getAttribute('data-floating-button');
    if (fabLabel !== null) {
      var fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'slotiva-fab';
      fab.setAttribute('data-slotiva-open', DEFAULT_USER);
      if (script.getAttribute('data-service')) fab.setAttribute('data-service', script.getAttribute('data-service'));
      fab.innerHTML = ICON_CALENDAR + '<span></span>';
      fab.querySelector('span').textContent = fabLabel || 'Rezervovat termín';
      document.body.appendChild(fab);
    }

    mountAll();
    if (window.MutationObserver) new MutationObserver(mountAll).observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('[data-slotiva-open]');
    if (!trigger) return;
    e.preventDefault();
    open(trigger.getAttribute('data-slotiva-open'), trigger.getAttribute('data-service'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('slotiva-open')) close();
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || typeof e.data.type !== 'string') return;
    var frame = frames.filter(function (f) { return f.contentWindow === e.source; })[0];
    if (!frame) return;
    if (e.data.type === 'slotiva:resize' && frame.className === 'slotiva-frame') {
      frame.style.height = Math.max(420, Math.min(Number(e.data.height) || 0, 5000)) + 'px';
    }
    if (e.data.type === 'slotiva:booked') {
      if (frame === popupFrame) popupFrame.setAttribute('data-done', '1');
      window.dispatchEvent(new CustomEvent('slotiva:booked', {
        detail: { code: e.data.code, service: e.data.service, date: e.data.date, time: e.data.time },
      }));
    }
  });

  window.Slotiva = { open: open, close: close, mount: mountAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

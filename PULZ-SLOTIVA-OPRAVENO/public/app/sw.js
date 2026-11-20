/* Servisní pracovník dashboardu.
   Díky němu jde Slotiva přidat na plochu telefonu a otevřít i bez signálu.
   Ukládá se jen vzhled aplikace (stránka, styly, skripty, písma) – rezervace
   a nastavení se vždy načítají ze serveru, aby uživatel nikdy neviděl stará data. */

const VERSION = 'slotiva-pulz-fixed-20261120';

/* Soubory, bez kterých se dashboard nespustí. */
const SHELL = [
  '/app/',
  '/app/app.css',
  '/app/theme.js',
  '/app/js/app.js',
  '/app/js/api.js',
  '/app/js/ui.js',
  '/app/js/charts.js',
  '/app/js/pwa.js',
  '/app/js/views/overview.js',
  '/app/js/views/bookings.js',
  '/app/js/views/booking-actions.js',
  '/app/js/views/booking-drawer.js',
  '/app/js/views/new-booking.js',
  '/app/js/views/calendar.js',
  '/app/js/views/services.js',
  '/app/js/views/settings.js',
  '/app/js/views/integration.js',
  '/app/js/views/admin.js',
  '/app/js/views/team.js',
  '/assets/fonts.css',
  '/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  '/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2',
  '/favicon.svg',
  '/icons/icon-192.png',
];

/* Stránka pro případ, že telefon nemá signál a v paměti nic není. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bez připojení – Slotiva</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 400 15px/1.5 system-ui, sans-serif; color: #10312f; background: #f5f7f7; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0; color: #55706e; max-width: 320px; }
</style></head>
<body><div><h1>Zatím to nejde načíst</h1><p>Slotiva potřebuje připojení k internetu. Až budete online, zkuste to prosím znovu.</p></div></body></html>`;

const offlineResponse = () => new Response(OFFLINE_PAGE, {
  status: 503,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Když se jeden soubor nepodaří stáhnout, instalace kvůli němu nespadne.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

/** Nejdřív ze sítě – aplikace tak vždy běží v aktuální verzi. Bez signálu se použije uložená kopie. */
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    // Přesměrování (třeba na přihlášení) se neukládá, prohlížeč by ho pak neuměl použít.
    if (response.ok && response.type === 'basic' && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Písma a ikony se nemění, stačí je stáhnout jednou. */
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Rezervace, nastavení i přihlašování jdou vždy přímo na server.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request).catch(async () => (await caches.match('/app/')) || offlineResponse()));
    return;
  }

  if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg') {
    event.respondWith(cacheFirst(request).catch(() => Response.error()));
    return;
  }

  if (url.pathname.startsWith('/app/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(networkFirst(request).catch(() => Response.error()));
  }
});

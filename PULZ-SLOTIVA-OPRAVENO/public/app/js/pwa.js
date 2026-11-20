/* Slotiva jako aplikace v telefonu (PWA): ikona na ploše, spuštění na celou obrazovku
   a rychlé otevření i při slabém signálu. Server ani data se tím nijak nemění. */

let installEvent = null;

/** Chrome nabídne přidání na plochu přes tuto událost – schováme si ji na později. */
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  window.dispatchEvent(new CustomEvent('pwa:change'));
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  window.dispatchEvent(new CustomEvent('pwa:change'));
});

/** Běží dashboard jako aplikace (ne jako záložka v prohlížeči)? */
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: minimal-ui)').matches
  || navigator.standalone === true;

/** iPhone a iPad – Safari přidání na plochu nenabízí, musí ho udělat uživatel ručně. */
export const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isMobile = () => isApple() || /android/i.test(navigator.userAgent);

/** Jde přidání na plochu spustit tlačítkem? */
export const canInstall = () => Boolean(installEvent);

/** Vyvolá nabídku prohlížeče. Vrací 'accepted', 'dismissed' nebo null, když nabídka není. */
export async function install() {
  if (!installEvent) return null;
  const event = installEvent;
  installEvent = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  window.dispatchEvent(new CustomEvent('pwa:change'));
  return outcome;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {
    /* bez něj funguje všechno dál, jen nejde přidat na plochu */
  });
  // Dashboard se spouští až po načtení dat, takže „load“ mohlo proběhnout už dřív.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

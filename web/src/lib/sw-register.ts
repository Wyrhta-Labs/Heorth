// Service worker registration + update-available detection, split out from
// main.tsx so it's importable (and mockable) in isolation. See public/sw.js
// for the caching strategy and why the update flow is "waiting worker +
// user-triggered reload" rather than an automatic self.skipWaiting().

/** Registers /sw.js and calls `onUpdateAvailable` whenever a new worker is
 * installed and waiting to take over (i.e. a new deploy shipped while this
 * tab was open). Only runs in production builds — dev relies on Vite's own
 * HMR and a caching worker would just fight it. */
export function registerServiceWorker(onUpdateAvailable: () => void): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          onUpdateAvailable();
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateAvailable();
            }
          });
        });
      })
      .catch(() => {
        // Offline-first install, a proxy blocking /sw.js, etc. — the app
        // still works without a service worker, just without offline shell.
      });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/** Tell the waiting worker to activate; triggers the controllerchange reload above. */
export function applyServiceWorkerUpdate(): void {
  navigator.serviceWorker.getRegistration().then((reg) => {
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
}

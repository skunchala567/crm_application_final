/**
 * Installing the CRM as an app, and keeping an installed copy current.
 *
 * Two jobs, both small:
 *
 *   1. Register the service worker, and when a new build is waiting, take it.
 *      An installed app can sit open for days; without this, a deploy would
 *      not reach a window that is never closed.
 *   2. Hold on to the browser's install prompt so the app can offer "Install"
 *      in its own interface. The event fires once, early, and is lost if
 *      nobody keeps it -- so it is captured at start-up rather than by a
 *      component that may not be mounted yet.
 *
 * Registration is production-only. In dev the worker would serve yesterday's
 * bundle out of cache and make every change look like it did not take.
 */

let deferredPrompt = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener(canInstall()));

/** True when the browser has offered a prompt we have not used yet. */
export function canInstall() {
  return Boolean(deferredPrompt);
}

/** True when the app is already running in its own window. */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches
    || window.navigator.standalone === true;
}

/** Subscribe to install-availability changes. Returns an unsubscribe. */
export function onInstallAvailability(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Show the browser's own install dialog.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  // Chrome allows one use per event; drop it either way so the button cannot
  // be pressed twice against a spent prompt.
  deferredPrompt = null;
  notify();
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted' ? 'accepted' : 'dismissed';
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser shows its own bar wherever it likes; held back,
    // the app decides where the offer appears.
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      /* A worker that is installed but waiting is a build the user does not
         have yet. Ask it to take over; the controllerchange below reloads the
         page onto it. */
      const takeOver = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            registration.waiting?.postMessage('skip-waiting');
          }
        });
      };
      if (registration.waiting && navigator.serviceWorker.controller) {
        registration.waiting.postMessage('skip-waiting');
      }
      takeOver(registration.installing);
      registration.addEventListener('updatefound', () => takeOver(registration.installing));
      // Check for a new build when the app is brought back to the foreground,
      // which for an installed window may be days after it was opened.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    }).catch((error) => {
      // Not fatal: without a worker the app runs exactly as it did before.
      console.warn('[pwa] service worker registration failed', error);
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Guarded: skipWaiting can fire this more than once, and a reload loop
      // is worse than a stale tab.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

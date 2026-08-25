import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tailwind.css';
import './styles.css';
import './theme.css';
import { initTooltips } from './lib/tooltips.js';
import { applyCachedBrandTheme } from './brand-theme.js';
import { initPwa } from './pwa.js';

// Every button and filter explains itself on hover, with no delay.
initTooltips();

// Repaint from the last known business-unit colour before the first frame.
// The live colour arrives with /platform/business-units, so without this the
// app would render in the default palette and visibly flip on every reload.
applyCachedBrandTheme();

// Service worker and install prompt. Before the app mounts, because the
// browser fires beforeinstallprompt early and only once.
initPwa();

const rootElement = document.getElementById('root');
globalThis.React = React;

function showStartupError(error) {
  console.error('CRM startup failed', error);
  rootElement.innerHTML = `<div style="font-family:system-ui;padding:32px;color:#7f1d1d">
    <h1 style="font-size:20px">CRM could not start</h1>
    <p>${String(error?.message || error)}</p>
  </div>`;
}

/* These catch a failure to load or mount the app -- a bad chunk, a syntax
   error -- and replace the blank page with something that says so.

   They are removed the moment the app mounts. Left installed, they turn every
   later unhandled rejection into the same full-page takeover: one API call
   losing its database connection would wipe out a working session, mid-edit,
   with "CRM could not start". After mount the app has its own error
   boundaries and toasts, which fail at the scale of the thing that broke. */
const reportStartupError = (event) => showStartupError(event.error ?? event.reason ?? event.message);
window.addEventListener('error', reportStartupError);
window.addEventListener('unhandledrejection', reportStartupError);
const stopWatchingStartup = () => {
  window.removeEventListener('error', reportStartupError);
  window.removeEventListener('unhandledrejection', reportStartupError);
};

import('./App.jsx')
  .then(({ default: App }) => {
    createRoot(rootElement).render(
      <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>,
    );
    // After paint, so a component that throws during the first render is still
    // reported rather than leaving a blank page.
    requestAnimationFrame(() => requestAnimationFrame(stopWatchingStartup));
  })
  .catch((error) => {
    stopWatchingStartup();
    showStartupError(error);
  });

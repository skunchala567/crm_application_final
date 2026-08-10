import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tailwind.css';
import './styles.css';
import './theme.css';
import { initTooltips } from './lib/tooltips.js';
import { applyCachedBrandTheme } from './brand-theme.js';

// Every button and filter explains itself on hover, with no delay.
initTooltips();

// Repaint from the last known business-unit colour before the first frame.
// The live colour arrives with /platform/business-units, so without this the
// app would render in the default palette and visibly flip on every reload.
applyCachedBrandTheme();

const rootElement = document.getElementById('root');
globalThis.React = React;

function showStartupError(error) {
  console.error('CRM startup failed', error);
  rootElement.innerHTML = `<div style="font-family:system-ui;padding:32px;color:#7f1d1d">
    <h1 style="font-size:20px">CRM could not start</h1>
    <p>${String(error?.message || error)}</p>
  </div>`;
}

window.addEventListener('error', (event) => showStartupError(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => showStartupError(event.reason));

import('./App.jsx')
  .then(({ default: App }) => {
    createRoot(rootElement).render(
      <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>,
    );
  })
  .catch(showStartupError);

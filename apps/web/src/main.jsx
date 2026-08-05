import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tailwind.css';
import './styles.css';
import './theme.css';

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

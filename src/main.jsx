import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import GuildDashboard from './GuildDashboard.jsx';
import './index.css';

Sentry.init({
  dsn: 'https://dec62c1f99333e81b15093be68c2cfed@o4511049541746688.ingest.de.sentry.io/4511049566388304',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

const path = window.location.pathname;

// Redirection automatique de /dashboard/G1 vers /dashboard
if (path === '/dashboard/G1') {
  window.history.replaceState({}, '', '/dashboard');
}

const finalPath = window.location.pathname;
const isDashboard = finalPath === '/dashboard' || finalPath.startsWith('/dashboard/');

if (isDashboard) {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  isDashboard ? <GuildDashboard /> : <App />
);
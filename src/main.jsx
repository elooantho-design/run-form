import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import SaasPortal from './SaasPortal.jsx';
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

const PORTAL_URL = 'https://run-form-tau.vercel.app/portal';

function DashboardRetiredPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Nouveau portail disponible
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          L'ancien dashboard est desactive
        </h1>

        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
          Le suivi des guildes, les box, les defenses, les runs et la GVG sont maintenant centralises sur Portal.
          Utilise la nouvelle adresse ci-dessous pour te connecter.
        </p>

        <a
          href={PORTAL_URL}
          className="mt-8 inline-flex rounded-2xl bg-emerald-500 px-6 py-3 text-base font-semibold text-zinc-950 transition hover:bg-emerald-400"
        >
          Ouvrir Portal
        </a>

        <div className="mt-5 w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 font-mono text-sm text-emerald-100">
          {PORTAL_URL}
        </div>
      </div>
    </main>
  );
}

const finalPath = window.location.pathname;
const isDashboard = finalPath === '/dashboard' || finalPath.startsWith('/dashboard/');
const isPortal = finalPath === '/portal' || finalPath.startsWith('/portal/');

if (isDashboard || isPortal) {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  isPortal ? <SaasPortal /> : isDashboard ? <DashboardRetiredPage /> : <App />
);

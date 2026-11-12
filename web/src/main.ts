// main.ts v0.9 — entry: ?contract= → modo en vivo por RPC; si no, demo con replay ?sim=
import './style.css';
import { loadSandboxBadge } from './sandbox';

function themeInit(): void {
  const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

import { Sim } from './sim';
import { render, renderToolbar, renderReplayToggle, renderSkipLink, loadingSpinner, esc } from './render';
import { Replay, Dom } from './replay';
import { normalizeSim } from './normalize';
import { LivePoller } from './live';
import { loadLive, DEFAULT_RPC } from './rpc';

const app = document.getElementById('app')!;


const AUTOSTART_MS = 1500; // pausa para leer el resumen antes del replay
const SPEED_KEY = 'sim-speed';
let currentSpeed = 1;

function clampSpeed(v: number | string): number {
  return Math.max(0.5, Math.min(10, Number(v) || 1));
}

function showSpeed(): void {
  const d = document.querySelector('.toolbar .speed-display');
  if (d) d.textContent = `x${currentSpeed}`;
}

function initSpeedControl(): void {
  const saved = localStorage.getItem(SPEED_KEY);
  currentSpeed = clampSpeed(saved ? parseFloat(saved) : 1);
  const buttons = document.querySelectorAll<HTMLButtonElement>('.btn-speed');
  const setSpeed = (value: number | string): void => {
    currentSpeed = clampSpeed(value);
    localStorage.setItem(SPEED_KEY, String(currentSpeed));
    buttons.forEach((button) => {
      const selected = Number(button.dataset.speed) === currentSpeed;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    showSpeed();
    replay.reschedule();
  };
  buttons.forEach((button) => {
    const selected = Number(button.dataset.speed) === currentSpeed;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => setSpeed(button.dataset.speed ?? '1'));
  });
  const slider = document.querySelector('.speed-slider') as HTMLInputElement | null;
  showSpeed();
  if (slider) {
    slider.value = String(currentSpeed);
    slider.addEventListener('input', () => setSpeed(slider.value));
  }
}

async function load(): Promise<{ sim: Sim; live: boolean }> {
  const params = new URLSearchParams(location.search);
  const contract = params.get('contract');
  if (contract) return { sim: await loadLive(contract, params.get('rpc') ?? DEFAULT_RPC), live: true };
  const url = params.get('sim') ?? 'sim.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`no se pudo cargar ${url}: ${res.status}`);
  return { sim: normalizeSim(await res.json()), live: false };
}

const dom: Dom = {
  id: (id) => document.getElementById(id),
  query: (sel) => document.querySelector(sel),
};
const replay = new Replay(
  { dom, schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number, cancel: (t) => clearTimeout(t) },
  () => currentSpeed,
);

themeInit();
app.innerHTML = loadingSpinner();
load().then(async ({ sim, live }) => {
  const badge = live ? '' : await loadSandboxBadge();
  app.innerHTML = renderSkipLink() + renderToolbar(sim, currentSpeed)
    + `<div class="replay"> ${renderReplayToggle()}`
    + ` <button id="replay-restart" type="button" aria-label="reiniciar simulación">↺ reiniciar</button>`
    + `<span id="replay-status" class="status"></span>${live ? '<span id="live-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>' : ''}${badge}</div>`
    + `<main id="view" tabindex="-1">${live ? render(sim) : ''}</main>`;
  initSpeedControl();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', el.dataset.theme);
  });
  if (live) {
    const s = document.getElementById('replay-status');
    if (s) s.textContent = 'modo en vivo (testnet)';
    // sondeo cada 10 s; LivePoller se pausa con la pestaña oculta
    const poller = new LivePoller(
      {
        schedule: (fn, ms) => window.setTimeout(fn, ms),
        cancel: (t) => window.clearTimeout(t),
        visible: () => document.visibilityState !== 'hidden',
      },
      {
        update: (x) => { const v = document.getElementById('view'); if (v) v.innerHTML = render(x); },
        status: (t) => { if (s) s.textContent = t; },
        announce: (t) => { const a = document.getElementById('live-announcement'); if (a) a.textContent = t; },
      },
      { intervalMs: 10000, label: 'modo en vivo (testnet)', load: async () => (await load()).sim },
    );
    poller.start();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poller.refresh();
    });
    return;
  }
  replay.load(sim);
  document.getElementById('replay-toggle')?.addEventListener('click', () => replay.toggle());
  document.getElementById('replay-restart')?.addEventListener('click', () => replay.replay(sim));
  // el resumen inicial se ve unos instantes antes de que el mercado arranque solo
  setTimeout(() => replay.start(), AUTOSTART_MS);
}).catch((e) => {
  if (app) app.innerHTML = `<p class="error" role="alert">${esc(e instanceof Error ? e.message : String(e))}</p>`;
});

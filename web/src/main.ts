// main.ts v1.5 — entry: ?contract= → modo en vivo por RPC; si no, demo con replay ?sim= + toggle de tema
import './style.css';
import { loadSandboxBadge } from './sandbox';

function themeInit(): 'light' | 'dark' {
  const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
  // dark by default; only an explicit saved choice or an explicit OS light preference turns it light
  const dark = saved ? saved === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  const theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  return theme;
}

import { Sim } from './sim';
import { renderHero, renderIntro, renderToolbar, renderReplayToggle, renderSkipLink, renderHowItWorks, renderFooter, loadingSpinner, esc } from './render';
import { Replay, Dom } from './replay';
import { normalizeSim } from './normalize';
import { LivePoller } from './live';
import { loadLive, DEFAULT_RPC } from './rpc';

const app = document.getElementById('app')!;


const AUTOSTART_MS = 800; // breve pausa para leer el resumen; el mercado arranca solo y nunca se queda en "press play"
const SPEED_KEY = 'sim-speed';
let currentSpeed = 1;

// sostenibilidad: huella estable del estado leido del contrato; si no cambia, el mercado no se repinta
// (0 DOM / 0 trabajo de pintado por sondeo)
function fingerprintSim(sim: Sim): string {
  return JSON.stringify([
    sim.meta.seed,
    sim.rounds.length,
    sim.stats,
    sim.rounds.map((r) => [r.id, r.status, r.winner, r.closePrice, r.payment, r.verified, r.paid, r.bids.length]),
    sim.workers.map((w) => [w.id, w.alpha, w.beta, w.earned, w.done, w.failed]),
  ]);
}

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
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  return { sim: normalizeSim(await res.json()), live: false };
}

const dom: Dom = {
  id: (id) => document.getElementById(id),
  query: (sel) => document.querySelector(sel),
};
const replay = new Replay(
  {
    dom,
    schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    cancel: (t) => clearTimeout(t),
    visible: () => document.visibilityState !== 'hidden',
    onVisibilityChange: (fn) => document.addEventListener('visibilitychange', fn),
  },
  () => currentSpeed,
);

themeInit();
app.innerHTML = loadingSpinner();
// Worker table shows the top rows; the toggle state lives on #view so it survives re-renders of its content.
document.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest?.('[data-action="all-workers"]');
  const view = document.getElementById('view');
  if (btn && view) view.classList.toggle('all-workers');
});
load().then(async ({ sim, live }) => {
  const badge = live ? '' : await loadSandboxBadge();
  app.innerHTML = renderSkipLink() + renderHero(sim)
    + `<section class="controls" aria-label="Playback">` + renderToolbar(sim, currentSpeed)
    + `<div id="replay" class="replay"> ${renderReplayToggle()}`
    + ` <button id="replay-restart" type="button" aria-label="restart simulation">↺ restart</button>`
    + `<span id="replay-status" class="status" role="status" aria-live="polite" aria-atomic="true"></span>${live ? '<span id="live-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>' : ''}${badge}</div></section>`
    + `<main id="view" tabindex="-1">${live ? renderIntro(sim, new Date().toLocaleTimeString()) : renderIntro(sim)}</main>`
    + renderHowItWorks() + renderFooter();
  initSpeedControl();
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle?.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
  themeToggle?.addEventListener('click', () => {
    const el = document.documentElement;
    const next = el.dataset.theme === 'dark' ? 'light' : 'dark';
    el.dataset.theme = next;
    localStorage.setItem('theme', next);
    themeToggle.setAttribute('aria-pressed', String(next === 'dark'));
  });
  if (live) {
    // provenance: show WHICH testnet account the page is reading, not a generic label
    const contract = new URLSearchParams(location.search).get('contract') ?? '';
    const liveLabel = contract ? `live · ${contract}` : 'live mode (testnet)';
    const s = document.getElementById('replay-status');
    if (s) s.textContent = liveLabel;
    // sondeo cada 10 s; LivePoller se pausa con la pestaña oculta
    const poller = new LivePoller(
      {
        schedule: (fn, ms) => window.setTimeout(fn, ms),
        cancel: (t) => window.clearTimeout(t),
        visible: () => document.visibilityState !== 'hidden',
      },
      {
        update: (x) => { const v = document.getElementById('view'); if (v) v.innerHTML = renderIntro(x, new Date().toLocaleTimeString()); },
        status: (t) => { if (s) s.textContent = t; },
        announce: (t) => { const a = document.getElementById('live-announcement'); if (a) a.textContent = t; },
      },
      { intervalMs: 10000, label: liveLabel, load: async () => (await load()).sim, fingerprint: fingerprintSim },
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

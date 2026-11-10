// main.ts v0.7 — entry: ?contract= → modo en vivo por RPC; si no, demo con replay ?sim=
import './style.css';

function themeInit(): void {
  const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

import { Sim } from './sim';
import { render, renderToolbar } from './render';
import { Replay, Dom } from './replay';
import { normalizeSim } from './normalize';
import { loadLive, DEFAULT_RPC } from './rpc';

const app = document.getElementById('app')!;


const SPEED_KEY = 'sim-speed';
let currentSpeed = 1;

function clampSpeed(v: number | string): number {
  return Math.max(1, Math.min(10, Math.round(Number(v) || 1)));
}

function showSpeed(): void {
  const d = document.querySelector('.toolbar .speed-display');
  if (d) d.textContent = `x${currentSpeed}`;
}

function initSpeedControl(): void {
  const saved = localStorage.getItem(SPEED_KEY);
  currentSpeed = clampSpeed(saved ? parseInt(saved, 10) : 1);
  const slider = document.querySelector('.speed-slider') as HTMLInputElement | null;
  showSpeed();
  if (slider) {
    slider.value = String(currentSpeed);
    slider.addEventListener('input', () => {
      currentSpeed = clampSpeed(slider.value);
      localStorage.setItem(SPEED_KEY, String(currentSpeed));
      showSpeed();
      replay.reschedule();
    });
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
load().then(({ sim, live }) => {
  app.innerHTML = renderToolbar(sim, currentSpeed)
    + `<div class="replay"><button id="replay-toggle" type="button">▶ reproducir</button>`
    + `<button id="replay-restart" type="button">↺ reiniciar</button>`
    + `<span id="replay-status" class="status"></span></div>`
    + `<main id="view">${live ? render(sim) : ''}</main>`;
  initSpeedControl();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', el.dataset.theme);
  });
  if (live) {
    const s = document.getElementById('replay-status');
    if (s) s.textContent = 'modo en vivo (testnet)';
    // sondeo: en vivo la reputación y las rondas se mueven; refrescamos cada 10 s
    setInterval(async () => {
      try {
        const again = await load();
        const v = document.getElementById('view');
        if (v) v.innerHTML = render(again.sim);
        if (s) s.textContent = `modo en vivo (testnet) · actualizado ${new Date().toLocaleTimeString()}`;
      } catch { /* se reintenta en el siguiente sondeo */ }
    }, 10000);
    return;
  }
  replay.load(sim);
  document.getElementById('replay-toggle')?.addEventListener('click', () => replay.toggle());
  document.getElementById('replay-restart')?.addEventListener('click', () => replay.replay(sim));
  replay.start();
}).catch((e) => {
  if (app) app.innerHTML = `<p class="error">${String(e)}</p>`;
});

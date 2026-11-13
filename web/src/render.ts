// render.ts v1.1 — render HTML estático (sin framework) + hooks data-testid estables
import { Round, Sim, Worker, headline, reputation } from "./sim";
import { DEMO_CONTRACT } from "./rpc";
function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"\x27]/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

export { esc };

export function renderSkipLink(): string {
  return '<a class="skip-link" href="#view">Skip to main content</a>';
}

function workerRow(w: Worker, currency: string, hot?: string | null): string {
  const cls = hot && hot === w.id ? ' class="flash"' : '';
    return `
    <tr data-worker="${w.id}"${cls}>
      <td>${esc(w.id)}</td>
      <td>${reputation(w).toFixed(3)}</td>
      <td>${w.done}</td>
      <td>${w.failed}</td>
      <td>${w.earned.toFixed(2)} ${esc(currency)}</td>
    </tr>
  `;
}

function roundRow(r: Round, hot?: number | null): string {
  const bids = r.bids
    .map((b) => `<li title="${esc(b.worker)}">${esc(b.worker).replace(/^worker-/, '')}:</li>`)
    .join("");
  const estado = r.paid
    ? `paid ✦`
    : r.verified
      ? `verified, payment pending`
      : r.status === `closed`
        ? `closed unpaid (dropped out)`
        : r.status === `refunded`
          ? `refunded (dropped out)`
          : `open`;
  const cls = hot === r.id ? ` class=\"flash\"` : ``;
  return `\n    <tr data-round=\"${r.id}\"${cls}>
      <td>${r.id}</td>
      <td>${esc(r.task || `—`)}</td>
      <td>${esc(r.publisher || `—`)}</td>
      <td><ul>${bids}</ul></td>
      <td>${esc(r.winner)}</td>
      <td>${esc(r.closePrice)}</td>
      <td>${esc(estado)}</td>
    </tr>
  `;
}
export function render(sim: Sim, flash?: { round?: number; worker?: string } | null): string {
  return `<h1 data-testid="cost-per-result">${esc(headline(sim))}</h1><section><h2>Rounds</h2><div class="table-wrap" role="region" aria-label="Rounds; scroll horizontally to see all columns" tabindex="0"><table class="rounds" data-testid="rounds"><thead><tr><th scope="col">#</th><th scope="col">task</th><th scope="col">publisher</th><th scope="col">bids</th><th scope="col">winner</th><th scope="col">price</th><th scope="col">status</th></tr></thead><tbody>${sim.rounds.map((r) => roundRow(r, flash?.round)).join("")}</tbody></table></div></section><section><h2>Worker reputation</h2><div class="table-wrap" role="region" aria-label="Worker reputation; scroll horizontally to see all columns" tabindex="0"><table class="workers" data-testid="workers"><thead><tr><th scope="col">agent</th><th scope="col">rep. (Beta mean)</th><th scope="col">done</th><th scope="col">failed</th><th scope="col">earned (${esc(sim.meta.currency)})</th></tr></thead><tbody>${sim.workers.map((w) => workerRow(w, sim.meta.currency, flash?.worker)).join("")}</tbody></table></div></section>`;
}
export function renderFooter(): string {
  return `<footer class="footer">
    <div class="footer-content">
      <span>NearHackaton 2026 · Verified Results Market</span>
      <span class="version">v0.8</span>
    </div>
  </footer>`;
}

export function renderToolbar(sim: Sim, speed: number = 1): string {
  const cur = esc(sim.meta.currency);
  return `<div class="toolbar" role="group" aria-label="Playback controls">
    <div class="speed-controls">
      <button type="button" class="btn-speed ${speed === 0.5 ? "active" : ""}" data-speed="0.5" aria-pressed="${speed === 0.5}" aria-label="Speed 0.5x">x0.5</button>
      <button type="button" class="btn-speed ${speed === 1 ? "active" : ""}" data-speed="1" aria-pressed="${speed === 1}" aria-label="Speed 1x">x1</button>
      <button type="button" class="btn-speed ${speed === 2 ? "active" : ""}" data-speed="2" aria-pressed="${speed === 2}" aria-label="Speed 2x">x2</button>
      <button type="button" class="btn-speed ${speed === 3 ? "active" : ""}" data-speed="3" aria-pressed="${speed === 3}" aria-label="Speed 3x">x3</button>
    </div>
    <div class="stats-mini">
      <span>Verified: ${sim.stats.verifiedResults}</span>
      <a class="btn-live" data-testid="live-demo-link" href="?contract=${DEMO_CONTRACT}" aria-label="View the live market on NEAR testnet">Live on NEAR testnet</a>
      <button type="button" id="theme-toggle" class="btn-theme" aria-label="Toggle light and dark theme">◐ theme</button>
    </div>
  </div>`;
}

export function renderReplayToggle(): string {
  return `<button id="replay-toggle" type="button" aria-label="play or pause the simulation" aria-pressed="false">▶ play</button>`;
}

export function loadingSpinner(): string {
  return `<div class="spinner-wrap" role="status" aria-live="polite"><div class="spinner"></div><span class="sr-only">Loading...</span></div>`;
}
export function renderIntro(sim: Sim, updatedAt?: string | null): string {
  const s = sim.stats, c = esc(sim.meta.currency);
  const saving = s.roundRobinCostPerVerified > 0
    ? Math.max(0, (1 - s.marketCostPerVerified / s.roundRobinCostPerVerified) * 100) : 0;
  const top = [...sim.workers].sort((a, b) => b.earned - a.earned)[0];
  const card = (k: string, v: string) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  return `<section class="intro"><h2>Market ready</h2><div class="cards">`
    + card('Market cost / verified', `${s.marketCostPerVerified.toFixed(2)} ${c}`)
    + card('Round-robin cost / verified', `${s.roundRobinCostPerVerified.toFixed(2)} ${c}`)
    + card(`Market savings`, `${saving.toFixed(1)} %`)
    + card('Rounds', String(sim.rounds.length))
    + card('Verified results', String(s.verifiedResults))
    + card('Total spent', `${s.totalSpent.toFixed(2)} ${c}`)
    + card('Workers', String(sim.workers.length))
    + card('Top earner', top ? `${esc(top.id)} (${top.earned.toFixed(2)} ${c})` : '--')
    + (updatedAt ? card('Last update', updatedAt) : '')
    + `</div><p class="hint">Starts on its own in a few seconds (or press &#9654; play): commit &#8594; reveal &#8594; close.</p></section>`;
}

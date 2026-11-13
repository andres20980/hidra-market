// render.ts v1.8 — render HTML estático (sin framework) + hooks data-testid estables + hero
import { Round, Sim, Worker, reputation } from "./sim";
import { DEMO_CONTRACT } from "./rpc";

// testnet block explorer for the deployed market contract (docs/TESTNET_DEPLOY.md)
const EXPLORER = "https://testnet.nearblocks.io/address/";
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

// Portada: name, one-line pitch, the headline figure as two comparison bars, CTAs and trust badges.
export function renderHero(sim: Sim): string {
  const s = sim.stats, c = esc(sim.meta.currency);
  const market = s.marketCostPerVerified, rr = s.roundRobinCostPerVerified;
  const factor = market > 0 ? rr / market : 0;
  const max = Math.max(market, rr, 1);
  const pct = (v: number) => Math.max(2, (v / max) * 100);
  const bar = (label: string, val: number, cls: string) =>
    `<div class="bar-row"><span class="bar-label">${label}</span>`
    + `<div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct(val).toFixed(1)}%"></div></div>`
    + `<span class="bar-val num">${val.toFixed(0)} ${c}</span></div>`;
  return `<header class="hero" data-testid="hero">
    <div class="hero-main">
      <p class="hero-title">Hidra Market</p>
      <p class="hero-tag">AI agents bid in sealed auctions and get paid only when a verifier attests the work.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#replay" data-testid="watch-replay">&#9654; Watch the replay</a>
        <a class="btn" data-testid="hero-live-link" href="${EXPLORER}${DEMO_CONTRACT}" target="_blank" rel="noopener" aria-label="View the live contract on the NEAR testnet explorer">View contract &#8599;</a>
      </div>
      <ul class="hero-badges" aria-label="Guarantees">
        <li>No LLM calls</li><li>limited function-call keys</li><li>reproducible: make demo</li>
      </ul>
    </div>
    <div class="hero-figure" data-testid="hero-bars" role="img" aria-label="Cost per verified result: market ${market.toFixed(0)} ${c} versus round-robin ${rr.toFixed(0)} ${c}, about ${factor.toFixed(0)} times cheaper">
      <div class="hero-figure-head"><span class="k">Cost per verified result</span><span class="factor-chip num">${factor.toFixed(0)}&#215; cheaper</span></div>
      ${bar("Market", market, "good")}
      ${bar("Round-robin", rr, "muted")}
    </div>
  </header>`;
}

// Beta-mean reputation as a bar; width encodes the mean, title shows the sample size as confidence.
function repBar(w: Worker): string {
  const mean = reputation(w);
  const n = w.done + w.failed;
  return `<div class="rep" title="${mean.toFixed(3)} over ${n} job(s)">`
    + `<span class="rep-track"><span class="rep-fill" style="width:${(mean * 100).toFixed(0)}%"></span></span>`
    + `<span class="rep-val num">${mean.toFixed(2)}</span></div>`;
}

function workerRow(w: Worker, currency: string, hot?: string | null): string {
  const cls = hot && hot === w.id ? ' class="flash"' : '';
    return `
    <tr data-worker="${w.id}"${cls}>
      <td>${esc(w.id)}</td>
      <td>${repBar(w)}</td>
      <td>${w.done}</td>
      <td>${w.failed}</td>
      <td class="num">${w.earned.toFixed(2)}<span class="cur"> ${esc(currency)}</span></td>
    </tr>
  `;
}

function roundRow(r: Round, hot?: number | null): string {
  const BID_PREVIEW = 5;
  const extra = r.bids.length - BID_PREVIEW;
  const bids = r.bids
    .map((b, i) => `<li${i >= BID_PREVIEW ? ` class="x"` : ``} title="${esc(b.worker)}">${esc(b.worker).replace(/^worker-/, '')}</li>`)
    .join("") + (extra > 0 ? `<li class="more" aria-hidden="true">+${extra}</li>` : ``);
  const [chipCls, chipLabel] = r.paid
    ? ["settled", "Settled"]
    : r.verified
      ? ["settled", "Verified, pay pending"]
      : r.status === `closed`
        ? ["closed", "Closed unpaid"]
        : r.status === `refunded`
          ? ["refunded", "Refunded"]
          : ["open", "Open"];
  const nil = (v: unknown): string => (v == null || String(v).trim() === `` || String(v).trim() === `—` ? ` class="nil"` : ``);
  const estado = `<span class="chip ${chipCls}">${chipLabel}</span>`;
  const cls = hot === r.id ? ` class=\"flash\"` : ``;
  return `\n    <tr data-round=\"${r.id}\"${cls}>
      <td data-label="#">${r.id}</td>
      <td data-label="task"${nil(r.task)}>${esc(r.task || `—`)}</td>
      <td data-label="publisher"${nil(r.publisher)}>${esc(r.publisher || `—`)}</td>
      <td data-label="bids"${nil(bids)}><ul>${bids}</ul></td>
      <td data-label="winner"${nil(r.winner)}>${esc(r.winner)}</td>
      <td data-label="price"${nil(r.closePrice)}>${esc(r.closePrice)}</td>
      <td data-label="status">${estado}</td>
    </tr>
  `;
}
// Shimmer placeholder so the frame-0 / loading state reads as intentional, never as an empty broken table.
function skel(w: string): string {
  return `<span class="skel" style="width:${w}"></span>`;
}
function skeletonRounds(n = 3): string {
  const widths = ["1rem", "7rem", "4.5rem", "3.5rem", "4.5rem", "2.5rem", "5rem"];
  const row = () => `<tr class="skel-row" aria-hidden="true">${widths.map((w) => `<td>${skel(w)}</td>`).join("")}</tr>`;
  return Array.from({ length: n }, row).join("");
}
function skeletonWorkers(n = 3): string {
  const row = () => `<tr class="skel-row" aria-hidden="true"><td>${skel("5rem")}</td>`
    + `<td><span class="rep"><span class="rep-track"><span class="skel skel-full"></span></span></span></td>`
    + `<td>${skel("1.5rem")}</td><td>${skel("1.5rem")}</td><td>${skel("4rem")}</td></tr>`;
  return Array.from({ length: n }, row).join("");
}
export function render(sim: Sim, flash?: { round?: number; worker?: string } | null): string {
  const roundsBody = sim.rounds.length
    ? sim.rounds.map((r) => roundRow(r, flash?.round)).join("")
    : `<tr class="empty"><td colspan="7">No rounds yet. The replay starts in a moment.</td></tr>${skeletonRounds()}`;
  const workersBody = sim.workers.length
    ? sim.workers.map((w) => workerRow(w, sim.meta.currency, flash?.worker)).join("")
    : `<tr class="empty"><td colspan="5">No worker reputation yet.</td></tr>${skeletonWorkers()}`;
  return `<section><details class="round-details" open><summary>Rounds</summary><div class="table-wrap" role="region" aria-label="Rounds" tabindex="0"><table class="rounds" data-testid="rounds"><thead><tr><th scope="col">#</th><th scope="col">task</th><th scope="col">publisher</th><th scope="col">bids</th><th scope="col">winner</th><th scope="col">price</th><th scope="col">status</th></tr></thead><tbody>${roundsBody}</tbody></table></div></details></section><section><details class="round-details worker-details" open><summary>Worker reputation</summary><div class="table-wrap" role="region" aria-label="Worker reputation; scroll horizontally to see all columns" tabindex="0"><table class="workers" data-testid="workers"><thead><tr><th scope="col">agent</th><th scope="col"><abbr title="Reputation: Beta posterior mean">rep.</abbr></th><th scope="col">done</th><th scope="col">failed</th><th scope="col">earned <span class="unit">${esc(sim.meta.currency)}</span></th></tr></thead><tbody>${workersBody}</tbody></table></div></details></section>`;
}
// How it works: 4 steps (commit, reveal, attest, pay/refund) with simple inline SVG icons.
export function renderHowItWorks(): string {
  const icons: Record<string, string> = {
    commit: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
    reveal: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
    attest: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  };
  const step = (icon: string, t: string, d: string) =>
    `<li class="how-step"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`
    + `<p class="t">${t}</p><p class="d">${d}</p></li>`;
  return `<section class="how" aria-labelledby="how-h"><h2 id="how-h">How it works</h2><ol class="how-steps">`
    + step("commit", "Commit", "Agents post a sealed bid hash — nobody sees the price yet.")
    + step("reveal", "Reveal", "Bids open; the lowest valid bid wins and locks the escrow.")
    + step("attest", "Attest", "A verifier checks the work and signs the result on-chain.")
    + step("pay", "Pay / refund", "Pay only on a passing attestation; otherwise the publisher is refunded.")
    + `</ol></section>`;
}

export function renderFooter(): string {
  const repo = "https://github.com/andres20980/hidra-market";
  const links = [
    [repo, "Repo"],
    [`${repo}/blob/main/RULES.md`, "RULES.md"],
    [`${repo}/blob/main/SECURITY.md`, "SECURITY.md"],
    [`${EXPLORER}${DEMO_CONTRACT}`, "Contract on testnet"],
  ].map(([href, t]) =>
    `<a href="${href}" target="_blank" rel="noopener">${t}</a>`).join("");
  return `<footer class="footer">
    <div class="footer-content">
      <span>NearHackaton 2026 · Verified Results Market</span>
      <nav class="footer-links" aria-label="Project links">${links}</nav>
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
      <a class="btn btn-live" data-testid="live-demo-link" href="?contract=${DEMO_CONTRACT}" aria-label="View the live market on NEAR testnet">Live<span class="lbl-long"> on NEAR testnet</span></a>
      <button type="button" id="theme-toggle" class="btn-theme" aria-label="Toggle light and dark theme">◐<span class="lbl-long"> theme</span></button>
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
    + `</div><p class="hint">Starts on its own in a few seconds (or press &#9654; play): commit &#8594; reveal &#8594; close.</p></section>`
    // preload the tables with the final state so they are never empty before the replay (or on every live poll)
    + render(sim);
}

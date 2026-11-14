// render.ts v1.36
import { Bid, Round, Sim, Worker, reputation } from "./sim";
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

// Real swarm headline (source: swarm/out/baseline_compare.json, `npm run baseline:compare`).
export const REAL_SWARM = { runs: 22957, perRunUsd: 0.061071, escrowUsd: 0.005769, factor: 10.586 };

// Round lifecycle bar: Funded → Sealed bids → Revealed → Attested → Paid / Refunded; main.ts moves it with the replay.
export const STAGES = ["Funded", "Sealed bids", "Revealed", "Attested", "Paid / Refunded"] as const;
export function renderStages(): string {
  return `<ol class="stages" data-testid="round-stages" aria-label="Round lifecycle">`
    + STAGES.map((t, i) => `<li data-i="${i}"${i === STAGES.length - 1 ? ' data-end' : ''}>${t}</li>`).join("")
    + `</ol>`;
}
// Replay status text → active stage index (0-4) and outcome of the last step; null when it says nothing about a round.
export function stageOf(text: string): { i: number; end?: "paid" | "refunded" } | null {
  const t = text.replace(/\s+/g, " ");
  if (/simulation complete/.test(t)) return { i: 4, end: "paid" };
  if (/waiting for bids/.test(t)) return { i: 0 };
  if (/\(commit\)/.test(t)) return { i: 1 };
  if (/\(reveal\)/.test(t)) return { i: 2 };
  if (/\bunverified\b/.test(t)) return { i: 4, end: "refunded" };
  if (/\bverified\b/.test(t)) return { i: 4, end: "paid" };
  return null;
}
// Live view: the newest on-chain round → its stage (same bar as the replay).
export function stageOfRound(r: Round | undefined): { i: number; end?: "paid" | "refunded" } | null {
  if (!r) return null;
  if (r.status === "refunded") return { i: 4, end: "refunded" };
  if (r.status === "closed") return r.paid ? { i: 4, end: "paid" } : { i: 3 };
  if (r.bids.some((b) => b.revealed)) return { i: 2 };
  return { i: r.bids.length ? 1 : 0 };
}

// Portada: name, pitch, the real headline figure as two bars, the replay/live scenario as a small labelled line,
// CTAs and trust badges.
export function renderHero(sim: Sim, live = false): string {
  const s = sim.stats, c = esc(sim.meta.currency);
  const market = s.marketCostPerVerified, rr = s.roundRobinCostPerVerified;
  const factor = market > 0 ? rr / market : 0;
  const fmt = (v: number) => v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2);
  const r = REAL_SWARM, x = r.factor.toFixed(1), runs = r.runs.toLocaleString('en-US');
  const usd = (v: number) => `$${v.toFixed(4)}`;
  const pct = (v: number) => Math.max(2, (v / r.perRunUsd) * 100);
  const bar = (label: string, val: number, cls: string) =>
    `<div class="bar-row"><span class="bar-label">${label}</span>`
    + `<div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct(val).toFixed(1)}%"></div></div>`
    + `<span class="bar-val num">${usd(val)}</span></div>`;
  const scen = live ? 'Live market' : 'benchmark scenario';
  return `<header class="hero" data-testid="hero">
    <div class="hero-main">
      <h1 class="hero-title">Hidra Market</h1>
      <p class="hero-tag">AI agents bid in sealed auctions and get paid only when a verifier attests the work.</p>
      ${renderStages()}
      <div class="hero-cta">
        <a class="btn btn-primary btn-onchain" data-testid="hero-live-demo" href="?contract=${DEMO_CONTRACT}" aria-label="Open the live market on NEAR testnet"><span class="live-dot" aria-hidden="true"></span>Live on NEAR testnet</a>
        <a class="btn" href="#replay" data-testid="watch-replay">&#9660; Watch the replay</a>
      </div>
      <ul class="hero-badges" aria-label="Guarantees">
        <li>No LLM calls</li><li>limited function-call keys</li><li>reproducible: make demo</li>
      </ul>
    </div>
    <div class="hero-figure" data-testid="hero-bars" role="img" aria-label="${x} times cheaper per verified result if escrow had paid our real ledger (${runs} runs, counterfactual): ${usd(r.perRunUsd)} paying every run versus ${usd(r.escrowUsd)} paying only verified results. ${scen}: ${fmt(market)} versus ${fmt(rr)} ${c}.">
      <div class="hero-figure-head"><span class="k">Cost per verified result</span><span class="factor-chip" title="Escrow rule applied to the same historical outcomes; not a measurement of the deployed swarm">real ledger &middot; counterfactual</span></div>
      <p class="hero-big"><span class="hero-x num">${x}&#215;</span> <span>cheaper if escrow had paid our real ledger <span class="hero-big-sub num">${runs} runs</span></span></p>
      ${bar("Pay every run", r.perRunUsd, "muted")}
      ${bar("Pay verified", r.escrowUsd, "good")}
      <p class="hero-scenario" data-testid="hero-scenario"><span class="tag">${live ? 'testnet' : 'simulated'}</span> ${scen}: <span class="scen-fig"><span class="num">${fmt(market)}</span> vs <span class="num">${fmt(rr)}</span> ${c}&nbsp;&middot; <span class="num">${factor.toFixed(0)}&#215; cheaper</span></span></p>
      <p class="hero-figure-foot"><a data-testid="hero-live-link" href="${EXPLORER}${DEMO_CONTRACT}" target="_blank" rel="noopener" aria-label="View the contract on the NEAR testnet explorer (opens in a new tab)">Escrow contract on nearblocks &#8599;</a></p>
    </div>
  </header>`;
}

// Attested outcomes: explicit counters, or the Beta(1,1) posterior counts when the replay only carries alpha/beta.
function outcomes(w: Worker): { done: number; failed: number } {
  return { done: Math.max(w.done, Math.round(w.alpha - 1)), failed: Math.max(w.failed, Math.round(w.beta - 1)) };
}
// Beta-mean reputation as a bar; width encodes the mean, title shows the sample size as confidence.
function repBar(w: Worker): string {
  const mean = reputation(w);
  const { done, failed } = outcomes(w);
  const n = done + failed;
  return `<div class="rep" title="${mean.toFixed(3)} over ${n} job(s)">`
    + `<span class="rep-track"><span class="rep-fill" style="width:${(mean * 100).toFixed(0)}%"></span></span>`
    + `<span class="rep-val num">${mean.toFixed(2)}</span></div>`;
}

const WORKER_PREVIEW = 8;
let workersExpanded = false;
export function setWorkersExpanded(v: boolean): void { workersExpanded = v; }
let workersOpen = false;
export function setWorkersOpen(v: boolean): void { workersOpen = v; }

function workerRow(w: Worker, currency: string, hot?: string | null, extra = false): string {
  const c = [hot && hot === w.id ? 'flash' : '', extra && hot !== w.id ? 'x' : ''].filter(Boolean).join(' ');
  const cls = c ? ` class="${c}"` : '';
    return `
    <tr data-worker="${w.id}"${cls}>
      <td>${acct(w.id)}</td>
      <td>${repBar(w)}</td>
      <td>${outcomes(w).done}</td>
      <td>${outcomes(w).failed}</td>
      <td class="num">${w.earned.toFixed(2)}<span class="cur"> ${esc(currency)}</span></td>
    </tr>
  `;
}

// Long NEAR sub-accounts (worker-2.hidra-mkt-221016.testnet) show only their first label; the suffix stays in the DOM for screen readers and copy.
export function acct(id: unknown): string {
  const s = String(id ?? ``);
  const m = /^([^.]+)(\.[^.]+\.(?:testnet|near))$/.exec(s);
  return m ? `<span class="acct" title="${esc(s)}">${esc(m[1])}<span class="sr-only">${esc(m[2])}</span></span>` : esc(s);
}
// Bid chip: revealed price (winner highlighted) or a sealed mark; the bidder lives in title/sr-only so rows never look identical.
export function bidChip(b: Bid, winner: string | null, hidden = false): string {
  const open = b.revealed && b.reveal != null;
  const cls = [hidden ? `x` : ``, open ? `` : `sealed`, open && b.worker === winner ? `win` : ``].filter(Boolean).join(` `);
  const who = esc(b.worker);
  const label = open ? esc(b.reveal) : `&#8226;&#8226;&#8226;`;
  const sr = open ? `${who} bid ${esc(b.reveal)}` : `${who}: sealed bid`;
  return `<li${cls ? ` class="${cls}"` : ``} title="${open ? `${who}: ${esc(b.reveal)}` : `${who}: sealed`}"><span aria-hidden="true">${label}</span><span class="sr-only">${sr}</span></li>`;
}
function roundRow(r: Round, hot?: number | null): string {
  const BID_PREVIEW = 5;
  const extra = r.bids.length - BID_PREVIEW;
  // Winner's bid first so the highlighted chip is never folded into "+N".
  const bids = [...r.bids].sort((a, b) => Number(b.worker === r.winner) - Number(a.worker === r.winner))
    .map((b, i) => bidChip(b, r.winner, i >= BID_PREVIEW))
    .join("") + (extra > 0 ? `<li class="more" aria-hidden="true">+${extra}</li>` : ``);
  const [chipCls, chipLabel] = r.paid
    ? ["settled", "Settled"]
    : r.verified
      ? ["settled", "Verified, pay pending"]
      : r.status === `closed`
        ? ["closed", r.winner ? "Awaiting attestation" : "Revealing bids"]
        : r.status === `refunded`
          ? ["refunded", "Refunded"]
          : ["open", "Open"];
  const nil = (v: unknown): string => (v == null || String(v).trim() === `` || String(v).trim() === `—` ? ` class="nil"` : ``);
  const estado = `<span class="chip ${chipCls}">${chipLabel}</span>`;
  const cls = hot === r.id ? ` class=\"flash\"` : ``;
  return `\n    <tr data-round=\"${r.id}\"${cls}>
      <td data-label="#">${r.id}</td>
      <td data-label="task"${nil(r.task)}>${esc(r.task || `—`)}</td>
      <td data-label="publisher"${nil(r.publisher)}>${r.publisher ? acct(r.publisher) : `—`}</td>
      <td data-label="bids"${nil(bids)}><ul>${bids}</ul></td>
      <td data-label="winner"${nil(r.winner)}>${acct(r.winner)}</td>
      <td data-label="price"${nil(r.closePrice)}>${esc(r.closePrice)}</td>
      <td data-label="status">${estado}</td>
    </tr>
  `;
}
// Shimmer placeholder so the frame-0 / loading state reads as intentional, never as an empty broken table.
function skel(w: string): string {
  return `<span class="skel" style="width:${w}"></span>`;
}
function skeletonRounds(n = 2): string {
  const widths = ["1rem", "7rem", "4.5rem", "3.5rem", "4.5rem", "2.5rem", "5rem"];
  const row = () => `<tr class="skel-row" aria-hidden="true">${widths.map((w) => `<td>${skel(w)}</td>`).join("")}</tr>`;
  return Array.from({ length: n }, row).join("");
}
// Leaderboard order: earnings, then attested outcomes, then reputation; stable on ties.
// Evidence before reputation keeps verifier-judged workers visible instead of a wall of untouched 0.50 priors.
export function leaderboard(ws: Worker[]): Worker[] {
  return ws.map((w, i) => ({ w, i, r: reputation(w), n: outcomes(w).done + outcomes(w).failed }))
    .sort((a, b) => b.w.earned - a.w.earned || b.n - a.n || b.r - a.r || a.i - b.i)
    .map((x) => x.w);
}

function skeletonWorkers(n = 2): string {
  const row = () => `<tr class="skel-row" aria-hidden="true"><td>${skel("5rem")}</td>`
    + `<td><span class="rep"><span class="rep-track"><span class="skel skel-full"></span></span></span></td>`
    + `<td>${skel("1.5rem")}</td><td>${skel("1.5rem")}</td><td>${skel("4rem")}</td></tr>`;
  return Array.from({ length: n }, row).join("");
}
// Source chip: a judge must tell the simulated replay from real testnet data at a glance.
function srcTag(mode: string | undefined): string {
  return /^live/i.test(mode ?? ``)
    ? `<span class="src-tag src-live">real testnet</span>`
    : `<span class="src-tag src-sim" title="Simulated benchmark scenario in reward units; real testnet rounds are listed below">simulated replay</span>`;
}
// A wall of amber "Refunded" reads as failure unless the replay says it is the point of the escrow.
function roundsNote(mode: string | undefined): string {
  return /^live/i.test(mode ?? ``)
    ? ``
    : `<p class="rounds-note">Most rounds end <strong>Refunded</strong> by design: the replay mirrors our real swarm&#39;s low pass rate, and work the verifier rejects costs the publisher nothing.</p>`;
}
export function render(sim: Sim, flash?: { round?: number; worker?: string } | null): string {
  const roundsBody = sim.rounds.length
    ? [...sim.rounds].reverse().map((r) => roundRow(r, flash?.round)).join("")
    : `<tr class="empty"><td colspan="7"><span class="live-dot" aria-hidden="true"></span>Round 1 is open: workers are committing sealed bids…</td></tr>${skeletonRounds()}`;
  // Hide columns that carry no data in this run (the simulation has no task/publisher), so the table never shows a column of dashes.
  const blank = (v: unknown): boolean => v == null || String(v).trim() === `` || String(v).trim() === `—`;
  // With no rounds yet, start hidden too: avoids a layout jump when the first round lands without task/publisher.
  const hideCols = [sim.rounds.every((r) => blank(r.task)) ? ` no-task` : ``, sim.rounds.every((r) => blank(r.publisher)) ? ` no-publisher` : ``].join(``);
  const workersBody = sim.workers.length
    ? leaderboard(sim.workers).map((w, i) => workerRow(w, sim.meta.currency, flash?.worker, i >= WORKER_PREVIEW)).join("")
      + (sim.workers.length > WORKER_PREVIEW
        ? `<tr class="more-row"><td colspan="5"><button type="button" class="more-btn" data-action="all-workers" aria-controls="view" aria-expanded="${workersExpanded}"><span class="when-few">Show all ${sim.workers.length} workers</span><span class="when-all">Show top ${WORKER_PREVIEW}</span></button></td></tr>`
        : "")
    : `<tr class="empty"><td colspan="5"><span class="live-dot" aria-hidden="true"></span>Reputation appears after the first verified result…</td></tr>${skeletonWorkers()}`;
  return `<section><details class="round-details" open><summary>Rounds ${srcTag(sim.meta.mode)}</summary>${roundsNote(sim.meta.mode)}<div class="table-wrap" role="region" aria-label="Rounds" tabindex="0"><table class="rounds${hideCols}" data-testid="rounds"><thead><tr><th scope="col">#</th><th scope="col">task</th><th scope="col">publisher</th><th scope="col">bids</th><th scope="col">winner</th><th scope="col"><abbr title="Reputation-adjusted price: bid × (α+β)/α. The lowest adjusted price wins, so a cheap bid from an unreliable agent can lose.">adj. price</abbr></th><th scope="col">status</th></tr></thead><tbody>${roundsBody}</tbody></table></div></details></section><section><details class="round-details worker-details"${workersOpen ? ' open' : ''}><summary>Worker reputation <span class="sum-hint">${sim.workers.length} agents · Beta score</span></summary><div class="table-wrap" role="region" aria-label="Worker reputation; scroll horizontally to see all columns" tabindex="0"><table class="workers" data-testid="workers"><thead><tr><th scope="col">agent</th><th scope="col"><abbr title="Reputation: Beta posterior mean">rep.</abbr></th><th scope="col">done</th><th scope="col">failed</th><th scope="col">earned <span class="unit">${esc(sim.meta.currency)}</span></th></tr></thead><tbody>${workersBody}</tbody></table></div></details></section>`;
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
    + step("reveal", "Reveal", "Bids open; the lowest reputation-adjusted bid wins and locks the escrow.")
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
      <span>Built for NEAR Hackathon 2026<span class="foot-sep"> · </span><span class="nw foot-name">Verified Results Market</span></span>
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
  const live = Boolean(updatedAt);
  return `<section class="intro"><h2>${live ? 'Live market' : 'Market ready'}</h2><div class="cards">`
    + card('Market cost / verified', `${s.marketCostPerVerified.toFixed(2)} ${c}`)
    + card('Round-robin cost / verified', `${s.roundRobinCostPerVerified.toFixed(2)} ${c}`)
    + card(`Market savings`, `${saving.toFixed(1)} %`)
    + card('Rounds', String(sim.rounds.length))
    + card('Verified results', String(s.verifiedResults))
    + card('Total spent', `${s.totalSpent.toFixed(2)} ${c}`)
    + card('Workers', String(sim.workers.length))
    + card('Top earner', top ? `${acct(top.id)} (${top.earned.toFixed(2)} ${c})` : '--')
    + (updatedAt ? card('Last update', updatedAt) : '')
    + `</div><p class="hint">${live
      ? 'Read straight from the contract on NEAR testnet; refreshes every 10 s.'
      : 'Starts on its own in a few seconds (or press &#9654; play): commit &#8594; reveal &#8594; close.'}</p></section>`
    // preload the tables with the final state so they are never empty before the replay (or on every live poll)
    + render(sim);
}

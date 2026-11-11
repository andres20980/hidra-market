// render.ts v0.8 — render HTML estático (sin framework) + resumen inicial
import { Round, Sim, Worker, headline, reputation } from "./sim";

export function esc(s: string | number | null | undefined): string {
  const str = String(s ?? "--");
  const map: Record<string, string> = { "&": "<", "<": ">", ">": "\"", "'": "'" };
  return str.replace(/[&<>"']/g, c => map[c] || c);
}

function roundRow(r: Round, hot?: number | null): string {
  const bids = r.bids
    .map((b) => `<li title="${esc(b.worker)}">${esc(b.worker.replace(/^worker-/, ""))}:${b.revealed ? esc(b.reveal) : "sellada"}</li>`)
    .join("");
  const estado = r.paid ? "cobrado ♪" : r.verified ? "verificado, pendiente de pago" : r.status === "closed" ? "cerrada sin pago (cayó)" : r.status === "refunded" ? "reembolsada (cayó)" : "abierta";
  const cls = hot === r.id ? ' class="flash"' : '';
  return `<tr data-round="${r.id}"${cls}><td>${r.id}</td><td>${esc(r.task || "—")}</td><td>${esc(r.publisher || "—")}</td><td><ul>${bids}</ul></td><td>${esc(r.winner)}</td><td>${esc(r.closePrice)}</td><td>${esc(estado)}</td></tr>`;
}

function workerRow(w: Worker, hot?: string | null): string {
  const cls = hot && hot === w.id ? ' class="flash"' : '';
  return `<tr data-worker="${esc(w.id)}"${cls}><td>${esc(w.id)}</td><td>${reputation(w).toFixed(2)}</td><td>${w.done}</td><td>${w.failed}</td><td>${esc(w.earned.toFixed(2))}</td></tr>`;
}

export function render(sim: Sim, flash?: { round?: number; worker?: string } | null): string {
  return `<h1>${esc(headline(sim))}</h1><section><h2>Rondas</h2><div class="table-wrap" role="region" aria-label="Rondas; desplaza horizontalmente para ver todas las columnas" tabindex="0"><table class="rounds"><thead><tr><th>#</th><th>tarea</th><th>publicador</th><th>pujas</th><th>ganador</th><th>precio</th><th>estado</th></tr></thead><tbody>${sim.rounds.map((r) => roundRow(r, flash?.round)).join("")}</tbody></table></div></section><section><h2>Reputación de trabajadores</h2><div class="table-wrap" role="region" aria-label="Reputación de trabajadores; desplaza horizontalmente para ver todas las columnas" tabindex="0"><table class="workers"><thead><tr><th>agente</th><th>rep. (media Beta)</th><th>hechos</th><th>fallados</th><th>cobrado (${esc(sim.meta.currency)})</th></tr></thead><tbody>${sim.workers.map((w) => workerRow(w, flash?.worker)).join("")}</tbody></table></div></section>`;
}

export function renderToolbar(sim: Sim, speed: number = 1): string {
  const stats = sim.stats;
  const speedDisplay = speed === 1 ? '' : ` Velocidad: ${speed}x`;
  return `<div class="toolbar"><span class="badge">${esc(sim.meta.mode)}${speedDisplay}</span><span class="stats"><span>Verificados: ${stats.verifiedResults}</span></span><div class="speed-control"><span>Velocidad:</span> <input type="range" min="1" max="10" value="${speed}" class="speed-slider" aria-label="velocidad de simulación"${speed !== 1 ? ' data-speed="' + speed + '"' : ''}><span class="speed-display">x${speed}</span></div><button id="theme-toggle" type="button" aria-label="cambiar tema">&nbsp; claro/oscuro&nbsp;</button></div>`;
}
export function renderFooter(): string {
  return `<footer class="footer">
    <div class="footer-content">
      <span>NearHackaton 2026 · Mercado de Verificación de Resultados</span>
      <span class="version">v0.8</span>
    </div>
  </footer>`;
}

export function loadingSpinner(): string {
  return `<div class="spinner-wrap" role="status" aria-live="polite"><div class="spinner"></div><span class="sr-only">Cargando...</span></div>`;
}
export function renderIntro(sim: Sim): string {
  const s = sim.stats, c = esc(sim.meta.currency);
  const saving = s.roundRobinCostPerVerified > 0
    ? Math.max(0, (1 - s.marketCostPerVerified / s.roundRobinCostPerVerified) * 100) : 0;
  const top = [...sim.workers].sort((a, b) => b.earned - a.earned)[0];
  const card = (k: string, v: string) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  return `<section class="intro"><h2>Mercado listo</h2><div class="cards">`
    + card('Coste mercado / verificado', `${s.marketCostPerVerified.toFixed(2)} ${c}`)
    + card('Coste round-robin / verificado', `${s.roundRobinCostPerVerified.toFixed(2)} ${c}`)
    + card(`Ahorro del mercado`, `${saving.toFixed(1)} %`)
    + card('Rondas', String(sim.rounds.length))
    + card('Resultados verificados', String(s.verifiedResults))
    + card('Gasto total', `${s.totalSpent.toFixed(2)} ${c}`)
    + card('Trabajadores', String(sim.workers.length))
    + card('Mayor cobro', top ? `${esc(top.id)} (${top.earned.toFixed(2)} ${c})` : '--')
    + `</div><p class="hint">Arranca solo en unos segundos (o pulsa &#9654; reproducir): compromiso &#8594; revelado &#8594; cierre.</p></section>`;
}

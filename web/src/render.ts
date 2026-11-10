// render.ts v0.5 — render HTML estático (sin framework)
import { Round, Sim, Worker, headline, reputation } from "./sim";

function esc(s: string | number | null | undefined): string {
  const str = String(s ?? "--");
  const map: Record<string, string> = { "&": "<", "<": ">", ">": "\"", "'": "'" };
  return str.replace(/[&<>"']/g, c => map[c] || c);
}

function roundRow(r: Round, hot?: number | null): string {
  const bids = r.bids
    .map((b) => `<li>${esc(b.worker)}:${b.revealed ? esc(b.reveal) : "sellada"}</li>`)
    .join("");
  const estado = r.paid ? "cobrado ♪" : r.verified ? "verificado, pendiente de pago" : r.status === "closed" ? "cerrada sin pago (cayó)" : r.status === "refunded" ? "reembolsada (cayó)" : "abierta";
  const cls = hot === r.id ? ' class="flash"' : '';
  return `<tr data-round="${r.id}"${cls}><td>${r.id}</td><td>${esc(r.task)}</td><td>${esc(r.publisher)}</td><td><ul>${bids}</ul></td><td>${esc(r.winner)}</td><td>${esc(r.closePrice)}</td><td>${esc(estado)}</td></tr>`;
}

function workerRow(w: Worker, hot?: string | null): string {
  const cls = hot && hot === w.id ? ' class="flash"' : '';
  return `<tr data-worker="${esc(w.id)}"${cls}><td>${esc(w.id)}</td><td>${reputation(w).toFixed(2)}</td><td>${w.done}</td><td>${w.failed}</td><td>${esc(w.earned.toFixed(2))}</td></tr>`;
}

export function render(sim: Sim, flash?: { round?: number; worker?: string } | null): string {
  return `<h1>${esc(headline(sim))}</h1><section><h2>Rondas</h2><table><thead><tr><th>#</th><th>tarea</th><th>publicador</th><th>pujas</th><th>ganador</th><th>precio</th><th>estado</th></tr></thead><tbody>${sim.rounds.map((r) => roundRow(r, flash?.round)).join("")}</tbody></table></section><section><h2>Reputación de trabajadores</h2><table><thead><tr><th>agente</th><th>rep. (media Beta)</th><th>hechos</th><th>fallados</th><th>cobrado (${esc(sim.meta.currency)})</th></tr></thead><tbody>${sim.workers.map((w) => workerRow(w, flash?.worker)).join("")}</tbody></table></section>`;
}

export function renderToolbar(sim: Sim, speed: number = 1): string {
  const stats = sim.stats;
  const speedDisplay = speed === 1 ? '' : ` Velocidad: ${speed}x`;
  return `<div class="toolbar"><span class="badge">${esc(sim.meta.mode)}${speedDisplay}</span><span class="stats">Coste mercado: ${stats.marketCostPerVerified.toFixed(2)} ${esc(sim.meta.currency)} Costo round-robin: ${stats.roundRobinCostPerVerified.toFixed(2)} ${esc(sim.meta.currency)} Verificados: ${stats.verifiedResults}</span><div class="speed-control"><span>Velocidad:</span><input type="range" min="1" max="10" value="${speed}" class="speed-slider"${speed !== 1 ? ' data-speed="' + speed + '"' : ''}><span class="speed-display">x${speed}</span></div><button id="theme-toggle" type="button" aria-label="cambiar tema">&nbsp; claro/oscuro&nbsp;</button></div>`;
}
export function renderFooter(): string {
  return `<footer class="footer">
    <div class="footer-content">
      <span>NearHackaton 2026 · Mercado de Verificación de Resultados</span>
      <span class="version">v0.7</span>
    </div>
  </footer>`;
}

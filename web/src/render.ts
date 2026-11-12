// render.ts v0.8 — render HTML estático (sin framework) + resumen inicial
import { Round, Sim, Worker, headline, reputation } from "./sim";
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
  return '<a class="skip-link" href="#view">Saltar al contenido principal</a>';
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
    ? `cobrado ✦`
    : r.verified
      ? `verificado, pendiente de pago`
      : r.status === `closed`
        ? `cerrada sin pago (cayó)`
        : r.status === `refunded`
          ? `reembolsada (cayó)`
          : `abierta`;
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
  return `<h1>${esc(headline(sim))}</h1><section><h2>Rondas</h2><div class="table-wrap" role="region" aria-label="Rondas; desplaza horizontalmente para ver todas las columnas" tabindex="0"><table class="rounds"><thead><tr><th scope="col">#</th><th scope="col">tarea</th><th scope="col">publicador</th><th scope="col">pujas</th><th scope="col">ganador</th><th scope="col">precio</th><th scope="col">estado</th></tr></thead><tbody>${sim.rounds.map((r) => roundRow(r, flash?.round)).join("")}</tbody></table></div></section><section><h2>Reputación de trabajadores</h2><div class="table-wrap" role="region" aria-label="Reputación de trabajadores; desplaza horizontalmente para ver todas las columnas" tabindex="0"><table class="workers"><thead><tr><th scope="col">agente</th><th scope="col">rep. (media Beta)</th><th scope="col">hechos</th><th scope="col">fallados</th><th scope="col">cobrado (${esc(sim.meta.currency)})</th></tr></thead><tbody>${sim.workers.map((w) => workerRow(w, sim.meta.currency, flash?.worker)).join("")}</tbody></table></div></section>`;
}

export function renderFooter(): string {
  return `<footer class="footer">
    <div class="footer-content">
      <span>NearHackaton 2026 · Mercado de Verificación de Resultados</span>
      <span class="version">v0.8</span>
    </div>
  </footer>`;
}

export function renderToolbar(sim: Sim, speed: number = 1): string {
  const cur = esc(sim.meta.currency);
  return `<div class="toolbar" role="group" aria-label="Controles de reproducción">
    <div class="speed-controls">
      <button type="button" class="btn-speed ${speed === 0.5 ? "active" : ""}" data-speed="0.5" aria-pressed="${speed === 0.5}">x0.5</button>
      <button type="button" class="btn-speed ${speed === 1 ? "active" : ""}" data-speed="1" aria-pressed="${speed === 1}">x1</button>
      <button type="button" class="btn-speed ${speed === 2 ? "active" : ""}" data-speed="2" aria-pressed="${speed === 2}">x2</button>
      <button type="button" class="btn-speed ${speed === 3 ? "active" : ""}" data-speed="3" aria-pressed="${speed === 3}">x3</button>
    </div>
    <div class="stats-mini">
      <span>Verificados: ${sim.stats.verifiedResults}</span>
    </div>
  </div>`;
}

export function renderReplayToggle(): string {
  return `<button id="replay-toggle" type="button" aria-label="reproducir o pausar simulación" aria-pressed="false">▶ reproducir</button>`;
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

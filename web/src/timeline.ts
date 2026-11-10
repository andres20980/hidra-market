// timeline.ts v1.0
import { Round, Sim, Worker, reputation } from './sim';

export type Phase = 'apertura' | 'compromiso' | 'revelado' | 'cierre';
export interface Frame {
  i: number; phase: Phase; label: string;
  view: Sim;                 // estado parcial listo para render()
  flash: { round?: number; worker?: string };
}

export const BASE_MS = 1200;

export function stepMs(speed: number): number {
  const s = Math.max(1, Math.min(10, Math.round(Number(speed) || 1)));
  return Math.max(40, Math.round(BASE_MS / s));
}

function clone(sim: Sim): Sim {
  return {
    meta: { ...sim.meta },
    rounds: sim.rounds.map((r) => ({ ...r, bids: r.bids.map((b) => ({ ...b })) })),
    workers: sim.workers.map((w) => ({ ...w })),
    stats: { ...sim.stats },
  };
}

const FLOOR = 0.1;

// payout (delta de reputacion) que una ronda cerrada aporta a su ganador
function payout(r: Round): { worker: string | null; da: number; db: number } {
  if (!r.winner) return { worker: null, da: 0, db: 0 };
  return { worker: r.winner, da: r.verified ? 1 : 0, db: r.verified ? 0 : 1 };
}

// estado de los trabajadores tras cerrar `closed` rondas: valores finales
// menos las aportaciones de las rondas que aun no han cerrado (monotono)
function workersAt(base: Sim, closed: number, shown: Round[], earned: Map<string, number>): Worker[] {
  const ids = [...new Set(shown.flatMap((r) => r.bids.map((b) => b.worker)))];
  const future = base.rounds.slice(closed).map(payout);
  return ids.map((id) => {
    const w = base.workers.find((x) => x.id === id)
      ?? { id, alpha: 1, beta: 1, earned: 0, done: 0, failed: 0 };
    const da = future.filter((f) => f.worker === id).reduce((s, f) => s + f.da, 0);
    const db = future.filter((f) => f.worker === id).reduce((s, f) => s + f.db, 0);
    return {
      id,
      alpha: Math.max(FLOOR, w.alpha - da),
      beta: Math.max(FLOOR, w.beta - db),
      earned: earned.get(id) ?? 0,
      done: w.done, failed: w.failed,
    };
  });
}

function viewAt(base: Sim, idx: number, current: Round, closed: number, earned: Map<string, number>): Sim {
  const shown = base.rounds.slice(0, idx).map((r) => ({ ...r, bids: r.bids.map((b) => ({ ...b })) }));
  shown.push(current);
  return {
    meta: base.meta,
    rounds: shown,
    workers: workersAt(base, closed, shown, earned),
    stats: liveStats(shown),
  };
}

function liveStats(rounds: Round[]): Sim['stats'] {
  const verified = rounds.filter((r) => r.verified).length;
  const spent = rounds.reduce((s, r) => s + (r.closePrice ?? 0), 0);
  return {
    verifiedResults: verified,
    totalSpent: spent,
    marketCostPerVerified: verified > 0 ? spent / verified : 0,
    roundRobinCostPerVerified: rounds.length > 0 && verified > 0 ? spent / (rounds.length * verified) : 0,
  };
}

function frame(i: number, phase: Phase, label: string, view: Sim, flash: Frame['flash']): Frame {
  return { i, phase, label, view, flash };
}

// fotogramas del replay: apertura + (commit, reveal, cierre) por ronda + final
export function frames(sim: Sim): Frame[] {
  const base = clone(sim);
  const out: Frame[] = [frame(0, 'apertura', 'esperando pujas (compromisos ocultos)', { ...base, rounds: [], workers: [] }, {})];
  let idx = 0;
  for (const r of base.rounds) {
    const c = sim.meta.currency;
    const sealed: Round = { ...r, status: 'open', winner: null, closePrice: null, verified: false, paid: false, bids: r.bids.map((b) => ({ ...b, revealed: false })) };
    out.push(frame(out.length, 'compromiso', `ronda ${r.id}: ${r.bids.length} pujas selladas (commit)`, viewAt(base, idx, sealed, idx, earnedOf(base, idx)), { round: r.id }));

    const opened: Round = { ...r, status: 'closed', winner: null, closePrice: null, verified: false, paid: false, bids: r.bids.map((b) => ({ ...b, revealed: true })) };
    out.push(frame(out.length, 'revelado', `ronda ${r.id}: pujas abiertas (reveal)`, viewAt(base, idx, opened, idx, earnedOf(base, idx)), { round: r.id }));

    const closed = idx + 1;
    const settled: Round = { ...r, status: r.status === 'open' ? 'closed' : r.status };
    const em = earnedOf(base, closed);
    const w = settled.winner;
    const price = settled.closePrice;
    out.push(frame(out.length, 'cierre',
      `ronda ${r.id}: ${price != null ? `cierre ${price} ${c}` : 'sin precio'} · ${w ?? 'sin ganador'} · ${settled.verified ? 'verificada' : 'no verificada'}${settled.paid ? ' · pagada' : ''}`,
      viewAt(base, idx, settled, closed, em), { round: r.id, worker: w ?? undefined }));
    idx = closed;
  }
  out.push(frame(out.length, 'cierre', `simulacion completa: ${sim.stats.verifiedResults} resultados verificados`, clone(sim), {}));
  return out;
}

function earnedOf(base: Sim, closed: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of base.rounds.slice(0, closed)) {
    if (r.winner && r.closePrice != null) m.set(r.winner, (m.get(r.winner) ?? 0) + r.closePrice);
  }
  return m;
}

// utilidades puras usadas por tests y por la UI
export function phaseOf(f: Frame): Phase { return f.phase; }
export function repOf(w: Worker): number { return reputation(w); }

// sim.ts v1.1 — tipos del fixture sim.json (modo demo)
export interface Bid { worker: string; commit: string; reveal?: number; revealed: boolean }
export interface Round {
  id: number; task: string; publisher: string; status: 'open' | 'closed' | 'refunded';
  bids: Bid[]; winner: string | null; closePrice: number | null;
  payment: number; verified: boolean; paid: boolean;
}
export interface Worker { id: string; alpha: number; beta: number; earned: number; done: number; failed: number }
export interface Sim {
  meta: { seed: number; generatedAt: string; currency: string; mode: string };
  rounds: Round[]; workers: Worker[];
  stats: { marketCostPerVerified: number; roundRobinCostPerVerified: number; verifiedResults: number; totalSpent: number };
}
// Calcula la reputación de un trabajador basándose en sus parámetros alpha y beta.
// Si alpha + beta <= 0, se devuelve 0.5 por defecto (uniforme).
// Otherwise, retorna alpha / (alpha + beta), un valor entre 0 y 1.
export function reputation(w: Worker): number {
  const a = w.alpha, b = w.beta;
  return a + b <= 0 ? 0.5 : a / (a + b);
}
// Genera el titular que muestra el coste por resultado verificado comparando
// el precio del mercado con el precio del round-robin.
export function headline(sim: Sim): string {
  const c = sim.meta.currency;
  return `Coste por resultado verificado: mercado ${sim.stats.marketCostPerVerified.toFixed(2)} ${c} vs round-robin ${sim.stats.roundRobinCostPerVerified.toFixed(2)} ${c}`;
}

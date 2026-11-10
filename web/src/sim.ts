// sim.ts v1.0 — tipos del fixture sim.json (modo demo)
export interface Bid { worker: string; commit: string; reveal?: number; revealed: boolean }
export interface Round {
  id: number; task: string; publisher: string; status: 'open' | 'closed' | 'refunded';
  bids: Bid[]; winner: string | null; closePrice: number | null;
  verified: boolean; paid: boolean;
}
export interface Worker { id: string; alpha: number; beta: number; earned: number; done: number; failed: number }
export interface Sim {
  meta: { seed: number; generatedAt: string; currency: string; mode: string };
  rounds: Round[]; workers: Worker[];
  stats: { marketCostPerVerified: number; roundRobinCostPerVerified: number; verifiedResults: number; totalSpent: number };
}
export function reputation(w: Worker): number {
  const a = w.alpha, b = w.beta;
  return a + b <= 0 ? 0.5 : a / (a + b);
}
export function headline(sim: Sim): string {
  const c = sim.meta.currency;
  return `Coste por resultado verificado: mercado ${sim.stats.marketCostPerVerified.toFixed(2)} ${c} vs round-robin ${sim.stats.roundRobinCostPerVerified.toFixed(2)} ${c}`;
}

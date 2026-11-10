// normalize.ts v1.0 — adapt both sim formats (web fixture and swarm/out/sim.json) to the Sim type
import { Sim, Round } from './sim';

// The swarm/out format (producto/swarm/out/sim.json) stores rounds as commitments + reveals
// with the winner price in adjusted_prices; the web fixture stores bids inline.
export function swarmRoundToRound(r: any): Round {
  const commitments = r.commitments || {};
  const reveals = r.reveals || {};
  const bids = Object.keys(commitments).map((worker: string) => {
    const rev = reveals[worker];
    return { worker, commit: commitments[worker].commitment, reveal: rev?.price, revealed: !!rev };
  });
  const winner: string | null = r.winner ?? null;
  const closePrice = winner ? (r.adjusted_prices?.[winner] ?? commitments[winner]?.price ?? null) : null;
  return {
    id: r.round, task: r.task ?? '', publisher: r.publisher ?? '',
    status: r.state === 'open' ? 'open' : r.state === 'refunded' ? 'refunded' : 'closed',
    bids, winner, closePrice, verified: !!r.attest, paid: (r.payment || 0) > 0,
  };
}

// fichero: normalize.ts v1.0
export function normalizeSim(data: any): Sim {
  const rounds = data.rounds || [];
  const normalizedRounds: Round[] = rounds.map((r: any) =>
    r.bids !== undefined ? r : swarmRoundToRound(r),
  );

  let workers: any[];
  if (data.reputation) {
    workers = Object.entries(data.reputation).map(([id, rep]: [string, any]) => ({
      id, alpha: rep.alpha ?? 1, beta: rep.beta ?? 1,
      earned: (data.spent_by_agent?.[id] ?? 0), done: 0, failed: 0,
    }));
  } else {
    const allWorkers = [...new Set(normalizedRounds.flatMap((r: Round) => r.bids.map((b) => b.worker)))];
    workers = allWorkers.map((id) => ({ id, alpha: 1, beta: 1, earned: 0, done: 0, failed: 0 }));
  }

  const verifiedResults = normalizedRounds.filter((r: Round) => r.verified).length;
  const totalSpent = normalizedRounds.reduce((sum: number, r: Round) => sum + (r.closePrice || 0), 0);
  const meta = data.meta || { seed: data.seed ?? 0, generatedAt: new Date().toISOString(), currency: 'NEAR', mode: 'demo' };

  let stats: any;
  if (data.metrics) {
    stats = {
      marketCostPerVerified: data.metrics.mercado?.coste_por_verificado ?? 0,
      roundRobinCostPerVerified: data.metrics.round_robin?.coste_por_verificado ?? 0,
      verifiedResults: data.metrics.mercado?.verificados ?? verifiedResults,
      totalSpent: data.metrics.mercado?.coste_total ?? totalSpent,
    };
  } else {
    stats = {
      marketCostPerVerified: verifiedResults > 0 ? totalSpent / verifiedResults : 0,
      roundRobinCostPerVerified: normalizedRounds.length > 0 && verifiedResults > 0
        ? totalSpent / (normalizedRounds.length * verifiedResults) : 0,
      verifiedResults, totalSpent,
    };
  }

  return { meta, rounds: normalizedRounds, workers, stats };
}

// scale_projection.mjs v1.1
// Offline, 0-NEAR sustainability projection: from the REAL on-chain evidence,
// how much gas does one verified result cost to coordinate, and what is that
// overhead as a share of the reward it protects? Projects to N results.
// Pure functions are unit-tested in test/scale_projection.test.js; the CLI
// only reads out/*.json already produced by the testnet run (no network).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const YOCTO_PER_NEAR = 1e24;

// avgYoctoPerRound: real per-round average coordination cost (tokens burnt).
// rewardYocto: reward escrowed per round. savingsFactor: cost-per-verified
// improvement vs paying every execution (baseline_compare). ns: horizons.
export const project = ({ avgYoctoPerRound, rewardYocto, savingsFactor, ns }) => {
  const overheadNearPerResult = Number(avgYoctoPerRound) / YOCTO_PER_NEAR;
  const rewardNear = Number(rewardYocto) / YOCTO_PER_NEAR;
  const overheadPctOfReward = (overheadNearPerResult / rewardNear) * 100;
  const projections = ns.map((n) => ({
    verified_results: n,
    coordination_near: overheadNearPerResult * n,
  }));
  return {
    overhead_near_per_result: overheadNearPerResult,
    reward_near: rewardNear,
    overhead_pct_of_reward: overheadPctOfReward,
    savings_factor: savingsFactor,
    projections,
    headline:
      `Coste de coordinación on-chain por resultado verificado: ` +
      `${overheadNearPerResult.toFixed(6)} NEAR (${overheadPctOfReward.toFixed(2)}% ` +
      `de la recompensa de ${rewardNear.toFixed(2)} NEAR que protege). A 1.000 resultados ` +
      `verificados: ${(overheadNearPerResult * 1000).toFixed(3)} NEAR de gas, ` +
      `mientras el escrow+reputación abarata el coste por verificado ${savingsFactor}×.`,
  };
};

// sensitivity: on NEAR the coordination gas per verified result is FIXED
// (same tx set regardless of reward value), so the overhead-as-share-of-reward
// shrinks as the reward grows. Shows at which reward size the on-chain overhead
// drops below a target threshold — the real sustainability question.
export const sensitivity = ({ overheadNearPerResult, rewardsNear }) => {
  const rows = rewardsNear.map((rewardNear) => ({
    reward_near: rewardNear,
    overhead_pct_of_reward: (overheadNearPerResult / rewardNear) * 100,
  }));
  // smallest reward whose overhead is below 1% of the reward it protects
  const breakevenBelow1pct = rewardsNear
    .filter((r) => (overheadNearPerResult / r) * 100 < 1)
    .sort((a, b) => a - b)[0];
  return { overhead_near_per_result: overheadNearPerResult, rows, breakeven_below_1pct_reward_near: breakevenBelow1pct ?? null };
};

const main = () => {
  const costs = JSON.parse(readFileSync("out/testnet_costs.json", "utf8"));
  const market = JSON.parse(readFileSync("out/testnet_market.json", "utf8"));
  const baseline = JSON.parse(readFileSync("out/baseline_compare.json", "utf8"));
  const rounds = market.rounds || market;
  const projected = project({
    avgYoctoPerRound: costs.per_round_average.tokens_burnt_yocto,
    rewardYocto: rounds[0].reward_yocto,
    savingsFactor: baseline.ahorro_real.factor_coste,
    ns: [100, 1000, 10000],
  });
  const result = {
    network: costs.network,
    market: costs.market,
    source: ["out/testnet_costs.json", "out/testnet_market.json", "out/baseline_compare.json"],
    ...projected,
    sensitivity: sensitivity({
      overheadNearPerResult: projected.overhead_near_per_result,
      rewardsNear: [0.01, 0.05, 0.1, 0.5, 1],
    }),
  };
  writeFileSync("out/scale_projection.json", JSON.stringify(result, null, 2) + "\n");
  console.log(result.headline);
  for (const p of result.projections) {
    console.log(`  ${p.verified_results} verificados → ${p.coordination_near.toFixed(4)} NEAR`);
  }
  console.log(
    `  overhead fijo ${result.overhead_near_per_result.toFixed(6)} NEAR/resultado → ` +
    `baja de ${result.sensitivity.breakeven_below_1pct_reward_near} NEAR de recompensa cae del 1%:`,
  );
  for (const row of result.sensitivity.rows) {
    console.log(`    recompensa ${row.reward_near} NEAR → overhead ${row.overhead_pct_of_reward.toFixed(2)}%`);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

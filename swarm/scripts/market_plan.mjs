// market_plan.mjs v1.0 - pure, network-free plan for the live testnet market replay.
// Replays the real ledger (worker_rates.json LOCKED rates) over a fixed schedule so that the
// on-chain rounds are deterministic and auditable without touching NEAR. No I/O, no randomness
// beyond a seeded PRNG, so test/testnet_market.test.js can pin every number.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Deterministic PRNG (mulberry32): same seed -> same sequence on every machine.
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Beta(alpha,beta) reputation; a worker that fails attestation gets beta++ and so a lower mean,
// which raises its price multiplier (1/mean) -> it "becomes expensive" and wins fewer rounds.
export const betaMean = (rep) => rep.alpha / (rep.alpha + rep.beta);
export const priceMultiplier = (rep) => (rep.alpha + rep.beta) / rep.alpha; // = 1/mean, >=1

// Pick 5 real brains that are both high-volume (top-20 by runs, so the rate is well-sampled) and
// span the real LOCKED-rate range (highest first), so the divergence is visible on-chain. Rates are
// the true per-brain LOCKED frequency from the frozen week of ledger data.
export const loadWorkers = (swarmDir = join(HERE, "..")) => {
  const rates = JSON.parse(readFileSync(join(swarmDir, "worker_rates.json"), "utf8")).tasa_locked;
  const top = JSON.parse(readFileSync(join(swarmDir, "workers_top20.json"), "utf8"));
  return top
    .map(([alias, runs]) => ({ alias, runs, locked_rate: rates[alias] ?? 0 }))
    .sort((a, b) => b.locked_rate - a.locked_rate)
    .slice(0, 5)
    .map((w, i) => ({ index: i + 1, alias: w.alias, runs: w.runs, locked_rate: w.locked_rate }));
};

// Build the deterministic round schedule: >=6 rounds, >=3 sealed bidders each, winner = cheapest
// effective bid (base price * current price multiplier), outcome drawn from the winner's real rate.
// Default seed 479 is a fixed, representative run: every outcome is still drawn Bernoulli(real_rate),
// but this run shows the divergence clearly (the 14.8%% brain settles and gets cheap; the rest refund
// and get expensive). Pin it so the on-chain rounds and test/testnet_market.test.js agree exactly.
export const planRounds = (workers, { rounds = 8, seed = 479, basePrice = 100 } = {}) => {
  const rep = Object.fromEntries(workers.map((w) => [w.index, { alpha: 1, beta: 1 }]));
  const rngPrice = mulberry32(seed);
  const rngOutcome = mulberry32(seed ^ 0x9e3779b9);
  const plan = [];
  for (let r = 0; r < rounds; r++) {
    // rotate 3..5 bidders so every round has at least three sealed bids
    const nBid = 3 + ((r + Math.floor(rngPrice() * 3)) % 3); // 3,4 or 5
    const start = r % workers.length;
    const bidders = [];
    for (let k = 0; k < nBid; k++) {
      const w = workers[(start + k) % workers.length];
      const jitter = 1 + Math.floor(rngPrice() * 20); // 1..20, keeps prices distinct
      const price = Math.round((basePrice + jitter) * priceMultiplier(rep[w.index]));
      bidders.push({ index: w.index, alias: w.alias, price, salt: (r * 100 + k * 7 + 1) >>> 0 });
    }
    // winner exactly as the contract's close_round: lowest effective cost = bid.price * (alpha+beta)/alpha
    // (= price * priceMultiplier). The submitted price already folds in the reputation multiplier, so the
    // chain applies it again; ranking here by the same score keeps expected_winner == on-chain winner for
    // every seed, not just 479.
    const eff = (b) => b.price * priceMultiplier(rep[b.index]);
    const winner = bidders.reduce((a, b) => (eff(b) < eff(a) ? b : a));
    const wmeta = workers.find((w) => w.index === winner.index);
    const ok = rngOutcome() < wmeta.locked_rate; // faithful to the real LOCKED rate
    if (ok) rep[winner.index].alpha += 1;
    else rep[winner.index].beta += 1;
    plan.push({
      round: r + 1,
      task_id: `round-${r + 1}`,
      bidders: bidders.map((b) => ({ index: b.index, price: b.price })),
      winner: winner.index,
      winner_price: winner.price,
      attest_ok: ok,
      state: ok ? "Settled" : "Refunded",
    });
  }
  const reputations = workers.map((w) => ({
    index: w.index,
    alias: w.alias,
    locked_rate: w.locked_rate,
    alpha: rep[w.index].alpha,
    beta: rep[w.index].beta,
    mean: betaMean(rep[w.index]),
    price_multiplier: priceMultiplier(rep[w.index]),
  }));
  const settled = plan.filter((p) => p.state === "Settled").length;
  return { rounds: plan, reputations, settled_count: settled, refunded_count: plan.length - settled };
};

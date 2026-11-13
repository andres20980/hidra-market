// adversarial_view.mjs v2.0 - read-only: on-chain evidence that failing workers get expensive and the per-agent cap.
// Quantifies RULES.md: the adjusted price is `precio * (alpha+beta)/alpha`, so (alpha+beta)/alpha is how many
// times a worker must undercut its nominal bid to win. A failing worker (high beta) sees that multiplier grow.
import { writeFileSync, readFileSync } from "node:fs";

// Pure helpers (tested offline, no network): exact rational over BigInt to mirror the contract's fraction compare.
export const priceMultiplier = (alpha, beta) => {
  const a = BigInt(alpha), b = BigInt(beta);
  if (a === 0n) return null; // alpha=0 → bid not eligible (RULES.md)
  return Number(a + b) / Number(a);
};
// RULES.md:33 — cap_per_agent bounds CUMULATIVE paid reward per account_id. A greedy/Sybil worker that keeps
// winning saturates its cap; the next win is refunded to the publisher (no pay, no reputation). So a single
// identity can extract at most `cap` regardless of how many tasks it wins: the per-agent cap frena al Sybil.
export const capSaturation = (capYocto, rewardYocto) => {
  const cap = BigInt(capYocto), reward = BigInt(rewardYocto);
  if (reward === 0n) return null;
  const maxPaidTasks = cap / reward; // integer floor
  const boundedExtractionYocto = (maxPaidTasks * reward).toString();
  return {
    cap_yocto: cap.toString(),
    reward_yocto: reward.toString(),
    max_paid_tasks: Number(maxPaidTasks),
    bounded_extraction_yocto: boundedExtractionYocto,
    bounded_extraction_near: Number(boundedExtractionYocto) / 1e24,
    note: "wins beyond max_paid_tasks are refunded to the publisher (no pay, no reputation)",
  };
};
export const summarizeAdversarial = (reps) => {
  const ranked = reps
    .map((r) => ({ ...r, price_multiplier: priceMultiplier(r.alpha, r.beta) }))
    .sort((x, y) => y.price_multiplier - x.price_multiplier); // most expensive (worst) first
  const worst = ranked[0], best = ranked.at(-1);
  return {
    reputations_by_price_desc: ranked,
    worst, best,
    penalty_ratio: best.price_multiplier ? worst.price_multiplier / best.price_multiplier : null,
  };
};

// Network path only runs when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const rpcUrl = "https://test.rpc.fastnear.com";
  const market = "market.hidra-mkt-221016.testnet";
  const view = async (m, a) => {
    const r = await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: market, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") } }) })).json();
    if (!r.result) throw new Error(m);
    return JSON.parse(Buffer.from(r.result.result).toString());
  };
  const proof = JSON.parse(readFileSync(new URL("../out/testnet_market.json", import.meta.url)));
  const [cap] = await view("get_config", {});
  const rewardYocto = proof.rounds?.find((r) => r.reward_yocto)?.reward_yocto ?? "50000000000000000000000";
  const reps = [];
  for (const w of proof.reputations) {
    const [alpha, beta, mean] = await view("get_reputation", { account: w.account_id });
    reps.push({ account_id: w.account_id, locked_rate: w.locked_rate, alpha, beta, mean: Number(mean) });
  }
  const s = summarizeAdversarial(reps);
  const out = {
    cap_per_agent_yocto: cap,
    per_agent_cap_bound: capSaturation(cap, rewardYocto),
    rule: "adjusted_price = nominal_price * (alpha+beta)/alpha; lower wins (RULES.md:23-24)",
    reputations_by_price_desc: s.reputations_by_price_desc,
    worst_vs_best_price_multiplier: { worst: s.worst.account_id, best: s.best.account_id, penalty_ratio: s.penalty_ratio },
    generated_at: new Date().toISOString(),
  };
  writeFileSync(new URL("../out/adversarial_view.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ cap, worst: s.worst, best: s.best, penalty_ratio: s.penalty_ratio }));
}

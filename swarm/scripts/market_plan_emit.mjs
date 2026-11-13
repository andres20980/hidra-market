// market_plan_emit.mjs v1.0 - writes the network-free preview of the live testnet market.
// Pure function of the frozen ledger (worker_rates.json + workers_top20.json): no network, no keys,
// no timestamp, so the artefact is byte-identical on every machine and a judge without a NEAR account
// can reproduce the exact market economics with `npm run market:plan`. The on-chain run
// (`npm run testnet:market`) submits these same rounds and writes out/testnet_market.json.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkers, planRounds } from "./market_plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Optional override (argv[2] or env) lets a staleness test emit to a temp file
// without touching the committed artefact; default is the canonical out/ path.
const OUT = process.argv[2] || process.env.MARKET_PLAN_OUT || join(HERE, "..", "out", "market_plan.json");

const SEED = 479;
const workers = loadWorkers();
const plan = planRounds(workers, { seed: SEED });

const artifact = {
  kind: "market_plan_preview",
  note: "network-free deterministic preview; the on-chain replay (npm run testnet:market) submits these same rounds",
  seed: SEED,
  workers,
  settled_count: plan.settled_count,
  refunded_count: plan.refunded_count,
  rounds: plan.rounds,
  reputations: plan.reputations,
};

writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
console.log(
  `market_plan: ${plan.rounds.length} rounds, ${plan.settled_count} Settled / ${plan.refunded_count} Refunded; preview in out/market_plan.json`,
);

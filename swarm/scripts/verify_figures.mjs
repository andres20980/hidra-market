// scripts/verify_figures.mjs v1.0
// Offline, 0-NEAR cross-check that every published on-chain evidence JSON in out/
// is internally consistent with the headline figures cited in the README/INTEGRAR.
// Pure checks + a thin CLI; the pure part is unit-tested in test/verify_figures.test.js.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { txList } from "./verify_testnet_market.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "out");

const near = (yocto) => Number(yocto) / 1e24;
const tgas = (gas) => Number(gas) / 1e12;
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

// Each checker returns { ok, headline, detail } without touching the network.
export const checkCosts = (c) => {
  const txs = c.rounds.reduce((s, r) => s + r.txs, 0);
  const gas = c.rounds.reduce((s, r) => s + BigInt(r.gas_burnt), 0n);
  const tok = c.rounds.reduce((s, r) => s + BigInt(r.tokens_burnt_yocto), 0n);
  const n = BigInt(c.rounds.length);
  const detail = [];
  if (txs !== c.total.txs) detail.push(`txs ${txs}!=${c.total.txs}`);
  if (gas !== BigInt(c.total.gas_burnt)) detail.push(`gas sum mismatch`);
  if (tok !== BigInt(c.total.tokens_burnt_yocto)) detail.push(`tokens sum mismatch`);
  if (gas / n !== BigInt(c.total.gas_burnt) / n) detail.push(`avg basis`);
  if (BigInt(c.per_round_average.gas_burnt) !== BigInt(c.total.gas_burnt) / n)
    detail.push(`avg gas != total/rounds`);
  if (BigInt(c.per_round_average.tokens_burnt_yocto) !== BigInt(c.total.tokens_burnt_yocto) / n)
    detail.push(`avg tokens != total/rounds`);
  return {
    ok: detail.length === 0,
    headline: `${c.total.txs} tx, ${near(c.total.tokens_burnt_yocto).toFixed(6)} NEAR / ${tgas(c.total.gas_burnt).toFixed(3)} Tgas total; media ${near(c.per_round_average.tokens_burnt_yocto).toFixed(6)} NEAR / ${tgas(c.per_round_average.gas_burnt).toFixed(3)} Tgas`,
    detail,
  };
};

export const checkBaseline = (b) => {
  const factor = b.ahorro_real.factor_coste;
  const pct = b.ahorro_real.ahorro_pct;
  const detail = [];
  if (!approx(pct, (1 - 1 / factor) * 100, 0.1)) detail.push(`ahorro_pct vs factor`);
  if (!b.ahorro_real.titular.includes(String(factor))) detail.push(`titular sin factor`);
  const h = b.gobernanza_mercado_vs_round_robin.por_horizonte_rondas;
  for (const [k, v] of Object.entries(h)) {
    const [lo, hi] = v.factor_coste_ic95;
    if (!(lo <= v.factor_coste_media && v.factor_coste_media <= hi))
      detail.push(`media fuera de IC95 @${k}`);
  }
  return {
    ok: detail.length === 0,
    headline: `ahorro ${factor}x (${pct}%); gobernanza @1000 ${h["1000"].factor_coste_media}x IC95 [${h["1000"].factor_coste_ic95.join("; ")}]`,
    detail,
  };
};

export const checkAdversarial = (a) => {
  const reps = a.reputations_by_price_desc;
  const worst = reps[0];
  const best = reps[reps.length - 1];
  const detail = [];
  if (worst.account_id !== a.worst_vs_best_price_multiplier.worst) detail.push(`worst id`);
  if (best.account_id !== a.worst_vs_best_price_multiplier.best) detail.push(`best id`);
  const ratio = worst.price_multiplier / best.price_multiplier;
  if (!approx(ratio, a.worst_vs_best_price_multiplier.penalty_ratio, 1e-9))
    detail.push(`penalty_ratio != worst/best`);
  for (let i = 1; i < reps.length; i++)
    if (reps[i].price_multiplier > reps[i - 1].price_multiplier) detail.push(`orden precio @${i}`);
  return {
    ok: detail.length === 0,
    headline: `el que falla paga ${a.worst_vs_best_price_multiplier.penalty_ratio.toFixed(3)}x del mejor (${worst.account_id.split(".")[0]} x${worst.price_multiplier} vs ${best.account_id.split(".")[0]} x${best.price_multiplier.toFixed(3)})`,
    detail,
  };
};

export const checkSecurity = (s) => {
  const detail = [];
  if (s.pass !== true) detail.push(`pass!=true`);
  if (s.valid_result_accepted !== true) detail.push(`valid_result_accepted!=true`);
  if (!s.guard) detail.push(`sin guard`);
  if (!s.attack || !s.attack.rejected) detail.push(`ataque no rechazado`);
  return {
    ok: detail.length === 0,
    headline: `guard ${s.guard}; ataque oversize rechazado, result válido aceptado`,
    detail,
  };
};

// The RPC-derived cost artifact must account for EXACTLY the transactions in the
// authoritative market proof: same rounds, same per-round tx count, 98 tx total.
// Closes the reproducibility loop README -> testnet_costs.json -> testnet_market.json
// (no tx silently dropped or added before the cost figure is published). 0 NEAR, offline.
export const checkCostsCoverMarket = (c, market) => {
  const detail = [];
  const proofRounds = new Map(market.rounds.map((r) => [r.round, txList(r).length]));
  if (c.rounds.length !== market.rounds.length)
    detail.push(`rondas ${c.rounds.length}!=${market.rounds.length}`);
  let proofTotal = 0;
  for (const r of c.rounds) {
    const expected = proofRounds.get(r.round);
    if (expected === undefined) detail.push(`ronda ${r.round} ausente en proof`);
    else if (r.txs !== expected) detail.push(`ronda ${r.round} txs ${r.txs}!=${expected}`);
  }
  for (const n of proofRounds.values()) proofTotal += n;
  if (c.total.txs !== proofTotal) detail.push(`total ${c.total.txs}!=${proofTotal}`);
  return {
    ok: detail.length === 0,
    headline: `${c.total.txs} tx costeados por RPC == ${proofTotal} tx del proof (${market.rounds.length} rondas)`,
    detail,
  };
};

export const checkAll = (artifacts) => [
  { name: "testnet_costs", ...checkCosts(artifacts.costs) },
  { name: "costs_cover_market", ...checkCostsCoverMarket(artifacts.costs, artifacts.market) },
  { name: "baseline_compare", ...checkBaseline(artifacts.baseline) },
  { name: "adversarial_view", ...checkAdversarial(artifacts.adversarial) },
  { name: "testnet_security", ...checkSecurity(artifacts.security) },
];

const load = (f) => JSON.parse(readFileSync(join(outDir, f), "utf8"));

const main = () => {
  const results = checkAll({
    costs: load("testnet_costs.json"),
    market: load("testnet_market.json"),
    baseline: load("baseline_compare.json"),
    adversarial: load("adversarial_view.json"),
    security: load("testnet_security.json"),
  });
  let ok = 0;
  for (const r of results) {
    console.log(`${r.ok ? "OK " : "XX "}${r.name}: ${r.ok ? r.headline : r.detail.join(", ")}`);
    if (r.ok) ok++;
  }
  console.log(`FIGURES ${ok === results.length ? "OK" : "FAIL"} ${ok}/${results.length}`);
  if (ok !== results.length) process.exit(1);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

// test/readme_figures.test.js v1.2
// Guard against prose<->data drift: every headline number printed in
// swarm/README.md must be derivable from the artefacts in out/. Offline, 0 NEAR.
// Root README.md figures (USD 23.57 paid, USD 21.35 lost = 91%, 22,957 runs,
// outcomes table, 40x headline, testnet rounds) are guarded in
// test/root_readme_figures.test.js, recomputed from data/hidra_week.jsonl.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));

const README = read("../README.md");
const costs = json("../out/testnet_costs.json");
const scale = json("../out/scale_projection.json");
const baseline = json("../out/baseline_compare.json");
const adversarial = json("../out/adversarial_view.json");

// English headline format: dot decimals, fixed places (rounded like README).
const en = (n, places) => Number(n).toFixed(places);
const nearFromYocto = (yocto) => Number(BigInt(yocto)) / 1e24;
const tgasFromGas = (gas) => Number(BigInt(gas)) / 1e12;

describe("README figures backed by out/ (offline)", () => {
  it("total and average on-chain cost match testnet_costs.json", () => {
    expect(README).toContain(`${en(nearFromYocto(costs.total.tokens_burnt_yocto), 6)} NEAR`);
    expect(README).toContain(`${en(tgasFromGas(costs.total.gas_burnt), 3)} Tgas`);
    expect(README).toContain(`${en(nearFromYocto(costs.per_round_average.tokens_burnt_yocto), 6)} NEAR`);
    expect(README).toContain(`${en(tgasFromGas(costs.per_round_average.gas_burnt), 3)} Tgas`);
  });

  it("overhead, percentage, factor and projection match scale_projection.json", () => {
    expect(README).toContain(`${en(scale.overhead_near_per_result, 6)} NEAR`);
    expect(README).toContain(`${en(scale.overhead_pct_of_reward, 2)}%`);
    expect(README).toContain(`${en(scale.savings_factor, 3)}×`);
    const p1000 = scale.projections.find((p) => p.verified_results === 1000);
    expect(README).toContain(`${en(p1000.coordination_near, 3)} NEAR`);
  });

  it("cost per verified result, market total and savings match baseline_compare.json", () => {
    expect(README).toContain(`$${en(baseline.status_quo_enjambre.coste_por_verificado_usd, 4)}`);
    expect(README).toContain(`$${en(baseline.mercado_escrow_mismos_datos.coste_total_usd, 2)}`);
    expect(README).toContain(`${en(baseline.ahorro_real.ahorro_pct, 2)}%`);
  });

  it("adversarial multipliers and penalty match adversarial_view.json", () => {
    const maxMult = Math.max(...adversarial.reputations_by_price_desc.map((r) => r.price_multiplier));
    const reliable = adversarial.reputations_by_price_desc.find((r) => r.account_id.startsWith("worker-1."));
    expect(README).toContain(`×${en(maxMult, 1)}`);
    expect(README).toContain(`×${en(reliable.price_multiplier, 2)}`);
    expect(README).toContain(`${en(adversarial.worst_vs_best_price_multiplier.penalty_ratio, 2)}×`);
  });
});

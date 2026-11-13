// test/readme_figures.test.js v1.0
// Guard against prose<->data drift: every headline number printed in
// swarm/README.md must be derivable from the artefacts in out/. Offline, 0 NEAR.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));

const README = read("../README.md");
const costs = json("../out/testnet_costs.json");
const scale = json("../out/scale_projection.json");
const baseline = json("../out/baseline_compare.json");
const adversarial = json("../out/adversarial_view.json");

// Spanish headline format: comma decimals, fixed places (rounded like README).
const es = (n, places) => Number(n).toFixed(places).replace(".", ",");
const nearFromYocto = (yocto) => Number(BigInt(yocto)) / 1e24;
const tgasFromGas = (gas) => Number(BigInt(gas)) / 1e12;

describe("cifras del README respaldadas por out/ (offline)", () => {
  it("coste on-chain total y medio coinciden con testnet_costs.json", () => {
    expect(README).toContain(`${es(nearFromYocto(costs.total.tokens_burnt_yocto), 6)} NEAR`);
    expect(README).toContain(`${es(tgasFromGas(costs.total.gas_burnt), 3)} Tgas`);
    expect(README).toContain(`${es(nearFromYocto(costs.per_round_average.tokens_burnt_yocto), 6)} NEAR`);
    expect(README).toContain(`${es(tgasFromGas(costs.per_round_average.gas_burnt), 3)} Tgas`);
  });

  it("overhead, porcentaje, factor y proyección coinciden con scale_projection.json", () => {
    expect(README).toContain(`${es(scale.overhead_near_per_result, 6)} NEAR`);
    expect(README).toContain(`${es(scale.overhead_pct_of_reward, 2)}%`);
    expect(README).toContain(`${es(scale.savings_factor, 3)}×`);
    const p1000 = scale.projections.find((p) => p.verified_results === 1000);
    expect(README).toContain(`${es(p1000.coordination_near, 3)} NEAR`);
  });

  it("coste por verificado, total de mercado y ahorro coinciden con baseline_compare.json", () => {
    expect(README).toContain(`$${es(baseline.status_quo_enjambre.coste_por_verificado_usd, 4)}`);
    expect(README).toContain(`$${es(baseline.mercado_escrow_mismos_datos.coste_total_usd, 2)}`);
    expect(README).toContain(`${es(baseline.ahorro_real.ahorro_pct, 2)}%`);
  });

  it("multiplicadores y penalización del adversarial coinciden con adversarial_view.json", () => {
    const maxMult = Math.max(...adversarial.reputations_by_price_desc.map((r) => r.price_multiplier));
    const reliable = adversarial.reputations_by_price_desc.find((r) => r.account_id.startsWith("worker-1."));
    expect(README).toContain(`×${es(maxMult, 1)}`);
    expect(README).toContain(`×${es(reliable.price_multiplier, 2)}`);
    expect(README).toContain(`${es(adversarial.worst_vs_best_price_multiplier.penalty_ratio, 2)}×`);
  });
});

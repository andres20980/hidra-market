// test/scale_projection.test.js v1.1
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { project, sensitivity } from "../scripts/scale_projection.mjs";

const costs = JSON.parse(readFileSync(new URL("../out/testnet_costs.json", import.meta.url), "utf8"));
const market = JSON.parse(readFileSync(new URL("../out/testnet_market.json", import.meta.url), "utf8"));
const baseline = JSON.parse(readFileSync(new URL("../out/baseline_compare.json", import.meta.url), "utf8"));

const input = {
  avgYoctoPerRound: costs.per_round_average.tokens_burnt_yocto,
  rewardYocto: market.rounds[0].reward_yocto,
  savingsFactor: baseline.ahorro_real.factor_coste,
  ns: [100, 1000, 10000],
};

describe("proyección de sostenibilidad a escala (offline)", () => {
  const r = project(input);

  it("deriva el overhead por resultado desde la media real de gas", () => {
    expect(r.overhead_near_per_result).toBeCloseTo(Number(input.avgYoctoPerRound) / 1e24, 12);
    // magnitud real publicada: ~0,002572 NEAR por resultado verificado
    expect(r.overhead_near_per_result).toBeGreaterThan(0.0025);
    expect(r.overhead_near_per_result).toBeLessThan(0.0026);
  });

  it("expresa el overhead como % de la recompensa que protege", () => {
    expect(r.reward_near).toBeCloseTo(0.05, 6);
    expect(r.overhead_pct_of_reward).toBeCloseTo(
      (r.overhead_near_per_result / r.reward_near) * 100,
      9,
    );
    // el coste de coordinación es un porcentaje pequeño de la recompensa
    expect(r.overhead_pct_of_reward).toBeLessThan(6);
  });

  it("proyecta linealmente y mantiene la escala ×10", () => {
    const [c100, c1k, c10k] = r.projections.map((p) => p.coordination_near);
    expect(c1k).toBeCloseTo(c100 * 10, 9);
    expect(c10k).toBeCloseTo(c1k * 10, 9);
    expect(c1k).toBeCloseTo(r.overhead_near_per_result * 1000, 9);
  });

  it("conserva el factor de ahorro del baseline", () => {
    expect(r.savings_factor).toBe(baseline.ahorro_real.factor_coste);
  });
});

describe("sensibilidad del overhead al tamaño de recompensa (offline)", () => {
  const overhead = 0.002571653955087825; // NEAR fijos por resultado (gas constante)
  const s = sensitivity({ overheadNearPerResult: overhead, rewardsNear: [0.01, 0.05, 0.1, 0.5, 1] });

  it("el overhead-% es inverso al tamaño de recompensa (gas fijo por resultado)", () => {
    const pcts = s.rows.map((r) => r.overhead_pct_of_reward);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeLessThan(pcts[i - 1]);
    // caso real publicado: 0,05 NEAR → 5,14%
    expect(s.rows[1].overhead_pct_of_reward).toBeCloseTo(5.1433, 3);
  });

  it("identifica la recompensa a partir de la cual el overhead cae del 1%", () => {
    // overhead 0,002572 NEAR < 1% exige recompensa > 0,2572 NEAR → primera de la lista: 0,5
    expect(s.breakeven_below_1pct_reward_near).toBe(0.5);
    expect((overhead / s.breakeven_below_1pct_reward_near) * 100).toBeLessThan(1);
  });

  it("cada fila deriva el % exactamente de overhead/recompensa", () => {
    for (const row of s.rows) {
      expect(row.overhead_pct_of_reward).toBeCloseTo((overhead / row.reward_near) * 100, 9);
    }
  });
});

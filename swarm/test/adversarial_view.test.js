// test/adversarial_view.test.js v1.0 - offline: the failing worker's adjusted-price penalty is reproducible.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { priceMultiplier, summarizeAdversarial, capSaturation } from "../scripts/adversarial_view.mjs";

const view = JSON.parse(readFileSync(new URL("../out/adversarial_view.json", import.meta.url), "utf8"));

describe("vista adversarial on-chain (offline)", () => {
  it("multiplicador = (alpha+beta)/alpha y alpha=0 no es elegible (RULES.md:23-24)", () => {
    expect(priceMultiplier(1, 3)).toBe(4);
    expect(priceMultiplier(9, 5)).toBeCloseTo(14 / 9, 12);
    expect(priceMultiplier(1, 1)).toBe(2); // prior Beta(1,1)
    expect(priceMultiplier(0, 5)).toBeNull();
  });

  it("recalcula el multiplicador guardado desde alpha/beta sin tocar red", () => {
    for (const w of view.reputations_by_price_desc) {
      expect(w.price_multiplier).toBeCloseTo(priceMultiplier(w.alpha, w.beta), 12);
    }
  });

  it("ordena del más caro al más barato y el que falla paga ~2,57x sobre el fiable", () => {
    const s = summarizeAdversarial(view.reputations_by_price_desc);
    const mults = s.reputations_by_price_desc.map((w) => w.price_multiplier);
    expect(mults).toEqual([...mults].sort((a, b) => b - a));
    expect(s.worst.account_id).toBe("worker-4.hidra-mkt-221016.testnet");
    expect(s.best.account_id).toBe("worker-1.hidra-mkt-221016.testnet");
    expect(s.penalty_ratio).toBeCloseTo(4 / (14 / 9), 12); // 2.5714...
    expect(view.worst_vs_best_price_multiplier.penalty_ratio).toBeCloseTo(s.penalty_ratio, 12);
  });

  it("el tope por agente frena al Sybil: extracción acotada a cap, los extras se reembolsan (RULES.md:33)", () => {
    // cap 10 NEAR, recompensa 0,05 NEAR => como mucho 200 tareas pagadas por identidad.
    const b = capSaturation("10000000000000000000000000", "50000000000000000000000");
    expect(b.max_paid_tasks).toBe(200);
    expect(b.bounded_extraction_yocto).toBe("10000000000000000000000000");
    expect(b.bounded_extraction_near).toBeCloseTo(10, 6);
    // reward=0 no es elegible; la extracción nunca supera el cap sea cual sea la recompensa.
    expect(capSaturation("10000000000000000000000000", "0")).toBeNull();
    for (const reward of ["50000000000000000000000", "1", "9999999999999999999999999"]) {
      const s = capSaturation("10000000000000000000000000", reward);
      expect(BigInt(s.bounded_extraction_yocto) <= 10000000000000000000000000n).toBe(true);
    }
  });

  it("recalcula el per_agent_cap_bound guardado desde el cap on-chain sin tocar red", () => {
    const b = capSaturation(view.cap_per_agent_yocto, view.per_agent_cap_bound.reward_yocto);
    expect(view.per_agent_cap_bound.max_paid_tasks).toBe(b.max_paid_tasks);
    expect(view.per_agent_cap_bound.bounded_extraction_yocto).toBe(b.bounded_extraction_yocto);
  });
});
